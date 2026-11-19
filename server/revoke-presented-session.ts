import { createHash } from "node:crypto";
import { authDeviceSessions } from "../drizzle/auth-schema";
import { getDb } from "./db";

/** A tombstone also revokes legacy sessions not yet present in device-session rows. */
export async function revokePresentedSession(userId: number, token: string | undefined) {
  if (!token) throw new Error("تعذر تحديد الجلسة المطلوب إبطالها.");
  const db = await getDb();
  if (!db) throw new Error("تعذر الاتصال بقاعدة البيانات لإبطال الجلسة.");
  const revokedAt = new Date();
  const tokenHash = createHash("sha256").update(token).digest("hex");
  await db.insert(authDeviceSessions).values({
    userId, tokenHash, deviceId: "logged-out-session", deviceName: "جلسة مسجلة الخروج",
    revokedAt, revokeReason: "تسجيل خروج",
  }).onDuplicateKeyUpdate({ set: { revokedAt, revokeReason: "تسجيل خروج" } });
}
