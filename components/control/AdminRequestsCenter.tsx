import { useMemo, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Card, Pill, formatMoney } from "@/components/atheer-ui";
import { trpc } from "@/lib/trpc";
import { formatEgyptDateTime } from "@/shared/ui-button-visibility";
import type { ControlSection } from "./ControlMenu";
import type { OperationSection } from "./OperationsSummary";

type RequestItem = {
  key: string; title: string; subtitle: string; section: ControlSection; tab?: "payments" | "transfers";
  userId?: number; category?: "account" | "freeze" | "external_transaction"; guestTicketId?: number; icon: keyof typeof Ionicons.glyphMap;
  createdAt: string; status: string; pending: boolean; decisionAt?: string | null; decisionByName?: string | null;
};
type QueryLike = { data?: unknown; isLoading?: boolean; isError?: boolean };
type Operation = {
  key: string; section: ControlSection; requestTab?: "payments" | "transfers"; title: string; customerName: string;
  customerId: string; userId?: number; category?: "account" | "freeze" | "external_transaction"; guestTicketId?: number; amount: string | null; unit: "EGP" | "COIN" | "NONE"; reference: string; createdAt: string;
  status: string; pending: boolean; decisionAt?: string | null; decisionByName?: string | null;
};
type StatusFilter = "pending" | "history" | "all";

const operationIcons: Record<string, keyof typeof Ionicons.glyphMap> = {
  requests: "wallet-outline", savings: "pie-chart-outline", gold: "diamond-outline", coin: "layers-outline",
  externalTransfers: "globe-outline", gameTopup: "game-controller-outline", accountVerification: "shield-checkmark-outline",
  phoneChange: "call-outline", phoneVerification: "phone-portrait-outline", supportMessaging: "chatbubbles-outline", guestSupport: "chatbubble-ellipses-outline",
};
const sections: { id: OperationSection | "all"; title: string }[] = [
  { id: "all", title: "كل الخدمات" }, { id: "requests", title: "المحفظة" }, { id: "savings", title: "الادخار" },
  { id: "gameTopup", title: "الألعاب" }, { id: "externalTransfers", title: "الخارجية" }, { id: "gold", title: "الذهب" },
  { id: "coin", title: "الكوين" }, { id: "accountVerification", title: "التوثيق" }, { id: "phoneChange", title: "الهاتف" },
  { id: "phoneVerification", title: "تأكيد الهاتف" }, { id: "supportMessaging", title: "الدعم" }, { id: "guestSupport", title: "مراسلات الزوار" },
];
const statusLabels: Record<string, string> = {
  pending: "قيد المراجعة", pending_approval: "بانتظار الموافقة", pending_review: "قيد المراجعة", new: "جديد",
  under_review: "قيد المراجعة", awaiting_details: "بانتظار استكمال البيانات", awaiting_execution: "بانتظار التنفيذ",
  processing: "قيد التنفيذ", approved: "مقبول", rejected: "مرفوض", completed: "مكتمل", executed: "تم التنفيذ",
  delivered: "تم التسليم", active: "نشط", refunded: "مسترد", cancelled: "ملغي", open: "نشط", closed: "مغلق", replied: "تم الرد", pending_reply: "قيد المراجعة",
};
const statusLabel = (status: string) => statusLabels[status] ?? status;
const egDate = (value: string | Date | null | undefined, fallback: string) => formatEgyptDateTime(value, fallback);

function operationRows(query: QueryLike): RequestItem[] {
  if (!Array.isArray(query.data)) return [];
  return (query.data as Operation[]).map((item) => ({
    key: item.key,
    title: item.title,
    subtitle: `${item.customerName}${item.customerId ? ` · ${item.customerId}` : ""} · ${item.reference} · ${item.unit === "NONE" || item.amount === null ? "حسب الاتفاق" : item.unit === "COIN" ? `${item.amount} كوين` : formatMoney(item.amount)} · ${statusLabel(item.status)}`,
    section: item.section,
    tab: item.requestTab,
    userId: item.userId, category: item.category, guestTicketId: item.guestTicketId,
    icon: operationIcons[item.section] ?? "document-text-outline",
    createdAt: item.createdAt,
    status: statusLabel(item.status),
    pending: item.pending,
    decisionAt: item.decisionAt ?? null,
    decisionByName: item.decisionByName ?? null,
  }));
}

export function AdminRequestsCenter({ onSelect }: { onSelect: (section: ControlSection, tab?: "payments" | "transfers", userId?: number, category?: "account" | "freeze" | "external_transaction", guestTicketId?: number, operationKey?: string) => void }) {
  const [open, setOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");
  const [sectionFilter, setSectionFilter] = useState<OperationSection | "all">("all");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const operations = trpc.admin.recentOperations.useQuery({ limit: 100, offset, pendingOnly: statusFilter === "pending", historyOnly: statusFilter === "history", search: search.trim() || undefined, section: sectionFilter === "all" ? undefined : sectionFilter }, { refetchInterval: 8000, refetchOnWindowFocus: true });
  const pendingOperations = trpc.admin.recentOperations.useQuery({ limit: 100, offset: 0, pendingOnly: true, historyOnly: false }, { refetchInterval: 8000, refetchOnWindowFocus: true });
  const items = useMemo(() => {
    const operationItems = operationRows(operations);
    const query = search.trim().toLocaleLowerCase("ar-EG");
    return operationItems
      .filter((item) => statusFilter === "all" || (statusFilter === "pending" ? item.pending : !item.pending))
      .filter((item) => sectionFilter === "all" || item.section === sectionFilter)
      .filter((item) => !query || `${item.title} ${item.subtitle} ${item.status} ${item.decisionByName ?? ""}`.toLocaleLowerCase("ar-EG").includes(query))
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() || a.key.localeCompare(b.key));
  }, [operations, statusFilter, sectionFilter, search]);
  const total = pendingOperations.isError ? null : operationRows(pendingOperations).length;
  const loading = operations.isLoading;
  const incomplete = operations.isError || pendingOperations.isError;
  const retryQueries = () => {
    if (operations.isFetching || pendingOperations.isFetching) return;
    void Promise.all([operations.refetch(), pendingOperations.refetch()]);
  };
  const hasMore = Array.isArray(operations.data) && operations.data.length === 100 && offset < 10_000;

  return <>
    <Pressable accessibilityRole="button" onPress={() => setOpen(true)} style={({ pressed }) => ({ alignSelf: "flex-end", marginBottom: 10, minHeight: 38, paddingHorizontal: 13, borderRadius: 14, borderWidth: 1, borderColor: total ? "#D7A948" : "#273548", backgroundColor: total ? "#D7A94818" : "#121B28", flexDirection: "row", alignItems: "center", gap: 7, opacity: pressed ? 0.78 : 1 })}>
      <Ionicons name="notifications-outline" size={17} color={pendingOperations.isError ? "#FF9BA7" : total ? "#D7A948" : "#9BA8B8"} /><Text style={{ color: pendingOperations.isError ? "#FF9BA7" : total ? "#D7A948" : "#9BA8B8", fontSize: 12, fontWeight: "800" }}>{pendingOperations.isError ? "تعذر تحميل الطلبات" : "مركز الطلبات"}</Text>{total ? <View style={{ minWidth: 21, height: 21, borderRadius: 11, backgroundColor: "#FF3B4E", alignItems: "center", justifyContent: "center" }}><Text style={{ color: "#fff", fontSize: 11, fontWeight: "900" }}>{total > 99 ? "99+" : total}</Text></View> : null}
    </Pressable>
    <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
      <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.65)" }}><View style={{ maxHeight: "90%", borderTopLeftRadius: 26, borderTopRightRadius: 26, backgroundColor: "#0B1018", padding: 18 }}>
        <View className="flex-row items-center justify-between"><Pressable onPress={() => setOpen(false)}><Text className="text-sm font-bold text-[#D7A948]">إغلاق</Text></Pressable><View><Text className="text-xl font-bold text-[#F7F1E3]" style={{ textAlign: "right" }}>مركز الطلبات</Text><Text className="mt-1 text-xs text-[#9BA8B8]" style={{ textAlign: "right" }}>الفرز من الأقدم إلى الأحدث؛ تظهر بيانات القرار في الأرشيف</Text></View></View>
        <TextInput value={search} onChangeText={(value) => { setSearch(value); setOffset(0); }} maxLength={100} placeholder="بحث بالاسم أو رقم الحساب أو المرجع أو النوع..." placeholderTextColor="#657286" autoCapitalize="none" className="mt-4 rounded-xl border border-[#273548] bg-[#121B28] px-3 py-3 text-sm text-[#F7F1E3]" style={{ textAlign: "right" }} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mt-3 max-h-11"><View className="flex-row gap-2">{(["pending", "history", "all"] as StatusFilter[]).map((filter) => <Pressable key={filter} accessibilityRole="button" accessibilityState={{ selected: statusFilter === filter }} onPress={() => { setStatusFilter(filter); setOffset(0); }} className={`rounded-full border px-3 py-2 ${statusFilter === filter ? "border-[#D7A948] bg-[#D7A94822]" : "border-[#273548] bg-[#121B28]"}`}><Text className={`text-xs font-bold ${statusFilter === filter ? "text-[#D7A948]" : "text-[#9BA8B8]"}`}>{filter === "pending" ? "قيد المتابعة" : filter === "history" ? "الأرشيف" : "الكل"}</Text></Pressable>)}</View></ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mt-2 max-h-11"><View className="flex-row gap-2">{sections.map((item) => <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected: sectionFilter === item.id }} onPress={() => { setSectionFilter(item.id); setOffset(0); }} className={`rounded-full border px-3 py-2 ${sectionFilter === item.id ? "border-[#D7A948] bg-[#D7A94822]" : "border-[#273548] bg-[#121B28]"}`}><Text className={`text-xs font-bold ${sectionFilter === item.id ? "text-[#D7A948]" : "text-[#9BA8B8]"}`}>{item.title}</Text></Pressable>)}</View></ScrollView>
        {incomplete ? <View className="mt-3 flex-row items-center justify-between gap-2"><Text accessibilityRole="alert" className="flex-1 text-right text-xs text-[#FF7D8D]">تعذر تحميل بعض الطلبات؛ لا يعني ذلك عدم وجود طلبات. أعد المحاولة أو تحقق من اتصال قاعدة البيانات.</Text><Pressable accessibilityRole="button" accessibilityLabel="إعادة تحميل الطلبات" disabled={operations.isFetching || pendingOperations.isFetching} onPress={retryQueries} className="rounded-xl border border-[#5C4A28] px-3 py-2"><Text className="text-xs font-bold text-[#D7A948]">{operations.isFetching || pendingOperations.isFetching ? "جارٍ..." : "إعادة المحاولة"}</Text></Pressable></View> : null}
        {loading ? <ActivityIndicator className="mt-6" color="#D7A948" /> : items.length ? <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ gap: 8, paddingTop: 14, paddingBottom: 20 }}>{items.map((item) => <Pressable key={item.key} onPress={() => { setOpen(false); onSelect(item.section, item.tab, item.userId, item.category, item.guestTicketId, item.key); }} className="flex-row items-center gap-3 rounded-2xl border border-[#273548] bg-[#121B28] p-3"><View className="h-10 w-10 items-center justify-center rounded-xl bg-[#D7A94818]"><Ionicons name={item.icon} size={20} color="#D7A948" /></View><View className="flex-1"><Text className="text-right text-sm font-bold text-[#F7F1E3]">{item.title} · {item.status}</Text><Text className="mt-1 text-right text-xs leading-5 text-[#9BA8B8]">{item.subtitle}</Text><Text className="mt-1 text-right text-[10px] text-[#657286]">أرسل: {egDate(item.createdAt, "وقت الإرسال غير متاح")}</Text>{!item.pending ? <Text className="mt-1 text-right text-[10px] text-[#D7A948]">القرار: {item.decisionByName || "غير مسجل"} · {egDate(item.decisionAt, "وقت القرار غير مسجل")}</Text> : null}</View><Pill tone={item.pending ? "gold" : "muted"}>{item.pending ? "مفتوحة" : "مؤرشفة"}</Pill></Pressable>)}
          {hasMore ? <Pressable accessibilityRole="button" onPress={() => setOffset((value) => Math.min(value + 100, 10_000))} className="items-center rounded-xl border border-[#273548] bg-[#101720] py-3"><Text className="text-sm font-bold text-[#D7A948]">تحميل المزيد من السجل</Text></Pressable> : null}
        </ScrollView> : <Card className="mt-5"><Text className="text-center text-sm text-[#9BA8B8]">{incomplete ? "لم يكتمل تحميل الطلبات." : "لا توجد نتائج لهذا البحث والمرشح."}</Text></Card>}
        {hasMore && !items.length && !loading ? <Pressable accessibilityRole="button" onPress={() => setOffset((value) => Math.min(value + 100, 10_000))} className="mt-3 items-center rounded-xl border border-[#273548] bg-[#101720] py-3"><Text className="text-sm font-bold text-[#D7A948]">تحميل المزيد من السجل</Text></Pressable> : null}
        <Text className="mt-2 text-[10px] leading-4 text-[#657286]" style={{ textAlign: "right" }}>لا تُحذف الطلبات بعد القرار؛ تُعرض بالحالة النهائية ووقت القرار واسم المسؤول المسجل، ويمكن تحميل صفحات أقدم.</Text>
      </View></View>
    </Modal>
  </>;
}
