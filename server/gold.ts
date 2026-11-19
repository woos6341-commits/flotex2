import { and, desc, eq } from "drizzle-orm";
import { goldOrders, goldPriceSnapshots, goldSettings, goldPositions } from "../drizzle/schema";
import { getDb } from "./db";
import { fetchGoldQuote, getGoldPriceSourceStatus } from "./providers/gold";
import { requireValidSecurityPin } from "./security-pin";

const KARATS = ["24", "21", "18"] as const;
type Karat = typeof KARATS[number];

function assertKarat(value: string): asserts value is Karat {
  if (!KARATS.includes(value as Karat)) throw new Error("عيار الذهب غير مدعوم");
}

function n(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) throw new Error("قيمة مالية غير صالحة");
  return parsed;
}

function money(value: number) { return value.toFixed(2); }
function grams(value: number) { return value.toFixed(6); }

async function ensureGoldSettings() {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  const [settings] = await db.select().from(goldSettings).limit(1);
  if (settings) return settings;
  await db.insert(goldSettings).values({});
  const [created] = await db.select().from(goldSettings).limit(1);
  if (!created) throw new Error("تعذر إنشاء إعدادات الذهب");
  return created;
}

function priceForKarat(snapshot: { gram24: string; gram21: string; gram18: string; bid: string | null; ask: string | null }, karat: Karat, side: "buy" | "sell", settings: Awaited<ReturnType<typeof ensureGoldSettings>>) {
  const base = karat === "24" ? n(snapshot.gram24) : karat === "21" ? n(snapshot.gram21) : n(snapshot.gram18);
  const spread = side === "buy" ? n(settings.buySpreadPerGram) : n(settings.sellSpreadPerGram);
  const making = side === "buy" ? n(settings.makingChargePerGram) : 0;
  const reference = side === "buy" ? snapshot.ask : snapshot.bid;
  const referenceGram24 = reference == null ? 0 : n(reference) / 31.1034768;
  const marketBase = referenceGram24 > 0 ? referenceGram24 * Number(karat) / 24 : base;
  const result = side === "buy" ? marketBase + spread + making : marketBase - spread;
  if (result <= 0) throw new Error("سعر الذهب المحسوب غير صالح");
  return result;
}

export async function getGoldStatus() {
  const settings = await ensureGoldSettings();
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  const [latest] = await db.select().from(goldPriceSnapshots).orderBy(desc(goldPriceSnapshots.quotedAt), desc(goldPriceSnapshots.id)).limit(1);
  return { source: getGoldPriceSourceStatus(), settings, latest, stale: latest ? Date.now() - new Date(latest.quotedAt).getTime() > 15 * 60 * 1000 : true };
}

export async function refreshGoldPrices() {
  const quote = await fetchGoldQuote();
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  await db.insert(goldPriceSnapshots).values({ ...quote, isIndicative: quote.isIndicative ? 1 : 0 });
  return quote;
}

export async function listGoldPrices() {
  const status = await getGoldStatus();
  return { ...status, prices: status.latest ? [
    { karat: "24", gram: status.latest.gram24 },
    { karat: "21", gram: status.latest.gram21 },
    { karat: "18", gram: status.latest.gram18 },
  ] : [] };
}

export async function getGoldOrderPreview(input: { karat: string; side: "buy" | "sell"; grams: string }) {
  assertKarat(input.karat);
  const quantity = n(input.grams);
  if (quantity <= 0) throw new Error("أدخل كمية ذهب أكبر من صفر");
  const status = await getGoldStatus();
  if (!status.settings.enabled) throw new Error("نظام الذهب غير مفعّل من الإدارة بعد");
  if (!status.latest) throw new Error("سعر الذهب غير متاح حاليًا؛ لا يمكن إنشاء طلب بسعر غير موثق");
  if (quantity < n(status.settings.minGrams) || quantity > n(status.settings.maxGrams)) throw new Error(`الكمية يجب أن تكون بين ${status.settings.minGrams} و${status.settings.maxGrams} جرام`);
  const unitPrice = priceForKarat(status.latest, input.karat, input.side, status.settings);
  const fee = input.side === "buy" ? n(status.settings.buyFee) : n(status.settings.sellFee);
  const gross = quantity * unitPrice;
  return { karat: input.karat, side: input.side, grams: grams(quantity), unitPrice: unitPrice.toFixed(4), grossAmount: money(gross), feeAmount: money(fee), totalAmount: money(input.side === "buy" ? gross + fee : gross - fee), quotedAt: status.latest.quotedAt, stale: status.stale, executionEnabled: false };
}

export async function createGoldOrder(userId: number, input: { karat: string; side: "buy" | "sell"; grams: string; securityPin: string; idempotencyKey: string }) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  await requireValidSecurityPin(userId, input.securityPin);
  const preview = await getGoldOrderPreview(input);
  if (preview.stale) throw new Error("سعر الذهب المحفوظ قديم؛ حدّث الأسعار قبل إرسال الطلب");
  const [existing] = await db.select().from(goldOrders).where(eq(goldOrders.idempotencyKey, input.idempotencyKey)).limit(1);
  if (existing) return { order: existing, duplicate: true, executed: false };
  const reference = `GOLD-${userId}-${Date.now()}`;
  await db.insert(goldOrders).values({ reference, idempotencyKey: input.idempotencyKey, userId, side: input.side, karat: input.karat as Karat, grams: preview.grams, unitPrice: preview.unitPrice, grossAmount: preview.grossAmount, feeAmount: preview.feeAmount, status: "pending_review" });
  const [order] = await db.select().from(goldOrders).where(eq(goldOrders.reference, reference)).limit(1);
  return { order, duplicate: false, executed: false, message: "تم تسجيل طلب الذهب للمراجعة، ولم يتم خصم أموال أو نقل ملكية قبل توفر جهة تنفيذ مرخصة." };
}

export async function listMyGold(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  const [prices, positions, orders] = await Promise.all([
    listGoldPrices(),
    db.select().from(goldPositions).where(eq(goldPositions.userId, userId)).orderBy(goldPositions.karat),
    db.select().from(goldOrders).where(eq(goldOrders.userId, userId)).orderBy(desc(goldOrders.createdAt)).limit(100),
  ]);
  return { prices, positions, orders };
}
