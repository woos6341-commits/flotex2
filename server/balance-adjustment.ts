import { and, eq, sql } from "drizzle-orm";
import { auditLogs, notifications, transactions, users, wallets } from "../drizzle/schema";
import { parseMoneyMinorUnits, formatMoneyMinorUnits, resolveTransactionMetadata } from "../shared/transactions";
import { requireAdministrator } from "./payment-settings";
import { sendPushOnce } from "./push";

const NEGATIVE_BALANCE_MESSAGE = "لا يمكن تنفيذ العملية لأنها ستؤدي إلى رصيد سالب";

/** All three records commit together; Push delivery happens only after the commit. */
export async function applyBalanceAdjustment(adminId: number, targetUserId: number, amount: string, reason: string, operationId: string) {
  const db = await requireAdministrator(adminId);
  const minor = parseMoneyMinorUnits(amount, true);
  if (minor === 0) throw new Error("مبلغ العملية يجب أن يكون أكبر من صفر للإضافة أو الخصم");
  const normalizedAmount = formatMoneyMinorUnits(minor);
  const normalizedReason = reason.trim();
  const normalizedOperationId = operationId.trim();
  if (normalizedReason.length < 3 || normalizedReason.length > 500) throw new Error("اكتب سبب العملية من 3 إلى 500 حرف");
  // transactions.reference is 80 characters: use the same limit end-to-end.
  if (normalizedOperationId.length < 4 || normalizedOperationId.length > 80) throw new Error("معرف العملية يجب أن يكون من 4 إلى 80 حرفًا");
  const [customer] = await db.select({ id: users.id }).from(users).where(eq(users.id, targetUserId)).limit(1);
  if (!customer) throw new Error("حساب العميل غير موجود");

  const result = await db.transaction(async tx => {
    const [customer] = await tx.select({ id: users.id, role: users.role, status: users.status })
      .from(users).where(eq(users.id, targetUserId)).for("update").limit(1);
    if (!customer || customer.role !== "user") throw new Error("حساب العميل غير موجود");
    if (customer.status !== "active") throw new Error("لا يمكن تعديل رصيد حساب موقوف");
    // Lock the wallet after the user row, matching soft-delete and financial mutation lock order.
    await tx.insert(wallets).values({ userId: targetUserId, balance: "0.00", profitLoss: "0.00", currency: "EGP" }).onDuplicateKeyUpdate({ set: { userId: targetUserId } });
    const [wallet] = await tx.select().from(wallets).where(eq(wallets.userId, targetUserId)).for("update").limit(1);
    if (!wallet) throw new Error("محفظة العميل غير متاحة");
    const [existing] = await tx.select({ id: auditLogs.id }).from(auditLogs).where(eq(auditLogs.operationId, normalizedOperationId)).limit(1);
    if (existing) throw new Error("معرف العملية مستخدم مسبقًا");
    const beforeMinor = parseMoneyMinorUnits(wallet.balance);
    const reservedMinor = parseMoneyMinorUnits(wallet.reservedWithdrawals) + parseMoneyMinorUnits(wallet.reservedOrders) + parseMoneyMinorUnits(wallet.reservedTransfers) + parseMoneyMinorUnits(wallet.reservedSavings);
    if (minor < 0 && -minor > beforeMinor - reservedMinor) throw new Error(NEGATIVE_BALANCE_MESSAGE);
    if (beforeMinor + minor < 0) throw new Error(NEGATIVE_BALANCE_MESSAGE);

    const balanceBefore = formatMoneyMinorUnits(beforeMinor);
    const updated = await tx.update(wallets).set({ balance: sql`${wallets.balance} + ${normalizedAmount}` }).where(and(eq(wallets.userId, targetUserId), sql`${wallets.balance} + ${normalizedAmount} >= ${wallets.reservedWithdrawals} + ${wallets.reservedOrders} + ${wallets.reservedTransfers} + ${wallets.reservedSavings}`));
    if (Number(updated[0].affectedRows) !== 1) throw new Error(NEGATIVE_BALANCE_MESSAGE);
    const [savedWallet] = await tx.select({ balance: wallets.balance }).from(wallets).where(eq(wallets.userId, targetUserId)).limit(1);
    if (!savedWallet) throw new Error("تعذر تأكيد حفظ الرصيد");
    const balanceAfter = savedWallet.balance;
    const metadata = resolveTransactionMetadata({ type: "adjustment", amount: normalizedAmount, status: "approved" });
    await tx.insert(auditLogs).values({ operationId: normalizedOperationId, adminId, targetUserId, amount: normalizedAmount, balanceBefore, balanceAfter, currency: "EGP", reason: normalizedReason });
    await tx.insert(transactions).values({ userId: targetUserId, reference: normalizedOperationId, type: "adjustment", amount: normalizedAmount, status: "approved", note: normalizedReason, currency: "EGP", direction: metadata.direction, customerTitle: metadata.customerTitle, customerDescription: metadata.customerDescription, source: "admin_adjustment", balanceBefore, balanceAfter });
    const title = minor > 0 ? "تمت إضافة أموال إلى محفظتك" : "تم خصم أموال من محفظتك";
    const body = minor > 0 ? `تمت إضافة ${metadata.displayAmount} جنيه إلى رصيدك في Flotex EGP.` : `تم خصم ${metadata.displayAmount} جنيه من رصيدك في Flotex EGP.`;
    await tx.insert(notifications).values({ userId: targetUserId, title, body, type: "balance_adjustment", operationId: normalizedOperationId });
    return { success: true as const, targetUserId, balanceBefore, balanceAfter, direction: metadata.direction, amount: normalizedAmount, operationId: normalizedOperationId, title, body };
  });

  try {
    await sendPushOnce({ userId: targetUserId, operationId: result.operationId, title: result.title, body: result.body, data: { type: "balance_adjustment", operationId: result.operationId, direction: result.direction } });
  } catch {
    console.warn("[balance] push delivery pending or unavailable after commit");
  }
  const { title: _title, body: _body, ...publicResult } = result;
  return publicResult;
}
