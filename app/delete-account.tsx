import { useState } from "react";
import { ActivityIndicator, Alert, Platform, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView as ScrollView } from "@/components/KeyboardAwareScrollView";
import { useRouter } from "expo-router";
import { ActionButton, Card, Pill, Screen } from "@/components/atheer-ui";
import { useAuth } from "@/hooks/use-auth";
import { useEphemeralMutation } from "@/hooks/use-ephemeral-mutation";
import { manualAuthClient } from "@/lib/manual-auth-client";
import { trpc } from "@/lib/trpc";
import { showFinancialMessage } from "@/lib/financial-feedback";

const inputStyle = {
  minHeight: 52,
  borderWidth: 1,
  borderColor: "#273548",
  borderRadius: 14,
  backgroundColor: "#0B1018",
  color: "#F7F1E3",
  paddingHorizontal: 14,
  fontSize: 16,
  textAlign: "right" as const,
};

export default function DeleteAccountScreen() {
  const router = useRouter();
  const { user, loading, logout } = useAuth();
  const utils = trpc.useUtils();
  const eligibility = trpc.account.deletionEligibility.useQuery(undefined, { enabled: Boolean(user), retry: false, refetchOnMount: "always" });
  const deleteAccount = useEphemeralMutation(manualAuthClient.account.deleteMine.mutate);
  const [customerId, setCustomerId] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const canDelete = eligibility.data?.eligible === true && eligibility.data.status === "active";

  const submit = async () => {
    setError("");
    if (!canDelete) { setError("لا يمكن حذف الحساب قبل إزالة جميع الأرصدة والالتزامات والمعاملات المعلّقة."); return; }
    if (!user || customerId.trim() !== user.customerId) { setError("أدخل رقم الحساب الظاهر في ملفك الشخصي كما هو تمامًا."); return; }
    if (email.trim().toLowerCase() !== user.email?.trim().toLowerCase()) { setError("أدخل البريد الإلكتروني المسجل بالحساب كما هو."); return; }
    if (!password) { setError("أدخل كلمة المرور الحالية للتأكيد."); return; }
    try {
      await deleteAccount.mutateAsync({ customerId: customerId.trim(), email: email.trim(), password, reason: reason.trim() || undefined });
      setPassword(""); setCustomerId(""); setEmail(""); setReason("");
      await utils.account.deletionEligibility.invalidate();
      await logout().catch(() => undefined);
      router.replace("/(tabs)");
      showFinancialMessage("تم حذف الحساب", "انتهت الجلسة وأصبح الحساب غير متاح للدخول. تُحفظ السجلات المالية، ولا تتم الاستعادة إلا بمراجعة خدمة العملاء وموافقة المدير.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر حذف الحساب. لم تُحذف بياناتك؛ حاول مجددًا.");
      await eligibility.refetch();
    }
  };

  const confirmSubmit = () => {
    const title = "تأكيد حذف الحساب";
    const message = "لن تتمكن من إعادة تفعيل الحساب بنفسك. ستُنهى الجلسات ويُحفظ السجل المالي؛ والاستعادة متاحة للمدير بعد مراجعة الدعم فقط. هل تريد المتابعة؟";
    if (Platform.OS === "web") {
      if (typeof window !== "undefined" && window.confirm(`${title}\n\n${message}`)) void submit();
      return;
    }
    Alert.alert(title, message, [
      { text: "إلغاء", style: "cancel" },
      { text: "تأكيد حذف الحساب", style: "destructive", onPress: () => void submit() },
    ], { cancelable: true });
  };

  return (
    <Screen title="حذف الحساب" subtitle="تعطيل الدخول مع حفظ السجلات المالية وإتاحة الاستعادة الإدارية فقط">
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ paddingBottom: 120 }}>
        <Card>
          <View className="flex-row items-center justify-between"><Pill tone="gold">حذف منطقي</Pill><Text className="text-lg font-bold text-[#F7F1E3]" style={{ textAlign: "right" }}>قبل المتابعة</Text></View>
          <Text className="mt-4 text-sm leading-6 text-[#9BA8B8]" style={{ textAlign: "right" }}>
            سيُمنع تسجيل الدخول وتُنهى الجلسات. لا تُحذف البيانات المالية أو سجل المعاملات؛ ولا يمكن للمستخدم إعادة التفعيل بنفسه، والاستعادة بقرار المدير بعد مراجعة الدعم.
          </Text>
          <Text className="mt-3 text-sm leading-6 text-[#C7B98D]" style={{ textAlign: "right" }}>
            يمنع الحذف عند وجود رصيد مالي أو كوين أو أصل مملوك أو مبلغ محجوز، أو خطة ادخار مفتوحة أو عائد مستحق أو طلب/تحويل/أمر/التزام معلّق.
          </Text>
        </Card>

        <Card className="mt-4">
          <View className="flex-row items-center justify-between"><Pill tone={eligibility.data?.eligible ? "green" : eligibility.data?.status === "deleted" ? "red" : "muted"}>{eligibility.isLoading ? "جارٍ التحقق" : eligibility.data?.eligible ? "مستوفٍ للشروط" : eligibility.data?.status === "deleted" ? "محذوف بالفعل" : "غير مستوفٍ"}</Pill><Text className="text-base font-bold text-[#F7F1E3]" style={{ textAlign: "right" }}>أهلية الحذف</Text></View>
          {eligibility.isLoading ? <View className="mt-4 items-center"><ActivityIndicator color="#D7A948" /></View> : eligibility.isError ? <Text className="mt-4 text-sm leading-6 text-[#F58F96]" style={{ textAlign: "right" }}>تعذر التحقق من الأرصدة والالتزامات. لن نتابع الحذف حتى ينجح التحقق.</Text> : eligibility.data?.eligible ? <Text className="mt-4 text-sm leading-6 text-[#8DCFAE]" style={{ textAlign: "right" }}>لا توجد أرصدة أو التزامات مفتوحة تمنع الحذف حاليًا. سيعيد الخادم فحصها داخل معاملة قبل التنفيذ.</Text> : <View className="mt-3 gap-2">{eligibility.data?.blockers.map((blocker, index) => <Text key={`${index}:${blocker}`} className="text-sm leading-6 text-[#FF9BA7]" style={{ textAlign: "right" }}>• {blocker}</Text>)}</View>}
          {eligibility.isError ? <View className="mt-4"><ActionButton label="إعادة التحقق" icon="refresh-outline" secondary onPress={() => void eligibility.refetch()} /></View> : null}
        </Card>

        {canDelete ? <Card className="mt-4 border-[#5C4A28]">
          <Text className="text-base font-bold text-[#F7F1E3]" style={{ textAlign: "right" }}>تأكيد الهوية</Text>
          <Text className="mt-2 text-xs leading-5 text-[#9BA8B8]" style={{ textAlign: "right" }}>أدخل البريد الإلكتروني المسجل ورقم الحساب وكلمة المرور الحالية. لا نطلب رقم البطاقة أو بيانات الدفع.</Text>
          <Text className="mb-2 mt-5 text-sm font-semibold text-[#C7B98D]" style={{ textAlign: "right" }}>البريد الإلكتروني المسجل</Text>
          <TextInput accessibilityLabel="البريد الإلكتروني المسجل" autoCapitalize="none" autoComplete="email" keyboardType="email-address" value={email} onChangeText={setEmail} placeholder="name@example.com" placeholderTextColor="#657286" style={{ ...inputStyle, writingDirection: "ltr", textAlign: "left" }} />
          <Text className="mb-2 mt-4 text-sm font-semibold text-[#C7B98D]" style={{ textAlign: "right" }}>رقم الحساب</Text>
          <TextInput accessibilityLabel="رقم الحساب" keyboardType="number-pad" maxLength={10} value={customerId} onChangeText={(value) => setCustomerId(value.replace(/\D/g, "").slice(0, 10))} placeholder="10 أرقام" placeholderTextColor="#657286" style={{ ...inputStyle, writingDirection: "ltr", textAlign: "left" }} />
          <Text className="mb-2 mt-4 text-sm font-semibold text-[#C7B98D]" style={{ textAlign: "right" }}>كلمة المرور الحالية</Text>
          <TextInput accessibilityLabel="كلمة المرور الحالية" autoComplete="current-password" secureTextEntry value={password} onChangeText={setPassword} placeholder="كلمة المرور" placeholderTextColor="#657286" style={inputStyle} />
          <Text className="mb-2 mt-4 text-sm font-semibold text-[#C7B98D]" style={{ textAlign: "right" }}>سبب الحذف (اختياري)</Text>
          <TextInput accessibilityLabel="سبب حذف الحساب" value={reason} onChangeText={setReason} maxLength={500} placeholder="يمكنك إضافة ملاحظة للدعم" placeholderTextColor="#657286" style={inputStyle} />
          {error ? <Text accessibilityRole="alert" className="mt-4 text-sm leading-6 text-[#F58F96]" style={{ textAlign: "right" }}>{error}</Text> : null}
          <View className="mt-6"><ActionButton label={deleteAccount.isPending ? "جارٍ فحص الحساب..." : "تأكيد حذف الحساب"} icon="person-remove-outline" secondary onPress={confirmSubmit} /></View>
        </Card> : null}

        {loading ? <View className="mt-4 items-center"><ActivityIndicator color="#D7A948" /></View> : null}
        <View className="mt-4"><ActionButton label="التواصل مع الدعم" icon="chatbubbles-outline" secondary onPress={() => router.push("/support-portal" as never)} /></View>
      </ScrollView>
    </Screen>
  );
}
