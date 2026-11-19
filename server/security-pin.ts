import { and, eq, or } from "drizzle-orm";
import { accountVerificationOverrides, accountVerifications, users } from "../drizzle/schema";
import { hashPassword, verifyPassword } from "./manual-auth-crypto";
import { getDb } from "./db";
import { revokeAllDeviceSessions } from "./session-management";

const PIN = /^\d{4}$/;

function assertPin(pin: string) {
  if (!PIN.test(pin)) throw new Error("رمز الأمان يجب أن يتكون من 4 أرقام");
}

export async function getSecurityPinStatus(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  const [user] = await db.select({ hash: users.securityPinHash }).from(users).where(eq(users.id, userId)).limit(1);
  return { configured: Boolean(user?.hash) };
}

export async function setSecurityPin(userId: number, newPin: string, currentPin?: string) {
  assertPin(newPin);
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  const [user] = await db.select({ hash: users.securityPinHash }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new Error("الحساب غير موجود");
  if (user.hash) {
    if (!currentPin || !(await verifyPassword(currentPin, user.hash))) throw new Error("رمز الأمان الحالي غير صحيح");
  }
  await db.update(users).set({ securityPinHash: await hashPassword(newPin), securityPinUpdatedAt: new Date() }).where(eq(users.id, userId));
  await revokeAllDeviceSessions(userId, "تغيير رمز الأمان");
  return { configured: true };
}

export async function resetSecurityPinAfterVerification(userId: number, newPin: string) {
  assertPin(newPin);
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  const [verified] = await db.select({ id: accountVerifications.id }).from(accountVerifications).where(and(eq(accountVerifications.userId, userId), eq(accountVerifications.status, "approved"))).limit(1);
  const [override] = await db.select({ id: accountVerificationOverrides.id }).from(accountVerificationOverrides).where(and(eq(accountVerificationOverrides.userId, userId), eq(accountVerificationOverrides.status, "manual_verified"))).limit(1);
  if (!verified && !override) throw new Error("إعادة تعيين رمز الأمان متاحة بعد اعتماد توثيق الحساب من الإدارة فقط");
  await db.update(users).set({ securityPinHash: await hashPassword(newPin), securityPinUpdatedAt: new Date() }).where(eq(users.id, userId));
  await revokeAllDeviceSessions(userId, "تغيير رمز الأمان");
  return { configured: true };
}

export async function requireValidSecurityPin(userId: number, pin: string) {
  assertPin(pin);
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  const [user] = await db.select({ hash: users.securityPinHash }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user?.hash) throw new Error("أنشئ رمز الأمان من حسابي قبل تأكيد العملية");
  if (!(await verifyPassword(pin, user.hash))) throw new Error("رمز الأمان غير صحيح");
}

export async function getAdminSecurityPinStatus(adminId: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  const [admin] = await db.select({ role: users.role }).from(users).where(eq(users.id, adminId)).limit(1);
  if (admin?.role !== "admin") throw new Error("غير مصرح");
  const [user] = await db.select({ configured: users.securityPinHash }).from(users).where(eq(users.id, userId)).limit(1);
  return { configured: Boolean(user?.configured) };
}
