import { and, desc, eq, isNull } from "drizzle-orm";
import { accountVerifications, authPasswordCredentials, notifications, phoneChangeRequests, phoneVerificationRequests, userProfileAudits, users } from "../drizzle/schema";
import { phoneChangeRequestInputSchema, type PhoneChangeRequestInput, normalizePhoneNumber } from "../shared/phone-change";
import { phoneNumberSchema } from "../shared/registration";
import { decodeAccountVerificationImage, decryptAccountVerificationDocument, encryptAccountVerificationDocument, fingerprintAccountVerificationValue } from "./account-verification-crypto";
import { getDb } from "./db";
import { requireAdministrator } from "./payment-settings";

type Field = "idFront" | "idBack" | "selfie" | "walletProfile";
const fields: Field[] = ["idFront", "idBack", "selfie", "walletProfile"];

export async function getMyPhoneChangeRequest(userId: number) {
  const db = await getDb(); if (!db) throw new Error("قاعدة البيانات غير متاحة");
  const [user] = await db.select({ phoneNumber: users.phoneNumber }).from(users).where(eq(users.id, userId)).limit(1);
  const [request] = await db.select({ id: phoneChangeRequests.id, newPhoneNumber: phoneChangeRequests.newPhoneNumber, status: phoneChangeRequests.status, rejectionReason: phoneChangeRequests.rejectionReason, createdAt: phoneChangeRequests.createdAt, reviewedAt: phoneChangeRequests.reviewedAt }).from(phoneChangeRequests).where(eq(phoneChangeRequests.userId, userId)).orderBy(desc(phoneChangeRequests.createdAt), desc(phoneChangeRequests.id)).limit(1);
  return { currentPhoneNumber: user?.phoneNumber ?? null, request: request ?? null };
}

export async function submitPhoneChangeRequest(userId: number, raw: PhoneChangeRequestInput) {
  const input = phoneChangeRequestInputSchema.parse(raw);
  const db = await getDb(); if (!db) throw new Error("قاعدة البيانات غير متاحة");
  const newPhoneNormalized = normalizePhoneNumber(input.newPhoneNumber);
  const encoded = Object.fromEntries(fields.map((field) => {
    const bytes = decodeAccountVerificationImage(input[field]);
    return [field, { ciphertext: encryptAccountVerificationDocument(bytes), mimeType: input[field].mimeType }];
  })) as Record<Field, { ciphertext: string; mimeType: string }>;
  return db.transaction(async (tx) => {
    const [user] = await tx.select({ id: users.id, phoneNormalized: users.phoneNormalized, phoneNumber: users.phoneNumber }).from(users).where(eq(users.id, userId)).for("update").limit(1);
    if (!user) throw new Error("الحساب غير موجود");
    if ((user.phoneNormalized || normalizePhoneNumber(user.phoneNumber ?? "")) === newPhoneNormalized) throw new Error("رقم الهاتف الجديد مطابق للرقم الحالي");
    const [duplicate] = await tx.select({ id: users.id }).from(users).where(eq(users.phoneNormalized, newPhoneNormalized)).limit(1);
    if (duplicate && duplicate.id !== userId) throw new Error("رقم الهاتف مرتبط بحساب آخر");
    const [pending] = await tx.select({ id: phoneChangeRequests.id }).from(phoneChangeRequests).where(and(eq(phoneChangeRequests.userId, userId), eq(phoneChangeRequests.status, "pending"))).limit(1);
    if (pending) throw new Error("لديك طلب تغيير هاتف قيد المراجعة بالفعل");
    const inserted = await tx.insert(phoneChangeRequests).values({ userId, newPhoneNumber: input.newPhoneNumber, newPhoneNormalized, pendingPhoneNormalized: newPhoneNormalized, idFrontCiphertext: encoded.idFront.ciphertext, idFrontMimeType: encoded.idFront.mimeType, idBackCiphertext: encoded.idBack.ciphertext, idBackMimeType: encoded.idBack.mimeType, selfieCiphertext: encoded.selfie.ciphertext, selfieMimeType: encoded.selfie.mimeType, walletProfileCiphertext: encoded.walletProfile.ciphertext, walletProfileMimeType: encoded.walletProfile.mimeType, status: "pending" });
    const id = Number((inserted as any)?.[0]?.insertId ?? (inserted as any)?.insertId ?? 0);
    return { id, status: "pending" as const };
  });
}

export async function listAdminPhoneChangeRequests(adminId: number, status: "all" | "pending" | "approved" | "rejected" = "pending") {
  const db = await requireAdministrator(adminId);
  const rows = await db.select({ id: phoneChangeRequests.id, userId: phoneChangeRequests.userId, newPhoneNumber: phoneChangeRequests.newPhoneNumber, status: phoneChangeRequests.status, rejectionReason: phoneChangeRequests.rejectionReason, createdAt: phoneChangeRequests.createdAt, reviewedAt: phoneChangeRequests.reviewedAt, name: users.name, email: users.email, currentPhoneNumber: users.phoneNumber, customerId: users.customerId }).from(phoneChangeRequests).innerJoin(users, eq(users.id, phoneChangeRequests.userId)).where(status === "all" ? undefined : eq(phoneChangeRequests.status, status)).orderBy(desc(phoneChangeRequests.createdAt), desc(phoneChangeRequests.id)).limit(100);
  return rows;
}

export async function getAdminPhoneChangeDocuments(adminId: number, requestId: number) {
  const db = await requireAdministrator(adminId);
  const [row] = await db.select().from(phoneChangeRequests).where(eq(phoneChangeRequests.id, requestId)).limit(1);
  if (!row) throw new Error("طلب تغيير الهاتف غير موجود");
  const dataUrl = (encoded: string, mime: string) => `data:${mime};base64,${decryptAccountVerificationDocument(encoded).toString("base64")}`;
  return { id: row.id, userId: row.userId, status: row.status, newPhoneNumber: row.newPhoneNumber, documents: { idFront: dataUrl(row.idFrontCiphertext, row.idFrontMimeType), idBack: dataUrl(row.idBackCiphertext, row.idBackMimeType), selfie: dataUrl(row.selfieCiphertext, row.selfieMimeType), walletProfile: dataUrl(row.walletProfileCiphertext, row.walletProfileMimeType) } };
}

export async function reviewPhoneChangeRequest(adminId: number, requestId: number, decision: "approve" | "reject", rejectionReason?: string) {
  const db = await requireAdministrator(adminId); const reason = rejectionReason?.trim() ?? "";
  if (decision === "reject" && reason.length < 3) throw new Error("سبب الرفض إلزامي");
  return db.transaction(async (tx) => {
    const [request] = await tx.select().from(phoneChangeRequests).where(eq(phoneChangeRequests.id, requestId)).for("update").limit(1);
    if (!request || request.status !== "pending") throw new Error("الطلب غير موجود أو تمت مراجعته");
    const [user] = await tx.select().from(users).where(eq(users.id, request.userId)).for("update").limit(1);
    if (!user || user.role === "admin") throw new Error("حساب العميل غير موجود");
    if (decision === "reject") {
      await tx.update(phoneChangeRequests).set({ status: "rejected", pendingPhoneNormalized: null, rejectionReason: reason, reviewedBy: adminId, reviewedAt: new Date() }).where(eq(phoneChangeRequests.id, requestId));
      await tx.insert(notifications).values({ userId: user.id, createdBy: adminId, title: "لم تتم الموافقة على تغيير رقم الهاتف", body: `بقي رقم هاتفك الحالي دون تغيير. سبب الرفض: ${reason}`, type: "phone_change", operationId: `phone-change:${requestId}` });
      return { status: "rejected" as const };
    }
    const [duplicate] = await tx.select({ id: users.id }).from(users).where(eq(users.phoneNormalized, request.newPhoneNormalized)).limit(1);
    if (duplicate && duplicate.id !== user.id) throw new Error("رقم الهاتف مرتبط بحساب آخر");
    const now = new Date();
    await tx.update(users).set({ phoneNumber: request.newPhoneNumber, phoneNormalized: request.newPhoneNormalized, phoneVerifiedAt: now }).where(eq(users.id, user.id));
    await tx.update(authPasswordCredentials).set({ phoneVerifiedAt: now }).where(eq(authPasswordCredentials.userId, user.id));
    const [verification] = await tx.select({ id: accountVerifications.id }).from(accountVerifications).where(eq(accountVerifications.userId, user.id)).limit(1);
    if (verification) await tx.update(accountVerifications).set({ phoneNumberSnapshot: request.newPhoneNumber, phoneFingerprint: fingerprintAccountVerificationValue("phone", request.newPhoneNormalized) }).where(eq(accountVerifications.id, verification.id));
    await tx.update(phoneVerificationRequests).set({ status: "cancelled", reviewedAt: now, reviewedBy: adminId, reviewNote: "أُلغي الطلب بعد الموافقة على تغيير رقم الهاتف" })
      .where(and(eq(phoneVerificationRequests.userId, user.id), eq(phoneVerificationRequests.status, "pending")));
    await tx.insert(userProfileAudits).values({ adminId, targetUserId: user.id, changes: JSON.stringify({ phoneNumber: { from: user.phoneNumber, to: request.newPhoneNumber } }) });
    await tx.update(phoneChangeRequests).set({ status: "approved", pendingPhoneNormalized: null, rejectionReason: null, reviewedBy: adminId, reviewedAt: now }).where(eq(phoneChangeRequests.id, requestId));
    await tx.insert(notifications).values({ userId: user.id, createdBy: adminId, title: "تمت الموافقة على تغيير رقم الهاتف", body: `تم تحديث رقم هاتفك إلى ${request.newPhoneNumber} بعد مراجعة المدير.`, type: "phone_change", operationId: `phone-change:${requestId}` });
    return { status: "approved" as const, phoneNumber: request.newPhoneNumber };
  });
}
