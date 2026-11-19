import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { and, desc, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import { adminCreatedAccountEvents, adminImmediateAccounts } from "../drizzle/admin-created-accounts-schema";
import { authDeviceSessions, authPasswordCredentials } from "../drizzle/auth-schema";
import { users, wallets } from "../drizzle/schema";
import { ADMIN_EMAIL } from "../shared/admin";
import { adminImmediateCreateSchema, adminImmediatePasswordSchema, adminImmediateState, type AdminImmediateAccountView } from "../shared/admin-immediate-accounts";
import { normalizePhoneNumber } from "../shared/registration";
import { AdminCreatedAccountError } from "./admin-created-accounts";
import { getDb } from "./db";
import { hashPassword, verifyPassword } from "./manual-auth-crypto";

// These markers distinguish administrative credentials without asserting verified email.
export const ADMIN_PASSWORD_PENDING = "admin_password_pending";
export const ADMIN_PASSWORD_COMPLETE = "admin_password";
const CHALLENGE_TTL_MS = 10 * 60 * 1000;
const MAX_INITIAL_ATTEMPTS = 5;
const INITIAL_LOCK_MS = 15 * 60 * 1000;
const digest = (token: string) => createHash("sha256").update(token).digest("hex");
const failure = () => new AdminCreatedAccountError("انتهت صلاحية طلب تعيين كلمة المرور أو استُخدم؛ أعد تسجيل الدخول.", "FORBIDDEN");
const isDuplicate = (error: unknown): boolean => {
  const e = error as { code?: string; errno?: number; cause?: unknown } | null;
  return Boolean(e && (e.code === "ER_DUP_ENTRY" || e.errno === 1062 || (e.cause && isDuplicate(e.cause))));
};
async function database() {
  const db = await getDb();
  if (!db) throw new AdminCreatedAccountError("قاعدة البيانات غير متاحة.", "INTERNAL_SERVER_ERROR");
  return db;
}
async function administrator(tx: any, actorId: number) {
  const [actor] = await tx.select({ id: users.id, name: users.name, role: users.role, status: users.status, email: users.email, normalized: users.emailNormalized })
    .from(users).where(eq(users.id, actorId)).for("update").limit(1);
  if (!actor || actor.status !== "active" || actor.role !== "admin" || (actor.normalized ?? actor.email)?.trim().toLowerCase() !== ADMIN_EMAIL) {
    throw new AdminCreatedAccountError("هذه العملية متاحة للمدير المخول فقط.", "FORBIDDEN");
  }
  return { id: actor.id as number, name: (actor.name?.trim() || `مسؤول #${actor.id}`).slice(0, 160) as string };
}
async function audit(tx: any, id: string, actorId: number | null, actorName: string, action: string, now: Date) {
  await tx.insert(adminCreatedAccountEvents).values({ requestId: id, actorId, actorName, event: action, createdAt: now });
}
async function emailTaken(tx: any, email: string) {
  const rows = await tx.select({ id: users.id }).from(users)
    .where(or(eq(users.emailNormalized, email), sql`LOWER(TRIM(${users.email})) = ${email}`)).limit(1);
  return rows.length > 0;
}
async function phoneTaken(tx: any, phone: string) {
  const rows = await tx.select({ number: users.phoneNumber, normalized: users.phoneNormalized }).from(users)
    .where(or(eq(users.phoneNormalized, phone), isNotNull(users.phoneNumber)));
  return rows.some((row: { number: string | null; normalized: string | null }) =>
    (row.normalized && normalizePhoneNumber(row.normalized) === phone) || (row.number && normalizePhoneNumber(row.number) === phone));
}

/** Creates a real user, credential, empty wallet and audit event atomically; never sends email. */
export async function createImmediateAdminAccount(actorId: number, raw: unknown) {
  const input = adminImmediateCreateSchema.parse(raw);
  if (input.email === ADMIN_EMAIL) throw new AdminCreatedAccountError("لا يمكن استخدام بريد المدير لهذا الحساب.", "FORBIDDEN");
  const passwordHash = await hashPassword(input.password);
  const db = await database();
  try {
    return await db.transaction(async (tx: any) => {
      const actor = await administrator(tx, actorId);
      if (await emailTaken(tx, input.email)) throw new AdminCreatedAccountError("هذا البريد مرتبط بحساب قائم.", "CONFLICT");
      if (await phoneTaken(tx, input.phoneNumber)) throw new AdminCreatedAccountError("رقم الهاتف مستخدم بالفعل.", "CONFLICT");
      const now = new Date();
      const id = randomUUID();
      const openId = `manual:${randomUUID()}`;
      const names = input.name.split(" ");
      let customerId: string | undefined;
      for (let attempt = 0; attempt < 12; attempt++) {
        try {
          customerId = randomInt(1, 10_000_000_000).toString().padStart(10, "0");
          await tx.insert(users).values({ openId, customerId, name: input.name, givenName: names[0], fatherName: names.slice(1).join(" "), email: input.email, emailNormalized: input.email, phoneNumber: input.phoneNumber, phoneNormalized: input.phoneNumber, birthDate: input.birthDate, governorate: input.governorate, profileCompletedAt: now, loginMethod: ADMIN_PASSWORD_PENDING, role: "user", status: "active", lastSignedIn: now });
          break;
        } catch (error) {
          customerId = undefined;
          if (!isDuplicate(error)) throw error;
          if (await emailTaken(tx, input.email) || await phoneTaken(tx, input.phoneNumber)) throw new AdminCreatedAccountError("البريد أو الهاتف مرتبط بحساب قائم.", "CONFLICT");
        }
      }
      if (!customerId) throw new AdminCreatedAccountError("تعذر إصدار رقم عميل فريد الآن.", "INTERNAL_SERVER_ERROR");
      const [user] = await tx.select({ id: users.id }).from(users).where(eq(users.openId, openId)).limit(1);
      if (!user) throw new AdminCreatedAccountError("تعذر إكمال إنشاء الحساب.", "INTERNAL_SERVER_ERROR");
      await tx.insert(authPasswordCredentials).values({ userId: user.id, passwordHash, emailVerifiedAt: null, phoneVerifiedAt: null });
      await tx.insert(wallets).values({ userId: user.id });
      await tx.insert(adminImmediateAccounts).values({ id, userId: user.id, createdById: actor.id, createdByName: actor.name, createdAt: now });
      await audit(tx, id, actor.id, actor.name, "admin_account_created", now);
      return { id, customerId };
    });
  } catch (error) {
    if (isDuplicate(error)) throw new AdminCreatedAccountError("البريد أو الهاتف مرتبط بحساب قائم.", "CONFLICT");
    throw error;
  }
}

export async function listImmediateAdminAccounts(actorId: number): Promise<AdminImmediateAccountView[]> {
  const db = await database();
  return db.transaction(async (tx: any) => {
    await administrator(tx, actorId);
    const rows = await tx.select({ id: adminImmediateAccounts.id, customerId: users.customerId, name: users.name, email: users.email, phoneNumber: users.phoneNumber, createdByName: adminImmediateAccounts.createdByName, createdAt: adminImmediateAccounts.createdAt, firstLoginAt: adminImmediateAccounts.firstLoginAt, passwordChangedAt: adminImmediateAccounts.passwordChangedAt })
      .from(adminImmediateAccounts).innerJoin(users, eq(users.id, adminImmediateAccounts.userId)).orderBy(desc(adminImmediateAccounts.createdAt));
    return rows.map((row: any) => ({ ...row, state: adminImmediateState(row.firstLoginAt, row.passwordChangedAt) }));
  });
}

/** Revalidates the supplied password under lock: no full session is issued at this step. */
export async function beginInitialPasswordChange(userId: number, password: string) {
  const db = await database();
  const result = await db.transaction(async (tx: any) => {
    const [user] = await tx.select({ id: users.id, name: users.name, status: users.status, loginMethod: users.loginMethod }).from(users).where(eq(users.id, userId)).for("update").limit(1);
    const [credential] = await tx.select().from(authPasswordCredentials).where(eq(authPasswordCredentials.userId, userId)).for("update").limit(1);
    const [record] = await tx.select().from(adminImmediateAccounts).where(eq(adminImmediateAccounts.userId, userId)).for("update").limit(1);
    if (!user || user.status !== "active" || user.loginMethod !== ADMIN_PASSWORD_PENDING || !record || record.passwordChangedAt || !credential) throw failure();
    const now = new Date();
    if (record.loginLockedUntil && record.loginLockedUntil.getTime() > now.getTime()) return null;
    if (!(await verifyPassword(password, credential.passwordHash))) {
      const attempts = record.loginLockedUntil ? 1 : record.failedLoginAttempts + 1;
      await tx.update(adminImmediateAccounts).set({ failedLoginAttempts: attempts, loginLockedUntil: attempts >= MAX_INITIAL_ATTEMPTS ? new Date(now.getTime() + INITIAL_LOCK_MS) : null }).where(eq(adminImmediateAccounts.id, record.id));
      if (attempts === MAX_INITIAL_ATTEMPTS) await audit(tx, record.id, null, "محاولات دخول", "initial_login_locked", now);
      return null;
    }
    const challengeToken = randomBytes(32).toString("base64url");
    await tx.update(adminImmediateAccounts).set({ firstLoginAt: record.firstLoginAt ?? now, challengeHash: digest(challengeToken), challengeExpiresAt: new Date(now.getTime() + CHALLENGE_TTL_MS), failedLoginAttempts: 0, loginLockedUntil: null }).where(eq(adminImmediateAccounts.id, record.id));
    if (!record.firstLoginAt) await audit(tx, record.id, user.id, "العميل", "first_login", now);
    await tx.update(users).set({ lastSignedIn: now }).where(eq(users.id, userId));
    return { app_session_id: null, requiresInitialPassword: true as const, challengeToken };
  });
  if (!result) throw new AdminCreatedAccountError("البريد الإلكتروني أو كلمة المرور غير صحيحة، أو المحاولات موقوفة مؤقتًا.", "FORBIDDEN");
  return result;
}

/** The short-lived opaque challenge authorizes only this one change, never other endpoints. */
export async function completeInitialPasswordChange(raw: unknown) {
  const input = adminImmediatePasswordSchema.parse(raw);
  const db = await database();
  const challengeHash = digest(input.challengeToken);
  const [candidate] = await db.select({ userId: adminImmediateAccounts.userId }).from(adminImmediateAccounts).where(eq(adminImmediateAccounts.challengeHash, challengeHash)).limit(1);
  if (!candidate) throw failure();
  const nextHash = await hashPassword(input.password);
  return db.transaction(async (tx: any) => {
    const [user] = await tx.select({ id: users.id, status: users.status, loginMethod: users.loginMethod }).from(users).where(eq(users.id, candidate.userId)).for("update").limit(1);
    const [credential] = await tx.select().from(authPasswordCredentials).where(eq(authPasswordCredentials.userId, candidate.userId)).for("update").limit(1);
    const [record] = await tx.select().from(adminImmediateAccounts).where(eq(adminImmediateAccounts.userId, candidate.userId)).for("update").limit(1);
    const now = new Date();
    if (!user || user.status !== "active" || user.loginMethod !== ADMIN_PASSWORD_PENDING || !credential || !record || record.passwordChangedAt || record.challengeHash !== challengeHash || !record.challengeExpiresAt || record.challengeExpiresAt.getTime() <= now.getTime()) throw failure();
    if (await verifyPassword(input.password, credential.passwordHash)) throw new AdminCreatedAccountError("اختر كلمة مرور جديدة مختلفة عن كلمة المرور المبدئية.");
    await tx.update(authPasswordCredentials).set({ passwordHash: nextHash }).where(eq(authPasswordCredentials.userId, user.id));
    await tx.update(users).set({ loginMethod: ADMIN_PASSWORD_COMPLETE }).where(eq(users.id, user.id));
    await tx.update(adminImmediateAccounts).set({ passwordChangedAt: now, challengeHash: null, challengeExpiresAt: null }).where(eq(adminImmediateAccounts.id, record.id));
    await tx.update(authDeviceSessions).set({ revokedAt: now, revokeReason: "تغيير كلمة المرور الأولي" }).where(and(eq(authDeviceSessions.userId, user.id), isNull(authDeviceSessions.revokedAt)));
    await audit(tx, record.id, user.id, "العميل", "password_changed", now);
    return { success: true as const };
  });
}
