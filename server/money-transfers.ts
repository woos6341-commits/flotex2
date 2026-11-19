import { and, asc, count, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { createHash, randomUUID } from "node:crypto";
import { verifyPassword } from "./manual-auth-crypto";
import { auditLogs, moneyTransfers, notifications, transactions, users, wallets } from "../drizzle/schema";
import { formatMoneyMinorUnits, parseMoneyMinorUnits } from "../shared/transactions";
import { getTransferFeeMinorUnits } from "../shared/fee-policy";
import { getDb } from "./db";
import { getFeePolicy, getPaymentLimits, requireAdministrator } from "./payment-settings";
import { readEffectiveVerificationState, readEffectiveVerificationStates } from "./account-verification-state";
import { sendPushOnce } from "./push";

type TransferStatus = "pending" | "approved" | "rejected" | "cancelled";
type TransferAction = "approved" | "rejected";
type TransferInput = { recipientCustomerId: string; amount: string; note?: string; operationId: string; securityPin?: string };
type PushEvent = { userId: number; operationId: string; title: string; body: string; reference: string };

function affectedRows(result: any) {
  return Number(result?.[0]?.affectedRows ?? result?.affectedRows ?? 0);
}

function transferReference() {
  return `ATH-TRF-${randomUUID().replace(/-/g, "").slice(0, 28).toUpperCase()}`;
}

function senderEntryReference(reference: string) {
  return `${reference}-S`;
}

function recipientEntryReference(reference: string) {
  return `${reference}-R`;
}

function feeEntryReference(reference: string) {
  return `${reference}-F`;
}

function assertIdempotent(existing: typeof moneyTransfers.$inferSelect, senderUserId: number, payloadHash: string) {
  if (existing.senderUserId !== senderUserId || existing.payloadHash !== payloadHash) {
    throw new Error("معرف العملية مستخدم مسبقًا لبيانات تحويل مختلفة");
  }
  const totalMinor = parseMoneyMinorUnits(existing.amount) + parseMoneyMinorUnits(existing.feeAmount);
  return { reference: existing.reference, status: existing.status, feeAmount: existing.feeAmount, totalDebit: formatMoneyMinorUnits(totalMinor), duplicate: true as const };
}

async function ensureWalletRows(tx: any, userIds: number[]) {
  for (const userId of [...new Set(userIds)].sort((a, b) => a - b)) {
    await tx.insert(wallets).values({
      userId,
      balance: "0.00",
      reservedWithdrawals: "0.00",
      reservedOrders: "0.00",
      reservedTransfers: "0.00",
      profitLoss: "0.00",
      currency: "EGP",
    }).onDuplicateKeyUpdate({ set: { userId } });
  }
}

async function deliverPush(events: PushEvent[]) {
  await Promise.all(events.map(async (event) => {
    try {
      await sendPushOnce({
        userId: event.userId,
        operationId: event.operationId,
        title: event.title,
        body: event.body,
        data: { type: "money_transfer", reference: event.reference },
      });
    } catch {
      console.warn("[money-transfer] push delivery pending or unavailable after commit");
    }
  }));
}

export async function lookupTransferRecipient(senderUserId: number, customerId: string) {
  if (!/^\d{10}$/.test(customerId) || /^0{10}$/.test(customerId)) return null;
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  const [recipient] = await db.select({ id: users.id, name: users.name })
    .from(users)
    .where(eq(users.customerId, customerId))
    .limit(1);
  if (!recipient) return null;
  if (recipient.id === senderUserId) throw new Error("لا يمكنك إرسال الأموال إلى حسابك نفسه");
  const verification = await readEffectiveVerificationState(db, recipient.id);
  return { name: recipient.name?.trim() || "لم يسجل المستلم اسمًا", isVerified: verification.status === "approved" };
}

export async function createMoneyTransfer(senderUserId: number, input: TransferInput) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  if (input.securityPin !== undefined) {
    if (!/^\d{4}$/.test(input.securityPin)) throw new Error("أدخل رمز الأمان المكون من 4 أرقام لتأكيد التحويل");
    const [sender] = await db.select({ hash: users.securityPinHash }).from(users).where(eq(users.id, senderUserId)).limit(1);
    if (!sender?.hash || !(await verifyPassword(input.securityPin, sender.hash))) throw new Error("رمز الأمان غير صحيح");
  }
  const customerId = input.recipientCustomerId.trim();
  if (!/^\d{10}$/.test(customerId) || /^0{10}$/.test(customerId)) {
    throw new Error("أدخل رقم ID صحيحًا مكوّنًا من 10 أرقام");
  }
  const operationId = input.operationId.trim();
  if (operationId.length < 12 || operationId.length > 80) throw new Error("معرف العملية غير صالح");
  const amountMinor = parseMoneyMinorUnits(input.amount);
  if (amountMinor <= 0) throw new Error("يجب أن يكون مبلغ التحويل أكبر من صفر");
  const amount = formatMoneyMinorUnits(amountMinor);
  const note = input.note?.trim() || null;
  if (note && note.length > 300) throw new Error("الملاحظة لا تتجاوز 300 حرف");
  const payloadHash = createHash("sha256")
    .update(JSON.stringify({ recipientCustomerId: customerId, amount, note }))
    .digest("hex");

  const [prior] = await db.select().from(moneyTransfers)
    .where(and(eq(moneyTransfers.senderUserId, senderUserId), eq(moneyTransfers.idempotencyKey, operationId)))
    .limit(1);
  if (prior) return assertIdempotent(prior, senderUserId, payloadHash);

  const [recipient] = await db.select({ id: users.id, name: users.name })
    .from(users)
    .where(eq(users.customerId, customerId))
    .limit(1);
  if (!recipient) throw new Error("لا يوجد مستخدم مسجل بهذا الرقم");
  if (recipient.id === senderUserId) throw new Error("لا يمكنك إرسال الأموال إلى حسابك نفسه");

  const limits = await getPaymentLimits();
  const minimumMinor = parseMoneyMinorUnits(String(limits.minTransferAmount));
  if (amountMinor < minimumMinor) {
    throw new Error(`الحد الأدنى لإرسال الأموال هو ${formatMoneyMinorUnits(minimumMinor)} ج.م`);
  }
  const feeMinor = getTransferFeeMinorUnits(await getFeePolicy());
  const feeAmount = formatMoneyMinorUnits(feeMinor);
  const totalMinor = amountMinor + feeMinor;
  const totalAmount = formatMoneyMinorUnits(totalMinor);

  const result = await db.transaction(async (tx) => {
    await ensureWalletRows(tx, [senderUserId, recipient.id]);
    const [senderWallet] = await tx.select().from(wallets)
      .where(eq(wallets.userId, senderUserId))
      .for("update")
      .limit(1);
    if (!senderWallet) throw new Error("محفظة المرسل غير متاحة");

    // Serialize idempotency checks with the sender wallet lock before reserving funds.
    const [duplicate] = await tx.select().from(moneyTransfers)
      .where(and(eq(moneyTransfers.senderUserId, senderUserId), eq(moneyTransfers.idempotencyKey, operationId)))
      .limit(1);
    if (duplicate) return assertIdempotent(duplicate, senderUserId, payloadHash);

    const reserve = await tx.update(wallets)
      .set({ reservedTransfers: sql`${wallets.reservedTransfers} + ${totalAmount}` })
      .where(and(
        eq(wallets.userId, senderUserId),
        sql`${wallets.balance} - ${wallets.reservedWithdrawals} - ${wallets.reservedOrders} - ${wallets.reservedTransfers} - ${wallets.reservedSavings} >= ${totalAmount}`,
      ));
    if (affectedRows(reserve) !== 1) throw new Error("الرصيد المتاح غير كافٍ للمبلغ ورسوم الإرسال");

    const reference = transferReference();
    const recipientName = recipient.name?.trim() || "لم يسجل المستلم اسمًا";
    await tx.insert(moneyTransfers).values({
      reference,
      senderUserId,
      recipientUserId: recipient.id,
      amount,
      feeAmount,
      currency: "EGP",
      note,
      status: "pending",
      rejectionReason: null,
      reviewedBy: null,
      reviewedAt: null,
      cancelledAt: null,
      idempotencyKey: operationId,
      payloadHash,
    });
    await tx.insert(transactions).values({
      userId: senderUserId,
      reference: senderEntryReference(reference),
      type: "transfer",
      amount,
      currency: "EGP",
      status: "pending",
      note: note || `طلب إرسال إلى ${recipientName}`,
      direction: "debit",
      customerTitle: "إرسال أموال",
      customerDescription: `تم حجز المبلغ ${amount} ج.م ورسوم ${feeAmount} ج.م؛ الإجمالي ${totalAmount} ج.م لحين المراجعة.`.slice(0, 160),
      source: "money_transfer_sender",
      balanceBefore: senderWallet.balance,
      balanceAfter: senderWallet.balance,
    });
    if (feeMinor > 0) await tx.insert(transactions).values({
      userId: senderUserId,
      reference: feeEntryReference(reference),
      type: "fee",
      amount: feeAmount,
      currency: "EGP",
      status: "pending",
      note: `رسوم إرسال التحويل ${reference}`,
      direction: "debit",
      customerTitle: "رسوم إرسال الأموال",
      customerDescription: `رسوم الإرسال ${feeAmount} ج.م؛ إجمالي المخصوم ${totalAmount} ج.م.`,
      source: "money_transfer_fee",
      balanceBefore: senderWallet.balance,
      balanceAfter: senderWallet.balance,
    });
    const title = "تم تسجيل طلب إرسال الأموال";
    const body = `تم تسجيل طلب إرسال ${amount} ج.م إلى ${recipientName}. رسوم الإرسال ${feeAmount} ج.م، والإجمالي المحجوز ${totalAmount} ج.م حتى المراجعة.`;
    await tx.insert(notifications).values({
      userId: senderUserId,
      title,
      body,
      type: "money_transfer",
      operationId: `${reference}:pending`,
    });
    return { reference, status: "pending" as const, feeAmount, totalDebit: totalAmount, duplicate: false as const, push: { userId: senderUserId, operationId: `${reference}:pending`, title, body, reference } };
  });

  if ("push" in result) {
    await deliverPush([result.push]);
    return { reference: result.reference, status: result.status, feeAmount: result.feeAmount, totalDebit: result.totalDebit, duplicate: false as const };
  }
  return result;
}

export async function listMyMoneyTransfers(senderUserId: number) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  const recipient = alias(users, "transfer_recipient");
  const rows = await db.select({
    transfer: moneyTransfers,
    recipientUserId: recipient.id,
    recipientName: recipient.name,
    recipientCustomerId: recipient.customerId,
  }).from(moneyTransfers)
    .leftJoin(recipient, eq(moneyTransfers.recipientUserId, recipient.id))
    .where(eq(moneyTransfers.senderUserId, senderUserId))
    .orderBy(desc(moneyTransfers.createdAt), desc(moneyTransfers.id))
    .limit(100);
  const verificationByUser = await readEffectiveVerificationStates(db, [...new Set(rows.flatMap((row) => row.recipientUserId !== null && row.recipientUserId !== undefined ? [row.recipientUserId] : []))]);
  return rows.map((row) => ({
    id: row.transfer.id,
    reference: row.transfer.reference,
    amount: row.transfer.amount,
    feeAmount: row.transfer.feeAmount,
    totalDebit: formatMoneyMinorUnits(parseMoneyMinorUnits(row.transfer.amount) + parseMoneyMinorUnits(row.transfer.feeAmount)),
    currency: row.transfer.currency,
    note: row.transfer.note,
    status: row.transfer.status,
    rejectionReason: row.transfer.rejectionReason,
    createdAt: row.transfer.createdAt,
    recipient: { name: row.recipientName?.trim() || "مستخدم", isVerified: verificationByUser.get(row.recipientUserId ?? -1)?.status === "approved" },
  }));
}

export async function cancelMoneyTransfer(senderUserId: number, transferId: number) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  const result = await db.transaction(async (tx) => {
    const [transfer] = await tx.select().from(moneyTransfers)
      .where(and(eq(moneyTransfers.id, transferId), eq(moneyTransfers.senderUserId, senderUserId)))
      .for("update")
      .limit(1);
    if (!transfer) throw new Error("طلب التحويل غير موجود لهذا الحساب");
    if (transfer.status !== "pending") throw new Error("لا يمكن إلغاء طلب تمت مراجعته أو إلغاؤه مسبقًا");

    const [wallet] = await tx.select().from(wallets)
      .where(eq(wallets.userId, senderUserId))
      .for("update")
      .limit(1);
    if (!wallet) throw new Error("محفظة المرسل غير متاحة");
    const totalMinor = parseMoneyMinorUnits(transfer.amount) + parseMoneyMinorUnits(transfer.feeAmount);
    const totalAmount = formatMoneyMinorUnits(totalMinor);
    const release = await tx.update(wallets)
      .set({ reservedTransfers: sql`${wallets.reservedTransfers} - ${totalAmount}` })
      .where(and(eq(wallets.userId, senderUserId), sql`${wallets.reservedTransfers} >= ${totalAmount}`));
    if (affectedRows(release) !== 1) throw new Error("تعذر تحرير المبلغ المحجوز بأمان");

    const transitioned = await tx.update(moneyTransfers)
      .set({ status: "cancelled", cancelledAt: new Date() })
      .where(and(eq(moneyTransfers.id, transferId), eq(moneyTransfers.status, "pending")));
    if (affectedRows(transitioned) !== 1) throw new Error("تمت مراجعة الطلب بالتزامن؛ أعد تحميل الصفحة");

    const entry = await tx.update(transactions)
      .set({ status: "cancelled", note: "أُلغي الطلب وأُعيد المبلغ والرسوم المحجوزان", customerDescription: `أُلغي الطلب وأُعيد ${totalAmount} ج.م إلى الرصيد المتاح.` })
      .where(and(eq(transactions.reference, senderEntryReference(transfer.reference)), eq(transactions.status, "pending")));
    if (affectedRows(entry) !== 1) throw new Error("تعذر تحديث سجل التحويل");
    if (parseMoneyMinorUnits(transfer.feeAmount) > 0) {
      await tx.update(transactions).set({ status: "cancelled", note: "أُلغي رسم الإرسال مع الطلب", customerDescription: "أُلغي الطلب ولم تُخصم رسوم." })
        .where(and(eq(transactions.reference, feeEntryReference(transfer.reference)), eq(transactions.status, "pending")));
    }

    const title = "تم إلغاء طلب إرسال الأموال";
    const body = `أُلغي الطلب ${transfer.reference} وأُعيد إجمالي ${totalAmount} ج.م، شاملًا رسوم الإرسال، إلى الرصيد المتاح.`;
    await tx.insert(notifications).values({ userId: senderUserId, title, body, type: "money_transfer", operationId: `${transfer.reference}:cancelled` });
    return { success: true as const, reference: transfer.reference, status: "cancelled" as const, push: { userId: senderUserId, operationId: `${transfer.reference}:cancelled`, title, body, reference: transfer.reference } };
  });
  await deliverPush([result.push]);
  const { push: _push, ...publicResult } = result;
  return publicResult;
}

export type AdminTransferFilters = {
  search?: string;
  status?: "all" | TransferStatus;
  fromDate?: string;
  toDate?: string;
  offset?: number;
  limit?: number;
};

export async function listMoneyTransfersForAdmin(adminId: number, filters: AdminTransferFilters) {
  const db = await requireAdministrator(adminId);
  const sender = alias(users, "transfer_sender");
  const recipient = alias(users, "transfer_recipient");
  const conditions = [] as any[];
  if (filters.status && filters.status !== "all") conditions.push(eq(moneyTransfers.status, filters.status));
  if (filters.fromDate) conditions.push(sql`DATE(${moneyTransfers.createdAt}) >= ${filters.fromDate}`);
  if (filters.toDate) conditions.push(sql`DATE(${moneyTransfers.createdAt}) <= ${filters.toDate}`);
  const search = filters.search?.trim();
  if (search) {
    const pattern = `%${search}%`;
    const searchConditions = [
      like(moneyTransfers.reference, pattern),
      like(sender.customerId, pattern),
      like(recipient.customerId, pattern),
    ];
    if (/^\d+$/.test(search) && Number.isSafeInteger(Number(search))) searchConditions.push(eq(moneyTransfers.id, Number(search)) as any);
    conditions.push(or(...searchConditions));
  }
  const [{ total }] = await db.select({ total: count() }).from(moneyTransfers)
    .leftJoin(sender, eq(moneyTransfers.senderUserId, sender.id))
    .leftJoin(recipient, eq(moneyTransfers.recipientUserId, recipient.id))
    .where(conditions.length ? and(...conditions) : undefined);
  const limit = Math.max(1, Math.min(100, Math.trunc(filters.limit ?? 50)));
  const offset = Math.max(0, Math.min(100_000, Math.trunc(filters.offset ?? 0)));
  const rows = await db.select({
    transfer: moneyTransfers,
    senderName: sender.name,
    senderCustomerId: sender.customerId,
    recipientName: recipient.name,
    recipientCustomerId: recipient.customerId,
  }).from(moneyTransfers)
    .leftJoin(sender, eq(moneyTransfers.senderUserId, sender.id))
    .leftJoin(recipient, eq(moneyTransfers.recipientUserId, recipient.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(moneyTransfers.createdAt), desc(moneyTransfers.id))
    .limit(limit)
    .offset(offset);
  const verificationByUser = await readEffectiveVerificationStates(db, [...new Set(rows.flatMap((row) => [row.transfer.senderUserId, row.transfer.recipientUserId]))]);
  return { total, rows: rows.map((row) => ({
    id: row.transfer.id,
    reference: row.transfer.reference,
    amount: row.transfer.amount,
    feeAmount: row.transfer.feeAmount,
    totalDebit: formatMoneyMinorUnits(parseMoneyMinorUnits(row.transfer.amount) + parseMoneyMinorUnits(row.transfer.feeAmount)),
    currency: row.transfer.currency,
    note: row.transfer.note,
    status: row.transfer.status,
    rejectionReason: row.transfer.rejectionReason,
    reviewedAt: row.transfer.reviewedAt,
    createdAt: row.transfer.createdAt,
    sender: { name: row.senderName?.trim() || "مستخدم", customerId: row.senderCustomerId, isVerified: verificationByUser.get(row.transfer.senderUserId)?.status === "approved" },
    recipient: { name: row.recipientName?.trim() || "مستخدم", customerId: row.recipientCustomerId, isVerified: verificationByUser.get(row.transfer.recipientUserId)?.status === "approved" },
  })) };
}

export async function reviewMoneyTransfer(adminId: number, transferId: number, action: TransferAction, rejectionReason?: string) {
  const db = await requireAdministrator(adminId);
  const reason = rejectionReason?.trim() || "";
  if (action === "rejected" && (reason.length < 3 || reason.length > 500)) {
    throw new Error("سبب الرفض إلزامي ويجب أن يكون من 3 إلى 500 حرف");
  }
  const events = await db.transaction(async (tx) => {
    const [transfer] = await tx.select().from(moneyTransfers)
      .where(eq(moneyTransfers.id, transferId))
      .for("update")
      .limit(1);
    if (!transfer) throw new Error("طلب التحويل غير موجود");
    if (transfer.status !== "pending") throw new Error("تمت مراجعة طلب التحويل مسبقًا");

    const userIds = [transfer.senderUserId, transfer.recipientUserId].sort((a, b) => a - b);
    await ensureWalletRows(tx, userIds);
    const lockedWallets = await tx.select().from(wallets)
      .where(inArray(wallets.userId, userIds))
      .orderBy(asc(wallets.userId))
      .for("update");
    const senderWallet = lockedWallets.find((wallet) => wallet.userId === transfer.senderUserId);
    const recipientWallet = lockedWallets.find((wallet) => wallet.userId === transfer.recipientUserId);
    if (!senderWallet || !recipientWallet) throw new Error("محفظة أحد طرفي التحويل غير متاحة");
    const people = await tx.select({ id: users.id, name: users.name, customerId: users.customerId })
      .from(users)
      .where(inArray(users.id, userIds));
    const senderUser = people.find((user) => user.id === transfer.senderUserId);
    const recipientUser = people.find((user) => user.id === transfer.recipientUserId);
    if (!senderUser || !recipientUser) throw new Error("تعذر التحقق من طرفي التحويل");
    const amountMinor = parseMoneyMinorUnits(transfer.amount);
    if (amountMinor <= 0) throw new Error("قيمة التحويل غير صالحة");
    const amount = formatMoneyMinorUnits(amountMinor);
    const feeMinor = parseMoneyMinorUnits(transfer.feeAmount);
    const feeAmount = formatMoneyMinorUnits(feeMinor);
    const totalMinor = amountMinor + feeMinor;
    const totalAmount = formatMoneyMinorUnits(totalMinor);
    const senderBeforeMinor = parseMoneyMinorUnits(senderWallet.balance);
    const recipientBeforeMinor = parseMoneyMinorUnits(recipientWallet.balance);
    const senderBefore = formatMoneyMinorUnits(senderBeforeMinor);
    const recipientBefore = formatMoneyMinorUnits(recipientBeforeMinor);
    const now = new Date();

    const releaseOrDebit = action === "rejected"
      ? await tx.update(wallets)
        .set({ reservedTransfers: sql`${wallets.reservedTransfers} - ${totalAmount}` })
        .where(and(eq(wallets.userId, transfer.senderUserId), sql`${wallets.reservedTransfers} >= ${totalAmount}`))
      : await tx.update(wallets)
        .set({ balance: sql`${wallets.balance} - ${totalAmount}`, reservedTransfers: sql`${wallets.reservedTransfers} - ${totalAmount}` })
        .where(and(
          eq(wallets.userId, transfer.senderUserId),
          sql`${wallets.reservedTransfers} >= ${totalAmount}`,
          sql`${wallets.balance} >= ${wallets.reservedWithdrawals} + ${wallets.reservedOrders} + ${wallets.reservedTransfers} + ${wallets.reservedSavings}`,
        ));
    if (affectedRows(releaseOrDebit) !== 1) {
      throw new Error(action === "rejected" ? "تعذر إعادة المبلغ المحجوز بأمان" : "تعذر إكمال التحويل دون التأثير على مبالغ محجوزة أخرى");
    }

    if (action === "approved") {
      const credit = await tx.update(wallets)
        .set({ balance: sql`${wallets.balance} + ${amount}` })
        .where(eq(wallets.userId, transfer.recipientUserId));
      if (affectedRows(credit) !== 1) throw new Error("تعذر إضافة المبلغ إلى محفظة المستلم");
    }

    const nextStatus: TransferStatus = action;
    const changed = await tx.update(moneyTransfers)
      .set({ status: nextStatus, rejectionReason: action === "rejected" ? reason : null, reviewedBy: adminId, reviewedAt: now })
      .where(and(eq(moneyTransfers.id, transferId), eq(moneyTransfers.status, "pending")));
    if (affectedRows(changed) !== 1) throw new Error("تمت مراجعة الطلب بالتزامن؛ لم يُنفذ التحويل مرة ثانية");

    const transferAuditId = `transfer:${transfer.reference}`;
    const principalAfter = action === "approved" ? formatMoneyMinorUnits(senderBeforeMinor - amountMinor) : senderBefore;
    const senderAfter = action === "approved" ? formatMoneyMinorUnits(senderBeforeMinor - totalMinor) : senderBefore;
    const recipientAfter = action === "approved" ? formatMoneyMinorUnits(recipientBeforeMinor + amountMinor) : recipientBefore;
    await tx.insert(auditLogs).values({
      operationId: `${transferAuditId}:sender`,
      adminId,
      targetUserId: transfer.senderUserId,
      amount: action === "approved" ? formatMoneyMinorUnits(-totalMinor) : "0.00",
      balanceBefore: senderBefore,
      balanceAfter: senderAfter,
      currency: "EGP",
      reason: action === "approved" ? `اعتماد تحويل ${amount} ج.م ورسوم ${feeAmount} ج.م إلى ${recipientUser.name || "المستلم"}` : `رفض تحويل ${transfer.reference}: ${reason}`,
    });

    if (action === "approved") {
      await tx.insert(auditLogs).values({
        operationId: `${transferAuditId}:recipient`,
        adminId,
        targetUserId: transfer.recipientUserId,
        amount,
        balanceBefore: recipientBefore,
        balanceAfter: recipientAfter,
        currency: "EGP",
        reason: `استلام تحويل ${transfer.reference} من ${senderUser.name || "المرسل"}`,
      });
      const senderEntry = await tx.update(transactions)
        .set({
          status: "approved",
          customerTitle: "إرسال أموال",
          customerDescription: `أُرسل ${amount} ج.م إلى ${recipientUser.name || "المستلم"}؛ الرسوم ${feeAmount} ج.م؛ إجمالي الخصم ${totalAmount} ج.م.`.slice(0, 160),
          balanceBefore: senderBefore,
          balanceAfter: principalAfter,
        })
        .where(and(eq(transactions.reference, senderEntryReference(transfer.reference)), eq(transactions.status, "pending")));
      if (affectedRows(senderEntry) !== 1) throw new Error("تعذر إكمال سجل المرسل");
      if (feeMinor > 0) {
        const feeEntry = await tx.update(transactions).set({
          status: "approved",
          note: `رسوم إرسال التحويل ${transfer.reference}`,
          customerTitle: "رسوم إرسال الأموال",
          customerDescription: `رسم الإرسال ${feeAmount} ج.م؛ إجمالي الخصم ${totalAmount} ج.م.`,
          balanceBefore: principalAfter,
          balanceAfter: senderAfter,
        }).where(and(eq(transactions.reference, feeEntryReference(transfer.reference)), eq(transactions.status, "pending")));
        if (affectedRows(feeEntry) !== 1) throw new Error("تعذر إكمال سجل رسوم التحويل");
      }
      await tx.insert(transactions).values({
        userId: transfer.recipientUserId,
        reference: recipientEntryReference(transfer.reference),
        type: "transfer",
        amount,
        currency: "EGP",
        status: "approved",
        note: transfer.note ? `تم استلام أموال من ${senderUser.name || "المرسل"}. ملاحظة: ${transfer.note}`.slice(0, 2000) : `تم استلام أموال من ${senderUser.name || "المرسل"}`,
        direction: "credit",
        customerTitle: "استلام أموال",
        customerDescription: `تم استلام أموال من ${senderUser.name || "المرسل"}${transfer.note ? ` · ${transfer.note}` : ""}`.slice(0, 160),
        source: "money_transfer_recipient",
        balanceBefore: recipientBefore,
        balanceAfter: recipientAfter,
      });
      const senderTitle = "تمت الموافقة على تحويلك";
      const senderBody = `تم تنفيذ إرسال ${amount} ج.م إلى ${recipientUser.name || "المستلم"}. رسوم الإرسال ${feeAmount} ج.م، وإجمالي الخصم ${totalAmount} ج.م.`;
      const recipientTitle = "تمت إضافة أموال إلى محفظتك";
      const recipientBody = `تم استلام مبلغ ${amount} ج.م في محفظتك، أُرسل من ${senderUser.name || "المرسل"}.`;
      await tx.insert(notifications).values([
        { userId: transfer.senderUserId, title: senderTitle, body: senderBody, type: "money_transfer", operationId: `${transfer.reference}:approved:sender` },
        { userId: transfer.recipientUserId, title: recipientTitle, body: recipientBody, type: "money_transfer", operationId: `${transfer.reference}:approved:recipient` },
      ]);
      return [
        { userId: transfer.senderUserId, operationId: `${transfer.reference}:approved:sender`, title: senderTitle, body: senderBody, reference: transfer.reference },
        { userId: transfer.recipientUserId, operationId: `${transfer.reference}:approved:recipient`, title: recipientTitle, body: recipientBody, reference: transfer.reference },
      ] satisfies PushEvent[];
    }

    const senderEntry = await tx.update(transactions)
      .set({
        status: "rejected",
        note: reason,
        customerTitle: "إرسال أموال",
        customerDescription: `رُفض الطلب وأُعيد ${totalAmount} ج.م شاملًا الرسوم دون خصم. السبب: ${reason}`.slice(0, 160),
        balanceBefore: senderBefore,
        balanceAfter: senderBefore,
      })
      .where(and(eq(transactions.reference, senderEntryReference(transfer.reference)), eq(transactions.status, "pending")));
    if (affectedRows(senderEntry) !== 1) throw new Error("تعذر تحديث سجل رفض التحويل");
    if (feeMinor > 0) {
      const feeEntry = await tx.update(transactions).set({ status: "rejected", note: `رُفض طلب التحويل: ${reason}`, customerDescription: `لم تُخصم رسوم ${feeAmount} ج.م؛ تم تحرير كامل الحجز.` })
        .where(and(eq(transactions.reference, feeEntryReference(transfer.reference)), eq(transactions.status, "pending")));
      if (affectedRows(feeEntry) !== 1) throw new Error("تعذر تحديث سجل رفض الرسوم");
    }
    const title = "تم رفض طلب إرسال الأموال";
    const body = `رُفض طلب إرسال الأموال وأُعيد إجمالي ${totalAmount} ج.م، شاملًا رسوم الإرسال، إلى الرصيد المتاح دون خصم. السبب: ${reason}`;
    await tx.insert(notifications).values({ userId: transfer.senderUserId, title, body, type: "money_transfer", operationId: `${transfer.reference}:rejected` });
    return [{ userId: transfer.senderUserId, operationId: `${transfer.reference}:rejected`, title, body, reference: transfer.reference }] satisfies PushEvent[];
  });

  await deliverPush(events);
  return { success: true as const, reference: (await db.select({ reference: moneyTransfers.reference }).from(moneyTransfers).where(eq(moneyTransfers.id, transferId)).limit(1))[0]?.reference, status: action };
}
