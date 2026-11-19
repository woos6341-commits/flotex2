import { KeyboardAwareScrollView as ScrollView } from "@/components/KeyboardAwareScrollView";
import { Text, View, ActivityIndicator, Pressable } from "react-native";
import { Screen, EmptyState, Card, Pill } from "@/components/atheer-ui";
import { TransactionRow } from "@/components/TransactionRow";
import { trpc } from "@/lib/trpc";

export default function ActivityScreen() {
  const transactions = trpc.portfolio.transactions.useQuery(undefined, { refetchInterval: 10000, refetchOnWindowFocus: true });
  const notifications = trpc.notifications.list.useQuery(undefined, { refetchInterval: 10000, refetchOnWindowFocus: true });
  const unread = trpc.notifications.unreadCount.useQuery(undefined, { refetchInterval: 10000, refetchOnWindowFocus: true });
  const markRead = trpc.notifications.markRead.useMutation({
    onSuccess: () => { void notifications.refetch(); void unread.refetch(); },
  });
  return <Screen title="النشاط" subtitle="سجل شفاف لكل حركة وإشعار">
    <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ paddingBottom: 120 }}>
      <Card className="mb-5">
        <View className="flex-row items-center justify-between"><Text className="text-base font-bold text-[#F7F1E3]">الإشعارات</Text><Pill tone={unread.data ? "gold" : "muted"}>{unread.data ?? 0} غير مقروء</Pill></View>
        <View className="mt-3">{notifications.isLoading ? <ActivityIndicator color="#D7A948" /> : notifications.data?.length ? notifications.data.slice(0, 8).map(item => <Pressable key={item.id} onPress={() => !item.readAt && markRead.mutate({ notificationId: item.id })} className={`mb-2 rounded-2xl border p-3 ${item.readAt ? "border-[#273548] bg-[#0B1018]" : "border-[#5C4A28] bg-[#1A1720]"}`}><View className="flex-row items-center justify-between"><Text className="font-bold text-[#F7F1E3]">{item.title}</Text>{!item.readAt && <View className="h-2 w-2 rounded-full bg-[#D7A948]" />}</View><Text className="mt-1 text-xs leading-5 text-[#9BA8B8]">{item.body}</Text><Text className="mt-1 text-[10px] text-[#657286]">{new Date(item.createdAt).toLocaleString("ar-EG")}</Text></Pressable>) : <Text className="mt-3 text-sm text-[#9BA8B8]">لا توجد إشعارات جديدة.</Text>}</View>
      </Card>
      <Text className="mb-3 text-base font-bold text-[#F7F1E3]">سجل الحركات</Text>
      {transactions.isLoading ? <ActivityIndicator color="#D7A948" /> : transactions.isError ? <Text className="text-sm text-[#FF7D8D]">تعذر تحميل سجل الحركات.</Text> : transactions.data?.length ? transactions.data.map(item => <TransactionRow key={item.id} transaction={item} />) : <EmptyState title="السجل فارغ" text="ستظهر حركات المحفظة هنا بعد إنشاء طلب أو تسجيل تعديل." />}
    </ScrollView>
  </Screen>;
}
