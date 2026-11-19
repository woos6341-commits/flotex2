import { and, asc, desc, eq, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  cashLedger,
  notifications,
  savingsFinancingEntries,
  savingsFinancingWallets,
  savingsPayouts,
  savingsPlans,
  transactions,
  users,
  wallets,
} from "../drizzle/schema";
import {
  addSavingsPeriod,
  addSavingsRefundPeriod,
  calculateExpectedInterestAtRate,
  getSavingsProduct,
  getNextSavingsPayoutAt,
  getSavingsReservationReleaseAmount,
  isSavingsAutoPayoutDue,
  SAVINGS_AUTO_PAYOUT_GRACE_MS,
  roundInterestToWallet,
  savingsPeriodKey,
  type SavingsFrequency,
  validateSavingsAmount,
} from "../shared/savings";
import { ratePercentToPpm } from "../shared/savings-settings";
import { formatMoneyMinorUnits, parseMoneyMinorUnits } from "../shared/transactions";
import { ADMIN_EMAIL } from "../shared/admin";
import { ensureWallet, getDb } from "./db";
import { requireAdministrator } from "./payment-settings";
import { getSavingsSettings } from "./savings-settings";
import { ensureSavingsAutoPayoutHeartbeat } from "./savings-scheduler";

export type SavingsDecision = "approve" | "reject";
const SAVINGS_PAYOUT_RETRY_BACKOFF_MS = 15 * 60 * 1000;

function affectedRows(result: unknown): number {
  const value = result as { affectedRows?: number } | [{ affectedRows?: number }] | undefined;
  if (Array.isArray(value)) return Number(value[0]?.affectedRows ?? 0);
  return Number(value?.affectedRows ?? 0);
}

function savingsReference(userId: number) {
  return `SAV-${userId}-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

function payoutReference(planId: number, periodKey: string) {
  return `SAV-PAYOUT-${planId}-${periodKey.replace(/[^A-Za-z0-9:-]/g, "")}`;
}

function savingsNotificationOperation(reference: string, event: "approved" | "rejected" | "cancelled" | "refunded") {
  return `${reference}:${event}`;
}

function savingsTransactionReference(reference: string, kind: "request" | "legacy-principal") {
  return kind === "request" ? `${reference}:request` : reference;
}

function savingsRefundReference(planId: number) {
  return `SAV-REFUND-${planId}`;
}

const FINANCING_WALLET_NAME = "محفظة تمويل الإدخار";
type FinancingEntryType = "manual_funding" | "savings_principal" | "savings_profit" | "savings_refund";

async function getAdminDisplayName(tx: any, adminId: number) {
  const [admin] = await tx.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, adminId)).limit(1);
  return admin?.name?.trim() || admin?.email?.trim() || `المدير #${adminId}`;
}

async function getOrCreateFinancingWallet(tx: any, adminId: number) {
  await tx.insert(savingsFinancingWallets).values({ adminId, name: FINANCING_WALLET_NAME, balance: "0.00", currency: "EGP" }).onDuplicateKeyUpdate({ set: { adminId } });
  const [wallet] = await tx.select().from(savingsFinancingWallets).where(eq(savingsFinancingWallets.adminId, adminId)).for("update").limit(1);
  if (!wallet) throw new Error("محفظة تمويل الإدخار غير متاحة");
  return wallet;
}

async function getDefaultFinancingWallet(tx: any) {
  const [admin] = await tx.select({ id: users.id }).from(users).where(and(eq(users.role, "admin"), sql`lower(coalesce(${users.emailNormalized}, ${users.email})) = ${ADMIN_EMAIL}`)).limit(1);
  if (!admin) throw new Error("لا يوجد مدير معتمد لمحفظة تمويل الإدخار");
  return getOrCreateFinancingWallet(tx, admin.id);
}

async function getFinancingWalletForPlan(tx: any, financingWalletId?: number | null) {
  if (financingWalletId) {
    const [wallet] = await tx.select().from(savingsFinancingWallets).where(eq(savingsFinancingWallets.id, financingWalletId)).for("update").limit(1);
    if (!wallet) throw new Error("محفظة تمويل الإدخار المرتبطة غير متاحة");
    return wallet;
  }
  return getDefaultFinancingWallet(tx);
}

async function moveFinancingFunds(tx: any, input: {
  walletId: number;
  adminId: number;
  savingsPlanId?: number;
  customerUserId?: number;
  customerName?: string | null;
  reference: string;
  idempotencyKey: string;
  type: FinancingEntryType;
  direction: "credit" | "debit";
  amount: string;
  source: string;
}) {
  const [existing] = await tx.select().from(savingsFinancingEntries).where(eq(savingsFinancingEntries.idempotencyKey, input.idempotencyKey)).for("update").limit(1);
  if (existing) return { entry: existing, duplicate: true };
  const [wallet] = await tx.select().from(savingsFinancingWallets).where(eq(savingsFinancingWallets.id, input.walletId)).for("update").limit(1);
  if (!wallet) throw new Error("محفظة تمويل الإدخار غير متاحة");
  const amountMinor = parseMoneyMinorUnits(input.amount);
  if (amountMinor <= 0) throw new Error("قيمة حركة تمويل الإدخار يجب أن تكون أكبر من صفر");
  const beforeMinor = parseMoneyMinorUnits(wallet.balance);
  const afterMinor = input.direction === "credit" ? beforeMinor + amountMinor : beforeMinor - amountMinor;
  if (input.direction === "debit" && beforeMinor < amountMinor) throw new Error("رصيد محفظة تمويل الإدخار غير كافٍ للصرف");
  const normalizedAmount = formatMoneyMinorUnits(amountMinor);
  const normalizedAfter = formatMoneyMinorUnits(afterMinor);
  const updated = await tx.update(savingsFinancingWallets).set({
    balance: input.direction === "credit" ? sql`${savingsFinancingWallets.balance} + ${normalizedAmount}` : sql`${savingsFinancingWallets.balance} - ${normalizedAmount}`,
  }).where(and(
    eq(savingsFinancingWallets.id, input.walletId),
    ...(input.direction === "debit" ? [sql`${savingsFinancingWallets.balance} >= ${normalizedAmount}`] : []),
  ));
  if (affectedRows(updated) !== 1) throw new Error(input.direction === "debit" ? "رصيد محفظة تمويل الإدخار غير كافٍ للصرف" : "تعذر تحديث محفظة تمويل الإدخار");
  const adminName = await getAdminDisplayName(tx, input.adminId);
  await tx.insert(savingsFinancingEntries).values({
    walletId: input.walletId,
    adminId: input.adminId,
    adminName,
    savingsPlanId: input.savingsPlanId ?? null,
    customerUserId: input.customerUserId ?? null,
    customerName: input.customerName?.trim() || null,
    reference: input.reference,
    idempotencyKey: input.idempotencyKey,
    type: input.type,
    direction: input.direction,
    amount: normalizedAmount,
    source: input.source,
    balanceBefore: formatMoneyMinorUnits(beforeMinor),
    balanceAfter: normalizedAfter,
    createdAt: new Date(),
  });
  const [entry] = await tx.select().from(savingsFinancingEntries).where(eq(savingsFinancingEntries.idempotencyKey, input.idempotencyKey)).limit(1);
  if (!entry) throw new Error("تعذر تسجيل حركة محفظة تمويل الإدخار");
  return { entry, duplicate: false };
}

export async function getAdminSavingsFinancingWallet(adminId: number) {
  const db = await requireAdministrator(adminId);
  return db.transaction(async (tx) => {
    const wallet = await getOrCreateFinancingWallet(tx, adminId);
    const [totals] = await tx.select({
      savingsReceived: sql<string>`coalesce(sum(case when ${savingsFinancingEntries.type} = 'savings_principal' and ${savingsFinancingEntries.direction} = 'credit' then ${savingsFinancingEntries.amount} else 0 end), 0)`,
      profitPaid: sql<string>`coalesce(sum(case when ${savingsFinancingEntries.type} = 'savings_profit' and ${savingsFinancingEntries.direction} = 'debit' then ${savingsFinancingEntries.amount} else 0 end), 0)`,
      principalRefunded: sql<string>`coalesce(sum(case when ${savingsFinancingEntries.type} = 'savings_refund' and ${savingsFinancingEntries.direction} = 'debit' then ${savingsFinancingEntries.amount} else 0 end), 0)`,
      manualFunding: sql<string>`coalesce(sum(case when ${savingsFinancingEntries.type} = 'manual_funding' and ${savingsFinancingEntries.direction} = 'credit' then ${savingsFinancingEntries.amount} else 0 end), 0)`,
    }).from(savingsFinancingEntries).where(eq(savingsFinancingEntries.walletId, wallet.id));
    const entries = await tx.select().from(savingsFinancingEntries)
      .where(eq(savingsFinancingEntries.walletId, wallet.id))
      .orderBy(desc(savingsFinancingEntries.createdAt), desc(savingsFinancingEntries.id)).limit(200);
    const profitEntries = await tx.select({
      id: savingsFinancingEntries.id,
      reference: savingsFinancingEntries.reference,
      amount: savingsFinancingEntries.amount,
      balanceBefore: savingsFinancingEntries.balanceBefore,
      balanceAfter: savingsFinancingEntries.balanceAfter,
      createdAt: savingsFinancingEntries.createdAt,
      source: savingsFinancingEntries.source,
      customerName: users.name,
      customerNumber: users.customerId,
      planReference: savingsPlans.reference,
      frequency: savingsPlans.frequency,
    }).from(savingsFinancingEntries)
      .leftJoin(users, eq(savingsFinancingEntries.customerUserId, users.id))
      .leftJoin(savingsPlans, eq(savingsFinancingEntries.savingsPlanId, savingsPlans.id))
      .where(and(
        eq(savingsFinancingEntries.walletId, wallet.id),
        eq(savingsFinancingEntries.type, "savings_profit"),
        eq(savingsFinancingEntries.direction, "debit"),
      ))
      .orderBy(desc(savingsFinancingEntries.createdAt), desc(savingsFinancingEntries.id)).limit(200);
    const blockedPayouts = await tx.select({
      id: savingsPayouts.id,
      amount: savingsPayouts.expectedAmount,
      createdAt: savingsPayouts.createdAt,
      periodKey: savingsPayouts.periodKey,
      blockReason: savingsPayouts.blockReason,
      customerName: users.name,
      customerNumber: users.customerId,
      planReference: savingsPlans.reference,
      frequency: savingsPlans.frequency,
    }).from(savingsPayouts)
      .innerJoin(savingsPlans, eq(savingsPayouts.planId, savingsPlans.id))
      .leftJoin(users, eq(savingsPayouts.userId, users.id))
      .where(and(eq(savingsPlans.financingWalletId, wallet.id), isNotNull(savingsPayouts.blockReason)))
      .orderBy(desc(savingsPayouts.createdAt), desc(savingsPayouts.id)).limit(200);
    const profitDispatches = [
      ...profitEntries.map((entry) => ({
        id: `profit-${entry.id}`,
        reference: entry.reference,
        amount: entry.amount,
        createdAt: entry.createdAt,
        customerName: entry.customerName,
        customerNumber: entry.customerNumber,
        planReference: entry.planReference,
        frequency: entry.frequency,
        periodKey: entry.source.replace(/^عائد إدخار\s*/, ""),
        balanceBefore: entry.balanceBefore,
        balanceAfter: entry.balanceAfter,
        status: "success" as const,
        statusReason: null,
      })),
      ...blockedPayouts.map((entry) => ({
        id: `blocked-${entry.id}`,
        reference: `SAV-PAYOUT-${entry.planReference ?? entry.id}-${entry.periodKey}:blocked`,
        amount: entry.amount,
        createdAt: entry.createdAt,
        customerName: entry.customerName,
        customerNumber: entry.customerNumber,
        planReference: entry.planReference,
        frequency: entry.frequency,
        periodKey: entry.periodKey,
        balanceBefore: null,
        balanceAfter: null,
        status: "rejected" as const,
        statusReason: entry.blockReason ?? "لم يتوفر رصيد كافٍ في محفظة التمويل",
      })),
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 200);
    return { wallet, totals: { savingsReceived: totals?.savingsReceived ?? "0.00", profitPaid: totals?.profitPaid ?? "0.00", principalRefunded: totals?.principalRefunded ?? "0.00", manualFunding: totals?.manualFunding ?? "0.00" }, entries, profitDispatches };
  });
}

export async function addSavingsFinancing(adminId: number, input: { amount: string; source: string; operationId: string }) {
  const db = await requireAdministrator(adminId);
  const amountMinor = parseMoneyMinorUnits(input.amount);
  const source = input.source.trim();
  const operationId = input.operationId.trim();
  if (amountMinor <= 0) throw new Error("أدخل مبلغ تمويل أكبر من صفر");
  if (source.length < 2 || source.length > 200) throw new Error("مصدر التمويل يجب أن يكون من حرفين إلى 200 حرف");
  if (operationId.length < 12 || operationId.length > 100) throw new Error("رقم عملية التمويل غير صالح");
  return db.transaction(async (tx) => {
    const wallet = await getOrCreateFinancingWallet(tx, adminId);
    const normalizedAmount = formatMoneyMinorUnits(amountMinor);
    const result = await moveFinancingFunds(tx, {
      walletId: wallet.id,
      adminId,
      reference: `SAV-FUND-${operationId}`,
      idempotencyKey: operationId,
      type: "manual_funding",
      direction: "credit",
      amount: normalizedAmount,
      source,
    });
    if (result.duplicate && (result.entry.type !== "manual_funding" || result.entry.amount !== normalizedAmount || result.entry.source !== source || result.entry.walletId !== wallet.id)) {
      throw new Error("رقم عملية التمويل مستخدم لبيانات مختلفة");
    }
    return { success: true as const, duplicate: result.duplicate, reference: result.entry.reference, amount: result.entry.amount, balanceAfter: result.entry.balanceAfter };
  });
}

export async function createSavingsPlan(userId: number, input: {
  frequency: SavingsFrequency;
  amount: string;
  clientOperationId: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  const settings = await getSavingsSettings();
  const amount = validateSavingsAmount(input.amount, settings.minimumAmount);
  if (input.clientOperationId.trim().length < 12 || input.clientOperationId.trim().length > 80) {
    throw new Error("معرف طلب الإدخار غير صالح");
  }
  const ratePercent = input.frequency === "daily" ? settings.dailyRatePercent : input.frequency === "monthly" ? settings.monthlyRatePercent : settings.yearlyRatePercent;
  const ratePpm = ratePercentToPpm(ratePercent);
  const feeAmount = settings.feeAmount;
  const reservationAmount = formatMoneyMinorUnits(parseMoneyMinorUnits(amount) + parseMoneyMinorUnits(feeAmount));
  const createdAt = new Date();
  const refundEligibleAt = addSavingsRefundPeriod(createdAt, input.frequency);
  await ensureWallet(userId);

  return db.transaction(async (tx) => {
    const [duplicate] = await tx.select().from(savingsPlans)
      .where(eq(savingsPlans.clientOperationId, input.clientOperationId.trim()))
      .for("update").limit(1);
    if (duplicate) {
      if (duplicate.userId !== userId || duplicate.principalAmount !== amount || duplicate.frequency !== input.frequency) {
        throw new Error("معرف طلب الإدخار مستخدم لبيانات مختلفة");
      }
      return { plan: duplicate, duplicate: true };
    }

    const [wallet] = await tx.select().from(wallets).where(eq(wallets.userId, userId)).for("update").limit(1);
    if (!wallet) throw new Error("محفظة العميل غير متاحة");
    const reserved = await tx.update(wallets).set({
      reservedSavings: sql`${wallets.reservedSavings} + ${reservationAmount}`,
    }).where(and(
      eq(wallets.userId, userId),
      sql`${wallets.balance} - ${wallets.reservedWithdrawals} - ${wallets.reservedOrders} - ${wallets.reservedTransfers} - ${wallets.reservedSavings} >= ${reservationAmount}`,
    ));
    if (affectedRows(reserved) !== 1) throw new Error("رصيد محفظتك المتاح غير كافٍ لحجز مبلغ الإدخار");

    const reference = savingsReference(userId);
    await tx.insert(savingsPlans).values({
      reference,
      clientOperationId: input.clientOperationId.trim(),
      userId,
      principalAmount: amount,
      currency: "EGP",
      frequency: input.frequency,
      ratePercent,
      ratePpm,
      feeAmount,
      status: "pending_approval",
      refundEligibleAt,
      createdAt,
    });
    await tx.insert(transactions).values({
      userId,
      reference: savingsTransactionReference(reference, "request"),
      type: "adjustment",
      amount,
      currency: "EGP",
      status: "pending",
      note: `طلب إدخار ${reference}`,
      direction: "debit",
      customerTitle: "إدخار",
      customerDescription: "تم حجز المبلغ مؤقتًا، والطلب قيد المراجعة وبانتظار الموافقة، ولم يتم خصم أي مبلغ نهائيًا حتى الآن.",
      source: "savings_request",
      balanceBefore: wallet.balance,
      balanceAfter: wallet.balance,
    });
    await tx.insert(notifications).values({
      userId,
      title: "تم استلام طلب الإدخار",
      body: `تم حجز مبلغ ${reservationAmount} ج.م مؤقتًا، والطلب تحت المراجعة وبانتظار الموافقة، ولم يتم خصم أي مبلغ نهائيًا حتى الآن.`,
      type: "savings",
      operationId: reference,
    });
    const [plan] = await tx.select().from(savingsPlans).where(eq(savingsPlans.reference, reference)).limit(1);
    return { plan, duplicate: false };
  });
}

async function attachPayouts<T extends { id: number }>(db: any, plans: T[]) {
  if (!plans.length) return plans.map((plan) => ({ ...plan, payouts: [] }));
  const payouts = await db.select().from(savingsPayouts)
    .where(inArray(savingsPayouts.planId, plans.map((plan) => plan.id)))
    .orderBy(desc(savingsPayouts.periodStart));
  const byPlan = new Map<number, typeof payouts>();
  for (const payout of payouts) {
    const list = byPlan.get(payout.planId) ?? [];
    list.push(payout);
    byPlan.set(payout.planId, list);
  }
  return plans.map((plan) => ({
    ...plan,
    refundEligibleAt: addSavingsRefundPeriod((plan as any).createdAt, (plan as any).frequency as SavingsFrequency),
    payouts: byPlan.get(plan.id) ?? [],
  }));
}

export async function listMySavingsPlans(userId: number) {
  const db = await getDb();
  if (!db) return [];
  const plans = await db.select().from(savingsPlans)
    .where(eq(savingsPlans.userId, userId))
    .orderBy(desc(savingsPlans.createdAt)).limit(100);
  return attachPayouts(db, plans);
}

export async function listAdminSavingsPlans(adminId: number, status?: string) {
  const db = await requireAdministrator(adminId);
  const filter = status && status !== "all" ? eq(savingsPlans.status, status as any) : undefined;
  const rows = await db.select({
    plan: savingsPlans,
    customer: { name: users.name, email: users.email, customerId: users.customerId },
  }).from(savingsPlans).leftJoin(users, eq(savingsPlans.userId, users.id))
    .where(filter).orderBy(desc(savingsPlans.createdAt)).limit(200);
  const plans = rows.map((row) => ({ ...row.plan, customer: row.customer }));
  return attachPayouts(db, plans);
}

export async function listAdminSavingsTransactions(adminId: number) {
  const db = await requireAdministrator(adminId);
  return db.select({
    id: transactions.id,
    reference: transactions.reference,
    userId: transactions.userId,
    customerName: users.name,
    customerNumber: users.customerId,
    type: transactions.type,
    amount: transactions.amount,
    status: transactions.status,
    direction: transactions.direction,
    note: transactions.note,
    customerTitle: transactions.customerTitle,
    source: transactions.source,
    balanceBefore: transactions.balanceBefore,
    balanceAfter: transactions.balanceAfter,
    createdAt: transactions.createdAt,
  }).from(transactions)
    .leftJoin(users, eq(transactions.userId, users.id))
    .where(inArray(transactions.source, ["savings_request", "savings_principal", "savings_fee", "savings_profit", "savings_refund", "savings_cancel"]))
    .orderBy(desc(transactions.createdAt), desc(transactions.id)).limit(200);
}

export async function listAdminSavingsPayoutSchedules(adminId: number) {
  const db = await requireAdministrator(adminId);
  const rows = await db.select({
    plan: savingsPlans,
    customer: { name: users.name, email: users.email, customerId: users.customerId },
  }).from(savingsPlans).leftJoin(users, eq(savingsPlans.userId, users.id))
    .where(and(eq(savingsPlans.status, "active"), isNotNull(savingsPlans.nextPayoutAt)))
    .orderBy(asc(savingsPlans.nextPayoutAt));
  const plans = rows.map((row) => ({ ...row.plan, customer: row.customer }));
  if (!plans.length) return [];

  const periodKeyByPlan = new Map(plans.map((plan) => [
    plan.id,
    savingsPeriodKey(plan.frequency as SavingsFrequency, plan.nextPayoutAt instanceof Date ? plan.nextPayoutAt : new Date(String(plan.nextPayoutAt))),
  ]));
  const payouts = await db.select().from(savingsPayouts).where(and(
    inArray(savingsPayouts.planId, plans.map((plan) => plan.id)),
    inArray(savingsPayouts.periodKey, [...periodKeyByPlan.values()]),
  ));
  return plans.map((plan) => ({
    ...plan,
    payouts: payouts.filter((payout) => payout.planId === plan.id && payout.periodKey === periodKeyByPlan.get(plan.id)),
  }));
}

export async function reviewSavingsPlan(adminId: number, planId: number, decision: SavingsDecision, rejectionReason?: string) {
  const db = await requireAdministrator(adminId);
  const reason = rejectionReason?.trim() ?? "";
  if (decision === "reject" && (reason.length < 3 || reason.length > 500)) {
    throw new Error("سبب رفض الإدخار إلزامي من 3 إلى 500 حرف");
  }
  const result = await db.transaction(async (tx) => {
    const [plan] = await tx.select().from(savingsPlans).where(eq(savingsPlans.id, planId)).for("update").limit(1);
    if (!plan) throw new Error("عملية الإدخار غير موجودة");
    if (plan.status !== "pending_approval") throw new Error("تمت مراجعة عملية الإدخار مسبقًا");

    if (decision === "reject") {
      const [wallet] = await tx.select().from(wallets).where(eq(wallets.userId, plan.userId)).for("update").limit(1);
      if (!wallet) throw new Error("محفظة العميل غير متاحة");
      const principalMinor = parseMoneyMinorUnits(plan.principalAmount);
      const feeMinor = parseMoneyMinorUnits(plan.feeAmount);
      const totalDebit = formatMoneyMinorUnits(principalMinor + feeMinor);
      const reservationToRelease = parseMoneyMinorUnits(wallet.reservedSavings) >= principalMinor + feeMinor ? totalDebit : plan.principalAmount;
      const released = await tx.update(wallets).set({
        reservedSavings: sql`${wallets.reservedSavings} - ${reservationToRelease}`,
      }).where(and(eq(wallets.userId, plan.userId), sql`${wallets.reservedSavings} >= ${reservationToRelease}`));
      if (affectedRows(released) !== 1) throw new Error("تعذر تحرير مبلغ الإدخار المحجوز");
      await tx.update(savingsPlans).set({ status: "rejected", rejectionReason: reason, approvedBy: adminId, approvedAt: new Date() }).where(eq(savingsPlans.id, plan.id));
      await tx.update(transactions).set({ status: "rejected", note: `رُفض طلب الإدخار ${plan.reference}: ${reason}`, customerDescription: `رُفض طلب الإدخار وتم تحرير المبلغ المحجوز دون خصم.` }).where(and(
        eq(transactions.userId, plan.userId),
        eq(transactions.reference, savingsTransactionReference(plan.reference, "request")),
        eq(transactions.status, "pending"),
      ));
      await tx.insert(notifications).values({
        userId: plan.userId,
        title: "تم رفض طلب الإدخار",
        body: `رُفض طلب الإدخار ${plan.reference}. السبب: ${reason}. تم تحرير المبلغ المحجوز دون خصم.`,
        type: "savings",
        operationId: savingsNotificationOperation(plan.reference, "rejected"),
      });
      return { success: true as const, status: "rejected" as const, reference: plan.reference };
    }

    const financingWallet = await getOrCreateFinancingWallet(tx, adminId);
    const [wallet] = await tx.select().from(wallets).where(eq(wallets.userId, plan.userId)).for("update").limit(1);
    if (!wallet) throw new Error("محفظة العميل غير متاحة");
    const principalMinor = parseMoneyMinorUnits(plan.principalAmount);
    const feeMinor = parseMoneyMinorUnits(plan.feeAmount);
    const totalDebit = formatMoneyMinorUnits(principalMinor + feeMinor);
    const legacyReservation = parseMoneyMinorUnits(wallet.reservedSavings) < principalMinor + feeMinor;
    const reservationToRelease = legacyReservation ? plan.principalAmount : totalDebit;
    const updatedWallet = await tx.update(wallets).set({
      balance: sql`${wallets.balance} - ${totalDebit}`,
      reservedSavings: sql`${wallets.reservedSavings} - ${reservationToRelease}`,
    }).where(and(
      eq(wallets.userId, plan.userId),
      sql`${wallets.reservedSavings} >= ${reservationToRelease}`,
      sql`${wallets.balance} >= ${wallets.reservedWithdrawals} + ${wallets.reservedOrders} + ${wallets.reservedTransfers} + ${wallets.reservedSavings} + ${legacyReservation ? plan.feeAmount : "0.00"}`,
    ));
    if (affectedRows(updatedWallet) !== 1) throw new Error("لم يعد رصيد المحفظة المتاح كافيًا بعد مراجعة الطلب شاملًا الرسوم");
    const [savedWallet] = await tx.select({ balance: wallets.balance }).from(wallets).where(eq(wallets.userId, plan.userId)).limit(1);
    if (!savedWallet) throw new Error("تعذر تأكيد رصيد المحفظة");
    const now = new Date();
    const nextPayoutAt = addSavingsPeriod(now, plan.frequency as SavingsFrequency);
    const transitionedPlan = await tx.update(savingsPlans).set({
      status: "active",
      financingWalletId: financingWallet.id,
      startAt: now,
      nextPayoutAt,
      approvedBy: adminId,
      approvedAt: now,
    }).where(and(eq(savingsPlans.id, plan.id), eq(savingsPlans.status, "pending_approval")));
    if (affectedRows(transitionedPlan) !== 1) throw new Error("تمت مراجعة عملية الإدخار بالتزامن؛ لم يُنفذ الخصم مرة ثانية");
    const principalTransaction = await tx.update(transactions).set({
      type: "adjustment",
      amount: plan.principalAmount,
      status: "approved",
      note: `خصم مبلغ ${plan.principalAmount} جنيه لعملية الإدخار ${plan.reference}`,
      direction: "debit",
      customerTitle: "خصم الإدخار",
      customerDescription: `خصم مبلغ ${plan.principalAmount} جنيه لعملية الإدخار. تم الخصم بعد الموافقة ولا يُخصم مرة أخرى.`,
      source: "savings_principal",
      balanceBefore: wallet.balance,
      balanceAfter: formatMoneyMinorUnits(parseMoneyMinorUnits(wallet.balance) - principalMinor),
    }).where(and(
      eq(transactions.userId, plan.userId),
      eq(transactions.reference, savingsTransactionReference(plan.reference, "request")),
      eq(transactions.status, "pending"),
    ));
    // Legacy plans created before the request entry was introduced still receive
    // one principal entry, while new plans never get a duplicate principal row.
    if (affectedRows(principalTransaction) !== 1) {
      await tx.insert(transactions).values({
        userId: plan.userId,
        reference: savingsTransactionReference(plan.reference, "legacy-principal"),
        type: "adjustment",
        amount: plan.principalAmount,
        currency: "EGP",
        status: "approved",
        note: `خصم مبلغ ${plan.principalAmount} جنيه لعملية الإدخار ${plan.reference}`,
        direction: "debit",
        customerTitle: "خصم الإدخار",
        customerDescription: `خصم مبلغ ${plan.principalAmount} جنيه لعملية الإدخار. تم الخصم بعد الموافقة ولا يُخصم مرة أخرى.`,
        source: "savings_principal",
        balanceBefore: wallet.balance,
        balanceAfter: formatMoneyMinorUnits(parseMoneyMinorUnits(wallet.balance) - principalMinor),
      });
    }
    await tx.insert(cashLedger).values({
      entryReference: `${plan.reference}:principal`,
      idempotencyKey: `${plan.reference}:principal`,
      userId: plan.userId,
      direction: "debit",
      amount: plan.principalAmount,
      balanceAfter: formatMoneyMinorUnits(parseMoneyMinorUnits(wallet.balance) - principalMinor),
      currency: "EGP",
      source: "savings_principal",
      status: "confirmed",
    });
    const [customer] = await tx.select({ name: users.name }).from(users).where(eq(users.id, plan.userId)).limit(1);
    await moveFinancingFunds(tx, {
      walletId: financingWallet.id,
      adminId,
      savingsPlanId: plan.id,
      customerUserId: plan.userId,
      customerName: customer?.name,
      reference: `${plan.reference}:principal-in`,
      idempotencyKey: `${plan.reference}:principal-in`,
      type: "savings_principal",
      direction: "credit",
      amount: plan.principalAmount,
      source: `أصل الإدخار ${plan.reference}`,
    });
    if (feeMinor > 0) {
      const feeReference = `${plan.reference}:fee`;
      const balanceAfterPrincipal = formatMoneyMinorUnits(parseMoneyMinorUnits(wallet.balance) - principalMinor);
      await tx.insert(transactions).values({
        userId: plan.userId,
        reference: feeReference,
        type: "fee",
        amount: plan.feeAmount,
        currency: "EGP",
        status: "approved",
        note: `خصم رسوم الإدخار بقيمة ${plan.feeAmount} جنيه لعملية الإدخار ${plan.reference}`,
        direction: "debit",
        customerTitle: "رسوم الإدخار",
        customerDescription: `خصم رسوم الإدخار بقيمة ${plan.feeAmount} جنيه. خُصمت مرة واحدة بعد الموافقة.`,
        source: "savings_fee",
        balanceBefore: balanceAfterPrincipal,
        balanceAfter: savedWallet.balance,
      });
      await tx.insert(cashLedger).values({
        entryReference: `${feeReference}:ledger`,
        idempotencyKey: `${feeReference}:ledger`,
        userId: plan.userId,
        direction: "debit",
        amount: plan.feeAmount,
        balanceAfter: savedWallet.balance,
        currency: "EGP",
        source: "savings_fee",
        status: "confirmed",
      });
    }
    await tx.insert(notifications).values({
      userId: plan.userId,
      title: "تمت الموافقة على الإدخار",
      body: `تم خصم أصل الإدخار ${plan.principalAmount} ج.م ورسوم الاعتماد ${plan.feeAmount} ج.م مرة واحدة. أول استحقاق للعائد ${getSavingsProduct(plan.frequency as SavingsFrequency).periodLabel}.`,
      type: "savings",
      operationId: savingsNotificationOperation(plan.reference, "approved"),
    });
    return { success: true as const, status: "active" as const, reference: plan.reference };
  });
  if (result.status !== "active") return result;

  try {
    const schedule = await ensureSavingsAutoPayoutHeartbeat();
    return { ...result, autoPayoutSchedule: schedule.status };
  } catch (error) {
    console.error("[savings-auto-payout] schedule registration failed", error instanceof Error ? error.name : "unknown");
    return { ...result, autoPayoutSchedule: "unavailable" as const };
  }
}

export async function cancelSavingsPlan(userId: number, planId: number) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  return db.transaction(async (tx) => {
    // Lock the plan first, matching reviewSavingsPlan to avoid wallet/plan deadlocks.
    const [plan] = await tx.select().from(savingsPlans).where(eq(savingsPlans.id, planId)).for("update").limit(1);
    if (!plan || plan.userId !== userId) throw new Error("عملية الإدخار غير موجودة لهذا الحساب");
    if (plan.status === "cancelled") {
      return { success: true as const, status: "cancelled" as const, reference: plan.reference, releasedAmount: "0.00", duplicate: true };
    }
    if (plan.status !== "pending_approval") throw new Error("لا يمكن إلغاء الإدخار بعد مراجعته");
    const [wallet] = await tx.select().from(wallets).where(eq(wallets.userId, userId)).for("update").limit(1);
    if (!wallet) throw new Error("محفظة العميل أو عملية الإدخار غير متاحة");
    const reservationAmount = getSavingsReservationReleaseAmount(plan.principalAmount, plan.feeAmount, wallet.reservedSavings);
    const reservationMinor = parseMoneyMinorUnits(reservationAmount);
    const released = await tx.update(wallets).set({ reservedSavings: sql`${wallets.reservedSavings} - ${reservationAmount}` }).where(and(
      eq(wallets.userId, userId),
      sql`${wallets.reservedSavings} >= ${reservationAmount}`,
    ));
    if (affectedRows(released) !== 1) throw new Error("تعذر تحرير مبلغ الإدخار المحجوز؛ أعد تحميل محفظتك وحاول مجددًا");
    const now = new Date();
    const transitioned = await tx.update(savingsPlans).set({ status: "cancelled", cancelledAt: now }).where(and(eq(savingsPlans.id, plan.id), eq(savingsPlans.status, "pending_approval")));
    if (affectedRows(transitioned) !== 1) throw new Error("تم إلغاء طلب الإدخار بالتزامن؛ أعد تحميل السجل");
    const requestReference = savingsTransactionReference(plan.reference, "request");
    const transactionUpdate = await tx.update(transactions).set({ status: "cancelled", note: `أُلغي طلب الإدخار ${plan.reference}`, customerDescription: `أُلغي الطلب وحُرر كامل الحجز ${reservationAmount} ج.م إلى الرصيد المتاح.` }).where(and(
      eq(transactions.userId, userId),
      eq(transactions.reference, requestReference),
      eq(transactions.status, "pending"),
    ));
    if (affectedRows(transactionUpdate) !== 1) {
      const [requestEntry] = await tx.select({ id: transactions.id }).from(transactions).where(and(eq(transactions.userId, userId), eq(transactions.reference, requestReference))).limit(1);
      if (!requestEntry) await tx.insert(transactions).values({
        userId, reference: `${plan.reference}:cancel`, type: "adjustment", amount: reservationAmount, currency: "EGP", status: "cancelled",
        note: `إلغاء طلب الإدخار ${plan.reference} وتحرير الحجز`, direction: "credit", customerTitle: "إلغاء طلب الإدخار",
        customerDescription: `حُرر الحجز إلى الرصيد المتاح دون خصم أو إضافة مزدوجة.`, source: "savings_cancel", balanceBefore: wallet.balance, balanceAfter: wallet.balance,
      });
    }
    await tx.insert(notifications).values({
      userId,
      title: "تم إلغاء طلب الإدخار",
      body: `تم إلغاء طلب الإدخار ${plan.reference} وتحرير ${formatMoneyMinorUnits(reservationMinor)} ج.م إلى الرصيد المتاح.`,
      type: "savings",
      operationId: savingsNotificationOperation(plan.reference, "cancelled"),
    });
    return { success: true as const, status: "cancelled" as const, reference: plan.reference, releasedAmount: reservationAmount, duplicate: false };
  });
}

export async function refundSavingsPlan(userId: number, planId: number) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  return db.transaction(async (tx) => {
    const [initial] = await tx.select().from(savingsPlans).where(eq(savingsPlans.id, planId)).limit(1);
    if (!initial || initial.userId !== userId) throw new Error("عملية الإدخار غير موجودة لهذا الحساب");
    const [plan] = await tx.select().from(savingsPlans).where(eq(savingsPlans.id, planId)).for("update").limit(1);
    if (!plan) throw new Error("عملية الإدخار غير متاحة");
    if (plan.status !== "active") throw new Error("لا يمكن استرداد عملية الإدخار في حالتها الحالية");
    const now = new Date();
    if (plan.nextPayoutAt && plan.nextPayoutAt <= now) {
      const dueKey = savingsPeriodKey(plan.frequency as SavingsFrequency, new Date(plan.nextPayoutAt));
      const [duePayout] = await tx.select().from(savingsPayouts)
        .where(and(eq(savingsPayouts.planId, plan.id), eq(savingsPayouts.periodKey, dueKey)))
        .for("update").limit(1);
    if (duePayout?.status !== "paid") throw new Error("توجد أرباح مستحقة تنتظر المعالجة؛ يجب اعتمادها قبل استرداد الإدخار");
    }
    const eligibleAt = addSavingsRefundPeriod(plan.createdAt, plan.frequency as SavingsFrequency);
    if (eligibleAt > now) throw new Error(`لا يمكن الاسترداد قبل ${eligibleAt.toLocaleString("ar-EG")}`);
    const refundReference = savingsRefundReference(plan.id);
    const financingWallet = await getFinancingWalletForPlan(tx, plan.financingWalletId);
    const [wallet] = await tx.select().from(wallets).where(eq(wallets.userId, userId)).for("update").limit(1);
    if (!wallet) throw new Error("محفظة العميل غير متاحة");
    const [customer] = await tx.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
    await moveFinancingFunds(tx, {
      walletId: financingWallet.id,
      adminId: financingWallet.adminId,
      savingsPlanId: plan.id,
      customerUserId: userId,
      customerName: customer?.name,
      reference: `${refundReference}:principal-out`,
      idempotencyKey: `${refundReference}:principal-out`,
      type: "savings_refund",
      direction: "debit",
      amount: plan.principalAmount,
      source: `استرداد أصل الإدخار ${plan.reference}`,
    });
    const updatedWallet = await tx.update(wallets).set({ balance: sql`${wallets.balance} + ${plan.principalAmount}` }).where(eq(wallets.userId, userId));
    if (affectedRows(updatedWallet) !== 1) throw new Error("تعذر إعادة أصل الإدخار إلى المحفظة");
    const [savedWallet] = await tx.select({ balance: wallets.balance }).from(wallets).where(eq(wallets.userId, userId)).limit(1);
    if (!savedWallet) throw new Error("تعذر تأكيد رصيد الاسترداد");
    const transitioned = await tx.update(savingsPlans).set({ status: "refunded", financingWalletId: financingWallet.id, refundedAt: now, refundReference, nextPayoutAt: null }).where(and(eq(savingsPlans.id, plan.id), eq(savingsPlans.status, "active")));
    if (affectedRows(transitioned) !== 1) throw new Error("تم استرداد الإدخار بالتزامن؛ لم يُضف المبلغ مرة ثانية");
    await tx.insert(transactions).values({
      userId,
      reference: refundReference,
      type: "adjustment",
      amount: plan.principalAmount,
      currency: "EGP",
      status: "approved",
      note: `استرداد أصل الإدخار ${plan.reference}`,
      direction: "credit",
      customerTitle: "استرداد الإدخار",
      customerDescription: `أُعيد أصل الإدخار إلى المحفظة. الأرباح المدفوعة فعليًا حتى الاسترداد: ${plan.totalPaid} ج.م.`,
      source: "savings_refund",
      balanceBefore: wallet.balance,
      balanceAfter: savedWallet.balance,
    });
    await tx.insert(cashLedger).values({
      entryReference: `${refundReference}:ledger`,
      idempotencyKey: `${refundReference}:ledger`,
      userId,
      direction: "credit",
      amount: plan.principalAmount,
      balanceAfter: savedWallet.balance,
      currency: "EGP",
      source: "savings_refund",
      status: "confirmed",
    });
    await tx.insert(notifications).values({
      userId,
      title: "تم استرداد الإدخار",
      body: `أُعيد أصل الإدخار ${plan.principalAmount} ج.م إلى محفظتك. الأرباح المدفوعة فعليًا: ${plan.totalPaid} ج.م، وتوقفت العوائد المستقبلية.`,
      type: "savings",
      operationId: savingsNotificationOperation(plan.reference, "refunded"),
    });
    return { success: true as const, status: "refunded" as const, reference: plan.reference, refundedAmount: plan.principalAmount, paidProfit: plan.totalPaid, eligibleAt };
  });
}

export async function processAutomaticSavingsPayouts(now = new Date()) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة لمعالجة أرباح الإدخار");
  const eligibleBefore = new Date(now.getTime() - SAVINGS_AUTO_PAYOUT_GRACE_MS);
  const candidates = await db.select({ id: savingsPlans.id, financingWalletId: savingsPlans.financingWalletId })
    .from(savingsPlans)
    .where(and(
      eq(savingsPlans.status, "active"),
      isNotNull(savingsPlans.nextPayoutAt),
      lte(savingsPlans.nextPayoutAt, eligibleBefore),
      or(isNull(savingsPlans.nextPayoutAttemptAt), lte(savingsPlans.nextPayoutAttemptAt, now)),
    ))
    .orderBy(asc(savingsPlans.nextPayoutAt)).limit(100);
  let processed = 0;
  let blocked = 0;
  let failed = 0;
  let skipped = 0;
  const deferCandidate = async (planId: number) => {
    try {
      await db.update(savingsPlans).set({ nextPayoutAttemptAt: new Date(now.getTime() + SAVINGS_PAYOUT_RETRY_BACKOFF_MS) })
        .where(and(eq(savingsPlans.id, planId), eq(savingsPlans.status, "active")));
    } catch (error) {
      console.error(`[savings-auto-payout] unable to defer plan ${planId}`, error instanceof Error ? error.message : "unknown error");
    }
  };
  for (const candidate of candidates) {
    try {
      let adminId: number | undefined;
      if (candidate.financingWalletId) {
        const [wallet] = await db.select({ adminId: savingsFinancingWallets.adminId }).from(savingsFinancingWallets).where(eq(savingsFinancingWallets.id, candidate.financingWalletId)).limit(1);
        adminId = wallet?.adminId;
      } else {
        const [admin] = await db.select({ id: users.id }).from(users).where(and(eq(users.role, "admin"), sql`lower(coalesce(${users.emailNormalized}, ${users.email})) = ${ADMIN_EMAIL}`)).limit(1);
        adminId = admin?.id;
      }
      if (!adminId) { skipped += 1; await deferCandidate(candidate.id); continue; }
      const result = await confirmSavingsPayout(adminId, candidate.id, now, { automatic: true });
      if (result.status === "paid") processed += 1;
      else if (result.status === "blocked") blocked += 1;
    } catch (error) {
      failed += 1;
      await deferCandidate(candidate.id);
      console.error(`[savings-auto-payout] plan ${candidate.id} failed`, error instanceof Error ? error.message : "unknown error");
    }
  }
  return { processed, scanned: candidates.length, blocked, failed, skipped };
}

export async function confirmSavingsPayout(adminId: number, planId: number, now = new Date(), options: { automatic?: boolean } = {}) {
  const automatic = options.automatic === true;
  const db = await requireAdministrator(adminId);
  return db.transaction(async (tx) => {
    const [plan] = await tx.select().from(savingsPlans).where(eq(savingsPlans.id, planId)).for("update").limit(1);
    if (!plan || plan.status !== "active" || !plan.nextPayoutAt || plan.nextPayoutAt > now) return { status: "not_due" as const };
    if (automatic && !isSavingsAutoPayoutDue(plan.nextPayoutAt, now.getTime())) return { status: "not_due" as const };
    const frequency = plan.frequency as SavingsFrequency;
    const periodStart = new Date(plan.nextPayoutAt);
    const periodEnd = getNextSavingsPayoutAt(periodStart, frequency, plan.startAt ?? periodStart);
    const nextPayoutAt = periodEnd;
    const periodKey = savingsPeriodKey(frequency, periodStart);
    const reference = payoutReference(plan.id, periodKey);
    const expectedAmount = calculateExpectedInterestAtRate(plan.principalAmount, plan.ratePpm || ratePercentToPpm(plan.ratePercent));
    const paidAmount = roundInterestToWallet(expectedAmount);
    const paidMinor = parseMoneyMinorUnits(paidAmount);
    const [existing] = await tx.select().from(savingsPayouts)
      .where(and(eq(savingsPayouts.planId, plan.id), eq(savingsPayouts.periodKey, periodKey)))
      .for("update").limit(1);
    if (existing?.status === "paid") return { status: "already_paid" as const, amount: existing.paidAmount, periodKey };

    const financingWallet = await getFinancingWalletForPlan(tx, plan.financingWalletId);
    if (financingWallet.adminId !== adminId) throw new Error("محفظة تمويل هذه الخطة لا تتبع حساب المدير الحالي");
    const [wallet] = await tx.select().from(wallets).where(eq(wallets.userId, plan.userId)).for("update").limit(1);
    if (!wallet) throw new Error("محفظة العميل غير متاحة");
    const nextPayout = { nextPayoutAt, nextPayoutAttemptAt: null, lastPayoutAt: now, financingWalletId: financingWallet.id };
    const periodUpdate = and(eq(savingsPlans.id, plan.id), eq(savingsPlans.status, "active"), eq(savingsPlans.nextPayoutAt, periodStart));

    if (paidMinor > 0 && parseMoneyMinorUnits(financingWallet.balance) < paidMinor) {
      const blockReason = "لا يوجد تمويل كافٍ في محفظة تمويل الإدخار";
      const retryAt = new Date(now.getTime() + SAVINGS_PAYOUT_RETRY_BACKOFF_MS);
      if (existing) {
        await tx.update(savingsPayouts).set({ status: "blocked", blockReason }).where(eq(savingsPayouts.id, existing.id));
      } else {
        await tx.insert(savingsPayouts).values({ planId: plan.id, userId: plan.userId, periodKey, periodStart, periodEnd, expectedAmount, paidAmount: "0.00", status: "blocked", blockReason });
      }
      const blockedPlanUpdate = await tx.update(savingsPlans).set({
        financingWalletId: financingWallet.id,
        nextPayoutAttemptAt: retryAt,
        ...(!existing ? { totalAccrued: sql`${savingsPlans.totalAccrued} + ${expectedAmount}` } : {}),
      }).where(periodUpdate);
      if (affectedRows(blockedPlanUpdate) !== 1) throw new Error("تغيرت الخطة بالتزامن أثناء تسجيل تعذر التمويل");
      return { status: "blocked" as const, expectedAmount, periodKey };
    }

    let savedWallet = { balance: wallet.balance };
    let customerName: string | null = null;
    if (paidMinor > 0) {
      const updatedWallet = await tx.update(wallets).set({
        balance: sql`${wallets.balance} + ${paidAmount}`,
        profitLoss: sql`${wallets.profitLoss} + ${paidAmount}`,
      }).where(eq(wallets.userId, plan.userId));
      if (affectedRows(updatedWallet) !== 1) throw new Error("تعذر إضافة العائد إلى محفظة العميل");
      const [updated] = await tx.select({ balance: wallets.balance }).from(wallets).where(eq(wallets.userId, plan.userId)).limit(1);
      if (!updated) throw new Error("تعذر تأكيد رصيد العائد");
      savedWallet = updated;
      const [customer] = await tx.select({ name: users.name }).from(users).where(eq(users.id, plan.userId)).limit(1);
      customerName = customer?.name ?? null;
      await moveFinancingFunds(tx, {
        walletId: financingWallet.id,
        adminId,
        savingsPlanId: plan.id,
        customerUserId: plan.userId,
        customerName,
        reference: `${reference}:financing`,
        idempotencyKey: `${reference}:financing`,
        type: "savings_profit",
        direction: "debit",
        amount: paidAmount,
        source: `عائد إدخار ${periodKey}${automatic ? " - صرف تلقائي بعد انتهاء مهلة الاعتماد" : ""}`,
      });
    }

    if (existing) {
      await tx.update(savingsPayouts).set({ status: "paid", paidAmount, transactionReference: reference, paidAt: now }).where(eq(savingsPayouts.id, existing.id));
    } else {
      await tx.insert(savingsPayouts).values({ planId: plan.id, userId: plan.userId, periodKey, periodStart, periodEnd, expectedAmount, paidAmount, status: "paid", transactionReference: reference, paidAt: now });
    }
    const planUpdate = await tx.update(savingsPlans).set({
      ...nextPayout,
      ...(existing ? {} : { totalAccrued: sql`${savingsPlans.totalAccrued} + ${expectedAmount}` }),
      totalPaid: sql`${savingsPlans.totalPaid} + ${paidAmount}`,
    }).where(periodUpdate);
    if (affectedRows(planUpdate) !== 1) throw new Error("تغيرت الخطة بالتزامن؛ أُلغيت العملية بالكامل");

    if (paidMinor > 0) {
      await tx.insert(transactions).values({ userId: plan.userId, reference, type: "profit", amount: paidAmount, currency: "EGP", status: "approved", note: `${automatic ? "صرف تلقائي" : "عائد إدخار"} ${periodKey}`, direction: "credit", customerTitle: "تم إرسال الأرباح بنجاح", customerDescription: automatic ? `أُضيف ${paidAmount} ج.م تلقائيًا عن فترة ${periodKey} بعد انتهاء مهلة الاعتماد (5 دقائق).` : `تمت إضافة ${paidAmount} ج.م عائدًا ممولًا عن فترة ${periodKey} إلى محفظتك.`, source: "savings_profit", balanceBefore: wallet.balance, balanceAfter: savedWallet.balance });
      await tx.insert(cashLedger).values({ entryReference: `${reference}:ledger`, idempotencyKey: `${reference}:ledger`, userId: plan.userId, direction: "credit", amount: paidAmount, balanceAfter: savedWallet.balance, currency: "EGP", source: "savings_profit", status: "confirmed" });
    }
    await tx.insert(notifications).values({ userId: plan.userId, title: "تم إرسال الأرباح بنجاح", body: paidMinor > 0 ? automatic ? `أُضيف تلقائيًا ${paidAmount} ج.م عن فترة ${periodKey} بعد انتهاء مهلة الاعتماد.` : `تم اعتماد وإضافة ${paidAmount} ج.م عن فترة ${periodKey} إلى محفظتك.` : `تم اعتماد استحقاق فترة ${periodKey}؛ قيمة العائد أقل من أصغر وحدة نقدية.`, type: "savings", operationId: reference });
    return { status: "paid" as const, amount: paidAmount, periodKey, nextPayoutAt };
  });
}
