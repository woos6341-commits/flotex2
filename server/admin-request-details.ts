import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  accountVerifications, coinOrders, coinTransfers, externalTransferRequests, gameTopupRequests,
  goldOrders, guestSupportMessages, guestSupportTickets, moneyTransfers, phoneChangeRequests,
  phoneVerificationRequests, requests, savingsPlans, supportMessages, supportThreadStates, users,
} from "../drizzle/schema";
import { guestSupportAuditEvents } from "../drizzle/guest-support-schema";
import type { AdminRequestDetailsData, AdminRequestField, AdminRequestHistoryEntry, AdminRequestKind, AdminRequestReviewTarget, AdminRequestSelection } from "../shared/admin-request-details";
import { SUPPORT_CATEGORY_LABELS, type SupportCategory } from "../shared/support-categories";
import { requireAdministrator } from "./payment-settings";

const keyPattern = /^(payment|transfer|savings|game|external|gold|coin-order|coin-transfer|account-verification|phone-change|phone-verification|guest)-([1-9]\d*)$|^support-([1-9]\d*)-(account|freeze|external_transaction)$/;

export function parseAdminRequestKey(key: string): AdminRequestSelection | null {
  const match = keyPattern.exec(key);
  if (!match) return null;
  const id = Number(match[2] ?? match[3]);
  if (!Number.isSafeInteger(id) || id > 2147483647) return null;
  return match[3]
    ? { kind: "support", id, category: match[4] as SupportCategory }
    : { kind: match[1] as AdminRequestKind, id };
}

/** Use this schema on an adminProcedure, with Cache-Control: private, no-store. */
export const adminRequestDetailsInputSchema = z.object({
  key: z.string().max(100).refine((key) => parseAdminRequestKey(key) !== null, "معرّف الطلب غير صالح"),
}).strict();

const secretPattern = /password|passcode|secret|token|credential|otp|\bpin\b|cvv|cvc|private.?key|verification.?code|withdrawal.?code|كلمة\s*(?:السر|المرور)|رقم\s*سري|رمز\s*(?:التحقق|السحب|الأمان)|كود\s*(?:التحقق|السحب)|البطاقة\s*الائتمانية|الرقم\s*القومي|هوية|هوية وطنية|بطاقة شخصية/i;
/** Unstructured input can contain secrets; hide a whole suspicious value, not just a label. */
export function safeRequestText(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const text = value.trim();
  if (secretPattern.test(text) || /(?:^|\s)[A-Za-z0-9_+\/-]{32,}={0,2}(?:\s|$)/.test(text)) return "محجوب لحماية البيانات الحساسة";
  // Never expose complete national IDs or long account numbers, including Arabic digits.
  return text.replace(/(?<![\d\u0660-\u0669\u06f0-\u06f9])(?:[\d\u0660-\u0669\u06f0-\u06f9][ -]?){13,}/g, "[رقم طويل محجوب]").slice(0, 2000);
}

export function maskPhone(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const digits = value.replace(/\D/g, "");
  return digits.length > 4 ? `••••${digits.slice(-4)}` : "محجوب";
}

/** Dynamic fields have administrator-supplied labels and may contain arbitrary credentials. */
export function maskedDynamicFields(raw: unknown, variant: "payment" | "game"): AdminRequestField[] {
  if (typeof raw !== "string" || !raw) return [];
  try {
    const data: unknown = JSON.parse(raw);
    if (variant === "payment" && data && typeof data === "object" && !Array.isArray(data)) {
      const { values, labels } = data as { values?: unknown; labels?: unknown };
      if (!values || typeof values !== "object" || Array.isArray(values)) return [];
      const safeLabels = labels && typeof labels === "object" && !Array.isArray(labels) ? labels as Record<string, unknown> : {};
      return Object.entries(values).slice(0, 8).filter(([, value]) => typeof value === "string" && value.trim()).map(([key], index) => ({ label: safeRequestText(safeLabels[key]) || `حقل إضافي ${index + 1}`, value: "محجوب؛ راجع الحقل في شاشة الخدمة المختصة عند الحاجة" }));
    }
    if (variant === "game" && Array.isArray(data)) {
      return data.slice(0, 8).filter((item) => item && typeof item === "object" && typeof item.value === "string" && item.value.trim()).map((item, index) => {
        // Only well-known player identifiers/names, and never a secret-labelled field.
        const key = String(item.key ?? "");
        const label = safeRequestText(item.label) || `حقل لاعب ${index + 1}`;
        const permitted = ["playerId", "playerName", "userId"].includes(key) && !secretPattern.test(String(item.label ?? ""));
        return { label, value: permitted ? safeRequestText(item.value) || "غير متاح" : "محجوب؛ راجع شاشة الخدمة المختصة عند الحاجة" };
      });
    }
  } catch { /* An invalid legacy snapshot must not expose raw data. */ }
  return [];
}

function date(value: unknown): string | null {
  if (!(value instanceof Date) && typeof value !== "string") return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
function add(fields: AdminRequestField[], label: string, value: unknown) {
  const text = typeof value === "number" ? String(value) : safeRequestText(value);
  if (text) fields.push({ label, value: text });
}
function numeric(value: unknown): string | null { return typeof value === "string" || typeof value === "number" ? String(value) : null; }

// Only these explicit columns are ever selected. Never serialize an entire database row.
const definitions = {
  payment: { table: requests, user: requests.userId, section: "requests", tab: "payments", columns: { reference: requests.reference, type: requests.type, amount: requests.amount, currency: requests.currency, status: requests.status, createdAt: requests.createdAt, reviewedAt: requests.reviewedAt, reviewedBy: requests.reviewedBy, rejectionReason: requests.rejectionReason, fee: requests.feeAmount, paymentChannel: requests.paymentChannel, senderReference: requests.senderReference, submittedReference: requests.submittedTransferReference, destination: requests.destination, note: requests.note, custom: requests.customFields, hasReceipt: sql<number>`${requests.receiptImageUrl} IS NOT NULL` } },
  transfer: { table: moneyTransfers, user: moneyTransfers.senderUserId, section: "requests", tab: "transfers", columns: { reference: moneyTransfers.reference, amount: moneyTransfers.amount, currency: moneyTransfers.currency, status: moneyTransfers.status, createdAt: moneyTransfers.createdAt, reviewedAt: moneyTransfers.reviewedAt, reviewedBy: moneyTransfers.reviewedBy, rejectionReason: moneyTransfers.rejectionReason, fee: moneyTransfers.feeAmount, note: moneyTransfers.note, recipientUserId: moneyTransfers.recipientUserId, cancelledAt: moneyTransfers.cancelledAt } },
  savings: { table: savingsPlans, user: savingsPlans.userId, section: "savings", columns: { reference: savingsPlans.reference, amount: savingsPlans.principalAmount, currency: savingsPlans.currency, status: savingsPlans.status, createdAt: savingsPlans.createdAt, reviewedAt: savingsPlans.approvedAt, reviewedBy: savingsPlans.approvedBy, rejectionReason: savingsPlans.rejectionReason, frequency: savingsPlans.frequency, rate: savingsPlans.ratePercent, fee: savingsPlans.feeAmount, cancelledAt: savingsPlans.cancelledAt, refundedAt: savingsPlans.refundedAt } },
  game: { table: gameTopupRequests, user: gameTopupRequests.userId, section: "gameTopup", columns: { reference: gameTopupRequests.reference, type: gameTopupRequests.kind, amount: gameTopupRequests.totalAmount, status: gameTopupRequests.status, createdAt: gameTopupRequests.createdAt, reviewedAt: gameTopupRequests.reviewedAt, reviewedBy: gameTopupRequests.reviewedBy, rejectionReason: gameTopupRequests.rejectionReason, game: gameTopupRequests.gameName, package: gameTopupRequests.packageLabel, quantity: gameTopupRequests.quantity, unitPrice: gameTopupRequests.unitPrice, subtotal: gameTopupRequests.subtotalAmount, fee: gameTopupRequests.feeAmount, city: gameTopupRequests.city, street: gameTopupRequests.street, custom: gameTopupRequests.playerDataJson, adminNote: gameTopupRequests.adminNote, providerReference: gameTopupRequests.providerReference, completedAt: gameTopupRequests.completedAt } },
  external: { table: externalTransferRequests, user: externalTransferRequests.userId, section: "externalTransfers", columns: { reference: externalTransferRequests.reference, amount: externalTransferRequests.foreignAmount, currency: externalTransferRequests.currencyCode, status: externalTransferRequests.status, createdAt: externalTransferRequests.createdAt, reviewedAt: externalTransferRequests.reviewedAt, reviewedBy: externalTransferRequests.reviewedBy, rejectionReason: externalTransferRequests.rejectionReason, country: externalTransferRequests.countryName, currencyName: externalTransferRequests.currencyName, exchangeRate: externalTransferRequests.exchangeRate, egpEquivalent: externalTransferRequests.egpEquivalent, fee: externalTransferRequests.feeEgp } },
  gold: { table: goldOrders, user: goldOrders.userId, section: "gold", columns: { reference: goldOrders.reference, type: goldOrders.side, amount: goldOrders.grossAmount, status: goldOrders.status, createdAt: goldOrders.createdAt, reviewedAt: goldOrders.reviewedAt, reviewedBy: goldOrders.reviewedBy, rejectionReason: goldOrders.rejectionReason, karat: goldOrders.karat, grams: goldOrders.grams, unitPrice: goldOrders.unitPrice, fee: goldOrders.feeAmount, provider: goldOrders.executionProvider } },
  "coin-order": { table: coinOrders, user: coinOrders.userId, section: "coin", columns: { reference: coinOrders.reference, type: coinOrders.side, amount: coinOrders.totalAmount, status: coinOrders.status, createdAt: coinOrders.createdAt, reviewedAt: coinOrders.reviewedAt, reviewedBy: coinOrders.reviewedBy, rejectionReason: coinOrders.rejectionReason, quantity: coinOrders.quantity, unitPrice: coinOrders.unitPrice, subtotal: coinOrders.grossAmount, fee: coinOrders.feeAmount } },
  "coin-transfer": { table: coinTransfers, user: coinTransfers.senderUserId, section: "coin", columns: { reference: coinTransfers.reference, amount: coinTransfers.quantity, status: coinTransfers.status, createdAt: coinTransfers.createdAt, reviewedAt: coinTransfers.reviewedAt, reviewedBy: coinTransfers.reviewedBy, rejectionReason: coinTransfers.rejectionReason, recipientUserId: coinTransfers.recipientUserId } },
  "account-verification": { table: accountVerifications, user: accountVerifications.userId, section: "accountVerification", columns: { status: accountVerifications.status, createdAt: accountVerifications.submittedAt, reviewedAt: accountVerifications.reviewedAt, reviewedBy: accountVerifications.reviewedBy, rejectionReason: accountVerifications.rejectionReason, nameSnapshot: accountVerifications.nameSnapshot, nationalIdLast4: accountVerifications.nationalIdLast4, phone: accountVerifications.phoneNumberSnapshot, verificationMethod: accountVerifications.verificationMethod } },
  "phone-change": { table: phoneChangeRequests, user: phoneChangeRequests.userId, section: "phoneChange", columns: { status: phoneChangeRequests.status, createdAt: phoneChangeRequests.createdAt, reviewedAt: phoneChangeRequests.reviewedAt, reviewedBy: phoneChangeRequests.reviewedBy, rejectionReason: phoneChangeRequests.rejectionReason, phone: phoneChangeRequests.newPhoneNumber } },
  "phone-verification": { table: phoneVerificationRequests, user: phoneVerificationRequests.userId, section: "phoneVerification", columns: { status: phoneVerificationRequests.status, createdAt: phoneVerificationRequests.createdAt, reviewedAt: phoneVerificationRequests.reviewedAt, reviewedBy: phoneVerificationRequests.reviewedBy, phone: phoneVerificationRequests.phoneNumber, message: phoneVerificationRequests.message, reviewNote: phoneVerificationRequests.reviewNote } },
} as const;

type SourceKind = keyof typeof definitions;
const titles: Record<SourceKind, string> = { payment: "طلب دفع", transfer: "تحويل أموال", savings: "طلب ادخار", game: "طلب ألعاب", external: "معاملة خارجية", gold: "طلب ذهب", "coin-order": "طلب كوين", "coin-transfer": "تحويل كوين", "account-verification": "توثيق حساب", "phone-change": "تغيير رقم الهاتف", "phone-verification": "توثيق رقم الهاتف" };
const syntheticReferences: Partial<Record<SourceKind, string>> = { "account-verification": "AV", "phone-change": "PHC", "phone-verification": "PHV" };

async function person(db: any, id: number | null | undefined) {
  if (!id) return null;
  const [row] = await db.select({ name: users.name, customerId: users.customerId }).from(users).where(eq(users.id, id)).limit(1);
  return row ?? null;
}
async function actor(db: any, id: number | null | undefined) {
  if (!id) return null;
  const [row] = await db.select({ name: users.name, role: users.role }).from(users).where(eq(users.id, id)).limit(1);
  return row?.role === "admin" ? safeRequestText(row.name) || "موظف الإدارة" : "اسم الموظف غير متاح";
}

async function loadSource(db: any, key: string, selected: AdminRequestSelection): Promise<AdminRequestDetailsData> {
  const kind = selected.kind as SourceKind;
  const def = definitions[kind];
  if (!def) throw new Error("نوع الطلب غير مدعوم");
  const [row] = await db.select({ ...def.columns, userId: def.user }).from(def.table).where(eq(def.table.id, selected.id)).limit(1);
  if (!row) throw new Error("الطلب غير موجود لهذا النوع");
  const [customer, reviewer, recipient] = await Promise.all([person(db, row.userId), actor(db, row.reviewedBy), person(db, row.recipientUserId)]);
  const reference = syntheticReferences[kind] ? `${syntheticReferences[kind]}-${selected.id}` : row.reference;
  const title = kind === "payment" ? (row.type === "deposit" ? "إيداع" : "سحب") : kind === "game" ? (row.type === "deposit" ? "إيداع ألعاب" : row.type === "withdraw" ? "سحب ألعاب" : "شحن ألعاب") : kind === "gold" || kind === "coin-order" ? `${row.type === "buy" ? "شراء" : "بيع"} ${kind === "gold" ? "ذهب" : "كوين"}` : titles[kind];
  const fields: AdminRequestField[] = [];
  add(fields, "وسيلة الدفع", row.paymentChannel); add(fields, "مرجع التحويل المقدم", row.submittedReference);
  add(fields, "رقم المرسل (محجوب جزئيًا)", maskPhone(row.senderReference)); add(fields, "الوجهة (محجوبة جزئيًا)", maskPhone(row.destination));
  add(fields, "ملاحظة المستخدم", row.note); add(fields, "الرسوم", row.fee);
  add(fields, "المستلم", recipient?.name); add(fields, "معرّف المستلم", recipient?.customerId);
  add(fields, "دورية الادخار", row.frequency); add(fields, "معدل الادخار %", row.rate);
  add(fields, "اللعبة", row.game); add(fields, "الباقة", row.package); add(fields, "الكمية", row.quantity);
  add(fields, "سعر الوحدة", row.unitPrice); add(fields, "المبلغ قبل الرسوم", row.subtotal);
  add(fields, "المدينة", row.city); add(fields, "الشارع", row.street);
  add(fields, "الدولة", row.country); add(fields, "العملة", row.currencyName); add(fields, "سعر الصرف", row.exchangeRate); add(fields, "المعادل بالجنيه", row.egpEquivalent);
  add(fields, "العيار", row.karat); add(fields, "الوزن بالجرام", row.grams); add(fields, "جهة التنفيذ", row.provider);
  add(fields, "الاسم المقدم", row.nameSnapshot); add(fields, "آخر أربعة أرقام من الهوية", row.nationalIdLast4 ? `••••${row.nationalIdLast4}` : null);
  add(fields, "الهاتف (محجوب جزئيًا)", maskPhone(row.phone)); add(fields, "رسالة المستخدم", row.message);
  add(fields, "ملاحظة الإدارة", row.adminNote ?? row.reviewNote); add(fields, "مرجع المزود", row.providerReference);
  if (kind === "payment" || kind === "game") fields.push(...maskedDynamicFields(row.custom, kind));
  const attachments: AdminRequestDetailsData["attachments"] = [];
  if (kind === "payment" && Number(row.hasReceipt) === 1) attachments.push({ label: "إيصال التحويل", access: "payment-receipt" });
  if (kind === "account-verification" || kind === "phone-change") attachments.push({ label: "مستندات التحقق: متاحة من شاشة المراجعة المحمية", access: "specialist" });
  const history: AdminRequestHistoryEntry[] = [{ label: "إنشاء الطلب", at: date(row.createdAt), actor: null }];
  if (row.reviewedAt || row.reviewedBy) history.push({ label: "آخر مراجعة مسجلة", at: date(row.reviewedAt), actor: reviewer, detail: safeRequestText(row.rejectionReason) ?? undefined });
  if (row.cancelledAt) history.push({ label: "إلغاء", at: date(row.cancelledAt), actor: null });
  if (row.refundedAt) history.push({ label: "استرداد", at: date(row.refundedAt), actor: null });
  if (row.completedAt) history.push({ label: "اكتمال", at: date(row.completedAt), actor: null });
  const limitations = ["يعرض السجل الإنشاء وآخر مراجعة والأحداث المؤرخة المتاحة فقط؛ لا يتوفر سجل تدقيق كامل لكل انتقال.", "تُخفى البيانات الحساسة والحقول الحرة غير المصنفة أمنيًا؛ تعرض شاشة الخدمة المختصة مزيدًا من البيانات المصرح بها."];
  if (kind === "game" && row.type === "withdraw") limitations.push("كود السحب السري لا يُعرض في ملخص التفاصيل.");
  if (kind === "account-verification") limitations.push("نموذج توثيق الحساب يمثل السجل الحالي وقد تُستبدل بياناته عند إعادة التقديم.");
  const review: AdminRequestReviewTarget = { section: def.section, key, id: selected.id, reference, userId: row.userId, ...("tab" in def ? { tab: def.tab } : {}) };
  return { key, reference, title, customerName: safeRequestText(customer?.name) || "مستخدم", customerId: customer?.customerId ?? null, status: row.status, createdAt: date(row.createdAt), amount: numeric(row.amount), currency: row.currency ?? (kind === "coin-transfer" ? "COIN" : ["game", "gold", "coin-order"].includes(kind) ? "EGP" : null), fields, attachments, history, limitations, review };
}

async function loadConversation(db: any, key: string, selected: AdminRequestSelection): Promise<AdminRequestDetailsData> {
  const guest = selected.kind === "guest";
  let reference: string, name: string, customerId: string | null, status: string, createdAt: string | null, closedAt: string | null, closedBy: number | null = null;
  let messages: any[];
  let audits: any[] = [];
  if (guest) {
    const [ticket] = await db.select({ reference: guestSupportTickets.ticketCode, name: guestSupportTickets.displayName, status: guestSupportTickets.status, createdAt: guestSupportTickets.createdAt, closedAt: guestSupportTickets.closedAt }).from(guestSupportTickets).where(eq(guestSupportTickets.id, selected.id)).limit(1);
    if (!ticket) throw new Error("تذكرة الزائر غير موجودة");
    ({ reference, name, status } = ticket); customerId = null; createdAt = date(ticket.createdAt); closedAt = date(ticket.closedAt);
    [messages, audits] = await Promise.all([
      db.select({ senderRole: guestSupportMessages.senderRole, body: guestSupportMessages.body, attachmentType: guestSupportMessages.attachmentMimeType, createdAt: guestSupportMessages.createdAt, adminId: guestSupportMessages.adminId }).from(guestSupportMessages).where(eq(guestSupportMessages.ticketId, selected.id)).orderBy(asc(guestSupportMessages.createdAt), asc(guestSupportMessages.id)).limit(101),
      db.select({ action: guestSupportAuditEvents.action, status: guestSupportAuditEvents.newStatus, createdAt: guestSupportAuditEvents.createdAt, adminId: guestSupportAuditEvents.adminId }).from(guestSupportAuditEvents).where(eq(guestSupportAuditEvents.ticketId, selected.id)).orderBy(asc(guestSupportAuditEvents.createdAt), asc(guestSupportAuditEvents.id)).limit(101),
    ]);
  } else {
    const category = selected.category!;
    const [customer, thread, rows] = await Promise.all([
      person(db, selected.id),
      db.select({ status: supportThreadStates.status, closedAt: supportThreadStates.closedAt, closedBy: supportThreadStates.closedBy }).from(supportThreadStates).where(and(eq(supportThreadStates.userId, selected.id), eq(supportThreadStates.category, category))).limit(1),
      db.select({ senderRole: supportMessages.senderRole, body: supportMessages.body, attachmentType: supportMessages.attachmentMimeType, createdAt: supportMessages.createdAt, adminId: supportMessages.adminId }).from(supportMessages).where(and(eq(supportMessages.userId, selected.id), eq(supportMessages.category, category))).orderBy(asc(supportMessages.createdAt), asc(supportMessages.id)).limit(101),
    ]);
    if (!customer || !rows.length) throw new Error("المحادثة غير موجودة لهذا المستخدم والموضوع");
    reference = `support-${selected.id}-${category}`; name = customer.name || "مستخدم"; customerId = customer.customerId; status = thread[0]?.status ?? "open"; createdAt = date(rows[0].createdAt); closedAt = date(thread[0]?.closedAt); closedBy = thread[0]?.closedBy ?? null; messages = rows;
  }
  const actorIds = [...new Set([...messages.map((m) => m.adminId), ...audits.map((a) => a.adminId), closedBy].filter((id): id is number => typeof id === "number" && id > 0))];
  const names = new Map<number, string | null>(await Promise.all(actorIds.map(async (id) => [id, await actor(db, id)] as const)));
  const history: AdminRequestHistoryEntry[] = [{ label: "بدء المحادثة", at: createdAt, actor: null }];
  const attachments: AdminRequestDetailsData["attachments"] = [];
  for (const message of messages.slice(0, 100)) {
    history.push({ label: message.senderRole === "admin" ? "رد الإدارة" : guest ? "رسالة الزائر" : "رسالة المستخدم", at: date(message.createdAt), actor: message.senderRole === "admin" ? names.get(message.adminId) ?? "موظف الإدارة" : null, detail: safeRequestText(message.body) ?? undefined });
    if (message.attachmentType) attachments.push({ label: `مرفق رسالة بتاريخ ${date(message.createdAt) ?? "غير متاح"}؛ يعرض في المحادثة المحمية`, access: "specialist" });
  }
  for (const entry of audits.slice(0, 100)) if (entry.action === "status_change") history.push({ label: `تغيير حالة المحادثة: ${entry.status}`, at: date(entry.createdAt), actor: names.get(entry.adminId) ?? "موظف الإدارة" });
  if (!guest && closedAt) history.push({ label: "إغلاق المحادثة", at: closedAt, actor: names.get(closedBy ?? 0) ?? null });
  if (guest && status === "closed" && closedAt && !audits.slice(0, 100).some((entry) => entry.action === "status_change" && entry.status === "closed" && date(entry.createdAt) === closedAt)) history.push({ label: "إغلاق المحادثة", at: closedAt, actor: null });
  history.sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""));
  const review: AdminRequestReviewTarget = { section: guest ? "guestSupport" : "supportMessaging", key, id: selected.id, reference, ...(guest ? { guestTicketId: selected.id } : { userId: selected.id, category: selected.category }) };
  const limitations = ["تُعرض الرسائل والأحداث المتاحة فقط؛ لا يعني الرد إغلاق المحادثة.", "تُفتح صور المحادثة من الشاشة المحمية، ولا تتضمن التفاصيل بيانات تخزين المرفقات.", "قد تُحجب النصوص التي تبدو حساسة."];
  if (messages.length > 100 || audits.length > 100) limitations.push("يعرض هذا الملخص أول 100 رسالة أو حدث كحد أقصى؛ افتح شاشة المحادثة للمتابعة.");
  return { key, reference, title: guest ? "محادثة زائر" : SUPPORT_CATEGORY_LABELS[selected.category!], customerName: safeRequestText(name) || "زائر", customerId, status, createdAt, amount: null, currency: null, fields: [], attachments, history, limitations, review };
}

/** Read-only; authorization is enforced here as well as by the integrating adminProcedure. */
export async function getAdminRequestDetails(adminId: number, input: z.infer<typeof adminRequestDetailsInputSchema>): Promise<AdminRequestDetailsData> {
  const { key } = adminRequestDetailsInputSchema.parse(input);
  const selected = parseAdminRequestKey(key)!;
  const db = await requireAdministrator(adminId);
  return selected.kind === "support" || selected.kind === "guest" ? loadConversation(db, key, selected) : loadSource(db, key, selected);
}
