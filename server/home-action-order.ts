import { eq } from "drizzle-orm";
import { appSettings, users } from "../drizzle/schema";
import {
  DEFAULT_HOME_ACTION_ORDER,
  isValidHomeActionOrder,
  normalizeHomeActionOrder,
  resolveEffectiveHomeActionOrder,
  type HomeActionOrderId,
} from "../shared/home-action-order";
import { getDb } from "./db";
import { requireAdministrator } from "./payment-settings";
import { recordButtonLayoutAudit } from "./button-layout";

const HOME_ACTION_ORDER_KEY = "home_action_order_v1";
const USER_ORDER_KEY_PREFIX = "home_action_order_user_v1:";
const userOrderKey = (userId: number) => `${USER_ORDER_KEY_PREFIX}${userId}`;

function parseOrder(value: string | null | undefined, fallback: unknown): HomeActionOrderId[] {
  if (!value) return normalizeHomeActionOrder(fallback);
  try {
    return resolveEffectiveHomeActionOrder(JSON.parse(value) as unknown, fallback);
  } catch {
    return normalizeHomeActionOrder(fallback);
  }
}

async function readGlobalOrder(db: NonNullable<Awaited<ReturnType<typeof getDb>>>) {
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, HOME_ACTION_ORDER_KEY)).limit(1);
  return parseOrder(row?.value, DEFAULT_HOME_ACTION_ORDER);
}

async function assertCustomer(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, userId: number) {
  const [target] = await db.select({ id: users.id, role: users.role, name: users.name, customerId: users.customerId })
    .from(users).where(eq(users.id, userId)).limit(1);
  if (!target || target.role !== "user") throw new Error("حساب العميل غير موجود");
  return target;
}

export async function getHomeActionOrder(): Promise<HomeActionOrderId[]> {
  const db = await getDb();
  if (!db) return [...DEFAULT_HOME_ACTION_ORDER];
  return readGlobalOrder(db);
}

/** User overrides inherit the live global order until an administrator saves a personal order. */
export async function getHomeActionOrderForUser(userId: number): Promise<HomeActionOrderId[]> {
  const db = await getDb();
  if (!db) return [...DEFAULT_HOME_ACTION_ORDER];
  const globalOrder = await readGlobalOrder(db);
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, userOrderKey(userId))).limit(1);
  return row ? parseOrder(row.value, globalOrder) : globalOrder;
}

export async function getAdminCustomerHomeActionOrder(adminId: number, userId: number) {
  const db = await requireAdministrator(adminId);
  const user = await assertCustomer(db, userId);
  const [globalOrder, row] = await Promise.all([
    readGlobalOrder(db),
    db.select().from(appSettings).where(eq(appSettings.key, userOrderKey(userId))).limit(1).then((rows) => rows[0]),
  ]);
  return {
    user,
    order: row ? parseOrder(row.value, globalOrder) : globalOrder,
    globalOrder,
    inherited: !row,
    updatedAt: row?.updatedAt ?? null,
    updatedBy: row?.updatedBy ?? null,
  };
}

export async function updateHomeActionOrder(adminId: number, order: unknown): Promise<HomeActionOrderId[]> {
  if (!isValidHomeActionOrder(order)) throw new Error("ترتيب أزرار الرئيسية غير صالح");
  const db = await requireAdministrator(adminId);
  const value = JSON.stringify(order);
  await db.transaction(async (tx) => {
    const [before] = await tx.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, HOME_ACTION_ORDER_KEY)).for("update").limit(1);
    await tx.insert(appSettings).values({ key: HOME_ACTION_ORDER_KEY, value, updatedBy: adminId })
      .onDuplicateKeyUpdate({ set: { value, updatedBy: adminId, updatedAt: new Date() } });
    await recordButtonLayoutAudit(tx, { actorId: adminId, surface: "home", action: "legacy-global", before: before?.value ?? null, after: order });
  });
  return [...order];
}

export async function setCustomerHomeActionOrder(adminId: number, userId: number, order: unknown) {
  if (!isValidHomeActionOrder(order)) throw new Error("ترتيب أزرار الرئيسية غير صالح");
  const db = await requireAdministrator(adminId);
  await assertCustomer(db, userId);
  const value = JSON.stringify(order);
  await db.transaction(async (tx) => {
    const [before] = await tx.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, userOrderKey(userId))).for("update").limit(1);
    await tx.insert(appSettings).values({ key: userOrderKey(userId), value, updatedBy: adminId })
      .onDuplicateKeyUpdate({ set: { value, updatedBy: adminId, updatedAt: new Date() } });
    await recordButtonLayoutAudit(tx, { actorId: adminId, surface: "home", action: "legacy-customer", targetUserId: userId, before: before?.value ?? null, after: order });
  });
  return getAdminCustomerHomeActionOrder(adminId, userId);
}

export async function resetCustomerHomeActionOrder(adminId: number, userId: number) {
  const db = await requireAdministrator(adminId);
  await assertCustomer(db, userId);
  await db.transaction(async (tx) => {
    const [before] = await tx.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, userOrderKey(userId))).for("update").limit(1);
    await tx.delete(appSettings).where(eq(appSettings.key, userOrderKey(userId)));
    await recordButtonLayoutAudit(tx, { actorId: adminId, surface: "home", action: "legacy-customer-reset", targetUserId: userId, before: before?.value ?? null, after: null });
  });
  return getAdminCustomerHomeActionOrder(adminId, userId);
}
