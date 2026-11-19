import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { desc, eq, isNotNull, or, sql } from "drizzle-orm";
import { adminCreatedAccountEvents as events, adminCreatedAccounts as drafts } from "../drizzle/admin-created-accounts-schema";
import { authPasswordCredentials } from "../drizzle/auth-schema";
import { appSettings, users } from "../drizzle/schema";
import { ADMIN_EMAIL } from "../shared/admin";
import { adminCreatedAccountCreateSchema, adminCreatedClaimSchema, adminCreatedIdentitySchema, adminCreatedSuspendSchema, type AdminCreatedAccountView } from "../shared/admin-created-accounts";
import { normalizePhoneNumber } from "../shared/registration";
import { getDb } from "./db";
import { hashPassword } from "./manual-auth-crypto";

const INVITE_TTL_MS = 30 * 60 * 1000;
const CUSTOMER_ID_ATTEMPTS = 12;

export class AdminCreatedAccountError extends Error {
  constructor(message: string, readonly code: "BAD_REQUEST" | "CONFLICT" | "FORBIDDEN" | "INTERNAL_SERVER_ERROR" = "BAD_REQUEST") {
    super(message);
  }
}

/** The adapter is server-only. It MUST deliver directly to `email`, never return/log the secret. */
export type AdminCreatedInvitationDelivery = (data: { email: string; token: string; expiresAt: Date }) => Promise<void>;

const failInvite = () => new AdminCreatedAccountError("الدعوة غير صالحة أو منتهية أو مستخدمة؛ تواصل مع الإدارة.");
const hashToken = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");
const customerId = () => randomInt(1, 10_000_000_000).toString().padStart(10, "0");
const isDuplicate = (error: unknown): boolean => {
  const e = error as { code?: string; errno?: number; cause?: unknown } | null;
  return Boolean(e && (e.code === "ER_DUP_ENTRY" || e.errno === 1062 || (e.cause && isDuplicate(e.cause))));
};

async function database() {
  const db = await getDb();
  if (!db) throw new AdminCreatedAccountError("قاعدة البيانات غير متاحة.", "INTERNAL_SERVER_ERROR");
  return db;
}

// Re-check the persisted principal, not an input-provided name/role or a stale session.
async function administrator(tx: any, actorId: number) {
  const [actor] = await tx.select({ id: users.id, name: users.name, role: users.role, status: users.status, email: users.email, emailNormalized: users.emailNormalized })
    .from(users).where(eq(users.id, actorId)).for("update").limit(1);
  if (!actor || actor.status !== "active" || actor.role !== "admin" || (actor.emailNormalized ?? actor.email)?.trim().toLowerCase() !== ADMIN_EMAIL) {
    throw new AdminCreatedAccountError("هذه العملية متاحة للمدير المخول فقط.", "FORBIDDEN");
  }
  return { id: actor.id as number, name: (actor.name?.trim() || `مسؤول #${actor.id}`).slice(0, 160) as string };
}

async function event(tx: any, id: string, actor: { id: number | null; name: string }, action: string, now: Date, details?: object) {
  await tx.insert(events).values({ requestId: id, actorId: actor.id, actorName: actor.name, event: action, details: details ? JSON.stringify(details) : null, createdAt: now });
}

// Legacy rows may not have emailNormalized; reject them as well. Existing rows are never changed.
async function findEmail(tx: any, email: string) {
  return tx.select({ id: users.id }).from(users)
    .where(or(eq(users.emailNormalized, email), sql`LOWER(TRIM(${users.email})) = ${email}`)).limit(1);
}
async function phoneTaken(tx: any, phone: string) {
  const candidates = await tx.select({ phone: users.phoneNumber, normalized: users.phoneNormalized }).from(users)
    .where(or(eq(users.phoneNormalized, phone), isNotNull(users.phoneNumber)));
  return candidates.some((row: { phone: string | null; normalized: string | null }) =>
    (row.normalized && normalizePhoneNumber(row.normalized) === phone) || (row.phone && normalizePhoneNumber(row.phone) === phone));
}
async function lockedDraft(tx: any, id: string) {
  const [row] = await tx.select().from(drafts).where(eq(drafts.id, id)).for("update").limit(1);
  if (!row) throw new AdminCreatedAccountError("طلب الحساب غير موجود.");
  return row;
}
function view(row: any): AdminCreatedAccountView {
  return {
    id: row.id, name: row.name, email: row.email, phoneNumber: row.phoneNumber, state: row.state,
    createdByName: row.createdByName, createdAt: row.createdAt,
    identityEvidenceRef: row.identityEvidenceRef, identityReviewedByName: row.identityReviewedByName,
    identityReviewedAt: row.identityReviewedAt, emailVerifiedAt: row.emailVerifiedAt, customerId: row.customerId,
  };
}

export async function createAdminCreatedAccount(actorId: number, raw: unknown) {
  const input = adminCreatedAccountCreateSchema.parse(raw);
  if (input.email === ADMIN_EMAIL) throw new AdminCreatedAccountError("لا يمكن إنشاء حساب إداري أو استخدام بريد المدير بهذا المسار.", "FORBIDDEN");
  const db = await database();
  try {
    return await db.transaction(async tx => {
      const actor = await administrator(tx, actorId);
      if ((await findEmail(tx, input.email)).length) throw new AdminCreatedAccountError("هذا البريد مرتبط بحساب قائم.", "CONFLICT");
      const id = randomUUID();
      const now = new Date();
      await tx.insert(drafts).values({ id, name: input.name, email: input.email, phoneNumber: input.phoneNumber ?? null, state: "draft", createdById: actor.id, createdByName: actor.name, createdAt: now });
      await event(tx, id, actor, "created", now);
      return view(await lockedDraft(tx, id));
    });
  } catch (error) {
    if (isDuplicate(error)) throw new AdminCreatedAccountError("يوجد طلب حساب بهذا البريد بالفعل.", "CONFLICT");
    throw error;
  }
}

export async function listAdminCreatedAccounts(actorId: number): Promise<AdminCreatedAccountView[]> {
  const db = await database();
  return db.transaction(async tx => {
    await administrator(tx, actorId);
    const rows = await tx.select({ draft: drafts, userStatus: users.status }).from(drafts).leftJoin(users, eq(drafts.userId, users.id)).orderBy(desc(drafts.createdAt)).limit(100);
    const [setting] = await tx.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, "frozen_customer_ids")).limit(1);
    let frozen = new Set<number>();
    let frozenStateUnknown = false;
    if (setting) {
      try { const ids: unknown = JSON.parse(setting.value); if (!Array.isArray(ids)) throw new Error(); frozen = new Set(ids.filter((id): id is number => Number.isSafeInteger(id) && id > 0)); }
      catch { frozenStateUnknown = true; }
    }
    return rows.map(({ draft, userStatus }) => view({ ...draft, state: draft.state === "active" && (userStatus !== "active" || frozenStateUnknown || (draft.userId !== null && frozen.has(draft.userId))) ? "suspended" : draft.state }));
  });
}

export async function submitAdminCreatedAccount(actorId: number, id: string) {
  const db = await database();
  return db.transaction(async tx => {
    const actor = await administrator(tx, actorId);
    const row = await lockedDraft(tx, id);
    if (row.state !== "draft") throw new AdminCreatedAccountError("يمكن إرسال الحساب قيد الإنشاء فقط للتحقق.");
    const now = new Date();
    await tx.update(drafts).set({ state: "verification_required" }).where(eq(drafts.id, id));
    await event(tx, id, actor, "verification_requested", now);
    return view({ ...row, state: "verification_required" });
  });
}

export async function recordAdminCreatedIdentity(actorId: number, raw: unknown) {
  const input = adminCreatedIdentitySchema.parse(raw);
  const db = await database();
  return db.transaction(async tx => {
    const actor = await administrator(tx, actorId);
    const row = await lockedDraft(tx, input.id);
    if (row.state !== "verification_required") throw new AdminCreatedAccountError("الحساب غير متاح لمراجعة الهوية في حالته الحالية.");
    const now = new Date();
    const patch = { identityEvidenceRef: input.evidenceRef, identityReviewedById: actor.id, identityReviewedByName: actor.name, identityReviewedAt: now, invitationHash: null, invitationExpiresAt: null, invitationConsumedAt: null };
    await tx.update(drafts).set(patch).where(eq(drafts.id, input.id));
    await event(tx, input.id, actor, "identity_reviewed", now, { evidenceRef: input.evidenceRef });
    return view({ ...row, ...patch });
  });
}

export async function setAdminCreatedAccountSuspended(actorId: number, raw: unknown) {
  const input = adminCreatedSuspendSchema.parse(raw);
  const db = await database();
  return db.transaction(async tx => {
    const actor = await administrator(tx, actorId);
    const row = await lockedDraft(tx, input.id);
    if (row.state === "active") throw new AdminCreatedAccountError("استخدم إجراء تجميد الحساب الحالي للحسابات النشطة.");
    const now = new Date();
    if (input.suspended) {
      if (row.state === "suspended") throw new AdminCreatedAccountError("الطلب موقوف بالفعل.");
      await tx.update(drafts).set({ state: "suspended", suspendedFrom: row.state, invitationHash: null, invitationExpiresAt: null }).where(eq(drafts.id, input.id));
    } else {
      if (row.state !== "suspended" || !row.suspendedFrom) throw new AdminCreatedAccountError("الطلب ليس موقوفًا.");
      await tx.update(drafts).set({ state: row.suspendedFrom, suspendedFrom: null }).where(eq(drafts.id, input.id));
    }
    await event(tx, input.id, actor, input.suspended ? "suspended" : "resumed", now, { reason: input.reason });
    return view({ ...row, state: input.suspended ? "suspended" : row.suspendedFrom });
  });
}

/** Delivery is disabled unless an explicit trusted server adapter is supplied at composition time. */
export async function issueAdminCreatedInvitation(actorId: number, id: string, deliver?: AdminCreatedInvitationDelivery) {
  if (!deliver) throw new AdminCreatedAccountError("خدمة الدعوات غير مهيأة؛ لم تُرسل دعوة.", "INTERNAL_SERVER_ERROR");
  const db = await database();
  return db.transaction(async tx => {
    const actor = await administrator(tx, actorId);
    const row = await lockedDraft(tx, id);
    if (row.state !== "verification_required" || !row.identityReviewedAt || !row.identityReviewedById || !row.identityEvidenceRef || row.email === ADMIN_EMAIL) {
      throw new AdminCreatedAccountError("يلزم تسجيل مراجعة الهوية قبل إصدار الدعوة.");
    }
    if ((await findEmail(tx, row.email)).length) throw new AdminCreatedAccountError("أصبح البريد مرتبطًا بحساب قائم؛ راجع الطلب.", "CONFLICT");
    const token = randomBytes(32).toString("base64url");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);
    await tx.update(drafts).set({ invitationHash: hashToken(token), invitationExpiresAt: expiresAt, invitationConsumedAt: null }).where(eq(drafts.id, id));
    // No queue or plaintext token is persisted. Failure rolls back issuance; successful delivery
    // followed by a database commit failure can yield an unusable link, never unauthorized access.
    try { await deliver({ email: row.email, token, expiresAt }); }
    catch { throw new AdminCreatedAccountError("تعذر تسليم الدعوة بأمان؛ لم تُفعّل.", "INTERNAL_SERVER_ERROR"); }
    await event(tx, id, actor, "invitation_issued", now, { expiresAt: expiresAt.toISOString() });
    return { issued: true, expiresAt };
  });
}

/** Called only from the mailbox owner's HTTPS form, NOT from the administrator interface. */
export async function claimAdminCreatedInvitation(raw: unknown) {
  const input = adminCreatedClaimSchema.parse(raw);
  const db = await database();
  const digest = hashToken(input.token);
  // Avoid expensive password hashing for random invalid tokens.
  const [candidate] = await db.select({ id: drafts.id, state: drafts.state, expires: drafts.invitationExpiresAt, used: drafts.invitationConsumedAt }).from(drafts).where(eq(drafts.invitationHash, digest)).limit(1);
  if (!candidate || candidate.state !== "verification_required" || candidate.used || !candidate.expires || candidate.expires.getTime() <= Date.now()) throw failInvite();
  const passwordHash = await hashPassword(input.password);
  try {
    return await db.transaction(async tx => {
      const row = await lockedDraft(tx, candidate.id);
      const now = new Date();
      if (row.state !== "verification_required" || row.invitationHash !== digest || row.invitationConsumedAt || !row.invitationExpiresAt || row.invitationExpiresAt.getTime() <= now.getTime() || !row.identityReviewedAt || !row.identityReviewedById || !row.identityEvidenceRef || row.email === ADMIN_EMAIL) throw failInvite();
      if ((await findEmail(tx, row.email)).length) throw new AdminCreatedAccountError("تعذر إكمال الطلب لأن البريد مرتبط بحساب قائم؛ تواصل مع الدعم.", "CONFLICT");
      if (row.phoneNumber && await phoneTaken(tx, row.phoneNumber)) throw new AdminCreatedAccountError("تعذر إكمال الطلب لأن الهاتف مرتبط بحساب قائم؛ تواصل مع الدعم.", "CONFLICT");
      const openId = `manual:${randomUUID()}`;
      let createdCustomerId: string | undefined;
      for (let attempt = 0; attempt < CUSTOMER_ID_ATTEMPTS; attempt++) {
        const number = customerId();
        try {
          await tx.insert(users).values({ openId, customerId: number, name: row.name, email: row.email, emailNormalized: row.email, phoneNumber: row.phoneNumber, phoneNormalized: row.phoneNumber, profileCompletedAt: null, loginMethod: "password", role: "user", status: "active", lastSignedIn: now });
          createdCustomerId = number;
          break;
        } catch (error) {
          if (!isDuplicate(error)) throw error;
          if ((await findEmail(tx, row.email)).length) throw new AdminCreatedAccountError("تعذر إكمال الطلب لأن البريد مرتبط بحساب قائم؛ تواصل مع الدعم.", "CONFLICT");
          if (row.phoneNumber && await phoneTaken(tx, row.phoneNumber)) throw new AdminCreatedAccountError("تعذر إكمال الطلب لأن الهاتف مرتبط بحساب قائم؛ تواصل مع الدعم.", "CONFLICT");
        }
      }
      if (!createdCustomerId) throw new AdminCreatedAccountError("تعذر إصدار رقم عميل فريد الآن.", "INTERNAL_SERVER_ERROR");
      const [created] = await tx.select({ id: users.id }).from(users).where(eq(users.openId, openId)).limit(1);
      if (!created) throw new AdminCreatedAccountError("تعذر إكمال إنشاء الحساب.", "INTERNAL_SERVER_ERROR");
      await tx.insert(authPasswordCredentials).values({ userId: created.id, passwordHash, emailVerifiedAt: now, phoneVerifiedAt: null });
      await tx.update(drafts).set({ state: "active", userId: created.id, customerId: createdCustomerId, emailVerifiedAt: now, invitationConsumedAt: now, invitationHash: null }).where(eq(drafts.id, row.id));
      await event(tx, row.id, { id: null, name: "صاحب البريد عبر الدعوة" }, "email_verified_and_activated", now);
      return { success: true, customerId: createdCustomerId };
    });
  } catch (error) {
    if (isDuplicate(error)) throw new AdminCreatedAccountError("تعذر إكمال الطلب بسبب تعارض في البيانات؛ تواصل مع الدعم.", "CONFLICT");
    throw error;
  }
}
