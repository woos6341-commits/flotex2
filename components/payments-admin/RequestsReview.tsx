import { KeyboardAwareScrollView as ScrollView } from "@/components/KeyboardAwareScrollView";
import { useState } from "react";
import { ActivityIndicator, Image, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Card, EmptyState, Pill, formatMoney } from "@/components/atheer-ui";
import { trpc } from "@/lib/trpc";
import { normalizeAdminRequest, requestMethodLabel, requestNote, requestReferenceLabel, type AdminRequest } from "./types";
import { formatMoneyMinorUnits, parseMoneyMinorUnits } from "@/shared/transactions";

const styles = StyleSheet.create({
  reviewButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 12 },
  primaryButton: { backgroundColor: "#D7A948" },
  secondaryButton: { backgroundColor: "transparent", borderColor: "#273548", borderWidth: 1 },
  disabledButton: { opacity: 0.45 },
  reviewButtonText: { fontWeight: "700" },
  confirmationPressable: { marginTop: 16, flexDirection: "row", alignItems: "flex-start", gap: 12, borderRadius: 16, borderColor: "#5C4A28", borderWidth: 1, backgroundColor: "#0B1018", padding: 12 },
  checkbox: { marginTop: 2, height: 20, width: 20, borderRadius: 4, borderColor: "#657286", borderWidth: 1 },
  checkboxChecked: { borderColor: "#D7A948", backgroundColor: "#D7A948" },
});

type ReviewAction = "approved" | "rejected" | "completed";
type Props = { selectedRequestId?: number | null; onUpdated?: () => void };
type PendingCursor = { createdAt: string; id: number };

function ReviewButton({ label, icon, onPress, secondary = false, disabled = false }: { label: string; icon: keyof typeof Ionicons.glyphMap; onPress: () => void; secondary?: boolean; disabled?: boolean }) {
  const foreground = secondary ? "#D7A948" : "#0B1018";
  return <Pressable disabled={disabled} onPress={onPress} style={[styles.reviewButton, secondary ? styles.secondaryButton : styles.primaryButton, disabled && styles.disabledButton]}><Ionicons name={icon} size={18} color={foreground} /><Text style={[styles.reviewButtonText, { color: foreground }]}>{label}</Text></Pressable>;
}

function parseCustomFieldSnapshot(value?: string | null) {
  if (!value) return [] as { key: string; label: string; value: string }[];
  try {
    const parsed = JSON.parse(value) as { values?: Record<string, unknown>; labels?: Record<string, unknown> };
    const values = parsed.values && typeof parsed.values === "object" ? parsed.values : {};
    const labels = parsed.labels && typeof parsed.labels === "object" ? parsed.labels : {};
    return Object.entries(values).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0).map(([key, fieldValue]) => ({ key, label: typeof labels[key] === "string" ? labels[key] as string : key, value: fieldValue }));
  } catch { return []; }
}

function ReviewModal({ request, action, onClose, onConfirm, pending }: { request: AdminRequest; action: ReviewAction; onClose: () => void; onConfirm: (confirmedTransfer: boolean, payoutReference?: string, depositReference?: string, rejectionReason?: string) => void; pending: boolean }) {
  const [confirmed, setConfirmed] = useState(false);
  const [payoutReference, setPayoutReference] = useState("");
  const [depositReference, setDepositReference] = useState(request.transferReference ?? "");
  const [rejectionReason, setRejectionReason] = useState("");
  const isWithdrawal = request.type === "withdrawal";
  const isDeposit = request.type === "deposit";
  const isReject = action === "rejected";
  const amountMinor = parseMoneyMinorUnits(String(request.amount));
  const feeMinor = isWithdrawal ? parseMoneyMinorUnits(String(request.feeAmount ?? "0")) : 0;
  const totalDebit = formatMoneyMinorUnits(amountMinor + feeMinor);
  const canConfirm = isReject ? rejectionReason.trim().length >= 3 && rejectionReason.trim().length <= 500 : confirmed && (!isWithdrawal || payoutReference.trim().length >= 3) && (!isDeposit || depositReference.trim().length >= 3);
  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <ScrollView style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.70)" }} contentContainerStyle={{ flexGrow: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 20 }}>
        <View className="w-full max-w-lg rounded-3xl border border-[#273548] bg-[#121B28] p-5">
          <Text className="text-lg font-bold text-[#F7F1E3]">{isReject ? "تأكيد رفض الطلب" : isWithdrawal ? "تأكيد تنفيذ السحب" : "تأكيد اعتماد الإيداع"}</Text>
          <Text className="mt-2 text-sm leading-6 text-[#9BA8B8]">{isReject ? isWithdrawal ? "لن تُخصم رسوم؛ سيُحرّر كامل مبلغ السحب المحجوز بعد تسجيل سبب الرفض." : "لن تتم إضافة أو خصم أموال. الإيداع مجاني، وسيُسجل سبب الرفض." : isWithdrawal ? "أكّد أنك نفذت التحويل يدويًا قبل إكمال الطلب." : "لا تعتمد الطلب إلا بعد التأكد صراحةً من وصول الإيصال والتحويل فعليًا."}</Text>
          {isWithdrawal && <View className="mt-4 rounded-2xl border border-[#273548] bg-[#0B1018] p-3"><Text className="text-xs text-[#9BA8B8]">مبلغ السحب: {formatMoneyMinorUnits(amountMinor)}</Text><Text className="mt-1 text-xs text-[#9BA8B8]">الرسم المثبت للطلب: {formatMoneyMinorUnits(feeMinor)}</Text><Text className="mt-1 text-sm font-bold text-[#D7A948]">إجمالي الخصم عند التنفيذ: {totalDebit}</Text></View>}
          {isDeposit && <Text className="mt-3 text-xs text-[#47D7A5]">الإيداع مجاني دائمًا بلا رسوم.</Text>}
          {isReject && <><Text className="mt-4 text-xs text-[#9BA8B8]">سبب الرفض (إلزامي)</Text><TextInput value={rejectionReason} onChangeText={setRejectionReason} placeholder="اكتب سببًا واضحًا يظهر للعميل" placeholderTextColor="#657286" multiline maxLength={500} textAlign="right" textAlignVertical="top" className="mt-2 min-h-24 rounded-2xl border border-[#273548] bg-[#0B1018] px-4 py-3 text-[#F7F1E3]" /></>}
          {!isReject && isWithdrawal && <TextInput value={payoutReference} onChangeText={setPayoutReference} placeholder="مرجع التحويل/الصرف المطلوب" placeholderTextColor="#657286" className="mt-4 rounded-2xl border border-[#273548] bg-[#0B1018] px-4 py-3 text-[#F7F1E3]" />}
          {!isReject && isDeposit && <><Text className="mt-4 text-xs text-[#9BA8B8]">مرجع التحويل الوارد المؤكد</Text><TextInput value={depositReference} onChangeText={setDepositReference} placeholder="مرجع التحويل الوارد المؤكد" placeholderTextColor="#657286" className="mt-2 rounded-2xl border border-[#273548] bg-[#0B1018] px-4 py-3 text-[#F7F1E3]" /></>}
          {!isReject && <Pressable onPress={() => setConfirmed((value) => !value)} style={styles.confirmationPressable}>
            <View style={[styles.checkbox, confirmed && styles.checkboxChecked]} />
            <Text className="flex-1 text-sm leading-5 text-[#F7F1E3]">{isWithdrawal ? "أؤكد أنني حوّلت المبلغ يدويًا إلى العميل." : "أؤكد أنني راجعت الإيصال ووصل التحويل فعليًا."}</Text>
          </Pressable>}
          <View className="mt-5 flex-row gap-2"><View className="flex-1"><ReviewButton label="إلغاء" icon="close" secondary disabled={pending} onPress={onClose} /></View><View className="flex-1"><ReviewButton disabled={pending || !canConfirm} label={pending ? "جارٍ التنفيذ" : isReject ? "تأكيد الرفض" : isWithdrawal ? "تم التنفيذ" : "اعتماد الإيداع"} icon={isReject ? "close-circle-outline" : "checkmark-circle-outline"} onPress={() => onConfirm(!isReject && confirmed, isWithdrawal ? payoutReference.trim() : undefined, isDeposit ? depositReference.trim() : undefined, isReject ? rejectionReason.trim() : undefined)} /></View></View>
          {!canConfirm && !isReject && <Text className="mt-3 text-center text-xs text-[#FF7D8D]">يلزم التأكيد الصريح{isWithdrawal ? " ومرجع التحويل" : isDeposit ? " ومرجع التحويل الوارد" : ""} قبل المتابعة.</Text>}
        </View>
      </ScrollView>
    </Modal>
  );
}

function PendingRequestList({ type, selectedId, resolvedRequestIds, renderRequest }: { type: "deposit" | "withdrawal"; selectedId: number | null; resolvedRequestIds: Set<number>; renderRequest: (request: AdminRequest) => React.ReactNode }) {
  const [cursors, setCursors] = useState<(PendingCursor | undefined)[]>([undefined]);
  const cursor = cursors[cursors.length - 1];
  const query = trpc.admin.pendingPaymentRequests.useQuery({ type, limit: 25, ...(cursor ? { cursor } : {}) }, { refetchInterval: 10000, refetchOnWindowFocus: true });
  const items = (query.data?.items ?? []).map(normalizeAdminRequest).filter((item) => item.id !== selectedId && !resolvedRequestIds.has(item.id));
  const label = type === "deposit" ? "الإيداع" : "السحب";
  return <View>
    <Text className="mb-3 mt-4 text-lg font-bold text-[#F7F1E3]">طلبات {label} قيد المراجعة · الأقدم أولًا</Text>
    {query.isLoading ? <ActivityIndicator color="#D7A948" /> : query.isError ? <View><EmptyState title="تعذر تحميل الطلبات" text="تحقق من الاتصال وأعد المحاولة." /><ReviewButton label="إعادة المحاولة" icon="refresh" secondary onPress={() => void query.refetch()} /></View> : <>
      {items.length ? items.map(renderRequest) : <EmptyState title={`لا توجد طلبات ${label} أخرى في هذه الصفحة`} text="ستظهر الطلبات المعلقة هنا للمراجعة اليدوية." />}
      <View className="mb-4 flex-row items-center justify-between">
        <Pressable accessibilityRole="button" disabled={cursors.length === 1} onPress={() => setCursors((current) => current.slice(0, -1))} className="rounded-xl border border-[#273548] px-4 py-2"><Text className="text-[#D7A948]">السابق</Text></Pressable>
        <Text className="text-xs text-[#9BA8B8]">صفحة {cursors.length}</Text>
        <Pressable accessibilityRole="button" disabled={!query.data?.nextCursor} onPress={() => { if (query.data?.nextCursor) setCursors((current) => [...current, query.data!.nextCursor!]); }} className="rounded-xl border border-[#273548] px-4 py-2"><Text className="text-[#D7A948]">التالي</Text></Pressable>
      </View>
    </>}
  </View>;
}

export function RequestsReview({ selectedRequestId = null, onUpdated }: Props) {
  const [receiptRequestId, setReceiptRequestId] = useState<number | null>(null);
  const utils = trpc.useUtils();
  const [view, setView] = useState<"pending" | "archive">("pending");
  const [archiveOffset, setArchiveOffset] = useState(0);
  const [resolvedRequestIds, setResolvedRequestIds] = useState<Set<number>>(() => new Set());
  const review = trpc.admin.reviewRequest.useMutation();
  const receiptQuery = trpc.admin.receipt.useQuery({ requestId: receiptRequestId ?? 0 }, { enabled: receiptRequestId !== null });
  const archive = trpc.admin.paymentRequestArchive.useQuery({ offset: archiveOffset, limit: 25 }, { enabled: view === "archive", refetchOnWindowFocus: true });
  const selected = trpc.admin.paymentRequestById.useQuery({ requestId: selectedRequestId ?? 1 }, { enabled: selectedRequestId !== null, refetchInterval: 10000, refetchOnWindowFocus: true, gcTime: 0 });
  const [modal, setModal] = useState<{ request: AdminRequest; action: ReviewAction } | null>(null);
  const [feedback, setFeedback] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const selectedRequest = selected.data && selected.data.request.id === selectedRequestId ? normalizeAdminRequest(selected.data) : null;
  const archived = (archive.data?.items ?? []).map(normalizeAdminRequest);

  const openReceipt = (id: number) => {
    setReceiptRequestId(id);
    setFeedback(null);
  };

  const submit = (request: AdminRequest, action: ReviewAction, confirmedTransfer: boolean, payoutReference?: string, depositReference?: string, rejectionReason?: string) => {
    if (review.isPending) return;
    setFeedback(null);
    review.mutate({ requestId: request.id, status: action, ...(confirmedTransfer ? { confirmedTransfer: true } : {}), ...(payoutReference ? { payoutReference } : {}), ...(depositReference ? { depositReference } : {}), ...(rejectionReason ? { rejectionReason } : {}) }, {
      onSuccess: () => {
        setModal(null);
        setResolvedRequestIds((current) => new Set(current).add(request.id));
        setFeedback({ tone: "success", text: action === "rejected" ? "تم رفض الطلب" : request.type === "deposit" ? "تمت إضافة الأموال بنجاح وتمت الموافقة على إيداع العميل" : "تم تنفيذ السحب وخصم المبلغ بنجاح" });
        void utils.admin.pendingPaymentRequests.invalidate();
        void utils.admin.paymentRequestById.invalidate();
        void utils.admin.paymentRequestArchive.invalidate();
        onUpdated?.();
      },
      onError: (error) => { setFeedback({ tone: "error", text: error.message || "تعذر تحديث الطلب." }); void utils.admin.pendingPaymentRequests.invalidate(); void utils.admin.paymentRequestById.invalidate(); },
    });
  };

  const renderRequest = (request: AdminRequest) => {
    const receiptVisible = receiptRequestId === request.id;
    const receiptData = receiptQuery.data;
    return <Card key={request.id} className="mb-3">
      <View className="flex-row items-start justify-between gap-3"><View className="flex-1"><Text className="font-bold text-[#F7F1E3]">{request.customer?.customerId || "بدون ID"} · {request.customer?.name || "عميل"}</Text><Text className="mt-1 text-xs text-[#9BA8B8]">{request.customer?.email || "بدون بريد"}</Text><Text className="mt-1 text-sm font-bold text-[#D7A948]">{request.type === "withdrawal" ? `مبلغ السحب: ${formatMoney(request.amount)}` : `مبلغ الإيداع: ${formatMoney(request.amount)}`}</Text>{request.type === "withdrawal" ? <><Text className="mt-1 text-xs text-[#9BA8B8]">رسوم السحب المثبتة: {formatMoney(request.feeAmount ?? 0)}</Text><Text className="mt-1 text-sm font-bold text-[#D7A948]">إجمالي الخصم عند التنفيذ: {formatMoney(formatMoneyMinorUnits(parseMoneyMinorUnits(String(request.amount)) + parseMoneyMinorUnits(String(request.feeAmount ?? "0"))))}</Text></> : <Text className="mt-1 text-xs text-[#47D7A5]">الإيداع مجاني بلا رسوم</Text>}<Text className="mt-1 text-xs text-[#9BA8B8]">الطريقة: {requestMethodLabel(request)}</Text><Text className="mt-1 text-xs text-[#9BA8B8]">{request.type === "withdrawal" ? "الوجهة" : "المرجع"}: {requestReferenceLabel(request)}</Text>{request.transferNumberSnapshot && <Text className="mt-1 text-xs text-[#657286]">رقم التحويل وقت الطلب: {request.transferNumberSnapshot}</Text>}{requestNote(request) && <Text className="mt-1 text-xs text-[#657286]">ملاحظة: {requestNote(request)}</Text>}</View><Pill>قيد المراجعة</Pill></View>
      {parseCustomFieldSnapshot(request.customFields).length ? <View className="mt-3 rounded-xl border border-[#273548] bg-[#0B1018] p-3">{parseCustomFieldSnapshot(request.customFields).map((field) => <Text key={field.key} className="mt-1 text-xs text-[#9BA8B8]">{field.label}: {field.value}</Text>)}</View> : null}
      {request.type === "deposit" && <View className="mt-4"><ReviewButton label={receiptVisible ? "إخفاء صورة التحويل" : "عرض صورة التحويل"} icon="image-outline" secondary onPress={() => receiptVisible ? setReceiptRequestId(null) : openReceipt(request.id)} />{receiptVisible && <View className="mt-3 min-h-[180px] items-center justify-center rounded-2xl border border-[#273548] bg-[#0B1018] p-2">{receiptQuery.isFetching ? <ActivityIndicator color="#D7A948" /> : receiptQuery.isError ? <Text className="text-sm text-[#FF7D8D]">{receiptQuery.error?.message || "تعذر تحميل صورة التحويل."}</Text> : receiptData?.dataUrl ? <Image source={{ uri: receiptData.dataUrl }} resizeMode="contain" className="h-56 w-full" /> : <Text className="text-sm text-[#FF7D8D]">تعذر العثور على صورة التحويل.</Text>}</View>}</View>}
      <View className="mt-4 flex-row gap-2"><View className="flex-1"><ReviewButton disabled={review.isPending} label="رفض" icon="close" secondary onPress={() => setModal({ request, action: "rejected" })} /></View><View className="flex-1"><ReviewButton disabled={review.isPending} label={request.type === "withdrawal" ? "تم التنفيذ" : "اعتماد"} icon="checkmark" onPress={() => setModal({ request, action: request.type === "withdrawal" ? "completed" : "approved" })} /></View></View>
    </Card>;
  };

  const renderArchiveRequest = (request: AdminRequest) => {
    const statusLabel = request.status === "approved" ? "تمت الموافقة" : request.status === "completed" ? "مكتمل" : request.status === "rejected" ? "مرفوض" : request.status;
    const reviewedLabel = request.reviewedAt ? new Date(request.reviewedAt).toLocaleString("ar-EG") : "وقت القرار غير متاح";
    return <Card key={request.id} className="mb-3">
      <View className="flex-row items-start justify-between gap-3"><View className="flex-1"><Text className="font-bold text-[#F7F1E3]">{request.customer?.customerId || "بدون ID"} · {request.customer?.name || "عميل"}</Text><Text className="mt-1 text-xs text-[#9BA8B8]">{request.customer?.email || "بدون بريد"}</Text><Text className="mt-1 text-sm font-bold text-[#D7A948]">{request.type === "withdrawal" ? `مبلغ السحب: ${formatMoney(request.amount)}` : `مبلغ الإيداع: ${formatMoney(request.amount)}`}</Text><Text className="mt-1 text-xs text-[#9BA8B8]">الطريقة: {requestMethodLabel(request)}</Text><Text className="mt-1 text-xs text-[#9BA8B8]">{request.type === "withdrawal" ? "الوجهة" : "المرجع"}: {requestReferenceLabel(request)}</Text><Text className="mt-1 text-xs text-[#9BA8B8]">تاريخ القرار: {reviewedLabel}</Text>{requestNote(request) ? <Text className="mt-1 text-xs text-[#657286]">ملاحظة: {requestNote(request)}</Text> : null}{request.rejectionReason ? <Text className="mt-1 text-xs text-[#FF7D8D]">سبب الرفض: {request.rejectionReason}</Text> : null}</View><Pill>{statusLabel}</Pill></View>
      {parseCustomFieldSnapshot(request.customFields).length ? <View className="mt-3 rounded-xl border border-[#273548] bg-[#0B1018] p-3">{parseCustomFieldSnapshot(request.customFields).map((field) => <Text key={field.key} className="mt-1 text-xs text-[#9BA8B8]">{field.label}: {field.value}</Text>)}</View> : null}
    </Card>;
  };

  return <View className="mt-2">
    {feedback && <Text className={`mb-3 text-sm ${feedback.tone === "error" ? "text-[#FF7D8D]" : "text-[#47D7A5]"}`}>{feedback.text}</Text>}
    <View className="mb-3 mt-2 flex-row gap-2">
      {([{ id: "pending", label: "المعلقة والمراجعة" }, { id: "archive", label: "الأرشيف" }] as const).map((item) => <Pressable key={item.id} onPress={() => { setView(item.id); setArchiveOffset(0); }} className={`flex-1 items-center rounded-xl border px-3 py-3 ${view === item.id ? "border-[#D7A948] bg-[#D7A94822]" : "border-[#273548] bg-[#121B28]"}`}><Text className={`text-xs font-bold ${view === item.id ? "text-[#D7A948]" : "text-[#9BA8B8]"}`}>{item.label}</Text></Pressable>)}
    </View>
    {selectedRequestId !== null && view === "pending" ? <View className="mb-4 rounded-2xl border border-[#D7A948] p-3">
      <Text className="mb-3 font-bold text-[#D7A948]">الطلب المحدد · #{selectedRequestId}</Text>
      {selected.isFetching ? <ActivityIndicator color="#D7A948" /> : selected.isError ? <View><Text className="mb-2 text-[#FF7D8D]">تعذر تحميل الطلب المحدد.</Text><ReviewButton label="إعادة المحاولة" icon="refresh" secondary onPress={() => void selected.refetch()} /></View> : !selectedRequest ? <Text className="text-[#9BA8B8]">الطلب المحدد غير متاح.</Text> : selectedRequest.status !== "pending" ? <><Text className="mb-2 text-[#9BA8B8]">هذا الطلب لم يعد معلقًا؛ لا تتوفر إجراءات قرار له.</Text>{renderArchiveRequest(selectedRequest)}</> : resolvedRequestIds.has(selectedRequest.id) ? <Text className="text-[#9BA8B8]">جارٍ تحديث حالة الطلب.</Text> : renderRequest(selectedRequest)}
    </View> : null}
    {view === "pending" ? <>
      <PendingRequestList type="deposit" selectedId={selectedRequest && !selected.isError ? selectedRequestId : null} resolvedRequestIds={resolvedRequestIds} renderRequest={renderRequest} />
      <PendingRequestList type="withdrawal" selectedId={selectedRequest && !selected.isError ? selectedRequestId : null} resolvedRequestIds={resolvedRequestIds} renderRequest={renderRequest} />
    </> : archive.isLoading ? <ActivityIndicator color="#D7A948" /> : archive.isError ? <EmptyState title="تعذر تحميل الأرشيف" text="أعد المحاولة لعرض القرارات السابقة." /> : archived.length ? <>
      <Text className="mb-3 mt-2 text-lg font-bold text-[#F7F1E3]">القرارات النهائية · {archive.data?.total ?? 0}</Text>
      {archived.map(renderArchiveRequest)}
      <View className="mb-4 flex-row items-center justify-between"><Pressable accessibilityRole="button" disabled={archiveOffset === 0} onPress={() => setArchiveOffset((value) => Math.max(0, value - 25))} className="rounded-xl border border-[#273548] px-4 py-2"><Text className="text-[#D7A948]">الأحدث</Text></Pressable><Text className="text-xs text-[#9BA8B8]">صفحة {Math.floor(archiveOffset / 25) + 1} من {Math.max(1, Math.ceil((archive.data?.total ?? 0) / 25))}</Text><Pressable accessibilityRole="button" disabled={archiveOffset + 25 >= (archive.data?.total ?? 0)} onPress={() => setArchiveOffset((value) => value + 25)} className="rounded-xl border border-[#273548] px-4 py-2"><Text className="text-[#D7A948]">الأقدم</Text></Pressable></View>
    </> : <EmptyState title="الأرشيف فارغ" text="ستظهر هنا الطلبات التي تمت الموافقة عليها أو رفضها مع وقت القرار." />}
    {modal && <ReviewModal request={modal.request} action={modal.action} pending={review.isPending} onClose={() => !review.isPending && setModal(null)} onConfirm={(confirmedTransfer, payoutReference, depositReference, rejectionReason) => submit(modal.request, modal.action, confirmedTransfer, payoutReference, depositReference, rejectionReason)} />}
  </View>;
}
