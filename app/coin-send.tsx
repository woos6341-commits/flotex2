import { KeyboardAwareScrollView as ScrollView } from "@/components/KeyboardAwareScrollView";
import { useRef, useState } from "react";
import { ActivityIndicator, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { ActionButton, Card, EmptyState, Pill, Screen } from "@/components/atheer-ui";
import { SecurityPinModal } from "@/components/SecurityPinModal";
import { LoginPanel } from "@/components/LoginPanel";
import { useAuth } from "@/hooks/use-auth";
import { formatCoinQuantity, parseCoinQuantity } from "@/shared/coin";
import { showFinancialMessage } from "@/lib/financial-feedback";
import { trpc } from "@/lib/trpc";
import { beginCoinOperation, finishCoinOperation, newCoinOperationAttempt } from "@/shared/coin-operation";

function normalizeCustomerId(value: string) { return value.replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit))).replace(/\D/g, "").slice(0, 10); }

export default function CoinSendScreen() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [customerId, setCustomerId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [pinVisible, setPinVisible] = useState(false);
  const [securityPin, setSecurityPin] = useState("");
  const [pinError, setPinError] = useState("");
  const attempt = useRef(newCoinOperationAttempt());
  const overview = trpc.coin.overview.useQuery(undefined, { enabled: Boolean(user), refetchInterval: 10000 });
  const recipient = trpc.coin.lookupTransferRecipient.useQuery({ customerId }, { enabled: customerId.length === 10 && Boolean(user), retry: false });
  const utils = trpc.useUtils();
  const create = trpc.coin.createTransfer.useMutation({ onSuccess: async (result) => { finishCoinOperation(attempt.current, true); await Promise.all([utils.coin.overview.invalidate(), utils.portfolio.get.invalidate(), utils.portfolio.transactions.invalidate(), utils.admin.coinDashboard.invalidate()]); setCustomerId(""); setQuantity(""); setSecurityPin(""); setPinError(""); setPinVisible(false); showFinancialMessage("تم تسجيل طلب التحويل", result.message ?? "طلبك قيد المراجعة."); }, onError: (error) => { finishCoinOperation(attempt.current, false); setPinError(error.message); } });
  if (loading) return <View className="flex-1 items-center justify-center bg-[#0B1018]"><ActivityIndicator color="#D7A948" /></View>;
  if (!user) return <Screen title="إرسال كوين"><ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ flexGrow: 1, paddingBottom: 120 }}><LoginPanel /></ScrollView></Screen>;
  if (overview.isLoading) return <View className="flex-1 items-center justify-center bg-[#0B1018]"><ActivityIndicator color="#D7A948" /></View>;
  if (overview.isError || !overview.data) return <Screen title="إرسال كوين"><EmptyState title="تعذر تحميل المحفظة" text="تحقق من اتصال الخادم وحاول مجددًا." /></Screen>;
  const qty = parseCoinQuantity(quantity);
  const minimum = Number(overview.data.settings.transferMinimum ?? 2);
  const available = Number(overview.data.wallet.balance) - Number(overview.data.wallet.reserved);
  return <Screen title="إرسال كوين"><ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ paddingBottom: 140 }}><Card><View className="flex-row items-center justify-between"><View><Text className="text-xs text-[#9BA8B8]">الرصيد المتاح للإرسال</Text><Text className="mt-2 text-2xl font-bold text-[#F7F1E3]">{formatCoinQuantity(available)} كوين</Text></View><Pill tone="gold">حد أدنى {formatCoinQuantity(minimum)}</Pill></View><Text className="mt-3 text-xs leading-5 text-[#9BA8B8]">يُحجز المبلغ من رصيدك حتى تراجع الإدارة الطلب.</Text></Card><Card className="mt-4"><Text className="text-base font-bold text-[#F7F1E3]">بيانات التحويل</Text><Text className="mb-2 mt-4 text-xs text-[#9BA8B8]">رقم المستخدم المستلم (10 أرقام)</Text><TextInput value={customerId} onChangeText={(value) => setCustomerId(normalizeCustomerId(value))} keyboardType="number-pad" maxLength={10} placeholder="أدخل رقم المستخدم" placeholderTextColor="#657286" className="rounded-2xl border border-[#273548] bg-[#0B1018] px-4 py-3 text-[#F7F1E3]" />{customerId.length === 10 ? <View className="mt-3 rounded-2xl border border-[#273548] bg-[#0B1018] p-3">{recipient.isFetching ? <Text className="text-xs text-[#9BA8B8]">جارٍ التحقق من المستلم…</Text> : recipient.isError ? <Text className="text-sm text-[#FF7D8D]">تعذر التحقق من المستلم.</Text> : recipient.data ? <Text className="text-sm text-[#47D7A5]">المستلم: {recipient.data.name || `#${recipient.data.customerId}`}</Text> : <Text className="text-sm text-[#FF7D8D]">لا يوجد مستخدم بهذا الرقم.</Text>}</View> : null}<Text className="mb-2 mt-4 text-xs text-[#9BA8B8]">كمية الكوين</Text><TextInput value={quantity} onChangeText={setQuantity} keyboardType="decimal-pad" placeholder="مثال: 2 أو 0.25" placeholderTextColor="#657286" className="rounded-2xl border border-[#273548] bg-[#0B1018] px-4 py-3 text-lg text-[#F7F1E3]" />{qty ? <Text className="mt-3 text-xs text-[#9BA8B8]">سيتم حجز {formatCoinQuantity(qty)} كوين حتى المراجعة.</Text> : null}<View className="mt-5"><ActionButton label={create.isPending ? "جارٍ الإرسال..." : "إرسال طلب التحويل"} icon="send-outline" onPress={() => { if (!recipient.data) { showFinancialMessage("المستلم غير صالح", "أدخل رقم مستخدم صحيحًا موجودًا."); return; } if (!qty || qty < minimum) { showFinancialMessage("الكمية غير صحيحة", `الحد الأدنى هو ${formatCoinQuantity(minimum)} كوين.`); return; } if (qty > available) { showFinancialMessage("رصيد غير كافٍ", "الكمية تتجاوز رصيدك المتاح."); return; } setPinError(""); setPinVisible(true); }} /></View></Card><View className="mt-4"><ActionButton label="العودة إلى محفظة الكوين" icon="arrow-back-outline" secondary onPress={() => router.replace("/coin-wallet")} /></View><SecurityPinModal visible={pinVisible} value={securityPin} error={pinError} busy={create.isPending} description="أدخل رمز الأمان المكوّن من 4 أرقام لتأكيد إرسال الكوين. لن يتغير رصيدك قبل موافقة الإدارة." onChange={(value) => { setSecurityPin(value); setPinError(""); }} onCancel={() => { if (!create.isPending) { setPinVisible(false); setSecurityPin(""); } }} onConfirm={() => { if (!/^\d{4}$/.test(securityPin) || !qty) { setPinError("أدخل رمز الأمان المكوّن من 4 أرقام."); return; } const idempotencyKey = beginCoinOperation(attempt.current, JSON.stringify([user.id, customerId, formatCoinQuantity(qty)]), "FC-UI-SEND"); if (!idempotencyKey) return; create.mutate({ recipientCustomerId: customerId, quantity: formatCoinQuantity(qty), idempotencyKey, securityPin }); }} /></ScrollView></Screen>;
}
