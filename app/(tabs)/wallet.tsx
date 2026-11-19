import { KeyboardAwareScrollView as ScrollView } from "@/components/KeyboardAwareScrollView";
import { Text, View, ActivityIndicator, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen, Card, Metric, Pill, formatMoney, EmptyState } from "@/components/atheer-ui";
import { LoginPanel } from "@/components/LoginPanel";
import { TransactionRow } from "@/components/TransactionRow";
import { useAuth } from "@/hooks/use-auth";
import { trpc } from "@/lib/trpc";
import { isUiButtonVisible } from "@/shared/ui-button-visibility";
import { ButtonLayoutCanvas } from "@/components/ButtonLayoutCanvas";
import { WALLET_LAYOUT_ACTIONS } from "@/shared/button-layout";

export default function WalletScreen() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const uiButtonVisibility = trpc.uiButtonVisibility.mine.useQuery(undefined, { enabled: Boolean(user), refetchInterval: 10000, refetchOnWindowFocus: true, retry: false });
  const buttonLayout = trpc.buttonLayout.get.useQuery({ surface: "wallet" }, { enabled: Boolean(user), refetchInterval: 10000, refetchOnWindowFocus: true });
  const showButton = (buttonId: string) => isUiButtonVisible(uiButtonVisibility.data, "wallet", buttonId);
  const portfolio = trpc.portfolio.get.useQuery(undefined, { enabled: Boolean(user), refetchInterval: 10000, refetchOnWindowFocus: true });
  const requests = trpc.portfolio.requests.useQuery(undefined, { enabled: Boolean(user), refetchInterval: 10000, refetchOnWindowFocus: true });
  if (loading) return <View className="flex-1 items-center justify-center bg-[#0B1018]"><ActivityIndicator color="#D7A948" /></View>;
  if (!user) return <Screen title="المحفظة" subtitle="سجّل الدخول للوصول إلى رصيدك"><ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ flexGrow: 1, paddingBottom: 120 }}><LoginPanel /></ScrollView></Screen>;
  if (portfolio.isLoading) return <View className="flex-1 items-center justify-center bg-[#0B1018]"><ActivityIndicator color="#D7A948" /></View>;
  const wallet = portfolio.data?.wallet;
  const activity = portfolio.data?.activity ?? [];
  return <Screen title="المحفظة" subtitle="نظرة واضحة على الرصيد" right={showButton("support") && !buttonLayout.data ? <Pressable accessibilityRole="button" accessibilityLabel="فتح دردشة خدمة العملاء" onPress={() => router.push("/support" as never)} style={({ pressed }) => ({ width: 32, height: 32, borderRadius: 11, borderWidth: 1, borderColor: "#D7A94855", backgroundColor: "#D7A94818", alignItems: "center", justifyContent: "center", opacity: pressed ? 0.7 : 1 })}><Ionicons name="headset-outline" size={17} color="#D7A948" /></Pressable> : undefined}><ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ paddingBottom: 120 }}>
    <Card className="mt-3 border-[#665536] bg-[#0F141C]"><View className="flex-row items-center justify-between"><View><Pill>المحفظة</Pill><Text className="mt-4 text-sm text-[#D6C79E]">صافي الرصيد</Text><Text className="mt-2 text-4xl font-bold text-[#F7F1E3]">{formatMoney(wallet?.balance)}</Text></View><Text className="text-3xl text-[#D7A948]">◈</Text></View>{portfolio.isError && <Text className="mt-3 text-sm text-[#FF7D8D]">تعذر تحديث الرصيد. أعد المحاولة.</Text>}</Card>
    {buttonLayout.data ? <View className="mt-3"><ButtonLayoutCanvas surface="wallet" layout={buttonLayout.data} visible={showButton} onPress={(action) => router.push(action.route as never)} /></View> : <View className="mt-3 flex-row flex-wrap gap-2.5">{WALLET_LAYOUT_ACTIONS.filter((action) => showButton(action.id)).map(({ id, label, route, icon }) => <Pressable key={id} accessibilityRole="button" accessibilityLabel={label} onPress={() => router.push(route as never)} style={({ pressed }) => ({ width: "31.5%", minHeight: 86, flexGrow: 1, alignItems: "center", justifyContent: "center", gap: 7, paddingHorizontal: 5, paddingVertical: 10, borderRadius: 18, borderWidth: 1, borderColor: pressed ? "#8B7446" : "#343B46", backgroundColor: pressed ? "#1B2028" : "#10151D", shadowColor: "#D7A948", shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2 })}><View className="h-9 w-9 items-center justify-center rounded-xl border border-[#6B5939] bg-[#D7A948]/10"><Ionicons name={icon} size={21} color="#C8AE78" /></View><Text numberOfLines={2} style={{ color: "#E6E0D5", fontWeight: "600", fontSize: 11, textAlign: "center" }}>{label}</Text></Pressable>)}</View>}
    <View className="mt-3 flex-row flex-wrap gap-2"><Metric label="المتاح" value={formatMoney(portfolio.data?.available?.available)} icon="shield-checkmark-outline" tone="green" /><Metric label="محجوز للسحب" value={formatMoney(portfolio.data?.available?.reservedWithdrawals)} icon="time-outline" /><Metric label="محجوز للإدخار" value={formatMoney(portfolio.data?.available?.reservedSavings)} icon="lock-closed-outline" /><Metric label="محجوز للتحويل" value={formatMoney(portfolio.data?.available?.reservedTransfers)} icon="swap-horizontal-outline" /><Metric label="أرباح مسجلة" value={formatMoney(wallet?.profitLoss)} icon="trending-up" tone="green" /></View>
    <View className="mt-6"><Text className="mb-3 text-lg font-bold text-[#F7F1E3]">طلبات الإيداع والسحب</Text>
      {requests.isLoading ? <ActivityIndicator color="#D7A948" /> : requests.isError ? <Text className="text-sm text-[#FF7D8D]">تعذر تحميل الطلبات.</Text> : requests.data?.length ? requests.data.map(item => <Card key={item.id} className="mb-3"><View className="flex-row items-center justify-between"><Text className="font-semibold text-[#F7F1E3]">{item.type === 'deposit' ? 'إيداع' : 'سحب'} · {item.paymentChannel}</Text><Pill tone={item.status === 'rejected' ? 'red' : item.status === 'pending' ? 'gold' : 'green'}>{item.status === 'pending' ? 'قيد المراجعة' : item.status === 'approved' ? 'مقبول' : item.status === 'completed' ? 'مكتمل' : 'مرفوض'}</Pill></View><Text className="mt-2 font-bold text-[#D7A948]">{formatMoney(item.amount)}</Text><Text className="mt-1 text-xs text-[#9BA8B8]">{item.reference}</Text><Text className="mt-1 text-xs text-[#657286]">{new Date(item.createdAt).toLocaleString('ar-EG')}</Text>{item.payoutReference && <Text className="mt-1 text-xs text-[#9BA8B8]">مرجع التحويل المنفذ: {item.payoutReference}</Text>}</Card>) : <EmptyState title="لا توجد طلبات" text="يمكنك إنشاء طلب إيداع أو سحب من هنا." />}
    </View>
    <View className="mb-3 mt-8 flex-row items-center justify-between"><Text className="text-lg font-bold text-[#F7F1E3]">تاريخ السجل</Text>{showButton("viewActivity") ? <Pressable accessibilityRole="button" onPress={() => router.push('/(tabs)/activity')}><Text className="text-sm text-[#D7A948]">عرض السجل الكامل</Text></Pressable> : null}</View>
    {activity.length ? activity.slice(0, 5).map(item => <TransactionRow key={item.id} transaction={item} compact />) : <EmptyState title="السجل فارغ" text="ستظهر الحركات المالية المؤكدة هنا." />}
  </ScrollView></Screen>;
}
