import { and, eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { appSettings, customerPaymentMethodAccess, paymentMethods, users } from "../drizzle/schema";
import { ADMIN_EMAIL } from "../shared/admin";
import { assertWithdrawalFeeCoverage, DEFAULT_FEE_POLICY, parseStoredFeePolicy, validateFeePolicy, type FeePolicy } from "../shared/fee-policy";
import { validateMethodFields, type PaymentMethodField } from "../shared/payment-method-fields";
import { resolvePaymentMethodAccess, type PaymentMethodDirection } from "../shared/payment-method-access";
import { getDb } from "./db";
import { saveMethodImage } from "./payment-media";

export const METHOD_IDS = ["vodafone", "orange", "etisalat", "instapay"] as const;
export type PaymentMethodId = typeof METHOD_IDS[number];
const names = ["Vodafone Cash", "Orange Cash", "Etisalat Cash", "Instapay"];
const PAYMENT_METHODS_CONFIG_KEY = "payment_methods_config";
const PAYMENT_SERVICE_STATUS_KEY = "payment_service_status";
const methodIdPattern = /^[a-z][a-z0-9_]{1,19}$/;

type MethodConfig = { enabled: boolean; deleted?: boolean; fields: PaymentMethodField[]; depositFields?: PaymentMethodField[]; withdrawalFields?: PaymentMethodField[] };
type MethodsConfig = { methods: Record<string, MethodConfig>; blockedByUser: Record<string, string[]> };
export type PaymentMethodRecord = { id: string; name: string; transferNumber: string | null; imageUrl: string | null; enabled: boolean; deleted: boolean; fields: PaymentMethodField[]; depositFields: PaymentMethodField[]; withdrawalFields: PaymentMethodField[]; depositEnabled: boolean; withdrawalEnabled: boolean };
export type PaymentServiceStatus = { depositEnabled: boolean; withdrawalEnabled: boolean; updatedAt: Date | null };

export async function getPaymentServiceStatus(): Promise<PaymentServiceStatus> {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  const [row] = await db.select({ value: appSettings.value, updatedAt: appSettings.updatedAt }).from(appSettings).where(eq(appSettings.key, PAYMENT_SERVICE_STATUS_KEY)).limit(1);
  if (!row) return { depositEnabled: true, withdrawalEnabled: true, updatedAt: null };
  try {
    const parsed = JSON.parse(row.value) as Partial<PaymentServiceStatus>;
    return { depositEnabled: parsed.depositEnabled !== false, withdrawalEnabled: parsed.withdrawalEnabled !== false, updatedAt: row.updatedAt ?? null };
  } catch {
    return { depositEnabled: true, withdrawalEnabled: true, updatedAt: row.updatedAt ?? null };
  }
}

export async function updatePaymentServiceStatus(adminId: number, input: { depositEnabled?: boolean; withdrawalEnabled?: boolean }) {
  const db = await requireAdministrator(adminId);
  const current = await getPaymentServiceStatus();
  const next = {
    depositEnabled: input.depositEnabled ?? current.depositEnabled,
    withdrawalEnabled: input.withdrawalEnabled ?? current.withdrawalEnabled,
  };
  await db.insert(appSettings).values({ key: PAYMENT_SERVICE_STATUS_KEY, value: JSON.stringify(next), updatedBy: adminId })
    .onDuplicateKeyUpdate({ set: { value: JSON.stringify(next), updatedBy: adminId } });
  return getPaymentServiceStatus();
}

async function readMethodsConfig(db: NonNullable<Awaited<ReturnType<typeof getDb>>>): Promise<MethodsConfig> {
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, PAYMENT_METHODS_CONFIG_KEY)).limit(1);
  if (!row) return { methods: {}, blockedByUser: {} };
  try {
    const parsed = JSON.parse(row.value) as Partial<MethodsConfig>;
    const methods: MethodsConfig["methods"] = {};
    for (const [id, value] of Object.entries(parsed.methods ?? {})) {
      if (!methodIdPattern.test(id) || !value || typeof value.enabled !== "boolean") continue;
      try {
        const legacyFields = validateMethodFields(value.fields ?? []);
        methods[id] = {
          enabled: value.enabled,
          deleted: value.deleted === true,
          fields: legacyFields,
          depositFields: validateMethodFields(value.depositFields ?? legacyFields),
          withdrawalFields: validateMethodFields(value.withdrawalFields ?? legacyFields),
        };
      } catch { /* Ignore invalid stale configuration rather than breaking payment reads. */ }
    }
    const blockedByUser: MethodsConfig["blockedByUser"] = {};
    for (const [userId, ids] of Object.entries(parsed.blockedByUser ?? {})) {
      if (/^\d+$/.test(userId) && Array.isArray(ids)) blockedByUser[userId] = ids.filter((id): id is string => typeof id === "string" && methodIdPattern.test(id));
    }
    return { methods, blockedByUser };
  } catch {
    return { methods: {}, blockedByUser: {} };
  }
}

async function saveMethodsConfig(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, adminId: number, config: MethodsConfig) {
  const value = JSON.stringify(config);
  await db.insert(appSettings).values({ key: PAYMENT_METHODS_CONFIG_KEY, value, updatedBy: adminId })
    .onDuplicateKeyUpdate({ set: { value, updatedBy: adminId } });
}

function publicMethod(row: typeof paymentMethods.$inferSelect | undefined, id: string, fallbackName: string, config: MethodConfig | undefined, direction?: PaymentMethodDirection): PaymentMethodRecord {
  const legacyFields = config?.fields ?? [];
  const depositFields = config?.depositFields ?? legacyFields;
  const withdrawalFields = config?.withdrawalFields ?? legacyFields;
  return {
    id,
    name: row?.name ?? fallbackName,
    transferNumber: row?.transferNumber ?? null,
    imageUrl: row?.imageUrl ?? null,
    enabled: config?.enabled ?? true,
    deleted: config?.deleted ?? false,
    fields: direction === "deposit" ? depositFields : direction === "withdrawal" ? withdrawalFields : legacyFields,
    depositFields,
    withdrawalFields,
    depositEnabled: true,
    withdrawalEnabled: true,
  };
}

export async function requireAdministrator(adminId: number) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  const [admin] = await db.select({ role: users.role, email: users.email, emailNormalized: users.emailNormalized }).from(users).where(eq(users.id, adminId)).limit(1);
  const email = (admin?.emailNormalized ?? admin?.email)?.trim().toLowerCase();
  if (admin?.role !== "admin" || email !== ADMIN_EMAIL) throw new Error("هذه العملية متاحة لحساب المدير المعتمد فقط");
  return db;
}

export async function getPaymentMethods(userId?: number, includeDisabled = false, direction?: PaymentMethodDirection): Promise<PaymentMethodRecord[]> {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  const saved = await db.select().from(paymentMethods);
  const config = await readMethodsConfig(db);
  const ids = [...new Set([...METHOD_IDS, ...saved.map((row) => row.id)])];
  const methods = ids.map((id) => {
    const index = METHOD_IDS.indexOf(id as PaymentMethodId);
    const row = saved.find((item) => item.id === id);
    return publicMethod(row, id, index >= 0 ? names[index] : row?.name ?? id, config.methods[id], direction);
  });
  const serviceStatus = direction ? await getPaymentServiceStatus() : null;
  const legacyBlocked = userId === undefined ? new Set<string>() : new Set(config.blockedByUser[String(userId)] ?? []);
  const overrides = userId === undefined ? [] : await db.select().from(customerPaymentMethodAccess).where(eq(customerPaymentMethodAccess.userId, userId));
  const overrideByMethod = new Map(overrides.map((item) => [item.methodId, item]));
  return methods.map((method) => {
    const access = resolvePaymentMethodAccess(overrideByMethod.get(method.id), legacyBlocked.has(method.id));
    return { ...method, ...access };
  }).map((method) => direction ? { ...method, fields: method.fields.filter((field) => field.enabled !== false) } : method)
    .filter((method) => (direction ? method.enabled && !method.deleted && method[`${direction}Enabled`] && serviceStatus?.[`${direction}Enabled`] : includeDisabled || (method.enabled && !method.deleted)));
}

export async function getAdminPaymentMethods(adminId: number) {
  await requireAdministrator(adminId);
  return getPaymentMethods(undefined, true);
}

export async function updatePaymentMethod(adminId: number, input: {id: string; name: string; transferNumber: string; imageData?: string; fields?: unknown; depositFields?: unknown; withdrawalFields?: unknown; enabled?: boolean}) {
  const db = await requireAdministrator(adminId);
  if (!methodIdPattern.test(input.id)) throw new Error("معرّف وسيلة الدفع غير صالح");
  const name = input.name.trim();
  const transferNumber = input.transferNumber.trim();
  if (!name || name.length > 40 || (transferNumber && (transferNumber.length < 5 || transferNumber.length > 120))) throw new Error("راجع اسم الوسيلة ورقم التحويل");
  const current = await readMethodsConfig(db);
  const previous = current.methods[input.id];
  const fields = input.fields === undefined ? previous?.fields ?? [] : validateMethodFields(input.fields);
  const depositFields = input.depositFields === undefined
    ? input.fields === undefined ? previous?.depositFields ?? fields : fields
    : validateMethodFields(input.depositFields);
  const withdrawalFields = input.withdrawalFields === undefined
    ? input.fields === undefined ? previous?.withdrawalFields ?? fields : fields
    : validateMethodFields(input.withdrawalFields);
  const enabled = input.enabled ?? current.methods[input.id]?.enabled ?? true;
  const imageUrl = input.imageData ? await saveMethodImage(input.id, input.imageData) : undefined;
  await db.insert(paymentMethods).values({ id: input.id, name, transferNumber: transferNumber || null, imageUrl: imageUrl ?? null, updatedBy: adminId }).onDuplicateKeyUpdate({ set: { name, transferNumber: transferNumber || null, updatedBy: adminId, ...(imageUrl ? { imageUrl } : {}) } });
  current.methods[input.id] = { enabled, deleted: enabled ? false : previous?.deleted ?? false, fields, depositFields, withdrawalFields };
  await saveMethodsConfig(db, adminId, current);
  return (await getPaymentMethods(undefined, true)).find((method) => method.id === input.id)!;
}

export async function createPaymentMethod(adminId: number, input: { name: string; transferNumber: string; imageData?: string; fields?: unknown; depositFields?: unknown; withdrawalFields?: unknown }) {
  const db = await requireAdministrator(adminId);
  const name = input.name.trim();
  const transferNumber = input.transferNumber.trim();
  if (name.length < 2 || name.length > 40 || (transferNumber && (transferNumber.length < 5 || transferNumber.length > 120))) throw new Error("راجع اسم الوسيلة ورقم التحويل");
  const fields = input.fields === undefined ? [] : validateMethodFields(input.fields);
  const depositFields = input.depositFields === undefined ? fields : validateMethodFields(input.depositFields);
  const withdrawalFields = input.withdrawalFields === undefined ? fields : validateMethodFields(input.withdrawalFields);
  const id = `pay_${randomBytes(6).toString("hex")}`;
  const imageUrl = input.imageData ? await saveMethodImage(id, input.imageData) : null;
  await db.insert(paymentMethods).values({ id, name, transferNumber: transferNumber || null, imageUrl, updatedBy: adminId });
  const config = await readMethodsConfig(db);
  config.methods[id] = { enabled: true, deleted: false, fields, depositFields, withdrawalFields };
  await saveMethodsConfig(db, adminId, config);
  return (await getPaymentMethods(undefined, true)).find((method) => method.id === id)!;
}

export async function deletePaymentMethod(adminId: number, id: string) {
  const db = await requireAdministrator(adminId);
  if (!methodIdPattern.test(id)) throw new Error("معرّف وسيلة الدفع غير صالح");
  if (METHOD_IDS.includes(id as PaymentMethodId)) throw new Error("لا يمكن حذف وسيلة أساسية؛ استخدم خيار الإخفاء مع حفظ إعداداتها");
  const config = await readMethodsConfig(db);
  if (!config.methods[id]) throw new Error("وسيلة الدفع غير موجودة");
  config.methods[id] = { ...config.methods[id], enabled: false, deleted: true };
  await saveMethodsConfig(db, adminId, config);
  return { success: true };
}

export async function setCustomerPaymentMethodDirection(adminId: number, targetUserId: number, methodId: string, direction: PaymentMethodDirection, enabled: boolean) {
  const db = await requireAdministrator(adminId);
  if (!methodIdPattern.test(methodId)) throw new Error("معرّف وسيلة الدفع غير صالح");
  if (direction !== "deposit" && direction !== "withdrawal") throw new Error("اتجاه الدفع غير صالح");
  const [customer] = await db.select({ id: users.id, role: users.role }).from(users).where(eq(users.id, targetUserId)).limit(1);
  if (!customer || customer.role === "admin") throw new Error("لا يمكن تغيير وسائل الدفع لهذا الحساب");
  if (!(await getPaymentMethods(undefined, true)).some((method) => method.id === methodId)) throw new Error("وسيلة الدفع غير موجودة");
  const [matching] = await db.select().from(customerPaymentMethodAccess).where(and(eq(customerPaymentMethodAccess.userId, targetUserId), eq(customerPaymentMethodAccess.methodId, methodId))).limit(1);
  const legacyBlocked = (await readMethodsConfig(db)).blockedByUser[String(targetUserId)]?.includes(methodId) ?? false;
  const untouchedDefault = legacyBlocked ? 0 : 1;
  const depositEnabled = direction === "deposit" ? Number(enabled) : matching?.depositEnabled ?? untouchedDefault;
  const withdrawalEnabled = direction === "withdrawal" ? Number(enabled) : matching?.withdrawalEnabled ?? untouchedDefault;
  await db.insert(customerPaymentMethodAccess).values({ userId: targetUserId, methodId, depositEnabled, withdrawalEnabled, updatedBy: adminId })
    .onDuplicateKeyUpdate({ set: { depositEnabled, withdrawalEnabled, updatedBy: adminId } });
  return { depositEnabled: Boolean(depositEnabled), withdrawalEnabled: Boolean(withdrawalEnabled) };
}

export async function setCustomerPaymentMethodBlocked(adminId: number, targetUserId: number, methodId: string, blocked: boolean) {
  const db = await requireAdministrator(adminId);
  if (!methodIdPattern.test(methodId)) throw new Error("معرّف وسيلة الدفع غير صالح");
  const [customer] = await db.select({ id: users.id, role: users.role }).from(users).where(eq(users.id, targetUserId)).limit(1);
  if (!customer || customer.role === "admin") throw new Error("لا يمكن تغيير وسائل الدفع لهذا الحساب");
  if (!(await getPaymentMethods(undefined, true)).some((method) => method.id === methodId)) throw new Error("وسيلة الدفع غير موجودة");
  const enabled = Number(!blocked);
  await db.insert(customerPaymentMethodAccess).values({ userId: targetUserId, methodId, depositEnabled: enabled, withdrawalEnabled: enabled, updatedBy: adminId })
    .onDuplicateKeyUpdate({ set: { depositEnabled: enabled, withdrawalEnabled: enabled, updatedBy: adminId } });
  return { userId: targetUserId, methodId, blocked, depositEnabled: !blocked, withdrawalEnabled: !blocked };
}

export async function getCustomerPaymentMethodAccess(adminId: number, targetUserId: number) {
  await requireAdministrator(adminId);
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  const config = await readMethodsConfig(db);
  const blocked = new Set(config.blockedByUser[String(targetUserId)] ?? []);
  const overrides = await db.select().from(customerPaymentMethodAccess).where(eq(customerPaymentMethodAccess.userId, targetUserId));
  const accessByMethod = new Map(overrides.map((row) => [row.methodId, row]));
  const methods = [...new Set([...blocked, ...accessByMethod.keys()])].map((methodId) => ({ methodId, ...resolvePaymentMethodAccess(accessByMethod.get(methodId), blocked.has(methodId)) }));
  const blockedMethodIds = [...new Set(methods.filter((method) => !method.depositEnabled && !method.withdrawalEnabled).map((method) => method.methodId))];
  return { methods, blockedMethodIds };
}

const limitsKeys = {minDepositAmount:"min_deposit_amount",minWithdrawalAmount:"min_withdrawal_amount",minTransferAmount:"min_transfer_amount",maxTradeAmount:"max_trade_amount",maxDepositAmount:"max_deposit_amount",maxWithdrawalAmount:"max_withdrawal_amount"} as const;
export type LimitInput = Partial<Record<keyof typeof limitsKeys,string>>;

export async function getPaymentLimits() {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  const rows = await db.select().from(appSettings);
  const get = (key:string, fallback:number|null) => { const row=rows.find(item=>item.key===key); const n=row ? Number(row.value) : NaN; return Number.isFinite(n) && n>0 ? n : fallback; };
  return {minDepositAmount:get(limitsKeys.minDepositAmount,500)!,minWithdrawalAmount:get(limitsKeys.minWithdrawalAmount,50)!,minTransferAmount:get(limitsKeys.minTransferAmount,1200)!,maxTradeAmount:get(limitsKeys.maxTradeAmount,null),maxDepositAmount:get(limitsKeys.maxDepositAmount,null),maxWithdrawalAmount:get(limitsKeys.maxWithdrawalAmount,null)};
}

export async function updatePaymentLimits(adminId:number,input:LimitInput) {
  const db = await requireAdministrator(adminId);
  const current = await getPaymentLimits();
  const next = {...current};
  for (const [field,value] of Object.entries(input)) {
    if (!(field in limitsKeys) || value===undefined) continue;
    const key=field as keyof typeof limitsKeys;
    if (!/^\d+(\.\d{1,2})?$/.test(value)) throw new Error("أدخل حدودًا صحيحة بالجنيه المصري");
    const n=Number(value);
    if (!Number.isSafeInteger(Math.round(n*100)) || n>999999999999.99 || (key.startsWith("min") && n<=0)) throw new Error("الحد الأدنى يجب أن يكون أكبر من صفر");
    if (key === "minDepositAmount" || key === "minWithdrawalAmount" || key === "minTransferAmount") next[key] = n;
    else next[key] = n === 0 ? null : n;
  }
  if ((next.maxDepositAmount!==null && next.maxDepositAmount<next.minDepositAmount) || (next.maxWithdrawalAmount!==null && next.maxWithdrawalAmount<next.minWithdrawalAmount)) throw new Error("الحد الأقصى لا يجوز أن يكون أقل من الحد الأدنى");
  assertWithdrawalFeeCoverage(await getFeePolicy(), next.minWithdrawalAmount);
  await db.transaction(async tx=> {
    for (const [field,value] of Object.entries(input)) {
      if (!(field in limitsKeys) || value===undefined) continue;
      const key=limitsKeys[field as keyof typeof limitsKeys];
      await tx.insert(appSettings).values({key,value:Number(value).toFixed(2),updatedBy:adminId}).onDuplicateKeyUpdate({set:{value:Number(value).toFixed(2),updatedBy:adminId}});
    }
  });
  return getPaymentLimits();
}

export async function getFeePolicy(): Promise<FeePolicy> {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, "fee_policy")).limit(1);
  return row ? parseStoredFeePolicy(row.value) : DEFAULT_FEE_POLICY;
}

export async function updateFeePolicy(adminId: number, input: unknown): Promise<FeePolicy> {
  const db = await requireAdministrator(adminId);
  const policy = validateFeePolicy(input);
  assertWithdrawalFeeCoverage(policy, (await getPaymentLimits()).minWithdrawalAmount);
  const value = JSON.stringify(policy);
  await db.insert(appSettings).values({ key: "fee_policy", value, updatedBy: adminId })
    .onDuplicateKeyUpdate({ set: { value, updatedBy: adminId } });
  return policy;
}
