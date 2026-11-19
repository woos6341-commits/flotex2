import { and, desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { userEmailDeliveries, users } from "../drizzle/schema";
import { getDb } from "./db";
import { requireAdministrator } from "./payment-settings";
import { sendConfiguredEmail } from "./manual-auth";

export async function sendCustomerEmail(adminId: number, input: { userId: number; subject: string; body: string }) {
  const db = await requireAdministrator(adminId);
  const [user] = await db.select({ id: users.id, email: users.email, emailNormalized: users.emailNormalized }).from(users).where(and(eq(users.id, input.userId), eq(users.role, "user"))).limit(1);
  const toEmail = (user?.emailNormalized ?? user?.email ?? "").trim().toLowerCase();
  if (!user || !toEmail) throw new Error("لا يوجد بريد إلكتروني للعميل");
  const reference = `EMAIL-${randomUUID()}`;
  const now = new Date();
  await db.insert(userEmailDeliveries).values({ reference, adminId, userId: user.id, toEmail, subject: input.subject.trim(), body: input.body, status: "pending", createdAt: now });
  try {
    await sendConfiguredEmail(toEmail, input.subject.trim(), input.body);
    await db.update(userEmailDeliveries).set({ status: "sent", sentAt: new Date() }).where(eq(userEmailDeliveries.reference, reference));
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 1000) : "تعذر إرسال البريد";
    await db.update(userEmailDeliveries).set({ status: "failed", error: message }).where(eq(userEmailDeliveries.reference, reference));
    throw new Error("تعذر إرسال البريد الإلكتروني؛ تم حفظ المحاولة كسجل فاشل");
  }
  const [delivery] = await db.select().from(userEmailDeliveries).where(eq(userEmailDeliveries.reference, reference)).limit(1);
  return delivery;
}

export async function getEmailDeliveryHistory(adminId: number, userId?: number) {
  const db = await requireAdministrator(adminId);
  return db.select().from(userEmailDeliveries).where(userId ? eq(userEmailDeliveries.userId, userId) : undefined).orderBy(desc(userEmailDeliveries.createdAt)).limit(200);
}
