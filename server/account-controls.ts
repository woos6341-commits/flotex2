import { eq, sql } from "drizzle-orm";
import { appSettings, userProfileAudits, users } from "../drizzle/schema";
import { requireAdministrator } from "./payment-settings";
import { getDb } from "./db";

const FROZEN_CUSTOMERS_KEY = "frozen_customer_ids";

async function readFrozenIds(db: any) {
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, FROZEN_CUSTOMERS_KEY)).limit(1);
  if (!row) return new Set<number>();
  try {
    const value: unknown = JSON.parse(row.value);
    if (!Array.isArray(value)) return new Set<number>();
    return new Set(value.filter((id): id is number => Number.isSafeInteger(id) && id > 0));
  } catch {
    return new Set<number>();
  }
}

export async function isCustomerAccountFrozen(userId: number) {
  const db = await getDb();
  if (!db) return false;
  return (await readFrozenIds(db)).has(userId);
}

export async function listFrozenCustomerIds(adminId: number) {
  const db = await requireAdministrator(adminId);
  return [...await readFrozenIds(db)];
}

export async function setCustomerAccountFrozen(adminId: number, targetUserId: number, frozen: boolean) {
  const db = await requireAdministrator(adminId);
  const lockName = "flotex-frozen-customer-ids";
  const lockResult: any = await db.execute(sql`SELECT GET_LOCK(${lockName}, 15) AS acquired`);
  const rows = Array.isArray(lockResult?.[0]) ? lockResult[0] : lockResult;
  if (Array.isArray(rows) && Number(rows[0]?.acquired) !== 1) throw new Error("تعذر حجز قفل تحديث حالة الحساب؛ أعد المحاولة");
  try {
    return await db.transaction(async (tx) => {
      const [target] = await tx.select({ id: users.id, role: users.role }).from(users)
        .where(eq(users.id, targetUserId)).for("update").limit(1);
      if (!target) throw new Error("حساب العميل غير موجود");
      if (target.role === "admin") throw new Error("لا يمكن تجميد حساب المدير المعتمد");
      const ids = await readFrozenIds(tx);
      const wasFrozen = ids.has(targetUserId);
      if (frozen) ids.add(targetUserId); else ids.delete(targetUserId);
      if (wasFrozen === frozen) return { userId: targetUserId, frozen, unchanged: true };
      const value = JSON.stringify([...ids].sort((a, b) => a - b));
      await tx.insert(appSettings).values({ key: FROZEN_CUSTOMERS_KEY, value, updatedBy: adminId })
        .onDuplicateKeyUpdate({ set: { value, updatedBy: adminId } });
      const now = new Date();
      await tx.insert(userProfileAudits).values({
        adminId,
        targetUserId,
        changes: JSON.stringify({
          event: "account_freeze_status",
          from: wasFrozen ? "frozen" : "active",
          to: frozen ? "frozen" : "active",
          occurredAt: now.toISOString(),
        }),
      });
      return { userId: targetUserId, frozen, unchanged: false };
    });
  } finally {
    await db.execute(sql`SELECT RELEASE_LOCK(${lockName})`);
  }
}
