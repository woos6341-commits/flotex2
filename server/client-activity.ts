import { eq } from "drizzle-orm";
import { users } from "../drizzle/schema";
import { getDb } from "./db";

export async function reportClientActivity(
  userId: number,
  input: { version?: string; buildNumber?: string },
) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة الآن");
  const [account] = await db.select({ id: users.id, status: users.status }).from(users)
    .where(eq(users.id, userId)).limit(1);
  if (!account || account.status !== "active") throw new Error("الحساب غير متاح لتسجيل النشاط");
  const openedAt = new Date();
  await db.update(users).set({
    lastOpenedAt: openedAt,
    appVersion: input.version?.trim().slice(0, 32) || null,
    appBuildNumber: input.buildNumber?.trim().slice(0, 48) || null,
  }).where(eq(users.id, userId));
  return { recorded: true as const, openedAt };
}
