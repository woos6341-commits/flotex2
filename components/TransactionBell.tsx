import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { ActivityIndicator, Modal, Pressable, Text, View } from "react-native";
import { KeyboardAwareScrollView } from "@/components/KeyboardAwareScrollView";
import { formatMoney } from "@/components/atheer-ui";
import { trpc } from "@/lib/trpc";

type SuccessfulItem = {
  reference: string;
  type: string;
  direction: "credit" | "debit";
  title: string;
  description: string;
  amount: string;
  currency: string;
  createdAt: Date | string;
  readAt: Date | null;
  isRead: boolean;
};

export function TransactionBell() {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<SuccessfulItem | null>(null);
  const utils = trpc.useUtils();
  const successful = trpc.notifications.successful.useQuery(undefined, { refetchInterval: 15000, refetchOnWindowFocus: true, retry: false });
  const markRead = trpc.notifications.markSuccessfulRead.useMutation({ onSuccess: () => void utils.notifications.successful.invalidate() });
  const unread = successful.data?.filter((item) => !item.isRead).length ?? 0;

  const choose = (item: SuccessfulItem) => {
    setSelected(item);
    if (!item.isRead && !markRead.isPending) markRead.mutate({ reference: item.reference });
  };

  return <>
    <Pressable accessibilityRole="button" accessibilityLabel={`إشعارات المعاملات الناجحة، ${unread} غير مقروء`} onPress={() => { setOpen(true); setSelected(null); }} style={({ pressed }) => ({ width: 32, height: 32, borderRadius: 11, borderWidth: 1, borderColor: "#D7A94855", backgroundColor: "#D7A94818", alignItems: "center", justifyContent: "center", opacity: pressed ? 0.7 : 1 })}>
      <Ionicons name="notifications-outline" size={17} color="#D7A948" />
      {unread > 0 ? <View style={{ position: "absolute", top: -4, right: -4, minWidth: 16, height: 16, borderRadius: 9, paddingHorizontal: 3, backgroundColor: "#FF7D8D", alignItems: "center", justifyContent: "center" }}><Text style={{ color: "#0B1018", fontSize: 9, fontWeight: "900" }}>{unread > 99 ? "99+" : unread}</Text></View> : null}
    </Pressable>
    <Modal transparent animationType="fade" visible={open} onRequestClose={() => setOpen(false)}>
      <View style={{ flex: 1, justifyContent: "center", padding: 16, backgroundColor: "rgba(0,0,0,0.78)" }}>
        <View style={{ maxHeight: "84%", width: "100%", maxWidth: 560, alignSelf: "center", borderWidth: 1, borderColor: "#5C4A28", borderRadius: 24, backgroundColor: "#111B28", padding: 16 }}>
          <View className="mb-4 flex-row items-center justify-between">
            <Pressable accessibilityRole="button" accessibilityLabel="إغلاق الإشعارات" onPress={() => setOpen(false)}><Ionicons name="close-circle-outline" size={24} color="#9BA8B8" /></Pressable>
            <Text className="text-base font-bold text-[#F7F1E3]" style={{ textAlign: "right" }}>المعاملات الناجحة</Text>
          </View>
          {selected ? <View className="mb-3 rounded-2xl border border-[#5C4A28] bg-[#0B1018] p-3">
            <View className="flex-row items-center justify-between"><Pressable accessibilityRole="button" onPress={() => setSelected(null)}><Text className="text-xs font-bold text-[#D7B75E]">رجوع للقائمة</Text></Pressable><Text className="text-sm font-bold text-[#F7F1E3]">{selected.title}</Text></View>
            <Text className="mt-3 text-sm leading-6 text-[#D6C79E]" style={{ textAlign: "right" }}>{selected.description}</Text>
            <Text className="mt-2 text-lg font-black text-[#47D7A5]" style={{ textAlign: "right" }}>{selected.direction === "debit" ? "−" : "+"}{formatMoney(selected.amount)}</Text>
            <Text className="mt-2 text-[10px] text-[#657286]" style={{ textAlign: "right" }}>التاريخ: {new Date(selected.createdAt).toLocaleString("ar-EG")}</Text>
            <Text className="mt-1 text-[10px] text-[#657286]" style={{ textAlign: "right" }}>رقم العملية: {selected.reference}</Text>
          </View> : null}
          {!selected ? successful.isLoading ? <ActivityIndicator color="#D7A948" /> : successful.isError ? <Text className="text-sm text-[#FF9BA7]" style={{ textAlign: "right" }}>تعذر تحميل العمليات الناجحة؛ أغلق النافذة وحاول مجددًا.</Text> : successful.data?.length ? <KeyboardAwareScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 520 }} contentContainerStyle={{ paddingBottom: 8 }}>
            {successful.data.map((item) => <Pressable key={item.reference} accessibilityRole="button" onPress={() => choose(item)} className={`mb-2 rounded-2xl border p-3 ${item.isRead ? "border-[#273548] bg-[#0B1018]" : "border-[#5C4A28] bg-[#1A1720]"}`}>
              <View className="flex-row items-center justify-between"><Text className="font-bold text-[#F7F1E3]">{item.title}</Text>{!item.isRead ? <View className="h-2 w-2 rounded-full bg-[#D7A948]" /> : <Ionicons name="checkmark-done-outline" size={15} color="#47D7A5" />}</View>
              <Text className="mt-1 text-xs leading-5 text-[#9BA8B8]" style={{ textAlign: "right" }}>{item.description}</Text>
              <View className="mt-2 flex-row items-center justify-between"><Text className="text-sm font-bold text-[#D7B75E]">{item.direction === "debit" ? "−" : "+"}{formatMoney(item.amount)}</Text><Text className="text-[10px] text-[#657286]">{new Date(item.createdAt).toLocaleString("ar-EG")}</Text></View>
            </Pressable>)}
          </KeyboardAwareScrollView> : <Text className="py-6 text-sm text-[#9BA8B8]" style={{ textAlign: "right" }}>لا توجد معاملات ناجحة حتى الآن.</Text> : null}
          <Text className="mt-3 text-[10px] leading-4 text-[#657286]" style={{ textAlign: "right" }}>تظهر هنا القيود المعتمدة في سجل المحفظة فقط؛ الطلبات المعلقة أو المرفوضة لا تعرض كعمليات ناجحة.</Text>
        </View>
      </View>
    </Modal>
  </>;
}
