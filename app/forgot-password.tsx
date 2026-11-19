import { useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView as ScrollView } from "@/components/KeyboardAwareScrollView";
import { useRouter } from "expo-router";
import { ActionButton, Card, Screen } from "@/components/atheer-ui";
import { emailAddressSchema, passwordSchema } from "@/shared/registration";
import { useQueryClient } from "@tanstack/react-query";
import { manualAuthClient, saveManualSession } from "@/lib/manual-auth-client";
import { manualVerificationClient } from "@/lib/manual-verification-client";
import { useEphemeralMutation } from "@/hooks/use-ephemeral-mutation";
import { authSessionState } from "@/shared/auth-session-state";
import { authenticatedHomeRoute } from "@/shared/auth-routing";
import { showFinancialMessage } from "@/lib/financial-feedback";

const inputStyle = {
  minHeight: 54,
  borderWidth: 1,
  borderColor: "#273548",
  borderRadius: 16,
  backgroundColor: "#0B1018",
  color: "#F7F1E3",
  paddingHorizontal: 16,
  fontSize: 16,
};

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const requestCode = useEphemeralMutation(manualAuthClient.auth.requestEmailCode.mutate);
  const verifyCode = useEphemeralMutation(manualAuthClient.auth.verifyEmailCode.mutate);
  const redeemManual = useEphemeralMutation(manualVerificationClient.verificationAssistance.redeem.mutate);
  const resetPassword = useEphemeralMutation(manualAuthClient.auth.resetPassword.mutate);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [manualMode, setManualMode] = useState(false);
  const [grantToken, setGrantToken] = useState("");
  const [phase, setPhase] = useState<"email" | "code" | "password">("email");
  const [error, setError] = useState("");
  const pending = requestCode.isPending || verifyCode.isPending || redeemManual.isPending || resetPassword.isPending;

  const submitEmail = async () => {
    if (pending) return;
    setError("");
    const parsed = emailAddressSchema.safeParse(email);
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "أدخل بريدًا صحيحًا."); return; }
    try {
      const response = await requestCode.mutateAsync({ email: parsed.data, purpose: "password_reset" });
      setManualMode(false); setCode("");
      setChallengeId(response.challengeId);
      setPhase("code");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "تعذر بدء الاستعادة.");
    }
  };

  const beginManual = () => {
    if (pending) return;
    const parsed = emailAddressSchema.safeParse(email);
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "أدخل بريدًا صحيحًا."); return; }
    setError(""); setChallengeId(""); setCode(""); setManualMode(true); setPhase("code");
  };

  const submitCode = async () => {
    if (pending || (!manualMode && !challengeId)) return;
    setError("");
    try {
      const verified = manualMode ? await redeemManual.mutateAsync({ email, purpose: "password_reset", code: code.trim() }) : await verifyCode.mutateAsync({ challengeId, code: code.trim() });
      if (!verified.grantToken) throw new Error("تعذر إصدار رمز استعادة آمن. اطلب رمزًا جديدًا.");
      if (manualMode) {
        if (!("challengeId" in verified)) throw new Error("تعذر إصدار رمز استعادة آمن. اطلب رمزًا جديدًا.");
        setChallengeId(verified.challengeId);
      }
      setCode("");
      setGrantToken(verified.grantToken);
      setPhase("password");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "تعذر التحقق من الرمز.");
    }
  };

  const submitPassword = async () => {
    if (pending || !challengeId || !grantToken) return;
    setError("");
    if (password !== confirmPassword) { setError("كلمتا المرور غير متطابقتين."); return; }
    const parsed = passwordSchema.safeParse(password);
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "اختر كلمة مرور أطول."); return; }
    const generation = authSessionState.getSnapshot().generation;
    try {
      const session = await resetPassword.mutateAsync({ challengeId, grantToken, password, confirmPassword });
      authSessionState.assertCurrent(generation);
      setPassword(""); setConfirmPassword(""); setCode(""); setGrantToken("");
      await saveManualSession(session, queryClient, generation);
      router.replace(authenticatedHomeRoute(session.user.role));
      showFinancialMessage("تم تغيير كلمة المرور بنجاح", "استخدم كلمة المرور الجديدة في تسجيل الدخول.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "تعذر تحديث كلمة المرور.");
    }
  };

  return (
    <Screen title="استعادة كلمة المرور" subtitle="تأكيد عبر البريد الإلكتروني">
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets style={{ width: "100%", flex: 1 }} contentContainerStyle={{ width: "100%", flexGrow: 1, paddingBottom: 40 }}>
        <Card className="w-full">
          {phase === "email" ? (
            <>
              <Text className="text-base leading-7 text-[#9BA8B8]" style={{ textAlign: "right" }}>أدخل البريد الإلكتروني المرتبط بالحساب. لا يمكن تغيير كلمة المرور باستخدام رقم الهاتف وحده.</Text>
              <Text className="mb-2 mt-6 text-sm font-semibold text-[#C7B98D]" style={{ textAlign: "right" }}>البريد الإلكتروني</Text>
              <TextInput accessibilityLabel="البريد الإلكتروني" autoCapitalize="none" autoComplete="email" keyboardType="email-address" value={email} onChangeText={setEmail} placeholder="name@example.com" placeholderTextColor="#657286" style={{ ...inputStyle, writingDirection: "ltr", textAlign: "left" }} />
              <Text className="mt-3 text-xs leading-5 text-[#657286]" style={{ textAlign: "right" }}>إذا كان الحساب موجودًا، سيصل رمز صالح لمدة 10 دقائق إلى البريد. لا نكشف ما إذا كان البريد مسجلًا.</Text>
              <View className="mt-6"><ActionButton label={pending ? "جارٍ الإرسال" : "إرسال رمز الاستعادة"} icon="mail-outline" onPress={submitEmail} /></View>
              <Pressable onPress={beginManual} className="mt-5 self-center"><Text className="text-sm text-[#D7B75E]">لديّ رمز يدوي بعد مراجعة الإدارة</Text></Pressable>
            </>
          ) : null}
          {phase === "code" ? (
            <>
              <Text className="text-lg font-bold text-[#F7F1E3]" style={{ textAlign: "right" }}>أدخل رمز البريد</Text>
              <Text className="mt-2 text-sm leading-6 text-[#9BA8B8]" style={{ textAlign: "right" }}>{manualMode ? `أدخل رمز الإدارة المرتبط بالبريد ${email}.` : `إذا كان الحساب موجودًا، أدخل الرمز الذي وصل إلى ${email}.`}</Text>
              <TextInput accessibilityLabel="رمز التحقق" keyboardType="number-pad" maxLength={6} value={code} onChangeText={setCode} placeholder="000000" placeholderTextColor="#657286" style={{ ...inputStyle, marginTop: 20, textAlign: "center", letterSpacing: 8, fontSize: 22 }} />
              <View className="mt-6"><ActionButton label={pending ? "جارٍ التحقق" : "تحقق من الرمز"} icon="checkmark-circle-outline" onPress={submitCode} /></View>
              {manualMode ? <Pressable onPress={() => { setCode(""); setChallengeId(""); setPhase("email"); }} className="mt-5 self-center"><Text className="text-sm text-[#D7B75E]">العودة إلى البريد</Text></Pressable> : <Pressable onPress={beginManual} className="mt-5 self-center"><Text className="text-sm text-[#D7B75E]">استخدام رمز يدوي بعد مراجعة الإدارة</Text></Pressable>}
            </>
          ) : null}
          {phase === "password" ? (
            <>
              <Text className="text-lg font-bold text-[#F7F1E3]" style={{ textAlign: "right" }}>اختر كلمة مرور جديدة</Text>
              <TextInput accessibilityLabel="كلمة مرور جديدة" autoComplete="new-password" secureTextEntry value={password} onChangeText={setPassword} placeholder="12 حرفًا على الأقل" placeholderTextColor="#657286" style={{ ...inputStyle, marginTop: 18, textAlign: "right" }} />
              <TextInput accessibilityLabel="تأكيد كلمة المرور الجديدة" autoComplete="new-password" secureTextEntry value={confirmPassword} onChangeText={setConfirmPassword} placeholder="تأكيد كلمة المرور" placeholderTextColor="#657286" style={{ ...inputStyle, marginTop: 14, textAlign: "right" }} />
              <View className="mt-6"><ActionButton label={pending ? "جارٍ الحفظ" : "حفظ كلمة المرور والدخول"} icon="key-outline" onPress={submitPassword} /></View>
            </>
          ) : null}
          {error ? <Text accessibilityRole="alert" className="mt-4 text-sm leading-6 text-[#F58F96]" style={{ textAlign: "right" }}>{error}</Text> : null}
          {pending ? <View className="mt-4 items-center"><ActivityIndicator color="#D7A948" /></View> : null}
          <Pressable onPress={() => router.replace("/(tabs)")} className="mt-6 self-center"><Text className="text-sm text-[#D7B75E]">العودة لتسجيل الدخول</Text></Pressable>
        </Card>
      </ScrollView>
    </Screen>
  );
}
