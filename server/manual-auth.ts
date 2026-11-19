import { and, eq, gt, inArray, isNotNull, like, lt, or, sql } from "drizzle-orm";
import { createHmac, randomInt, randomUUID } from "node:crypto";
import nodemailer from "nodemailer";
import { authDeviceSessions, authEmailChallenges, authPasswordCredentials, authSupportSessions } from "../drizzle/auth-schema";
import { appSettings, guestSupportSessions, guestSupportTickets, users, wallets, type User } from "../drizzle/schema";
import { ADMIN_EMAIL } from "../shared/admin";
import {
  emailAddressSchema,
  manualRegistrationSchema,
  normalizeEmail,
  normalizePhoneNumber,
  phoneNumberSchema,
  type ParsedManualRegistration,
} from "../shared/registration";
import { ONE_YEAR_MS } from "../shared/const.js";
import { getDb } from "./db";
import { maskNationalId } from "./profile-data";
import { createOpaqueGrant, hashEmailOtp, hashOpaqueGrant, constantTimeHexEqual, verifyPassword, hashPassword } from "./manual-auth-crypto";
import { completeLoginChallenge, deviceMeta, hasTrustedDevice, issueLoginChallenge, registerDeviceSession, revokeAllDeviceSessions, type DeviceMeta } from "./session-management";
import { manualGrantAllowed } from "./manual-verification-guard";
import { invalidatePreviousOtpIssues, lockOtpScope } from "./manual-otp-scope";
import { ADMIN_PASSWORD_COMPLETE, ADMIN_PASSWORD_PENDING, beginInitialPasswordChange } from "./admin-immediate-accounts";
import { AdminCreatedAccountError } from "./admin-created-accounts";
const OTP_SENDER_EMAIL = "dyblhwyty@gmail.com";
const OTP_TTL_MS = 10 * 60 * 1000;
const GRANT_TTL_MS = 10 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;
const MAX_CODES_PER_EMAIL = 3;
const EMAIL_RATE_WINDOW_MS = 15 * 60 * 1000;
const OTP_RATE_LIMIT_KEY_PREFIX = "otp_rl:";
const OTP_RATE_LIMIT_STALE_MS = 24 * 60 * 60 * 1000;
let lastOtpRateLimitCleanupAt = 0;
const MAX_CUSTOMER_ID_ATTEMPTS = 8;

type AuthErrorCode = "BAD_REQUEST" | "CONFLICT" | "TOO_MANY_REQUESTS" | "INTERNAL_SERVER_ERROR" | "UNAUTHORIZED";

export class ManualAuthError extends Error {
  constructor(message: string, readonly code: AuthErrorCode = "BAD_REQUEST") {
    super(message);
    this.name = "ManualAuthError";
  }
}

export function toPublicAuthUser(user: User) {
  return {
    id: user.id,
    openId: user.openId,
    customerId: user.customerId,
    name: user.name,
    email: user.email,
    givenName: user.givenName,
    fatherName: user.fatherName,
    phoneNumber: user.phoneNumber,
    phoneVerifiedAt: user.phoneVerifiedAt,
    birthDate: user.birthDate,
    governorate: user.governorate,
    nationalIdMasked: maskNationalId(user.nationalIdLast4),
    profileCompletedAt: user.profileCompletedAt,
    loginMethod: user.loginMethod,
    lastSignedIn: user.lastSignedIn,
    role: user.role,
  };
}

function findUsersByEmail(queryable: any, email: string) {
  return queryable
    .select()
    .from(users)
    .where(or(eq(users.emailNormalized, email), sql`LOWER(${users.email}) = ${email}`))
    .limit(3);
}

export async function findUsersByPhone(queryable: any, phone: string): Promise<Array<{ id: number }>> {
  const candidates = await queryable
    .select({ id: users.id, phoneNumber: users.phoneNumber, phoneNormalized: users.phoneNormalized })
    .from(users)
    .where(or(eq(users.phoneNormalized, phone), isNotNull(users.phoneNumber)));
  return candidates
    .filter((row: { phoneNumber: string | null; phoneNormalized: string | null }) => {
      const stored = row.phoneNormalized ?? row.phoneNumber;
      return Boolean(stored && normalizePhoneNumber(stored) === phone);
    })
    .slice(0, 2)
    .map((row: { id: number }) => ({ id: row.id }));
}

function requireMailerPassword(): string {
  const password = process.env.AUTH_OTP_APP_PASSWORD?.replace(/\s+/g, "");
  if (!password) {
    throw new ManualAuthError(
      "إرسال رمز التحقق غير مهيأ بعد؛ يلزم حفظ اعتماد البريد بأمان في إعدادات المشروع.",
      "INTERNAL_SERVER_ERROR",
    );
  }
  return password;
}

/** Sends application mail through the configured Gmail transport without exposing credentials. */
export async function sendConfiguredEmail(to: string, subject: string, text: string): Promise<void> {
  const password = requireMailerPassword();
  const transport = nodemailer.createTransport({
    host: "smtp.gmail.com", port: 465, secure: true,
    auth: { user: OTP_SENDER_EMAIL, pass: password },
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000,
  });
  try {
    await transport.sendMail({ from: `Flotex EGP <${OTP_SENDER_EMAIL}>`, to, subject, text });
  } finally {
    transport.close();
  }
}

async function sendEmailCode(email: string, code: string, purpose: "register" | "password_reset" | "account_support" | "guest_support") {
  const password = requireMailerPassword();
  const transport = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: OTP_SENDER_EMAIL, pass: password },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
  try {
    await transport.sendMail({
      from: `Flotex EGP <${OTP_SENDER_EMAIL}>`,
      to: email,
      subject: purpose === "register" ? "رمز تأكيد حساب Flotex EGP" : purpose === "password_reset" ? "رمز استعادة كلمة مرور Flotex EGP" : "رمز تواصل آمن مع دعم Flotex EGP",
      text: `رمز التحقق الخاص بك هو: ${code}\n\nتنتهي صلاحيته خلال 10 دقائق. لا تشارك الرمز مع أي شخص. إذا لم تطلبه فتجاهل هذه الرسالة.`,
    });
  } catch {
    throw new ManualAuthError("تعذر إرسال رمز التحقق إلى البريد الإلكتروني. حاول لاحقًا.", "INTERNAL_SERVER_ERROR");
  } finally {
    transport.close();
  }
}

function getOtpVerificationSecret(): string {
  const verificationSecret = process.env.APP_VERIFICATION_SECRET ?? process.env.MANUS_JWT_SECRET;
  if (!verificationSecret) {
    throw new ManualAuthError("مفتاح التحقق البريدي غير مهيأ بأمان على الخادم.", "INTERNAL_SERVER_ERROR");
  }
  return verificationSecret;
}

function challengeDigest(id: string, email: string, purpose: string, code: string): string {
  return hashEmailOtp(getOtpVerificationSecret(), id, email, purpose, code);
}

type OtpRateAttempt = { id: string; timestamp: number };
type OtpRateReservation = { id: string; keys: string[] };

function makeOtpRateLimitKey(scope: "email" | "phone", value: string): string {
  const digest = createHmac("sha256", getOtpVerificationSecret()).update(`${scope}:${value}`).digest("hex");
  return `${OTP_RATE_LIMIT_KEY_PREFIX}${scope}:${digest}`;
}

function parseOtpRateAttempts(value: string): OtpRateAttempt[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is OtpRateAttempt =>
      typeof item === "object" && item !== null &&
      "id" in item && typeof item.id === "string" &&
      "timestamp" in item && typeof item.timestamp === "number" && Number.isFinite(item.timestamp),
    );
  } catch {
    return [];
  }
}

function cleanupStaleOtpRateLimitRows(db: any) {
  const now = Date.now();
  if (now - lastOtpRateLimitCleanupAt < 60 * 60 * 1000) return;
  lastOtpRateLimitCleanupAt = now;
  void db.delete(appSettings).where(and(
    like(appSettings.key, `${OTP_RATE_LIMIT_KEY_PREFIX}%`),
    lt(appSettings.updatedAt, new Date(now - OTP_RATE_LIMIT_STALE_MS)),
  )).catch((error: unknown) => {
    lastOtpRateLimitCleanupAt = 0;
    console.warn("[manual-auth] OTP rate-limit cleanup failed", error instanceof Error ? error.name : "unknown");
  });
}

async function reserveEmailRateLimit(db: any, email: string, phone: string | null): Promise<OtpRateReservation> {
  const now = Date.now();
  const cutoff = now - EMAIL_RATE_WINDOW_MS;
  const reservation = { id: randomUUID(), keys: [makeOtpRateLimitKey("email", email)] };
  const phoneKey = phone ? makeOtpRateLimitKey("phone", phone) : null;
  if (phoneKey) reservation.keys.push(phoneKey);
  reservation.keys.sort();

  await db.transaction(async (tx: any) => {
    for (const key of reservation.keys) {
      await tx.insert(appSettings).values({ key, value: "[]" })
        .onDuplicateKeyUpdate({ set: { updatedAt: sql`CURRENT_TIMESTAMP` } });
    }
    const rows = await tx.select({ key: appSettings.key, value: appSettings.value })
      .from(appSettings)
      .where(inArray(appSettings.key, reservation.keys))
      .orderBy(appSettings.key)
      .for("update");
    const attemptsByKey = new Map<string, OtpRateAttempt[]>();
    for (const row of rows as Array<{ key: string; value: string }>) {
      attemptsByKey.set(row.key, parseOtpRateAttempts(row.value).filter((attempt) => attempt.timestamp > cutoff));
    }
    const emailKey = makeOtpRateLimitKey("email", email);
    if ((attemptsByKey.get(emailKey)?.length ?? 0) >= MAX_CODES_PER_EMAIL) {
      throw new ManualAuthError("تم طلب رموز كثيرة لهذا البريد. انتظر قليلًا ثم حاول مجددًا.", "TOO_MANY_REQUESTS");
    }
    if (phoneKey && (attemptsByKey.get(phoneKey)?.length ?? 0) >= MAX_CODES_PER_EMAIL) {
      throw new ManualAuthError("تم طلب رموز كثيرة لهذه البيانات. انتظر قليلًا ثم حاول مجددًا.", "TOO_MANY_REQUESTS");
    }

    for (const key of reservation.keys) {
      const attempts = attemptsByKey.get(key) ?? [];
      attempts.push({ id: reservation.id, timestamp: now });
      await tx.update(appSettings).set({ value: JSON.stringify(attempts) }).where(eq(appSettings.key, key));
    }
  });

  cleanupStaleOtpRateLimitRows(db);
  return reservation;
}

async function releaseEmailRateLimit(db: any, reservation: OtpRateReservation) {
  const cutoff = Date.now() - EMAIL_RATE_WINDOW_MS;
  await db.transaction(async (tx: any) => {
    const rows = await tx.select({ key: appSettings.key, value: appSettings.value })
      .from(appSettings)
      .where(inArray(appSettings.key, reservation.keys))
      .orderBy(appSettings.key)
      .for("update");
    for (const row of rows as Array<{ key: string; value: string }>) {
      const attempts = parseOtpRateAttempts(row.value).filter(
        (attempt) => attempt.id !== reservation.id && attempt.timestamp > cutoff,
      );
      await tx.update(appSettings).set({ value: JSON.stringify(attempts) }).where(eq(appSettings.key, row.key));
    }
  });
}

export async function issueEmailCode(input: {
  email: string;
  purpose: "register" | "password_reset" | "account_support" | "guest_support";
  phoneNumber?: string;
  customerId?: string;
}) {
  const email = emailAddressSchema.parse(input.email);
  const db = await getDb();
  if (!db) throw new ManualAuthError("قاعدة البيانات غير متاحة الآن.", "INTERNAL_SERVER_ERROR");

  const phone = input.purpose === "register" ? phoneNumberSchema.parse(input.phoneNumber ?? "") : null;
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  await db.delete(authEmailChallenges).where(lt(authEmailChallenges.codeExpiresAt, cutoff));

  let targetUserId: number | null = null;
  const existingUsers = await findUsersByEmail(db, email);
  if (existingUsers.length > 1) {
    throw new ManualAuthError("تعذر إكمال الطلب لهذا البريد. يلزم مراجعة سجلات الحساب أولًا.", "CONFLICT");
  }
  if (existingUsers.length === 1) {
    const existing = existingUsers[0] as User;
    if (input.purpose === "account_support") {
      if (!/^\d{10}$/.test(input.customerId ?? "")) throw new ManualAuthError("بيانات الحساب غير صالحة.");
      if (existing.status === "deleted" && existing.customerId === input.customerId) targetUserId = existing.id;
    } else if (input.purpose === "password_reset" && existing.status !== "deleted") {
      targetUserId = existing.id;
    } else if (input.purpose === "register") {
      targetUserId = existing.id;
    }
  }

  if (input.purpose === "register" && phone) {
    const phoneMatches = await findUsersByPhone(db, phone);
    if (phoneMatches.length) {
      throw new ManualAuthError("رقم الهاتف مستخدم بالفعل. إذا كان لديك حساب سابق فاختر استعادة كلمة المرور.", "CONFLICT");
    }
  }

  const challengeId = randomUUID();
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  // Reset requests for unknown emails create indistinguishable, unfinishable challenges and send no mail.
  const shouldSend = input.purpose === "register" || input.purpose === "guest_support" || targetUserId !== null;
  const codeHash = challengeDigest(challengeId, email, input.purpose, code);
  const reservation = await reserveEmailRateLimit(db, email, phone);
  try {
    await db.transaction(async (tx: any) => {
      await lockOtpScope(tx, email, input.purpose, getOtpVerificationSecret());
      const now = new Date();
      await invalidatePreviousOtpIssues(tx, email, input.purpose, now, null);
      await tx.insert(authEmailChallenges).values({
        id: challengeId,
        email,
        purpose: input.purpose,
        userId: targetUserId,
        phoneNormalized: phone,
        codeHash,
        codeExpiresAt: new Date(now.getTime() + OTP_TTL_MS),
      });
      // Roll back the insertion AND replacement on delivery failure. The lock
      // also prevents a concurrent issuer from committing out of order.
      if (shouldSend) await sendEmailCode(email, code, input.purpose);
    });
  } catch (error) {
    try {
      await releaseEmailRateLimit(db, reservation);
    } catch (releaseError) {
      console.error("[manual-auth] failed to release OTP rate reservation", releaseError instanceof Error ? releaseError.name : "unknown");
    }
    throw error;
  }
  return { challengeId, expiresInSeconds: OTP_TTL_MS / 1000 };
}

export async function verifyEmailCode(input: { challengeId: string; code: string; guestTicketId?: number }) {
  const db = await getDb();
  if (!db) throw new ManualAuthError("قاعدة البيانات غير متاحة الآن.", "INTERNAL_SERVER_ERROR");
  const result = await db.transaction(async (tx: any) => {
    const [challenge] = await tx
      .select()
      .from(authEmailChallenges)
      .where(eq(authEmailChallenges.id, input.challengeId))
      .for("update")
      .limit(1);
    const now = new Date();
    if (
      !challenge ||
      challenge.codeConsumedAt ||
      challenge.codeExpiresAt.getTime() <= now.getTime() ||
      challenge.attemptCount >= MAX_OTP_ATTEMPTS
    ) {
      return { error: "انتهت صلاحية الرمز أو تم استخدامه. اطلب رمزًا جديدًا." };
    }
    const submitted = challengeDigest(challenge.id, challenge.email, challenge.purpose, input.code);
    if (!constantTimeHexEqual(challenge.codeHash, submitted)) {
      const nextAttempts = challenge.attemptCount + 1;
      await tx.update(authEmailChallenges).set({
        attemptCount: nextAttempts,
        codeConsumedAt: nextAttempts >= MAX_OTP_ATTEMPTS ? now : null,
      }).where(eq(authEmailChallenges.id, challenge.id));
      return { error: nextAttempts >= MAX_OTP_ATTEMPTS ? "تم إيقاف الرمز بعد محاولات غير صحيحة. اطلب رمزًا جديدًا." : "رمز التحقق غير صحيح." };
    }

    if (challenge.purpose === "guest_support") {
      if (!input.guestTicketId) return { error: "تعذر تحديد تذكرة الدعم؛ اطلب رمزًا جديدًا." };
      const [ticket] = await tx.select().from(guestSupportTickets).where(and(eq(guestSupportTickets.id, input.guestTicketId), eq(guestSupportTickets.otpChallengeId, challenge.id))).for("update").limit(1);
      if (!ticket || ticket.contactEmail !== challenge.email) return { error: "لا تتطابق بيانات التذكرة مع البريد الذي استُخدم لطلب الرمز." };
      const supportToken = createOpaqueGrant();
      await tx.insert(guestSupportSessions).values({ id: randomUUID(), ticketId: ticket.id, tokenHash: hashOpaqueGrant(supportToken), expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000) });
      await tx.update(guestSupportTickets).set({ verifiedAt: now }).where(eq(guestSupportTickets.id, ticket.id));
      await tx.update(authEmailChallenges).set({ codeConsumedAt: now, grantConsumedAt: now }).where(eq(authEmailChallenges.id, challenge.id));
      return { guestSupportToken: supportToken, ticketCode: ticket.ticketCode, nextStep: "guest_support" as const, expiresInSeconds: 30 * 24 * 60 * 60 };
    }

    if (challenge.purpose === "account_support") {
      if (!challenge.userId) return { error: "تعذر مطابقة بيانات الحساب؛ راجع الرقم والبريد واطلب رمزًا جديدًا." };
      const [account] = await tx.select({ id: users.id, role: users.role, status: users.status }).from(users).where(eq(users.id, challenge.userId)).for("update").limit(1);
      if (!account || account.role !== "user" || account.status !== "deleted") return { error: "قناة الدعم غير متاحة لهذا الحساب." };
      const supportToken = createOpaqueGrant();
      await tx.insert(authSupportSessions).values({ id: randomUUID(), userId: account.id, tokenHash: hashOpaqueGrant(supportToken), expiresAt: new Date(now.getTime() + 30 * 60 * 1000) });
      await tx.update(authEmailChallenges).set({ codeConsumedAt: now, grantConsumedAt: now }).where(eq(authEmailChallenges.id, challenge.id));
      return { supportToken, nextStep: "support" as const, expiresInSeconds: 30 * 60 };
    }

    const grantToken = createOpaqueGrant();
    await tx.update(authEmailChallenges).set({
      codeConsumedAt: now,
      grantHash: hashOpaqueGrant(grantToken),
      grantExpiresAt: new Date(now.getTime() + GRANT_TTL_MS),
    }).where(eq(authEmailChallenges.id, challenge.id));
    const nextStep = challenge.userId || challenge.purpose === "password_reset" ? "reset" : "register";
    return { grantToken, nextStep };
  });
  if ("error" in result && result.error) throw new ManualAuthError(result.error);
  return result;
}

function newCustomerId() {
  return randomInt(1, 10_000_000_000).toString().padStart(10, "0");
}

function grantHashMatches(challenge: any, grantToken: string, now: Date) {
  const presentedHash = hashOpaqueGrant(grantToken);
  return Boolean(
    challenge &&
    challenge.grantHash &&
    !challenge.grantConsumedAt &&
    challenge.grantExpiresAt &&
    challenge.grantExpiresAt.getTime() > now.getTime() &&
    constantTimeHexEqual(challenge.grantHash, presentedHash),
  );
}

export async function registerManualAccount(input: ParsedManualRegistration, challengeId: string, grantToken: string) {
  const registration = manualRegistrationSchema.parse(input);
  const email = normalizeEmail(registration.email);
  const phone = normalizePhoneNumber(registration.phoneNumber);
  const passwordHash = await hashPassword(registration.password);
  const db = await getDb();
  if (!db) throw new ManualAuthError("قاعدة البيانات غير متاحة الآن.", "INTERNAL_SERVER_ERROR");

  const user = await db.transaction(async (tx: any) => {
    const [challenge] = await tx
      .select()
      .from(authEmailChallenges)
      .where(eq(authEmailChallenges.id, challengeId))
      .for("update")
      .limit(1);
    const now = new Date();
    if (!grantHashMatches(challenge, grantToken, now) || challenge.purpose !== "register" || challenge.userId !== null) {
      throw new ManualAuthError("انتهت صلاحية تأكيد البريد أو استُخدم. ابدأ التسجيل من جديد.");
    }
    if (!(await manualGrantAllowed(tx, challenge))) throw new ManualAuthError("تأكيد البريد اليدوي غير متاح لهذا الطلب.");
    if (challenge.email !== email || challenge.phoneNormalized !== phone) {
      throw new ManualAuthError("بيانات التسجيل لا تطابق البريد أو الهاتف اللذين طُلب لهما الرمز.");
    }
    if ((await findUsersByEmail(tx, email)).length) {
      throw new ManualAuthError("هذا البريد مرتبط بحساب قائم. استخدم استعادة كلمة المرور دون إنشاء ملف عميل جديد.", "CONFLICT");
    }
    if ((await findUsersByPhone(tx, phone)).length) {
      throw new ManualAuthError("رقم الهاتف مستخدم بالفعل.", "CONFLICT");
    }

    const words = registration.fullName.split(/\s+/);
    const openId = `manual:${randomUUID()}`;
    let inserted = false;
    for (let attempt = 0; attempt < MAX_CUSTOMER_ID_ATTEMPTS; attempt += 1) {
      try {
        await tx.insert(users).values({
          openId,
          customerId: newCustomerId(),
          name: registration.fullName,
          email,
          emailNormalized: email,
          givenName: words[0],
          fatherName: words.slice(1).join(" "),
          phoneNumber: phone,
          phoneNormalized: phone,
          birthDate: registration.birthDate,
          governorate: registration.governorate ?? null,
          profileCompletedAt: now,
          loginMethod: "password",
          role: email === ADMIN_EMAIL ? "admin" : "user",
          lastSignedIn: now,
        });
        inserted = true;
        break;
      } catch {
        if ((await findUsersByEmail(tx, email)).length || (await findUsersByPhone(tx, phone)).length) {
          throw new ManualAuthError("البريد الإلكتروني أو رقم الهاتف مستخدم بالفعل.", "CONFLICT");
        }
        if (attempt === MAX_CUSTOMER_ID_ATTEMPTS - 1) {
          throw new ManualAuthError("تعذر إنشاء رقم عميل فريد الآن. حاول مرة أخرى.", "INTERNAL_SERVER_ERROR");
        }
      }
    }
    if (!inserted) throw new ManualAuthError("تعذر إنشاء الحساب الآن.", "INTERNAL_SERVER_ERROR");
    const [createdUser] = await tx.select().from(users).where(eq(users.openId, openId)).limit(1);
    if (!createdUser) throw new ManualAuthError("تعذر قراءة الحساب بعد إنشائه.", "INTERNAL_SERVER_ERROR");
    await tx.insert(authPasswordCredentials).values({
      userId: createdUser.id,
      passwordHash,
      emailVerifiedAt: now,
      phoneVerifiedAt: null,
    });
    if (registration.securityPin) {
      await tx.update(users).set({ securityPinHash: await hashPassword(registration.securityPin), securityPinUpdatedAt: now }).where(eq(users.id, createdUser.id));
    }
    await tx.insert(wallets).values({
      userId: createdUser.id,
      balance: "0.00",
      reservedWithdrawals: "0.00",
      reservedOrders: "0.00",
      reservedTransfers: "0.00",
      profitLoss: "0.00",
      currency: "EGP",
    });
    await tx.update(authEmailChallenges).set({ grantConsumedAt: now }).where(eq(authEmailChallenges.id, challengeId));
    return createdUser as User;
  });
  return createSessionResult(user);
}

async function createSessionResult(user: User, meta?: DeviceMeta) {
  if (user.status !== "active") throw new ManualAuthError("هذا الحساب تم حذفه من تسجيل الدخول. يرجى التواصل مع خدمة العملاء لطلب الاستعادة.", "UNAUTHORIZED");
  if (user.loginMethod === ADMIN_PASSWORD_PENDING) throw new ManualAuthError("يجب تسجيل الدخول بالكلمة المبدئية وتعيين كلمة مرور جديدة أولًا.", "UNAUTHORIZED");
  const token = await import("./_core/sdk").then(({ sdk }) =>
    sdk.createSessionToken(user.openId, { expiresInMs: ONE_YEAR_MS, name: (meta?.deviceName || user.name || "Flotex EGP") }),
  );
  await registerDeviceSession(user.id, token, meta ?? { deviceId: `legacy-${user.id}`, deviceName: "جهاز سابق" });
  const accountFrozen = user.role === "admin" ? false : await import("./account-controls").then(({ isCustomerAccountFrozen }) => isCustomerAccountFrozen(user.id));
  return { app_session_id: token, user: { ...toPublicAuthUser(user), accountFrozen } };
}

/**
 * Refresh an already authenticated device without rotating its one-year token.
 * This keeps the presented credential valid and avoids orphaned valid tokens.
 */
export async function refreshManualSession(user: User, meta?: DeviceMeta, presentedToken?: string) {
  if (user.status !== "active") {
    throw new ManualAuthError("الحساب غير نشط؛ أعد تسجيل الدخول أو تواصل مع الدعم.", "UNAUTHORIZED");
  }
  if (user.loginMethod === ADMIN_PASSWORD_PENDING) throw new ManualAuthError("يجب تعيين كلمة مرور جديدة أولًا.", "UNAUTHORIZED");
  // Never rotate a valid token merely to refresh it: the old token would still
  // be cryptographically valid while its device row no longer matches it.
  // Keep the presented one-year token and only refresh device activity.
  const token = presentedToken || await import("./_core/sdk").then(({ sdk }) =>
    sdk.createSessionToken(user.openId, { expiresInMs: ONE_YEAR_MS, name: (meta?.deviceName || user.name || "Flotex EGP") }),
  );
  if (!token) throw new ManualAuthError("تعذر تجديد الجلسة الآن؛ حاول لاحقًا.", "INTERNAL_SERVER_ERROR");
  await registerDeviceSession(user.id, token, meta ?? { deviceId: `refresh-${user.id}`, deviceName: "جهاز موثوق" });
  return { app_session_id: token, user: toPublicAuthUser(user) };
}

export async function loginManualAccount(input: { email: string; password: string } & DeviceMeta) {
  const email = emailAddressSchema.parse(input.email);
  const db = await getDb();
  if (!db) throw new ManualAuthError("قاعدة البيانات غير متاحة الآن.", "INTERNAL_SERVER_ERROR");
  const matches = await findUsersByEmail(db, email);
  if (matches.length !== 1) {
    throw new ManualAuthError("البريد الإلكتروني أو كلمة المرور غير صحيحة.", "UNAUTHORIZED");
  }
  const user = matches[0] as User;
  const [credentials] = await db.select().from(authPasswordCredentials).where(eq(authPasswordCredentials.userId, user.id)).limit(1);
  if (!credentials || (!credentials.emailVerifiedAt && user.loginMethod !== ADMIN_PASSWORD_PENDING && user.loginMethod !== ADMIN_PASSWORD_COMPLETE)) {
    throw new ManualAuthError("البريد الإلكتروني أو كلمة المرور غير صحيحة.", "UNAUTHORIZED");
  }
  if (user.status !== "active") throw new ManualAuthError("هذا الحساب تم حذفه من تسجيل الدخول. يرجى التواصل مع خدمة العملاء لطلب الاستعادة.", "UNAUTHORIZED");
  if (user.loginMethod === ADMIN_PASSWORD_PENDING) {
    try { return { ...await beginInitialPasswordChange(user.id, input.password), user: toPublicAuthUser(user) }; }
    catch (error) {
      if (error instanceof AdminCreatedAccountError && error.code === "FORBIDDEN") throw new ManualAuthError("البريد الإلكتروني أو كلمة المرور غير صحيحة، أو المحاولات موقوفة مؤقتًا.", "UNAUTHORIZED");
      throw error;
    }
  }
  if (!(await verifyPassword(input.password, credentials.passwordHash))) throw new ManualAuthError("البريد الإلكتروني أو كلمة المرور غير صحيحة.", "UNAUTHORIZED");

  const now = new Date();
  const role = email === ADMIN_EMAIL ? "admin" : "user";
  await db.update(users).set({
    emailNormalized: email,
    loginMethod: user.loginMethod === ADMIN_PASSWORD_COMPLETE ? ADMIN_PASSWORD_COMPLETE : "password",
    lastSignedIn: now,
    role,
  }).where(eq(users.id, user.id));
  const [updated] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
  if (!updated) throw new ManualAuthError("تعذر فتح الحساب الآن.", "INTERNAL_SERVER_ERROR");
  const meta = deviceMeta(input);
  if (updated.securityPinHash && !(await hasTrustedDevice(updated.id, meta))) {
    const challengeToken = await issueLoginChallenge(updated.id, meta);
    return { app_session_id: null, requiresSecurityPin: true as const, challengeToken, user: toPublicAuthUser(updated as User) };
  }
  return createSessionResult(updated as User, meta);
}

export async function completeTrustedDeviceLogin(input: { challengeToken: string; pin: string } & DeviceMeta) {
  const user = await completeLoginChallenge(input.challengeToken, input.pin, input);
  return createSessionResult(user as User, input);
}
export async function resetManualPassword(input: {
  challengeId: string;
  grantToken: string;
  password: string;
  confirmPassword: string;
}) {
  if (input.password !== input.confirmPassword) throw new ManualAuthError("كلمتا المرور غير متطابقتين.");
  if (input.password.length < 12 || input.password.length > 128) throw new ManualAuthError("كلمة المرور يجب أن تكون من 12 إلى 128 حرفًا.");
  const passwordHash = await hashPassword(input.password);
  const db = await getDb();
  if (!db) throw new ManualAuthError("قاعدة البيانات غير متاحة الآن.", "INTERNAL_SERVER_ERROR");

  const user = await db.transaction(async (tx: any) => {
    const [challenge] = await tx
      .select()
      .from(authEmailChallenges)
      .where(eq(authEmailChallenges.id, input.challengeId))
      .for("update")
      .limit(1);
    const now = new Date();
    if (!grantHashMatches(challenge, input.grantToken, now) || challenge.purpose === "register" && challenge.userId === null) {
      throw new ManualAuthError("انتهت صلاحية تأكيد البريد أو استُخدم. اطلب رمزًا جديدًا.");
    }
    if (!(await manualGrantAllowed(tx, challenge))) throw new ManualAuthError("تأكيد البريد اليدوي غير متاح لهذا الحساب.", "UNAUTHORIZED");
    if (!challenge.userId) throw new ManualAuthError("إذا كان الحساب موجودًا، فتابع خطوات الاستعادة من جديد.", "UNAUTHORIZED");
    const [existingUser] = await tx.select().from(users).where(eq(users.id, challenge.userId)).for("update").limit(1);
    if (!existingUser) throw new ManualAuthError("تعذر العثور على ملف العميل المرتبط بهذا البريد.", "UNAUTHORIZED");
    if (existingUser.status !== "active") throw new ManualAuthError("الحساب موقوف؛ لا يمكن استعادة كلمة مروره قبل استعادته من الإدارة.", "UNAUTHORIZED");
    if (existingUser.loginMethod === ADMIN_PASSWORD_PENDING) throw new ManualAuthError("يجب تسجيل الدخول بالكلمة المبدئية وتعيين كلمة مرور جديدة أولًا.", "UNAUTHORIZED");
    if (!(await manualGrantAllowed(tx, challenge, existingUser))) throw new ManualAuthError("تأكيد البريد اليدوي غير متاح لهذا الحساب.", "UNAUTHORIZED");
    const emailMatches = await findUsersByEmail(tx, challenge.email);
    if (emailMatches.length !== 1 || emailMatches[0].id !== existingUser.id) {
      throw new ManualAuthError("تعذر استعادة هذا الحساب بأمان. يلزم مراجعة سجلات الحساب أولًا.", "CONFLICT");
    }
    const [existingCredentials] = await tx.select().from(authPasswordCredentials).where(eq(authPasswordCredentials.userId, existingUser.id)).limit(1);
    if (existingCredentials) {
      await tx.update(authPasswordCredentials).set({ passwordHash, emailVerifiedAt: now }).where(eq(authPasswordCredentials.userId, existingUser.id));
    } else {
      await tx.insert(authPasswordCredentials).values({ userId: existingUser.id, passwordHash, emailVerifiedAt: now, phoneVerifiedAt: null });
    }
    await tx.update(users).set({
      emailNormalized: challenge.email,
      loginMethod: "password",
      lastSignedIn: now,
      role: challenge.email === ADMIN_EMAIL ? "admin" : "user",
      securityPinHash: null,
      securityPinUpdatedAt: null,
    }).where(eq(users.id, existingUser.id));
    await tx.update(authPasswordCredentials)
      .set({ emailVerifiedAt: now })
      .where(eq(authPasswordCredentials.userId, existingUser.id));
    await tx.update(authEmailChallenges).set({ grantConsumedAt: now }).where(eq(authEmailChallenges.id, challenge.id));
    const [updated] = await tx.select().from(users).where(eq(users.id, existingUser.id)).limit(1);
    if (!updated) throw new ManualAuthError("تعذر فتح الحساب بعد التحديث.", "INTERNAL_SERVER_ERROR");
    return updated as User;
  });
  await revokeAllDeviceSessions(user.id, "تغيير كلمة المرور");
  return createSessionResult(user);
}

export async function changeManualPasswordWithEmailCode(userId: number, input: {
  challengeId: string;
  code: string;
  currentPassword: string;
  password: string;
  confirmPassword: string;
}) {
  if (input.password !== input.confirmPassword) throw new ManualAuthError("كلمتا المرور غير متطابقتين.");
  if (input.password.length < 12 || input.password.length > 128) throw new ManualAuthError("كلمة المرور يجب أن تكون من 12 إلى 128 حرفًا.");
  if (input.currentPassword.length < 1 || input.currentPassword.length > 128) throw new ManualAuthError("أدخل كلمة المرور الحالية.");
  const nextHash = await hashPassword(input.password);
  const db = await getDb();
  if (!db) throw new ManualAuthError("قاعدة البيانات غير متاحة الآن.", "INTERNAL_SERVER_ERROR");

  const result = await db.transaction(async (tx: any) => {
    const [user] = await tx.select({ id: users.id, email: users.email, emailNormalized: users.emailNormalized, role: users.role, status: users.status })
      .from(users).where(eq(users.id, userId)).for("update").limit(1);
    if (!user || (user.role !== "user" && user.role !== "admin") || user.status !== "active") {
      throw new ManualAuthError("الحساب غير متاح لتغيير كلمة المرور.", "UNAUTHORIZED");
    }
    const [credential] = await tx.select().from(authPasswordCredentials)
      .where(eq(authPasswordCredentials.userId, userId)).for("update").limit(1);
    if (!credential || !(await verifyPassword(input.currentPassword, credential.passwordHash))) {
      throw new ManualAuthError("كلمة المرور الحالية غير صحيحة.", "UNAUTHORIZED");
    }

    const [challenge] = await tx.select().from(authEmailChallenges)
      .where(eq(authEmailChallenges.id, input.challengeId)).for("update").limit(1);
    const now = new Date();
    const email = user.emailNormalized ?? user.email?.trim().toLowerCase() ?? "";
    if (!challenge || challenge.purpose !== "password_reset" || challenge.userId !== userId || challenge.email !== email ||
      challenge.codeConsumedAt || challenge.codeExpiresAt.getTime() <= now.getTime() || challenge.attemptCount >= MAX_OTP_ATTEMPTS) {
      return { success: false as const, error: "انتهت صلاحية رمز التحقق أو لا يتطابق مع هذا الحساب. اطلب رمزًا جديدًا." };
    }

    const submitted = challengeDigest(challenge.id, challenge.email, challenge.purpose, input.code);
    if (!constantTimeHexEqual(challenge.codeHash, submitted)) {
      const attempts = challenge.attemptCount + 1;
      await tx.update(authEmailChallenges).set({ attemptCount: attempts, codeConsumedAt: attempts >= MAX_OTP_ATTEMPTS ? now : null })
        .where(eq(authEmailChallenges.id, challenge.id));
      return {
        success: false as const,
        error: attempts >= MAX_OTP_ATTEMPTS ? "تم إيقاف الرمز بعد محاولات غير صحيحة. اطلب رمزًا جديدًا." : "رمز التحقق غير صحيح.",
      };
    }

    await tx.update(authPasswordCredentials).set({ passwordHash: nextHash }).where(eq(authPasswordCredentials.userId, userId));
    await tx.update(authEmailChallenges).set({ codeConsumedAt: now, grantConsumedAt: now }).where(eq(authEmailChallenges.id, challenge.id));
    await tx.update(authDeviceSessions).set({ revokedAt: now, revokeReason: "تغيير كلمة المرور" })
      .where(and(eq(authDeviceSessions.userId, userId), sql`${authDeviceSessions.revokedAt} IS NULL`));
    return { success: true as const, mustLoginAgain: true as const };
  });
  if (!result.success) throw new ManualAuthError(result.error);
  return result;
}

export async function changeManualPassword(userId: number, input: { currentPassword: string; password: string; confirmPassword: string }) {
  if (input.password !== input.confirmPassword) throw new ManualAuthError("كلمتا المرور غير متطابقتين.");
  if (input.password.length < 12 || input.password.length > 128) throw new ManualAuthError("كلمة المرور يجب أن تكون من 12 إلى 128 حرفًا.");
  if (input.currentPassword.length < 1 || input.currentPassword.length > 128) throw new ManualAuthError("أدخل كلمة المرور الحالية.");
  const nextHash = await hashPassword(input.password);
  const db = await getDb();
  if (!db) throw new ManualAuthError("قاعدة البيانات غير متاحة الآن.", "INTERNAL_SERVER_ERROR");
  await db.transaction(async (tx: any) => {
    const [user] = await tx.select({ id: users.id, role: users.role, status: users.status }).from(users).where(eq(users.id, userId)).for("update").limit(1);
    if (!user || (user.role !== "user" && user.role !== "admin") || user.status !== "active") throw new ManualAuthError("الحساب غير متاح لتغيير كلمة المرور.", "UNAUTHORIZED");
    const [credential] = await tx.select().from(authPasswordCredentials).where(eq(authPasswordCredentials.userId, userId)).for("update").limit(1);
    if (!credential || !(await verifyPassword(input.currentPassword, credential.passwordHash))) throw new ManualAuthError("كلمة المرور الحالية غير صحيحة.", "UNAUTHORIZED");
    await tx.update(authPasswordCredentials).set({ passwordHash: nextHash }).where(eq(authPasswordCredentials.userId, userId));
    await tx.update(authDeviceSessions).set({ revokedAt: new Date(), revokeReason: "تغيير كلمة المرور" }).where(and(eq(authDeviceSessions.userId, userId), sql`${authDeviceSessions.revokedAt} IS NULL`));
  });
  return { success: true as const, mustLoginAgain: true as const };
}
