import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Card, EmptyState, formatMoney } from "@/components/atheer-ui";

type QueryLike = { data?: unknown; isLoading?: boolean; isError?: boolean; isFetching?: boolean; refetch?: () => Promise<unknown> };
export type OperationSection = "requests" | "savings" | "gold" | "coin" | "externalTransfers" | "gameTopup" | "accountVerification" | "phoneChange" | "phoneVerification" | "supportMessaging" | "guestSupport";
type Operation = {
  key: string;
  section: OperationSection;
  requestTab?: "payments" | "transfers";
  userId?: number;
  category?: "account" | "freeze" | "external_transaction";
  guestTicketId?: number;
  title: string;
  customerName: string;
  customerId: string;
  amount: string | null;
  unit: "EGP" | "COIN" | "NONE";
  status: string;
  reference: string;
  createdAt: string;
  decisionAt: string | null;
  pending: boolean;
};

const statusLabels: Record<string, string> = {
  new: "جديد",
  pending: "قيد المراجعة",
  pending_approval: "بانتظار الموافقة",
  pending_review: "بانتظار المراجعة",
  under_review: "قيد المراجعة",
  awaiting_details: "بانتظار البيانات",
  awaiting_execution: "بانتظار التنفيذ",
  approved: "مقبول",
  processing: "جارٍ التنفيذ",
  active: "نشط",
  executed: "منفذ",
  delivered: "تم التسليم",
  completed: "مكتمل",
  refunded: "مسترد",
  rejected: "مرفوض",
  cancelled: "ملغي",
  open: "نشط", closed: "مغلق", replied: "تم الرد", pending_reply: "قيد المراجعة",
};

const sectionIcons: Record<OperationSection, keyof typeof Ionicons.glyphMap> = {
  requests: "wallet-outline",
  savings: "pie-chart-outline",
  gold: "diamond-outline",
  coin: "layers-outline",
  externalTransfers: "globe-outline",
  gameTopup: "game-controller-outline",
  accountVerification: "shield-checkmark-outline",
  phoneChange: "call-outline",
  phoneVerification: "phone-portrait-outline",
  supportMessaging: "chatbubbles-outline",
  guestSupport: "chatbubble-ellipses-outline",
};

function amountLabel(entry: Operation) {
  if (entry.unit === "NONE" || entry.amount === null) return "حسب الاتفاق";
  if (entry.unit === "COIN") return `${Number(entry.amount).toLocaleString("en-US", { maximumFractionDigits: 6 })} كوين`;
  return formatMoney(entry.amount);
}

function dateLabel(value: string) {
  return new Date(value).toLocaleString("ar-EG");
}

export function OperationsSummary({ operations, onOpen }: { operations: QueryLike; onOpen: (section: OperationSection, tab?: "payments" | "transfers", userId?: number, category?: "account" | "freeze" | "external_transaction", guestTicketId?: number, operationKey?: string) => void }) {
  const [newEntry, setNewEntry] = useState<Operation | null>(null);
  const seen = useRef<Set<string> | null>(null);
  const entries = useMemo(() => Array.isArray(operations.data) ? (operations.data as Operation[]) : [], [operations.data]);
  const visibleEntries = entries.slice(0, 30);

  useEffect(() => {
    const current = new Set(entries.filter((entry) => entry.pending).map((entry) => entry.key));
    if (seen.current === null) {
      if (operations.isLoading) return;
      seen.current = current;
      return;
    }
    const added = entries.find((entry) => entry.pending && !seen.current?.has(entry.key));
    if (added) setNewEntry(added);
    seen.current = new Set([...(seen.current ?? []), ...current]);
  }, [entries, operations.isLoading]);

  return <Card className="mb-4">
    <View className="flex-row items-center justify-between">
      <Pressable accessibilityRole="button" onPress={() => onOpen("requests", "payments")}><Text className="text-xs font-bold text-[#D7A948]">فتح المراجعة</Text></Pressable>
      <View className="items-end"><Text className="text-base font-bold text-[#F7F1E3]">أحدث العمليات والطلبات</Text><Text className="mt-0.5 text-[10px] text-[#657286]">يتحدّث تلقائيًا · الأقدم أولًا</Text></View>
    </View>
    <Text className="mt-1 text-xs leading-5 text-[#9BA8B8]">الطلبات والمحادثات النشطة مرتبة بوقت الإنشاء؛ تُعرض الطلبات المنتهية في أرشيف مركز الطلبات.</Text>
    {newEntry ? <Pressable accessibilityRole="alert" onPress={() => { onOpen(newEntry.section, newEntry.requestTab, newEntry.userId, newEntry.category, newEntry.guestTicketId, newEntry.key); setNewEntry(null); }} className="mt-3 flex-row-reverse items-center gap-2 rounded-xl border border-[#5C4A28] bg-[#171D27] p-3"><Ionicons name="notifications-outline" size={18} color="#D7A948" /><Text className="flex-1 text-right text-xs font-bold text-[#D7A948]">طلب جديد وصل: {newEntry.customerName} · {newEntry.title} · {amountLabel(newEntry)}. اضغط للمراجعة.</Text><Pressable accessibilityRole="button" onPress={(event) => { event.stopPropagation(); setNewEntry(null); }}><Ionicons name="close" size={18} color="#9BA8B8" /></Pressable></Pressable> : null}
    {operations.isLoading ? <ActivityIndicator className="mt-4" color="#D7A948" /> : operations.isError ? <View className="mt-4 flex-row items-center justify-between gap-3"><Text accessibilityRole="alert" className="flex-1 text-right text-xs leading-5 text-[#FF7D8D]">تعذر تحميل أحدث العمليات؛ هذا لا يعني أن القائمة فارغة. أعد المحاولة أو تحقق من اتصال قاعدة البيانات.</Text><Pressable accessibilityRole="button" accessibilityLabel="إعادة تحميل أحدث العمليات" disabled={operations.isFetching} onPress={() => void operations.refetch?.()} className="rounded-xl border border-[#5C4A28] px-3 py-2"><Text className="text-xs font-bold text-[#D7A948]">{operations.isFetching ? "جارٍ..." : "إعادة المحاولة"}</Text></Pressable></View> : entries.length ? <View className="mt-3">{visibleEntries.map((entry) => <Pressable key={entry.key} accessibilityRole="button" onPress={() => onOpen(entry.section, entry.requestTab, entry.userId, entry.category, entry.guestTicketId, entry.key)} className="mb-2 flex-row-reverse items-center gap-3 rounded-xl border border-[#273548] bg-[#0B1018] p-3"><View className="h-9 w-9 items-center justify-center rounded-xl bg-[#D7A94822]"><Ionicons name={sectionIcons[entry.section]} size={18} color={entry.pending ? "#D7A948" : "#9BA8B8"} /></View><View className="flex-1"><Text numberOfLines={1} className="text-right text-xs font-bold text-[#F7F1E3]">{entry.customerName}{entry.customerId ? ` · ${entry.customerId}` : ""} · {entry.title}</Text><Text numberOfLines={2} className="mt-1 text-right text-[10px] text-[#9BA8B8]">{entry.reference} · تاريخ الطلب: {dateLabel(entry.createdAt)}{entry.decisionAt && !entry.pending ? ` · آخر قرار: ${dateLabel(entry.decisionAt)}` : ""}</Text></View><View className="items-end"><Text className="text-xs font-bold text-[#D7A948]">{amountLabel(entry)}</Text><Text className={`mt-1 text-[10px] ${entry.pending ? "text-[#D7A948]" : "text-[#9BA8B8]"}`}>{statusLabels[entry.status] || entry.status}</Text></View></Pressable>)}</View> : <EmptyState title="لا توجد طلبات حديثة" text="ستظهر هنا كل عمليات الإيداع والسحب والتحويل والادخار والألعاب والذهب والكوين والمعاملات الخارجية تلقائيًا." />}
  </Card>;
}
