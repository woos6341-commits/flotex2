import { useState } from "react";
import { ActivityIndicator, Text, TextInput, View } from "react-native";
import { ActionButton, Card } from "@/components/atheer-ui";
import { trpc } from "@/lib/trpc";
import { SAVINGS_SETTINGS_DEFAULTS, savingsSettingsInputSchema } from "@/shared/savings-settings";

const inputStyle = { minHeight: 48, borderWidth: 1, borderColor: "#273548", borderRadius: 14, backgroundColor: "#0B1018", color: "#F7F1E3", paddingHorizontal: 14, fontSize: 16, textAlign: "right" as const, writingDirection: "ltr" as const };

export function SavingsSettingsAdmin() {
  const query = trpc.admin.savingsSettings.useQuery(undefined, { retry: false });
  const utils = trpc.useUtils();
  if (query.isLoading) return <Card><ActivityIndicator color="#D7A948" /><Text className="mt-2 text-center text-xs text-[#9BA8B8]">جارٍ تحميل إعدادات الإدخار...</Text></Card>;
  if (query.isError || !query.data) return <Card><Text className="text-sm text-[#FF7D8D]" style={{ textAlign: "right" }}>تعذر تحميل إعدادات الإدخار.</Text><View className="mt-3"><ActionButton label="إعادة المحاولة" icon="refresh-outline" onPress={() => void query.refetch()} /></View></Card>;
  return <SavingsSettingsForm key={`${query.data.settings.updatedAt}`} initial={query.data.settings} audits={query.data.audits} onSaved={(saved) => { query.refetch(); utils.savings.settings.setData(undefined, saved.settings); }} />;
}

function SavingsSettingsForm({ initial, audits, onSaved }: { initial: any; audits: any[]; onSaved: (result: any) => void }) {
  const [feeAmount, setFeeAmount] = useState(initial.feeAmount);
  const [minimumAmount, setMinimumAmount] = useState(initial.minimumAmount);
  const [dailyRatePercent, setDailyRatePercent] = useState(initial.dailyRatePercent);
  const [monthlyRatePercent, setMonthlyRatePercent] = useState(initial.monthlyRatePercent);
  const [yearlyRatePercent, setYearlyRatePercent] = useState(initial.yearlyRatePercent);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState(false);
  const save = trpc.admin.updateSavingsSettings.useMutation({ onSuccess: (result) => { setFeedback("تم حفظ إعدادات الإدخار وتطبيقها على الطلبات الجديدة."); setError(false); onSaved(result); }, onError: (e) => { setFeedback(e.message || "تعذر حفظ الإعدادات."); setError(true); } });
  const submit = () => {
    const parsed = savingsSettingsInputSchema.safeParse({ minimumAmount, feeAmount, dailyRatePercent, monthlyRatePercent, yearlyRatePercent });
    if (!parsed.success) { setFeedback(parsed.error.issues[0]?.message ?? "راجع القيم المدخلة."); setError(true); return; }
    setFeedback("");
    save.mutate(parsed.data);
  };
  return <View className="gap-4">
    <Card className="border-[#5C4A28]"><Text className="text-base font-bold text-[#F7F1E3]" style={{ textAlign: "right" }}>إعدادات الإدخار</Text><Text className="mt-1 text-xs leading-5 text-[#9BA8B8]" style={{ textAlign: "right" }}>تُطبق القيم الجديدة على طلبات الإدخار الجديدة فقط. العقود القائمة تحتفظ بنسبة العائد والرسوم المحفوظة وقت إنشاء الطلب.</Text>
      <Text className="mb-2 mt-4 text-xs font-semibold text-[#C7B98D]" style={{ textAlign: "right" }}>الحد الأدنى لمبلغ الإدخار (ج.م)</Text><TextInput value={minimumAmount} onChangeText={setMinimumAmount} keyboardType="decimal-pad" placeholder={SAVINGS_SETTINGS_DEFAULTS.minimumAmount} placeholderTextColor="#657286" style={inputStyle} />
      <Text className="mb-2 mt-4 text-xs font-semibold text-[#C7B98D]" style={{ textAlign: "right" }}>رسوم طلب الإدخار عند الاعتماد (ج.م)</Text><TextInput value={feeAmount} onChangeText={setFeeAmount} keyboardType="decimal-pad" placeholder={SAVINGS_SETTINGS_DEFAULTS.feeAmount} placeholderTextColor="#657286" style={inputStyle} />
      <Text className="mb-2 mt-4 text-xs font-semibold text-[#C7B98D]" style={{ textAlign: "right" }}>نسبة العائد اليومي (%)</Text><TextInput value={dailyRatePercent} onChangeText={setDailyRatePercent} keyboardType="decimal-pad" placeholder={SAVINGS_SETTINGS_DEFAULTS.dailyRatePercent} placeholderTextColor="#657286" style={inputStyle} />
      <Text className="mb-2 mt-4 text-xs font-semibold text-[#C7B98D]" style={{ textAlign: "right" }}>نسبة العائد الشهري (%)</Text><TextInput value={monthlyRatePercent} onChangeText={setMonthlyRatePercent} keyboardType="decimal-pad" placeholder={SAVINGS_SETTINGS_DEFAULTS.monthlyRatePercent} placeholderTextColor="#657286" style={inputStyle} />
      <Text className="mb-2 mt-4 text-xs font-semibold text-[#C7B98D]" style={{ textAlign: "right" }}>نسبة العائد السنوي (%)</Text><TextInput value={yearlyRatePercent} onChangeText={setYearlyRatePercent} keyboardType="decimal-pad" placeholder={SAVINGS_SETTINGS_DEFAULTS.yearlyRatePercent} placeholderTextColor="#657286" style={inputStyle} />
      {feedback ? <Text accessibilityRole="alert" className={`text-xs leading-5 ${error ? "text-[#FF7D8D]" : "text-[#47D7A5]"}`} style={{ textAlign: "right" }}>{feedback}</Text> : null}
      <ActionButton label={save.isPending ? "جارٍ حفظ الإعدادات..." : "حفظ الإعدادات"} icon="save-outline" onPress={submit} />
    </Card>
    <Card><Text className="text-base font-bold text-[#F7F1E3]" style={{ textAlign: "right" }}>سجل تعديلات الإعدادات</Text>{audits.length ? audits.map((audit) => <View key={audit.id} className="mt-3 border-b border-[#273548] pb-3"><Text className="text-xs font-bold text-[#F7F1E3]" style={{ textAlign: "right" }}>{audit.field === "minimumAmount" ? "الحد الأدنى للإدخار" : audit.field === "feeAmount" ? "رسوم الطلب" : audit.field === "dailyRatePercent" ? "العائد اليومي" : audit.field === "monthlyRatePercent" ? "العائد الشهري" : "العائد السنوي"}</Text><Text className="mt-1 text-xs text-[#9BA8B8]" style={{ textAlign: "right" }}>{audit.oldValue} ← {audit.newValue} · {new Date(audit.changedAt).toLocaleString("ar-EG")}</Text></View>) : <Text className="mt-3 text-xs text-[#9BA8B8]" style={{ textAlign: "right" }}>لا توجد تعديلات مسجلة بعد.</Text>}</Card>
  </View>;
}
