import { and, desc, eq, isNull } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import type { Request } from "express";
import { authDeviceSessions, authLoginChallenges } from "../drizzle/auth-schema";
import { users } from "../drizzle/schema";
import { currentSessionCookie } from "./_core/cookies";
import { getDb } from "./db";
import { verifyPassword } from "./manual-auth-crypto";

const LOGIN_CHALLENGE_TTL_MS = 10 * 60 * 1000;
function hashToken(value: string) { return createHash("sha256").update(value).digest("hex"); }
function normalizedDeviceId(value: string | undefined) { return (value?.trim() || "unknown-device").slice(0, 128); }
export type DeviceMeta = { deviceId?: string; deviceName?: string; platform?: string };
export function deviceMeta(input: DeviceMeta | undefined) {
  return { deviceId: normalizedDeviceId(input?.deviceId), deviceName: input?.deviceName?.trim().slice(0, 160) || undefined, platform: input?.platform?.trim().slice(0, 32) || undefined };
}
export function requestSessionToken(req: Request): string | undefined {
  const auth = req.headers.authorization || req.headers.Authorization;
  if (typeof auth === "string" && auth.startsWith("Bearer ")) return auth.slice(7).trim();
  return currentSessionCookie(req) || undefined;
}
export async function hasTrustedDevice(userId: number, input: DeviceMeta) {
  const db = await getDb(); if (!db) return false;
  const meta = deviceMeta(input);
  const [row] = await db.select({ id: authDeviceSessions.id }).from(authDeviceSessions)
    .where(and(eq(authDeviceSessions.userId, userId), eq(authDeviceSessions.deviceId, meta.deviceId), isNull(authDeviceSessions.revokedAt))).limit(1);
  return Boolean(row);
}
export async function issueLoginChallenge(userId: number, input: DeviceMeta) {
  const db = await getDb(); if (!db) throw new Error("قاعدة البيانات غير متاحة الآن");
  const meta = deviceMeta(input);
  const token = randomUUID() + randomUUID().replace(/-/g, "");
  await db.insert(authLoginChallenges).values({
    id: randomUUID(), userId, challengeHash: hashToken(token), deviceId: meta.deviceId,
    deviceName: meta.deviceName, platform: meta.platform,
    expiresAt: new Date(Date.now() + LOGIN_CHALLENGE_TTL_MS),
  });
  return token;
}
export async function completeLoginChallenge(challengeToken: string, pin: string, input: DeviceMeta) {
  const db = await getDb(); if (!db) throw new Error("قاعدة البيانات غير متاحة الآن");
  const meta = deviceMeta(input);
  return db.transaction(async (tx: any) => {
    const [challenge] = await tx.select().from(authLoginChallenges).where(eq(authLoginChallenges.challengeHash, hashToken(challengeToken))).for("update").limit(1);
    if (!challenge || challenge.consumedAt || challenge.expiresAt.getTime() <= Date.now() || challenge.deviceId !== meta.deviceId) throw new Error("انتهت صلاحية طلب التحقق من الجهاز. أعد تسجيل الدخول.");
    const [user] = await tx.select().from(users).where(eq(users.id, challenge.userId)).limit(1);
    if (!user || user.status !== "active" || !user.securityPinHash || !(await verifyPassword(pin, user.securityPinHash))) throw new Error("رمز الأمان غير صحيح أو الحساب غير متاح");
    await tx.update(authLoginChallenges).set({ consumedAt: new Date() }).where(eq(authLoginChallenges.id, challenge.id));
    return user;
  });
}
export async function registerDeviceSession(userId: number, sessionToken: string, input: DeviceMeta) {
  const db = await getDb(); if (!db) return;
  const meta = deviceMeta(input);
  const tokenHash = hashToken(sessionToken);
  const [existing] = await db.select({ id: authDeviceSessions.id })
    .from(authDeviceSessions)
    .where(and(eq(authDeviceSessions.userId, userId), eq(authDeviceSessions.deviceId, meta.deviceId), isNull(authDeviceSessions.revokedAt)))
    .limit(1);
  if (existing) {
    // Sliding refresh replaces the token for this device instead of creating a
    // new session row on every launch. The old token is no longer accepted.
    await db.update(authDeviceSessions).set({
      tokenHash,
      revokedAt: null,
      revokeReason: null,
      lastActivityAt: new Date(),
      trustedAt: new Date(),
      deviceName: meta.deviceName,
      platform: meta.platform,
    }).where(eq(authDeviceSessions.id, existing.id));
    return;
  }
  await db.insert(authDeviceSessions).values({ userId, tokenHash, deviceId: meta.deviceId, deviceName: meta.deviceName, platform: meta.platform }).onDuplicateKeyUpdate({ set: { userId, revokedAt: null, revokeReason: null, lastActivityAt: new Date(), trustedAt: new Date(), deviceName: meta.deviceName, platform: meta.platform } });
}
export async function isPresentedSessionRevoked(userId: number, sessionToken: string | undefined) {
  if (!sessionToken) return false;
  const db = await getDb(); if (!db) return false;
  const [row] = await db.select({ id: authDeviceSessions.id, revokedAt: authDeviceSessions.revokedAt }).from(authDeviceSessions)
    .where(and(eq(authDeviceSessions.userId, userId), eq(authDeviceSessions.tokenHash, hashToken(sessionToken)))).limit(1);
  if (!row) return false;
  if (row.revokedAt) return true;
  await db.update(authDeviceSessions).set({ lastActivityAt: new Date() }).where(eq(authDeviceSessions.id, row.id));
  return false;
}
export async function listDeviceSessions(userId: number, currentToken?: string) {
  const db = await getDb(); if (!db) return [];
  const rows = await db.select({ id: authDeviceSessions.id, deviceId: authDeviceSessions.deviceId, deviceName: authDeviceSessions.deviceName, platform: authDeviceSessions.platform, createdAt: authDeviceSessions.createdAt, lastActivityAt: authDeviceSessions.lastActivityAt, trustedAt: authDeviceSessions.trustedAt, revokedAt: authDeviceSessions.revokedAt, tokenHash: authDeviceSessions.tokenHash }).from(authDeviceSessions).where(eq(authDeviceSessions.userId, userId)).orderBy(desc(authDeviceSessions.lastActivityAt));
  const currentHash = currentToken ? hashToken(currentToken) : "";
  return rows.map(({ tokenHash, ...row }) => ({ ...row, current: currentHash === tokenHash, active: !row.revokedAt, label: row.deviceName || row.platform || "جهاز غير مسمى" }));
}
export async function revokeDeviceSession(userId: number, sessionId: number, reason = "تسجيل خروج عن بُعد") {
  const db = await getDb(); if (!db) throw new Error("قاعدة البيانات غير متاحة الآن");
  await db.update(authDeviceSessions).set({ revokedAt: new Date(), revokeReason: reason }).where(and(eq(authDeviceSessions.id, sessionId), eq(authDeviceSessions.userId, userId)));
}
export async function revokeAllDeviceSessions(userId: number, reason = "إبطال الجلسات لأسباب أمنية") {
  const db = await getDb(); if (!db) return;
  await db.update(authDeviceSessions).set({ revokedAt: new Date(), revokeReason: reason }).where(and(eq(authDeviceSessions.userId, userId), isNull(authDeviceSessions.revokedAt)));
}
