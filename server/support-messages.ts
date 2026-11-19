import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { notifications, supportMessages, supportThreadStates, users } from "../drizzle/schema";
import type { SupportCategory } from "../shared/support-categories";
import { decodeAccountVerificationImage, decryptAccountVerificationDocument, encryptAccountVerificationDocument } from "./account-verification-crypto";
import { getDb } from "./db";
import { requireAdministrator } from "./payment-settings";

export type SupportAttachment = { data: string; mimeType: "image/jpeg" | "image/png" };
const MULTI_ATTACHMENT_MARKER = "flotex-images-v1";
const MAX_SUPPORT_ATTACHMENTS = 4;
const MAX_SUPPORT_ATTACHMENT_BYTES = 1_200_000;

function encodeAttachments(attachments: SupportAttachment[]) {
  if (!attachments.length) return {};
  if (attachments.length > MAX_SUPPORT_ATTACHMENTS) throw new Error("يمكن إرفاق أربع صور كحد أقصى في الرسالة الواحدة");
  const decoded = attachments.map((item) => decodeAccountVerificationImage(item));
  if (decoded.reduce((sum, item) => sum + item.byteLength, 0) > MAX_SUPPORT_ATTACHMENT_BYTES) throw new Error("إجمالي حجم الصور المرفقة أكبر من المسموح");
  if (attachments.length === 1) return {
    attachmentCiphertext: encryptAccountVerificationDocument(decoded[0]),
    attachmentMimeType: attachments[0].mimeType,
  };
  const packed = Buffer.from(JSON.stringify({ version: 1, items: attachments }), "utf8");
  if (packed.byteLength > MAX_SUPPORT_ATTACHMENT_BYTES * 1.5) throw new Error("إجمالي حجم الصور المرفقة أكبر من المسموح");
  return { attachmentCiphertext: encryptAccountVerificationDocument(packed), attachmentMimeType: MULTI_ATTACHMENT_MARKER };
}

function exposeAttachments(row: typeof supportMessages.$inferSelect): SupportAttachment[] {
  if (!row.attachmentCiphertext || !row.attachmentMimeType) return [];
  const bytes = decryptAccountVerificationDocument(row.attachmentCiphertext);
  if (row.attachmentMimeType !== MULTI_ATTACHMENT_MARKER) {
    if (row.attachmentMimeType !== "image/jpeg" && row.attachmentMimeType !== "image/png") throw new Error("صيغة مرفق الرسالة غير مدعومة");
    return [{ data: bytes.toString("base64"), mimeType: row.attachmentMimeType }];
  }
  try {
    const packed = JSON.parse(bytes.toString("utf8")) as { version?: number; items?: unknown };
    if (packed.version !== 1 || !Array.isArray(packed.items) || packed.items.length < 2 || packed.items.length > MAX_SUPPORT_ATTACHMENTS) throw new Error("invalid attachment pack");
    return packed.items.map((item) => {
      if (!item || typeof item !== "object") throw new Error("invalid attachment");
      const candidate = item as { data?: unknown; mimeType?: unknown };
      if (typeof candidate.data !== "string" || (candidate.mimeType !== "image/jpeg" && candidate.mimeType !== "image/png")) throw new Error("invalid attachment");
      return { data: candidate.data, mimeType: candidate.mimeType };
    });
  } catch {
    throw new Error("تعذر قراءة مرفقات رسالة الدعم المشفرة");
  }
}

function toMessage(row: typeof supportMessages.$inferSelect, includeAttachment = true) {
  const attachments = includeAttachment ? exposeAttachments(row) : [];
  return {
    id: row.id,
    userId: row.userId,
    category: row.category,
    senderRole: row.senderRole,
    body: row.body,
    attachment: (attachments[0] ?? null) as SupportAttachment | null,
    attachments,
    readAt: row.readAt,
    createdAt: row.createdAt,
  };
}

function normalizeAttachments(attachment?: SupportAttachment | null, attachments?: SupportAttachment[]) {
  if (attachment && attachments?.length) throw new Error("أرسل مرفقًا واحدًا فقط: الصورة القديمة أو قائمة الصور");
  const result = attachments?.length ? attachments : attachment ? [attachment] : [];
  if (result.length > MAX_SUPPORT_ATTACHMENTS) throw new Error("يمكن إرفاق أربع صور كحد أقصى في الرسالة الواحدة");
  return result;
}

async function setThreadState(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, userId: number, category: SupportCategory, status: "open" | "closed", adminId?: number) {
  const closedAt = status === "closed" ? new Date() : null;
  await db.insert(supportThreadStates).values({ userId, category, status, closedBy: status === "closed" ? adminId ?? null : null, closedAt })
    .onDuplicateKeyUpdate({ set: { status, closedBy: status === "closed" ? adminId ?? null : null, closedAt } });
}

async function listSupportMessagePage(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  userId: number,
  category: SupportCategory,
  incomingRole: "user" | "admin",
) {
  const thread = and(eq(supportMessages.userId, userId), eq(supportMessages.category, category));
  const rows = await db.select().from(supportMessages).where(thread)
    .orderBy(desc(supportMessages.createdAt), desc(supportMessages.id)).limit(200);
  // Decode the entire page before marking anything read, so a failed response
  // (for example, an unreadable attachment) doesn't acknowledge unseen messages.
  const messages = rows.reverse().map((row) => toMessage(row));
  const unreadIds = messages.filter((message) => message.senderRole === incomingRole && !message.readAt).map((message) => message.id);
  if (unreadIds.length) {
    const readAt = new Date(Math.floor(Date.now() / 1000) * 1000);
    await db.update(supportMessages).set({ readAt })
      .where(and(thread, eq(supportMessages.senderRole, incomingRole), isNull(supportMessages.readAt), inArray(supportMessages.id, unreadIds)));
    return messages.map((message) => unreadIds.includes(message.id) ? { ...message, readAt } : message);
  }
  return messages;
}

export async function listMySupportMessages(userId: number, category: SupportCategory = "account") {
  const db = await getDb();
  if (!db) return [];
  return listSupportMessagePage(db, userId, category, "admin");
}

export async function sendSupportMessage(
  userId: number,
  body: string,
  attachment?: SupportAttachment,
  category: SupportCategory = "account",
  attachments?: SupportAttachment[],
) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  const clean = body.trim();
  const images = normalizeAttachments(attachment, attachments);
  if (!clean && !images.length) throw new Error("اكتب الرسالة أو أرفق صورة قبل الإرسال");
  if (clean.length > 2000) throw new Error("الرسالة طويلة جدًا");
  const inserted = await db.insert(supportMessages).values({
    userId,
    category,
    senderRole: "user",
    body: clean || (images.length === 1 ? "[مرفق صورة]" : "[مرفقات صور]"),
    ...encodeAttachments(images),
  });
  await setThreadState(db, userId, category, "open");
  const messageId = Number((inserted as any)?.[0]?.insertId ?? (inserted as any)?.insertId ?? Date.now());
  const admins = await db.select({ id: users.id }).from(users).where(eq(users.role, "admin"));
  if (admins.length) {
    await db.insert(notifications).values(admins.map((admin) => ({
      userId: admin.id,
      title: "رسالة جديدة من مستخدم",
      body: `وصلت رسالة جديدة في قسم ${category === "freeze" ? "تجميد الحسابات" : category === "external_transaction" ? "المعاملات الخارجية" : "مراسلات الحساب"}.`,
      type: "support_message",
      operationId: `support:${userId}:${category}:message:${messageId}:admin:${admin.id}`,
    })));
  }
  return { sent: true };
}

export async function listAdminSupportConversations(adminId: number, category?: SupportCategory) {
  await requireAdministrator(adminId);
  const db = await getDb();
  if (!db) return [];
  const [rows, threadRows] = await Promise.all([db.select({
    message: { id: supportMessages.id, userId: supportMessages.userId, category: supportMessages.category, senderRole: supportMessages.senderRole, body: supportMessages.body, readAt: supportMessages.readAt, createdAt: supportMessages.createdAt },
    user: { id: users.id, name: users.name, customerId: users.customerId, phoneNumber: users.phoneNumber, status: users.status, deletedAt: users.deletedAt },
  }).from(supportMessages)
    .innerJoin(users, eq(users.id, supportMessages.userId))
    .where(category ? eq(supportMessages.category, category) : undefined)
    .orderBy(desc(supportMessages.createdAt), desc(supportMessages.id)), db.select().from(supportThreadStates)]);
  const closedAdminIds = [...new Set(threadRows.map((thread) => thread.closedBy).filter((id): id is number => id !== null))];
  const closedAdmins = closedAdminIds.length ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, closedAdminIds)) : [];
  const adminNames = new Map(closedAdmins.map((admin) => [admin.id, admin.name]));
  const threadStateMap = new Map(threadRows.map((thread) => [`${thread.userId}:${thread.category}`, thread]));
  const map = new Map<string, {
    user: typeof rows[number]["user"];
    category: SupportCategory;
    lastMessage: ReturnType<typeof toMessage>;
    createdAt: Date;
    unread: number;
    threadStatus: "open" | "closed";
    closedAt: Date | null;
    closedBy: number | null;
    closedByName: string | null;
  }>();
  for (const row of rows) {
    const key = `${row.user.id}:${row.message.category}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        user: row.user,
        category: row.message.category,
        lastMessage: { ...row.message, attachment: null, attachments: [] },
        createdAt: row.message.createdAt,
        unread: row.message.senderRole === "user" && !row.message.readAt ? 1 : 0,
        threadStatus: threadStateMap.get(key)?.status ?? "open",
        closedAt: threadStateMap.get(key)?.closedAt ?? null,
        closedBy: threadStateMap.get(key)?.closedBy ?? null,
        closedByName: threadStateMap.get(key)?.closedBy ? adminNames.get(threadStateMap.get(key)!.closedBy!) ?? null : null,
      });
    } else {
      existing.createdAt = row.message.createdAt;
      if (row.message.senderRole === "user" && !row.message.readAt) existing.unread += 1;
    }
  }
  return [...map.values()];
}

export async function listAdminSupportMessages(adminId: number, userId: number, category: SupportCategory) {
  await requireAdministrator(adminId);
  const db = await getDb();
  if (!db) return [];
  return listSupportMessagePage(db, userId, category, "user");
}

export async function replyToSupportMessage(
  adminId: number,
  userId: number,
  category: SupportCategory,
  body: string,
  attachment?: SupportAttachment,
  attachments?: SupportAttachment[],
) {
  await requireAdministrator(adminId);
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  const clean = body.trim();
  const images = normalizeAttachments(attachment, attachments);
  if (!clean && !images.length) throw new Error("اكتب الرد أو أرفق صورة قبل الإرسال");
  if (clean.length > 2000) throw new Error("الرد طويل جدًا");
  const inserted = await db.insert(supportMessages).values({
    userId,
    category,
    senderRole: "admin",
    adminId,
    body: clean || (images.length === 1 ? "[مرفق صورة]" : "[مرفقات صور]"),
    ...encodeAttachments(images),
  });
  // A normal reply is not a resolution. Closure is a separate explicit admin action.
  await setThreadState(db, userId, category, "open");
  const messageId = Number((inserted as any)?.[0]?.insertId ?? (inserted as any)?.insertId ?? Date.now());
  await db.insert(notifications).values({
    userId,
    title: "رد جديد من الإدارة",
    body: `لديك رد جديد في قسم ${category === "freeze" ? "تجميد الحسابات" : category === "external_transaction" ? "المعاملات الخارجية" : "مراسلات الحساب"}.`,
    type: "support_reply",
    operationId: `support:${userId}:${category}:reply:${messageId}`,
  });
  return { sent: true };
}


export async function closeSupportConversation(adminId: number, userId: number, category: SupportCategory) {
  await requireAdministrator(adminId);
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  const [message] = await db.select({ id: supportMessages.id }).from(supportMessages)
    .where(and(eq(supportMessages.userId, userId), eq(supportMessages.category, category))).limit(1);
  if (!message) throw new Error("المحادثة غير موجودة");
  await setThreadState(db, userId, category, "closed", adminId);
  return { closed: true };
}
