import { and, desc, eq, or } from "drizzle-orm";
import { externalTransferRequests, moneyTransfers, requests, savingsPayouts, savingsPlans, transactions, users, wallets } from "../drizzle/schema";
import { getDb } from "./db";
import { requireAdministrator } from "./payment-settings";

type InvoiceItem = { reference: string; type: string; status: string; amount: string; fee: string; direction: "credit" | "debit" | null; currency: string; createdAt: Date; note: string | null };

export async function getAdminCustomerInvoice(adminId: number, userId: number) {
  const db = await requireAdministrator(adminId);
  const [user] = await db.select({ id: users.id, customerId: users.customerId, name: users.name, email: users.email, phoneNumber: users.phoneNumber, status: users.status, createdAt: users.createdAt }).from(users).where(and(eq(users.id, userId), eq(users.role, "user"))).limit(1);
  if (!user) throw new Error("حساب العميل غير موجود");
  const [wallet] = await db.select().from(wallets).where(eq(wallets.userId, userId)).limit(1);
  const [txRows, requestRows, transferRows, planRows, payoutRows, externalRows] = await Promise.all([
    db.select().from(transactions).where(eq(transactions.userId, userId)).orderBy(desc(transactions.createdAt), desc(transactions.id)),
    db.select().from(requests).where(eq(requests.userId, userId)).orderBy(desc(requests.createdAt), desc(requests.id)),
    db.select().from(moneyTransfers).where(or(eq(moneyTransfers.senderUserId, userId), eq(moneyTransfers.recipientUserId, userId))).orderBy(desc(moneyTransfers.createdAt), desc(moneyTransfers.id)),
    db.select().from(savingsPlans).where(eq(savingsPlans.userId, userId)).orderBy(desc(savingsPlans.createdAt), desc(savingsPlans.id)),
    db.select().from(savingsPayouts).where(eq(savingsPayouts.userId, userId)).orderBy(desc(savingsPayouts.createdAt), desc(savingsPayouts.id)),
    db.select().from(externalTransferRequests).where(eq(externalTransferRequests.userId, userId)).orderBy(desc(externalTransferRequests.createdAt), desc(externalTransferRequests.id)),
  ]);
  const items: InvoiceItem[] = [
    ...txRows.map((r) => ({ reference: r.reference, type: r.type, status: r.status, amount: r.amount, fee: r.type === "fee" ? r.amount : "0.00", direction: r.direction ?? null, currency: r.currency, createdAt: r.createdAt, note: r.note })),
    ...requestRows.map((r) => ({ reference: r.reference, type: `request_${r.type}`, status: r.status, amount: r.amount, fee: r.feeAmount, direction: r.type === "deposit" ? "credit" as const : "debit" as const, currency: r.currency, createdAt: r.createdAt, note: r.note ?? r.rejectionReason })),
    ...transferRows.map((r) => ({ reference: r.reference, type: "money_transfer", status: r.status, amount: r.amount, fee: r.feeAmount, direction: r.senderUserId === userId ? "debit" as const : "credit" as const, currency: r.currency, createdAt: r.createdAt, note: r.note ?? r.rejectionReason })),
    ...planRows.map((r) => ({ reference: r.reference, type: "savings_plan", status: r.status, amount: r.principalAmount, fee: r.feeAmount, direction: "debit" as const, currency: r.currency, createdAt: r.createdAt, note: r.rejectionReason })),
    ...payoutRows.map((r) => ({ reference: r.transactionReference ?? `savings-payout-${r.id}`, type: "savings_payout", status: r.status, amount: r.paidAmount, fee: "0.00", direction: "credit" as const, currency: "EGP", createdAt: r.createdAt, note: r.blockReason })),
    ...externalRows.map((r) => ({ reference: r.reference, type: "external_transfer", status: r.status, amount: r.egpEquivalent ?? "0.00", fee: r.feeEgp ?? "0.00", direction: "debit" as const, currency: "EGP", createdAt: r.createdAt, note: r.rejectionReason ? `رفض: ${r.rejectionReason}` : `${r.countryName} (${r.currencyCode})` })),
  ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const totals = items.reduce((sum, item) => { const amount = Number(item.amount || 0); const fee = Number(item.fee || 0); if (item.direction === "credit") sum.credits += amount; if (item.direction === "debit") sum.debits += amount; sum.fees += fee; return sum; }, { credits: 0, debits: 0, fees: 0 });
  return { user, wallet: wallet ?? null, items, totals: { credits: totals.credits.toFixed(2), debits: totals.debits.toFixed(2), fees: totals.fees.toFixed(2) } };
}
