import { KeyboardAwareScrollView as ScrollView } from "@/components/KeyboardAwareScrollView";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { ActionButton, Card, EmptyState, Metric, Pill, Screen } from "@/components/atheer-ui";
import { LoginPanel } from "@/components/LoginPanel";
import { useAuth } from "@/hooks/use-auth";
import { formatCoinPrice, formatCoinQuantity } from "@/shared/coin";
import { showFinancialMessage } from "@/lib/financial-feedback";
import { trpc } from "@/lib/trpc";

const GOLD = "#D7A948";

export default function CoinWalletScreen() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const overview = trpc.coin.overview.useQuery(undefined, { enabled: Boolean(user), refetchInterval: 10000, refetchOnWindowFocus: true });
  const utils = trpc.useUtils();
  const cancelOrder = trpc.coin.cancelOrder.useMutation({
    onSuccess: async (result) => {
      await utils.coin.overview.invalidate();
      showFinancialMessage("تم إلغاء الطلب", result.message);
    },
    onError: (error) => showFinancialMessage("تعذر إلغاء الطلب", error.message),
  });

  if (loading) return <View className="flex-1 items-center justify-center bg-[#0B1018]"><ActivityIndicator color={GOLD} /></View>;
  if (!user) return <Screen title="محفظة كوين فولتكس" subtitle="سجّل الدخول للوصول إلى محفظتك"><ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ flexGrow: 1, paddingBottom: 120 }}><LoginPanel /></ScrollView></Screen>;
  if (overview.isLoading) return <View className="flex-1 items-center justify-center bg-[#0B1018]"><ActivityIndicator color={GOLD} /></View>;
  if (overview.isError || !overview.data) return <Screen title="محفظة كوين فولتكس"><EmptyState title="تعذر تحميل المحفظة" text="تحقق من اتصال الخادم وحاول مجددًا." /></Screen>;

  const data = overview.data;
  const orderStatus = (status: string) => status === "pending" ? "قيد المراجعة" : status === "approved" ? "معتمد" : status === "cancelled" ? "ملغى" : "مرفوض";
  const orderTone = (status: string) => status === "approved" ? "green" as const : status === "rejected" ? "red" as const : status === "cancelled" ? "muted" as const : "gold" as const;

  return <Screen title="محفظة كوين فولتكس" subtitle="ملخص مستقل داخل Flotex EGP">
    <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ paddingBottom: 140 }}>
      <Card className="border-[#665536] bg-[#0F141C]"><View className="flex-row items-center justify-between"><View><Text className="text-sm text-[#D6C79E]">رصيد الكوين</Text><Text className="mt-2 text-4xl font-bold text-[#F7F1E3]">{formatCoinQuantity(data.wallet.balance)}</Text><Text className="mt-1 text-xs text-[#9BA8B8]">كوين فولتكس · المتاح {formatCoinQuantity(Number(data.wallet.balance) - Number(data.wallet.reserved))}</Text></View><Text className="text-4xl text-[#D7A948]">◈</Text></View><Text className="mt-4 text-xs leading-5 text-[#9BA8B8]">القيمة التقديرية بسعر البيع الحالي: <Text className="font-bold text-[#D7A948]">{data.estimatedValueAtSell} ج.م</Text></Text></Card>
      <View className="mt-3 flex-row flex-wrap gap-2.5"><Metric label="سعر الشراء" value={`${formatCoinPrice(data.settings.buyPrice)} ج.م`} icon="trending-up" tone="green" /><Metric label="سعر البيع" value={`${formatCoinPrice(data.settings.sellPrice)} ج.م`} icon="trending-down" tone="red" /><Metric label="قبل أسبوع" value={`${formatCoinPrice(data.weekAgoPrice)} ج.م`} icon="time-outline" /><Metric label="التغير" value={`${formatCoinPrice(data.weekChange)} ج.م · ${data.weekChangePercent}%`} icon="analytics-outline" tone={Number(data.weekChange) >= 0 ? "green" : "red"} /></View>
      <Card className="mt-4"><Text className="text-base font-bold text-[#F7F1E3]">عمليات الكوين</Text><View className="mt-4 flex-row gap-2.5"><CoinActionButton label="شراء كوين" icon="add-circle-outline" onPress={() => router.push("/coin-buy")} /><CoinActionButton label="بيع كوين" icon="remove-circle-outline" onPress={() => router.push("/coin-sell")} /><CoinActionButton label="إرسال كوين" icon="send-outline" onPress={() => router.push("/coin-send")} /></View></Card>
      <View className="mb-3 mt-7 flex-row items-center justify-between"><Text className="text-lg font-bold text-[#F7F1E3]">آخر العمليات</Text><Pill tone="muted">{(data.orders?.length ?? 0) + (data.transfers?.length ?? 0)} عملية</Pill></View>
      {data.orders?.length ? data.orders.slice(0, 10).map((order) => <Card key={`order-${order.id}`} className="mb-3"><View className="flex-row items-center justify-between"><Text className="font-bold text-[#F7F1E3]">{order.side === "buy" ? "شراء" : "بيع"} · {formatCoinQuantity(order.quantity)} كوين</Text><Pill tone={orderTone(order.status)}>{orderStatus(order.status)}</Pill></View><Text className="mt-2 text-sm text-[#D7A948]">{order.totalAmount} ج.م · رسوم {order.feeAmount} ج.م</Text><Text className="mt-1 text-xs text-[#9BA8B8]">{new Date(order.createdAt).toLocaleString("ar-EG")}</Text>{order.rejectionReason && order.status === "rejected" ? <Text className="mt-2 text-xs text-[#FFB4BC]">{order.rejectionReason}</Text> : null}{order.status === "pending" ? <View className="mt-3"><ActionButton label={cancelOrder.isPending ? "جارٍ الإلغاء..." : "إلغاء الطلب"} icon="close-circle-outline" secondary onPress={() => cancelOrder.mutate({ orderId: order.id })} /></View> : null}</Card>) : null}
      {data.transfers?.length ? data.transfers.slice(0, 10).map((transfer) => <Card key={`transfer-${transfer.id}`} className="mb-3"><View className="flex-row items-center justify-between"><Text className="font-bold text-[#F7F1E3]">تحويل · {formatCoinQuantity(transfer.quantity)} كوين</Text><Pill tone={transfer.status === "approved" ? "green" : transfer.status === "rejected" ? "red" : "gold"}>{transfer.status === "pending" ? "قيد المراجعة" : transfer.status === "approved" ? "معتمد" : "مرفوض"}</Pill></View><Text className="mt-2 text-xs text-[#9BA8B8]">{transfer.senderUserId === user.id ? `إلى ${transfer.recipientName || "المستلم"}` : `من ${transfer.senderName || "المرسل"}`} · {new Date(transfer.createdAt).toLocaleString("ar-EG")}</Text>{transfer.rejectionReason ? <Text className="mt-2 text-xs text-[#FFB4BC]">{transfer.rejectionReason}</Text> : null}</Card>) : null}
      {!data.orders?.length && !data.transfers?.length ? <EmptyState title="لا توجد عمليات كوين" text="ستظهر الطلبات والتحويلات بعد تسجيلها." /> : null}
    </ScrollView>
  </Screen>;
}

function CoinActionButton({ label, icon, onPress }: { label: string; icon: "add-circle-outline" | "remove-circle-outline" | "send-outline"; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => ({ flex: 1, minWidth: 0, minHeight: 92, alignItems: "center", justifyContent: "center", gap: 7, paddingHorizontal: 5, paddingVertical: 12, borderRadius: 20, borderWidth: 1, borderColor: pressed ? "#8B7446" : "#343B46", backgroundColor: pressed ? "#1B2028" : "#10151D", shadowColor: GOLD, shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2 })}><View className="h-10 w-10 items-center justify-center rounded-xl border border-[#6B5939] bg-[#D7A948]/10"><Ionicons name={icon} size={23} color="#C8AE78" /></View><Text numberOfLines={2} className="text-center text-xs font-semibold text-[#E6E0D5]">{label}</Text></Pressable>;
}
