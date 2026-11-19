import { and, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { authEmailChallenges } from "../drizzle/auth-schema";
import { manualVerificationCodes } from "../drizzle/manual-verification-schema";
import { users } from "../drizzle/schema";
import { ADMIN_EMAIL } from "../shared/admin";
import { issueManualVerificationSchema, redeemManualVerificationSchema, revokeManualVerificationSchema } from "../shared/manual-verification";
import { getDb } from "./db";
import { constantTimeHexEqual, createOpaqueGrant, hashEmailOtp, hashOpaqueGrant } from "./manual-auth-crypto";
import { findUsersByPhone, ManualAuthError } from "./manual-auth";
import { invalidatePreviousOtpIssues, lockOtpScope } from "./manual-otp-scope";

function secret() {
  const value = process.env.APP_VERIFICATION_SECRET ?? process.env.MANUS_JWT_SECRET;
  if (!value) throw new ManualAuthError("مفتاح التحقق البريدي غير مهيأ بأمان على الخادم.", "INTERNAL_SERVER_ERROR");
  return value;
}
function digest(id: string, email: string, purpose: string, code: string) {
  return hashEmailOtp(secret(), id, email, purpose, code);
}
function actorName(actor: { id: number; name: string | null; email: string | null }) {
  return (actor.name?.trim() || actor.email || `المسؤول #${actor.id}`).slice(0, 255);
}
async function requireAdmin(db: any, adminId: number) {
  const [actor] = await db.select({ id: users.id, name: users.name, email: users.email, emailNormalized: users.emailNormalized, role: users.role, status: users.status })
    .from(users).where(eq(users.id, adminId)).limit(1);
  if (!actor || actor.role !== "admin" || actor.status !== "active" || (actor.emailNormalized ?? actor.email)?.trim().toLowerCase() !== ADMIN_EMAIL) {
    throw new ManualAuthError("هذه العملية متاحة للمسؤول المخوّل فقط.", "UNAUTHORIZED");
  }
  return actor;
}
async function matchesEmail(tx: any, email: string) {
  return tx.select().from(users).where(or(eq(users.emailNormalized, email), sql`LOWER(${users.email}) = ${email}`)).for("update").limit(3);
}
async function targetForIssue(tx: any, email: string, purpose: "register" | "password_reset", phone: string | null) {
  if (email === ADMIN_EMAIL) throw new ManualAuthError("لا يمكن إصدار رمز يدوي لحساب الإدارة.");
  const matches = await matchesEmail(tx, email);
  if (purpose === "register") {
    if (matches.length) throw new ManualAuthError("البريد مرتبط بحساب قائم؛ استخدم غرض الاستعادة بعد مراجعة الملكية.", "CONFLICT");
    if (!phone || (await findUsersByPhone(tx, phone)).length) throw new ManualAuthError("رقم الهاتف غير صالح أو مستخدم بالفعل.", "CONFLICT");
    return null;
  }
  const target = matches[0];
  if (matches.length !== 1 || target.role !== "user" || target.status !== "active") throw new ManualAuthError("لا يوجد حساب عميل نشط مطابق بشكل فريد؛ راجع السجلات.");
  return target.id as number;
}

export async function issueManualVerification(adminId: number, raw: unknown) {
  const input = issueManualVerificationSchema.parse(raw);
  const db = await getDb();
  if (!db) throw new ManualAuthError("قاعدة البيانات غير متاحة الآن.", "INTERNAL_SERVER_ERROR");
  const actor = await requireAdmin(db, adminId);
  const id = randomUUID();
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  const codeHash = digest(id, input.email, input.purpose, code);
  const expiresAt = await db.transaction(async (tx: any) => {
    await lockOtpScope(tx, input.email, input.purpose, secret());
    const now = new Date();
    const expiresAt = new Date(now.getTime() + input.validityMinutes * 60_000);
    await invalidatePreviousOtpIssues(tx, input.email, input.purpose, now, { id: actor.id, name: actorName(actor) });
    const userId = await targetForIssue(tx, input.email, input.purpose, input.phoneNumber ?? null);
    await tx.insert(manualVerificationCodes).values({ id, email: input.email, purpose: input.purpose, userId,
      phoneNormalized: input.phoneNumber ?? null, codeHash, expiresAt, maxAttempts: input.maxAttempts,
      issuedBy: actor.id, issuedByName: actorName(actor), ownershipMethod: input.ownershipMethod,
      ownershipCaseRef: input.ownershipCaseRef, createdAt: now });
    return expiresAt;
  });
  // Only this response contains the code. It is never persisted, logged, or included in history.
  return { id, code, expiresAt, email: input.email, purpose: input.purpose };
}

export async function revokeManualVerification(adminId: number, raw: unknown) {
  const { id } = revokeManualVerificationSchema.parse(raw);
  const db = await getDb();
  if (!db) throw new ManualAuthError("قاعدة البيانات غير متاحة الآن.", "INTERNAL_SERVER_ERROR");
  const actor = await requireAdmin(db, adminId);
  return db.transaction(async (tx: any) => {
    const [row] = await tx.select().from(manualVerificationCodes).where(eq(manualVerificationCodes.id, id)).for("update").limit(1);
    if (!row) throw new ManualAuthError("لم يُعثر على سجل الرمز.");
    if (!row.revokedAt) await tx.update(manualVerificationCodes).set({ revokedAt: new Date(), revokedBy: actor.id, revokedByName: actorName(actor), revokeReason: "admin" }).where(eq(manualVerificationCodes.id, id));
    return { success: true };
  });
}

export async function listManualVerifications(adminId: number) {
  const db = await getDb();
  if (!db) throw new ManualAuthError("قاعدة البيانات غير متاحة الآن.", "INTERNAL_SERVER_ERROR");
  await requireAdmin(db, adminId);
  const rows = await db.select({ id: manualVerificationCodes.id, email: manualVerificationCodes.email, purpose: manualVerificationCodes.purpose,
    issuedBy: manualVerificationCodes.issuedBy, issuedByName: manualVerificationCodes.issuedByName, createdAt: manualVerificationCodes.createdAt,
    expiresAt: manualVerificationCodes.expiresAt, maxAttempts: manualVerificationCodes.maxAttempts, attemptCount: manualVerificationCodes.attemptCount,
    usedAt: manualVerificationCodes.usedAt, lockedAt: manualVerificationCodes.lockedAt, revokedAt: manualVerificationCodes.revokedAt,
    revokedByName: manualVerificationCodes.revokedByName, revokeReason: manualVerificationCodes.revokeReason,
    ownershipMethod: manualVerificationCodes.ownershipMethod, ownershipCaseRef: manualVerificationCodes.ownershipCaseRef,
  }).from(manualVerificationCodes).orderBy(desc(manualVerificationCodes.createdAt)).limit(100);
  const now = Date.now();
  return rows.map((row: any) => ({ ...row, status: row.revokedAt ? "revoked" as const : row.usedAt ? "used" as const : row.lockedAt ? "locked" as const : row.expiresAt.getTime() <= now ? "expired" as const : "active" as const }));
}

/** Exchange only for an existing manual-auth grant; there is no universal code or privileged session. */
export async function redeemManualVerification(raw: unknown) {
  const input = redeemManualVerificationSchema.parse(raw);
  const db = await getDb();
  if (!db) throw new ManualAuthError("قاعدة البيانات غير متاحة الآن.", "INTERNAL_SERVER_ERROR");
  const result = await db.transaction(async (tx: any) => {
    const failure = { error: "الرمز غير صحيح أو منتهي الصلاحية أو غير متاح لهذا الطلب." };
    // The user-facing flow does not receive an issue/order ID. The optional ID
    // supports older clients, while the new path finds the newest active code
    // within the submitted, normalized email+purpose scope.
    const scope = input.id
      ? (await tx.select({ email: manualVerificationCodes.email, purpose: manualVerificationCodes.purpose }).from(manualVerificationCodes).where(eq(manualVerificationCodes.id, input.id)).limit(1))[0]
      : { email: input.email, purpose: input.purpose };
    if (!scope) return failure;
    await lockOtpScope(tx, scope.email, scope.purpose, secret());
    const now = new Date();
    const eligible = and(eq(manualVerificationCodes.email, input.email), eq(manualVerificationCodes.purpose, input.purpose),
      isNull(manualVerificationCodes.revokedAt), isNull(manualVerificationCodes.usedAt), isNull(manualVerificationCodes.lockedAt),
      gt(manualVerificationCodes.expiresAt, now));
    const [row] = input.id
      ? await tx.select().from(manualVerificationCodes).where(eq(manualVerificationCodes.id, input.id)).for("update").limit(1)
      : await tx.select().from(manualVerificationCodes).where(eligible).orderBy(desc(manualVerificationCodes.createdAt), desc(manualVerificationCodes.id)).for("update").limit(1);
    if (!row || row.revokedAt || row.usedAt || row.lockedAt || row.expiresAt.getTime() <= now.getTime() || row.attemptCount >= row.maxAttempts) return failure;
    const valid = input.email === row.email && input.purpose === row.purpose && constantTimeHexEqual(row.codeHash, digest(row.id, row.email, row.purpose, input.code));
    if (!valid) {
      const attempts = row.attemptCount + 1;
      await tx.update(manualVerificationCodes).set({ attemptCount: attempts, lockedAt: attempts >= row.maxAttempts ? now : null }).where(eq(manualVerificationCodes.id, row.id));
      return failure;
    }
    // Recheck the target and its role, even if account data changed after the admin's review.
    if (row.email === ADMIN_EMAIL) return failure;
    const matches = await matchesEmail(tx, row.email);
    if (row.purpose === "register") {
      if (row.userId !== null || matches.length !== 0 || !row.phoneNormalized || (await findUsersByPhone(tx, row.phoneNormalized)).length) return failure;
    } else if (matches.length !== 1 || matches[0].id !== row.userId || matches[0].role !== "user" || matches[0].status !== "active") return failure;
    const grantToken = createOpaqueGrant();
    await tx.insert(authEmailChallenges).values({ id: row.id, email: row.email, purpose: row.purpose, userId: row.userId,
      phoneNormalized: row.phoneNormalized, codeHash: digest(row.id, row.email, row.purpose, randomBytes(32).toString("hex")),
      codeExpiresAt: row.expiresAt, codeConsumedAt: now, grantHash: hashOpaqueGrant(grantToken),
      grantExpiresAt: new Date(Math.min(row.expiresAt.getTime(), now.getTime() + 10 * 60_000)) });
    await tx.update(manualVerificationCodes).set({ usedAt: now }).where(eq(manualVerificationCodes.id, row.id));
    return { challengeId: row.id, grantToken, nextStep: row.purpose === "register" ? "register" as const : "reset" as const };
  });
  if ("error" in result) throw new ManualAuthError(result.error);
  return result;
}
