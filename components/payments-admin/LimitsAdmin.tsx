import { useState } from "react";
import { ActivityIndicator, Text, TextInput, View } from "react-native";
import { ActionButton, Card } from "@/components/atheer-ui";
import { trpc } from "@/lib/trpc";
import type { OperationLimits } from "./types";

const DEFAULTS: OperationLimits = { minDepositAmount: 500, minWithdrawalAmount: 50, minTransferAmount: 1200, maxTradeAmount: null, maxDepositAmount: null, maxWithdrawalAmount: null };
type LimitDraft = Record<keyof OperationLimits, string>;
const asDraft = (value?: Partial<OperationLimits>): LimitDraft => ({
  minDepositAmount: String(value?.minDepositAmount ?? DEFAULTS.minDepositAmount),
  minWithdrawalAmount: String(value?.minWithdrawalAmount ?? DEFAULTS.minWithdrawalAmount),
  minTransferAmount: String(value?.minTransferAmount ?? DEFAULTS.minTransferAmount),
  maxTradeAmount: value?.maxTradeAmount == null ? "" : String(value.maxTradeAmount),
  maxDepositAmount: value?.maxDepositAmount == null ? "" : String(value.maxDepositAmount),
  maxWithdrawalAmount: value?.maxWithdrawalAmount == null ? "" : String(value.maxWithdrawalAmount),
});

export function LimitsAdmin() {
  const limitsQuery = trpc.admin.limits.useQuery(undefined);
  const updateLimits = trpc.admin.updateLimits.useMutation();
  const [overrides, setOverrides] = useState<Partial<LimitDraft>>({});
  const [feedback, setFeedback] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const savedDraft = asDraft(limitsQuery.data);
  const draft: LimitDraft = { ...savedDraft, ...overrides };

  const field = (key: keyof OperationLimits, label: string, placeholder: string) => (
    <View className="mt-3">
      <Text className="mb-1 text-xs text-[#9BA8B8]">{label}</Text>
      <TextInput
        value={draft[key]}
        onChangeText={(value) => setOverrides((previous) => ({ ...previous, [key]: value.replace(/[^0-9.]/g, "") }))}
        placeholder={placeholder}
        placeholderTextColor="#657286"
        keyboardType="decimal-pad"
        className="rounded-2xl border border-[#273548] bg-[#0B1018] px-4 py-3 text-[#F7F1E3]"
      />
    </View>
  );

  const save = () => {
    setFeedback(null);
    if (limitsQuery.isError || !limitsQuery.data) {
      setFeedback({ tone: "error", text: "تعذر تحميل الحدود؛ لم يتم الحفظ." });
      return;
    }
    const required = ["minDepositAmount", "minWithdrawalAmount", "minTransferAmount"] as const;
    if (required.some((key) => !draft[key] || Number(draft[key]) <= 0)) {
      setFeedback({ tone: "error", text: "الحد الأدنى للإيداع والسحب وإرسال الأموال يجب أن يكون أكبر من صفر." });
      return;
    }
    const optional = (key: keyof LimitDraft) => draft[key] === "" ? "0" : draft[key];
    updateLimits.mutate({
      minDepositAmount: draft.minDepositAmount,
      minWithdrawalAmount: draft.minWithdrawalAmount,
      minTransferAmount: draft.minTransferAmount,
      maxTradeAmount: optional("maxTradeAmount"),
      maxDepositAmount: optional("maxDepositAmount"),
      maxWithdrawalAmount: optional("maxWithdrawalAmount"),
    }, {
      onSuccess: () => {
        setOverrides({});
        setFeedback({ tone: "success", text: "تم حفظ حدود العمليات على الخادم." });
        limitsQuery.refetch();
      },
      onError: (error) => setFeedback({ tone: "error", text: error.message || "تعذر حفظ الحدود." }),
    });
  };

  return (
    <Card className="mb-4">
      <Text className="text-lg font-bold text-[#F7F1E3]">حدود العمليات</Text>
      <Text className="mt-1 text-xs leading-5 text-[#9BA8B8]">الافتراضي: حد أدنى للإيداع 500 ج.م، والسحب 50 ج.م، وإرسال الأموال 1200 ج.م. اترك الحد الأقصى فارغًا إذا لم يكن محددًا.</Text>
      {feedback && <Text className={`mt-3 text-sm ${feedback.tone === "error" ? "text-[#FF7D8D]" : "text-[#47D7A5]"}`}>{feedback.text}</Text>}
      {limitsQuery.isLoading ? <ActivityIndicator className="mt-5" color="#D7A948" /> : <>
        {field("minDepositAmount", "الحد الأدنى للإيداع", "500")}
        {field("minWithdrawalAmount", "الحد الأدنى للسحب", "50")}
        {field("minTransferAmount", "الحد الأدنى لإرسال الأموال", "1200")}
        {field("maxTradeAmount", "الحد الأقصى للتداول", "بدون حد")}
        {field("maxDepositAmount", "الحد الأقصى للإيداع", "بدون حد")}
        {field("maxWithdrawalAmount", "الحد الأقصى للسحب", "بدون حد")}
        <View className="mt-4"><ActionButton label={updateLimits.isPending ? "جارٍ الحفظ" : "حفظ الحدود"} icon="save-outline" onPress={save} /></View>
      </>}
    </Card>
  );
}
