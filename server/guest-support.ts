import { and, asc, count, desc, eq, gt, inArray, isNull, lt, sql } from "drizzle-orm";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import type { Express, Request, Response } from "express";
import { guestSupportMessages, guestSupportSessions, guestSupportTickets } from "../drizzle/schema";
import { guestSupportAuditEvents, guestSupportMessageOperations, guestSupportRateLimits } from "../drizzle/guest-support-schema";
import { decodeAccountVerificationImage, decryptAccountVerificationDocument, encryptAccountVerificationDocument } from "./account-verification-crypto";
import { getDb } from "./db";
import { issueEmailCode, verifyEmailCode } from "./manual-auth";
import { requireAdministrator } from "./payment-settings";
import { hashOpaqueGrant, createOpaqueGrant } from "./manual-auth-crypto";
import { emailAddressSchema, normalizeEmail, normalizePhoneNumber, phoneNumberSchema } from "../shared/registration";

export type GuestSupportAttachment = { data: string; mimeType: "image/jpeg" | "image/png" | "application/pdf" };
type TicketStatus = "new" | "pending_reply" | "replied" | "closed";
const MAX_BODY_LENGTH = 2000;
const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;
// MySQL TIMESTAMP's portable upper bound is 2038. Anonymous tokens remain
// recoverable after expiry as long as the original secret is present and not revoked.
const ANONYMOUS_EXPIRY = new Date("2037-12-31T00:00:00Z");
const MESSAGE_RATE_LIMIT = 8;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const NETWORK_CREATE_LIMIT = 6;
const NETWORK_MESSAGE_LIMIT = 40;
let lastRateCleanup = 0;

class GuestRateLimitError extends Error {}
function normalizeAddress(value: string) {
  const normalized = value.trim().toLowerCase().replace(/^::ffff:/, "").split("%", 1)[0];
  return isIP(normalized) ? normalized : "";
}
function clientAddress(req: Request) {
  const remote = normalizeAddress(req.socket.remoteAddress ?? "");
  if (!remote) throw new Error("تعذر التحقق من اتصال الزائر.");
  // Only honor the nearest forwarded hop when the direct peer is explicitly
  // trusted and configured to sanitize/append this header at the edge.
  const trusted = (process.env.GUEST_SUPPORT_TRUSTED_PROXY_IPS ?? "").split(",").map(normalizeAddress).filter(Boolean);
  if (trusted.includes(remote)) {
    const forwarded = normalizeAddress((req.header("x-forwarded-for") ?? "").split(",").at(-1) ?? "");
    if (forwarded) return forwarded;
  }
  return remote;
}
export function guestSupportNetworkKey(scope: "create" | "message", address: string) {
  const secret = [process.env.GUEST_SUPPORT_RATE_LIMIT_SECRET, process.env.APP_VERIFICATION_SECRET, process.env.MANUS_JWT_SECRET, process.env.JWT_SECRET, process.env.KYC_DOCUMENT_ENCRYPTION_KEY].find((value) => value && value.length >= 32);
  if (!secret) throw new Error("إعداد مفتاح حماية مراسلات الزوار غير مهيأ على الخادم.");
  return createHmac("sha256", secret).update(`guest-support:${scope}:${address}`).digest("hex");
}
async function rateLimitNetwork(req: Request, scope: "create" | "message") {
  const db = await getDb(); if (!db) throw new Error("قاعدة البيانات غير متاحة.");
  const rateKey = guestSupportNetworkKey(scope, clientAddress(req));
  const now = new Date(), limit = scope === "create" ? NETWORK_CREATE_LIMIT : NETWORK_MESSAGE_LIMIT;
  await db.transaction(async (tx) => {
    await tx.insert(guestSupportRateLimits).values({ rateKey, windowStartedAt: now, attempts: 0 }).onDuplicateKeyUpdate({ set: { rateKey: sql`${guestSupportRateLimits.rateKey}` } });
    const [row] = await tx.select().from(guestSupportRateLimits).where(eq(guestSupportRateLimits.rateKey, rateKey)).for("update").limit(1);
    const expired = row.windowStartedAt.getTime() <= now.getTime() - RATE_WINDOW_MS;
    if (!expired && row.attempts >= limit) throw new GuestRateLimitError("طلبات كثيرة من هذا الاتصال. انتظر قليلًا ثم حاول مجددًا.");
    await tx.update(guestSupportRateLimits).set({ attempts: expired ? 1 : row.attempts + 1, windowStartedAt: expired ? now : row.windowStartedAt, updatedAt: now }).where(eq(guestSupportRateLimits.rateKey, rateKey));
  });
  if (Date.now() - lastRateCleanup > 60 * 60 * 1000) {
    lastRateCleanup = Date.now();
    void db.delete(guestSupportRateLimits).where(lt(guestSupportRateLimits.updatedAt, new Date(Date.now() - 24 * 60 * 60 * 1000))).catch(() => { lastRateCleanup = 0; });
  }
}

function ticketCode() { return `FLX-${randomBytes(10).toString("hex").toUpperCase()}`; }
function cleanBody(body: unknown) {
  const value = typeof body === "string" ? body.trim() : "";
  if (value.length > MAX_BODY_LENGTH) throw new Error("الرسالة طويلة جدًا؛ اختصرها إلى 2000 حرف.");
  return value;
}
export function parseGuestSupportAttachment(value: unknown): GuestSupportAttachment | undefined {
  if (value == null) return undefined;
  if (typeof value !== "object") throw new Error("المرفق غير صالح.");
  const input = value as { data?: unknown; mimeType?: unknown };
  if (typeof input.data !== "string" || input.data.length > Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4 ||
      (input.mimeType !== "image/jpeg" && input.mimeType !== "image/png" && input.mimeType !== "application/pdf")) {
    throw new Error("المرفق يجب أن يكون صورة JPEG أو PNG أو ملف PDF لا يتجاوز 2 ميجابايت.");
  }
  if (input.mimeType === "application/pdf") {
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.data)) throw new Error("ترميز المرفق غير صالح.");
    const bytes = Buffer.from(input.data, "base64");
    if (!bytes.length || bytes.length > MAX_ATTACHMENT_BYTES || bytes.toString("base64") !== input.data || !bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new Error("ملف PDF غير صالح أو يتجاوز 2 ميجابايت.");
  } else decodeAccountVerificationImage({ data: input.data, mimeType: input.mimeType });
  return { data: input.data, mimeType: input.mimeType };
}
function encodeAttachment(attachment?: GuestSupportAttachment) {
  if (!attachment) return {};
  return { attachmentCiphertext: encryptAccountVerificationDocument(Buffer.from(attachment.data, "base64")), attachmentMimeType: attachment.mimeType };
}
function exposeAttachment(row: typeof guestSupportMessages.$inferSelect) {
  if (!row.attachmentCiphertext || !row.attachmentMimeType) return null;
  return { data: decryptAccountVerificationDocument(row.attachmentCiphertext).toString("base64"), mimeType: row.attachmentMimeType };
}
function toMessage(row: typeof guestSupportMessages.$inferSelect) {
  return { id: row.id, ticketId: row.ticketId, senderRole: row.senderRole, body: row.body, attachment: exposeAttachment(row), readAt: row.readAt, createdAt: row.createdAt };
}
function bearer(req: Request) { const value = req.header("authorization") ?? ""; return value.startsWith("Bearer ") ? value.slice(7).trim() : ""; }
async function ticketForToken(token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error("جلسة الدعم غير صالحة أو ملغاة.");
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة.");
  const [row] = await db.select({ ticket: guestSupportTickets, session: guestSupportSessions }).from(guestSupportSessions)
    .innerJoin(guestSupportTickets, eq(guestSupportTickets.id, guestSupportSessions.ticketId))
    .where(and(eq(guestSupportSessions.tokenHash, hashOpaqueGrant(token)), isNull(guestSupportSessions.revokedAt))).limit(1);
  if (!row) throw new Error("جلسة الدعم غير صالحة أو ملغاة.");
  // Legacy anonymous sessions lasted 30 days. The possession of the original
  // 256-bit secret, not the public ticket code, restores exactly that ticket.
  const anonymous = !row.ticket.contactEmail && !row.ticket.contactPhone && !row.ticket.verifiedAt;
  if (!anonymous && row.session.expiresAt.getTime() <= Date.now()) throw new Error("انتهت جلسة الدعم؛ اطلب رمز تحقق جديدًا.");
  if (anonymous && row.session.expiresAt.getTime() < ANONYMOUS_EXPIRY.getTime()) {
    await db.update(guestSupportSessions).set({ expiresAt: ANONYMOUS_EXPIRY }).where(and(eq(guestSupportSessions.id, row.session.id), isNull(guestSupportSessions.revokedAt)));
  }
  return row.ticket;
}
async function rateLimitTicket(db: any, ticketId: number) {
  const [row] = await db.select({ total: count() }).from(guestSupportMessages).where(and(eq(guestSupportMessages.ticketId, ticketId), eq(guestSupportMessages.senderRole, "guest"), gt(guestSupportMessages.createdAt, new Date(Date.now() - RATE_WINDOW_MS))));
  if (Number(row?.total ?? 0) >= MESSAGE_RATE_LIMIT) throw new Error("تم إرسال رسائل كثيرة مؤخرًا. انتظر قليلًا ثم حاول مجددًا.");
}
export async function createGuestTicket(input: { displayName: string; email?: string; phone?: string }) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة.");
  const displayName = input.displayName.trim();
  if (displayName.length < 2 || displayName.length > 120) throw new Error("أدخل اسمًا من حرفين إلى 120 حرفًا.");
  const email = input.email?.trim() ? normalizeEmail(emailAddressSchema.parse(input.email)) : null;
  const phone = input.phone?.trim() ? normalizePhoneNumber(phoneNumberSchema.parse(input.phone)) : null;
  if (!email && !phone) throw new Error("أدخل بريدًا إلكترونيًا أو رقم هاتف للتواصل.");
  if (!email) throw new Error("لأمان محادثة الزائر، يلزم بريد إلكتروني لإرسال رمز التحقق حاليًا.");
  const recent = await db.select({ total: count() }).from(guestSupportTickets).where(and(eq(guestSupportTickets.contactEmail, email), gt(guestSupportTickets.createdAt, new Date(Date.now() - RATE_WINDOW_MS))));
  if (Number(recent[0]?.total ?? 0) >= 3) throw new Error("تم إنشاء تذاكر كثيرة لهذا البريد. انتظر قليلًا ثم حاول مجددًا.");
  const code = ticketCode();
  const inserted = await db.insert(guestSupportTickets).values({ ticketCode: code, displayName, contactEmail: email, contactPhone: phone });
  const id = Number((inserted as any)?.[0]?.insertId ?? (inserted as any)?.insertId ?? 0);
  const [ticket] = await db.select().from(guestSupportTickets).where(eq(guestSupportTickets.id, id)).limit(1);
  if (!ticket) throw new Error("تعذر إنشاء تذكرة الدعم.");
  try {
    const challenge = await issueEmailCode({ email, purpose: "guest_support" });
    await db.update(guestSupportTickets).set({ otpChallengeId: challenge.challengeId }).where(eq(guestSupportTickets.id, ticket.id));
    return { ticketCode: ticket.ticketCode, challengeId: challenge.challengeId, expiresInSeconds: challenge.expiresInSeconds };
  } catch (error) { await db.delete(guestSupportTickets).where(eq(guestSupportTickets.id, ticket.id)); throw error; }
}
export async function verifyGuestTicket(input: { ticketCode: string; challengeId: string; code: string }) {
  const db = await getDb(); if (!db) throw new Error("قاعدة البيانات غير متاحة.");
  const [ticket] = await db.select().from(guestSupportTickets).where(eq(guestSupportTickets.ticketCode, input.ticketCode.trim().toUpperCase())).limit(1);
  if (!ticket || ticket.otpChallengeId !== input.challengeId) throw new Error("بيانات التذكرة غير صحيحة.");
  return verifyEmailCode({ challengeId: input.challengeId, code: input.code, guestTicketId: ticket.id });
}
export async function createAnonymousGuestTicket() {
  const db = await getDb(); if (!db) throw new Error("قاعدة البيانات غير متاحة.");
  const code = ticketCode(), token = createOpaqueGrant();
  return db.transaction(async (tx) => {
    const inserted = await tx.insert(guestSupportTickets).values({ ticketCode: code, displayName: "مستخدم غير مسجل الدخول" });
    const id = Number((inserted as any)?.[0]?.insertId ?? (inserted as any)?.insertId ?? 0);
    if (!id) throw new Error("تعذر فتح محادثة خدمة العملاء.");
    await tx.insert(guestSupportSessions).values({ id: randomUUID(), ticketId: id, tokenHash: hashOpaqueGrant(token), expiresAt: ANONYMOUS_EXPIRY });
    return { guestSupportToken: token, ticketCode: code, nextStep: "guest_support" as const, expiresInSeconds: Math.max(0, Math.floor((ANONYMOUS_EXPIRY.getTime() - Date.now()) / 1000)) };
  });
}
export async function listGuestMessages(token: string) {
  const ticket = await ticketForToken(token);
  const db = await getDb(); if (!db) throw new Error("قاعدة البيانات غير متاحة.");
  await db.update(guestSupportMessages).set({ readAt: new Date() }).where(and(eq(guestSupportMessages.ticketId, ticket.id), eq(guestSupportMessages.senderRole, "admin"), isNull(guestSupportMessages.readAt)));
  const rows = await db.select().from(guestSupportMessages).where(eq(guestSupportMessages.ticketId, ticket.id)).orderBy(asc(guestSupportMessages.id));
  return { ticket: { ticketCode: ticket.ticketCode, displayName: ticket.displayName, status: ticket.status, updatedAt: ticket.updatedAt }, messages: rows.map(toMessage) };
}
function operationKey(value?: string) {
  if (value === undefined) return randomUUID(); // compatibility with older clients
  if (!/^[A-Za-z0-9_-]{12,100}$/.test(value)) throw new Error("معرّف إرسال الرسالة غير صالح.");
  return value;
}
async function sendMessage(ticketId: number, senderRole: "guest" | "admin", body: string, attachment: GuestSupportAttachment | undefined, operationId?: string, adminId?: number) {
  const db = await getDb(); if (!db) throw new Error("قاعدة البيانات غير متاحة.");
  const clean = cleanBody(body), safeAttachment = parseGuestSupportAttachment(attachment), key = operationKey(operationId);
  if (!clean && !safeAttachment) throw new Error("اكتب الرسالة أو أرفق ملفًا قبل الإرسال.");
  const payloadHash = createHash("sha256").update(JSON.stringify([clean, safeAttachment?.mimeType ?? null, safeAttachment?.data ?? null])).digest("hex");
  return db.transaction(async (tx) => {
    const [ticket] = await tx.select().from(guestSupportTickets).where(eq(guestSupportTickets.id, ticketId)).for("update").limit(1);
    if (!ticket) throw new Error("تذكرة الدعم غير موجودة.");
    const [existing] = await tx.select().from(guestSupportMessageOperations).where(and(eq(guestSupportMessageOperations.ticketId, ticketId), eq(guestSupportMessageOperations.senderRole, senderRole), eq(guestSupportMessageOperations.operationId, key))).limit(1);
    if (existing) {
      if (existing.payloadHash !== payloadHash) throw new Error("معرّف الإرسال مستخدم لرسالة مختلفة.");
      return { sent: true as const, messageId: existing.messageId };
    }
    if (ticket.status === "closed") throw new Error("أُغلقت هذه المحادثة من الإدارة؛ يجب إعادة فتحها قبل إرسال رسالة.");
    if (senderRole === "guest") await rateLimitTicket(tx, ticketId);
    const inserted = await tx.insert(guestSupportMessages).values({ ticketId, senderRole, adminId: adminId ?? null, body: clean || (senderRole === "guest" ? "أرسل الزائر مرفقًا." : "أرسلت الإدارة مرفقًا."), ...encodeAttachment(safeAttachment) });
    const messageId = Number((inserted as any)?.[0]?.insertId ?? (inserted as any)?.insertId ?? 0);
    if (!messageId) throw new Error("تعذر حفظ الرسالة.");
    await tx.insert(guestSupportMessageOperations).values({ ticketId, senderRole, operationId: key, payloadHash, messageId });
    const nextStatus: TicketStatus = senderRole === "admin" ? "replied" : ticket.status === "replied" ? "pending_reply" : ticket.status;
    await tx.update(guestSupportTickets).set({ status: nextStatus, updatedAt: new Date() }).where(eq(guestSupportTickets.id, ticketId));
    if (senderRole === "admin" && adminId) await tx.insert(guestSupportAuditEvents).values({ ticketId, adminId, action: "reply", previousStatus: ticket.status, newStatus: nextStatus, messageId });
    return { sent: true as const, messageId };
  });
}
export async function sendGuestMessage(token: string, body: string, attachment?: GuestSupportAttachment, operationId?: string) {
  const ticket = await ticketForToken(token);
  return sendMessage(ticket.id, "guest", body, attachment, operationId);
}
export async function listGuestTickets(adminId: number) {
  const db = await requireAdministrator(adminId);
  // TiDB does not allow a subquery in JOIN ... ON. The former correlated
  // max(message.id) join therefore failed for the entire admin inbox and also
  // caused the unified recent-operations query to fail. Aggregate message IDs
  // and unread counts separately, then fetch only the latest preview rows.
  const tickets = await db.select().from(guestSupportTickets)
    .orderBy(desc(guestSupportTickets.updatedAt), desc(guestSupportTickets.id));
  if (!tickets.length) return [];
  const ticketIdChunks: number[][] = [];
  for (let offset = 0; offset < tickets.length; offset += 500) {
    ticketIdChunks.push(tickets.slice(offset, offset + 500).map((ticket) => ticket.id));
  }
  const stats = (await Promise.all(ticketIdChunks.map((ids) => db.select({
    ticketId: guestSupportMessages.ticketId,
    lastMessageId: sql<number>`MAX(${guestSupportMessages.id})`,
    unread: sql<number>`SUM(CASE WHEN ${guestSupportMessages.senderRole} = 'guest' AND ${guestSupportMessages.readAt} IS NULL THEN 1 ELSE 0 END)`,
  }).from(guestSupportMessages).where(inArray(guestSupportMessages.ticketId, ids)).groupBy(guestSupportMessages.ticketId)))).flat();
  const lastMessageIds = stats.map((item) => Number(item.lastMessageId)).filter((id) => Number.isSafeInteger(id) && id > 0);
  const latestRows = (await Promise.all(Array.from({ length: Math.ceil(lastMessageIds.length / 500) }, (_, index) => {
    const ids = lastMessageIds.slice(index * 500, (index + 1) * 500);
    return db.select({ id: guestSupportMessages.id, ticketId: guestSupportMessages.ticketId, senderRole: guestSupportMessages.senderRole,
      body: guestSupportMessages.body, readAt: guestSupportMessages.readAt, createdAt: guestSupportMessages.createdAt })
      .from(guestSupportMessages).where(inArray(guestSupportMessages.id, ids));
  }))).flat();
  const latestByTicket = new Map(latestRows.map((message) => [message.ticketId, message]));
  const statsByTicket = new Map(stats.map((item) => [item.ticketId, item]));
  return tickets.map((ticket) => ({
    ticket,
    lastMessage: latestByTicket.get(ticket.id) ?? null,
    unread: Number(statsByTicket.get(ticket.id)?.unread ?? 0),
  }));
}
export async function listGuestMessagesForAdmin(adminId: number, ticketId: number) {
  const db = await requireAdministrator(adminId);
  const [ticket] = await db.select({ id: guestSupportTickets.id }).from(guestSupportTickets).where(eq(guestSupportTickets.id, ticketId)).limit(1);
  if (!ticket) throw new Error("تذكرة الدعم غير موجودة.");
  await db.update(guestSupportMessages).set({ readAt: new Date() }).where(and(eq(guestSupportMessages.ticketId, ticketId), eq(guestSupportMessages.senderRole, "guest"), isNull(guestSupportMessages.readAt)));
  const rows = await db.select().from(guestSupportMessages).where(eq(guestSupportMessages.ticketId, ticketId)).orderBy(asc(guestSupportMessages.id));
  return rows.map(toMessage);
}
export async function replyToGuestTicket(adminId: number, ticketId: number, body: string, attachment?: GuestSupportAttachment, operationId?: string) {
  await requireAdministrator(adminId);
  return sendMessage(ticketId, "admin", body, attachment, operationId, adminId);
}
export async function setGuestTicketStatus(adminId: number, ticketId: number, status: TicketStatus) {
  const db = await requireAdministrator(adminId);
  if (!["new", "pending_reply", "replied", "closed"].includes(status)) throw new Error("حالة المحادثة غير صالحة.");
  return db.transaction(async (tx) => {
    const [ticket] = await tx.select().from(guestSupportTickets).where(eq(guestSupportTickets.id, ticketId)).for("update").limit(1);
    if (!ticket) throw new Error("تذكرة الدعم غير موجودة.");
    if (ticket.status === status) return { updated: true as const };
    await tx.update(guestSupportTickets).set({ status, closedAt: status === "closed" ? new Date() : null, updatedAt: new Date() }).where(eq(guestSupportTickets.id, ticketId));
    await tx.insert(guestSupportAuditEvents).values({ ticketId, adminId, action: "status_change", previousStatus: ticket.status, newStatus: status });
    return { updated: true as const };
  });
}
function jsonError(res: Response, error: unknown) {
  const raw = error instanceof Error ? error.message : "";
  const message = /[\u0600-\u06ff]/.test(raw) && !/query:|params:|sql:|insert into|select /i.test(raw) ? raw : "تعذر تنفيذ طلب الدعم الآن. حاول مجددًا.";
  res.status(error instanceof GuestRateLimitError ? 429 : message.includes("غير مهيأ") || message.includes("قاعدة البيانات") ? 503 : 400).json({ error: message });
}
export function registerGuestSupportRoutes(app: Express) {
  app.use("/api/guest-support", (_req, res, next) => { res.setHeader("Cache-Control", "private, no-store"); next(); });
  app.post("/api/guest-support/start", async (req, res) => { try { await rateLimitNetwork(req, "create"); res.json(await createGuestTicket({ displayName: String(req.body?.displayName ?? ""), email: typeof req.body?.email === "string" ? req.body.email : undefined, phone: typeof req.body?.phone === "string" ? req.body.phone : undefined })); } catch (error) { jsonError(res, error); } });
  app.post("/api/guest-support/anonymous", async (req, res) => { try { await rateLimitNetwork(req, "create"); res.json(await createAnonymousGuestTicket()); } catch (error) { jsonError(res, error); } });
  app.post("/api/guest-support/verify", async (req, res) => { try { res.json(await verifyGuestTicket({ ticketCode: String(req.body?.ticketCode ?? ""), challengeId: String(req.body?.challengeId ?? ""), code: String(req.body?.code ?? "") })); } catch (error) { jsonError(res, error); } });
  app.get("/api/guest-support/messages", async (req, res) => { try { res.json(await listGuestMessages(bearer(req))); } catch (error) { jsonError(res, error); } });
  app.post("/api/guest-support/messages", async (req, res) => { try { await rateLimitNetwork(req, "message"); res.json(await sendGuestMessage(bearer(req), cleanBody(req.body?.body), parseGuestSupportAttachment(req.body?.attachment), req.body?.operationId)); } catch (error) { jsonError(res, error); } });
}
