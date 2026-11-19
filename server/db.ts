import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, like, lt, ne, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { createHash, randomInt, randomUUID } from "node:crypto";
import { accountVerificationOverrides, accountVerifications, appSettings, auditLogs, brokerEvents, InsertUser, marketInstruments, marketQuotes, notifications, orders, requests, savingsPlans, transactions, users, wallets } from "../drizzle/schema";
import { ADMIN_EMAIL, roleForUserUpsert } from "../shared/admin";
import { ENV } from "./_core/env";
import { getMarketDataProvider } from "./providers/market-data";
import { sendPushOnce } from "./push";
import { buildRequestSubmittedPush } from "./push-messages";
import { getFeePolicy, getPaymentMethods, getPaymentLimits, getPaymentServiceStatus, updatePaymentLimits, requireAdministrator, type LimitInput } from "./payment-settings";
import { saveReceipt, decodePaymentImage, readReceipt } from "./payment-media";
import { applyBalanceAdjustment } from "./balance-adjustment";
import { isBellEligibleSuccessfulTransaction, parseMoneyMinorUnits, formatMoneyMinorUnits, resolveTransactionMetadata } from "../shared/transactions";
import { assertWithdrawalFeeCoverage, getWithdrawalFeeMinorUnits } from "../shared/fee-policy";
import { validateCustomFieldValues } from "../shared/payment-method-fields";
import { assertMoneyRequestVerificationAllowed } from "./money-request-verification";
import { verifyPassword } from "./manual-auth-crypto";

export const INSUFFICIENT_BALANCE_MESSAGE = "رصيدك غير كافٍ لإتمام عملية السحب. يرجى إيداع الأموال أولًا";
export const NEGATIVE_BALANCE_MESSAGE = "لا يمكن تنفيذ العملية لأنها ستؤدي إلى رصيد سالب";
let _db: ReturnType<typeof drizzle> | null = null;

function assertSafeVitestDatabaseUrl(rawUrl: string) {
  if (process.env.VITEST !== "true") return;
  let parsed: URL;
  try { parsed = new URL(rawUrl); } catch { throw new Error("Refusing database connection in Vitest: invalid local test database configuration."); }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!(["127.0.0.1", "localhost", "::1"].includes(host)) || !/^flotex_test_[a-zA-Z0-9_]+$/.test(database)) {
    throw new Error("Refusing database connection in Vitest: only a loopback flotex_test_* database is permitted.");
  }
}

export async function getDb() {
  const rawUrl = process.env.DATABASE_URL;
  if (process.env.VITEST === "true") {
    if (process.env.FLOTEX_RUN_LOCAL_DB_TESTS !== "1") return null;
    if (rawUrl) assertSafeVitestDatabaseUrl(rawUrl);
  }
  if (!_db && rawUrl) _db = drizzle(rawUrl);
  return _db;
}
function newCustomerId() { return randomInt(1, 10_000_000_000).toString().padStart(10, "0"); }
function validCustomerId(value: string | null | undefined) { return Boolean(value && /^\d{10}$/.test(value) && !/^0{10}$/.test(value)); }
async function ensureCustomerId(userId: number) {
  const db = await getDb(); if (!db) return null;
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(users).where(eq(users.id, userId)).for("update").limit(1);
    if (!current) return null;
    if (validCustomerId(current.customerId)) return current.customerId;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const candidate = newCustomerId();
      const [taken] = await tx.select({ id: users.id }).from(users).where(eq(users.customerId, candidate)).limit(1);
      if (taken) continue;
      try { await tx.update(users).set({ customerId: candidate }).where(eq(users.id, userId)); return candidate; } catch { /* collision: retry with a new candidate */ }
    }
    throw new Error("تعذر إنشاء رقم عميل فريد");
  });
}
export async function repairAllCustomerIds() {
  const db = await getDb(); if (!db) return { scanned: 0, repaired: 0 };
  const rows = await db.select({ id: users.id, customerId: users.customerId }).from(users);
  let repaired = 0;
  for (const row of rows) { if (!validCustomerId(row.customerId)) { await ensureCustomerId(row.id); repaired += 1; } }
  return { scanned: rows.length, repaired };
}
export async function upsertUser(user: InsertUser): Promise<void> {
  const db = await getDb(); if (!db) return;
  const existing = await getUserByOpenId(user.openId);
  if (existing) {
    await ensureCustomerId(existing.id);
    const updateSet: Record<string, unknown> = { name: sql`CASE WHEN ${users.profileCompletedAt} IS NOT NULL THEN ${users.name} ELSE COALESCE(${users.name}, ${user.name ?? null}) END`, email: sql`CASE WHEN ${users.profileCompletedAt} IS NOT NULL THEN ${users.email} ELSE ${user.email ?? existing.email ?? null} END`, loginMethod: user.loginMethod ?? existing.loginMethod ?? null, lastSignedIn: user.lastSignedIn ?? new Date() };
    updateSet.role = roleForUserUpsert(user.email, existing.role);
    await db.update(users).set(updateSet).where(eq(users.openId, user.openId));
    return;
  }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const values = { openId: user.openId, customerId: newCustomerId(), name: user.name ?? null, email: user.email ?? null, loginMethod: user.loginMethod ?? null, role: roleForUserUpsert(user.email), lastSignedIn: user.lastSignedIn ?? new Date() };
    try { await db.insert(users).values(values); return; } catch (error) { const concurrent=await getUserByOpenId(user.openId); if (concurrent) { await upsertUser(user); return; } if (attempt === 4) throw error; }
  }
}
export async function getUserByOpenId(openId: string) { const db = await getDb(); if (!db) return undefined; const rows = await db.select().from(users).where(eq(users.openId, openId)).limit(1); const row = rows[0]; if (row && !validCustomerId(row.customerId)) { await ensureCustomerId(row.id); const [repaired] = await db.select().from(users).where(eq(users.id, row.id)).limit(1); return repaired; } return row; }
const TRANSFER_NUMBER_KEY = "deposit_transfer_number";
export const PAYMENT_CHANNELS = ["Vodafone Cash", "Orange Cash", "Etisalat Cash", "Instapay"] as const;
export async function getPaymentInstructions() {
  const db = await getDb(); if (!db) return { transferNumber: null as string | null, configured: false };
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, TRANSFER_NUMBER_KEY)).limit(1);
  const transferNumber = row?.value?.trim() || null;
  return { transferNumber, configured: Boolean(transferNumber) };
}
export async function updatePaymentInstructions(adminId: number, transferNumber: string) {
  const db = await getDb(); if (!db) throw new Error("قاعدة البيانات غير متاحة");
  const normalized = transferNumber.trim();
  if (normalized.length < 5 || normalized.length > 120) throw new Error("أدخل رقم التحويل بطول صحيح");
  if (!/^[0-9+()\-\s./A-Za-z]+$/.test(normalized)) throw new Error("رقم التحويل يحتوي على رموز غير مسموحة");
  await db.insert(appSettings).values({ key: TRANSFER_NUMBER_KEY, value: normalized, updatedBy: adminId }).onDuplicateKeyUpdate({ set: { value: normalized, updatedBy: adminId } });
  return getPaymentInstructions();
}
export async function updateProfileName(userId: number, name: string) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  const normalized = name.trim().replace(/\s+/g, " ");
  if (normalized.length < 3 || normalized.length > 120) throw new Error("أدخل الاسم الكامل من 3 إلى 120 حرفًا");
  return db.transaction(async (tx) => {
    const [account] = await tx.select({ profileCompletedAt: users.profileCompletedAt }).from(users).where(eq(users.id, userId)).for("update").limit(1);
    if (!account) throw new Error("الحساب غير موجود");
    const [verification] = await tx.select({ status: accountVerifications.status }).from(accountVerifications).where(eq(accountVerifications.userId, userId)).for("update").limit(1);
    const [override] = await tx.select({ status: accountVerificationOverrides.status }).from(accountVerificationOverrides)
      .where(eq(accountVerificationOverrides.userId, userId)).for("update").limit(1);
    if (override?.status === "manual_verified" || (override?.status !== "revoked" && (verification?.status === "pending" || verification?.status === "approved"))) {
      throw new Error("لا يمكن تعديل الاسم أثناء مراجعة التوثيق أو بعد اعتماده");
    }
    const changed = await tx.update(users).set({ name: normalized }).where(and(eq(users.id, userId), isNull(users.profileCompletedAt)));
    if (Number(changed[0].affectedRows) !== 1) throw new Error("بيانات التسجيل ثابتة ولا يمكن تعديلها بعد إكمال التسجيل");
    const [updated] = await tx.select({
      id: users.id,
      customerId: users.customerId,
      name: users.name,
      email: users.email,
      givenName: users.givenName,
      fatherName: users.fatherName,
      phoneNumber: users.phoneNumber,
      birthDate: users.birthDate,
      profileCompletedAt: users.profileCompletedAt,
      role: users.role,
    }).from(users).where(eq(users.id, userId)).limit(1);
    return updated;
  });
}
function systemReference(prefix: string, id: number) { return `ATH-${prefix}-${id}-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 6).toUpperCase()}`; }
export async function ensureWallet(userId: number) {
  const db = await getDb(); if (!db) return null;
  const existing = await db.select().from(wallets).where(eq(wallets.userId, userId)).limit(1);
  if (existing[0]) return existing[0];
  await db.insert(wallets).values({ userId, balance: "0.00", profitLoss: "0.00", currency: "EGP" }).onDuplicateKeyUpdate({ set: { userId } });
  const [wallet] = await db.select().from(wallets).where(eq(wallets.userId, userId)).limit(1);
  return wallet ?? null;
}

function walletReserved(wallet: { reservedWithdrawals?: string | null; reservedOrders?: string | null; reservedTransfers?: string | null; reservedSavings?: string | null } | undefined) {
  const withdrawals = Number(wallet?.reservedWithdrawals ?? 0);
  const orders = Number(wallet?.reservedOrders ?? 0);
  const transfers = Number(wallet?.reservedTransfers ?? 0);
  const savings = Number(wallet?.reservedSavings ?? 0);
  return { withdrawals, orders, transfers, savings, total: withdrawals + orders + transfers + savings };
}
function availableFrom(balance: string | number, reserved: { withdrawals: number; orders: number; transfers: number; savings: number }) {
  return Math.max(0, Number(balance) - reserved.withdrawals - reserved.orders - reserved.transfers - reserved.savings);
}
export async function withWalletLock<T>(tx: any, userId: number, work: () => Promise<T>) {
  const lockName = `atheer-wallet-${userId}`;
  const [rows] = await tx.execute(sql`SELECT GET_LOCK(${lockName}, 15) AS acquired`);
  if (!Array.isArray(rows) || Number(rows[0]?.acquired) !== 1) {
    throw new Error("المحفظة مشغولة بعملية أخرى؛ حاول مرة أخرى لاحقًا");
  }
  try { return await work(); } finally { await tx.execute(sql`SELECT RELEASE_LOCK(${lockName})`); }
}

export async function getAvailableBalance(userId: number) {
  const db = await getDb(); if (!db) return { balance: "0.00", reservedWithdrawals: "0.00", reservedOrders: "0.00", reservedTransfers: "0.00", reservedSavings: "0.00", reservedTotal: "0.00", available: "0.00", currency: "EGP" };
  await ensureWallet(userId);
  const [wallet] = await db.select().from(wallets).where(eq(wallets.userId, userId)).limit(1);
  const reserved = walletReserved(wallet);
  return { balance: wallet?.balance ?? "0.00", reservedWithdrawals: reserved.withdrawals.toFixed(2), reservedOrders: reserved.orders.toFixed(2), reservedTransfers: reserved.transfers.toFixed(2), reservedSavings: reserved.savings.toFixed(2), reservedTotal: reserved.total.toFixed(2), available: availableFrom(wallet?.balance ?? "0", reserved).toFixed(2), currency: "EGP" };
}

async function getSavingsSummary(userId: number) {
  const db = await getDb();
  if (!db) return { activePrincipal: "0.00" };
  const [row] = await db.select({
    activePrincipal: sql<string>`COALESCE(SUM(CASE WHEN ${savingsPlans.status} = 'active' THEN ${savingsPlans.principalAmount} ELSE 0 END), 0)`,
  }).from(savingsPlans).where(eq(savingsPlans.userId, userId));
  return { activePrincipal: Number(row?.activePrincipal ?? 0).toFixed(2) };
}

export async function getPortfolio(userId: number) {
  const db = await getDb(); if (!db) return null;
  await ensureWallet(userId);
  const [wallet] = await db.select().from(wallets).where(eq(wallets.userId, userId)).limit(1);
  const available = await getAvailableBalance(userId);
  const savings = await getSavingsSummary(userId);
  const activity = await db.select().from(transactions).where(eq(transactions.userId, userId)).orderBy(desc(transactions.createdAt), desc(transactions.id)).limit(8);
  const pending = await db.select().from(requests).where(and(eq(requests.userId, userId), eq(requests.status, "pending"))).orderBy(desc(requests.createdAt));
  return { wallet, available, savings, activity: activity.map(toCustomerTransaction), pending: pending.map(hideReceiptPath) };
}

function hideReceiptPath<T extends { receiptImageUrl?: string | null }>(item:T) { const {receiptImageUrl,...rest}=item;return {...rest,hasReceipt:Boolean(receiptImageUrl)}; }

async function sendRequestSubmittedPush(userId: number, type: "deposit" | "withdrawal", reference: string, amount: string, feeAmount: string) {
  try {
    await sendPushOnce({ userId, ...buildRequestSubmittedPush(type, reference, amount, feeAmount) });
  } catch {
    console.warn("[payments] request push unavailable after commit");
  }
}

export async function createRequest(userId: number, type: "deposit" | "withdrawal", amount: string, note?: string, paymentChannel?: string, transferReference?: string, destination?: string, receiptImageData?: string, options?: { paymentMethodId: string; operationId: string; senderReference?: string; customFields?: Record<string, string>; securityPin?: string }) {
  const db = await getDb(); if (!db) throw new Error("قاعدة البيانات غير متاحة");
  const [customer] = await db.select({ id: users.id, role: users.role }).from(users).where(eq(users.id, userId)).limit(1);
  if (!customer) throw new Error("حساب العميل غير موجود");
  await assertMoneyRequestVerificationAllowed(db, userId, customer.role, type);
  const serviceStatus = await getPaymentServiceStatus();
  if (type === "deposit" && !serviceStatus.depositEnabled) throw new Error("الإيداع متوقف مؤقتًا من الإدارة. يمكنك استخدام السحب إذا كان متاحًا.");
  if (type === "withdrawal" && !serviceStatus.withdrawalEnabled) throw new Error("السحب متوقف مؤقتًا من الإدارة. يمكنك استخدام الإيداع إذا كان متاحًا.");
  const amountMinor = parseMoneyMinorUnits(amount);
  if (amountMinor <= 0 || amountMinor > 99_999_999_999_999) throw new Error("يجب أن تكون قيمة الطلب مبلغًا صحيحًا أكبر من صفر");
  if (type === "withdrawal" && options?.securityPin !== undefined) {
    if (!/^\d{4}$/.test(options.securityPin)) throw new Error("أدخل رمز الأمان المكون من 4 أرقام لتأكيد السحب");
    const [pinUser] = await db.select({ hash: users.securityPinHash }).from(users).where(eq(users.id, userId)).limit(1);
    if (!pinUser?.hash || !(await verifyPassword(options.securityPin, pinUser.hash))) throw new Error("رمز الأمان غير صحيح");
  }
  const normalizedAmount = formatMoneyMinorUnits(amountMinor);
  const numericAmount = Number(normalizedAmount);
  const methods = await getPaymentMethods(userId, false, type);
  const method = options ? methods.find(m => m.id === options.paymentMethodId) : methods.find((m,i) => PAYMENT_CHANNELS[i] === paymentChannel);
  if (!method) throw new Error("وسيلة الدفع غير متاحة لهذا الحساب؛ اختر وسيلة معتمدة أخرى");
  const operationId = options?.operationId ?? `ATH-REQ-${randomUUID()}`;
  if (operationId.length < 12 || operationId.length > 80) throw new Error("معرف الطلب غير صالح");
  if (type === "withdrawal" && transferReference) throw new Error("مرجع السحب الفعلي يسجله المسؤول بعد التنفيذ فقط");
  const senderReference = options?.senderReference?.trim();
  const customFields = validateCustomFieldValues(method.fields, options?.customFields);
  const payloadHash = createHash("sha256").update(JSON.stringify({userId,type,amount:normalizedAmount,method:method.id,note:note?.trim()||"",transferReference:transferReference?.trim()||"",destination:destination?.trim()||"",senderReference:senderReference||"",customFields,receipt:receiptImageData||""})).digest("hex");
  const [existing] = await db.select().from(requests).where(eq(requests.clientOperationId, operationId)).limit(1);
  if (existing) {
    if (existing.userId !== userId || existing.payloadHash !== payloadHash) throw new Error("معرف الطلب مستخدم لبيانات مختلفة");
    await sendRequestSubmittedPush(userId, type, existing.reference, existing.amount, existing.feeAmount);
    return existing.reference;
  }

  const limits = await getOperationLimits();
  const minimum = type === "deposit" ? limits.minDepositAmount : limits.minWithdrawalAmount;
  if (numericAmount < minimum) throw new Error(`الحد الأدنى ${type === "deposit" ? "للإيداع" : "للسحب"} هو ${minimum.toFixed(2)} ج.م`);
  const maximum = type === "deposit" ? limits.maxDepositAmount : limits.maxWithdrawalAmount;
  if (maximum !== null && numericAmount > maximum) throw new Error(`المبلغ يتجاوز الحد الأقصى المسموح به: ${maximum.toFixed(2)} ج.م`);
  if (type === "deposit" && !method.transferNumber) throw new Error("لم يحدد المسؤول رقم تحويل لهذه الوسيلة بعد");
  if (type === "deposit" && !senderReference && !transferReference?.trim()) throw new Error("أدخل رقم المرسل أو مرجع التحويل");
  if (type === "deposit" && !receiptImageData) throw new Error("أرفق صورة التحويل قبل إرسال طلب الإيداع");
  if (type === "withdrawal" && (!destination?.trim() || destination.trim().length < 5)) throw new Error("أدخل رقم محفظتك أو حسابك");
  if (receiptImageData) decodePaymentImage(receiptImageData);

  // Deposits are always free. Withdrawal fees are snapshotted here and never recalculated later.
  const feePolicy = type === "withdrawal" ? await getFeePolicy() : null;
  if (feePolicy) assertWithdrawalFeeCoverage(feePolicy, limits.minWithdrawalAmount);
  const feeMinor = type === "withdrawal" && feePolicy ? getWithdrawalFeeMinorUnits(normalizedAmount, feePolicy) : 0;
  const feeAmount = formatMoneyMinorUnits(feeMinor);
  const totalMinor = amountMinor + feeMinor;
  const totalAmount = formatMoneyMinorUnits(totalMinor);
  if (type === "withdrawal") {
    const available = await getAvailableBalance(userId);
    if (parseMoneyMinorUnits(available.available) < totalMinor) throw new Error(INSUFFICIENT_BALANCE_MESSAGE + " بعد إضافة الرسوم");
  }
  const receiptImageUrl = type === "deposit" && receiptImageData ? await saveReceipt(userId,receiptImageData) : null;
  await ensureWallet(userId);
  const result = await db.transaction(async tx => {
    const [wallet] = await tx.select().from(wallets).where(eq(wallets.userId,userId)).for("update").limit(1);
    if (!wallet) throw new Error("محفظة العميل غير متاحة");
    const [duplicate] = await tx.select().from(requests).where(eq(requests.clientOperationId,operationId)).limit(1);
    if (duplicate) {
      if (duplicate.userId!==userId || duplicate.payloadHash!==payloadHash) throw new Error("معرف الطلب مستخدم لبيانات مختلفة");
      return { reference: duplicate.reference, amount: duplicate.amount, feeAmount: duplicate.feeAmount };
    }
    if (type === "withdrawal") {
      const result = await tx.update(wallets).set({reservedWithdrawals:sql`${wallets.reservedWithdrawals} + ${totalAmount}`}).where(and(eq(wallets.userId,userId),sql`${wallets.balance} - ${wallets.reservedWithdrawals} - ${wallets.reservedOrders} - ${wallets.reservedTransfers} - ${wallets.reservedSavings} >= ${totalAmount}`)) as any;
      if (Number(result?.[0]?.affectedRows ?? 0)!==1) throw new Error(INSUFFICIENT_BALANCE_MESSAGE + " بعد إضافة الرسوم");
    }
    const reference = systemReference(type === "deposit" ? "DEP" : "WDR",userId);
    const fieldLabels = Object.fromEntries((method.fields ?? []).map((field) => [field.key, field.label]));
    const customFieldSnapshot = Object.keys(customFields).length ? JSON.stringify({ values: customFields, labels: fieldLabels }) : null;
    await tx.insert(requests).values({userId,type,amount:normalizedAmount,feeAmount,currency:"EGP",note:note?.trim()||null,customFields:customFieldSnapshot,paymentChannel:method.name,paymentMethodId:method.id,clientOperationId:operationId,payloadHash,senderReference:senderReference||null,transferReference:null,submittedTransferReference:transferReference?.trim()||null,receiptImageUrl,destination:destination?.trim()||null,transferNumberSnapshot:type==="deposit"?method.transferNumber:null,reference});
    if (type === "withdrawal") {
      const balance = wallet.balance;
      await tx.insert(transactions).values({userId,reference:`${reference}-W`,type:"withdrawal",amount:normalizedAmount,currency:"EGP",status:"pending",note:`طلب سحب ${reference}`,direction:"debit",customerTitle:"سحب",customerDescription:`المبلغ المطلوب ${normalizedAmount} ج.م؛ الرسوم ${feeAmount} ج.م؛ الإجمالي المحجوز ${totalAmount} ج.م.`,source:"withdrawal_request",balanceBefore:balance,balanceAfter:balance});
      if (feeMinor > 0) await tx.insert(transactions).values({userId,reference:`${reference}-F`,type:"fee",amount:feeAmount,currency:"EGP",status:"pending",note:`رسوم السحب لطلب ${reference}`,direction:"debit",customerTitle:"رسوم السحب",customerDescription:`رسم السحب ${feeAmount} ج.م`,source:"withdrawal_fee",balanceBefore:balance,balanceAfter:balance});
    }
    const message = buildRequestSubmittedPush(type, reference, normalizedAmount, feeAmount);
    await tx.insert(notifications).values({userId,title:message.title,body:message.body,type,operationId:`request:${reference}`});
    return { reference, amount: normalizedAmount, feeAmount };
  });
  await sendRequestSubmittedPush(userId, type, result.reference, result.amount, result.feeAmount);
  return result.reference;
}

export async function getRequestReceipt(userId: number, requestId: number, isAdmin = false) {
  const db = await getDb(); if (!db) throw new Error("قاعدة البيانات غير متاحة");
  if (isAdmin) await requireAdministrator(userId);
  const [item] = await db.select().from(requests).where(and(eq(requests.id,requestId),...(isAdmin?[]:[eq(requests.userId,userId)]))).limit(1);
  if (!item?.receiptImageUrl) throw new Error("الإيصال غير موجود أو غير متاح لهذا الحساب");
  return readReceipt(item.receiptImageUrl);
}
export async function getCustomerRequests(userId: number) { const db = await getDb(); if (!db) return []; return (await db.select().from(requests).where(eq(requests.userId,userId)).orderBy(desc(requests.createdAt)).limit(100)).map(hideReceiptPath); }
function toCustomerTransaction(item: typeof transactions.$inferSelect) {
  const metadata = resolveTransactionMetadata(item);
  return {...item, ...metadata, note: metadata.customerDescription};
}
export async function getTransactions(userId: number) { const db = await getDb(); if (!db) return []; return (await db.select().from(transactions).where(eq(transactions.userId, userId)).orderBy(desc(transactions.createdAt),desc(transactions.id)).limit(100)).map(toCustomerTransaction); }
export async function adminStats() { const db = await getDb(); if (!db) return { customers: 0, balances: "0.00", deposits: "0.00", withdrawals: "0.00", pending: 0, profitLoss: "0.00" }; const [customerRows, balanceRows, depositRows, withdrawalRows, pendingRows, pnlRows] = await Promise.all([db.select({ count: sql<number>`count(*)` }).from(users).where(eq(users.role, "user")), db.select({ total: sql<string>`coalesce(sum(${wallets.balance}),0)` }).from(wallets), db.select({ total: sql<string>`coalesce(sum(${requests.amount}),0)` }).from(requests).where(and(eq(requests.type, "deposit"), eq(requests.status, "approved"))), db.select({ total: sql<string>`coalesce(sum(${requests.amount}),0)` }).from(requests).where(and(eq(requests.type, "withdrawal"), inArray(requests.status, ["approved", "completed"]))), db.select({ count: sql<number>`count(*)` }).from(requests).where(eq(requests.status, "pending")), db.select({ total: sql<string>`coalesce(sum(${wallets.profitLoss}),0)` }).from(wallets)]); return { customers: Number(customerRows[0]?.count ?? 0), balances: String(balanceRows[0]?.total ?? "0.00"), deposits: String(depositRows[0]?.total ?? "0.00"), withdrawals: String(withdrawalRows[0]?.total ?? "0.00"), pending: Number(pendingRows[0]?.count ?? 0), profitLoss: String(pnlRows[0]?.total ?? "0.00") }; }
export async function adminStatus() { const db = await getDb(); if (!db) return { hasAdmin: false }; const [row] = await db.select({ count: sql<number>`count(*)` }).from(users).where(eq(users.role, "admin")); return { hasAdmin: Number(row?.count ?? 0) > 0 }; }
export async function claimFirstAdmin(userId: number) { const db = await getDb(); if (!db) throw new Error("قاعدة البيانات غير متاحة"); const [user] = await db.select({ email: users.email, emailNormalized: users.emailNormalized }).from(users).where(eq(users.id, userId)).limit(1); const email = (user?.emailNormalized ?? user?.email)?.trim().toLowerCase(); if (email !== ADMIN_EMAIL) throw new Error("لا يمكن منح صلاحية الإدارة لهذا البريد"); await db.update(users).set({ role: "admin" }).where(eq(users.id, userId)); return true; }
// Preserve the legacy array contract, but never let completed requests displace old pending ones.
export async function adminRequests() { const db = await getDb(); if (!db) return []; return (await db.select({ request: requests, customer: { name: users.name, email: users.email, customerId: users.customerId } }).from(requests).leftJoin(users, eq(requests.userId, users.id)).where(eq(requests.status, "pending")).orderBy(asc(requests.createdAt), asc(requests.id)).limit(100)).map(row=>({...row,request:hideReceiptPath(row.request)})); }

export async function adminPendingPaymentRequests(input: { type: "deposit" | "withdrawal"; limit: number; cursor?: { createdAt: string; id: number } }) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  const cursorDate = input.cursor ? new Date(input.cursor.createdAt) : null;
  const after = input.cursor && cursorDate ? or(gt(requests.createdAt, cursorDate), and(eq(requests.createdAt, cursorDate), gt(requests.id, input.cursor.id))) : undefined;
  const rows = await db.select({ request: requests, customer: { name: users.name, email: users.email, customerId: users.customerId } })
    .from(requests).leftJoin(users, eq(requests.userId, users.id))
    .where(and(eq(requests.status, "pending"), eq(requests.type, input.type), after))
    .orderBy(asc(requests.createdAt), asc(requests.id)).limit(input.limit + 1);
  const hasMore = rows.length > input.limit;
  const page = rows.slice(0, input.limit);
  const last = page[page.length - 1]?.request;
  return {
    items: page.map((row) => ({ ...row, request: hideReceiptPath(row.request) })),
    nextCursor: hasMore && last ? { createdAt: last.createdAt.toISOString(), id: last.id } : null,
  };
}

export async function adminPaymentRequestById(requestId: number) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  const [row] = await db.select({ request: requests, customer: { name: users.name, email: users.email, customerId: users.customerId } })
    .from(requests).leftJoin(users, eq(requests.userId, users.id)).where(eq(requests.id, requestId)).limit(1);
  return row ? { ...row, request: hideReceiptPath(row.request) } : null;
}
export async function adminPaymentRequestArchive(offset: number, limit: number) {
  const db = await getDb();
  if (!db) return { items: [], total: 0, offset, limit };
  const reviewed = isNotNull(requests.reviewedAt);
  const [countRow] = await db.select({ count: sql<number>`count(*)` }).from(requests).where(reviewed);
  const items = await db.select({
    request: requests,
    customer: { name: users.name, email: users.email, customerId: users.customerId },
  }).from(requests)
    .leftJoin(users, eq(requests.userId, users.id))
    .where(reviewed)
    .orderBy(desc(requests.reviewedAt), desc(requests.createdAt), desc(requests.id))
    .limit(limit)
    .offset(offset);
  return { items: items.map((row) => ({ ...row, request: hideReceiptPath(row.request) })), total: Number(countRow?.count ?? 0), offset, limit };
}
export async function adminCustomers(search?: string) {
  const db = await getDb();
  if (!db) return [];
  const query = (search ?? "").trim().slice(0, 100);
  const pattern = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
  const filter = query ? or(like(users.customerId, pattern), like(users.name, pattern), like(users.email, pattern), like(users.phoneNumber, pattern)) : undefined;
  return db.select({
    user: { id: users.id, customerId: users.customerId, name: users.name, email: users.email, givenName: users.givenName, fatherName: users.fatherName, phoneNumber: users.phoneNumber, birthDate: users.birthDate, role: users.role, createdAt: users.createdAt },
    wallet: { balance: wallets.balance, reservedWithdrawals: wallets.reservedWithdrawals, reservedOrders: wallets.reservedOrders, reservedTransfers: wallets.reservedTransfers, reservedSavings: wallets.reservedSavings, currency: wallets.currency },
  }).from(users).leftJoin(wallets, eq(users.id, wallets.userId)).where(filter).orderBy(desc(users.createdAt)).limit(100);
}
export async function findCustomerByCustomerId(customerId: string) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.select({
    user: { id: users.id, customerId: users.customerId, name: users.name, email: users.email, role: users.role },
    wallet: { balance: wallets.balance, currency: wallets.currency },
  }).from(users).leftJoin(wallets, eq(users.id, wallets.userId)).where(eq(users.customerId, customerId)).limit(1);
  return row ?? null;
}

export async function reviewRequest(requestId: number, adminId: number, status: "approved" | "rejected" | "completed", confirmation?: { confirmedTransfer?: boolean; payoutReference?: string; depositReference?: string; rejectionReason?: string }) {
  const db = await requireAdministrator(adminId);
  const rejectionReason = confirmation?.rejectionReason?.trim() || "";
  if (status === "rejected" && (rejectionReason.length < 3 || rejectionReason.length > 500)) throw new Error("سبب الرفض إلزامي ويجب أن يكون من 3 إلى 500 حرف");
  const result = await db.transaction(async tx => {
    const [initial] = await tx.select().from(requests).where(eq(requests.id,requestId)).limit(1);
    if (!initial) throw new Error("الطلب غير موجود");
    const [wallet] = await tx.select().from(wallets).where(eq(wallets.userId,initial.userId)).for("update").limit(1);
    const [item] = await tx.select().from(requests).where(eq(requests.id,requestId)).for("update").limit(1);
    if (!item || item.status!=="pending") throw new Error("الطلب غير موجود أو تمت مراجعته مسبقًا");
    if (!wallet) throw new Error("محفظة العميل غير متاحة");
    if ((item.type==="deposit" && status==="completed") || (item.type==="withdrawal" && status==="approved")) throw new Error("اختر قبول الإيداع أو تم التنفيذ للسحب");
    const confirmed = status!=="rejected";
    if (confirmed && confirmation?.confirmedTransfer!==true) throw new Error("يجب تأكيد وصول الإيداع أو نجاح التحويل للسحب أولًا");
    const payoutReference = confirmation?.payoutReference?.trim();
    if (status==="completed" && (!payoutReference || payoutReference.length<3 || payoutReference.length>150)) throw new Error("أدخل مرجع التحويل المنفذ للسحب");
    if (payoutReference) { const [duplicate] = await tx.select({id:requests.id}).from(requests).where(eq(requests.payoutReference,payoutReference)).limit(1); if(duplicate) throw new Error("مرجع تنفيذ السحب مستخدم مسبقًا"); }
    const depositReference = confirmation?.depositReference?.trim();
    if (status==="approved") {
      if (!depositReference || depositReference.length<3 || depositReference.length>150) throw new Error("أدخل مرجع التحويل الوارد المؤكد للإيداع");
      const [duplicate] = await tx.select({id:requests.id}).from(requests).where(and(eq(requests.transferReference,depositReference),ne(requests.id,requestId))).limit(1);
      if (duplicate) throw new Error("مرجع التحويل مستخدم مسبقًا ولا يمكن احتسابه مرتين");
    }
    const amountMinor=parseMoneyMinorUnits(item.amount);
    if (amountMinor<=0) throw new Error("مبلغ الطلب غير صالح");
    const feeMinor=item.type==="withdrawal"?parseMoneyMinorUnits(item.feeAmount):0;
    const totalMinor=amountMinor+feeMinor;
    const amount=formatMoneyMinorUnits(amountMinor);
    const feeAmount=formatMoneyMinorUnits(feeMinor);
    const totalAmount=formatMoneyMinorUnits(totalMinor);
    const beforeMinor=parseMoneyMinorUnits(wallet.balance);
    const balanceBefore=formatMoneyMinorUnits(beforeMinor);
    const afterMinor=confirmed?(item.type==="deposit"?beforeMinor+amountMinor:beforeMinor-totalMinor):beforeMinor;
    if (item.type==="withdrawal") {
      const updated=await tx.update(wallets).set({reservedWithdrawals:sql`${wallets.reservedWithdrawals} - ${totalAmount}`,...(confirmed?{balance:sql`${wallets.balance} - ${totalAmount}`}:{})}).where(and(eq(wallets.userId,item.userId),sql`${wallets.reservedWithdrawals} >= ${totalAmount}`,...(confirmed?[sql`${wallets.balance} >= ${wallets.reservedWithdrawals} + ${wallets.reservedOrders} + ${wallets.reservedTransfers} + ${wallets.reservedSavings}`]:[]))) as any;
      if (Number(updated?.[0]?.affectedRows??0)!==1) throw new Error(INSUFFICIENT_BALANCE_MESSAGE);
    } else if (confirmed) {
      const updated=await tx.update(wallets).set({balance:sql`${wallets.balance} + ${amount}`}).where(eq(wallets.userId,item.userId)) as any;
      if (Number(updated?.[0]?.affectedRows??0)!==1) throw new Error("تعذر تحديث رصيد العميل");
    }
    await tx.update(requests).set({status,reviewedBy:adminId,reviewedAt:new Date(),payoutReference:status==="completed"?payoutReference:null,rejectionReason:status==="rejected"?rejectionReason:null,...(status==="approved"?{transferReference:depositReference}:{})}).where(eq(requests.id,requestId));
    const deltaMinor=confirmed?(item.type==="deposit"?amountMinor:-totalMinor):0;
    await tx.insert(auditLogs).values({operationId:`review:${item.reference}`,adminId,targetUserId:item.userId,amount:formatMoneyMinorUnits(deltaMinor),balanceBefore,balanceAfter:formatMoneyMinorUnits(afterMinor),currency:"EGP",reason:status==="rejected"?`رفض طلب ${item.reference}: ${rejectionReason}`:item.type==="deposit"?`قبول إيداع بعد التحقق اليدوي: ${depositReference}`:`تنفيذ سحب ${amount} ج.م ورسوم ${feeAmount} ج.م: ${payoutReference}`});
    if (item.type === "withdrawal") {
      const principalAfter = confirmed ? beforeMinor - amountMinor : beforeMinor;
      const principal = await tx.update(transactions).set({status:confirmed?"approved":"rejected",note:confirmed?`سحب مكتمل — مرجع التحويل ${payoutReference}`:`رُفض السحب: ${rejectionReason}`,customerDescription:confirmed?`تم تنفيذ السحب ${amount} ج.م؛ الرسوم ${feeAmount} ج.م؛ الإجمالي ${totalAmount} ج.م.`:`رُفض الطلب. السبب: ${rejectionReason}`.slice(0,160),balanceBefore,balanceAfter:formatMoneyMinorUnits(principalAfter)}).where(and(eq(transactions.reference,`${item.reference}-W`),eq(transactions.status,"pending"))) as any;
      if (Number(principal?.[0]?.affectedRows??0)!==1) throw new Error("تعذر تحديث سجل السحب");
      if (feeMinor > 0) {
        const fee = await tx.update(transactions).set({status:confirmed?"approved":"rejected",note:confirmed?`رسوم سحب للطلب ${item.reference}`:`أُلغي رسم السحب بسبب رفض الطلب: ${rejectionReason}`,customerDescription:confirmed?`رسوم السحب ${feeAmount} ج.م؛ إجمالي الخصم ${totalAmount} ج.م.`:`لم تُخصم الرسوم. السبب: ${rejectionReason}`.slice(0,160),balanceBefore:formatMoneyMinorUnits(principalAfter),balanceAfter:formatMoneyMinorUnits(afterMinor)}).where(and(eq(transactions.reference,`${item.reference}-F`),eq(transactions.status,"pending"))) as any;
        if (Number(fee?.[0]?.affectedRows??0)!==1) throw new Error("تعذر تحديث سجل رسوم السحب");
      }
    } else {
      const metadata=resolveTransactionMetadata({type:"deposit",amount:item.amount,status:confirmed?"approved":"rejected",customerDescription:confirmed?"تم قبول الإيداع؛ الإيداع مجاني بلا رسوم.":`رُفض الإيداع. السبب: ${rejectionReason}`});
      await tx.insert(transactions).values({userId:item.userId,reference:item.reference,type:"deposit",amount:item.amount,status:confirmed?"approved":"rejected",note:confirmed?`إيداع مؤكد يدويًا — مرجع التحويل ${depositReference}`:`رُفض الإيداع: ${rejectionReason}`,currency:"EGP",direction:"credit",customerTitle:confirmed?"إيداع":"إيداع مرفوض",customerDescription:metadata.customerDescription,source:confirmed?"manual_deposit":"rejected_deposit",balanceBefore,balanceAfter:formatMoneyMinorUnits(afterMinor)});
    }
    const title=status==="rejected"?(item.type==="deposit"?"تم رفض طلب الإيداع":"تم رفض طلب السحب"):item.type==="deposit"?"تم قبول الإيداع":"تم خصم أموال من محفظتك";
    const body=status==="rejected"?`تم رفض الطلب ${item.reference}. السبب: ${rejectionReason}${item.type==="withdrawal"?` وتم تحرير إجمالي المبلغ المحجوز ${totalAmount} ج.م دون خصم رسوم.`:" ولم تُفرض أي رسوم على الإيداع."}`:item.type==="deposit"?`تمت إضافة ${amount} جنيه إلى رصيدك. الإيداع مجاني دائمًا بلا رسوم.`:`تم تنفيذ السحب ${amount} جنيه. رسوم السحب ${feeAmount} جنيه. إجمالي الخصم ${totalAmount} جنيه. مرجع التحويل: ${payoutReference}`;
    await tx.insert(notifications).values({userId:item.userId,title,body,type:item.type,operationId:item.reference});
    return {success:true,type:item.type,status,amount:item.amount,feeAmount,reference:item.reference,userId:item.userId,title,body};
  });
  // Push follows the committed balance/request transaction. Delivery failures never undo money operations.
  try { await sendPushOnce({userId:result.userId,operationId:result.reference,title:result.title,body:result.body,data:{type:result.type,reference:result.reference}}); } catch { console.warn("[payments] push delivery unavailable after commit"); }
  return {success:true,type:result.type,status:result.status,amount:result.amount,feeAmount:result.feeAmount,reference:result.reference};
}

export const adjustBalance = applyBalanceAdjustment;

export async function topUpByCustomerId(adminId: number, customerId: string, amount: string, reason: string, operationId: string) {
  const minor = parseMoneyMinorUnits(amount);
  if (!/^\d{10}$/.test(customerId)) throw new Error("رقم العميل يجب أن يتكون من 10 أرقام");
  if (minor <= 0) throw new Error("يجب أن يكون مبلغ الشحن أكبر من صفر");
  const customer = await findCustomerByCustomerId(customerId);
  if (!customer) throw new Error("لم يتم العثور على عميل بهذا الرقم");
  const normalizedAmount = formatMoneyMinorUnits(minor);
  const result = await adjustBalance(adminId, customer.user.id, normalizedAmount, reason, operationId);
  return { ...result, customerId, name: customer.user.name, amount: normalizedAmount };
}
export async function customerDetails(userId: number) {
  const db = await getDb();
  if (!db) return null;
  const [user] = await db.select({
    id: users.id,
    customerId: users.customerId,
    name: users.name,
    email: users.email,
    givenName: users.givenName,
    fatherName: users.fatherName,
    phoneNumber: users.phoneNumber,
    birthDate: users.birthDate,
    role: users.role,
    createdAt: users.createdAt,
  }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return null;
  const [wallet] = await db.select({
    balance: wallets.balance,
    reservedWithdrawals: wallets.reservedWithdrawals,
    reservedOrders: wallets.reservedOrders,
    reservedTransfers: wallets.reservedTransfers,
    reservedSavings: wallets.reservedSavings,
    currency: wallets.currency,
  }).from(wallets).where(eq(wallets.userId, userId)).limit(1);
  const reserved = walletReserved(wallet);
  const available = {
    balance: wallet?.balance ?? "0.00",
    reservedWithdrawals: reserved.withdrawals.toFixed(2),
    reservedOrders: reserved.orders.toFixed(2),
    reservedTransfers: reserved.transfers.toFixed(2),
    reservedSavings: reserved.savings.toFixed(2),
    reservedTotal: reserved.total.toFixed(2),
    available: availableFrom(wallet?.balance ?? "0.00", reserved).toFixed(2),
    currency: wallet?.currency ?? "EGP",
  };
  const history = await db.select().from(transactions).where(eq(transactions.userId, userId))
    .orderBy(desc(transactions.createdAt), desc(transactions.id)).limit(100);
  return { user, wallet: wallet ?? null, available, history: history.map((item) => ({ ...item, ...resolveTransactionMetadata(item) })) };
}
export async function latestMarketQuotes(symbol?: string) { return getMarketDataProvider().getQuotes(symbol ? [symbol] : undefined); }
export async function listMarketInstruments() { const db = await getDb(); if (!db) return []; return db.select().from(marketInstruments).where(eq(marketInstruments.active, 1)).orderBy(asc(marketInstruments.assetClass), asc(marketInstruments.nameArabic)); }

export async function createOrderIntent(userId: number, input: { symbol: string; side: "buy" | "sell"; orderType: "market" | "limit"; quantity: string; limitPrice?: string; idempotencyKey: string }) {
  const db = await getDb(); if (!db) throw new Error("قاعدة البيانات غير متاحة");
  const limits = await getOperationLimits();
  if (input.orderType === "market" && !input.limitPrice) throw new Error("لا يمكن إرسال أمر سوق قبل ربط سعر لحظي موثوق من مزود مرخص");
  const estimatedAmount = input.limitPrice ? Number(input.quantity) * Number(input.limitPrice) : 0;
  if (limits.maxTradeAmount !== null && estimatedAmount > limits.maxTradeAmount) throw new Error(`قيمة الصفقة تتجاوز الحد الأقصى: ${limits.maxTradeAmount.toFixed(2)} ج.م`);
  await ensureWallet(userId);
  return db.transaction(async (tx) => withWalletLock(tx, userId, async () => {
    const [existing] = await tx.select().from(orders).where(eq(orders.idempotencyKey, input.idempotencyKey)).for("update");
    if (existing) return { order: existing, duplicate: true, liveExecution: false };
    const reservedAmount = input.side === "buy" && input.limitPrice ? (Number(input.quantity) * Number(input.limitPrice)).toFixed(2) : "0.00";
    if (Number(reservedAmount) > 0) {
      const result = await tx.update(wallets).set({ reservedOrders: sql`${wallets.reservedOrders} + ${Number(reservedAmount)}` }).where(and(eq(wallets.userId, userId), sql`${wallets.balance} - ${wallets.reservedWithdrawals} - ${wallets.reservedOrders} - ${wallets.reservedTransfers} - ${wallets.reservedSavings} >= ${Number(reservedAmount)}`)) as any;
      if (Number(result?.[0]?.affectedRows ?? result?.affectedRows ?? 0) !== 1) throw new Error(INSUFFICIENT_BALANCE_MESSAGE);
    }
    const clientOrderId = `ATH-${userId}-${randomUUID()}`;
    await tx.insert(orders).values({ clientOrderId, idempotencyKey: input.idempotencyKey, userId, symbol: input.symbol.toUpperCase(), side: input.side, orderType: input.orderType, quantity: input.quantity, limitPrice: input.limitPrice ?? null, reservedAmount, currency: "EGP", status: "draft", broker: null });
    const [order] = await tx.select().from(orders).where(eq(orders.clientOrderId, clientOrderId)).limit(1);
    return { order, duplicate: false, liveExecution: false };
  }));
}
export async function getOrders(userId: number) { const db = await getDb(); if (!db) return []; return db.select().from(orders).where(eq(orders.userId, userId)).orderBy(desc(orders.createdAt)).limit(100); }

export const getOperationLimits = getPaymentLimits;
export async function updateOperationLimits(adminId: number, input: LimitInput) { return updatePaymentLimits(adminId,input); }
export async function createNotification(userId: number, title: string, body: string, type: string, operationId?: string) { const db = await getDb(); if (!db) return; await db.insert(notifications).values({ userId, title, body, type, operationId: operationId ?? null }).onDuplicateKeyUpdate({ set: { userId } }); }
export async function listNotifications(userId: number) { const db = await getDb(); if (!db) return []; return db.select().from(notifications).where(eq(notifications.userId, userId)).orderBy(desc(notifications.createdAt)).limit(100); }
export async function listSuccessfulTransactions(userId: number) {
  const db = await getDb();
  if (!db) return [];
  const [rows, readRows] = await Promise.all([
    db.select().from(transactions).where(and(
      eq(transactions.userId, userId),
      eq(transactions.status, "approved"),
      or(inArray(transactions.type, ["deposit", "withdrawal", "transfer"]), eq(transactions.source, "game_topup"), inArray(transactions.source, ["savings_principal", "savings_refund", "savings_profit"])),
    )).orderBy(desc(transactions.createdAt), desc(transactions.id)).limit(100),
    db.select({ operationId: notifications.operationId, readAt: notifications.readAt }).from(notifications).where(eq(notifications.userId, userId)).orderBy(desc(notifications.createdAt)).limit(300),
  ]);
  const readByOperation = new Map(readRows.filter((item) => item.readAt).map((item) => [item.operationId, item.readAt]));
  return rows.filter(isBellEligibleSuccessfulTransaction).map((row) => {
    const metadata = resolveTransactionMetadata(row);
    const readAt = readByOperation.get(`success:${row.reference}`) ?? readByOperation.get(row.reference) ?? null;
    return { reference: row.reference, type: row.type, direction: metadata.direction, title: metadata.customerTitle, description: metadata.customerDescription, amount: metadata.displayAmount, currency: row.currency, createdAt: row.createdAt, readAt, isRead: Boolean(readAt) };
  });
}
export async function markSuccessfulTransactionRead(userId: number, reference: string) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  const [row] = await db.select().from(transactions).where(and(eq(transactions.userId, userId), eq(transactions.reference, reference), eq(transactions.status, "approved"))).limit(1);
  if (!row || !isBellEligibleSuccessfulTransaction(row)) throw new Error("العملية الناجحة غير متاحة في الجرس");
  const metadata = resolveTransactionMetadata(row);
  const operationId = `success:${row.reference}`;
  await db.insert(notifications).values({ userId, title: metadata.customerTitle, body: metadata.customerDescription, type: "transaction_success", operationId, readAt: new Date() })
    .onDuplicateKeyUpdate({ set: { readAt: new Date() } });
  return { success: true };
}
export async function unreadNotificationCount(userId: number) { const db = await getDb(); if (!db) return 0; const rows = await db.select().from(notifications).where(and(eq(notifications.userId, userId), isNull(notifications.readAt))); return rows.length; }
export async function markNotificationDelivered(userId: number, notificationId: number) { const db = await getDb(); if (!db) throw new Error("قاعدة البيانات غير متاحة"); await db.update(notifications).set({ deliveredAt: new Date() }).where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId), isNull(notifications.deliveredAt))); return { success: true }; }
export async function markNotificationRead(userId: number, notificationId: number) { const db = await getDb(); if (!db) throw new Error("قاعدة البيانات غير متاحة"); await db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId))); return { success: true }; }
export async function receiveBrokerWebhook(provider: string, eventId: string, eventType: string, brokerOrderId: string | undefined, payload: string) {
  const db = await getDb(); if (!db) throw new Error("قاعدة البيانات غير متاحة");
  const [existing] = await db.select().from(brokerEvents).where(eq(brokerEvents.eventId, eventId)).limit(1); if (existing) return { duplicate: true, event: existing };
  await db.insert(brokerEvents).values({ provider, eventId, eventType, brokerOrderId: brokerOrderId ?? null, payload, status: "received" });
  return { duplicate: false };
}
