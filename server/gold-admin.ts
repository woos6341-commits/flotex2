import { and, desc, eq } from "drizzle-orm";
import { goldFundingWallets, goldInventory, goldInventoryLedger, goldOrders, goldPriceSnapshots, goldSettings } from "../drizzle/schema";
import { getDb } from "./db";
import { getGoldStatus } from "./gold";

const KARATS = ["24", "21", "18"] as const;
type Karat = typeof KARATS[number];
function assertKarat(value: string): asserts value is Karat { if (!KARATS.includes(value as Karat)) throw new Error("عيار الذهب غير مدعوم"); }
function positive(value: string) { const n = Number(value); if (!Number.isFinite(n) || n <= 0) throw new Error("أدخل كمية موجبة"); return n; }

async function ensureAdminWallet(adminId: number, tx?: any) {
  const db = tx ?? await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  let [wallet] = await db.select().from(goldFundingWallets).where(eq(goldFundingWallets.adminId, adminId)).limit(1);
  if (!wallet) {
    await db.insert(goldFundingWallets).values({ adminId });
    [wallet] = await db.select().from(goldFundingWallets).where(eq(goldFundingWallets.adminId, adminId)).limit(1);
  }
  if (!wallet) throw new Error("تعذر إنشاء محفظة تمويل الذهب");
  return wallet;
}

async function ensureInventory(walletId: number, karat: Karat, tx: any) {
  let [row] = await tx.select().from(goldInventory).where(and(eq(goldInventory.walletId, walletId), eq(goldInventory.karat, karat))).limit(1);
  if (!row) {
    await tx.insert(goldInventory).values({ walletId, karat });
    [row] = await tx.select().from(goldInventory).where(and(eq(goldInventory.walletId, walletId), eq(goldInventory.karat, karat))).limit(1);
  }
  if (!row) throw new Error("تعذر إنشاء سجل مخزون الذهب");
  return row;
}

export async function getAdminGoldDashboard(adminId: number) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  const wallet = await ensureAdminWallet(adminId);
  const [settings] = await db.select().from(goldSettings).limit(1);
  const inventory = await db.select().from(goldInventory).where(eq(goldInventory.walletId, wallet.id)).orderBy(goldInventory.karat);
  const ledger = await db.select().from(goldInventoryLedger).where(eq(goldInventoryLedger.walletId, wallet.id)).orderBy(desc(goldInventoryLedger.createdAt)).limit(100);
  const orders = await db.select().from(goldOrders).orderBy(desc(goldOrders.createdAt)).limit(100);
  const prices = await db.select().from(goldPriceSnapshots).orderBy(desc(goldPriceSnapshots.quotedAt)).limit(1);
  return { wallet, settings, inventory, ledger, orders, latestPrice: prices[0] ?? null, source: (await getGoldStatus()).source };
}

export async function updateGoldSettings(adminId: number, input: { enabled: boolean; buyFee: string; sellFee: string; buySpreadPerGram: string; sellSpreadPerGram: string; makingChargePerGram: string; minGrams: string; maxGrams: string }) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  for (const value of [input.buyFee, input.sellFee, input.buySpreadPerGram, input.sellSpreadPerGram, input.makingChargePerGram, input.minGrams, input.maxGrams]) positive(value);
  if (Number(input.maxGrams) < Number(input.minGrams)) throw new Error("الحد الأقصى يجب أن يكون أكبر من الحد الأدنى");
  const [existing] = await db.select().from(goldSettings).limit(1);
  const values = { enabled: input.enabled ? 1 : 0, buyFee: input.buyFee, sellFee: input.sellFee, buySpreadPerGram: input.buySpreadPerGram, sellSpreadPerGram: input.sellSpreadPerGram, makingChargePerGram: input.makingChargePerGram, minGrams: input.minGrams, maxGrams: input.maxGrams, updatedBy: adminId };
  if (existing) await db.update(goldSettings).set(values).where(eq(goldSettings.id, existing.id));
  else await db.insert(goldSettings).values(values);
  return getAdminGoldDashboard(adminId);
}

export async function recordGoldInventoryEntry(adminId: number, input: { karat: string; direction: "credit" | "debit"; grams: string; cashAmount?: string; source: string; idempotencyKey: string }) {
  assertKarat(input.karat);
  const karat = input.karat;
  const gramsValue = positive(input.grams);
  const cash = input.cashAmount ? Number(input.cashAmount) : 0;
  if (!Number.isFinite(cash) || cash < 0) throw new Error("قيمة نقدية غير صالحة");
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  return db.transaction(async (tx: any) => {
    const [duplicate] = await tx.select().from(goldInventoryLedger).where(eq(goldInventoryLedger.idempotencyKey, input.idempotencyKey)).limit(1);
    if (duplicate) return { entry: duplicate, duplicate: true };
    const wallet = await ensureAdminWallet(adminId, tx);
    const current = await ensureInventory(wallet.id, karat, tx);
    const before = Number(current.availableGrams);
    const after = input.direction === "credit" ? before + gramsValue : before - gramsValue;
    if (after < -1e-9) throw new Error("لا يمكن خصم كمية أكبر من مخزون الذهب المتاح");
    const result = await tx.update(goldInventory).set({ availableGrams: after.toFixed(6) }).where(and(eq(goldInventory.id, current.id), input.direction === "debit" ? eq(goldInventory.availableGrams, current.availableGrams) : eq(goldInventory.id, current.id))) as any;
    if (Number(result?.[0]?.affectedRows ?? result?.affectedRows ?? 0) !== 1) throw new Error("تغير المخزون بالتزامن؛ أعد المحاولة");
    const reference = `GOLD-INV-${adminId}-${Date.now()}`;
    await tx.insert(goldInventoryLedger).values({ walletId: wallet.id, adminId, karat, direction: input.direction, grams: input.grams, cashAmount: cash.toFixed(2), source: input.source.trim().slice(0, 180), reference, idempotencyKey: input.idempotencyKey, balanceAfterGrams: after.toFixed(6) });
    const [entry] = await tx.select().from(goldInventoryLedger).where(eq(goldInventoryLedger.reference, reference)).limit(1);
    return { entry, duplicate: false };
  });
}

export async function reviewGoldOrder(adminId: number, orderId: number, decision: "awaiting_execution" | "rejected", reason?: string) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  const [order] = await db.select().from(goldOrders).where(eq(goldOrders.id, orderId)).limit(1);
  if (!order || order.status !== "pending_review") throw new Error("طلب الذهب غير متاح للمراجعة");
  await db.update(goldOrders).set({ status: decision, rejectionReason: decision === "rejected" ? reason?.trim() || "رُفض الطلب دون تفاصيل" : null, reviewedBy: adminId, reviewedAt: new Date() }).where(eq(goldOrders.id, orderId));
  return { success: true, executed: false };
}
