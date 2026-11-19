import { KeyboardAwareScrollView as ScrollView } from "@/components/KeyboardAwareScrollView";
import { ActivityIndicator, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { ActionButton, Card, Pill, Screen } from "@/components/atheer-ui";
import { trpc } from "@/lib/trpc";
export default function SessionsScreen() {
  const router = useRouter();
  const sessions = trpc.auth.sessions.useQuery(undefined, { refetchInterval: 10000 });
  const revoke = trpc.auth.revokeSession.useMutation({ onSuccess: () => void sessions.refetch() });
  const revokeAll = trpc.auth.revokeAllSessions.useMutation({ onSuccess: () => void sessions.refetch() });
  return <Screen title="الأجهزة والجلسات" subtitle="راجع الأجهزة التي دخلت منها إلى حسابك وأنهِ أي جلسة غير معروفة">
    <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ paddingBottom: 120 }}>
      <Card><Text className="text-sm leading-6 text-[#9BA8B8]" style={{ textAlign: "right" }}>يتم تسجيل اسم الجهاز وآخر نشاط فقط. لا تُعرض رموز الجلسات أو أي بيانات سرية.</Text><View className="mt-4"><ActionButton label={revokeAll.isPending ? "جارٍ الإنهاء..." : "تسجيل الخروج من جميع الأجهزة"} icon="log-out-outline" secondary onPress={() => revokeAll.mutate()} /></View></Card>
      {sessions.isLoading ? <ActivityIndicator className="mt-5" color="#D7A948" /> : sessions.data?.map((item) => <Card key={item.id} className="mt-3"><View className="flex-row items-center justify-between"><Pill tone={item.current ? "green" : item.active ? "gold" : "muted"}>{item.current ? "الجهاز الحالي" : item.active ? "نشطة" : "منتهية"}</Pill><View><Text className="text-base font-bold text-[#F7F1E3]" style={{ textAlign: "right" }}>{item.label}</Text><Text className="mt-1 text-xs text-[#9BA8B8]" style={{ textAlign: "right" }}>{item.platform || "غير محدد"}</Text></View></View><Text className="mt-3 text-xs text-[#657286]" style={{ textAlign: "right" }}>آخر نشاط: {new Date(item.lastActivityAt).toLocaleString("ar-EG")}</Text>{item.active ? <View className="mt-3"><ActionButton label="إنهاء هذه الجلسة" icon="close-circle-outline" secondary onPress={() => revoke.mutate({ sessionId: item.id })} /></View> : null}</Card>)}
      <View className="mt-4"><ActionButton label="العودة إلى حسابي" icon="arrow-back-outline" secondary onPress={() => router.back()} /></View>
    </ScrollView>
  </Screen>;
}
