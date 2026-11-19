import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { and, eq, ne } from "drizzle-orm";
import { accountVerificationOverrides, accountVerifications, users } from "../drizzle/schema";
import { parseEgyptianNationalId } from "../shared/national-id";
import { ENV } from "./_core/env";
import { getDb } from "./db";
import { fingerprintAccountVerificationValue } from "./account-verification-crypto";

function profileDataKey(): Buffer {
  if (!ENV.cookieSecret) throw new Error("إعداد حماية بيانات الملف غير متاح على الخادم");
  return createHash("sha256").update(`flotex-egp-profile-data-v1:${ENV.cookieSecret}`).digest();
}

export function encryptNationalId(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", profileDataKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptNationalId(encoded: string): string {
  const [version, ivValue, tagValue, ciphertextValue, extra] = encoded.split(".");
  if (version !== "v1" || !ivValue || !tagValue || !ciphertextValue || extra !== undefined) throw new Error("بيانات الرقم القومي المشفرة غير صالحة");
  const iv = Buffer.from(ivValue, "base64url");
  const tag = Buffer.from(tagValue, "base64url");
  const ciphertext = Buffer.from(ciphertextValue, "base64url");
  if (iv.length !== 12 || tag.length !== 16 || !ciphertext.length) throw new Error("بيانات الرقم القومي المشفرة غير صالحة");
  const decipher = createDecipheriv("aes-256-gcm", profileDataKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

export function maskNationalId(last4: string | null | undefined): string | null {
  return last4 && /^\d{4}$/.test(last4) ? `**********${last4}` : null;
}

export async function updateOwnNationalId(userId: number, rawValue: string) {
  const normalized = parseEgyptianNationalId(rawValue);
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  const fingerprint = fingerprintAccountVerificationValue("national-id", normalized);
  try {
    return await db.transaction(async (tx) => {
    const [user] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update").limit(1);
    if (!user) throw new Error("الحساب غير موجود");
    const [duplicate] = await tx.select({ id: users.id }).from(users)
      .where(and(eq(users.nationalIdFingerprint, fingerprint), ne(users.id, userId))).limit(1);
    if (duplicate) throw new Error("هذا الرقم القومي مستخدم بالفعل في حساب آخر");
    const [verification] = await tx.select({ status: accountVerifications.status }).from(accountVerifications).where(eq(accountVerifications.userId, userId)).limit(1);
    const [override] = await tx.select({ status: accountVerificationOverrides.status }).from(accountVerificationOverrides)
      .where(eq(accountVerificationOverrides.userId, userId)).limit(1);
    if (override?.status === "manual_verified" || (override?.status !== "revoked" && (verification?.status === "pending" || verification?.status === "approved"))) {
      throw new Error("لا يمكن تعديل الرقم القومي أثناء مراجعة التوثيق أو بعد اعتماده");
    }
    const result = await tx.update(users).set({
      nationalIdCiphertext: encryptNationalId(normalized),
      nationalIdLast4: normalized.slice(-4),
      nationalIdFingerprint: fingerprint,
    }).where(eq(users.id, userId));
    const affectedRows = Number((result as any)?.[0]?.affectedRows ?? (result as any)?.affectedRows ?? 0);
    if (affectedRows !== 1) throw new Error("الحساب غير موجود");
    return { nationalIdMasked: maskNationalId(normalized.slice(-4)) };
    });
  } catch (error) {
    const value = error as { code?: string; errno?: number; message?: string };
    if (value?.code === "ER_DUP_ENTRY" || value?.errno === 1062 || /duplicate entry|unique constraint/i.test(value?.message ?? "")) {
      throw new Error("هذا الرقم القومي مستخدم بالفعل في حساب آخر");
    }
    throw error;
  }
}
