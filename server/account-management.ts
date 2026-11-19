import { and, eq, inArray, or, sql } from "drizzle-orm";
import {
  accountStatusEvents,
  cashLedger,
  coinOrders,
  coinTransfers,
  coinWallets,
  goldOrders,
  goldPositions,
  moneyTransfers,
  orders,
  positions,
  pushTokens,
  requests,
  savingsPayouts,
  savingsPlans,
  transactions,
  users,
  wallets,
} from "../drizzle/schema";
import { authDeviceSessions, authPasswordCredentials, authSupportSessions } from "../drizzle/auth-schema";
import { evaluateAccountClosure } from "../shared/account-closure";
import { normalizeEmail } from "../shared/registration";
import { getDb } from "./db";
import { verifyPassword } from "./manual-auth-crypto";
import { requireAdministrator } from "./payment-settings";

async function one(query: PromiseLike<unknown[]>) {
  return (await query as unknown[]).length > 0;
}

async function accountClosureFacts(db: any, userId: number) {
  const [wallet] = await db.select().from(wallets).where(eq(wallets.userId, userId)).limit(1);
  const [coinWallet] = await db.select().from(coinWallets).where(eq(coinWallets.userId, userId)).limit(1);
  const gold = await db.select({ grams: goldPositions.grams }).from(goldPositions).where(eq(goldPositions.userId, userId));
  const equity = await db.select({ quantity: positions.quantity }).from(positions).where(eq(positions.userId, userId));
  const [pendingTransaction, pendingRequest, pendingTransfer, pendingOrder, pendingCoinOrder, pendingCoinTransfer, pendingGoldOrder, openSavings, unpaidPayout, pendingCashEntry] = await Promise.all([
    one(db.select({ id: transactions.id }).from(transactions).where(and(eq(transactions.userId, userId), eq(transactions.status, "pending"))).limit(1)),
    one(db.select({ id: requests.id }).from(requests).where(and(eq(requests.userId, userId), or(eq(requests.status, "pending"), and(eq(requests.type, "withdrawal"), eq(requests.status, "approved"))))).limit(1)),
    one(db.select({ id: moneyTransfers.id }).from(moneyTransfers).where(and(or(eq(moneyTransfers.senderUserId, userId), eq(moneyTransfers.recipientUserId, userId)), eq(moneyTransfers.status, "pending"))).limit(1)),
    one(db.select({ id: orders.id }).from(orders).where(and(eq(orders.userId, userId), inArray(orders.status, ["draft", "submitted", "partially_filled"]))).limit(1)),
    one(db.select({ id: coinOrders.id }).from(coinOrders).where(and(eq(coinOrders.userId, userId), eq(coinOrders.status, "pending"))).limit(1)),
    one(db.select({ id: coinTransfers.id }).from(coinTransfers).where(and(or(eq(coinTransfers.senderUserId, userId), eq(coinTransfers.recipientUserId, userId)), eq(coinTransfers.status, "pending"))).limit(1)),
    one(db.select({ id: goldOrders.id }).from(goldOrders).where(and(eq(goldOrders.userId, userId), inArray(goldOrders.status, ["pending_review", "awaiting_execution"]))).limit(1)),
    one(db.select({ id: savingsPlans.id }).from(savingsPlans).where(and(eq(savingsPlans.userId, userId), inArray(savingsPlans.status, ["pending_approval", "active"]))).limit(1)),
    one(db.select({ id: savingsPayouts.id }).from(savingsPayouts).where(and(eq(savingsPayouts.userId, userId), eq(savingsPayouts.status, "blocked"), sql`${savingsPayouts.expectedAmount} > 0`)).limit(1)),
    one(db.select({ id: cashLedger.id }).from(cashLedger).where(and(eq(cashLedger.userId, userId), eq(cashLedger.status, "pending"))).limit(1)),
  ]);

  return {
    walletBalance: wallet?.balance,
    reservedWithdrawals: wallet?.reservedWithdrawals,
    reservedOrders: wallet?.reservedOrders,
    reservedTransfers: wallet?.reservedTransfers,
    reservedSavings: wallet?.reservedSavings,
    coinBalance: coinWallet?.balance,
    reservedCoin: coinWallet?.reserved,
    goldGrams: gold.map((row: { grams: string }) => row.grams),
    positionQuantities: equity.map((row: { quantity: string }) => row.quantity),
    hasPendingTransaction: pendingTransaction,
    hasPendingPaymentRequest: pendingRequest,
    hasPendingMoneyTransfer: pendingTransfer,
    hasPendingOrder: pendingOrder,
    hasPendingCoinOrderOrTransfer: pendingCoinOrder || pendingCoinTransfer,
    hasPendingGoldOrder: pendingGoldOrder,
    hasOpenSavingsPlan: openSavings,
    hasUnpaidSavingsPayout: unpaidPayout,
    hasPendingCashLedgerEntry: pendingCashEntry,
  };
}

export async function getOwnAccountDeletionEligibility(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  const [user] = await db.select({ role: users.role, status: users.status }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user || user.role !== "user") throw new Error("الحساب غير متاح لإيقافه");
  if (user.status === "deleted") return { eligible: false, blockers: ["الحساب موقوف بالفعل؛ تواصل مع الدعم لاستعادته."], status: "deleted" as const };
  return { ...evaluateAccountClosure(await accountClosureFacts(db, userId)), status: "active" as const };
}

export async function softDeleteOwnAccount(userId: number, input: { customerId: string; email: string; password: string; reason?: string }) {
  if (!/^\d{10}$/.test(input.customerId)) throw new Error("أدخل رقم الحساب المكوّن من 10 أرقام للتأكيد");
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");

  return db.transaction(async (tx: any) => {
    const [user] = await tx.select({ id: users.id, role: users.role, status: users.status, customerId: users.customerId, email: users.email, emailNormalized: users.emailNormalized })
      .from(users).where(eq(users.id, userId)).for("update").limit(1);
    if (!user || user.role !== "user" || user.status !== "active") throw new Error("الحساب غير متاح لإيقافه");
    if (user.customerId !== input.customerId) throw new Error("رقم الحساب لا يطابق الملف الحالي");
    if (normalizeEmail(input.email) !== (user.emailNormalized ?? normalizeEmail(user.email ?? ""))) throw new Error("البريد الإلكتروني لا يطابق الحساب الحالي");
    const [credential] = await tx.select().from(authPasswordCredentials).where(eq(authPasswordCredentials.userId, userId)).for("update").limit(1);
    if (!credential || !(await verifyPassword(input.password, credential.passwordHash))) throw new Error("كلمة المرور الحالية غير صحيحة");
    await tx.select({ id: wallets.id }).from(wallets).where(eq(wallets.userId, userId)).for("update").limit(1);
    const eligibility = evaluateAccountClosure(await accountClosureFacts(tx, userId));
    if (!eligibility.eligible) throw new Error(eligibility.blockers.join(" "));

    const now = new Date();
    await tx.update(users).set({ status: "deleted", deletedAt: now }).where(and(eq(users.id, userId), eq(users.status, "active")));
    await tx.update(authDeviceSessions).set({ revokedAt: now, revokeReason: "إيقاف الحساب بطلب صاحبه" }).where(and(eq(authDeviceSessions.userId, userId), sql`${authDeviceSessions.revokedAt} IS NULL`));
    await tx.update(pushTokens).set({ enabled: 0 }).where(eq(pushTokens.userId, userId));
    await tx.insert(accountStatusEvents).values({ targetUserId: userId, actorUserId: userId, actorType: "user", action: "soft_delete", reason: input.reason?.trim().slice(0, 500) || null, createdAt: now });
    return { success: true as const, deletedAt: now };
  });
}

export async function restoreDeletedCustomerAccount(adminId: number, targetUserId: number, reason: string) {
  const db = await requireAdministrator(adminId);
  const cleanReason = reason.trim();
  if (cleanReason.length < 3 || cleanReason.length > 500) throw new Error("سبب الاستعادة مطلوب (3 إلى 500 حرف)");
  return db.transaction(async (tx: any) => {
    const [target] = await tx.select({ id: users.id, role: users.role, status: users.status })
      .from(users).where(eq(users.id, targetUserId)).for("update").limit(1);
    if (!target || target.role !== "user") throw new Error("حساب العميل غير موجود");
    if (target.status !== "deleted") return { userId: targetUserId, status: "active" as const, unchanged: true };
    const now = new Date();
    await tx.update(users).set({ status: "active", deletedAt: null }).where(and(eq(users.id, targetUserId), eq(users.status, "deleted")));
    await tx.update(authSupportSessions).set({ revokedAt: now }).where(and(eq(authSupportSessions.userId, targetUserId), sql`${authSupportSessions.revokedAt} IS NULL`));
    await tx.insert(accountStatusEvents).values({ targetUserId, actorUserId: adminId, actorType: "admin", action: "restore", reason: cleanReason, createdAt: now });
    return { userId: targetUserId, status: "active" as const, unchanged: false };
  });
}

export async function listAccountStatusEvents(adminId: number, targetUserId: number) {
  const db = await requireAdministrator(adminId);
  const [target] = await db.select({ id: users.id, role: users.role }).from(users).where(eq(users.id, targetUserId)).limit(1);
  if (!target || target.role !== "user") throw new Error("حساب العميل غير موجود");
  return db.select().from(accountStatusEvents).where(eq(accountStatusEvents.targetUserId, targetUserId)).orderBy(sql`${accountStatusEvents.createdAt} DESC`).limit(100);
}
