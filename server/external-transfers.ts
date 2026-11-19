import { desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { appSettings, externalTransferRequests, notifications, supportMessages, users } from "../drizzle/schema";
import { EXTERNAL_TRANSFER_CURRENCIES, getExternalTransferCountry, getExternalTransferTotalEgp, type ExternalTransferCurrency, type ExternalTransferPrice, type ExternalTransferStatus } from "../shared/external-transfers";
import { getDb } from "./db";
import { requireAdministrator } from "./payment-settings";

const EXTERNAL_TRANSFER_PRICING_KEY = "external_transfer_pricing_v1";
type PriceMap = Partial<Record<ExternalTransferCurrency, { rate: string | null; feeEgp: string; updatedAt: string | null }>>;

function defaultPrices(): PriceMap {
  return Object.fromEntries(EXTERNAL_TRANSFER_CURRENCIES.map((currencyCode) => [currencyCode, { rate: null, feeEgp: "0.00", updatedAt: null }])) as PriceMap;
}

function parsePriceMap(raw?: string | null): PriceMap {
  const parsed = defaultPrices();
  if (!raw) return parsed;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    for (const currencyCode of EXTERNAL_TRANSFER_CURRENCIES) {
      const candidate = value[currencyCode] as { rate?: unknown; feeEgp?: unknown; updatedAt?: unknown } | undefined;
      if (!candidate) continue;
      const rate = typeof candidate.rate === "string" && /^\d+(?:\.\d{1,6})?$/.test(candidate.rate) && Number(candidate.rate) > 0 ? Number(candidate.rate).toFixed(6) : null;
      const feeEgp = typeof candidate.feeEgp === "string" && /^\d+(?:\.\d{1,2})?$/.test(candidate.feeEgp) && Number(candidate.feeEgp) >= 0 ? Number(candidate.feeEgp).toFixed(2) : "0.00";
      parsed[currencyCode] = { rate, feeEgp, updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : null };
    }
  } catch { /* corrupt legacy value is ignored; defaults are fail-closed */ }
  return parsed;
}

async function readPriceMap(db: Awaited<ReturnType<typeof getDb>>) {
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, EXTERNAL_TRANSFER_PRICING_KEY)).limit(1);
  return parsePriceMap(row?.value);
}

export async function getExternalTransferPricing(): Promise<ExternalTransferPrice[]> {
  const db = await getDb();
  const prices = await readPriceMap(db);
  return EXTERNAL_TRANSFER_CURRENCIES.map((currencyCode) => ({ currencyCode, ...(prices[currencyCode] ?? { rate: null, feeEgp: "0.00", updatedAt: null }) }));
}

export async function updateExternalTransferPricing(adminId: number, input: { currencyCode: ExternalTransferCurrency; rate: string; feeEgp: string }) {
  const db = await requireAdministrator(adminId);
  const rate = input.rate.trim();
  const fee = input.feeEgp.trim();
  if (!/^\d+(?:\.\d{1,6})?$/.test(rate) || Number(rate) <= 0) throw new Error("أدخل سعر صرف موجبًا وبحد أقصى 6 منازل عشرية");
  if (!/^\d+(?:\.\d{1,2})?$/.test(fee) || Number(fee) < 0) throw new Error("أدخل رسومًا صحيحة بالجنيه المصري");
  const prices = await readPriceMap(db);
  prices[input.currencyCode] = { rate: Number(rate).toFixed(6), feeEgp: Number(fee).toFixed(2), updatedAt: new Date().toISOString() };
  const value = JSON.stringify(prices);
  await db.insert(appSettings).values({ key: EXTERNAL_TRANSFER_PRICING_KEY, value, updatedBy: adminId })
    .onDuplicateKeyUpdate({ set: { value, updatedBy: adminId } });
  return getExternalTransferPricing();
}

function makeReference() {
  return `EXT-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 6).toUpperCase()}`;
}

function view(row: typeof externalTransferRequests.$inferSelect, user?: { name: string | null; customerId: string } | null) {
  return {
    id: row.id,
    reference: row.reference,
    userId: row.userId,
    userName: user?.name ?? null,
    customerId: user?.customerId ?? null,
    countryCode: row.countryCode,
    countryName: row.countryName,
    currencyName: row.currencyName,
    currencyCode: row.currencyCode,
    foreignAmount: row.foreignAmount,
    exchangeRate: row.exchangeRate,
    egpEquivalent: row.egpEquivalent,
    feeEgp: row.feeEgp,
    egpTotal: row.egpEquivalent === null || row.feeEgp === null ? null : getExternalTransferTotalEgp(row.egpEquivalent, row.feeEgp).toFixed(2),
    pricingUpdatedAt: row.pricingUpdatedAt,
    status: row.status,
    rejectionReason: row.rejectionReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    reviewedAt: row.reviewedAt,
  };
}

export async function listMyExternalTransferRequests(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  const rows = await db.select().from(externalTransferRequests)
    .where(eq(externalTransferRequests.userId, userId))
    .orderBy(desc(externalTransferRequests.createdAt)).limit(20);
  return rows.map((row) => view(row));
}

export async function createExternalTransferRequest(userId: number, input: { countryCode: string; amount: string; clientOperationId: string }) {
  const country = getExternalTransferCountry(input.countryCode);
  if (!country) throw new Error("اختر دولة مستقبلة صحيحة");
  if (!/^\d{1,12}(?:\.\d{1,2})?$/.test(input.amount) || Number(input.amount) <= 0) throw new Error("أدخل مبلغًا صالحًا بالعملة المطلوبة");
  const foreignAmount = Number(input.amount);
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  const prices = await readPriceMap(db);
  const pricing = prices[country.currencyCode as ExternalTransferCurrency];
  if (!pricing?.rate) throw new Error(`سعر ${country.currencyCode} غير متاح حاليًا؛ تواصل مع الإدارة`);
  const egpEquivalent = Math.round(foreignAmount * Number(pricing.rate) * 100) / 100;
  const feeEgp = Number(pricing.feeEgp);
  const egpTotal = getExternalTransferTotalEgp(egpEquivalent, feeEgp);
  if (!Number.isFinite(egpTotal) || egpTotal <= 0 || egpTotal > 999_999_999_999.99) throw new Error("المبلغ أكبر من حد الخدمة");
  const operationId = input.clientOperationId.trim();
  if (operationId.length < 12 || operationId.length > 100) throw new Error("تعذر التحقق من طلب التحويل؛ حاول مرة أخرى");

  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(externalTransferRequests)
      .where(eq(externalTransferRequests.clientOperationId, operationId)).limit(1);
    if (existing) return { duplicate: true, request: view(existing), message: "تم إرسال هذا الطلب من قبل، ويمكنك متابعة المحادثة مع الإدارة." };

    const reference = makeReference();
    const inserted = await tx.insert(externalTransferRequests).values({
      reference,
      clientOperationId: operationId,
      userId,
      countryCode: country.code,
      countryName: country.name,
      currencyName: country.currencyName,
      currencyCode: country.currencyCode,
      foreignAmount: foreignAmount.toFixed(2),
      exchangeRate: Number(pricing.rate).toFixed(6),
      egpEquivalent: egpEquivalent.toFixed(2),
      feeEgp: feeEgp.toFixed(2),
      pricingUpdatedAt: pricing.updatedAt ? new Date(pricing.updatedAt) : new Date(),
      status: "new",
    });
    const requestId = Number((inserted as any)?.[0]?.insertId ?? (inserted as any)?.insertId ?? 0);
    const [request] = await tx.select().from(externalTransferRequests).where(eq(externalTransferRequests.id, requestId)).limit(1);
    if (!request) throw new Error("تعذر حفظ طلب المعاملة الخارجية");

    const body = `مرحبًا، أريد تحويل أموال إلى حسابات خارج مصر.\nالدولة المستقبلة: ${country.name}.\nالمبلغ المطلوب: ${foreignAmount.toFixed(2)} ${country.currencyCode}.\nسعر الصرف المحسوب: 1 ${country.currencyCode} = ${Number(pricing.rate).toFixed(6)} جنيه مصري.\nالقيمة التقديرية: ${egpEquivalent.toFixed(2)} جنيه، الرسوم التقديرية: ${feeEgp.toFixed(2)} جنيه، الإجمالي التقديري: ${egpTotal.toFixed(2)} جنيه.\nوقت تحديث السعر: ${pricing.updatedAt ? new Date(pricing.updatedAt).toLocaleString("ar-EG") : "حسب آخر سعر إدارة"}.\nرقم الطلب: ${reference}.\nهذه قيمة تقديرية للطلب ولا يتم حجز أو خصم رصيد. يرجى مراجعة السعر والرسوم في المحادثة قبل أي تنفيذ خارجي.`;
    await tx.insert(supportMessages).values({ userId, category: "external_transaction", senderRole: "user", body });
    const admins = await tx.select({ id: users.id }).from(users).where(eq(users.role, "admin"));
    if (admins.length) {
      await tx.insert(notifications).values(admins.map((admin) => ({
        userId: admin.id,
        title: "طلب معاملة خارجية جديد",
        body: `وصل طلب جديد من المستخدم لتحويل أموال إلى ${country.name} بعملة ${country.currencyCode}. رقم الطلب: ${reference}`,
        type: "external_transfer_request",
        operationId: `external:${reference}:admin:${admin.id}`,
      })));
    }
    return { duplicate: false, request: view(request), message: "تم إرسال طلبك إلى الإدارة بنجاح. يرجى الانتظار حتى تتواصل معك الإدارة لاستكمال إجراءات التحويل" };
  });
}

export async function listAdminExternalTransferRequests(adminId: number) {
  const db = await requireAdministrator(adminId);
  const rows = await db.select({ request: externalTransferRequests, user: { name: users.name, customerId: users.customerId } })
    .from(externalTransferRequests).innerJoin(users, eq(users.id, externalTransferRequests.userId))
    .orderBy(desc(externalTransferRequests.createdAt)).limit(200);
  return rows.map((row) => view(row.request, row.user));
}

export async function updateExternalTransferStatus(adminId: number, requestId: number, status: ExternalTransferStatus, rejectionReason?: string) {
  const db = await requireAdministrator(adminId);
  const [request] = await db.select().from(externalTransferRequests).where(eq(externalTransferRequests.id, requestId)).limit(1);
  if (!request) throw new Error("طلب المعاملة الخارجية غير موجود");
  const reason = rejectionReason?.trim() || null;
  await db.update(externalTransferRequests).set({ status, rejectionReason: status === "rejected" ? reason || "تم رفض الطلب من الإدارة" : null, reviewedBy: adminId, reviewedAt: new Date() }).where(eq(externalTransferRequests.id, requestId));
  const statusText: Record<ExternalTransferStatus, string> = { new: "جديد", under_review: "قيد المراجعة", awaiting_details: "بانتظار استكمال البيانات", approved: "تمت الموافقة", completed: "مكتمل", rejected: "مرفوض" };
  await db.insert(notifications).values({ userId: request.userId, title: "تحديث طلب المعاملة الخارجية", body: `تم تحديث حالة طلبك رقم ${request.reference} إلى: ${statusText[status]}.${status === "rejected" && reason ? ` السبب: ${reason}` : ""}`, type: "external_transfer_request", operationId: `external:${request.reference}:status:${status}:${Date.now()}` });
  const [updated] = await db.select().from(externalTransferRequests).where(eq(externalTransferRequests.id, requestId)).limit(1);
  const [user] = await db.select({ name: users.name, customerId: users.customerId }).from(users).where(eq(users.id, request.userId)).limit(1);
  return view(updated, user);
}
