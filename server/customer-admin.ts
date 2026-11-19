import { and, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import {
  moneyTransfers,
  requests,
  savingsPayouts,
  savingsPlans,
  transactions,
  userProfileAudits,
  users,
  wallets,
} from "../drizzle/schema";
import { parseMoneyMinorUnits, formatMoneyMinorUnits, resolveTransactionMetadata } from "../shared/transactions";
import { listFrozenCustomerIds } from "./account-controls";
import { readEffectiveVerificationStatesForUsers, readEffectiveVerificationState } from "./account-verification-state";
import { requireAdministrator } from "./payment-settings";
import { maskNationalId } from "./profile-data";
import { getAdminCustomerCoinDetails } from "./coin";

function safeDecimal(value: unknown) {
  if (typeof value === "string" && /^\d+(?:\.\d{1,4})?$/.test(value)) return value;
  if (typeof value === "number" && Number.isFinite(value)) return value.toFixed(2);
  return "0.00";
}

function availableBalance(wallet: { balance?: string | null; reservedWithdrawals?: string | null; reservedOrders?: string | null; reservedTransfers?: string | null; reservedSavings?: string | null } | null) {
  if (!wallet) return "0.00";
  try {
    const balance = parseMoneyMinorUnits(wallet.balance ?? "0.00");
    const reserved = [wallet.reservedWithdrawals, wallet.reservedOrders, wallet.reservedTransfers, wallet.reservedSavings]
      .reduce((sum, value) => sum + parseMoneyMinorUnits(value ?? "0.00"), 0);
    return formatMoneyMinorUnits(Math.max(0, balance - reserved));
  } catch {
    return "0.00";
  }
}

function safeLimit(limit: number | undefined) {
  return Math.min(50, Math.max(1, Math.trunc(limit ?? 25)));
}

function safeOffset(offset: number | undefined) {
  return Math.min(100_000, Math.max(0, Math.trunc(offset ?? 0)));
}

export async function listAdminCustomers(adminId: number, rawSearch = "") {
  const db = await requireAdministrator(adminId);
  const search = rawSearch.trim().slice(0, 100);
  let filter: any = eq(users.role, "user");
  if (/^\d{10}$/.test(search)) {
    filter = and(eq(users.role, "user"), eq(users.customerId, search));
  } else if (search) {
    const pattern = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
    filter = and(eq(users.role, "user"), or(
      like(users.customerId, pattern),
      like(users.name, pattern),
      like(users.email, pattern),
      like(users.givenName, pattern),
      like(users.fatherName, pattern),
      like(users.phoneNumber, pattern),
    ));
  }

  const rows = await db.select({
    userId: users.id,
    customerId: users.customerId,
    name: users.name,
    email: users.email,
    givenName: users.givenName,
    fatherName: users.fatherName,
    phoneNumber: users.phoneNumber,
    birthDate: users.birthDate,
    governorate: users.governorate,
    nationalIdLast4: users.nationalIdLast4,
    phoneVerifiedAt: users.phoneVerifiedAt,
    profileCompletedAt: users.profileCompletedAt,
    role: users.role,
    status: users.status,
    deletedAt: users.deletedAt,
    createdAt: users.createdAt,
    wallet: {
      balance: wallets.balance,
      reservedWithdrawals: wallets.reservedWithdrawals,
      reservedOrders: wallets.reservedOrders,
      reservedTransfers: wallets.reservedTransfers,
      reservedSavings: wallets.reservedSavings,
      currency: wallets.currency,
    },
  }).from(users).leftJoin(wallets, eq(users.id, wallets.userId))
    .where(filter).orderBy(desc(users.createdAt)).limit(100);

  if (!rows.length) return [];
  const userIds = rows.map((row) => row.userId);
  const [frozenIds, verificationStates] = await Promise.all([
    listFrozenCustomerIds(adminId),
    readEffectiveVerificationStatesForUsers(adminId, userIds),
  ]);
  const frozen = new Set(frozenIds);
  return rows.map((row) => {
    const { userId, nationalIdLast4, wallet, ...userFields } = row;
    const verification = verificationStates.get(userId);
    return {
      user: {
        id: userId,
        ...userFields,
        nationalIdMasked: maskNationalId(nationalIdLast4),
        accountFrozen: frozen.has(userId),
        verificationStatus: verification?.status ?? "not_submitted",
        verificationReviewedAt: verification?.reviewedAt ?? null,
      },
      wallet: wallet?.balance == null ? null : wallet,
      available: availableBalance(wallet?.balance == null ? null : wallet),
    };
  });
}

export async function findAdminCustomer(adminId: number, customerId: string) {
  const db = await requireAdministrator(adminId);
  const [row] = await db.select({ id: users.id }).from(users)
    .where(and(eq(users.customerId, customerId), eq(users.role, "user"))).limit(1);
  if (!row) return null;
  const customers = await listAdminCustomers(adminId, customerId);
  return customers.find((item: any) => item.user.id === row.id) ?? null;
}

export async function getAdminCustomerDetails(adminId: number, userId: number, rawOffset?: number, rawLimit?: number) {
  const db = await requireAdministrator(adminId);
  const offset = safeOffset(rawOffset);
  const limit = safeLimit(rawLimit);
  const [user] = await db.select({
    id: users.id,
    customerId: users.customerId,
    name: users.name,
    email: users.email,
    givenName: users.givenName,
    fatherName: users.fatherName,
    phoneNumber: users.phoneNumber,
    birthDate: users.birthDate,
    governorate: users.governorate,
    nationalIdLast4: users.nationalIdLast4,
    phoneVerifiedAt: users.phoneVerifiedAt,
    profileCompletedAt: users.profileCompletedAt,
    role: users.role,
    status: users.status,
    deletedAt: users.deletedAt,
    createdAt: users.createdAt,
    lastOpenedAt: users.lastOpenedAt,
    appVersion: users.appVersion,
    appBuildNumber: users.appBuildNumber,
  }).from(users).where(and(eq(users.id, userId), eq(users.role, "user"))).limit(1);
  if (!user) throw new Error("حساب العميل غير موجود");

  const [wallet] = await db.select({
    balance: wallets.balance,
    reservedWithdrawals: wallets.reservedWithdrawals,
    reservedOrders: wallets.reservedOrders,
    reservedTransfers: wallets.reservedTransfers,
    reservedSavings: wallets.reservedSavings,
    reservedTotal: sql<string>`COALESCE(${wallets.reservedWithdrawals}, 0) + COALESCE(${wallets.reservedOrders}, 0) + COALESCE(${wallets.reservedTransfers}, 0) + COALESCE(${wallets.reservedSavings}, 0)`,
    currency: wallets.currency,
    updatedAt: wallets.updatedAt,
  }).from(wallets).where(eq(wallets.userId, userId)).limit(1);

  const [verification, depositSummaryRows, withdrawalSummaryRows, savingsSummaryRows, profitSummaryRows, sentSummaryRows, receivedSummaryRows,
    transactionsCountRows, requestsCountRows, transfersCountRows, savingsCountRows, payoutsCountRows, auditsCountRows] = await Promise.all([
    readEffectiveVerificationState(db, userId),
    db.select({ count: sql<number>`COUNT(*)`, amount: sql<string>`COALESCE(SUM(${transactions.amount}), 0)` }).from(transactions)
      .where(and(eq(transactions.userId, userId), eq(transactions.type, "deposit"), eq(transactions.status, "approved"))),
    db.select({ count: sql<number>`COUNT(*)`, amount: sql<string>`COALESCE(SUM(${transactions.amount}), 0)` }).from(transactions)
      .where(and(eq(transactions.userId, userId), eq(transactions.type, "withdrawal"), eq(transactions.status, "approved"))),
    db.select({
      requestCount: sql<number>`COUNT(*)`,
      requestedPrincipal: sql<string>`COALESCE(SUM(${savingsPlans.principalAmount}), 0)`,
      activePrincipal: sql<string>`COALESCE(SUM(CASE WHEN ${savingsPlans.status} = 'active' THEN ${savingsPlans.principalAmount} ELSE 0 END), 0)`,
      completedPrincipal: sql<string>`COALESCE(SUM(CASE WHEN ${savingsPlans.status} = 'completed' THEN ${savingsPlans.principalAmount} ELSE 0 END), 0)`,
      cancelledCount: sql<number>`COALESCE(SUM(CASE WHEN ${savingsPlans.status} IN ('cancelled', 'refunded') THEN 1 ELSE 0 END), 0)`,
      rejectedCount: sql<number>`COALESCE(SUM(CASE WHEN ${savingsPlans.status} = 'rejected' THEN 1 ELSE 0 END), 0)`,
    }).from(savingsPlans).where(eq(savingsPlans.userId, userId)),
    db.select({ count: sql<number>`COUNT(*)`, amount: sql<string>`COALESCE(SUM(${savingsPayouts.paidAmount}), 0)` }).from(savingsPayouts)
      .where(and(eq(savingsPayouts.userId, userId), eq(savingsPayouts.status, "paid"))),
    db.select({ count: sql<number>`COUNT(*)`, amount: sql<string>`COALESCE(SUM(${moneyTransfers.amount}), 0)` }).from(moneyTransfers)
      .where(and(eq(moneyTransfers.senderUserId, userId), eq(moneyTransfers.status, "approved"))),
    db.select({ count: sql<number>`COUNT(*)`, amount: sql<string>`COALESCE(SUM(${moneyTransfers.amount}), 0)` }).from(moneyTransfers)
      .where(and(eq(moneyTransfers.recipientUserId, userId), eq(moneyTransfers.status, "approved"))),
    db.select({ total: sql<number>`COUNT(*)` }).from(transactions).where(eq(transactions.userId, userId)),
    db.select({ total: sql<number>`COUNT(*)` }).from(requests).where(eq(requests.userId, userId)),
    db.select({ total: sql<number>`COUNT(*)` }).from(moneyTransfers)
      .where(or(eq(moneyTransfers.senderUserId, userId), eq(moneyTransfers.recipientUserId, userId))),
    db.select({ total: sql<number>`COUNT(*)` }).from(savingsPlans).where(eq(savingsPlans.userId, userId)),
    db.select({ total: sql<number>`COUNT(*)` }).from(savingsPayouts).where(eq(savingsPayouts.userId, userId)),
    db.select({ total: sql<number>`COUNT(*)` }).from(userProfileAudits).where(eq(userProfileAudits.targetUserId, userId)),
  ]);

  const [transactionsPage, requestsPage, transfersPage, savingsPage, payoutsPage, auditsPage] = await Promise.all([
    db.select().from(transactions).where(eq(transactions.userId, userId))
      .orderBy(desc(transactions.createdAt), desc(transactions.id)).limit(limit + 1).offset(offset),
    db.select({
      id: requests.id,
      reference: requests.reference,
      type: requests.type,
      amount: requests.amount,
      feeAmount: requests.feeAmount,
      currency: requests.currency,
      paymentChannel: requests.paymentChannel,
      transferReference: requests.transferReference,
      payoutReference: requests.payoutReference,
      reviewedBy: requests.reviewedBy,
      destination: requests.destination,
      status: requests.status,
      note: requests.note,
      rejectionReason: requests.rejectionReason,
      reviewedAt: requests.reviewedAt,
      createdAt: requests.createdAt,
      receiptImageUrl: requests.receiptImageUrl,
    }).from(requests).where(eq(requests.userId, userId))
      .orderBy(desc(requests.createdAt), desc(requests.id)).limit(limit + 1).offset(offset),
    db.select({
      id: moneyTransfers.id,
      reference: moneyTransfers.reference,
      senderUserId: moneyTransfers.senderUserId,
      recipientUserId: moneyTransfers.recipientUserId,
      amount: moneyTransfers.amount,
      feeAmount: moneyTransfers.feeAmount,
      currency: moneyTransfers.currency,
      status: moneyTransfers.status,
      note: moneyTransfers.note,
      rejectionReason: moneyTransfers.rejectionReason,
      reviewedAt: moneyTransfers.reviewedAt,
      createdAt: moneyTransfers.createdAt,
    }).from(moneyTransfers)
      .where(or(eq(moneyTransfers.senderUserId, userId), eq(moneyTransfers.recipientUserId, userId)))
      .orderBy(desc(moneyTransfers.createdAt), desc(moneyTransfers.id)).limit(limit + 1).offset(offset),
    db.select({
      id: savingsPlans.id,
      reference: savingsPlans.reference,
      frequency: savingsPlans.frequency,
      principalAmount: savingsPlans.principalAmount,
      feeAmount: savingsPlans.feeAmount,
      ratePercent: savingsPlans.ratePercent,
      status: savingsPlans.status,
      totalAccrued: savingsPlans.totalAccrued,
      totalPaid: savingsPlans.totalPaid,
      startAt: savingsPlans.startAt,
      nextPayoutAt: savingsPlans.nextPayoutAt,
      cancelledAt: savingsPlans.cancelledAt,
      rejectionReason: savingsPlans.rejectionReason,
      createdAt: savingsPlans.createdAt,
    }).from(savingsPlans).where(eq(savingsPlans.userId, userId))
      .orderBy(desc(savingsPlans.createdAt), desc(savingsPlans.id)).limit(limit + 1).offset(offset),
    db.select({
      id: savingsPayouts.id,
      planId: savingsPayouts.planId,
      planReference: savingsPlans.reference,
      frequency: savingsPlans.frequency,
      periodKey: savingsPayouts.periodKey,
      periodStart: savingsPayouts.periodStart,
      periodEnd: savingsPayouts.periodEnd,
      expectedAmount: savingsPayouts.expectedAmount,
      paidAmount: savingsPayouts.paidAmount,
      status: savingsPayouts.status,
      blockReason: savingsPayouts.blockReason,
      transactionReference: savingsPayouts.transactionReference,
      createdAt: savingsPayouts.createdAt,
      paidAt: savingsPayouts.paidAt,
    }).from(savingsPayouts).leftJoin(savingsPlans, eq(savingsPayouts.planId, savingsPlans.id))
      .where(eq(savingsPayouts.userId, userId))
      .orderBy(desc(savingsPayouts.createdAt), desc(savingsPayouts.id)).limit(limit + 1).offset(offset),
    db.select({
      id: userProfileAudits.id,
      adminId: userProfileAudits.adminId,
      changes: userProfileAudits.changes,
      createdAt: userProfileAudits.createdAt,
    }).from(userProfileAudits).where(eq(userProfileAudits.targetUserId, userId))
      .orderBy(desc(userProfileAudits.createdAt), desc(userProfileAudits.id)).limit(limit + 1).offset(offset),
  ]);

  const transferCounterpartyIds = [...new Set(transfersPage.flatMap((transfer) =>
    transfer.senderUserId === userId ? [transfer.recipientUserId] : [transfer.senderUserId],
  ))];
  const adminIds = [...new Set(auditsPage.map((audit) => audit.adminId))];
  const [counterparties, administrators] = await Promise.all([
    transferCounterpartyIds.length ? db.select({ id: users.id, name: users.name, customerId: users.customerId })
      .from(users).where(inArray(users.id, transferCounterpartyIds)) : Promise.resolve([]),
    adminIds.length ? db.select({ id: users.id, name: users.name, email: users.email })
      .from(users).where(inArray(users.id, adminIds)) : Promise.resolve([]),
  ]);
  const counterpartyMap = new Map(counterparties.map((row: any) => [row.id, row]));
  const adminMap = new Map(administrators.map((row: any) => [row.id, row]));

  const paginate = <T,>(items: T[], total: number) => ({
    items: items.slice(0, limit),
    total: Number(total ?? 0),
    offset,
    limit,
    hasMore: items.length > limit,
  });
  const transactionsItems = transactionsPage.slice(0, limit).map((item: any) => ({ ...item, ...resolveTransactionMetadata(item) }));
  const requestsItems = requestsPage.slice(0, limit).map(({ receiptImageUrl, ...item }: any) => ({ ...item, hasReceipt: Boolean(receiptImageUrl) }));
  const transfersItems = transfersPage.slice(0, limit).map((item: any) => {
    const sent = item.senderUserId === userId;
    const counterpartyId = sent ? item.recipientUserId : item.senderUserId;
    return {
      ...item,
      direction: sent ? "sent" : "received",
      counterparty: counterpartyMap.get(counterpartyId) ?? null,
    };
  });
  const auditsItems = auditsPage.slice(0, limit).map((audit: any) => ({ ...audit, admin: adminMap.get(audit.adminId) ?? null }));
  const savingsAggregate = savingsSummaryRows[0] ?? {};
  const [depositSummary] = depositSummaryRows;
  const [withdrawalSummary] = withdrawalSummaryRows;
  const [profitSummary] = profitSummaryRows;
  const [sentSummary] = sentSummaryRows;
  const [receivedSummary] = receivedSummaryRows;
  const { nationalIdLast4, ...safeUser } = user;

  return {
    user: {
      ...safeUser,
      nationalIdMasked: maskNationalId(nationalIdLast4),
      verificationStatus: verification.status,
      verificationSource: verification.source,
      verificationReason: verification.rejectionReason,
      verificationSubmittedAt: verification.submittedAt,
      verificationReviewedAt: verification.reviewedAt,
      verificationReviewedBy: verification.reviewedBy,
    },
    wallet: wallet ?? null,
    available: availableBalance(wallet ?? null),
    coin: await getAdminCustomerCoinDetails(adminId, userId, offset, limit),
    summary: {
      deposits: { count: Number(depositSummary?.count ?? 0), amount: safeDecimal(depositSummary?.amount) },
      withdrawals: { count: Number(withdrawalSummary?.count ?? 0), amount: safeDecimal(withdrawalSummary?.amount) },
      savings: {
        requestCount: Number(savingsAggregate.requestCount ?? 0),
        requestedPrincipal: safeDecimal(savingsAggregate.requestedPrincipal),
        activePrincipal: safeDecimal(savingsAggregate.activePrincipal),
        completedPrincipal: safeDecimal(savingsAggregate.completedPrincipal),
        paidProfits: safeDecimal(profitSummary?.amount),
        paidProfitCount: Number(profitSummary?.count ?? 0),
        cancelledCount: Number(savingsAggregate.cancelledCount ?? 0),
        rejectedCount: Number(savingsAggregate.rejectedCount ?? 0),
      },
      transfers: {
        sentCount: Number(sentSummary?.count ?? 0),
        sentAmount: safeDecimal(sentSummary?.amount),
        receivedCount: Number(receivedSummary?.count ?? 0),
        receivedAmount: safeDecimal(receivedSummary?.amount),
      },
    },
    history: paginate(transactionsItems, Number(transactionsCountRows[0]?.total ?? 0)),
    requests: paginate(requestsItems, Number(requestsCountRows[0]?.total ?? 0)),
    transfers: paginate(transfersItems, Number(transfersCountRows[0]?.total ?? 0)),
    savingsPlans: paginate(savingsPage.slice(0, limit), Number(savingsCountRows[0]?.total ?? 0)),
    payouts: paginate(payoutsPage.slice(0, limit), Number(payoutsCountRows[0]?.total ?? 0)),
    audits: paginate(auditsItems, Number(auditsCountRows[0]?.total ?? 0)),
  };
}
