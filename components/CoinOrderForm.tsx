import { KeyboardAwareScrollView as ScrollView } from "@/components/KeyboardAwareScrollView";
import { useMemo, useRef, useState } from "react";
import { ActivityIndicator, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { ActionButton, Card, EmptyState, Pill, Screen } from "@/components/atheer-ui";
import { SecurityPinModal } from "@/components/SecurityPinModal";
import { LoginPanel } from "@/components/LoginPanel";
import { useAuth } from "@/hooks/use-auth";
import { formatCoinMoney, formatCoinPrice, formatCoinQuantity, parseCoinQuantity } from "@/shared/coin";
import { showFinancialMessage } from "@/lib/financial-feedback";
import { trpc } from "@/lib/trpc";
import { beginCoinOperation, finishCoinOperation, newCoinOperationAttempt } from "@/shared/coin-operation";

export function CoinOrderForm({ side }: { side: "buy" | "sell" }) {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [quantity, setQuantity] = useState("");
  const [pinVisible, setPinVisible] = useState(false);
  const [securityPin, setSecurityPin] = useState("");
  const [pinError, setPinError] = useState("");
  const attempt = useRef(newCoinOperationAttempt());
  const overview = trpc.coin.overview.useQuery(undefined, { enabled: Boolean(user), refetchInterval: 10000 });
  const utils = trpc.useUtils();
  const createOrder = trpc.coin.createOrder.useMutation({ onSuccess: async (result) => { finishCoinOperation(attempt.current, true); await Promise.all([utils.coin.overview.invalidate(), utils.portfolio.get.invalidate(), utils.portfolio.transactions.invalidate(), utils.admin.coinDashboard.invalidate()]); setQuantity(""); setSecurityPin(""); setPinError(""); setPinVisible(false); showFinancialMessage("تم تسجيل الطلب", result.message ?? "طلبك قيد المراجعة."); }, onError: (error) => { finishCoinOperation(attempt.current, false); setPinError(error.message); } });

  const settings = overview.data?.settings;
  const wallet = overview.data?.wallet;
  const qty = parseCoinQuantity(quantity);
  const price = Number(side === "buy" ? settings?.buyPrice ?? 0 : settings?.sellPrice ?? 0);
  const feeEnabled = side === "buy" ? settings?.buyFeeEnabled : settings?.sellFeeEnabled;
  const fee = feeEnabled ? Number(side === "buy" ? settings?.buyFee ?? 0 : settings?.sellFee ?? 0) : 0;
  const preview = useMemo(() => {
    if (!qty || price <= 0) return null;
    const gross = qty * price;
    const total = side === "buy" ? gross + fee : gross - fee;
    return { gross, fee, total };
  }, [fee, price, qty, side]);

  if (loading) return <View className="flex-1 items-center justify-center bg-[#0B1018]"><ActivityIndicator color="#D7A948" /></View>;
  if (!user) return <Screen title={side === "buy" ? "شراء كوين" : "بيع كوين"}><ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ flexGrow: 1, paddingBottom: 120 }}><LoginPanel /></ScrollView></Screen>;
  if (overview.isLoading) return <View className="flex-1 items-center justify-center bg-[#0B1018]"><ActivityIndicator color="#D7A948" /></View>;
  if (overview.isError || !overview.data) return <Screen title={side === "buy" ? "شراء كوين" : "بيع كوين"}><EmptyState title="تعذر تحميل السعر" text="تحقق من اتصال الخادم وحاول مجددًا." /></Screen>;

  const available = Number(wallet?.balance ?? 0) - Number(wallet?.reserved ?? 0);
  return <Screen title={side === "buy" ? "شراء كوين" : "بيع كوين"} subtitle={side === "buy" ? "طلب شراء بسعر ثابت حتى المراجعة" : "طلب بيع بسعر ثابت حتى المراجعة"}>
    <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ paddingBottom: 140 }}>
      <Card className="border-[#665536]"><View className="flex-row items-center justify-between"><View><Text className="text-sm text-[#9BA8B8]">سعر {side === "buy" ? "الشراء" : "البيع"} الحالي</Text><Text className="mt-2 text-3xl font-bold text-[#D7A948]">{formatCoinPrice(price)} ج.م</Text></View><Pill tone={side === "buy" ? "green" : "red"}>{side === "buy" ? "شراء" : "بيع"}</Pill></View><Text className="mt-3 text-xs leading-5 text-[#9BA8B8]">رصيدك المتاح: {formatCoinQuantity(available)} كوين. الرسوم الحالية {feeEnabled ? formatCoinMoney(fee) : "0.00"} ج.م {feeEnabled ? "ومفعّلة" : "ومتوقفة"}.</Text></Card>
      <Card className="mt-4"><Text className="text-base font-bold text-[#F7F1E3]">كمية الكوين</Text><Text className="mb-2 mt-4 text-xs text-[#9BA8B8]">يمكنك إدخال كسر حتى 6 منازل عشرية</Text><TextInput value={quantity} onChangeText={setQuantity} keyboardType="decimal-pad" placeholder="مثال: 50 أو 0.25" placeholderTextColor="#657286" className="rounded-2xl border border-[#273548] bg-[#0B1018] px-4 py-4 text-lg text-[#F7F1E3]" />{preview ? <View className="mt-4 rounded-2xl border border-[#273548] bg-[#121B28] p-4"><Text className="text-sm text-[#F7F1E3]">الكمية: {formatCoinQuantity(qty)}</Text><Text className="mt-2 text-sm text-[#F7F1E3]">القيمة: {formatCoinMoney(preview.gross)} ج.م</Text><Text className="mt-2 text-sm text-[#F7F1E3]">الرسوم: {formatCoinMoney(preview.fee)} ج.م</Text><Text className="mt-2 text-base font-bold text-[#D7A948]">{side === "buy" ? "الإجمالي المطلوب" : "الصافي المستحق"}: {formatCoinMoney(Math.max(0, preview.total))} ج.م</Text></View> : <Text className="mt-3 text-xs text-[#9BA8B8]">أدخل كمية صحيحة لرؤية الإجمالي قبل التأكيد.</Text>}<View className="mt-5"><ActionButton label={createOrder.isPending ? "جارٍ التسجيل..." : side === "buy" ? "تأكيد الشراء" : "تأكيد البيع"} icon={side === "buy" ? "checkmark-circle-outline" : "cash-outline"} onPress={() => { if (!preview || !qty) { showFinancialMessage("بيانات ناقصة", "أدخل كمية كوين صحيحة."); return; } if (side === "sell" && qty > available) { showFinancialMessage("رصيد غير كافٍ", "الكمية تتجاوز رصيدك المتاح بعد الحجوزات."); return; } setPinError(""); setPinVisible(true); }} /></View><Text className="mt-3 text-[11px] leading-5 text-[#657286]">بعد التأكيد تُسجّل العملية وتظهر حالتها «قيد المراجعة». لا تُخصم الرسوم إلا عند الموافقة النهائية.</Text></Card>
      <View className="mt-4"><ActionButton label="العودة إلى محفظة الكوين" icon="arrow-back-outline" secondary onPress={() => router.replace("/coin-wallet")} /></View>
      <SecurityPinModal visible={pinVisible} value={securityPin} error={pinError} busy={createOrder.isPending} description={`أدخل رمز الأمان المكوّن من 4 أرقام لتأكيد ${side === "buy" ? "شراء" : "بيع"} الكوين. لن يتغير رصيدك قبل موافقة الإدارة.`} onChange={(value) => { setSecurityPin(value); setPinError(""); }} onCancel={() => { if (!createOrder.isPending) { setPinVisible(false); setSecurityPin(""); } }} onConfirm={() => { if (!/^\d{4}$/.test(securityPin) || !preview || !qty) { setPinError("أدخل رمز الأمان المكوّن من 4 أرقام."); return; } const idempotencyKey = beginCoinOperation(attempt.current, JSON.stringify([user.id, side, formatCoinQuantity(qty)]), `FC-UI-${side}`); if (!idempotencyKey) return; createOrder.mutate({ side, quantity: formatCoinQuantity(qty), idempotencyKey, securityPin }); }} />
    </ScrollView>
  </Screen>;
}
