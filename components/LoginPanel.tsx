import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Animated, Modal, Pressable, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { KeyboardAwareScrollView } from "@/components/KeyboardAwareScrollView";
import { useRouter } from "expo-router";
import { BrandMark, Card } from "./atheer-ui";
import { useQueryClient } from "@tanstack/react-query";
import { assertManualSession, manualAuthClient, saveManualSession } from "@/lib/manual-auth-client";
import { useEphemeralMutation } from "@/hooks/use-ephemeral-mutation";
import { authSessionState } from "@/shared/auth-session-state";
import { authenticatedHomeRoute } from "@/shared/auth-routing";
import { getDeviceIdentity } from "@/lib/device-identity";
import { startRegistrationProgress, type RegistrationProgress } from "@/shared/registration-progress";

const inputStyle = {
  minHeight: 54,
  borderWidth: 1,
  borderColor: "#273548",
  borderRadius: 16,
  backgroundColor: "#0B1018",
  color: "#F7F1E3",
  paddingHorizontal: 16,
  fontSize: 16,
  textAlign: "right" as const,
};

const LOGIN_SLOGANS = [
  "اشحن ألعابك بسهولة.",
  "ادّخر بذكاء وحقق أهدافك.",
  "حوّل أموالك واستقبلها بسهولة.",
  "تابع معاملاتك وتحكم في محفظتك.",
  "خدماتك المالية والترفيهية في مكان واحد.",
];

export function LoginPanel() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const login = useEphemeralMutation(manualAuthClient.auth.login.mutate);
  const completeDeviceLogin = useEphemeralMutation(manualAuthClient.auth.completeDeviceLogin.mutate);
  const completeInitialPassword = useEphemeralMutation(manualAuthClient.adminCreatedAccounts.completeInitialPassword.mutate);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [initialChallenge, setInitialChallenge] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [sloganIndex, setSloganIndex] = useState(0);
  const [sloganOpacity] = useState(() => new Animated.Value(1));
  const [focusedField, setFocusedField] = useState<"email" | "password" | null>(null);
  const [error, setError] = useState("");
  const [challenge, setChallenge] = useState<{ token: string; deviceId: string; deviceName: string; platform: string } | null>(null);
  const [pin, setPin] = useState("");
  const [progress, setProgress] = useState<RegistrationProgress>("idle");
  const submitBusy = useRef(false);
  const stopProgress = useRef<(() => void) | null>(null);
  useEffect(() => () => stopProgress.current?.(), []);
  useEffect(() => {
    const timer = setInterval(() => {
      Animated.sequence([
        Animated.timing(sloganOpacity, { toValue: 0, duration: 240, useNativeDriver: true }),
      ]).start(({ finished }) => {
        if (!finished) return;
        setSloganIndex((current) => (current + 1) % LOGIN_SLOGANS.length);
        Animated.timing(sloganOpacity, { toValue: 1, duration: 320, useNativeDriver: true }).start();
      });
    }, 4800);
    return () => { clearInterval(timer); sloganOpacity.stopAnimation(); };
  }, [sloganOpacity]);

  const submit = async () => {
    if (login.isPending || submitBusy.current) return;
    submitBusy.current = true;
    stopProgress.current = startRegistrationProgress(setProgress);
    setError("");
    const generation = authSessionState.getSnapshot().generation;
    try {
      const identity = await getDeviceIdentity();
      const session = await login.mutateAsync({ email: email.trim(), password, ...identity });
      authSessionState.assertCurrent(generation);
      if ("requiresInitialPassword" in session && session.requiresInitialPassword) {
        setPassword(""); setInitialChallenge(session.challengeToken);
        return;
      }
      if ("requiresSecurityPin" in session && session.requiresSecurityPin) {
        setPassword("");
        setChallenge({ token: session.challengeToken, ...identity });
        return;
      }
      if (!session.app_session_id || !session.user) {
        throw new Error("تعذر إنشاء جلسة الدخول. أعد المحاولة، وإذا استمرت المشكلة تحقق من اتصال الخادم.");
      }
      assertManualSession(session, email);
      setPassword("");
      await saveManualSession(session, queryClient, generation);
      router.replace(authenticatedHomeRoute(session.user.role));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "تعذر تسجيل الدخول. حاول مجددًا.");
    } finally {
      submitBusy.current = false;
      stopProgress.current?.(); stopProgress.current = null;
    }
  };

  const confirmDevice = async () => {
    if (completeDeviceLogin.isPending) return;
    if (!challenge || !/^\d{4}$/.test(pin)) { setError("أدخل رمز الأمان المكون من 4 أرقام."); return; }
    const generation = authSessionState.getSnapshot().generation;
    try {
      const session = await completeDeviceLogin.mutateAsync({ challengeToken: challenge.token, pin, deviceId: challenge.deviceId, deviceName: challenge.deviceName, platform: challenge.platform });
      authSessionState.assertCurrent(generation);
      if (!session.app_session_id || !session.user) throw new Error("تعذر تثبيت جلسة الجهاز. أعد المحاولة.");
      assertManualSession(session, email);
      setChallenge(null); setPin("");
      await saveManualSession(session, queryClient, generation);
      router.replace(authenticatedHomeRoute(session.user.role));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "رمز الأمان غير صحيح."); }
  };
  const changeInitial = async () => {
    if (completeInitialPassword.isPending || !initialChallenge) return;
    setError("");
    let changed = false;
    const generation = authSessionState.getSnapshot().generation;
    try {
      await completeInitialPassword.mutateAsync({ challengeToken: initialChallenge, password: newPassword, confirmPassword: confirmNewPassword });
      changed = true;
      const identity = await getDeviceIdentity();
      const session = await login.mutateAsync({ email: email.trim(), password: newPassword, ...identity });
      authSessionState.assertCurrent(generation);
      if (!session.app_session_id || !session.user) throw new Error("تعذر فتح الجلسة بعد تغيير كلمة المرور.");
      assertManualSession(session, email);
      setInitialChallenge(""); setNewPassword(""); setConfirmNewPassword("");
      await saveManualSession(session, queryClient, generation);
      router.replace(authenticatedHomeRoute(session.user.role));
    } catch (reason) {
      if (changed) { setInitialChallenge(""); setNewPassword(""); setConfirmNewPassword(""); setError("تم تغيير كلمة المرور. سجّل الدخول باستخدام كلمة المرور الجديدة."); }
      else setError(reason instanceof Error ? reason.message : "تعذر تغيير كلمة المرور.");
    }
  };
  if (initialChallenge) return <View style={{ width: "100%", maxWidth: 560, alignSelf: "center" }}><Card>
    <Text className="text-right text-xl font-bold text-[#F7F1E3]">تعيين كلمة مرور جديدة</Text>
    <Text className="mt-3 text-right text-sm leading-6 text-[#9BA8B8]">هذا أول دخول للحساب الذي أنشأته الإدارة. اختر كلمة مرور جديدة مختلفة قبل الدخول.</Text>
    <TextInput accessibilityLabel="كلمة المرور الجديدة" value={newPassword} onChangeText={setNewPassword} secureTextEntry autoCapitalize="none" autoCorrect={false} textContentType="newPassword" placeholder="كلمة المرور الجديدة (12 حرفًا على الأقل)" placeholderTextColor="#657286" maxLength={128} style={{ ...inputStyle, marginTop: 18 }} />
    <TextInput accessibilityLabel="تأكيد كلمة المرور الجديدة" value={confirmNewPassword} onChangeText={setConfirmNewPassword} secureTextEntry autoCapitalize="none" autoCorrect={false} textContentType="newPassword" placeholder="تأكيد كلمة المرور الجديدة" placeholderTextColor="#657286" maxLength={128} style={{ ...inputStyle, marginTop: 12 }} />
    {error ? <Text accessibilityRole="alert" className="mt-4 text-right text-sm text-[#F58F96]">{error}</Text> : null}
    <Pressable accessibilityRole="button" disabled={completeInitialPassword.isPending} onPress={() => void changeInitial()} style={{ minHeight: 52, marginTop: 18, borderRadius: 16, backgroundColor: "#D7A948", alignItems: "center", justifyContent: "center" }}><Text style={{ color: "#0B1018", fontWeight: "800" }}>{completeInitialPassword.isPending ? "جارٍ التحديث…" : "تأكيد كلمة المرور والدخول"}</Text></Pressable>
    <Pressable disabled={completeInitialPassword.isPending} onPress={() => { setInitialChallenge(""); setNewPassword(""); setConfirmNewPassword(""); setError(""); }} className="mt-4 self-center"><Text className="text-sm text-[#D7B75E]">العودة لتسجيل الدخول</Text></Pressable>
  </Card></View>;
  return (
    <View style={{ width: "100%", maxWidth: 560, alignSelf: "center" }}>
    <Card className="w-full">
      <BrandMark />
      <Animated.Text accessibilityLiveRegion="polite" className="mt-3 min-h-5 text-xs font-semibold text-[#D7B75E]" style={{ opacity: sloganOpacity, textAlign: "right" }}>
        {LOGIN_SLOGANS[sloganIndex]}
      </Animated.Text>
      <Text className="mt-8 text-3xl font-bold text-[#F7F1E3]" style={{ textAlign: "right" }}>
        حسابك في Flotex EGP
      </Text>
      <Text className="mt-3 text-base leading-7 text-[#9BA8B8]" style={{ textAlign: "right" }}>
        سجّل الدخول ببريدك الإلكتروني وكلمة المرور.
      </Text>
      <Text className="mb-2 mt-6 text-sm font-semibold text-[#C7B98D]" style={{ textAlign: "right" }}>
        البريد الإلكتروني
      </Text>
      <TextInput
        accessibilityLabel="البريد الإلكتروني"
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        placeholder="name@example.com"
        placeholderTextColor="#657286"
        value={email}
        onChangeText={setEmail}
        onFocus={() => setFocusedField("email")}
        onBlur={() => setFocusedField(null)}
        style={{ ...inputStyle, borderColor: focusedField === "email" ? "#D7A948" : "#273548", writingDirection: "ltr" }}
      />
      <Text className="mb-2 mt-5 text-sm font-semibold text-[#C7B98D]" style={{ textAlign: "right" }}>
        كلمة المرور
      </Text>
      <TextInput
        accessibilityLabel="كلمة المرور"
        autoComplete="current-password"
        secureTextEntry
        placeholder="كلمة المرور"
        placeholderTextColor="#657286"
        value={password}
        onChangeText={setPassword}
        onFocus={() => setFocusedField("password")}
        onBlur={() => setFocusedField(null)}
        onSubmitEditing={submit}
        style={{ ...inputStyle, borderColor: focusedField === "password" ? "#D7A948" : "#273548" }}
      />
      {error ? <Text accessibilityRole="alert" className="mt-4 text-sm leading-6 text-[#F58F96]" style={{ textAlign: "right" }}>{error}</Text> : null}
      <Pressable accessibilityRole="button" disabled={login.isPending} onPress={submit} style={({ pressed }) => ({ marginTop: 24, minHeight: 56, borderRadius: 16, backgroundColor: "#D7A948", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, opacity: login.isPending ? 0.6 : pressed ? 0.82 : 1 })}>
        {progress === "registering" ? <ActivityIndicator color="#0B1018" /> : null}
        <Text style={{ color: "#0B1018", fontWeight: "700", fontSize: 16 }}>{progress === "registering" ? "جاري التسجيل" : progress === "waiting" ? "بانتظار تأكيد الخادم" : "تسجيل الدخول"}</Text>
      </Pressable>
      <View className="mt-5 flex-row items-center justify-between">
        <Pressable accessibilityRole="button" onPress={() => router.push("/forgot-password")}>
          <Text className="text-sm font-semibold text-[#D7B75E]">نسيت كلمة المرور؟</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => router.push("/register")}>
          <Text className="text-sm font-semibold text-[#D7B75E]">إنشاء حساب جديد</Text>
        </Pressable>
      </View>
      <Text className="mt-5 text-xs leading-5 text-[#657286]" style={{ textAlign: "right" }}>
        لا يوجد تسجيل دخول باستخدام Google. يتم التحقق من ملكية البريد الإلكتروني برمز لمرة واحدة.
      </Text>
      <Pressable accessibilityRole="button" onPress={() => router.push("/support-portal" as never)} className="mt-4 self-end">
        <Text className="text-xs font-semibold text-[#D7B75E]">{error.includes("تم حذفه") ? "التواصل مع خدمة العملاء لاستعادة الحساب" : "الحساب موقوف؟ تواصل مع الدعم"}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={() => router.push("/guest-support" as never)} className="mt-4 self-end">
        <View className="flex-row-reverse items-center gap-1.5">
          <Ionicons name="chatbubble-ellipses-outline" size={15} color="#D7B75E" />
          <Text className="text-xs font-semibold text-[#D7B75E]">خدمة العملاء</Text>
        </View>
      </Pressable>
    </Card>
    <Modal transparent animationType="fade" visible={Boolean(challenge)} onRequestClose={() => { if (!completeDeviceLogin.isPending) { setChallenge(null); setPin(""); } }}>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 20, backgroundColor: "rgba(0,0,0,0.74)" }}>
        <KeyboardAwareScrollView style={{ width: "100%" }} contentContainerStyle={{ flexGrow: 1, alignItems: "center", justifyContent: "center" }}>
        <View style={{ width: "100%", maxWidth: 460, borderRadius: 24, borderWidth: 1, borderColor: "#5C4A28", backgroundColor: "#121B28", padding: 20 }}>
          <Text style={{ color: "#F7F1E3", fontSize: 20, fontWeight: "800", textAlign: "right" }}>تحقق من الجهاز الجديد</Text>
          <Text style={{ color: "#9BA8B8", fontSize: 13, lineHeight: 22, marginTop: 10, textAlign: "right" }}>أدخل رمز الأمان الشخصي المكون من 4 أرقام. لن يُطلب مجددًا على هذا الجهاز الموثوق.</Text>
          <TextInput value={pin} onChangeText={(value) => { setPin(value.replace(/\D/g, "").slice(0, 4)); setError(""); }} keyboardType="number-pad" secureTextEntry maxLength={4} placeholder="••••" placeholderTextColor="#657286" style={{ minHeight: 56, marginTop: 16, borderRadius: 16, borderWidth: 1, borderColor: "#273548", backgroundColor: "#0B1018", color: "#F7F1E3", fontSize: 24, textAlign: "center", letterSpacing: 10 }} />
          {error ? <Text className="mt-3 text-sm text-[#FF7D8D]" style={{ textAlign: "right" }}>{error}</Text> : null}
          <Pressable disabled={completeDeviceLogin.isPending} onPress={() => void confirmDevice()} style={{ minHeight: 52, marginTop: 18, borderRadius: 16, backgroundColor: "#D7A948", alignItems: "center", justifyContent: "center" }}><Text style={{ color: "#0B1018", fontWeight: "800" }}>{completeDeviceLogin.isPending ? "جارٍ التحقق..." : "تأكيد الجهاز"}</Text></Pressable>
          <Pressable disabled={completeDeviceLogin.isPending} onPress={() => router.push("/forgot-password")} style={{ marginTop: 14, alignItems: "center" }}><Text style={{ color: "#D7B75E", fontSize: 13, fontWeight: "700" }}>نسيت الرمز؟ استعادة الحساب بالبريد الإلكتروني</Text></Pressable>
        </View>
        </KeyboardAwareScrollView>
      </View>
    </Modal>
    </View>
  );
}
