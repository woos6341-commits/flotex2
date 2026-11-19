import { and, asc, eq, inArray, like, notInArray, or, sql } from "drizzle-orm";
import { getDb } from "./db";
import { listGuestTickets } from "./guest-support";
import { listAdminSupportConversations } from "./support-messages";
import type { SupportCategory } from "../shared/support-categories";
import { getPendingRecentOperationStatuses, isPendingRecentOperation, type RecentOperationSection } from "../shared/recent-operations";
import {
  coinOrders,
  coinTransfers,
  accountVerifications,
  externalTransferRequests,
  gameTopupRequests,
  goldOrders,
  moneyTransfers,
  phoneChangeRequests,
  phoneVerificationRequests,
  requests,
  savingsPlans,
  users,
} from "../drizzle/schema";

export type RecentOperation = {
  key: string;
  section: RecentOperationSection | "supportMessaging" | "guestSupport";
  requestTab?: "payments" | "transfers";
  userId?: number;
  category?: SupportCategory;
  guestTicketId?: number;
  title: string;
  customerName: string;
  customerId: string;
  amount: string | null;
  unit: "EGP" | "COIN" | "NONE";
  status: string;
  reference: string;
  createdAt: string;
  decisionAt: string | null;
  decisionByName: string | null;
  pending: boolean;
};

const customer = { name: users.name, customerId: users.customerId };

function nameOf(value: { name: string | null; customerId: string } | null | undefined) {
  return value?.name?.trim() || "مستخدم";
}

function idOf(value: { name: string | null; customerId: string } | null | undefined) {
  return value?.customerId || "";
}

function iso(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

function optionalIso(value: Date | string | null | undefined) {
  return value ? iso(value) : null;
}

function statusCondition(column: any, section: RecentOperationSection, mode: "pending" | "history" | null) {
  if (!mode) return undefined;
  const statuses = getPendingRecentOperationStatuses(section);
  return mode === "pending" ? inArray(column, statuses as any) : notInArray(column, statuses as any);
}

/** Unified page of service requests, with decision metadata retained in each source table. */
export async function getRecentOperations(input: { limit?: number; offset?: number; pendingOnly?: boolean; historyOnly?: boolean; search?: string; section?: RecentOperation["section"] } = {}, adminId?: number): Promise<RecentOperation[]> {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة الآن.");
  const limit = Math.min(Math.max(input.limit ?? 30, 1), 100);
  const offset = Math.min(Math.max(input.offset ?? 0, 0), 10_000);
  const perSource = offset + limit;
  const mode = input.pendingOnly ? "pending" : input.historyOnly ? "history" : null;
  const search = input.search?.trim().slice(0, 100) ?? "";
  // Escape LIKE wildcards so searching for a reference is literal.
  const pattern = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
  const filterCondition = (column: any, section: RecentOperationSection, reference: any, title: any) => and(
    statusCondition(column, section, mode),
    search ? or(like(sql`COALESCE(${users.name}, '')`, pattern), like(users.customerId, pattern), like(reference, pattern), like(title, pattern)) : undefined,
  );

  const [paymentRows, transferRows, savingsRows, gameRows, externalRows, goldRows, coinOrderRows, coinTransferRows, accountVerificationRows, phoneChangeRows, phoneVerificationRows] = await Promise.all([
    db.select({ row: requests, customer }).from(requests).leftJoin(users, eq(requests.userId, users.id)).where(filterCondition(requests.status, "requests", requests.reference, sql`CASE WHEN ${requests.type} = 'deposit' THEN 'إيداع' ELSE 'سحب' END`)).orderBy(asc(requests.createdAt)).limit(perSource),
    db.select({ row: moneyTransfers, customer }).from(moneyTransfers).leftJoin(users, eq(moneyTransfers.senderUserId, users.id)).where(filterCondition(moneyTransfers.status, "requests", moneyTransfers.reference, sql`'تحويل أموال'`)).orderBy(asc(moneyTransfers.createdAt)).limit(perSource),
    db.select({ row: savingsPlans, customer }).from(savingsPlans).leftJoin(users, eq(savingsPlans.userId, users.id)).where(filterCondition(savingsPlans.status, "savings", savingsPlans.reference, sql`'طلب ادخار'`)).orderBy(asc(savingsPlans.createdAt)).limit(perSource),
    db.select({ row: gameTopupRequests, customer }).from(gameTopupRequests).leftJoin(users, eq(gameTopupRequests.userId, users.id)).where(filterCondition(gameTopupRequests.status, "gameTopup", gameTopupRequests.reference, sql`CONCAT(CASE WHEN ${gameTopupRequests.kind} = 'deposit' THEN 'إيداع ' WHEN ${gameTopupRequests.kind} = 'withdraw' THEN 'سحب ' ELSE 'شحن ' END, ${gameTopupRequests.gameName})`)).orderBy(asc(gameTopupRequests.createdAt)).limit(perSource),
    db.select({ row: externalTransferRequests, customer }).from(externalTransferRequests).leftJoin(users, eq(externalTransferRequests.userId, users.id)).where(filterCondition(externalTransferRequests.status, "externalTransfers", externalTransferRequests.reference, sql`CONCAT('معاملة خارجية · ', ${externalTransferRequests.countryName})`)).orderBy(asc(externalTransferRequests.createdAt)).limit(perSource),
    db.select({ row: goldOrders, customer }).from(goldOrders).leftJoin(users, eq(goldOrders.userId, users.id)).where(filterCondition(goldOrders.status, "gold", goldOrders.reference, sql`CASE WHEN ${goldOrders.side} = 'buy' THEN 'شراء ذهب' ELSE 'بيع ذهب' END`)).orderBy(asc(goldOrders.createdAt)).limit(perSource),
    db.select({ row: coinOrders, customer }).from(coinOrders).leftJoin(users, eq(coinOrders.userId, users.id)).where(filterCondition(coinOrders.status, "coin", coinOrders.reference, sql`CASE WHEN ${coinOrders.side} = 'buy' THEN 'شراء كوين' ELSE 'بيع كوين' END`)).orderBy(asc(coinOrders.createdAt)).limit(perSource),
    db.select({ row: coinTransfers, customer }).from(coinTransfers).leftJoin(users, eq(coinTransfers.senderUserId, users.id)).where(filterCondition(coinTransfers.status, "coin", coinTransfers.reference, sql`'تحويل كوين'`)).orderBy(asc(coinTransfers.createdAt)).limit(perSource),
    db.select({ row: { id: accountVerifications.id, userId: accountVerifications.userId, status: accountVerifications.status, submittedAt: accountVerifications.submittedAt, reviewedAt: accountVerifications.reviewedAt, reviewedBy: accountVerifications.reviewedBy }, customer }).from(accountVerifications).leftJoin(users, eq(accountVerifications.userId, users.id)).where(filterCondition(accountVerifications.status, "accountVerification", sql`CONCAT('AV-', ${accountVerifications.id})`, sql`'توثيق حساب'`)).orderBy(asc(accountVerifications.submittedAt)).limit(perSource),
    db.select({ row: { id: phoneChangeRequests.id, userId: phoneChangeRequests.userId, status: phoneChangeRequests.status, createdAt: phoneChangeRequests.createdAt, reviewedAt: phoneChangeRequests.reviewedAt, reviewedBy: phoneChangeRequests.reviewedBy }, customer }).from(phoneChangeRequests).leftJoin(users, eq(phoneChangeRequests.userId, users.id)).where(filterCondition(phoneChangeRequests.status, "phoneChange", sql`CONCAT('PHC-', ${phoneChangeRequests.id})`, sql`'تغيير رقم الهاتف'`)).orderBy(asc(phoneChangeRequests.createdAt)).limit(perSource),
    db.select({ row: { id: phoneVerificationRequests.id, userId: phoneVerificationRequests.userId, status: phoneVerificationRequests.status, createdAt: phoneVerificationRequests.createdAt, reviewedAt: phoneVerificationRequests.reviewedAt, reviewedBy: phoneVerificationRequests.reviewedBy }, customer }).from(phoneVerificationRequests).leftJoin(users, eq(phoneVerificationRequests.userId, users.id)).where(filterCondition(phoneVerificationRequests.status, "phoneVerification", sql`CONCAT('PHV-', ${phoneVerificationRequests.id})`, sql`'توثيق رقم الهاتف'`)).orderBy(asc(phoneVerificationRequests.createdAt)).limit(perSource),
  ]);

  // Only callers already authorized as an administrator can include conversations.
  // They are merged before pagination so an older conversation cannot be overtaken
  // by a newer transaction merely because it came from a different table.
  const [supportRows, guestRows] = adminId
    ? await Promise.all([listAdminSupportConversations(adminId), listGuestTickets(adminId)])
    : [[], []];

  const reviewerIds = [...new Set([
    ...paymentRows.map(({ row }) => row.reviewedBy),
    ...transferRows.map(({ row }) => row.reviewedBy),
    ...savingsRows.map(({ row }) => row.approvedBy),
    ...gameRows.map(({ row }) => row.reviewedBy),
    ...externalRows.map(({ row }) => row.reviewedBy),
    ...goldRows.map(({ row }) => row.reviewedBy),
    ...coinOrderRows.map(({ row }) => row.reviewedBy),
    ...coinTransferRows.map(({ row }) => row.reviewedBy),
    ...accountVerificationRows.map(({ row }) => row.reviewedBy),
    ...phoneChangeRows.map(({ row }) => row.reviewedBy),
    ...phoneVerificationRows.map(({ row }) => row.reviewedBy),
  ].filter((id): id is number => id != null))];
  const reviewerRows = reviewerIds.length
    ? await db.select({ id: users.id, name: users.name, email: users.email, role: users.role }).from(users).where(inArray(users.id, reviewerIds))
    : [];
  const reviewerById = new Map(reviewerRows.filter((person) => person.role === "admin").map((person) => [person.id, person.name?.trim() || person.email || "مدير مخول"]));
  const reviewerName = (id: number | null | undefined) => id == null ? null : reviewerById.get(id) ?? "الإدارة";

  const entries: RecentOperation[] = [
    ...paymentRows.map(({ row, customer: person }) => ({
      key: `payment-${row.id}`, section: "requests" as const, requestTab: "payments" as const,
      title: row.type === "deposit" ? "إيداع" : "سحب", customerName: nameOf(person), customerId: idOf(person),
      amount: row.amount, unit: "EGP" as const, status: row.status, reference: row.reference,
      createdAt: iso(row.createdAt), decisionAt: optionalIso(row.reviewedAt), decisionByName: reviewerName(row.reviewedBy),
      pending: isPendingRecentOperation("requests", row.status),
    })),
    ...transferRows.map(({ row, customer: person }) => ({
      key: `transfer-${row.id}`, section: "requests" as const, requestTab: "transfers" as const,
      title: "تحويل أموال", customerName: nameOf(person), customerId: idOf(person), amount: row.amount, unit: "EGP" as const,
      status: row.status, reference: row.reference, createdAt: iso(row.createdAt), decisionAt: optionalIso(row.reviewedAt), decisionByName: reviewerName(row.reviewedBy),
      pending: isPendingRecentOperation("requests", row.status),
    })),
    ...savingsRows.map(({ row, customer: person }) => ({
      key: `savings-${row.id}`, section: "savings" as const, title: "طلب ادخار", customerName: nameOf(person), customerId: idOf(person),
      amount: row.principalAmount, unit: "EGP" as const, status: row.status, reference: row.reference,
      createdAt: iso(row.createdAt), decisionAt: optionalIso(row.approvedAt ?? (row.status === "pending_approval" ? null : row.updatedAt)), decisionByName: reviewerName(row.approvedBy),
      pending: isPendingRecentOperation("savings", row.status),
    })),
    ...gameRows.map(({ row, customer: person }) => ({
      key: `game-${row.id}`, section: "gameTopup" as const,
      title: row.kind === "deposit" ? `إيداع ${row.gameName}` : row.kind === "withdraw" ? `سحب ${row.gameName}` : `شحن ${row.gameName}`,
      customerName: nameOf(person), customerId: idOf(person), amount: row.totalAmount, unit: "EGP" as const,
      status: row.status, reference: row.reference, createdAt: iso(row.createdAt), decisionAt: optionalIso(row.reviewedAt), decisionByName: reviewerName(row.reviewedBy),
      pending: isPendingRecentOperation("gameTopup", row.status),
    })),
    ...externalRows.map(({ row, customer: person }) => ({
      key: `external-${row.id}`, section: "externalTransfers" as const, title: `معاملة خارجية · ${row.countryName}`,
      customerName: nameOf(person), customerId: idOf(person), amount: null, unit: "NONE" as const, status: row.status,
      reference: row.reference, createdAt: iso(row.createdAt), decisionAt: optionalIso(row.reviewedAt), decisionByName: reviewerName(row.reviewedBy),
      pending: isPendingRecentOperation("externalTransfers", row.status),
    })),
    ...goldRows.map(({ row, customer: person }) => ({
      key: `gold-${row.id}`, section: "gold" as const, title: row.side === "buy" ? "شراء ذهب" : "بيع ذهب",
      customerName: nameOf(person), customerId: idOf(person), amount: row.grossAmount, unit: "EGP" as const, status: row.status,
      reference: row.reference, createdAt: iso(row.createdAt), decisionAt: optionalIso(row.reviewedAt), decisionByName: reviewerName(row.reviewedBy),
      pending: isPendingRecentOperation("gold", row.status),
    })),
    ...coinOrderRows.map(({ row, customer: person }) => ({
      key: `coin-order-${row.id}`, section: "coin" as const, title: row.side === "buy" ? "شراء كوين" : "بيع كوين",
      customerName: nameOf(person), customerId: idOf(person), amount: row.totalAmount, unit: "EGP" as const, status: row.status,
      reference: row.reference, createdAt: iso(row.createdAt), decisionAt: optionalIso(row.reviewedAt), decisionByName: reviewerName(row.reviewedBy),
      pending: isPendingRecentOperation("coin", row.status),
    })),
    ...coinTransferRows.map(({ row, customer: person }) => ({
      key: `coin-transfer-${row.id}`, section: "coin" as const, title: "تحويل كوين",
      customerName: nameOf(person), customerId: idOf(person), amount: row.quantity, unit: "COIN" as const, status: row.status,
      reference: row.reference, createdAt: iso(row.createdAt), decisionAt: optionalIso(row.reviewedAt), decisionByName: reviewerName(row.reviewedBy),
      pending: isPendingRecentOperation("coin", row.status),
    })),
    ...accountVerificationRows.map(({ row, customer: person }) => ({
      key: `account-verification-${row.id}`, section: "accountVerification" as const, title: "توثيق حساب",
      customerName: nameOf(person), customerId: idOf(person), amount: null, unit: "NONE" as const, status: row.status,
      reference: `AV-${row.id}`, createdAt: iso(row.submittedAt), decisionAt: optionalIso(row.reviewedAt), decisionByName: reviewerName(row.reviewedBy),
      pending: isPendingRecentOperation("accountVerification", row.status),
    })),
    ...phoneChangeRows.map(({ row, customer: person }) => ({
      key: `phone-change-${row.id}`, section: "phoneChange" as const, title: "تغيير رقم الهاتف",
      customerName: nameOf(person), customerId: idOf(person), amount: null, unit: "NONE" as const, status: row.status,
      reference: `PHC-${row.id}`, createdAt: iso(row.createdAt), decisionAt: optionalIso(row.reviewedAt), decisionByName: reviewerName(row.reviewedBy),
      pending: isPendingRecentOperation("phoneChange", row.status),
    })),
    ...phoneVerificationRows.map(({ row, customer: person }) => ({
      key: `phone-verification-${row.id}`, section: "phoneVerification" as const, title: "توثيق رقم الهاتف",
      customerName: nameOf(person), customerId: idOf(person), amount: null, unit: "NONE" as const, status: row.status,
      reference: `PHV-${row.id}`, createdAt: iso(row.createdAt), decisionAt: optionalIso(row.reviewedAt), decisionByName: reviewerName(row.reviewedBy),
      pending: isPendingRecentOperation("phoneVerification", row.status),
    })),
    ...supportRows.map((thread) => ({
      key: `support-${thread.user.id}-${thread.category}`, section: "supportMessaging" as const,
      userId: thread.user.id, category: thread.category, title: "محادثة دعم",
      customerName: thread.user.name?.trim() || "مستخدم", customerId: thread.user.customerId,
      amount: null, unit: "NONE" as const, status: thread.threadStatus,
      reference: `SUP-${thread.user.customerId}-${thread.category}`,
      createdAt: iso(thread.createdAt), decisionAt: optionalIso(thread.closedAt), decisionByName: thread.closedByName,
      pending: thread.threadStatus !== "closed",
    })),
    ...guestRows.filter(({ lastMessage }) => !!lastMessage).map(({ ticket }) => ({
      key: `guest-${ticket.id}`, section: "guestSupport" as const, guestTicketId: ticket.id,
      title: "مراسلة زائر", customerName: ticket.displayName, customerId: "",
      amount: null, unit: "NONE" as const, status: ticket.status, reference: ticket.ticketCode,
      createdAt: iso(ticket.createdAt), decisionAt: optionalIso(ticket.closedAt),
      decisionByName: ticket.status === "closed" ? "الإدارة" : null, pending: ticket.status !== "closed",
    })),
  ];

  const end = offset + limit;
  return entries
    .filter((entry) => mode === "pending" ? entry.pending : mode === "history" ? !entry.pending : true)
    .filter((entry) => !input.section || entry.section === input.section)
    .filter((entry) => !search || `${entry.title} ${entry.customerName} ${entry.customerId} ${entry.reference}`.toLocaleLowerCase("ar-EG").includes(search.toLocaleLowerCase("ar-EG")))
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() || a.key.localeCompare(b.key))
    .slice(offset, end);
}
