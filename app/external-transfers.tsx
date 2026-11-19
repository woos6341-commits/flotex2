import { useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { ActionButton, Card, EmptyState, Pill, Screen } from "@/components/atheer-ui";
import { LoginPanel } from "@/components/LoginPanel";
import { KeyboardAwareScrollView as ScrollView } from "@/components/KeyboardAwareScrollView";
import { useAuth } from "@/hooks/use-auth";
import { trpc } from "@/lib/trpc";
import { EXTERNAL_TRANSFER_COUNTRIES, EXTERNAL_TRANSFER_STATUS_LABELS, getExternalTransferTotalEgp } from "@/shared/external-transfers";

function operationId() {
  return `external-${Date.now()}-${Math.random().toString(36).slice(2, 14)}`;
}

export default function ExternalTransfersScreen() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const requests = trpc.externalTransfers.mine.useQuery(undefined, { enabled: Boolean(user), refetchInterval: 10000 });
  const pricing = trpc.externalTransfers.pricing.useQuery(undefined, { enabled: Boolean(user), refetchInterval: 60000 });
  const [choosing, setChoosing] = useState(false);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [message, setMessage] = useState("");
  const create = trpc.externalTransfers.create.useMutation({
    onSuccess: () => {
      setMessage("تم إرسال طلبك إلى الإدارة بنجاح. يرجى الانتظار حتى تتواصل معك الإدارة لاستكمال إجراءات التحويل");
      void requests.refetch();
      setTimeout(() => router.push({ pathname: "/support", params: { externalRequest: "sent", category: "external_transaction" } } as never), 350);
    },
    onError: (error) => setMessage(error.message),
  });

  if (loading) return <View className="flex-1 items-center justify-center bg-[#0B1018]"><ActivityIndicator color="#D7A948" /></View>;
  if (!user) return <Screen title="المعاملات الخارجية" subtitle="سجّل الدخول لبدء طلب تحويل خارجي"><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, paddingBottom: 120 }}><LoginPanel /></ScrollView></Screen>;

  const selected = EXTERNAL_TRANSFER_COUNTRIES.find((country) => country.code === selectedCode);
  const selectedPricing = selected ? pricing.data?.find((item) => item.currencyCode === selected.currencyCode) : undefined;
  const amountNumber = Number(amount);
  const equivalent = selectedPricing?.rate && Number.isFinite(amountNumber) ? Math.round(amountNumber * Number(selectedPricing.rate) * 100) / 100 : 0;
  const totalEgp = getExternalTransferTotalEgp(equivalent, selectedPricing?.feeEgp ?? 0);
  const statusTone = (status: string) => status === "rejected" ? "red" as const : status === "completed" || status === "approved" ? "green" as const : status === "new" ? "gold" as const : "muted" as const;

  return <Screen title="المعاملات الخارجية" subtitle="اطلب تحويلًا خارجيًا وتواصل مع الإدارة بأمان">
    <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ paddingBottom: 140 }}>
      <Card className="border-[#665536] bg-[#0F141C]"><View className="flex-row items-center justify-between"><View className="flex-1"><Text className="text-lg font-bold text-[#F7F1E3]" style={{ textAlign: "right" }}>تحويلات خارج مصر</Text><Text className="mt-2 text-sm leading-6 text-[#9BA8B8]" style={{ textAlign: "right" }}>هذه الخدمة لإنشاء طلب والتواصل مع الإدارة فقط. لا يتم خصم أي مبلغ أو حجز أي رصيد قبل استكمال التفاصيل والموافقة الصريحة.</Text></View><View className="ml-3 h-12 w-12 items-center justify-center rounded-2xl border border-[#D7A94855] bg-[#D7A94818]"><Ionicons name="globe-outline" size={25} color="#D7A948" /></View></View></Card>
      {!choosing ? <View className="mt-4"><ActionButton label="إرسال أموال إلى حسابات خارجية" icon="send-outline" onPress={() => { setChoosing(true); setMessage(""); }} /></View> : <Card className="mt-4 border-[#5C4A28]"><Text className="text-base font-bold text-[#F7F1E3]" style={{ textAlign: "right" }}>اختر الدولة المستقبلة</Text><Text className="mt-1 text-xs leading-5 text-[#9BA8B8]" style={{ textAlign: "right" }}>سيتم فتح محادثة مع الإدارة بعد تأكيد الطلب. السعر والرسوم تقدير إداري؛ لا يُحجز ولا يُخصم أي رصيد بهذه الخطوة.</Text><View className="mt-4 gap-2.5">{EXTERNAL_TRANSFER_COUNTRIES.map((country) => <Pressable key={country.code} accessibilityRole="button" accessibilityLabel={`${country.name} ${country.currencyCode}`} onPress={() => { setSelectedCode(country.code); setAmount(""); setMessage(""); }} className={`flex-row items-center rounded-2xl border p-3.5 ${selectedCode === country.code ? "border-[#D7A948] bg-[#D7A94818]" : "border-[#273548] bg-[#0B1018]"}`}><Text className="text-2xl">{country.flag}</Text><View className="mr-3 flex-1"><Text className="text-sm font-bold text-[#F7F1E3]" style={{ textAlign: "right" }}>{country.name}</Text><Text className="mt-1 text-xs text-[#9BA8B8]" style={{ textAlign: "right" }}>{country.currencyName} ({country.currencyCode})</Text></View><Ionicons name={selectedCode === country.code ? "radio-button-on" : "radio-button-off"} size={21} color={selectedCode === country.code ? "#D7A948" : "#657286"} /></Pressable>)}</View>{selected ? <View className="mt-4 gap-3"><Text className="text-sm font-bold text-[#F7F1E3]" style={{ textAlign: "right" }}>المبلغ المطلوب ({selected.currencyCode})</Text><TextInput accessibilityLabel={`المبلغ المطلوب ${selected.currencyCode}`} value={amount} onChangeText={(value) => setAmount(value.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1").slice(0, 15))} keyboardType="decimal-pad" inputMode="decimal" placeholder="0.00" placeholderTextColor="#657286" style={{ minHeight: 52, borderWidth: 1, borderColor: "#273548", borderRadius: 14, backgroundColor: "#0B1018", color: "#F7F1E3", paddingHorizontal: 14, fontSize: 16, textAlign: "right" }} />{selectedPricing?.rate ? <View className="rounded-2xl border border-[#273548] bg-[#0B1018] p-3"><Text className="text-xs leading-5 text-[#9BA8B8]" style={{ textAlign: "right" }}>سعر الصرف: 1 {selected.currencyCode} = {selectedPricing.rate} ج.م · تم التحديث {selectedPricing.updatedAt ? new Date(selectedPricing.updatedAt).toLocaleString("ar-EG") : "—"}</Text><Text className="mt-1 text-xs text-[#9BA8B8]" style={{ textAlign: "right" }}>القيمة بالجنيه: {equivalent.toFixed(2)} · الرسوم: {selectedPricing.feeEgp} ج.م</Text><Text className="mt-1 text-sm font-bold text-[#D7A948]" style={{ textAlign: "right" }}>الإجمالي التقديري: {totalEgp.toFixed(2)} ج.م</Text></View> : <Text className="text-xs leading-5 text-[#FF9BA7]" style={{ textAlign: "right" }}>سعر هذه العملة غير متوفر حتى الآن. ستتمكن من إرسال الطلب بعد أن تحدد الإدارة السعر والرسوم.</Text>}<ActionButton label={create.isPending ? "جارٍ إرسال الطلب..." : "تأكيد الطلب"} icon="checkmark-circle-outline" onPress={() => { if (!create.isPending) { if (!selectedPricing?.rate) { setMessage("سعر الصرف غير متوفر حاليًا."); return; } if (!/^\d{1,12}(?:\.\d{1,2})?$/.test(amount) || amountNumber <= 0) { setMessage("أدخل مبلغًا صحيحًا بالعملة المطلوبة."); return; } create.mutate({ countryCode: selected.code, amount, clientOperationId: operationId() }); } }} /></View> : <Text className="mt-4 text-xs text-[#D6C79E]" style={{ textAlign: "right" }}>اختر الدولة أولًا لتأكيد الطلب.</Text>}{message ? <Text className={`mt-3 text-sm leading-6 ${message.startsWith("تم إرسال") ? "text-[#47D7A5]" : "text-[#FF9BA7]"}`} style={{ textAlign: "right" }}>{message}</Text> : null}</Card>}
      <View className="mb-3 mt-8 flex-row items-center justify-between"><Text className="text-lg font-bold text-[#F7F1E3]" style={{ textAlign: "right" }}>طلباتي الخارجية</Text><Pill tone="muted">{requests.data?.length ?? 0} طلب</Pill></View>
      {requests.isLoading ? <ActivityIndicator color="#D7A948" /> : requests.data?.length ? requests.data.map((request) => <Card key={request.id} className="mb-3"><View className="flex-row items-center justify-between"><Pill tone={statusTone(request.status)}>{EXTERNAL_TRANSFER_STATUS_LABELS[request.status as keyof typeof EXTERNAL_TRANSFER_STATUS_LABELS] ?? "قيد المراجعة"}</Pill><Text className="font-bold text-[#F7F1E3]" style={{ textAlign: "right" }}>{request.countryName} · {request.currencyCode}</Text></View><Text className="mt-2 text-xs text-[#9BA8B8]" style={{ textAlign: "right" }}>{request.currencyName} · {request.reference}</Text>{request.foreignAmount ? <Text className="mt-1 text-xs leading-5 text-[#D6C79E]" style={{ textAlign: "right" }}>المبلغ: {request.foreignAmount} {request.currencyCode} · سعر الصرف: {request.exchangeRate} ج.م · القيمة: {request.egpEquivalent} ج.م · الرسوم: {request.feeEgp} ج.م · الإجمالي التقديري: {request.egpTotal} ج.م</Text> : null}<Text className="mt-1 text-[10px] text-[#657286]" style={{ textAlign: "right" }}>{new Date(request.createdAt).toLocaleString("ar-EG")}</Text>{request.rejectionReason ? <Text className="mt-2 text-xs text-[#FF9BA7]" style={{ textAlign: "right" }}>{request.rejectionReason}</Text> : null}</Card>) : <EmptyState title="لا توجد طلبات خارجية" text="ستظهر طلباتك هنا بعد اختيار دولة وتأكيد الطلب." />}
    </ScrollView>
  </Screen>;
}
