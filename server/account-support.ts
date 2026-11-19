import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { authSupportSessions } from "../drizzle/auth-schema";
import { supportMessages, users } from "../drizzle/schema";
import { hashOpaqueGrant } from "./manual-auth-crypto";
import { getDb } from "./db";

const SUPPORT_RATE_WINDOW_MS = 15 * 60 * 1000;
const SUPPORT_MAX_MESSAGES_PER_WINDOW = 8;

function tokenDigest(token: string) {
  if (token.length < 40 || token.length > 64 || !/^[A-Za-z0-9_-]+$/.test(token)) throw new Error("انتهت صلاحية جلسة الدعم؛ اطلب رمز تحقق جديدًا.");
  return hashOpaqueGrant(token);
}

async function findSupportAccount(db: any, token: string) {
  const [session] = await db.select({ id: authSupportSessions.id, userId: authSupportSessions.userId, expiresAt: authSupportSessions.expiresAt, revokedAt: authSupportSessions.revokedAt })
    .from(authSupportSessions).where(eq(authSupportSessions.tokenHash, tokenDigest(token))).limit(1);
  if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) throw new Error("انتهت صلاحية جلسة الدعم؛ اطلب رمز تحقق جديدًا.");
  const [user] = await db.select({ id: users.id, status: users.status, role: users.role }).from(users).where(eq(users.id, session.userId)).limit(1);
  if (!user || user.role !== "user" || user.status !== "deleted") throw new Error("جلسة الدعم غير متاحة لهذا الحساب.");
  return user.id;
}

function toMessage(row: typeof supportMessages.$inferSelect) {
  return { id: row.id, userId: row.userId, senderRole: row.senderRole, body: row.body, attachment: null, readAt: row.readAt, createdAt: row.createdAt };
}

export async function listDeletedAccountSupportMessages(token: string) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  const userId = await findSupportAccount(db, token);
  await db.update(supportMessages).set({ readAt: new Date() }).where(and(eq(supportMessages.userId, userId), eq(supportMessages.senderRole, "admin"), isNull(supportMessages.readAt)));
  const rows = await db.select().from(supportMessages).where(eq(supportMessages.userId, userId)).orderBy(supportMessages.createdAt).limit(200);
  return rows.map(toMessage);
}

export async function sendDeletedAccountSupportMessage(token: string, body: string) {
  const clean = body.trim();
  if (!clean) throw new Error("اكتب رسالة للدعم قبل الإرسال.");
  if (clean.length > 2000) throw new Error("الرسالة طويلة جدًا");
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  const userId = await findSupportAccount(db, token);
  const since = new Date(Date.now() - SUPPORT_RATE_WINDOW_MS);
  const [recent] = await db.select({ count: sql<number>`COUNT(*)` }).from(supportMessages)
    .where(and(eq(supportMessages.userId, userId), eq(supportMessages.senderRole, "user"), gt(supportMessages.createdAt, since)));
  if (Number(recent?.count ?? 0) >= SUPPORT_MAX_MESSAGES_PER_WINDOW) throw new Error("تم تجاوز حد الرسائل المؤقت؛ حاول بعد قليل.");
  await db.insert(supportMessages).values({ userId, senderRole: "user", body: clean });
  return { sent: true };
}
