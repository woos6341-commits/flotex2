import { useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ActivityIndicator, FlatList, Image, Modal, Platform, Pressable, Share, Switch, Text, TextInput, View } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { ActionButton, Pill, formatMoney } from "@/components/atheer-ui";
import { VerifiedName } from "@/components/VerifiedName";
import { TransactionRow } from "@/components/TransactionRow";
import { trpc } from "@/lib/trpc";
import { confirmFinancialAction, showFinancialMessage } from "@/lib/financial-feedback";
import { formatMoneyMinorUnits, parseMoneyMinorUnits } from "@/shared/transactions";
import { EGYPTIAN_GOVERNORATES } from "@/shared/registration";
import { formatCoinQuantity } from "@/shared/coin";
import { formatEgyptDateTime } from "@/shared/ui-button-visibility";
import { CustomerUiSettings } from "./CustomerUiSettings";
import type { getAdminCustomerCoinDetails } from "@/server/coin";
import { InvoiceCapture, captureInvoiceRef } from "./InvoiceCapture";
import { saveInvoiceToLibrary } from "./InvoiceMediaLibrary";

type Customer = {
  id: number;
  customerId?: string | null;
  name?: string | null;
  email?: string | null;
  givenName?: string | null;
  fatherName?: string | null;
  phoneNumber?: string | null;
  birthDate?: string | null;
  governorate?: string | null;
  nationalIdMasked?: string | null;
  accountFrozen?: boolean;
  status?: "active" | "deleted";
  deletedAt?: string | Date | null;
  verificationStatus?: string;
  role?: string | null;
};

type Page<T> = { items: T[]; total: number; offset: number; limit: number; hasMore: boolean };
type DetailUser = {
  id: number; customerId: string; name: string | null; email: string | null; givenName: string | null; fatherName: string | null;
  phoneNumber: string | null; birthDate: string | null; governorate: string | null; role: string; status: "active" | "deleted"; deletedAt: string | Date | null; createdAt: string | Date; lastOpenedAt: string | Date | null; appVersion: string | null; appBuildNumber: string | null; nationalIdMasked: string | null;
  verificationStatus: string; verificationSource: string; verificationReason: string | null; verificationSubmittedAt: string | Date | null;
  verificationReviewedAt: string | Date | null; verificationReviewedBy: number | null;
};
type MoneySummary = { count: number; amount: string };
type Details = {
  user: DetailUser;
  wallet: { balance: string; reservedWithdrawals: string; reservedOrders: string; reservedTransfers: string; reservedSavings: string; reservedTotal: string; currency: string; updatedAt: string | Date } | null;
  available: string;
  summary: {
    deposits: MoneySummary; withdrawals: MoneySummary;
    savings: { requestCount: number; requestedPrincipal: string; activePrincipal: string; completedPrincipal: string; paidProfits: string; paidProfitCount: number; cancelledCount: number; rejectedCount: number };
    transfers: { sentCount: number; sentAmount: string; receivedCount: number; receivedAmount: string };
  };
  history: Page<{ id: number; [key: string]: unknown }>;
  requests: Page<{ id: number; type: string; status: string; amount: string; feeAmount?: string; currency?: string; paymentChannel?: string | null; destination?: string | null; transferReference?: string | null; payoutReference?: string | null; reviewedBy?: number | null; note?: string | null; reviewedAt?: string | Date | null; reference: string; createdAt: string | Date; hasReceipt: boolean; rejectionReason: string | null }>;
  transfers: Page<{ id: number; direction: string; status: string; amount: string; reference: string; createdAt: string | Date; counterparty: { id: number; name: string | null; customerId: string | null } | null; note: string | null; rejectionReason: string | null }>;
  savingsPlans: Page<{ id: number; status: string; amount?: string; principalAmount: string; reference: string; frequency: string; totalAccrued: string; totalPaid: string; createdAt: string | Date; rejectionReason: string | null }>;
  payouts: Page<{ id: number; planId: number; planReference: string | null; frequency: string | null; periodKey: string; periodStart: string | Date; periodEnd: string | Date; expectedAmount: string; paidAmount: string; status: string; blockReason: string | null; transactionReference: string | null; createdAt: string | Date; paidAt: string | Date | null }>;
  audits: Page<{ id: number; adminId: number; changes: string; createdAt: string | Date; admin: { id: number; name: string | null; email: string | null } | null }>;
  coin?: Awaited<ReturnType<typeof getAdminCustomerCoinDetails>>;
};
type EditableField = "fullName" | "givenName" | "fatherName" | "email" | "phoneNumber" | "birthDate" | "governorate" | "nationalId";

const fieldLabels: Record<EditableField, string> = {
  fullName: "الاسم الكامل",
  givenName: "الاسم الأول",
  fatherName: "اسم الأب",
  email: "البريد الإلكتروني",
  phoneNumber: "رقم الهاتف",
  birthDate: "تاريخ الميلاد",
  governorate: "المحافظة",
  nationalId: "الرقم القومي المصري",
};

function dateLabel(value: string | Date | null | undefined) {
  if (!value) return "غير مسجل";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("ar-EG");
}

function verificationLabel(value: string | undefined) {
  switch (value) {
    case "approved": return "موثّق";
    case "pending": return "قيد المراجعة";
    case "rejected": return "مرفوض — يمكن إعادة التقديم";
    default: return "غير موثّق";
  }
}

function savingsStatus(value: string) {
  const labels: Record<string, string> = {
    pending_approval: "قيد الموافقة",
    active: "نشطة",
    rejected: "مرفوضة",
    completed: "مكتملة",
    refunded: "مستردة",
    cancelled: "ملغاة",
    paid: "مصروفة",
    blocked: "متوقفة",
  };
  return labels[value] ?? value;
}

function EditableRow({ label, value, onEdit }: { label: string; value: string; onEdit: () => void }) {
  return <View className="flex-row items-center justify-between border-b border-[#273548] py-2">
    <Pressable onPress={onEdit} accessibilityRole="button" accessibilityLabel={`تعديل ${label}`} className="rounded-lg border border-[#5C4A28] px-2 py-1">
      <Text className="text-[11px] font-semibold text-[#D7A948]">تعديل</Text>
    </Pressable>
    <View className="flex-1 pl-3">
      <Text className="text-[10px] text-[#9BA8B8]" style={{ textAlign: "right" }}>{label}</Text>
      <Text selectable className="mt-1 text-sm font-semibold text-[#F7F1E3]" style={{ textAlign: "right", writingDirection: /email|هاتف|قومي|ميلاد/.test(label) ? "ltr" : "rtl" }}>{value || "غير مسجل"}</Text>
    </View>
  </View>;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <View className="mt-4 rounded-2xl border border-[#273548] bg-[#0B1018] p-3">
    <Text className="mb-2 text-right text-sm font-bold text-[#D7A948]">{title}</Text>
    {children}
  </View>;
}

function Line({ label, value }: { label: string; value: ReactNode }) {
  return <View className="flex-row items-center justify-between border-b border-[#273548] py-2">
    <Text className="max-w-[70%] text-left text-xs font-semibold text-[#F7F1E3]" style={{ writingDirection: "auto" }}>{value}</Text>
    <Text className="max-w-[45%] text-right text-[10px] text-[#9BA8B8]">{label}</Text>
  </View>;
}

function nextOffset(data: Details | undefined) {
  if (!data) return false;
  return data.history.hasMore || data.requests.hasMore || data.transfers.hasMore || data.savingsPlans.hasMore || data.payouts.hasMore || data.audits.hasMore || Boolean(data.coin?.orders.hasMore || data.coin?.transfers.hasMore || data.coin?.ledger.hasMore);
}

export function CustomerDossier({ customer }: { customer: Customer }) {
  const utils = trpc.useUtils();
  const [offset, setOffset] = useState(0);
  const pageSize = 15;
  const details = trpc.admin.customerDetails.useQuery({ userId: customer.id, offset, limit: pageSize }, { staleTime: 0, refetchOnWindowFocus: true, retry: false });
  const methods = trpc.admin.paymentMethodsAdmin.useQuery();
  const access = trpc.admin.customerPaymentMethodAccess.useQuery({ userId: customer.id });
  const statusEvents = trpc.admin.customerAccountStatusEvents.useQuery({ userId: customer.id });
  const securityPinStatus = trpc.admin.securityPinStatus.useQuery({ userId: customer.id });
  const customerSessions = trpc.admin.customerSessions.useQuery({ userId: customer.id }, { refetchInterval: 15000 });
  const [editing, setEditing] = useState<EditableField | null>(null);
  const [draft, setDraft] = useState("");
  const [nationalIdVisible, setNationalIdVisible] = useState(false);
  const [governoratesOpen, setGovernoratesOpen] = useState(false);
  const [documentsVisible, setDocumentsVisible] = useState(false);
  const [verificationReason, setVerificationReason] = useState("");
  const [restoreReason, setRestoreReason] = useState("");
  const [amount, setAmount] = useState("");
  const [adjustmentReason, setAdjustmentReason] = useState("");
  const [operationId, setOperationId] = useState(() => `ATH-ADJ-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
  const [coinQuantity, setCoinQuantity] = useState("");
  const [coinReason, setCoinReason] = useState("");
  const [coinOperationId, setCoinOperationId] = useState(() => `ATH-COIN-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
  const [invoiceVisible, setInvoiceVisible] = useState(false);
  const [invoiceFeedback, setInvoiceFeedback] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [emailFeedback, setEmailFeedback] = useState("");
  const invoiceRef = useRef<any>(null);
  const invoiceQuery = trpc.admin.customerInvoice.useQuery({ userId: customer.id }, { enabled: false, retry: false });
  const emailHistory = trpc.admin.emailDeliveryHistory.useQuery({ userId: customer.id }, { enabled: true, retry: false });
  const sendEmail = trpc.admin.sendCustomerEmail.useMutation();

  const nationalId = trpc.admin.customerNationalId.useMutation({
    onError: (error) => showFinancialMessage("تعذر عرض الرقم القومي", error.message),
  });
  const documents = trpc.admin.accountVerificationDocuments.useQuery({ userId: customer.id }, { enabled: false, retry: false, staleTime: 0 });
  const updateProfile = trpc.admin.updateCustomerProfile.useMutation({
    onSuccess: async (result) => {
      setEditing(null);
      setDraft("");
      setNationalIdVisible(false);
      nationalId.reset();
      await Promise.all([utils.admin.customers.invalidate(), utils.admin.customerDetails.invalidate(), utils.admin.customerProfileAudits.invalidate()]);
      showFinancialMessage(
        result.nationalIdChanged ? "تم تحديث الرقم القومي وإلغاء التوثيق السابق" : "تم حفظ بيانات العميل",
        result.nationalIdChanged ? "يحتاج العميل إلى تقديم مستندات هوية جديدة للمراجعة." : "سُجل التعديل باسم المدير ووقته دون المساس بالرصيد أو رقم المستخدم ID.",
      );
    },
    onError: (error) => showFinancialMessage("تعذر تعديل بيانات العميل", error.message),
  });
  const verification = trpc.admin.setCustomerAccountVerification.useMutation({
    onSuccess: async (result) => {
      setVerificationReason("");
      await Promise.all([utils.admin.customers.invalidate(), utils.admin.customerDetails.invalidate(), utils.admin.customerProfileAudits.invalidate()]);
      showFinancialMessage(result.status === "approved" ? "تم توثيق الحساب" : "أُلغي توثيق الحساب", "حُفظ القرار في سجل العميل، وستتحدّث حالة الملف من الخادم.");
    },
    onError: (error) => showFinancialMessage("تعذر تغيير حالة التوثيق", error.message),
  });
  const accountStatus = trpc.admin.setCustomerAccountFrozen.useMutation({
    onSuccess: async (result) => {
      await Promise.all([utils.admin.customers.invalidate(), utils.admin.customerDetails.invalidate(), utils.admin.customerProfileAudits.invalidate()]);
      showFinancialMessage(result.frozen ? "تم تجميد الحساب" : "أُعيد تفعيل الحساب", "حُفظ التغيير في سجل الملف الإداري.");
    },
    onError: (error) => showFinancialMessage("تعذر تحديث حالة الحساب", error.message),
  });
  const methodDirection = trpc.admin.setCustomerPaymentMethodDirection.useMutation({
    onSuccess: async () => { await utils.admin.customerPaymentMethodAccess.invalidate({ userId: customer.id }); showFinancialMessage("تم تحديث اتجاه وسيلة الدفع", "حُفظ إعداد الإيداع/السحب بصورة مستقلة لهذا العميل."); },
    onError: (error) => showFinancialMessage("تعذر تحديث اتجاه وسيلة الدفع", error.message),
  });
  const restoreAccount = trpc.admin.restoreDeletedCustomerAccount.useMutation({
    onSuccess: async () => { setRestoreReason(""); await Promise.all([utils.admin.customers.invalidate(), utils.admin.customerDetails.invalidate(), utils.admin.customerAccountStatusEvents.invalidate({ userId: customer.id })]); showFinancialMessage("تمت استعادة الحساب", "يمكن للعميل تسجيل الدخول مجددًا. إذا كان الحساب مجمّدًا إداريًا فستظل حالة التجميد قائمة إلى أن تُرفع صراحةً."); },
    onError: (error) => showFinancialMessage("تعذرت استعادة الحساب", error.message),
  });
  const adjust = trpc.admin.adjustBalance.useMutation({
    onSuccess: async (result) => {
      setOperationId(`ATH-ADJ-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
      setAmount("");
      setAdjustmentReason("");
      await Promise.all([utils.admin.customerDetails.invalidate(), utils.admin.customers.invalidate(), utils.admin.stats.invalidate(), utils.portfolio.get.invalidate(), utils.portfolio.transactions.invalidate()]);
      showFinancialMessage(result.direction === "credit" ? "تمت إضافة الرصيد للعميل" : "تم خصم الرصيد", "تم حفظ العملية وسجلها الإداري.");
    },
    onError: (error) => showFinancialMessage("تعذر تعديل الرصيد", error.message),
  });
  const adjustCoin = trpc.admin.adjustUserCoinBalance.useMutation({
    onSuccess: async (result) => {
      setCoinQuantity("");
      setCoinReason("");
      setCoinOperationId(`ATH-COIN-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
      await Promise.all([utils.admin.customerDetails.invalidate(), utils.admin.coinDashboard.invalidate()]);
      showFinancialMessage(result.direction === "credit" ? "تمت إضافة الكوين" : "تم خصم الكوين", "تم تسجيل الحركة وإرسال إشعار للعميل.");
    },
    onError: (error) => showFinancialMessage("تعذر تعديل رصيد الكوين", error.message),
  });

  const createInvoice = async () => {
    setInvoiceFeedback("");
    try {
      const result = await invoiceQuery.refetch();
      if (result.error || !result.data) throw result.error ?? new Error("empty_invoice");
      setInvoiceVisible(true);
    } catch { setInvoiceFeedback("تعذر إنشاء الفاتورة من الخادم."); }
  };

  const shareInvoice = async () => {
    if (!invoiceRef.current) return;
    try {
      if (Platform.OS === "web") {
        await Share.share({ message: "افتح الفاتورة من تطبيق الهاتف لمشاركة صورة واضحة." });
        return;
      }
      if (!FileSystem.cacheDirectory) throw new Error("لا توجد مساحة مؤقتة لحفظ الفاتورة.");
      const uri = await captureInvoiceRef(invoiceRef, { format: "png", quality: 1, result: "tmpfile" });
      const target = `${FileSystem.cacheDirectory}invoice-${customer.id}-${Date.now()}.png`;
      await FileSystem.copyAsync({ from: uri, to: target });
      try { await saveInvoiceToLibrary(target); } catch { /* المشاركة البديلة تكفي إذا تعذر الحفظ في المعرض */ }
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(target, { mimeType: "image/png", dialogTitle: "مشاركة فاتورة العميل" });
    } catch { setInvoiceFeedback("تعذر حفظ أو مشاركة الفاتورة. حاول مرة أخرى."); }
  };

  const submitEmail = async () => {
    if (!emailSubject.trim() || !emailBody.trim()) { setEmailFeedback("اكتب عنوان الرسالة ومحتواها أولًا."); return; }
    setEmailFeedback("");
    try {
      await sendEmail.mutateAsync({ userId: customer.id, subject: emailSubject.trim(), body: emailBody.trim() });
      setEmailFeedback("تم إرسال البريد بنجاح."); setEmailSubject(""); setEmailBody("");
      await emailHistory.refetch();
    } catch (error) { setEmailFeedback(error instanceof Error ? error.message : "تعذر إرسال البريد."); }
  };

  const data = details.data as Details | undefined;
  const verificationStatus = data?.user.verificationStatus ?? customer.verificationStatus ?? "not_submitted";
  const isDeleted = data?.user.status === "deleted" || customer.status === "deleted";
  const verificationCopy = useMemo(() => verificationLabel(verificationStatus), [verificationStatus]);
  const paidProfit = data?.summary.savings.paidProfits ?? "0.00";
  const canLoadNext = nextOffset(data);

  const startEdit = (field: EditableField, value?: string | null) => {
    setEditing(field);
    setDraft(field === "nationalId" ? "" : value ?? "");
  };

  const saveEdit = () => {
    if (!editing || updateProfile.isPending) return;
    const value = draft.trim();
    if (!value) { showFinancialMessage("البيان مطلوب", "أدخل قيمة صحيحة قبل الحفظ."); return; }
    const input: Record<string, unknown> = { userId: customer.id, [editing]: value };
    updateProfile.mutate(input as Parameters<typeof updateProfile.mutate>[0]);
  };

  const confirmVerification = async () => {
    if (verification.isPending) return;
    const nextStatus = verificationStatus === "approved" ? "revoked" : "manual_verified";
    const accepted = await confirmFinancialAction(
      nextStatus === "manual_verified" ? "توثيق حساب العميل يدويًا" : "إلغاء توثيق حساب العميل",
      nextStatus === "manual_verified"
        ? `سيُعتمد الحساب يدويًا باسم العميل ${data?.user.name || customer.name || customer.customerId}. لن يظهر الرقم القومي للعميل إلا وفق حالة التوثيق المخزنة.`
        : "ستُزال الشارة ويصبح الحساب غير موثّق، وسيتمكن العميل من إعادة تقديم طلب جديد.",
    );
    if (accepted) verification.mutate({ userId: customer.id, status: nextStatus, reason: verificationReason.trim() || (nextStatus === "manual_verified" ? "اعتماد يدوي من لوحة المدير" : "إلغاء يدوي من لوحة المدير") });
  };

  const confirmFreeze = async () => {
    if (accountStatus.isPending || customer.role === "admin" || isDeleted) return;
    const frozen = !customer.accountFrozen;
    const accepted = await confirmFinancialAction(
      frozen ? "تجميد حساب العميل" : "إعادة تفعيل الحساب",
      frozen ? `سيُمنع ${data?.user.name || customer.name || customer.customerId} من استخدام الميزات المحمية.` : `سيُعاد تفعيل حساب ${data?.user.name || customer.name || customer.customerId}.`,
    );
    if (accepted) accountStatus.mutate({ userId: customer.id, frozen });
  };

  const confirmRestore = async () => {
    if (restoreAccount.isPending || !isDeleted) return;
    if (restoreReason.trim().length < 3) { showFinancialMessage("سبب الاستعادة مطلوب", "اكتب سببًا لا يقل عن 3 أحرف لتوثيق قرار المدير."); return; }
    const accepted = await confirmFinancialAction("استعادة الحساب الموقوف", `سيُعاد تفعيل حالة الحساب للعميل ${data?.user.name || customer.name || customer.customerId}. لن يُرفع التجميد الإداري إن كان مفعلًا.`);
    if (accepted) restoreAccount.mutate({ userId: customer.id, reason: restoreReason.trim() });
  };

  const revealNationalId = async () => {
    if (nationalIdVisible) {
      nationalId.reset();
      setNationalIdVisible(false);
      return;
    }
    setNationalIdVisible(true);
    await nationalId.mutateAsync({ userId: customer.id }).catch(() => undefined);
  };

  const loadDocuments = async () => {
    if (documentsVisible) {
      setDocumentsVisible(false);
      utils.admin.accountVerificationDocuments.setData({ userId: customer.id }, undefined);
      return;
    }
    setDocumentsVisible(true);
    await documents.refetch();
  };

  const submitAdjustment = async () => {
    if (adjust.isPending) return;
    let minor: number;
    try { minor = parseMoneyMinorUnits(amount, true); } catch { showFinancialMessage("مبلغ غير صالح", "أدخل مبلغًا صحيحًا حتى منزلتين عشريتين."); return; }
    if (minor === 0) { showFinancialMessage("مبلغ غير صالح", "أدخل مبلغًا موجبًا للإضافة أو سالبًا للخصم."); return; }
    if (adjustmentReason.trim().length < 3) { showFinancialMessage("السبب مطلوب", "اكتب سبب العملية قبل التأكيد."); return; }
    const operation = operationId.trim() || `ATH-ADJ-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const accepted = await confirmFinancialAction("تأكيد تعديل الرصيد", `${minor > 0 ? "إضافة" : "خصم"} ${formatMoneyMinorUnits(Math.abs(minor))} ج.م للعميل ${customer.customerId}؟`);
    if (accepted) adjust.mutate({ targetUserId: customer.id, amount: formatMoneyMinorUnits(minor), reason: adjustmentReason.trim(), operationId: operation });
  };

  const submitCoinAdjustment = async () => {
    if (adjustCoin.isPending) return;
    if (!/^[+-]?\d+(?:\.\d{1,6})?$/.test(coinQuantity.trim()) || Number(coinQuantity) === 0) { showFinancialMessage("كمية غير صالحة", "أدخل كمية موجبة للإضافة أو سالبة للخصم."); return; }
    if (coinReason.trim().length < 3) { showFinancialMessage("السبب مطلوب", "اكتب سبب تعديل الكوين قبل التأكيد."); return; }
    const accepted = await confirmFinancialAction("تأكيد تعديل رصيد الكوين", `${Number(coinQuantity) > 0 ? "إضافة" : "خصم"} ${Math.abs(Number(coinQuantity)).toFixed(6)} كوين للعميل ${customer.customerId}؟`);
    if (accepted) adjustCoin.mutate({ targetUserId: customer.id, quantity: coinQuantity.trim(), reason: coinReason.trim(), idempotencyKey: coinOperationId.trim() });
  };

  if (details.isLoading) return <View className="mt-4 py-6"><ActivityIndicator color="#D7A948" /></View>;
  if (details.isError || !data) return <View className="mt-4 rounded-xl border border-[#273548] p-3"><Text className="text-right text-xs text-[#FF7D8D]">تعذر تحميل الملف الشامل. أعد المحاولة.</Text><View className="mt-3"><ActionButton label="إعادة تحميل الملف" icon="refresh-outline" secondary onPress={() => details.refetch()} /></View></View>;

  const saveWallet = data.wallet;
  const isFrozen = Boolean(customer.accountFrozen);
  const documentsData = (documents.data as { documents?: { idFront?: string | null; idBack?: string | null; selfie?: string | null; walletProfile?: string | null } } | undefined)?.documents;

  return <View className="mt-4 rounded-2xl border border-[#5C4A28] bg-[#080C12] p-3">
    <View className="flex-row items-center justify-between">
      <Pill tone={isFrozen ? "red" : "green"}>{isFrozen ? "حساب مجمّد" : "حساب نشط"}</Pill>
      <Text className="text-right text-base font-bold text-[#D7A948]">الملف الشامل للعميل</Text>
    </View>

    <Section title="الهوية والبيانات الشخصية">
      <VerifiedName name={data.user.name || data.user.customerId} verified={verificationStatus === "approved"} nameClassName="text-base font-bold text-[#F7F1E3]" className="mb-2 justify-end" />
      <Line label="رقم المستخدم ID" value={<Text className="font-bold text-[#D7A948]">{data.user.customerId}</Text>} />
      <Line label="رمز الأمان" value={<Text className={securityPinStatus.data?.configured ? "font-bold text-[#47D7A5]" : "text-[#9BA8B8]"}>{securityPinStatus.data?.configured ? "مفعّل (القيمة مخفية)" : "غير مفعّل"}</Text>} />
      <Line label="حالة التوثيق" value={<Text className={verificationStatus === "approved" ? "font-bold text-[#47D7A5]" : verificationStatus === "pending" ? "font-bold text-[#D7A948]" : "font-semibold text-[#9BA8B8]"}>{verificationCopy}</Text>} />
      <Line label="الحساب" value={<Text className={isDeleted ? "font-bold text-[#FF9BA7]" : isFrozen ? "font-bold text-[#D7A948]" : "font-semibold text-[#47D7A5]"}>{isDeleted ? "موقوف" : isFrozen ? "مجمّد" : "نشط"}</Text>} />
      {data.user.deletedAt ? <Line label="تاريخ الإيقاف" value={dateLabel(data.user.deletedAt)} /> : null}
      <Line label="تاريخ إنشاء الحساب" value={dateLabel(data.user.createdAt)} />
      <Line label="آخر فتح للتطبيق" value={formatEgyptDateTime(data.user.lastOpenedAt)} />
      <Line label="إصدار / بناء التطبيق" value={`${data.user.appVersion || "غير متاح"} · ${data.user.appBuildNumber || "غير متاح"}`} />
      <Line label="آخر نشاط مسجل" value={customerSessions.isLoading ? "جارٍ تحميل النشاط..." : formatEgyptDateTime(customerSessions.data?.[0]?.lastActivityAt)} />
      {isDeleted ? <View className="mt-3 rounded-xl border border-[#5C4A28] bg-[#111722] p-3">
        <Text className="text-right text-xs leading-5 text-[#9BA8B8]">استعادة الحساب تعيد حالة الدخول فقط. لا تتغير الأرصدة أو السجلات، ولا يُرفع أي تجميد إداري قائم.</Text>
        <TextInput value={restoreReason} onChangeText={setRestoreReason} maxLength={500} placeholder="سبب الاستعادة (3 أحرف على الأقل)" placeholderTextColor="#657286" className="mt-3 rounded-xl border border-[#273548] bg-[#121B28] px-3 py-2 text-right text-xs text-[#F7F1E3]" />
        <View className="mt-3"><ActionButton label={restoreAccount.isPending ? "جارٍ الاستعادة..." : "استعادة الحساب"} icon="person-add-outline" onPress={() => { void confirmRestore(); }} /></View>
      </View> : <View className="mt-2 flex-row items-center justify-between gap-2">
        <ActionButton label={verificationStatus === "approved" ? "إلغاء التوثيق" : verification.isPending ? "جارٍ الحفظ..." : "توثيق الحساب يدويًا"} icon={verificationStatus === "approved" ? "close-circle-outline" : "shield-checkmark-outline"} secondary onPress={() => { void confirmVerification(); }} />
        <ActionButton label={isFrozen ? "إعادة التفعيل" : "تجميد الحساب"} icon={isFrozen ? "play-circle-outline" : "pause-circle-outline"} secondary onPress={() => { void confirmFreeze(); }} />
      </View>}
      <TextInput value={verificationReason} onChangeText={setVerificationReason} maxLength={500} placeholder="سبب قرار التوثيق/الإلغاء — اختياري" placeholderTextColor="#657286" className="mt-3 rounded-xl border border-[#273548] bg-[#121B28] px-3 py-2 text-right text-xs text-[#F7F1E3]" />
      {data.user.verificationReason ? <Text className="mt-2 text-right text-xs text-[#FF9BA7]">سبب الرفض/الإلغاء السابق: {data.user.verificationReason}</Text> : null}
      {data.user.verificationSubmittedAt ? <Text className="mt-2 text-right text-[10px] text-[#9BA8B8]">أُرسل الطلب: {dateLabel(data.user.verificationSubmittedAt)}</Text> : null}
      {data.user.verificationReviewedAt ? <Text className="mt-1 text-right text-[10px] text-[#9BA8B8]">آخر مراجعة: {dateLabel(data.user.verificationReviewedAt)}</Text> : null}

      <View className="mt-3">
        <EditableRow label="الاسم الكامل" value={data.user.name ?? ""} onEdit={() => startEdit("fullName", data.user.name)} />
        <EditableRow label="الاسم الأول" value={data.user.givenName ?? ""} onEdit={() => startEdit("givenName", data.user.givenName)} />
        <EditableRow label="اسم الأب" value={data.user.fatherName ?? ""} onEdit={() => startEdit("fatherName", data.user.fatherName)} />
        <EditableRow label="البريد الإلكتروني" value={data.user.email ?? ""} onEdit={() => startEdit("email", data.user.email)} />
        <EditableRow label="رقم الهاتف" value={data.user.phoneNumber ?? ""} onEdit={() => startEdit("phoneNumber", data.user.phoneNumber)} />
        <EditableRow label="تاريخ الميلاد" value={data.user.birthDate ?? ""} onEdit={() => startEdit("birthDate", data.user.birthDate)} />
        <EditableRow label="المحافظة" value={data.user.governorate ?? ""} onEdit={() => startEdit("governorate", data.user.governorate)} />
        <EditableRow label="الرقم القومي المقنّع" value={data.user.nationalIdMasked ?? "غير مسجل"} onEdit={() => startEdit("nationalId")} />
      </View>

      {editing ? <View className="mt-3 rounded-xl border border-[#5C4A28] bg-[#111722] p-3">
        <Text className="mb-2 text-right text-xs font-bold text-[#D7A948]">تعديل {fieldLabels[editing]}</Text>
        {editing === "governorate" ? <Pressable onPress={() => setGovernoratesOpen(true)} className="rounded-xl border border-[#273548] bg-[#080C12] px-3 py-3"><Text className="text-right text-sm text-[#F7F1E3]">{draft || "اختر المحافظة"} ˅</Text></Pressable> : <TextInput value={draft} onChangeText={setDraft} autoCapitalize={editing === "email" ? "none" : "sentences"} keyboardType={editing === "phoneNumber" || editing === "nationalId" ? "phone-pad" : editing === "email" ? "email-address" : "default"} maxLength={editing === "nationalId" ? 20 : editing === "email" ? 320 : 120} placeholder={editing === "birthDate" ? "YYYY-MM-DD" : editing === "nationalId" ? "14 رقمًا" : fieldLabels[editing]} placeholderTextColor="#657286" className="rounded-xl border border-[#273548] bg-[#080C12] px-3 py-3 text-right text-sm text-[#F7F1E3]" />}
        {editing === "nationalId" ? <Text className="mt-2 text-right text-[10px] leading-4 text-[#9BA8B8]">يُشفّر الرقم الجديد؛ إذا كان الحساب موثّقًا فسيُلغى الاعتماد لإعادة مراجعة المستندات.</Text> : null}
        <View className="mt-3 flex-row justify-end gap-2">
          <ActionButton label="إلغاء" icon="close-outline" secondary onPress={() => { setEditing(null); setDraft(""); }} />
          <ActionButton label={updateProfile.isPending ? "جارٍ الحفظ..." : "حفظ التعديل"} icon="save-outline" onPress={saveEdit} />
        </View>
      </View> : null}

      <View className="mt-3 flex-row flex-wrap gap-2">
        <ActionButton label={nationalIdVisible ? "إخفاء الرقم القومي" : "عرض الرقم القومي كاملًا"} icon={nationalIdVisible ? "eye-off-outline" : "eye-outline"} secondary onPress={() => { void revealNationalId(); }} />
        {nationalIdVisible && nationalId.data?.nationalId ? <Pill tone="gold">{nationalId.data.nationalId}</Pill> : null}
        {nationalId.isPending ? <ActivityIndicator color="#D7A948" /> : null}
      </View>

      <View className="mt-3">
        <ActionButton label={documentsVisible ? "إخفاء وثائق الهوية" : "عرض وثائق الهوية"} icon={documentsVisible ? "eye-off-outline" : "images-outline"} secondary onPress={() => { void loadDocuments(); }} />
        {documents.isFetching ? <View className="mt-3"><ActivityIndicator color="#D7A948" /></View> : null}
        {documentsVisible && documents.isError ? <Text className="mt-2 text-right text-xs text-[#FF7D8D]">تعذر تحميل الوثائق أو لا توجد وثائق متاحة.</Text> : null}
        {documentsVisible && documentsData ? <View className="mt-3 gap-3">
          <DocumentPreview title="الوجه الأمامي للهوية" source={documentsData.idFront} />
          <DocumentPreview title="الوجه الخلفي للهوية" source={documentsData.idBack} />
          <DocumentPreview title="صورة التحقق الشخصي" source={documentsData.selfie} />
          <DocumentPreview title="لقطة ملف المحفظة" source={documentsData.walletProfile} />
        </View> : null}
      </View>
    </Section>
    <Section title="الفاتورة والبريد الإلكتروني">
      <View className="flex-row gap-2">
        <View className="flex-1"><ActionButton label={invoiceQuery.isFetching ? "جارٍ الإنشاء..." : "إنشاء فاتورة"} icon="receipt-outline" onPress={() => { void createInvoice(); }} /></View>
        <View className="flex-1"><ActionButton label="فتح نموذج البريد" icon="mail-outline" secondary onPress={() => setEmailFeedback(emailFeedback ? "" : "اكتب رسالة للعميل ثم أرسلها.")} /></View>
      </View>
      {emailFeedback ? <Text className={`mt-2 text-right text-xs ${emailFeedback.includes("نجاح") ? "text-[#47D7A5]" : "text-[#FF7D8D]"}`}>{emailFeedback}</Text> : null}
      <TextInput value={emailSubject} onChangeText={setEmailSubject} placeholder="عنوان البريد" placeholderTextColor="#657286" className="mt-3 rounded-xl border border-[#273548] bg-[#121B28] px-3 py-3 text-right text-sm text-[#F7F1E3]" />
      <TextInput value={emailBody} onChangeText={setEmailBody} placeholder="محتوى الرسالة" placeholderTextColor="#657286" multiline textAlignVertical="top" className="mt-2 min-h-[110px] rounded-xl border border-[#273548] bg-[#121B28] px-3 py-3 text-right text-sm text-[#F7F1E3]" />
      <View className="mt-3"><ActionButton label={sendEmail.isPending ? "جارٍ الإرسال..." : "إرسال البريد للمستخدم"} icon="send-outline" onPress={() => { void submitEmail(); }} /></View>
      <Text className="mt-4 text-right text-xs font-bold text-[#D7A948]">آخر عمليات الإرسال</Text>
      {emailHistory.isLoading ? <ActivityIndicator className="mt-2" color="#D7A948" /> : ((emailHistory.data as any)?.items ?? emailHistory.data ?? []).slice(0, 5).map((item: any, index: number) => <Text key={item.id ?? index} className="mt-1 text-right text-[10px] text-[#9BA8B8]">{dateLabel(item.createdAt ?? item.sentAt)} · {item.subject ?? "رسالة"} · {savingsStatus(item.status ?? item.deliveryStatus ?? "غير معروف")}</Text>)}
    </Section>

    <Modal visible={invoiceVisible} transparent animationType="slide" onRequestClose={() => setInvoiceVisible(false)}>
      <View style={{ flex: 1, justifyContent: "center", backgroundColor: "#0009", padding: 16 }}><InvoiceCapture ref={invoiceRef} options={{ format: "png", quality: 1 }} style={{ backgroundColor: "#111722", borderRadius: 18, padding: 18 }}>
        <Text className="text-right text-xl font-bold text-[#D7A948]">فاتورة العميل</Text>
        <Text className="mt-2 text-right text-sm text-[#F7F1E3]">الاسم: {invoiceQuery.data?.user.name ?? data.user.name ?? "غير مسجل"}</Text>
        <Text className="mt-1 text-right text-xs text-[#9BA8B8]">ID: {invoiceQuery.data?.user.customerId ?? data.user.customerId} · البريد: {invoiceQuery.data?.user.email ?? data.user.email ?? "غير مسجل"} · الهاتف: {invoiceQuery.data?.user.phoneNumber ?? data.user.phoneNumber ?? "غير مسجل"}</Text>
        <Text className="mt-3 text-right text-sm font-bold text-[#F7F1E3]">الرصيد: {formatMoney(invoiceQuery.data?.wallet?.balance ?? data.wallet?.balance)}</Text>
        <Text className="mt-2 text-right text-xs leading-5 text-[#9BA8B8]">الإجماليات: إضافة {formatMoney(invoiceQuery.data?.totals.credits)} · خصم {formatMoney(invoiceQuery.data?.totals.debits)} · رسوم {formatMoney(invoiceQuery.data?.totals.fees)}</Text>
        {(invoiceQuery.data?.items ?? []).slice(0, 30).map((item, index) => <Text key={`${item.reference}-${index}`} className="mt-1 text-right text-[10px] text-[#F7F1E3]">{dateLabel(item.createdAt)} · {item.reference} · {item.direction === "credit" ? "إضافة" : item.direction === "debit" ? "خصم" : "عملية"} {formatMoney(item.amount)} · الرسوم {formatMoney(item.fee)} · {savingsStatus(item.status)}</Text>)}
      </InvoiceCapture><View className="mt-3 flex-row gap-2"><View className="flex-1"><ActionButton label="مشاركة PNG" icon="share-social-outline" onPress={() => { void shareInvoice(); }} /></View><View className="flex-1"><ActionButton label="إغلاق" icon="close-outline" secondary onPress={() => setInvoiceVisible(false)} /></View></View>{invoiceFeedback ? <Text className="mt-2 text-center text-xs text-[#FF7D8D]">{invoiceFeedback}</Text> : null}</View>
    </Modal>

    <Section title="تخصيص الواجهة لهذا العميل">
      <CustomerUiSettings userId={customer.id} />
    </Section>
    <Modal visible={governoratesOpen} transparent animationType="slide" onRequestClose={() => setGovernoratesOpen(false)}><View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "#0008" }}><View style={{ maxHeight: "78%", borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: "#111722", padding: 20 }}><Text className="mb-4 text-xl font-bold text-[#F7F1E3]" style={{ textAlign: "right" }}>اختر المحافظة</Text><FlatList data={EGYPTIAN_GOVERNORATES} keyExtractor={(item) => item} renderItem={({ item }) => <Pressable onPress={() => { setDraft(item); setGovernoratesOpen(false); }} style={{ borderBottomWidth: 1, borderBottomColor: "#273548", paddingVertical: 15 }}><Text className="text-base text-[#F7F1E3]" style={{ textAlign: "right" }}>{item}</Text></Pressable>} /></View></View></Modal>

    <Section title="الأجهزة والجلسات المسجلة">
      <Line label="الأجهزة النشطة" value={<Text className="font-bold text-[#D7A948]">{customerSessions.data?.filter((item) => item.active).length ?? 0}</Text>} />
      {customerSessions.isLoading ? <ActivityIndicator color="#D7A948" /> : customerSessions.data?.length ? customerSessions.data.map((item) => <View key={item.id} className="mb-2 rounded-xl border border-[#273548] bg-[#121B28] p-3"><View className="flex-row items-center justify-between"><Pill tone={item.active ? "green" : "muted"}>{item.active ? "نشطة" : "منتهية"}</Pill><Text className="text-sm font-bold text-[#F7F1E3]" style={{ textAlign: "right" }}>{item.label}</Text></View><Text className="mt-1 text-xs text-[#9BA8B8]" style={{ textAlign: "right" }}>آخر نشاط: {formatEgyptDateTime(item.lastActivityAt)} · {item.platform || "غير محدد"}</Text></View>) : <Text className="text-sm text-[#9BA8B8]" style={{ textAlign: "right" }}>لا توجد جلسات مسجلة.</Text>}
    </Section>
    <Section title="المحفظة والملخص المالي">
      <Line label="الرصيد الحالي" value={<Text className="font-bold text-[#F7F1E3]">{formatMoney(saveWallet?.balance)}</Text>} />
      <Line label="الرصيد المتاح" value={<Text className="font-bold text-[#47D7A5]">{formatMoney(data.available)}</Text>} />
      <Line label="إجمالي المبالغ المحجوزة" value={`${formatMoney(saveWallet?.reservedWithdrawals)} + ${formatMoney(saveWallet?.reservedOrders)} + ${formatMoney(saveWallet?.reservedTransfers)} + ${formatMoney(saveWallet?.reservedSavings)}`} />
      <Line label="رصيد الكوين الفعلي" value={data.coin ? `${formatCoinQuantity(data.coin.wallet.balance)} كوين` : "لم تُحمّل بيانات الكوين"} />
      <Line label="الكوين المحجوز" value={data.coin ? `${formatCoinQuantity(data.coin.wallet.reserved)} كوين` : "غير متاح"} />
      <Line label="الكوين المتاح" value={data.coin ? `${formatCoinQuantity(data.coin.wallet.available)} كوين` : "غير متاح"} />
      <Line label="الإيداعات المعتمدة" value={`${data.summary.deposits.count} عملية · ${formatMoney(data.summary.deposits.amount)}`} />
      <Line label="السحوبات المعتمدة" value={`${data.summary.withdrawals.count} عملية · ${formatMoney(data.summary.withdrawals.amount)}`} />
      <Line label="التحويلات المرسلة المعتمدة" value={`${data.summary.transfers.sentCount} · ${formatMoney(data.summary.transfers.sentAmount)}`} />
      <Line label="التحويلات المستلمة المعتمدة" value={`${data.summary.transfers.receivedCount} · ${formatMoney(data.summary.transfers.receivedAmount)}`} />
      <Line label="طلبات الإدخار" value={`${data.summary.savings.requestCount} طلب · ${formatMoney(data.summary.savings.requestedPrincipal)}`} />
      <Line label="أصل خطط الإدخار النشطة" value={`${formatMoney(data.summary.savings.activePrincipal)}`} />
      <Line label="أصل خطط الإدخار المكتملة" value={`${formatMoney(data.summary.savings.completedPrincipal)}`} />
      <Line label="أرباح إدخار مصروفة" value={`${formatMoney(paidProfit)} · ${data.summary.savings.paidProfitCount} دفعة`} />
      <Line label="طلبات الإدخار الملغاة/المستردة" value={data.summary.savings.cancelledCount} />
      <Line label="طلبات الإدخار المرفوضة" value={data.summary.savings.rejectedCount} />
        <View className="mt-3 rounded-xl border border-[#273548] p-3">
          <Text className="mb-2 text-right text-xs font-bold text-[#D7A948]">أدوات تعديل الرصيد الحالية</Text>
        <TextInput value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="تعديل +100 أو -50" placeholderTextColor="#657286" className="rounded-xl border border-[#273548] bg-[#121B28] px-3 py-3 text-right text-sm text-[#F7F1E3]" />
        <TextInput value={adjustmentReason} onChangeText={setAdjustmentReason} placeholder="سبب العملية" placeholderTextColor="#657286" className="mt-2 rounded-xl border border-[#273548] bg-[#121B28] px-3 py-3 text-right text-sm text-[#F7F1E3]" />
        <TextInput value={operationId} onChangeText={setOperationId} maxLength={80} placeholder="معرف عملية فريد" placeholderTextColor="#657286" className="mt-2 rounded-xl border border-[#273548] bg-[#121B28] px-3 py-3 text-right text-sm text-[#F7F1E3]" />
          <View className="mt-3"><ActionButton label={adjust.isPending ? "جارٍ الحفظ..." : "حفظ تعديل رصيد موثق"} icon="shield-checkmark-outline" onPress={() => { void submitAdjustment(); }} /></View>
        </View>
        <View className="mt-3 rounded-xl border border-[#273548] p-3">
          <Text className="mb-2 text-right text-xs font-bold text-[#D7A948]">تعديل رصيد كوين العميل</Text>
          <Text className="mb-2 text-right text-[10px] leading-4 text-[#9BA8B8]">استخدم كمية موجبة للإضافة أو سالبة للخصم. لا يمكن الخصم من الكمية المحجوزة.</Text>
          <TextInput value={coinQuantity} onChangeText={setCoinQuantity} keyboardType="decimal-pad" placeholder="مثال: +25 أو -5.5 كوين" placeholderTextColor="#657286" className="rounded-xl border border-[#273548] bg-[#121B28] px-3 py-3 text-right text-sm text-[#F7F1E3]" />
          <TextInput value={coinReason} onChangeText={setCoinReason} placeholder="سبب تعديل الكوين" placeholderTextColor="#657286" className="mt-2 rounded-xl border border-[#273548] bg-[#121B28] px-3 py-3 text-right text-sm text-[#F7F1E3]" />
          <TextInput value={coinOperationId} onChangeText={setCoinOperationId} maxLength={120} placeholder="معرف عملية كوين فريد" placeholderTextColor="#657286" className="mt-2 rounded-xl border border-[#273548] bg-[#121B28] px-3 py-3 text-right text-sm text-[#F7F1E3]" />
          <View className="mt-3"><ActionButton label={adjustCoin.isPending ? "جارٍ الحفظ..." : "حفظ تعديل كوين موثق"} icon="layers-outline" onPress={() => { void submitCoinAdjustment(); }} /></View>
        </View>
      </Section>

    <Section title="عمليات المحفظة وسجل المعاملات">
      {data.history.items.length ? data.history.items.map((item) => <TransactionRow key={item.id} transaction={item as never} compact />) : <Text className="text-right text-xs text-[#9BA8B8]">لا توجد حركات مسجلة.</Text>}
      <Text className="mt-2 text-right text-[10px] text-[#657286]">إجمالي السجل: {data.history.total}</Text>
    </Section>

    <Section title="طلبات الإيداع والسحب">
      {data.requests.items.length ? data.requests.items.map((item) => <View key={item.id} className="border-b border-[#273548] py-2">
        <View className="flex-row items-center justify-between"><Pill tone={item.status === "approved" || item.status === "completed" ? "green" : item.status === "rejected" ? "red" : "gold"}>{savingsStatus(item.status)}</Pill><Text className="text-right text-xs font-bold text-[#F7F1E3]">{item.type === "deposit" ? "إيداع" : "سحب"} · {formatMoney(item.amount)}</Text></View>
        <Text className="mt-1 text-right text-[10px] text-[#9BA8B8]">{item.reference} · {dateLabel(item.createdAt)}{item.hasReceipt ? " · إيصال مرفق" : ""}</Text>
        <Text className="mt-1 text-right text-[10px] text-[#9BA8B8]">الرسوم: {formatMoney(item.feeAmount)} · الوسيلة: {item.paymentChannel || "غير مسجلة"}{item.destination ? ` · الوجهة: ${item.destination}` : ""}</Text>
        {item.transferReference ? <Text selectable className="mt-1 text-right text-[10px] text-[#9BA8B8]">مرجع التحويل المؤكد: {item.transferReference}</Text> : null}
        {item.payoutReference ? <Text selectable className="mt-1 text-right text-[10px] text-[#9BA8B8]">مرجع تنفيذ السحب: {item.payoutReference}</Text> : null}
        {item.reviewedAt ? <Text className="mt-1 text-right text-[10px] text-[#9BA8B8]">وقت المراجعة/التنفيذ: {dateLabel(item.reviewedAt)} · المدير: {item.reviewedBy ?? "غير مسجل"}</Text> : null}
        {item.note ? <Text className="mt-1 text-right text-[10px] text-[#9BA8B8]">ملاحظات: {item.note}</Text> : null}
        {item.rejectionReason ? <Text className="mt-1 text-right text-[10px] text-[#FF9BA7]">السبب: {item.rejectionReason}</Text> : null}
      </View>) : <Text className="text-right text-xs text-[#9BA8B8]">لا توجد طلبات.</Text>}
      <Text className="mt-2 text-right text-[10px] text-[#657286]">إجمالي الطلبات: {data.requests.total}</Text>
    </Section>

    <Section title="تفاصيل شراء وبيع الكوين">
      {data.coin?.orders.items.length ? data.coin.orders.items.map((item) => <View key={item.id} className="border-b border-[#273548] py-2">
        <View className="flex-row items-center justify-between"><Pill tone={item.status === "approved" ? "green" : item.status === "rejected" ? "red" : "gold"}>{savingsStatus(item.status)}</Pill><Text className="text-right text-xs font-bold text-[#F7F1E3]">{item.side === "buy" ? "شراء" : "بيع"} · {formatCoinQuantity(item.quantity)} كوين</Text></View>
        <Text selectable className="mt-1 text-right text-[10px] text-[#9BA8B8]">{item.reference} · {dateLabel(item.createdAt)}</Text>
        <Text className="mt-1 text-right text-[10px] text-[#9BA8B8]">سعر الوحدة: {formatMoney(item.unitPrice)} · القيمة: {formatMoney(item.grossAmount)} · الرسوم: {formatMoney(item.feeAmount)} · {item.side === "buy" ? "الإجمالي" : "الصافي"}: {formatMoney(item.totalAmount)}</Text>
        {item.reviewedAt ? <Text className="mt-1 text-right text-[10px] text-[#9BA8B8]">المراجعة: {dateLabel(item.reviewedAt)} · المدير: {item.reviewedBy ?? "غير مسجل"}</Text> : null}
        {item.rejectionReason ? <Text className="mt-1 text-right text-[10px] text-[#FF9BA7]">السبب: {item.rejectionReason}</Text> : null}
      </View>) : <Text className="text-right text-xs text-[#9BA8B8]">{data.coin ? "لا توجد طلبات كوين في هذه الصفحة." : "لم تُحمّل بيانات الكوين."}</Text>}
      <Text className="mt-2 text-right text-[10px] text-[#657286]">إجمالي الطلبات: {data.coin?.orders.total ?? "غير متاح"}</Text>
    </Section>

    <Section title="تحويلات الكوين وسجل كمياته">
      {data.coin?.transfers.items.map((item) => <View key={item.reference} className="border-b border-[#273548] py-2"><Text className="text-right text-xs font-bold text-[#F7F1E3]">{item.senderUserId === customer.id ? "إرسال إلى" : "استلام من"} {item.senderUserId === customer.id ? (item.recipientName || item.recipientCustomerId || item.recipientUserId) : (item.senderName || item.senderCustomerId || item.senderUserId)} · {formatCoinQuantity(item.quantity)} كوين · {savingsStatus(item.status)}</Text><Text selectable className="mt-1 text-right text-[10px] text-[#9BA8B8]">{item.reference} · {dateLabel(item.createdAt)} · المراجعة: {dateLabel(item.reviewedAt)} · المدير: {item.reviewedBy ?? "غير مسجل"}</Text>{item.rejectionReason ? <Text className="mt-1 text-right text-[10px] text-[#FF9BA7]">{item.rejectionReason}</Text> : null}</View>)}
      {data.coin?.ledger.items.map((item) => <View key={item.reference} className="border-b border-[#273548] py-2"><Text className="text-right text-xs font-bold text-[#F7F1E3]">{item.direction === "credit" ? "إضافة" : "خصم"} {formatCoinQuantity(item.quantity)} كوين · الرصيد بعد الحركة: {formatCoinQuantity(item.balanceAfterQuantity)}</Text><Text selectable className="mt-1 text-right text-[10px] text-[#9BA8B8]">{item.source} · {item.reference} · {dateLabel(item.createdAt)} · الأثر بالجنيه: {formatMoney(item.amount)}</Text></View>)}
      <Text className="mt-2 text-right text-[10px] text-[#657286]">إجمالي التحويلات: {data.coin?.transfers.total ?? "غير متاح"} · حركات الكوين: {data.coin?.ledger.total ?? "غير متاح"}</Text>
    </Section>

    <Section title="التحويلات المرسلة والمستلمة">
      {data.transfers.items.length ? data.transfers.items.map((item) => <View key={item.id} className="border-b border-[#273548] py-2">
        <View className="flex-row items-center justify-between"><Pill tone={item.status === "approved" ? "green" : item.status === "rejected" ? "red" : "gold"}>{savingsStatus(item.status)}</Pill><Text className="text-right text-xs font-bold text-[#F7F1E3]">{item.direction === "sent" ? "أرسل إلى" : "استلم من"} {item.counterparty?.name || item.counterparty?.customerId || "عميل"} · {formatMoney(item.amount)}</Text></View>
        <Text className="mt-1 text-right text-[10px] text-[#9BA8B8]">{item.reference} · {dateLabel(item.createdAt)}</Text>
        {item.note ? <Text className="mt-1 text-right text-[10px] text-[#9BA8B8]">ملاحظة: {item.note}</Text> : null}
        {item.rejectionReason ? <Text className="mt-1 text-right text-[10px] text-[#FF9BA7]">السبب: {item.rejectionReason}</Text> : null}
      </View>) : <Text className="text-right text-xs text-[#9BA8B8]">لا توجد تحويلات.</Text>}
      <Text className="mt-2 text-right text-[10px] text-[#657286]">إجمالي التحويلات: {data.transfers.total}</Text>
    </Section>

    <Section title="طلبات الإدخار والدفعات">
      {data.savingsPlans.items.length ? data.savingsPlans.items.map((item) => <View key={item.id} className="border-b border-[#273548] py-2">
        <View className="flex-row items-center justify-between"><Pill tone={item.status === "active" || item.status === "completed" ? "green" : item.status === "rejected" || item.status === "cancelled" ? "red" : "gold"}>{savingsStatus(item.status)}</Pill><Text className="text-right text-xs font-bold text-[#F7F1E3]">{formatMoney(item.principalAmount)} · {item.frequency}</Text></View>
        <Text className="mt-1 text-right text-[10px] text-[#9BA8B8]">{item.reference} · {dateLabel(item.createdAt)} · عائد مسجل {formatMoney(item.totalAccrued)} · مدفوع {formatMoney(item.totalPaid)}</Text>
        {item.rejectionReason ? <Text className="mt-1 text-right text-[10px] text-[#FF9BA7]">السبب: {item.rejectionReason}</Text> : null}
      </View>) : <Text className="text-right text-xs text-[#9BA8B8]">لا توجد خطط إدخار.</Text>}
      <Text className="mt-2 text-right text-[10px] text-[#657286]">إجمالي الخطط: {data.savingsPlans.total} · أرباح مصروفة إجمالًا: {formatMoney(data.summary.savings.paidProfits)}</Text>
      <View className="mt-3 border-t border-[#273548] pt-3">
        <Text className="mb-2 text-right text-xs font-bold text-[#D7A948]">تفاصيل الدفعات</Text>
        {data.payouts.items.length ? data.payouts.items.map((item) => <View key={item.id} className="border-b border-[#273548] py-2">
          <View className="flex-row items-center justify-between"><Pill tone={item.status === "paid" ? "green" : "gold"}>{item.status === "paid" ? "مصروفة" : "محجوبة/بانتظار المعالجة"}</Pill><Text className="text-right text-xs font-bold text-[#F7F1E3]">{formatMoney(item.paidAmount)}</Text></View>
          <Text className="mt-1 text-right text-[10px] text-[#9BA8B8]">الخطة {item.planReference || item.planId} · الفترة {dateLabel(item.periodStart)} – {dateLabel(item.periodEnd)}</Text>
          <Text className="mt-1 text-right text-[10px] text-[#9BA8B8]">المتوقع {formatMoney(item.expectedAmount)} · {item.transactionReference || item.periodKey} · أُنشئت {dateLabel(item.createdAt)}{item.paidAt ? ` · صُرفت ${dateLabel(item.paidAt)}` : ""}</Text>
          {item.blockReason ? <Text className="mt-1 text-right text-[10px] text-[#FF9BA7]">سبب الحجب: {item.blockReason}</Text> : null}
        </View>) : <Text className="text-right text-xs text-[#9BA8B8]">لا توجد دفعات إدخار.</Text>}
        <Text className="mt-2 text-right text-[10px] text-[#657286]">إجمالي الدفعات: {data.payouts.total}</Text>
      </View>
    </Section>

    <Section title="سجل المدير والتغييرات">
      <View className="mb-3 rounded-xl border border-[#273548] p-3">
        <Text className="mb-2 text-right text-xs font-bold text-[#D7A948]">سجل حالة الحساب</Text>
        {statusEvents.isLoading ? <ActivityIndicator color="#D7A948" /> : statusEvents.data?.length ? statusEvents.data.map((event) => <View key={event.id} className="border-b border-[#273548] py-2"><Text className="text-right text-xs font-bold text-[#F7F1E3]">{event.action === "soft_delete" ? "إيقاف ناعم" : "استعادة الحساب"} · {event.actorType === "admin" ? `المدير ${event.actorUserId}` : "طلب العميل"}</Text><Text className="mt-1 text-right text-[10px] text-[#9BA8B8]">{dateLabel(event.createdAt)}{event.reason ? ` · ${event.reason}` : ""}</Text></View>) : <Text className="text-right text-xs text-[#9BA8B8]">لا توجد أحداث إيقاف أو استعادة.</Text>}
      </View>
      {data.audits.items.length ? data.audits.items.map((audit) => <View key={audit.id} className="border-b border-[#273548] py-2">
        <Text className="text-right text-xs font-bold text-[#F7F1E3]">{audit.admin?.name || audit.admin?.email || `مدير ${audit.adminId}`}</Text>
        <Text className="mt-1 text-right text-[10px] text-[#9BA8B8]">{dateLabel(audit.createdAt)}</Text>
        <AuditSummary value={audit.changes} />
      </View>) : <Text className="text-right text-xs text-[#9BA8B8]">لا يوجد سجل إداري بعد.</Text>}
      <Text className="mt-2 text-right text-[10px] text-[#657286]">إجمالي أحداث الملف: {data.audits.total}</Text>
    </Section>

    <Section title="وسائل الدفع المسموحة لهذا العميل">
      {methods.isLoading || access.isLoading ? <ActivityIndicator color="#D7A948" /> : (methods.data ?? []).map((method) => {
        const accessForMethod = access.data?.methods.find((item) => item.methodId === method.id);
        const depositEnabled = accessForMethod?.depositEnabled ?? true;
        const withdrawalEnabled = accessForMethod?.withdrawalEnabled ?? true;
        return <View key={method.id} className="border-b border-[#273548] py-3">
          <View className="flex-row items-center justify-between"><Text className="flex-1 text-right text-xs font-semibold text-[#F7F1E3]">{method.name}</Text><Text className="ml-2 text-[10px] text-[#657286]">{!method.enabled ? "مخفية عامة" : ""}</Text></View>
          <View className="mt-2 flex-row items-center justify-between">
            <View className="flex-row items-center gap-2"><Switch disabled={methodDirection.isPending} value={withdrawalEnabled} onValueChange={(enabled) => methodDirection.mutate({ userId: customer.id, methodId: method.id, direction: "withdrawal", enabled })} trackColor={{ false: "#273548", true: "#5C4A28" }} thumbColor={withdrawalEnabled ? "#D7A948" : "#9BA8B8"} /><Text className="text-[10px] text-[#9BA8B8]">السحب</Text></View>
            <View className="flex-row items-center gap-2"><Switch disabled={methodDirection.isPending} value={depositEnabled} onValueChange={(enabled) => methodDirection.mutate({ userId: customer.id, methodId: method.id, direction: "deposit", enabled })} trackColor={{ false: "#273548", true: "#5C4A28" }} thumbColor={depositEnabled ? "#D7A948" : "#9BA8B8"} /><Text className="text-[10px] text-[#9BA8B8]">الإيداع</Text></View>
          </View>
        </View>;
      })}
      {methodDirection.error ? <Text className="mt-2 text-right text-xs text-[#FF7D8D]">{methodDirection.error.message}</Text> : null}
    </Section>

    <View className="mt-4 flex-row items-center justify-between">
      <Text className="text-[10px] text-[#657286]">المزيد من السجلات</Text>
      <View className="flex-row gap-2">
        <Pressable disabled={offset === 0} onPress={() => setOffset((current) => Math.max(0, current - pageSize))} className={`rounded-xl border px-3 py-2 ${offset === 0 ? "border-[#273548] opacity-40" : "border-[#5C4A28]"}`}><Text className="text-xs text-[#D7A948]">السابق</Text></Pressable>
        <Pressable disabled={!canLoadNext} onPress={() => setOffset((current) => current + pageSize)} className={`rounded-xl border px-3 py-2 ${!canLoadNext ? "border-[#273548] opacity-40" : "border-[#5C4A28]"}`}><Text className="text-xs text-[#D7A948]">التالي</Text></Pressable>
      </View>
    </View>
    {details.isFetching ? <View className="mt-3"><ActivityIndicator color="#D7A948" /></View> : null}
  </View>;
}

function DocumentPreview({ title, source }: { title: string; source?: string | null }) {
  if (!source) return <View className="rounded-xl border border-[#273548] p-3"><Text className="text-right text-xs text-[#657286]">{title}: غير متوفر</Text></View>;
  return <View className="rounded-xl border border-[#273548] p-2">
    <Text className="mb-2 text-right text-xs font-semibold text-[#F7F1E3]">{title}</Text>
    <Image source={{ uri: source }} resizeMode="contain" style={{ width: "100%", height: 220, backgroundColor: "#05070A", borderRadius: 10 }} />
  </View>;
}

function AuditSummary({ value }: { value: string }) {
  const summary = useMemo(() => {
    try {
      const parsed: unknown = JSON.parse(value);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return value;
      const record = parsed as Record<string, unknown>;
      const eventLabels: Record<string, string> = {
        account_verification_status: "تغيير حالة توثيق الحساب",
        account_verification_review: "مراجعة مستندات الهوية",
        account_freeze_status: "تغيير حالة الحساب",
      };
      const event = typeof record.event === "string" ? eventLabels[record.event] ?? record.event : null;
      const fields = Object.entries(record).filter(([key]) => !["event", "occurredAt", "requestId"].includes(key));
      const readable = fields.map(([key, field]) => {
        if (field && typeof field === "object" && !Array.isArray(field)) {
          const change = field as { from?: unknown; to?: unknown };
          return `${key}: ${String(change.from ?? "—")} ← ${String(change.to ?? "—")}`;
        }
        return `${key}: ${String(field ?? "—")}`;
      });
      return [event, ...readable].filter(Boolean).join(" · ") || value;
    } catch {
      return value;
    }
  }, [value]);
  return <Text selectable className="mt-1 text-right text-[10px] leading-4 text-[#9BA8B8]">{summary}</Text>;
}
