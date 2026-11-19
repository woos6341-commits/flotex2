import { KeyboardAwareScrollView as ScrollView } from "@/components/KeyboardAwareScrollView";
import { useState } from "react";
import { ActivityIndicator, Modal, Pressable, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ActionButton, Card, EmptyState, Pill, formatMoney } from "@/components/atheer-ui";
import { VerifiedName } from "@/components/VerifiedName";
import { trpc } from "@/lib/trpc";
import { isValidDateOnly } from "../../shared/date-only";

type TransferStatus = "pending" | "approved" | "rejected" | "cancelled";
type TransferRow = {
  id: number;
  reference: string;
  amount: string;
  feeAmount: string;
  totalDebit: string;
  status: TransferStatus;
  note: string | null;
  rejectionReason: string | null;
  createdAt: Date | string;
  sender: { name: string; customerId: string | null; isVerified: boolean };
  recipient: { name: string; customerId: string | null; isVerified: boolean };
};
type Action = "approved" | "rejected";
const PAGE_SIZE = 50;
const FILTERS: { value: "all" | TransferStatus; label: string }[] = [
  { value: "all", label: "الكل" },
  { value: "pending", label: "معلقة" },
  { value: "approved", label: "مقبولة" },
  { value: "rejected", label: "مرفوضة" },
  { value: "cancelled", label: "ملغاة" },
];
const STATUS_LABELS: Record<TransferStatus, string> = {
  pending: "قيد المراجعة",
  approved: "مقبولة",
  rejected: "مرفوضة",
  cancelled: "ملغاة",
};

function statusTone(status: TransferStatus): "gold" | "green" | "red" | "muted" {
  if (status === "approved") return "green";
  if (status === "rejected") return "red";
  if (status === "cancelled") return "muted";
  return "gold";
}

function TransferMinimumSetting() {
  const limits = trpc.admin.limits.useQuery(undefined);
  const update = trpc.admin.updateLimits.useMutation();
  const [draftOverride, setDraftOverride] = useState<string | null>(null);
  const draft = draftOverride ?? String(limits.data?.minTransferAmount ?? 1200);
  const [feedback, setFeedback] = useState<{ error: boolean; text: string } | null>(null);
  const save = () => {
    const value = draft.trim();
    if (!/^\d+(?:\.\d{1,2})?$/.test(value) || Number(value) <= 0) {
      setFeedback({ error: true, text: "أدخل حدًا أدنى صحيحًا أكبر من صفر." });
      return;
    }
    setFeedback(null);
    update.mutate({ minTransferAmount: value }, {
      onSuccess: () => {
        setFeedback({ error: false, text: "تم حفظ الحد الأدنى على الخادم." });
        void limits.refetch();
      },
      onError: (error) => setFeedback({ error: true, text: error.message || "تعذر حفظ الحد." }),
    });
  };
  return (
    <Card className="mb-4">
      <Text className="text-base font-bold text-[#F7F1E3]">الحد الأدنى لإرسال الأموال</Text>
      <Text className="mt-1 text-xs leading-5 text-[#9BA8B8]">1200 ج.م افتراضيًا. يتحقق الخادم من هذا الحد قبل حجز أي مبلغ.</Text>
      {limits.isLoading ? <ActivityIndicator className="mt-4" color="#D7A948" /> : <>
        <TextInput
          value={draft}
          onChangeText={(text) => setDraftOverride(text.replace(/[^0-9.]/g, ""))}
          keyboardType="decimal-pad"
          textAlign="right"
          placeholder="1200"
          placeholderTextColor="#657286"
          className="mt-3 rounded-2xl border border-[#273548] bg-[#0B1018] px-4 py-3 text-[#F7F1E3]"
        />
        {feedback && <Text className={`mt-2 text-sm ${feedback.error ? "text-[#FF7D8D]" : "text-[#47D7A5]"}`}>{feedback.text}</Text>}
        <View className="mt-3"><ActionButton label={update.isPending ? "جارٍ الحفظ" : "حفظ الحد"} icon="save-outline" onPress={save} /></View>
      </>}
    </Card>
  );
}

export function MoneyTransferRequestsAdmin({ onUpdated }: { onUpdated?: () => void }) {
  const [searchDraft, setSearchDraft] = useState("");
  const [fromDraft, setFromDraft] = useState("");
  const [toDraft, setToDraft] = useState("");
  const [filters, setFilters] = useState<{ search?: string; status: "all" | TransferStatus; fromDate?: string; toDate?: string }>({ status: "pending" });
  const [selected, setSelected] = useState<{ transfer: TransferRow; action: Action } | null>(null);
  const [reason, setReason] = useState("");
  const [offset, setOffset] = useState(0);
  const [feedback, setFeedback] = useState<{ error: boolean; text: string } | null>(null);
  const query = trpc.admin.moneyTransfers.useQuery({ ...filters, offset, limit: PAGE_SIZE }, { refetchInterval: 15000, refetchOnWindowFocus: true });
  const review = trpc.admin.reviewMoneyTransfer.useMutation();
  const rows = (query.data?.rows ?? []) as TransferRow[];
  const total = query.data?.total ?? 0;

  const applyFilters = () => {
    if ((fromDraft && !isValidDateOnly(fromDraft)) || (toDraft && !isValidDateOnly(toDraft))) {
      setFeedback({ error: true, text: "أدخل تاريخًا تقويميًا صحيحًا بصيغة YYYY-MM-DD." });
      return;
    }
    if (fromDraft && toDraft && fromDraft > toDraft) {
      setFeedback({ error: true, text: "تاريخ النهاية لا يمكن أن يسبق تاريخ البداية." });
      return;
    }
    setFeedback(null);
    setOffset(0);
    setFilters((current) => ({ ...current, search: searchDraft.trim() || undefined, fromDate: fromDraft || undefined, toDate: toDraft || undefined }));
  };

  const submitReview = () => {
    if (!selected || review.isPending) return;
    if (selected.action === "rejected" && reason.trim().length < 3) {
      setFeedback({ error: true, text: "سبب الرفض إلزامي، اكتب ثلاثة أحرف على الأقل." });
      return;
    }
    setFeedback(null);
    review.mutate({ transferId: selected.transfer.id, action: selected.action, ...(selected.action === "rejected" ? { rejectionReason: reason.trim() } : {}) }, {
      onSuccess: () => {
        setSelected(null);
        setReason("");
        setFeedback({ error: false, text: selected.action === "approved" ? "تم اعتماد التحويل وإتمامه مرة واحدة." : "تم رفض الطلب وإعادة المبلغ المحجوز." });
        void query.refetch();
        onUpdated?.();
      },
      onError: (error) => setFeedback({ error: true, text: error.message || "تعذرت مراجعة الطلب." }),
    });
  };

  return (
    <View className="mt-2">
      <TransferMinimumSetting />
      <Card className="mb-4">
        <Text className="text-lg font-bold text-[#F7F1E3]">البحث والفلاتر</Text>
        <TextInput value={searchDraft} onChangeText={setSearchDraft} placeholder="ID العميل أو رقم الطلب" placeholderTextColor="#657286" autoCapitalize="characters" textAlign="right" className="mt-3 rounded-2xl border border-[#273548] bg-[#0B1018] px-4 py-3 text-[#F7F1E3]" />
        <View className="mt-3 flex-row gap-2">
          <TextInput value={fromDraft} onChangeText={setFromDraft} placeholder="من تاريخ YYYY-MM-DD" placeholderTextColor="#657286" textAlign="right" className="min-w-0 flex-1 rounded-2xl border border-[#273548] bg-[#0B1018] px-3 py-3 text-xs text-[#F7F1E3]" />
          <TextInput value={toDraft} onChangeText={setToDraft} placeholder="إلى تاريخ YYYY-MM-DD" placeholderTextColor="#657286" textAlign="right" className="min-w-0 flex-1 rounded-2xl border border-[#273548] bg-[#0B1018] px-3 py-3 text-xs text-[#F7F1E3]" />
        </View>
        <Pressable accessibilityRole="button" onPress={applyFilters} className="mt-3 flex-row items-center justify-center gap-2 rounded-2xl bg-[#D7A948] px-4 py-3">
          <Ionicons name="search-outline" size={17} color="#0B1018" /><Text className="font-bold text-[#0B1018]">تطبيق البحث</Text>
        </Pressable>
        <View className="mt-4 flex-row flex-wrap gap-2">
          {FILTERS.map((filter) => <Pressable key={filter.value} onPress={() => { setOffset(0); setFilters((current) => ({ ...current, status: filter.value })); }} className={`rounded-full border px-3 py-2 ${filters.status === filter.value ? "border-[#D7A948] bg-[#D7A94822]" : "border-[#273548] bg-[#0B1018]"}`}><Text className={`text-xs font-semibold ${filters.status === filter.value ? "text-[#D7A948]" : "text-[#9BA8B8]"}`}>{filter.label}</Text></Pressable>)}
        </View>
      </Card>
      {feedback && <Text className={`mb-3 text-sm ${feedback.error ? "text-[#FF7D8D]" : "text-[#47D7A5]"}`}>{feedback.text}</Text>}
      <Text className="mb-3 text-xs text-[#9BA8B8]">{total ? `عرض ${offset + 1}–${Math.min(offset + rows.length, total)} من ${total} طلب` : "إجمالي النتائج: 0"}</Text>
      {query.isLoading ? <ActivityIndicator color="#D7A948" /> : query.isError ? <Text className="text-sm text-[#FF7D8D]">تعذر تحميل طلبات التحويل.</Text> : rows.length ? rows.map((transfer) => (
        <Card key={transfer.id} className="mb-3">
          <View className="flex-row items-start justify-between gap-3"><View className="min-w-0 flex-1"><Text className="font-bold text-[#F7F1E3]">طلب #{transfer.id}</Text><Text selectable className="mt-1 text-xs text-[#657286]">{transfer.reference}</Text></View><Pill tone={statusTone(transfer.status)}>{STATUS_LABELS[transfer.status]}</Pill></View>
          <View className="mt-3 rounded-2xl border border-[#273548] bg-[#0B1018] p-3">
            <Text className="text-xs text-[#9BA8B8]">المرسل</Text><VerifiedName name={transfer.sender.name} verified={transfer.sender.isVerified} nameClassName="text-sm font-semibold text-[#F7F1E3]" className="mt-1" /><Text className="mt-1 text-xs text-[#657286]">ID {transfer.sender.customerId || "—"}</Text>
            <Text className="mt-3 text-xs text-[#9BA8B8]">المستلم</Text><VerifiedName name={transfer.recipient.name} verified={transfer.recipient.isVerified} nameClassName="text-sm font-semibold text-[#F7F1E3]" className="mt-1" /><Text className="mt-1 text-xs text-[#657286]">ID {transfer.recipient.customerId || "—"}</Text>
          </View>
          <View className="mt-3 rounded-2xl border border-[#273548] bg-[#0B1018] p-3">
            <Text className="text-sm text-[#F7F1E3]">المبلغ الذي يصل للمستلم: {formatMoney(transfer.amount)}</Text>
            <Text className="mt-1 text-sm text-[#9BA8B8]">رسوم الإرسال: {formatMoney(transfer.feeAmount)}</Text>
            <Text className="mt-1 text-sm font-bold text-[#D7A948]">إجمالي الخصم من المرسل: {formatMoney(transfer.totalDebit)}</Text>
          </View>
          <Text className="mt-1 text-xs text-[#9BA8B8]">{new Date(transfer.createdAt).toLocaleString("ar-EG")}</Text>
          {transfer.note && <Text className="mt-2 text-xs leading-5 text-[#9BA8B8]">ملاحظة المرسل: {transfer.note}</Text>}
          {transfer.rejectionReason && <Text className="mt-2 text-xs leading-5 text-[#FF7D8D]">سبب الرفض: {transfer.rejectionReason}</Text>}
          {transfer.status === "pending" && <View className="mt-4 flex-row gap-2">
            <Pressable disabled={review.isPending} onPress={() => { setFeedback(null); setReason(""); setSelected({ transfer, action: "rejected" }); }} className="flex-1 items-center rounded-2xl border border-[#273548] px-3 py-3"><Text className="font-bold text-[#FF7D8D]">رفض</Text></Pressable>
            <Pressable disabled={review.isPending} onPress={() => { setFeedback(null); setReason(""); setSelected({ transfer, action: "approved" }); }} className="flex-1 items-center rounded-2xl bg-[#D7A948] px-3 py-3"><Text className="font-bold text-[#0B1018]">قبول</Text></Pressable>
          </View>}
        </Card>
      )) : <EmptyState title="لا توجد طلبات تحويل" text="ستظهر هنا طلبات إرسال الأموال المطابقة للفلاتر، بما فيها الطلبات المعلقة والمقبولة والمرفوضة." />}
      {total > PAGE_SIZE && <View className="mb-5 mt-2 flex-row gap-2"><Pressable disabled={offset === 0} onPress={() => setOffset((value) => Math.max(0, value - PAGE_SIZE))} className={`flex-1 items-center rounded-2xl border px-3 py-3 ${offset === 0 ? "border-[#273548] opacity-40" : "border-[#D7A948]"}`}><Text className="font-semibold text-[#D7A948]">السابق</Text></Pressable><Pressable disabled={offset + PAGE_SIZE >= total} onPress={() => setOffset((value) => value + PAGE_SIZE)} className={`flex-1 items-center rounded-2xl border px-3 py-3 ${offset + PAGE_SIZE >= total ? "border-[#273548] opacity-40" : "border-[#D7A948]"}`}><Text className="font-semibold text-[#D7A948]">التالي</Text></Pressable></View>}
      {selected && <Modal transparent animationType="fade" visible onRequestClose={() => !review.isPending && setSelected(null)}>
        <ScrollView style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.70)" }} contentContainerStyle={{ flexGrow: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 20 }}>
          <View className="w-full max-w-lg rounded-3xl border border-[#273548] bg-[#121B28] p-5">
            <Text className="text-lg font-bold text-[#F7F1E3]">{selected.action === "approved" ? "تأكيد قبول التحويل" : "رفض طلب التحويل"}</Text>
            <Text className="mt-2 text-sm leading-6 text-[#9BA8B8]">{selected.transfer.reference} · {formatMoney(selected.transfer.amount)} · {selected.transfer.sender.name} ← {selected.transfer.recipient.name}</Text>
            {selected.action === "rejected" && <>
              <Text className="mt-4 text-xs text-[#9BA8B8]">سبب الرفض (إلزامي)</Text>
              <TextInput value={reason} onChangeText={setReason} placeholder="اكتب سببًا واضحًا يظهر للمرسل" placeholderTextColor="#657286" multiline maxLength={500} textAlign="right" textAlignVertical="top" className="mt-2 min-h-24 rounded-2xl border border-[#273548] bg-[#0B1018] px-4 py-3 text-[#F7F1E3]" />
            </>}
            <View className="mt-5 flex-row gap-2">
              <Pressable disabled={review.isPending} onPress={() => setSelected(null)} className="flex-1 items-center rounded-2xl border border-[#273548] px-3 py-3"><Text className="font-semibold text-[#9BA8B8]">إلغاء</Text></Pressable>
              <Pressable disabled={review.isPending || (selected.action === "rejected" && reason.trim().length < 3)} onPress={submitReview} className={`flex-1 items-center rounded-2xl px-3 py-3 ${selected.action === "approved" ? "bg-[#D7A948]" : "bg-[#FF7D8D]"}`}><Text className="font-bold text-[#0B1018]">{review.isPending ? "جارٍ التنفيذ" : selected.action === "approved" ? "تأكيد القبول" : "تأكيد الرفض"}</Text></Pressable>
            </View>
            {selected.action === "rejected" && reason.trim().length < 3 && <Text className="mt-3 text-center text-xs text-[#FF7D8D]">لا يمكن الرفض دون كتابة السبب.</Text>}
          </View>
        </ScrollView>
      </Modal>}
    </View>
  );
}
