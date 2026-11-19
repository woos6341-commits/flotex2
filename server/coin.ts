import { aliasedTable, and, desc, eq, gte, inArray, or, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  coinLedgerEntries,
  coinOrders,
  coinPriceAudits,
  coinSettings,
  coinTreasuries,
  coinTransfers,
  coinWallets,
  notifications,
  transactions,
  users,
  wallets,
} from "../drizzle/schema";
import { getDb } from "./db";
import { requireAdministrator } from "./payment-settings";
import { sendPushOnce } from "./push";
import { addDecimal, subtractDecimal, decimal, scaled, quoteCoinOrder } from "./coin-math";
import { requireValidSecurityPin } from "./security-pin";

const SETTINGS_ID = 1;
const TREASURY_ID = 1;
const COIN_NAME = "كوين فولتكس";

function numberValue(value: string | number | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function fixed(value: number, scale = 2): string {
  const factor = 10 ** scale;
  return (Math.round((value + Number.EPSILON) * factor) / factor).toFixed(scale);
}

function normalizeNumeric(value: string): string {
  return value.trim().replace(/[٬,]/g, "").replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)));
}

function quantity(value: string): number {
  const normalized = normalizeNumeric(value);
  if (!/^\d+(?:\.\d{1,6})?$/.test(normalized)) throw new Error("أدخل كمية كوين صحيحة حتى 6 منازل عشرية");
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1_000_000_000) throw new Error("أدخل كمية كوين صحيحة أكبر من صفر");
  return Number(fixed(parsed, 6));
}

function signedQuantity(value: string): number {
  const normalized = normalizeNumeric(value);
  if (!/^[+-]?\d+(?:\.\d{1,6})?$/.test(normalized)) throw new Error("أدخل كمية كوين صحيحة حتى 6 منازل عشرية");
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed === 0 || Math.abs(parsed) > 1_000_000_000) throw new Error("كمية الكوين يجب أن تكون أكبر من صفر");
  return Number(fixed(parsed, 6));
}

function amount(value: string): number {
  const normalized = normalizeNumeric(value);
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) throw new Error("أدخل مبلغًا صحيحًا حتى منزلتين عشريتين");
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 99_999_999_999) throw new Error("أدخل مبلغًا صحيحًا");
  return Number(fixed(parsed, 2));
}

function reference(prefix: string): string {
  return `FC-${prefix}-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

function operationKey(value: string) {
  const key = value.trim();
  if (key.length < 4 || key.length > 120) throw new Error("معرف العملية يجب أن يكون من 4 إلى 120 حرفًا");
  return key;
}

const IDEMPOTENCY_CONFLICT = "معرف العملية مستخدم لطلب مختلف";
type CoinNotice = { userId: number; title: string; body: string; type: string; operationId: string };

/** Durable notices commit with the money; push failures must not report a failed trade. */
async function coinTransaction<T>(db: any, work: (tx: any, notify: (notice: CoinNotice) => Promise<void>) => Promise<T>): Promise<T> {
  const notices: CoinNotice[] = [];
  const result = await db.transaction(async (tx: any) => work(tx, async (notice) => {
    await tx.insert(notifications).values(notice).onDuplicateKeyUpdate({ set: { userId: notice.userId } });
    notices.push(notice);
  }));
  // Bounded delivery concurrency; no network call takes place before commit.
  for (let index = 0; index < notices.length; index += 10) {
    await Promise.all(notices.slice(index, index + 10).map(async (notice) => {
      try { await sendPushOnce({ ...notice, data: { type: notice.type, operationId: notice.operationId } }); }
      catch { console.warn("[coin] push unavailable after commit; internal notice retained"); }
    }));
  }
  return result;
}

async function ensureSettings(tx: any) {
  await tx.insert(coinSettings).values({ id: SETTINGS_ID }).onDuplicateKeyUpdate({ set: { id: SETTINGS_ID } });
  // One lock order for all coin mutations, including opposing transfers and reviews.
  const [row] = await tx.select().from(coinSettings).where(eq(coinSettings.id, SETTINGS_ID)).for("update").limit(1);
  if (!row) throw new Error("تعذر تحميل إعدادات كوين فولتكس");
  return row;
}

async function ensureTreasury(tx: any) {
  await tx.insert(coinTreasuries).values({ id: TREASURY_ID }).onDuplicateKeyUpdate({ set: { id: TREASURY_ID } });
  const [row] = await tx.select().from(coinTreasuries).where(eq(coinTreasuries.id, TREASURY_ID)).for("update").limit(1);
  if (!row) throw new Error("تعذر تحميل خزائن كوين فولتكس");
  return row;
}

async function ensureCoinWallet(tx: any, userId: number) {
  await tx.insert(coinWallets).values({ userId }).onDuplicateKeyUpdate({ set: { userId } });
  const [row] = await tx.select().from(coinWallets).where(eq(coinWallets.userId, userId)).for("update").limit(1);
  if (!row) throw new Error("تعذر إنشاء محفظة الكوين");
  return row;
}

async function ensureMainWallet(tx: any, userId: number) {
  await tx.insert(wallets).values({ userId, balance: "0.00", currency: "EGP" }).onDuplicateKeyUpdate({ set: { userId } });
  const [row] = await tx.select().from(wallets).where(eq(wallets.userId, userId)).for("update").limit(1);
  if (!row) throw new Error("محفظة الجنيه غير موجودة");
  return row;
}

function settingsView(row: any) {
  return {
    buyPrice: row.buyPrice,
    sellPrice: row.sellPrice,
    buyFee: row.buyFee,
    sellFee: row.sellFee,
    transferMinimum: row.transferMinimum,
    buyFeeEnabled: Boolean(row.buyFeeEnabled),
    sellFeeEnabled: Boolean(row.sellFeeEnabled),
    updatedAt: row.updatedAt,
  };
}

function orderView(row: any, customer?: any) {
  return {
    id: row.id,
    reference: row.reference,
    userId: row.userId,
    customerName: customer?.name ?? null,
    customerId: customer?.customerId ?? null,
    side: row.side,
    quantity: row.quantity,
    unitPrice: row.unitPrice,
    grossAmount: row.grossAmount,
    feeAmount: row.feeAmount,
    totalAmount: row.totalAmount,
    status: row.status,
    rejectionReason: row.rejectionReason,
    reviewedBy: row.reviewedBy,
    reviewedAt: row.reviewedAt,
    createdAt: row.createdAt,
  };
}

function transferView(row: any, sender?: any, recipient?: any) {
  return {
    id: row.id,
    reference: row.reference,
    senderUserId: row.senderUserId,
    recipientUserId: row.recipientUserId,
    senderName: sender?.name ?? null,
    senderCustomerId: sender?.customerId ?? null,
    recipientName: recipient?.name ?? null,
    recipientCustomerId: recipient?.customerId ?? null,
    quantity: row.quantity,
    status: row.status,
    rejectionReason: row.rejectionReason,
    reviewedBy: row.reviewedBy,
    reviewedAt: row.reviewedAt,
    createdAt: row.createdAt,
  };
}

function mainWalletAvailable(wallet: any): number {
  const reserved = [wallet.reservedWithdrawals, wallet.reservedOrders, wallet.reservedTransfers, wallet.reservedSavings].reduce((sum: bigint, value: string) => sum + scaled(value ?? "0.00", 2), 0n);
  return Number(decimal(scaled(wallet.balance, 2) - reserved, 2));
}

export async function getCoinOverview(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  return db.transaction(async (tx) => {
    const settings = await ensureSettings(tx);
    const wallet = await ensureCoinWallet(tx, userId);
    const orders = await tx.select().from(coinOrders).where(eq(coinOrders.userId, userId)).orderBy(desc(coinOrders.createdAt), desc(coinOrders.id)).limit(30);
    const transfers = await tx.select().from(coinTransfers)
      .where(or(eq(coinTransfers.senderUserId, userId), eq(coinTransfers.recipientUserId, userId)))
      .orderBy(desc(coinTransfers.createdAt), desc(coinTransfers.id)).limit(30);
    const ledger = await tx.select().from(coinLedgerEntries).where(and(eq(coinLedgerEntries.userId, userId), customerLedgerFilter())).orderBy(desc(coinLedgerEntries.createdAt), desc(coinLedgerEntries.id)).limit(30);
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const audits = await tx.select().from(coinPriceAudits).where(gte(coinPriceAudits.createdAt, since)).orderBy(desc(coinPriceAudits.createdAt)).limit(50);
    const firstPrice = audits.length ? numberValue(audits[audits.length - 1].newBuyPrice) : numberValue(settings.buyPrice);
    const currentPrice = numberValue(settings.buyPrice);
    const change = currentPrice - firstPrice;
    return {
      name: COIN_NAME,
      settings: settingsView(settings),
      wallet: { balance: wallet.balance, reserved: wallet.reserved },
      estimatedValue: fixed(numberValue(wallet.balance) * currentPrice, 2),
      estimatedValueAtSell: fixed(numberValue(wallet.balance) * numberValue(settings.sellPrice), 2),
      chart: audits.reverse().map((item) => ({ date: item.createdAt, price: item.newBuyPrice })),
      weekAgoPrice: fixed(firstPrice, 2),
      weekChange: fixed(change, 2),
      weekChangePercent: firstPrice > 0 ? fixed((change / firstPrice) * 100, 2) : "0.00",
      orders: orders.map((order) => orderView(order)),
      transfers: transfers.map((item) => transferView(item)),
      ledger: ledger.map((item) => ({ reference: item.reference, kind: item.kind, direction: item.direction, quantity: item.quantity, amount: item.amount, balanceAfterQuantity: item.balanceAfterQuantity, balanceAfterAmount: item.balanceAfterAmount, source: item.source, createdAt: item.createdAt })),
    };
  });
}

export async function createCoinOrder(userId: number, input: { side: "buy" | "sell"; quantity: string; idempotencyKey: string; securityPin: string }) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  await requireValidSecurityPin(userId, input.securityPin);
  const key = operationKey(input.idempotencyKey);
  const qty = quantity(input.quantity);
  return coinTransaction(db, async (tx, notify) => {
    const settings = await ensureSettings(tx);
    // A current/locking read after the serialization lock sees a concurrent retry.
    const [duplicate] = await tx.select().from(coinOrders).where(eq(coinOrders.idempotencyKey, key)).for("update").limit(1);
    if (duplicate) {
      if (duplicate.userId !== userId || duplicate.side !== input.side || duplicate.quantity !== fixed(qty, 6)) throw new Error(IDEMPOTENCY_CONFLICT);
      return { duplicate: true, order: orderView(duplicate), message: "الطلب مسجل بالفعل، ولم يتكرر الحجز." };
    }
    const treasury = await ensureTreasury(tx);
    const coinWallet = await ensureCoinWallet(tx, userId);
    const unitPrice = numberValue(input.side === "buy" ? settings.buyPrice : settings.sellPrice);
    const quoted = quoteCoinOrder(fixed(qty, 6), fixed(unitPrice, 2), input.side === "buy" ? (settings.buyFeeEnabled ? settings.buyFee : "0.00") : (settings.sellFeeEnabled ? settings.sellFee : "0.00"), input.side);
    const { gross, fee, total } = quoted;
    if (input.side === "buy") {
      const mainWallet = await ensureMainWallet(tx, userId);
      if (mainWalletAvailable(mainWallet) < Number(total)) throw new Error("رصيد الجنيه المتاح غير كافٍ لإتمام شراء الكوين");
      if (numberValue(treasury.availableCoins) < qty) throw new Error("مخزون كوين فولتكس المتاح غير كافٍ");
      await tx.update(wallets).set({ reservedOrders: addDecimal(mainWallet.reservedOrders, total, 2) }).where(eq(wallets.userId, userId));
      await tx.update(coinTreasuries).set({ availableCoins: subtractDecimal(treasury.availableCoins, qty, 6), reservedCoins: addDecimal(treasury.reservedCoins, qty, 6) }).where(eq(coinTreasuries.id, TREASURY_ID));
    } else {
      if (scaled(coinWallet.balance, 6) - scaled(coinWallet.reserved, 6) < scaled(fixed(qty, 6), 6)) throw new Error("رصيد الكوين المتاح لديك غير كافٍ للبيع");
      if (scaled(treasury.sellFundingBalance, 2) - scaled(treasury.reservedSellCash, 2) < scaled(total, 2)) throw new Error("رصيد تمويل بيع الكوينات غير كافٍ حاليًا");
      await tx.update(coinWallets).set({ reserved: addDecimal(coinWallet.reserved, qty, 6) }).where(eq(coinWallets.userId, userId));
      await tx.update(coinTreasuries).set({ reservedSellCash: addDecimal(treasury.reservedSellCash, total, 2) }).where(eq(coinTreasuries.id, TREASURY_ID));
    }
    const inserted = await tx.insert(coinOrders).values({
      reference: reference(input.side === "buy" ? "BUY" : "SELL"),
      idempotencyKey: key,
      userId,
      side: input.side,
      quantity: fixed(qty, 6),
      unitPrice: fixed(unitPrice, 2),
      grossAmount: gross,
      feeAmount: fee,
      totalAmount: total,
      status: "pending",
    });
    const [order] = await tx.select().from(coinOrders).where(eq(coinOrders.id, Number((inserted as any)?.[0]?.insertId ?? (inserted as any)?.insertId ?? 0))).limit(1);
    if (!order) throw new Error("تعذر حفظ طلب الكوين");
    await notify({ userId, title: "تم تسجيل طلب الكوين", body: `تم تسجيل طلب ${input.side === "buy" ? "شراء" : "بيع"} ${order.quantity} كوين، وهو الآن قيد المراجعة.`, type: "coin", operationId: `coin:${order.reference}:pending` });
    return { duplicate: false, order: orderView(order), message: "تم تسجيل طلب الكوين، وحالته الآن قيد المراجعة." };
  });
}

export async function adjustUserCoinBalance(adminId: number, targetUserId: number, rawQuantity: string, reason: string, idempotencyKey: string) {
  const db = await requireAdministrator(adminId);
  const normalizedReason = reason.trim();
  const key = operationKey(idempotencyKey);
  if (normalizedReason.length < 3 || normalizedReason.length > 200) throw new Error("اكتب سبب تعديل الكوين من 3 إلى 200 حرف");
  const delta = signedQuantity(rawQuantity);
  const direction = delta > 0 ? "credit" : "debit";
  return coinTransaction(db, async (tx, notify) => {
    await ensureSettings(tx);
    const [existing] = await tx.select().from(coinLedgerEntries).where(eq(coinLedgerEntries.idempotencyKey, key)).for("update").limit(1);
    if (existing) {
      if (existing.kind !== "admin_adjustment" || existing.adminId !== adminId || existing.userId !== targetUserId || existing.direction !== direction || existing.quantity !== fixed(Math.abs(delta), 6) || existing.source !== normalizedReason) throw new Error(IDEMPOTENCY_CONFLICT);
      return { duplicate: true, balance: existing.balanceAfterQuantity, reference: existing.reference, direction };
    }
    const [customer] = await tx.select({ id: users.id, role: users.role, status: users.status })
      .from(users).where(eq(users.id, targetUserId)).for("update").limit(1);
    if (!customer || customer.role !== "user") throw new Error("حساب العميل غير موجود");
    if (customer.status !== "active") throw new Error("لا يمكن تعديل رصيد كوين لحساب موقوف");
    const wallet = await ensureCoinWallet(tx, targetUserId);
    const before = wallet.balance;
    const available = scaled(wallet.balance, 6) - scaled(wallet.reserved, 6);
    if (delta < 0 && scaled(fixed(Math.abs(delta), 6), 6) > available) throw new Error("لا يمكن خصم كمية كوين أكبر من المتاح بعد الحجز");
    const after = delta > 0 ? addDecimal(before, fixed(delta, 6), 6) : subtractDecimal(before, fixed(Math.abs(delta), 6), 6);
    await tx.update(coinWallets).set({ balance: after }).where(eq(coinWallets.userId, targetUserId));
    const ref = reference("USER-COIN");
    await tx.insert(coinLedgerEntries).values({ reference: ref, idempotencyKey: key, adminId, userId: targetUserId, kind: "admin_adjustment", direction, quantity: fixed(Math.abs(delta), 6), amount: "0.00", source: normalizedReason, balanceAfterQuantity: after, balanceAfterAmount: "0.00" });
    await notify({ userId: targetUserId, title: delta > 0 ? "تمت إضافة كوين إلى محفظتك" : "تم خصم كوين من محفظتك", body: `${delta > 0 ? "تمت إضافة" : "تم خصم"} ${fixed(Math.abs(delta), 6)} كوين. السبب: ${normalizedReason}`, type: "coin", operationId: `coin-admin:${key}` });
    return { duplicate: false, balance: after, reference: ref, direction };
  });
}

export async function cancelCoinOrder(userId: number, orderId: number) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  return coinTransaction(db, async (tx, notify) => {
    await ensureSettings(tx);
    const [order] = await tx.select().from(coinOrders)
      .where(and(eq(coinOrders.id, orderId), eq(coinOrders.userId, userId)))
      .for("update").limit(1);
    if (!order) throw new Error("طلب الكوين غير موجود");
    if (order.status !== "pending") {
      return { order: orderView(order), message: "تمت معالجة هذا الطلب من قبل؛ لا يمكن إلغاؤه مرة أخرى." };
    }
    const treasury = await ensureTreasury(tx);
    if (order.side === "buy") {
      const mainWallet = await ensureMainWallet(tx, userId);
      if (numberValue(mainWallet.reservedOrders) < numberValue(order.totalAmount) || numberValue(treasury.reservedCoins) < numberValue(order.quantity)) throw new Error("تعذر مطابقة حجز طلب الشراء");
      await tx.update(wallets).set({
        reservedOrders: subtractDecimal(mainWallet.reservedOrders, order.totalAmount, 2),
      }).where(eq(wallets.userId, userId));
      await tx.update(coinTreasuries).set({
        availableCoins: addDecimal(treasury.availableCoins, order.quantity, 6),
        reservedCoins: subtractDecimal(treasury.reservedCoins, order.quantity, 6),
      }).where(eq(coinTreasuries.id, TREASURY_ID));
    } else {
      const coinWallet = await ensureCoinWallet(tx, userId);
      if (numberValue(coinWallet.reserved) < numberValue(order.quantity) || numberValue(treasury.reservedSellCash) < numberValue(order.totalAmount)) throw new Error("تعذر مطابقة حجز طلب البيع");
      await tx.update(coinWallets).set({
        reserved: subtractDecimal(coinWallet.reserved, order.quantity, 6),
      }).where(eq(coinWallets.userId, userId));
      await tx.update(coinTreasuries).set({
        reservedSellCash: subtractDecimal(treasury.reservedSellCash, order.totalAmount, 2),
      }).where(eq(coinTreasuries.id, TREASURY_ID));
    }
    const [mainWalletAfter] = await tx.select().from(wallets).where(eq(wallets.userId, userId)).limit(1);
    await tx.insert(transactions).values({
      userId,
      reference: `FC-TX-${order.reference}-CANCEL`,
      type: "adjustment",
      amount: order.totalAmount,
      currency: "EGP",
      status: "cancelled",
      direction: order.side === "buy" ? "credit" : "debit",
      customerTitle: "إلغاء طلب كوين فولتكس",
      customerDescription: `تم إلغاء طلب ${order.side === "buy" ? "الشراء" : "البيع"} وتحرير الحجز دون رسوم.`,
      source: "coin_order_cancel",
      balanceBefore: mainWalletAfter?.balance ?? "0.00",
      balanceAfter: mainWalletAfter?.balance ?? "0.00",
    });
    await tx.update(coinOrders).set({ status: "cancelled", rejectionReason: null, reviewedAt: new Date() }).where(eq(coinOrders.id, orderId));
    await notify({
      userId,
      title: "تم إلغاء طلب الكوين",
      body: "تم إلغاء الطلب وتحرير كامل المبلغ أو الكمية المحجوزة دون خصم رسوم.",
      type: "coin",
      operationId: `coin:${order.reference}:cancelled`,
    });
    const [updated] = await tx.select().from(coinOrders).where(eq(coinOrders.id, orderId)).limit(1);
    return { order: orderView(updated), message: "تم إلغاء الطلب وتحرير الحجز وتسجيل العملية." };
  });
}

export async function lookupCoinTransferRecipient(userId: number, customerId: string) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  const [recipient] = await db.select({ id: users.id, name: users.name, customerId: users.customerId })
    .from(users).where(eq(users.customerId, customerId)).limit(1);
  if (!recipient || recipient.id === userId) return null;
  return recipient;
}

export async function createCoinTransfer(userId: number, input: { recipientCustomerId: string; quantity: string; idempotencyKey: string; securityPin: string }) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  await requireValidSecurityPin(userId, input.securityPin);
  const key = operationKey(input.idempotencyKey);
  const qty = quantity(input.quantity);
  return coinTransaction(db, async (tx, notify) => {
    const settings = await ensureSettings(tx);
    const [recipient] = await tx.select({ id: users.id, name: users.name, customerId: users.customerId })
      .from(users).where(eq(users.customerId, input.recipientCustomerId)).limit(1);
    if (!recipient || recipient.id === userId) throw new Error("رقم المستخدم المستلم غير موجود أو غير صالح");
    const [duplicate] = await tx.select().from(coinTransfers).where(eq(coinTransfers.idempotencyKey, key)).for("update").limit(1);
    if (duplicate) {
      if (duplicate.senderUserId !== userId || duplicate.recipientUserId !== recipient.id || duplicate.quantity !== fixed(qty, 6)) throw new Error(IDEMPOTENCY_CONFLICT);
      return { duplicate: true, transfer: transferView(duplicate, undefined, recipient), message: "طلب التحويل مسجل بالفعل، ولم يتكرر الحجز." };
    }
    const minimum = numberValue(settings.transferMinimum);
    if (qty < minimum) throw new Error(`الحد الأدنى لتحويل الكوين هو ${fixed(minimum, 6)}`);
    await ensureCoinWallet(tx, userId);
    const [senderWallet] = await tx.select().from(coinWallets).where(eq(coinWallets.userId, userId)).for("update").limit(1);
    if (!senderWallet || scaled(senderWallet.balance, 6) - scaled(senderWallet.reserved, 6) < scaled(fixed(qty, 6), 6)) throw new Error("رصيد الكوين المتاح غير كافٍ للتحويل");
    await tx.update(coinWallets).set({ reserved: addDecimal(senderWallet.reserved, qty, 6) }).where(eq(coinWallets.userId, userId));
    const inserted = await tx.insert(coinTransfers).values({ reference: reference("SEND"), idempotencyKey: key, senderUserId: userId, recipientUserId: recipient.id, quantity: fixed(qty, 6), status: "pending" });
    const [transfer] = await tx.select().from(coinTransfers).where(eq(coinTransfers.id, Number((inserted as any)?.[0]?.insertId ?? (inserted as any)?.insertId ?? 0))).limit(1);
    if (!transfer) throw new Error("تعذر حفظ طلب تحويل الكوين");
    await notify({ userId, title: "طلب تحويل الكوين قيد المراجعة", body: `تم تسجيل طلب إرسال ${transfer.quantity} كوين إلى ${recipient.name || "المستلم"}، وهو الآن قيد المراجعة.`, type: "coin_transfer", operationId: `coin-transfer:${transfer.reference}:pending` });
    return { duplicate: false, transfer: transferView(transfer, undefined, recipient), message: "تم إرسال طلب تحويل الكوين إلى الإدارة للمراجعة" };
  });
}

export async function reviewCoinTransfer(adminId: number, transferId: number, decision: "approved" | "rejected", rejectionReason?: string) {
  const db = await requireAdministrator(adminId);
  return coinTransaction(db, async (tx, notify) => {
    await ensureSettings(tx);
    const [transfer] = await tx.select().from(coinTransfers).where(eq(coinTransfers.id, transferId)).for("update").limit(1);
    if (!transfer) throw new Error("طلب تحويل الكوين غير موجود");
    if (transfer.status !== "pending") return { transfer: transferView(transfer), message: "تمت معالجة طلب التحويل من قبل" };
    const [senderWallet] = await tx.select().from(coinWallets).where(eq(coinWallets.userId, transfer.senderUserId)).for("update").limit(1);
    await ensureCoinWallet(tx, transfer.recipientUserId);
    const [recipientWallet] = await tx.select().from(coinWallets).where(eq(coinWallets.userId, transfer.recipientUserId)).for("update").limit(1);
    if (!senderWallet || !recipientWallet) throw new Error("محفظة أحد طرفي التحويل غير موجودة");
    const [senderUser] = await tx.select({ name: users.name }).from(users).where(eq(users.id, transfer.senderUserId)).limit(1);
    const [recipientUser] = await tx.select({ name: users.name }).from(users).where(eq(users.id, transfer.recipientUserId)).limit(1);
    const senderName = senderUser?.name || "المرسل";
    const recipientName = recipientUser?.name || "المستلم";
    const qty = numberValue(transfer.quantity);
    if (decision === "rejected") {
      if (numberValue(senderWallet.reserved) < qty) throw new Error("تعذر مطابقة الحجز قبل رفض التحويل");
      await tx.update(coinWallets).set({ reserved: subtractDecimal(senderWallet.reserved, qty, 6) }).where(eq(coinWallets.userId, transfer.senderUserId));
      await tx.update(coinTransfers).set({ status: "rejected", rejectionReason: rejectionReason?.trim() || "تم رفض التحويل من الإدارة", reviewedBy: adminId, reviewedAt: new Date() }).where(eq(coinTransfers.id, transferId));
      await notify({ userId: transfer.senderUserId, title: "تم رفض تحويل الكوين", body: rejectionReason?.trim() || "تم رفض طلب تحويل الكوين.", type: "coin_transfer", operationId: `coin-transfer:${transfer.reference}:rejected` });
    } else {
      if (numberValue(senderWallet.reserved) < qty || scaled(senderWallet.balance, 6) < scaled(senderWallet.reserved, 6)) throw new Error("لا يمكن اعتماد التحويل بسبب رصيد غير كافٍ أو حجز غير مطابق");
      const senderAfter = subtractDecimal(senderWallet.balance, transfer.quantity, 6);
      const recipientAfter = addDecimal(recipientWallet.balance, transfer.quantity, 6);
      await tx.update(coinWallets).set({ balance: senderAfter, reserved: subtractDecimal(senderWallet.reserved, qty, 6) }).where(eq(coinWallets.userId, transfer.senderUserId));
      await tx.update(coinWallets).set({ balance: recipientAfter }).where(eq(coinWallets.userId, transfer.recipientUserId));
      await tx.insert(coinLedgerEntries).values({ reference: `FC-LEDGER-SEND-${transfer.reference}`, idempotencyKey: `FC-LEDGER-SEND-${transfer.reference}`, adminId, userId: transfer.senderUserId, kind: "transfer", direction: "debit", quantity: transfer.quantity, amount: "0.00", source: `إرسال كوين إلى ${transfer.recipientUserId}`, balanceAfterQuantity: senderAfter, balanceAfterAmount: "0.00" });
      await tx.insert(coinLedgerEntries).values({ reference: `FC-LEDGER-RECEIVE-${transfer.reference}`, idempotencyKey: `FC-LEDGER-RECEIVE-${transfer.reference}`, adminId, userId: transfer.recipientUserId, kind: "transfer", direction: "credit", quantity: transfer.quantity, amount: "0.00", source: `استلام كوين من ${transfer.senderUserId}`, balanceAfterQuantity: recipientAfter, balanceAfterAmount: "0.00" });
      await tx.update(coinTransfers).set({ status: "approved", rejectionReason: null, reviewedBy: adminId, reviewedAt: new Date() }).where(eq(coinTransfers.id, transferId));
      await notify({ userId: transfer.senderUserId, title: "تم إرسال الكوين", body: `تم إرسال ${transfer.quantity} كوين إلى ${recipientName}.`, type: "coin_transfer", operationId: `coin-transfer:${transfer.reference}:sender` });
      await notify({ userId: transfer.recipientUserId, title: "تم استلام الكوين", body: `تم استلام ${transfer.quantity} كوين من ${senderName}.`, type: "coin_transfer", operationId: `coin-transfer:${transfer.reference}:recipient` });
    }
    const [updated] = await tx.select().from(coinTransfers).where(eq(coinTransfers.id, transferId)).limit(1);
    return { transfer: transferView(updated), message: decision === "approved" ? "تم اعتماد التحويل وتسجيله للطرفين" : "تم رفض التحويل وتحرير الحجز" };
  });
}

export async function reviewCoinOrder(adminId: number, orderId: number, decision: "approved" | "rejected", rejectionReason?: string) {
  const db = await requireAdministrator(adminId);
  return coinTransaction(db, async (tx, notify) => {
    await ensureSettings(tx);
    const [order] = await tx.select().from(coinOrders).where(eq(coinOrders.id, orderId)).for("update").limit(1);
    if (!order) throw new Error("طلب الكوين غير موجود");
    if (order.status !== "pending") return { order: orderView(order), message: "تمت معالجة هذا الطلب من قبل" };
    const treasury = await ensureTreasury(tx);
    const now = new Date();
    if (decision === "rejected") {
      if (order.side === "buy") {
        const mainWallet = await ensureMainWallet(tx, order.userId);
        if (numberValue(mainWallet.reservedOrders) < numberValue(order.totalAmount) || numberValue(treasury.reservedCoins) < numberValue(order.quantity)) throw new Error("تعذر مطابقة حجز طلب الشراء");
        await tx.update(wallets).set({ reservedOrders: subtractDecimal(mainWallet.reservedOrders, order.totalAmount, 2) }).where(eq(wallets.userId, order.userId));
        await tx.update(coinTreasuries).set({ availableCoins: addDecimal(treasury.availableCoins, order.quantity, 6), reservedCoins: subtractDecimal(treasury.reservedCoins, order.quantity, 6) }).where(eq(coinTreasuries.id, TREASURY_ID));
      } else {
        const coinWallet = await ensureCoinWallet(tx, order.userId);
        if (numberValue(coinWallet.reserved) < numberValue(order.quantity) || numberValue(treasury.reservedSellCash) < numberValue(order.totalAmount)) throw new Error("تعذر مطابقة حجز طلب البيع");
        await tx.update(coinWallets).set({ reserved: subtractDecimal(coinWallet.reserved, order.quantity, 6) }).where(eq(coinWallets.userId, order.userId));
        await tx.update(coinTreasuries).set({ reservedSellCash: subtractDecimal(treasury.reservedSellCash, order.totalAmount, 2) }).where(eq(coinTreasuries.id, TREASURY_ID));
      }
      const reason = rejectionReason?.trim();
      const customerMessage = reason ? `نأسف، لم تتم الموافقة على طلبك. السبب: ${reason}` : "نأسف، لم تتم الموافقة على طلبك.";
      await tx.update(coinOrders).set({ status: "rejected", rejectionReason: reason || "نأسف، لم تتم الموافقة على طلبك.", reviewedBy: adminId, reviewedAt: now }).where(eq(coinOrders.id, orderId));
      await notify({ userId: order.userId, title: "تحديث طلب كوين فولتكس", body: customerMessage, type: "coin", operationId: `coin:${order.reference}:rejected` });
      const [updated] = await tx.select().from(coinOrders).where(eq(coinOrders.id, orderId)).limit(1);
      return { order: orderView(updated), message: "تم رفض الطلب وتحرير الحجز" };
    }

    if (order.side === "buy") {
      const mainWallet = await ensureMainWallet(tx, order.userId);
      const coinWallet = await ensureCoinWallet(tx, order.userId);
      if (numberValue(mainWallet.reservedOrders) < numberValue(order.totalAmount) || numberValue(treasury.reservedCoins) < numberValue(order.quantity)) throw new Error("تعذر مطابقة حجز طلب الشراء");
      if (numberValue(treasury.totalCoins) < numberValue(order.quantity)) throw new Error("مخزون الكوين لا يطابق حجز الشراء");
      const before = mainWallet.balance;
      const after = subtractDecimal(before, order.totalAmount, 2);
      if (mainWalletAvailable(mainWallet) < 0) throw new Error("لا يمكن اعتماد الطلب لأنه سيؤدي إلى رصيد سالب أو يمس حجزًا آخر");
      await tx.update(wallets).set({ balance: after, reservedOrders: subtractDecimal(mainWallet.reservedOrders, order.totalAmount, 2) }).where(eq(wallets.userId, order.userId));
      await tx.update(coinWallets).set({ balance: addDecimal(coinWallet.balance, order.quantity, 6) }).where(eq(coinWallets.userId, order.userId));
      await tx.update(coinTreasuries).set({ totalCoins: subtractDecimal(treasury.totalCoins, order.quantity, 6), reservedCoins: subtractDecimal(treasury.reservedCoins, order.quantity, 6), buyCashBalance: addDecimal(treasury.buyCashBalance, order.totalAmount, 2), totalBuyCollected: addDecimal(treasury.totalBuyCollected, order.totalAmount, 2) }).where(eq(coinTreasuries.id, TREASURY_ID));
      await tx.insert(transactions).values({ userId: order.userId, reference: `FC-TX-${order.reference}`, type: "adjustment", amount: order.totalAmount, currency: "EGP", status: "approved", direction: "debit", customerTitle: "شراء كوين فولتكس", customerDescription: `تم خصم ${order.totalAmount} ج.م مقابل شراء ${order.quantity} كوين، شامل رسوم ${order.feeAmount} ج.م.`, source: "coin_buy", balanceBefore: before, balanceAfter: after });
      await tx.insert(coinLedgerEntries).values({ reference: `FC-LEDGER-INV-${order.reference}`, idempotencyKey: `FC-LEDGER-INV-${order.reference}`, adminId, kind: "inventory", direction: "debit", quantity: order.quantity, amount: "0.00", source: `اعتماد شراء ${order.reference}`, balanceAfterQuantity: subtractDecimal(treasury.totalCoins, order.quantity, 6), balanceAfterAmount: "0.00" });
      await tx.insert(coinLedgerEntries).values({ reference: `FC-LEDGER-CASH-${order.reference}`, idempotencyKey: `FC-LEDGER-CASH-${order.reference}`, adminId, kind: "buy_cash", direction: "credit", quantity: "0.000000", amount: order.totalAmount, source: `تحصيل شراء ${order.reference}`, balanceAfterQuantity: "0.000000", balanceAfterAmount: addDecimal(treasury.buyCashBalance, order.totalAmount, 2) });
      await tx.insert(coinLedgerEntries).values({ reference: `FC-LEDGER-USER-${order.reference}`, idempotencyKey: `FC-LEDGER-USER-${order.reference}`, adminId, userId: order.userId, kind: "trade", direction: "credit", quantity: order.quantity, amount: order.totalAmount, source: `شراء كوين ${order.reference}`, balanceAfterQuantity: addDecimal(coinWallet.balance, order.quantity, 6), balanceAfterAmount: after });
      await notify({ userId: order.userId, title: "تم شراء الكوين بنجاح", body: `تم شراء ${order.quantity} كوين بنجاح، وتم خصم مبلغ ${order.totalAmount} جنيهًا من محفظتك.`, type: "coin", operationId: `coin:${order.reference}:approved` });
    } else {
      const coinWallet = await ensureCoinWallet(tx, order.userId);
      const mainWallet = await ensureMainWallet(tx, order.userId);
      if (numberValue(coinWallet.reserved) < numberValue(order.quantity) || numberValue(treasury.reservedSellCash) < numberValue(order.totalAmount)) throw new Error("تعذر مطابقة حجز طلب البيع");
      if (numberValue(coinWallet.balance) < numberValue(coinWallet.reserved)) throw new Error("لا يمكن اعتماد البيع بسبب رصيد كوين غير كافٍ للحجوزات");
      if (numberValue(treasury.sellFundingBalance) < numberValue(order.totalAmount)) throw new Error("رصيد تمويل بيع الكوينات غير كافٍ");
      const before = mainWallet.balance;
      const after = addDecimal(before, order.totalAmount, 2);
      await tx.update(coinWallets).set({ balance: subtractDecimal(coinWallet.balance, order.quantity, 6), reserved: subtractDecimal(coinWallet.reserved, order.quantity, 6) }).where(eq(coinWallets.userId, order.userId));
      await tx.update(wallets).set({ balance: after }).where(eq(wallets.userId, order.userId));
      await tx.update(coinTreasuries).set({ totalCoins: addDecimal(treasury.totalCoins, order.quantity, 6), availableCoins: addDecimal(treasury.availableCoins, order.quantity, 6), sellFundingBalance: subtractDecimal(treasury.sellFundingBalance, order.totalAmount, 2), reservedSellCash: subtractDecimal(treasury.reservedSellCash, order.totalAmount, 2), totalSellPaid: addDecimal(treasury.totalSellPaid, order.totalAmount, 2) }).where(eq(coinTreasuries.id, TREASURY_ID));
      await tx.insert(transactions).values({ userId: order.userId, reference: `FC-TX-${order.reference}`, type: "adjustment", amount: order.totalAmount, currency: "EGP", status: "approved", direction: "credit", customerTitle: "بيع كوين فولتكس", customerDescription: `تمت إضافة صافي ${order.totalAmount} ج.م إلى محفظتك مقابل بيع ${order.quantity} كوين، بعد رسوم ${order.feeAmount} ج.م.`, source: "coin_sell", balanceBefore: before, balanceAfter: after });
      await tx.insert(coinLedgerEntries).values({ reference: `FC-LEDGER-INV-${order.reference}`, idempotencyKey: `FC-LEDGER-INV-${order.reference}`, adminId, kind: "inventory", direction: "credit", quantity: order.quantity, amount: "0.00", source: `استلام بيع ${order.reference}`, balanceAfterQuantity: addDecimal(treasury.totalCoins, order.quantity, 6), balanceAfterAmount: "0.00" });
      await tx.insert(coinLedgerEntries).values({ reference: `FC-LEDGER-CASH-${order.reference}`, idempotencyKey: `FC-LEDGER-CASH-${order.reference}`, adminId, kind: "sell_funding", direction: "debit", quantity: "0.000000", amount: order.totalAmount, source: `صرف بيع ${order.reference}`, balanceAfterQuantity: "0.000000", balanceAfterAmount: subtractDecimal(treasury.sellFundingBalance, order.totalAmount, 2) });
      await tx.insert(coinLedgerEntries).values({ reference: `FC-LEDGER-USER-${order.reference}`, idempotencyKey: `FC-LEDGER-USER-${order.reference}`, adminId, userId: order.userId, kind: "trade", direction: "debit", quantity: order.quantity, amount: order.totalAmount, source: `بيع كوين ${order.reference}`, balanceAfterQuantity: subtractDecimal(coinWallet.balance, order.quantity, 6), balanceAfterAmount: after });
      await notify({ userId: order.userId, title: "تم بيع الكوين بنجاح", body: `تم بيع ${order.quantity} كوين بنجاح، وتم إضافة مبلغ ${order.totalAmount} جنيهًا إلى محفظتك.`, type: "coin", operationId: `coin:${order.reference}:approved` });
    }
    await tx.update(coinOrders).set({ status: "approved", reviewedBy: adminId, reviewedAt: now, rejectionReason: null }).where(eq(coinOrders.id, orderId));
    const [updated] = await tx.select().from(coinOrders).where(eq(coinOrders.id, orderId)).limit(1);
    return { order: orderView(updated), message: "تم اعتماد الطلب وتسجيل الأثر المحاسبي" };
  });
}

export async function updateCoinSettings(adminId: number, input: { buyPrice: string; sellPrice: string; buyFee: string; sellFee: string; transferMinimum: string; buyFeeEnabled: boolean; sellFeeEnabled: boolean; reason?: string }) {
  const db = await requireAdministrator(adminId);
  return coinTransaction(db, async (tx, notify) => {
    const current = await ensureSettings(tx);
    const buyPrice = amount(input.buyPrice);
    const sellPrice = amount(input.sellPrice);
    const buyFee = amount(input.buyFee);
    const sellFee = amount(input.sellFee);
    const transferMinimum = quantity(input.transferMinimum);
    if (buyPrice <= 0 || sellPrice <= 0) throw new Error("سعر الكوين يجب أن يكون أكبر من صفر");
    if (transferMinimum <= 0) throw new Error("الحد الأدنى للتحويل يجب أن يكون أكبر من صفر");
    if (buyPrice !== numberValue(current.buyPrice) || sellPrice !== numberValue(current.sellPrice)) {
      const audit = await tx.insert(coinPriceAudits).values({ adminId, previousBuyPrice: current.buyPrice, newBuyPrice: fixed(buyPrice, 2), previousSellPrice: current.sellPrice, newSellPrice: fixed(sellPrice, 2), reason: input.reason?.trim().slice(0, 240) || "تعديل يدوي من لوحة الإدارة" });
      const auditId = Number((audit as any)?.[0]?.insertId ?? (audit as any)?.insertId ?? 0);
      if (!auditId) throw new Error("تعذر حفظ سجل تعديل السعر");
      const changes = [
        { label: "سعر الشراء", before: numberValue(current.buyPrice), after: buyPrice },
        { label: "سعر البيع", before: numberValue(current.sellPrice), after: sellPrice },
      ];
      const customers = await tx.select({ id: users.id }).from(users).where(eq(users.role, "user"));
      for (const direction of ["decrease", "increase"] as const) {
        const matching = changes.filter((change) => direction === "decrease" ? change.after < change.before : change.after > change.before);
        if (!matching.length) continue;
        const title = direction === "decrease" ? "تم خفض سعر الكوين" : "تم زيادة سعر الكوين";
        const body = `${title}. ${matching.map((change) => `${change.label}: ${fixed(change.before, 2)} ← ${fixed(change.after, 2)} ج.م`).join(" · ")}`;
        for (const customer of customers) await notify({ userId: customer.id, title, body, type: "coin_price", operationId: `coin-price:${auditId}:${direction}:${customer.id}` });
      }
    }
    await tx.update(coinSettings).set({ buyPrice: fixed(buyPrice, 2), sellPrice: fixed(sellPrice, 2), buyFee: fixed(buyFee, 2), sellFee: fixed(sellFee, 2), transferMinimum: fixed(transferMinimum, 6), buyFeeEnabled: input.buyFeeEnabled ? 1 : 0, sellFeeEnabled: input.sellFeeEnabled ? 1 : 0, updatedBy: adminId }).where(eq(coinSettings.id, SETTINGS_ID));
    const [updated] = await tx.select().from(coinSettings).where(eq(coinSettings.id, SETTINGS_ID)).limit(1);
    if (!updated) throw new Error("تعذر إعادة قراءة إعدادات الكوين بعد الحفظ");
    return settingsView(updated);
  });
}

export async function recordCoinInventory(adminId: number, input: { quantity: string; source: string; idempotencyKey: string; direction: "credit" | "debit" }) {
  const db = await requireAdministrator(adminId);
  const key = operationKey(input.idempotencyKey);
  const qty = quantity(input.quantity);
  const source = input.source.trim();
  if (source.length < 2 || source.length > 200) throw new Error("اكتب مصدر المخزون من 2 إلى 200 حرف");
  return db.transaction(async (tx) => {
    await ensureSettings(tx);
    const [existing] = await tx.select().from(coinLedgerEntries).where(eq(coinLedgerEntries.idempotencyKey, key)).for("update").limit(1);
    if (existing) {
      if (existing.kind !== "inventory" || existing.userId != null || existing.adminId !== adminId || existing.direction !== input.direction || existing.quantity !== fixed(qty, 6) || existing.source !== source) throw new Error(IDEMPOTENCY_CONFLICT);
      return { duplicate: true, balance: existing.balanceAfterQuantity };
    }
    const treasury = await ensureTreasury(tx);
    const available = numberValue(treasury.availableCoins);
    if (input.direction === "debit" && available < qty) throw new Error("لا يمكن خصم كمية أكبر من المخزون المتاح");
    const move = input.direction === "credit" ? addDecimal : subtractDecimal;
    const nextAvailable = move(treasury.availableCoins, fixed(qty, 6), 6);
    const nextTotal = move(treasury.totalCoins, fixed(qty, 6), 6);
    await tx.update(coinTreasuries).set({ totalCoins: nextTotal, availableCoins: nextAvailable, updatedBy: adminId }).where(eq(coinTreasuries.id, TREASURY_ID));
    await tx.insert(coinLedgerEntries).values({ reference: reference("INV"), idempotencyKey: key, adminId, kind: "inventory", direction: input.direction, quantity: fixed(qty, 6), amount: "0.00", source, balanceAfterQuantity: nextTotal, balanceAfterAmount: "0.00" });
    return { duplicate: false, balance: nextTotal };
  });
}

export async function fundCoinSales(adminId: number, input: { amount: string; source: string; idempotencyKey: string }) {
  const db = await requireAdministrator(adminId);
  const key = operationKey(input.idempotencyKey);
  const value = amount(input.amount);
  const source = input.source.trim();
  if (value <= 0) throw new Error("أدخل مبلغ تمويل أكبر من صفر");
  if (source.length < 2 || source.length > 200) throw new Error("اكتب مصدر التمويل من 2 إلى 200 حرف");
  return db.transaction(async (tx) => {
    await ensureSettings(tx);
    const [existing] = await tx.select().from(coinLedgerEntries).where(eq(coinLedgerEntries.idempotencyKey, key)).for("update").limit(1);
    if (existing) {
      if (existing.kind !== "sell_funding" || existing.userId != null || existing.adminId !== adminId || existing.direction !== "credit" || existing.amount !== fixed(value, 2) || existing.source !== source) throw new Error(IDEMPOTENCY_CONFLICT);
      return { duplicate: true, balance: existing.balanceAfterAmount };
    }
    const treasury = await ensureTreasury(tx);
    const next = addDecimal(treasury.sellFundingBalance, fixed(value, 2), 2);
    await tx.update(coinTreasuries).set({ sellFundingBalance: next, updatedBy: adminId }).where(eq(coinTreasuries.id, TREASURY_ID));
    await tx.insert(coinLedgerEntries).values({ reference: reference("FUND"), idempotencyKey: key, adminId, kind: "sell_funding", direction: "credit", quantity: "0.000000", amount: fixed(value, 2), source, balanceAfterQuantity: "0.000000", balanceAfterAmount: next });
    return { duplicate: false, balance: next };
  });
}

function customerLedgerFilter() {
  // Keep old treasury records intact for audit; never present them as wallet debits.
  return sql`${coinLedgerEntries.kind} IN ('trade', 'transfer', 'admin_adjustment')`;
}

/** Read-only dossier data, without initializing any customer or singleton record. */
export async function getAdminCustomerCoinDetails(adminId: number, userId: number, rawOffset = 0, rawLimit = 15) {
  const db = await requireAdministrator(adminId);
  const offset = Math.min(100_000, Math.max(0, Math.trunc(rawOffset)));
  const limit = Math.min(50, Math.max(1, Math.trunc(rawLimit)));
  const [wallet] = await db.select().from(coinWallets).where(eq(coinWallets.userId, userId)).limit(1);
  const transfersFilter = or(eq(coinTransfers.senderUserId, userId), eq(coinTransfers.recipientUserId, userId));
  const ledgerFilter = and(eq(coinLedgerEntries.userId, userId), customerLedgerFilter());
  const [orders, transfers, ledger, orderCount, transferCount, ledgerCount] = await Promise.all([
    db.select().from(coinOrders).where(eq(coinOrders.userId, userId)).orderBy(desc(coinOrders.createdAt), desc(coinOrders.id)).limit(limit + 1).offset(offset),
    db.select().from(coinTransfers).where(transfersFilter).orderBy(desc(coinTransfers.createdAt), desc(coinTransfers.id)).limit(limit + 1).offset(offset),
    db.select().from(coinLedgerEntries).where(ledgerFilter).orderBy(desc(coinLedgerEntries.createdAt), desc(coinLedgerEntries.id)).limit(limit + 1).offset(offset),
    db.select({ total: sql<number>`COUNT(*)` }).from(coinOrders).where(eq(coinOrders.userId, userId)),
    db.select({ total: sql<number>`COUNT(*)` }).from(coinTransfers).where(transfersFilter),
    db.select({ total: sql<number>`COUNT(*)` }).from(coinLedgerEntries).where(ledgerFilter),
  ]);
  const counterpartyIds = [...new Set(transfers.flatMap((item) => [item.senderUserId, item.recipientUserId]))];
  const counterparties = counterpartyIds.length ? await db.select({ id: users.id, name: users.name, customerId: users.customerId }).from(users).where(inArray(users.id, counterpartyIds)) : [];
  const names = new Map(counterparties.map((item) => [item.id, item]));
  const page = <T,>(items: T[], count: { total: number }[]) => ({ items: items.slice(0, limit), total: Number(count[0]?.total ?? 0), offset, limit, hasMore: items.length > limit });
  return {
    wallet: wallet ? { balance: wallet.balance, reserved: wallet.reserved, available: decimal(scaled(wallet.balance, 6) - scaled(wallet.reserved, 6), 6), updatedAt: wallet.updatedAt } : { balance: "0.000000", reserved: "0.000000", available: "0.000000", updatedAt: null },
    orders: page(orders.map((item) => orderView(item)), orderCount),
    transfers: page(transfers.map((item) => transferView(item, names.get(item.senderUserId), names.get(item.recipientUserId))), transferCount),
    ledger: page(ledger, ledgerCount),
  };
}

export async function getAdminCoinDashboard() {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  return db.transaction(async (tx) => {
    const settings = await ensureSettings(tx);
    const treasury = await ensureTreasury(tx);
    const pending = await tx.select({ order: coinOrders, customer: { name: users.name, customerId: users.customerId, email: users.email } }).from(coinOrders).leftJoin(users, eq(users.id, coinOrders.userId)).where(eq(coinOrders.status, "pending")).orderBy(desc(coinOrders.createdAt)).limit(100);
    const recent = await tx.select({ order: coinOrders, customer: { name: users.name, customerId: users.customerId, email: users.email } }).from(coinOrders).leftJoin(users, eq(users.id, coinOrders.userId)).orderBy(desc(coinOrders.createdAt)).limit(50);
    const senderUsers = aliasedTable(users, "coin_transfer_sender");
    const recipientUsers = aliasedTable(users, "coin_transfer_recipient");
    const pendingTransfers = await tx.select({ transfer: coinTransfers, sender: { name: senderUsers.name, customerId: senderUsers.customerId }, recipient: { name: recipientUsers.name, customerId: recipientUsers.customerId } })
      .from(coinTransfers)
      .leftJoin(senderUsers, eq(senderUsers.id, coinTransfers.senderUserId))
      .leftJoin(recipientUsers, eq(recipientUsers.id, coinTransfers.recipientUserId))
      .where(eq(coinTransfers.status, "pending"))
      .orderBy(desc(coinTransfers.createdAt)).limit(100);
    const recentTransfers = await tx.select({ transfer: coinTransfers, sender: { name: senderUsers.name, customerId: senderUsers.customerId }, recipient: { name: recipientUsers.name, customerId: recipientUsers.customerId } })
      .from(coinTransfers)
      .leftJoin(senderUsers, eq(senderUsers.id, coinTransfers.senderUserId))
      .leftJoin(recipientUsers, eq(recipientUsers.id, coinTransfers.recipientUserId))
      .orderBy(desc(coinTransfers.createdAt)).limit(100);
    const audits = await tx.select().from(coinPriceAudits).orderBy(desc(coinPriceAudits.createdAt)).limit(50);
    const adjustments = await tx.select({ entry: coinLedgerEntries, customer: { name: users.name, customerId: users.customerId } }).from(coinLedgerEntries).leftJoin(users, eq(users.id, coinLedgerEntries.userId)).where(eq(coinLedgerEntries.kind, "admin_adjustment")).orderBy(desc(coinLedgerEntries.createdAt)).limit(50);
    return { settings: settingsView(settings), treasury, pending: pending.map((item) => orderView(item.order, item.customer)), recent: recent.map((item) => orderView(item.order, item.customer)), pendingTransfers: pendingTransfers.map((item) => transferView(item.transfer, item.sender, item.recipient)), recentTransfers: recentTransfers.map((item) => transferView(item.transfer, item.sender, item.recipient)), adjustments: adjustments.map((item) => ({ ...item.entry, customerName: item.customer?.name ?? null, customerId: item.customer?.customerId ?? null })), audits };
  });
}
