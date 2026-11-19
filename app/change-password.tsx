import { useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView as ScrollView } from "@/components/KeyboardAwareScrollView";
import { useRouter } from "expo-router";
import { ActionButton, Card, Screen } from "@/components/atheer-ui";
import { useAuth } from "@/hooks/use-auth";
import { useEphemeralMutation } from "@/hooks/use-ephemeral-mutation";
import { manualAuthClient } from "@/lib/manual-auth-client";
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

export default function ChangePasswordScreen() {
  const router = useRouter();
  const { logout } = useAuth();
  const requestCode = useEphemeralMutation(manualAuthClient.auth.requestPasswordChangeCode.mutate);
  const changePassword = useEphemeralMutation(manualAuthClient.auth.changePassword.mutate);
  const [challengeId, setChallengeId] = useState("");
  const [code, setCode] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [visible, setVisible] = useState({ current: false, next: false, confirm: false });
  const [error, setError] = useState("");

  const requestVerificationCode = async () => {
    setError("");
    try {
      const result = await requestCode.mutateAsync(undefined);
      setChallengeId(result.challengeId);
      setCode("");
      showFinancialMessage("تم إرسال رمز التحقق", "أرسلنا رمزًا من 6 أرقام إلى البريد الإلكتروني المسجل بحسابك. صلاحيته 10 دقائق.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "تعذر إرسال رمز التحقق. حاول لاحقًا.");
    }
  };

  const submit = async () => {
    setError("");
    if (!challengeId) { setError("أرسل رمز التحقق إلى بريدك المسجل أولًا."); return; }
    if (!/^\d{6}$/.test(code)) { setError("أدخل رمز التحقق المكوّن من 6 أرقام."); return; }
    if (!currentPassword) { setError("أدخل كلمة المرور الحالية."); return; }
    if (password.length < 12 || password.length > 128) { setError("كلمة المرور الجديدة يجب أن تكون من 12 إلى 128 حرفًا."); return; }
    if (password !== confirmPassword) { setError("كلمتا المرور غير متطابقتين."); return; }
    try {
      const result = await changePassword.mutateAsync({ challengeId, code, currentPassword, password, confirmPassword });
      if (!result.mustLoginAgain) throw new Error("تعذر تأكيد تحديث كلمة المرور.");
      setChallengeId(""); setCode(""); setCurrentPassword(""); setPassword(""); setConfirmPassword("");
      await logout().catch(() => undefined);
      router.replace("/(tabs)");
      showFinancialMessage("تم تغيير كلمة المرور بنجاح", "تم إبطال الجلسات الأخرى. سجّل الدخول من جديد بكلمة المرور الجديدة.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "تعذر تغيير كلمة المرور. حاول مرة أخرى.");
    }
  };

  const field = (label: string, value: string, onChangeText: (text: string) => void, key: keyof typeof visible, autoComplete: "current-password" | "new-password") => (
    <View className="mt-5" key={key}>
      <View className="mb-2 flex-row items-center justify-between">
        <Pressable accessibilityRole="button" accessibilityLabel={visible[key] ? `إخفاء ${label}` : `إظهار ${label}`} onPress={() => setVisible((state) => ({ ...state, [key]: !state[key] }))}>
          <Text className="text-xs font-semibold text-[#D7B75E]">{visible[key] ? "إخفاء" : "إظهار"}</Text>
        </Pressable>
        <Text className="text-sm font-semibold text-[#C7B98D]" style={{ textAlign: "right" }}>{label}</Text>
      </View>
      <TextInput accessibilityLabel={label} autoComplete={autoComplete} secureTextEntry={!visible[key]} value={value} onChangeText={onChangeText} placeholder={label} placeholderTextColor="#657286" style={inputStyle} />
    </View>
  );

  return (
    <Screen title="تغيير كلمة المرور" subtitle="تحقق من كلمة المرور الحالية أولًا">
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ paddingBottom: 120 }}>
        <Card>
          <Text className="text-sm leading-6 text-[#9BA8B8]" style={{ textAlign: "right" }}>
            يُرسل رمز تحقق أحادي الاستخدام إلى البريد المسجل قبل تغيير كلمة المرور. بعد نجاح التغيير ستُنهى الجلسات المسجلة على أجهزتك، وستحتاج إلى تسجيل الدخول مجددًا.
          </Text>
          <View className="mt-5"><ActionButton label={requestCode.isPending ? "جارٍ إرسال الرمز..." : challengeId ? "إعادة إرسال رمز التحقق" : "إرسال رمز التحقق إلى بريدي"} icon="mail-outline" secondary onPress={() => { if (!requestCode.isPending) void requestVerificationCode(); }} /></View>
          {challengeId ? <View className="mt-5">
            <Text className="mb-2 text-sm font-semibold text-[#C7B98D]" style={{ textAlign: "right" }}>رمز التحقق من البريد (6 أرقام)</Text>
            <TextInput accessibilityLabel="رمز التحقق من البريد" autoComplete="one-time-code" keyboardType="number-pad" maxLength={6} value={code} onChangeText={(value) => setCode(value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" placeholderTextColor="#657286" style={{ ...inputStyle, textAlign: "center", letterSpacing: 7 }} />
          </View> : null}
          {field("كلمة المرور الحالية", currentPassword, setCurrentPassword, "current", "current-password")}
          {field("كلمة المرور الجديدة", password, setPassword, "next", "new-password")}
          {field("تأكيد كلمة المرور الجديدة", confirmPassword, setConfirmPassword, "confirm", "new-password")}
          {error ? <Text accessibilityRole="alert" className="mt-4 text-sm leading-6 text-[#F58F96]" style={{ textAlign: "right" }}>{error}</Text> : null}
          {changePassword.isPending ? <View className="mt-4 items-center"><ActivityIndicator color="#D7A948" /></View> : null}
          <View className="mt-6"><ActionButton label={changePassword.isPending ? "جارٍ التحديث..." : "تأكيد تغيير كلمة المرور"} icon="key-outline" onPress={() => void submit()} /></View>
          <Pressable accessibilityRole="link" onPress={() => router.push("/forgot-password")} className="mt-5 self-end">
            <Text className="text-sm font-semibold text-[#D7B75E]">هل نسيت كلمة المرور؟</Text>
          </Pressable>
        </Card>
      </ScrollView>
    </Screen>
  );
}
