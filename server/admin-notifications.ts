import { and, desc, eq } from "drizzle-orm";
import { notifications, users } from "../drizzle/schema";
import { requireAdministrator } from "./payment-settings";
import { randomUUID } from "node:crypto";

export async function sendAdminNotification(adminId: number, input: { userId?: number; customerId?: string; title: string; body: string }) {
  const db = await requireAdministrator(adminId);
  const title = input.title.trim(); const body = input.body.trim();
  if (title.length < 2 || body.length < 2) throw new Error("أدخل عنوان الإشعار ونص الرسالة");
  if (input.userId && input.customerId) throw new Error("اختر رقم الحساب أو المعرف الداخلي، وليس كليهما");
  const targets = input.customerId
    ? await db.select({ id: users.id }).from(users).where(and(eq(users.customerId, input.customerId), eq(users.role, "user"))).limit(1)
    : input.userId
      ? await db.select({ id: users.id }).from(users).where(and(eq(users.id, input.userId), eq(users.role, "user"))).limit(1)
      : await db.select({ id: users.id }).from(users).where(eq(users.role, "user"));
  if (!targets.length) throw new Error("لم يتم العثور على مستخدمين صالحين للإرسال");
  const operationId = `admin-notification:${randomUUID()}`;
  await db.insert(notifications).values(targets.map((target) => ({ userId: target.id, createdBy: adminId, title, body, type: "admin", operationId })));
  return { operationId, recipientCount: targets.length };
}

export async function listAdminNotifications(adminId: number) {
  const db = await requireAdministrator(adminId);
  return db.select({ id: notifications.id, userId: notifications.userId, title: notifications.title, body: notifications.body, operationId: notifications.operationId, deliveredAt: notifications.deliveredAt, readAt: notifications.readAt, createdAt: notifications.createdAt, userName: users.name, userEmail: users.email }).from(notifications).innerJoin(users, eq(users.id, notifications.userId)).where(and(eq(notifications.createdBy, adminId), eq(notifications.type, "admin"))).orderBy(desc(notifications.createdAt), desc(notifications.id)).limit(200);
}
