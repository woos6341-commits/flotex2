import { useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { ActionButton, Card } from "@/components/atheer-ui";
import { trpc } from "@/lib/trpc";
import { DEFAULT_FEE_POLICY, type FeePolicy, type WithdrawalFeeTier } from "@/shared/fee-policy";
import { formatMoneyMinorUnits, parseMoneyMinorUnits } from "@/shared/transactions";

type Feedback = { error: boolean; text: string } | null;

function moneyInput(value: string, onChangeText: (next: string) => void, placeholder: string) {
  return <TextInput
    value={value}
    onChangeText={(text) => onChangeText(text.replace(/[^0-9.]/g, ""))}
    keyboardType="decimal-pad"
    textAlign="right"
    placeholder={placeholder}
    placeholderTextColor="#657286"
    className="rounded-xl border border-[#273548] bg-[#0B1018] px-3 py-3 text-[#F7F1E3]"
  />;
}

function ToggleRow({ title, enabled, onPress }: { title: string; enabled: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="switch" accessibilityState={{ checked: enabled }} onPress={onPress} className="flex-row items-center justify-between rounded-2xl border border-[#273548] bg-[#0B1018] px-4 py-3">
    <Text className="text-sm font-bold text-[#F7F1E3]">{title}</Text>
    <View className={`rounded-full px-3 py-1 ${enabled ? "bg-[#2E6657]" : "bg-[#384252]"}`}><Text className="text-xs font-bold text-white">{enabled ? "مفعّلة" : "متوقفة"}</Text></View>
  </Pressable>;
}

export function FeesAdmin() {
  const query = trpc.payment.fees.useQuery(undefined, { refetchOnWindowFocus: true });
  const update = trpc.admin.updateFeePolicy.useMutation();
  const [draftOverride, setDraftOverride] = useState<FeePolicy | null>(null);
  const draft = draftOverride ?? query.data ?? DEFAULT_FEE_POLICY;
  const [feedback, setFeedback] = useState<Feedback>(null);
  const updateDraft = (updater: (current: FeePolicy) => FeePolicy) => {
    setDraftOverride((current) => updater(current ?? query.data ?? DEFAULT_FEE_POLICY));
  };

  const updateTier = (index: number, patch: Partial<WithdrawalFeeTier>) => {
    updateDraft((current) => ({
      ...current,
      withdrawalTiers: current.withdrawalTiers.map((tier, tierIndex) => tierIndex === index ? { ...tier, ...patch } : tier),
    }));
    setFeedback(null);
  };

  const addTier = () => {
    const tiers = [...draft.withdrawalTiers].sort((a, b) => parseMoneyMinorUnits(a.minimumAmount) - parseMoneyMinorUnits(b.minimumAmount));
    const last = tiers.at(-1);
    if (last && last.maximumAmount === null) {
      setFeedback({ error: true, text: "حدّد حدًا أعلى للشريحة المفتوحة أولًا؛ ستُنشأ الشريحة التالية تلقائيًا من القرش الذي يليها." });
      return;
    }
    const nextMinimum = last ? formatMoneyMinorUnits(parseMoneyMinorUnits(last.maximumAmount!) + 1) : "0.01";
    const id = `tier-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    updateDraft((current) => ({
      ...current,
      withdrawalTiers: [...current.withdrawalTiers, {
        id,
        minimumAmount: nextMinimum,
        maximumAmount: null,
        feeAmount: "0.00",
      }],
    }));
    setFeedback({ error: false, text: "أضيفت شريحة مفتوحة جديدة؛ عدّل الحد الأعلى للشريحة السابقة قبل الحفظ إذا أردت أكثر من شريحة." });
  };

  const removeTier = (id: string) => {
    updateDraft((current) => ({ ...current, withdrawalTiers: current.withdrawalTiers.filter((tier) => tier.id !== id) }));
    setFeedback(null);
  };

  const save = () => {
    setFeedback(null);
    update.mutate(draft, {
      onSuccess: (saved) => {
        setDraftOverride({ ...saved, withdrawalTiers: saved.withdrawalTiers.map((tier) => ({ ...tier })) });
        setFeedback({ error: false, text: "حُفظت سياسة الرسوم على الخادم. ستُطبّق على الطلبات الجديدة فقط." });
        void query.refetch();
      },
      onError: (error) => setFeedback({ error: true, text: error.message || "تعذر حفظ الرسوم." }),
    });
  };

  if (query.isLoading) return <Card><ActivityIndicator color="#D7A948" /><Text className="mt-3 text-center text-sm text-[#9BA8B8]">جارٍ تحميل سياسة الرسوم…</Text></Card>;
  if (query.isError) return <Card><Text className="text-sm leading-6 text-[#FF7D8D]">تعذر تحميل رسوم الخادم؛ لن تُقبل تغييرات الرسوم قبل نجاح الاتصال.</Text><View className="mt-3"><ActionButton label="إعادة المحاولة" icon="refresh-outline" onPress={() => void query.refetch()} /></View></Card>;

  return <View className="mt-2">
    <Card className="mb-4">
      <Text className="text-lg font-bold text-[#F7F1E3]">إعدادات رسوم العمليات</Text>
      <Text className="mt-1 text-xs leading-5 text-[#9BA8B8]">يعيد الخادم حساب الرسوم ويحتفظ بنسخة من الرسم عند إنشاء الطلب. تغيير الإعدادات لا يعدّل الطلبات السابقة.</Text>
      <View className="mt-4 gap-3">
        <ToggleRow title="رسوم السحب" enabled={draft.withdrawalEnabled} onPress={() => updateDraft((current) => ({ ...current, withdrawalEnabled: !current.withdrawalEnabled }))} />
        <ToggleRow title="رسوم إرسال الأموال" enabled={draft.transferEnabled} onPress={() => updateDraft((current) => ({ ...current, transferEnabled: !current.transferEnabled }))} />
      </View>
      <Text className="mb-2 mt-4 text-xs font-bold text-[#9BA8B8]">الرسم الثابت لكل إرسال (ج.م)</Text>
      {moneyInput(draft.transferFeeAmount, (transferFeeAmount) => updateDraft((current) => ({ ...current, transferFeeAmount })), "1.00")}
      <View className="mt-4 rounded-xl border border-[#2E6657] bg-[#10251F] p-3"><Text className="text-sm font-bold text-[#47D7A5]">الإيداع مجاني دائمًا بلا رسوم</Text><Text className="mt-1 text-xs leading-5 text-[#9BA8B8]">لا توجد إعدادات لتفعيل رسم الإيداع أو تغييره.</Text></View>
    </Card>

    <Card className="mb-4">
      <View className="flex-row items-start justify-between gap-2"><View className="flex-1"><Text className="text-base font-bold text-[#F7F1E3]">شرائح رسوم السحب</Text><Text className="mt-1 text-xs leading-5 text-[#9BA8B8]">الحدان شاملان. اترك الحد الأعلى فارغًا للشريحة الأخيرة المفتوحة.</Text></View><Pressable accessibilityRole="button" onPress={addTier} className="rounded-xl border border-[#D7A948] px-3 py-2"><Text className="text-xs font-bold text-[#D7A948]">إضافة شريحة</Text></Pressable></View>
      {draft.withdrawalTiers.length === 0 && <Text className="mt-4 text-xs text-[#9BA8B8]">لا توجد شرائح. أضف شريحة واحدة على الأقل قبل تفعيل رسوم السحب.</Text>}
      <View className="mt-4 gap-3">
        {draft.withdrawalTiers.map((tier, index) => <View key={tier.id} className="rounded-2xl border border-[#273548] bg-[#0B1018] p-3">
          <View className="mb-3 flex-row items-center justify-between"><Text className="font-bold text-[#D7A948]">الشريحة {index + 1}</Text><Pressable accessibilityRole="button" accessibilityLabel={`حذف الشريحة ${index + 1}`} onPress={() => removeTier(tier.id)}><Text className="text-xs font-bold text-[#FF7D8D]">حذف</Text></Pressable></View>
          <View className="flex-row gap-2"><View className="flex-1"><Text className="mb-1 text-[11px] text-[#9BA8B8]">من (ج.م)</Text>{moneyInput(tier.minimumAmount, (minimumAmount) => updateTier(index, { minimumAmount }), "50.00")}</View><View className="flex-1"><Text className="mb-1 text-[11px] text-[#9BA8B8]">إلى (ج.م)</Text>{moneyInput(tier.maximumAmount ?? "", (value) => updateTier(index, { maximumAmount: value.trim() || null }), "بلا حد أعلى")}</View></View>
          <View className="mt-3"><Text className="mb-1 text-[11px] text-[#9BA8B8]">قيمة الرسم (ج.م)</Text>{moneyInput(tier.feeAmount, (feeAmount) => updateTier(index, { feeAmount }), "5.00")}</View>
        </View>)}
      </View>
      {feedback && <Text className={`mt-3 text-sm leading-5 ${feedback.error ? "text-[#FF7D8D]" : "text-[#47D7A5]"}`}>{feedback.text}</Text>}
      <View className="mt-4"><ActionButton label={update.isPending ? "جارٍ الحفظ" : "حفظ سياسة الرسوم"} icon="save-outline" onPress={save} /></View>
    </Card>
  </View>;
}
