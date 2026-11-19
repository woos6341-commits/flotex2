import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Modal, Pressable, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView as ScrollView } from "@/components/KeyboardAwareScrollView";
import { useRouter } from "expo-router";
import { ActionButton, Card, Screen } from "@/components/atheer-ui";
import { EGYPTIAN_GOVERNORATES, completeManualRegistrationSchema, passwordSchema, registrationDetailsSchema } from "@/shared/registration";
import { useQueryClient } from "@tanstack/react-query";
import { manualAuthClient, assertManualSession, saveManualSession, type ManualSession } from "@/lib/manual-auth-client";
import { manualVerificationClient } from "@/lib/manual-verification-client";
import { useEphemeralMutation } from "@/hooks/use-ephemeral-mutation";
import { useRegistrationSuccess } from "@/components/RegistrationSuccessProvider";
import { authSessionState } from "@/shared/auth-session-state";
import { startRegistrationProgress, type RegistrationProgress } from "@/shared/registration-progress";
import { authenticatedHomeRoute } from "@/shared/auth-routing";
import { DateOnlyField } from "@/components/DateOnlyField";

const inputStyle = { width: "100%" as const, minHeight: 52, borderWidth: 1, borderColor: "#273548", borderRadius: 14, backgroundColor: "#0B1018", color: "#F7F1E3", paddingHorizontal: 14, fontSize: 16 };

type RegistrationForm = { fullName: string; phoneNumber: string; birthDate: string; email: string; governorate: string; password: string; confirmPassword: string; securityPin: string; confirmSecurityPin: string };
type Phase = "details" | "verify" | "password" | "pin" | "reset";

export default function RegisterScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const presentSuccess = useRegistrationSuccess();
  const requestCode = useEphemeralMutation(manualAuthClient.auth.requestEmailCode.mutate);
  const verifyCode = useEphemeralMutation(manualAuthClient.auth.verifyEmailCode.mutate);
  const redeemManual = useEphemeralMutation(manualVerificationClient.verificationAssistance.redeem.mutate);
  const register = useEphemeralMutation(manualAuthClient.auth.register.mutate);
  const reset = useEphemeralMutation(manualAuthClient.auth.resetPassword.mutate);
  const [form, setForm] = useState<RegistrationForm>({ fullName: "", phoneNumber: "", birthDate: "", email: "", governorate: "", password: "", confirmPassword: "", securityPin: "", confirmSecurityPin: "" });
  const [challengeId, setChallengeId] = useState("");
  const [manualMode, setManualMode] = useState(false);
  const [code, setCode] = useState("");
  const [grantToken, setGrantToken] = useState("");
  const [phase, setPhase] = useState<Phase>("details");
  const [error, setError] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [pinVisible, setPinVisible] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const [governoratesOpen, setGovernoratesOpen] = useState(false);
  const pending = requestCode.isPending || verifyCode.isPending || redeemManual.isPending || register.isPending || reset.isPending;
  const [registrationProgress, setRegistrationProgress] = useState<RegistrationProgress>("idle");
  const [registrationInFlight, setRegistrationInFlight] = useState(false);
  const registrationBusy = useRef(false);
  const stopProgress = useRef<(() => void) | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; stopProgress.current?.(); };
  }, []);

  const update = (key: keyof RegistrationForm, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const clearSecrets = () => { setForm((current) => ({ ...current, password: "", confirmPassword: "", securityPin: "", confirmSecurityPin: "" })); setCode(""); setGrantToken(""); };
  const finishSession = async (session: ManualSession, generation: number) => {
    await saveManualSession(session, queryClient, generation);
    router.replace(authenticatedHomeRoute(session.user.role));
  };

  const sendCode = async () => {
    if (pending) return;
    setError("");
    const parsed = registrationDetailsSchema.safeParse({ fullName: form.fullName, phoneNumber: form.phoneNumber, birthDate: form.birthDate, email: form.email, governorate: form.governorate });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "راجع بيانات التسجيل."); return; }
    try { const response = await requestCode.mutateAsync({ email: parsed.data.email, purpose: "register", phoneNumber: parsed.data.phoneNumber }); setManualMode(false); setCode(""); setChallengeId(response.challengeId); setPhase("verify"); } catch (reason) { setError(reason instanceof Error ? reason.message : "تعذر إرسال رمز التحقق."); }
  };

  const beginManual = () => {
    if (pending) return;
    const parsed = registrationDetailsSchema.safeParse({ fullName: form.fullName, phoneNumber: form.phoneNumber, birthDate: form.birthDate, email: form.email, governorate: form.governorate });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "راجع بيانات التسجيل."); return; }
    setError(""); setCode(""); setChallengeId(""); setManualMode(true); setPhase("verify");
  };

  const confirmCode = async () => {
    if (pending || (!manualMode && !challengeId)) return;
    setError("");
    try { const verified = manualMode ? await redeemManual.mutateAsync({ email: form.email, purpose: "register", code: code.trim() }) : await verifyCode.mutateAsync({ challengeId, code: code.trim() }); if (!verified.grantToken) throw new Error("تعذر إصدار رمز تأكيد آمن. ابدأ التسجيل من جديد."); if (manualMode) { if (!("challengeId" in verified)) throw new Error("تعذر إصدار رمز تأكيد آمن. ابدأ التسجيل من جديد."); setChallengeId(verified.challengeId); } setCode(""); setGrantToken(verified.grantToken); setPhase(verified.nextStep === "reset" ? "reset" : "password"); } catch (reason) { setError(reason instanceof Error ? reason.message : "تعذر التحقق من الرمز."); }
  };

  const continuePassword = () => { setError(""); const parsed = passwordSchema.safeParse(form.password); if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "أدخل كلمة مرور آمنة."); return; } if (form.password !== form.confirmPassword) { setError("كلمتا المرور غير متطابقتين."); return; } setPhase("pin"); };
  const finishRegistration = async () => {
    if (pending || registrationBusy.current) return;
    setError("");
    const parsed = completeManualRegistrationSchema.safeParse({ fullName: form.fullName, phoneNumber: form.phoneNumber, birthDate: form.birthDate, email: form.email, governorate: form.governorate, password: form.password, confirmPassword: form.confirmPassword, securityPin: form.securityPin });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "راجع بيانات التسجيل."); return; }
    if (form.securityPin !== form.confirmSecurityPin) { setError("رمزا الأمان غير متطابقين."); return; }
    const generation = authSessionState.getSnapshot().generation;
    registrationBusy.current = true;
    setRegistrationInFlight(true);
    stopProgress.current = startRegistrationProgress((progress) => { if (mounted.current) setRegistrationProgress(progress); });
    let created = false;
    try {
      const session = await register.mutateAsync({ form: parsed.data, challengeId, grantToken });
      authSessionState.assertCurrent(generation);
      if (!mounted.current) return;
      assertManualSession(session, parsed.data.email);
      created = true;
      authSessionState.setRegistrationReceiptActive(true);
      await saveManualSession(session, queryClient, generation);
      presentSuccess({ customerId: session.user.customerId, password: parsed.data.password, securityPin: parsed.data.securityPin, homeRoute: authenticatedHomeRoute(session.user.role) });
      clearSecrets();
      router.replace(authenticatedHomeRoute(session.user.role));
    } catch (reason) {
      authSessionState.setRegistrationReceiptActive(false);
      if (mounted.current) setError(created ? "تم إنشاء الحساب فعليًا، لكن تعذر تثبيت جلسة الدخول. ارجع إلى تسجيل الدخول باستخدام كلمة المرور التي أدخلتها." : reason instanceof Error ? reason.message : "تعذر إنشاء الحساب.");
    } finally {
      registrationBusy.current = false;
      if (mounted.current) setRegistrationInFlight(false);
      stopProgress.current?.(); stopProgress.current = null;
    }
  };
  const resetExistingAccount = async () => { if (pending || !challengeId || !grantToken) return; setError(""); const generation = authSessionState.getSnapshot().generation; try { const session = await reset.mutateAsync({ challengeId, grantToken, password: form.password, confirmPassword: form.confirmPassword }); authSessionState.assertCurrent(generation); clearSecrets(); await finishSession(session, generation); } catch (reason) { setError(reason instanceof Error ? reason.message : "تعذر تحديث كلمة المرور."); } };

  const field = (label: string, key: keyof RegistrationForm, options: { ltr?: boolean; secure?: boolean; keyboardType?: "default" | "email-address" | "phone-pad" | "number-pad"; autoComplete?: "name" | "email" | "tel" | "new-password" } = {}) => (
    <View className="mt-4" key={key}><View className="mb-2 flex-row items-center justify-between"><Text className="text-sm font-semibold text-[#C7B98D]" style={{ textAlign: "right" }}>{label}</Text>{options.secure ? <Pressable onPress={() => key === "password" ? setPasswordVisible((value) => !value) : setPinVisible((value) => !value)}><Text className="text-xs text-[#D7B75E]">{(key === "password" ? passwordVisible : pinVisible) ? "إخفاء" : "إظهار"}</Text></Pressable> : null}</View><TextInput accessibilityLabel={label} autoCapitalize={options.ltr ? "none" : "words"} autoComplete={options.autoComplete} keyboardType={options.keyboardType ?? "default"} secureTextEntry={options.secure ? (key === "password" ? !passwordVisible : !pinVisible) : false} placeholder={label} placeholderTextColor="#657286" value={form[key]} onChangeText={(value) => update(key, value)} onFocus={() => setFocusedField(key)} onBlur={() => setFocusedField(null)} style={{ ...inputStyle, borderColor: focusedField === key ? "#D7A948" : "#273548", textAlign: options.ltr ? "left" : "right", writingDirection: options.ltr ? "ltr" : "rtl" }} /></View>
  );

  return <Screen title="إنشاء حساب" subtitle="Flotex EGP"><ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets style={{ width: "100%", flex: 1 }} contentContainerStyle={{ width: "100%", flexGrow: 1, alignItems: "stretch", paddingBottom: 40 }}><View style={{ width: "100%", maxWidth: 560, alignSelf: "center" }}><Card className="w-full">
    {phase === "details" ? <><Text className="text-xl font-bold text-[#F7F1E3]" style={{ textAlign: "right" }}>البيانات الشخصية</Text>{field("الاسم بالكامل", "fullName", { autoComplete: "name" })}{field("رقم الهاتف", "phoneNumber", { keyboardType: "phone-pad", autoComplete: "tel", ltr: true })}<DateOnlyField value={form.birthDate} onChange={(value) => update("birthDate", value)} />{field("البريد الإلكتروني", "email", { keyboardType: "email-address", autoComplete: "email", ltr: true })}<Text className="mb-2 mt-4 text-sm font-semibold text-[#C7B98D]" style={{ textAlign: "right" }}>المحافظة</Text><Pressable accessibilityRole="button" onPress={() => setGovernoratesOpen(true)} style={{ ...inputStyle, justifyContent: "center" }}><Text style={{ color: form.governorate ? "#F7F1E3" : "#657286", textAlign: "right" }}>{form.governorate || "اختر المحافظة"}  ˅</Text></Pressable><Text className="mt-3 text-xs leading-5 text-[#9BA8B8]" style={{ textAlign: "right" }}>سيتم تأكيد البريد الإلكتروني قبل إنشاء كلمة المرور ورمز الأمان.</Text><View className="mt-6"><ActionButton label={requestCode.isPending ? "جارٍ إرسال الرمز" : "متابعة وتأكيد البريد"} icon="mail-outline" onPress={sendCode} /></View><Pressable onPress={beginManual} className="mt-5 self-center"><Text className="text-sm text-[#D7B75E]">لديّ رمز يدوي من الإدارة بعد مراجعة الملكية</Text></Pressable></> : null}
    {phase === "verify" ? <><Text className="text-xl font-bold text-[#F7F1E3]" style={{ textAlign: "right" }}>تأكيد البريد الإلكتروني</Text><Text className="mt-3 text-sm leading-6 text-[#9BA8B8]" style={{ textAlign: "right" }}>{manualMode ? `أدخل رمز الإدارة المرتبط بالبريد ${form.email}.` : `أدخل الرمز المكوّن من 6 أرقام الذي أرسلناه إلى ${form.email}. لا يمكن متابعة التسجيل قبل نجاح التحقق.`}</Text><TextInput accessibilityLabel="رمز التحقق" keyboardType="number-pad" maxLength={6} value={code} onChangeText={setCode} placeholder="000000" placeholderTextColor="#657286" style={{ ...inputStyle, marginTop: 20, textAlign: "center", letterSpacing: 8, fontSize: 22 }} /><View className="mt-6"><ActionButton label={pending ? "جارٍ التحقق" : "تأكيد الرمز"} icon="checkmark-circle-outline" onPress={confirmCode} /></View>{manualMode ? <Pressable onPress={() => { setCode(""); setChallengeId(""); setPhase("details"); }} className="mt-5 self-center"><Text className="text-sm text-[#D7B75E]">العودة إلى البيانات</Text></Pressable> : <><Pressable onPress={() => void sendCode()} className="mt-5 self-center"><Text className="text-sm text-[#D7B75E]">إعادة إرسال الرمز</Text></Pressable><Pressable onPress={beginManual} className="mt-4 self-center"><Text className="text-sm text-[#D7B75E]">استخدام رمز يدوي بعد مراجعة الإدارة</Text></Pressable></>}</> : null}
    {phase === "password" ? <><Text className="text-xl font-bold text-[#F7F1E3]" style={{ textAlign: "right" }}>إنشاء كلمة المرور</Text>{field("كلمة المرور (12 حرفًا على الأقل)", "password", { secure: true, autoComplete: "new-password" })}{field("تأكيد كلمة المرور", "confirmPassword", { secure: true, autoComplete: "new-password" })}<View className="mt-6"><ActionButton label="متابعة لإنشاء رمز الأمان" icon="arrow-forward-outline" onPress={continuePassword} /></View></> : null}
    {phase === "pin" ? <><Text className="text-xl font-bold text-[#F7F1E3]" style={{ textAlign: "right" }}>إنشاء رمز الأمان</Text><Text className="mt-3 text-sm leading-6 text-[#9BA8B8]" style={{ textAlign: "right" }}>اختر رمزًا من 4 أرقام منفصلًا عن كلمة المرور. سيُستخدم لتأكيد السحب والتحويلات.</Text>{field("رمز الأمان (4 أرقام)", "securityPin", { secure: true, keyboardType: "number-pad" })}{field("تأكيد رمز الأمان", "confirmSecurityPin", { secure: true, keyboardType: "number-pad" })}<View className="mt-6"><ActionButton label={registrationProgress === "registering" ? "جاري التسجيل" : registrationProgress === "waiting" ? "بانتظار تأكيد الخادم" : "إتمام التسجيل والدخول"} icon="checkmark-circle-outline" onPress={finishRegistration} /></View></> : null}
    {phase === "reset" ? <><Text className="text-xl font-bold text-[#F7F1E3]" style={{ textAlign: "right" }}>هذا البريد مرتبط بحساب قائم</Text><Text className="mt-3 text-sm leading-6 text-[#9BA8B8]" style={{ textAlign: "right" }}>لن ننشئ حسابًا أو محفظة جديدة. أدخل كلمة مرور جديدة لاستعادة الحساب الحالي مع الحفاظ على رقم العميل والرصيد والملف.</Text>{field("كلمة مرور جديدة (12 حرفًا على الأقل)", "password", { secure: true, autoComplete: "new-password" })}{field("تأكيد كلمة المرور الجديدة", "confirmPassword", { secure: true, autoComplete: "new-password" })}<View className="mt-6"><ActionButton label={pending ? "جارٍ تحديث الحساب" : "تحديث كلمة المرور والدخول"} icon="key-outline" onPress={resetExistingAccount} /></View></> : null}
    {error ? <Text accessibilityRole="alert" className="mt-4 text-sm leading-6 text-[#F58F96]" style={{ textAlign: "right" }}>{error}</Text> : null}
    {registrationProgress === "waiting" ? <Text accessibilityLiveRegion="polite" className="mt-4 text-sm leading-6 text-[#9BA8B8]" style={{ textAlign: "right" }}>الطلب ما زال قيد المعالجة. ننتظر تأكيد الخادم؛ لم يكتمل إنشاء الحساب بعد. لا تُعد إرسال الطلب.</Text> : null}
    {registrationProgress === "registering" || (pending && !registrationInFlight && registrationProgress === "idle") ? <View className="mt-4 items-center"><ActivityIndicator color="#D7A948" /></View> : null}
    <Pressable onPress={() => router.replace("/(tabs)")} className="mt-6 self-center"><Text className="text-sm text-[#D7B75E]">العودة إلى تسجيل الدخول</Text></Pressable><Pressable onPress={() => router.push("/guest-support" as never)} className="mt-4 self-center"><Text className="text-sm font-bold text-[#D7A948]">تواصل مع الدعم بدون حساب</Text></Pressable>
  </Card></View></ScrollView><Modal visible={governoratesOpen} transparent animationType="slide" onRequestClose={() => setGovernoratesOpen(false)}><View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "#0008" }}><View style={{ maxHeight: "78%", borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: "#111722", padding: 20 }}><Text className="mb-4 text-xl font-bold text-[#F7F1E3]" style={{ textAlign: "right" }}>اختر المحافظة</Text><FlatList data={EGYPTIAN_GOVERNORATES} keyExtractor={(item) => item} renderItem={({ item }) => <Pressable onPress={() => { update("governorate", item); setGovernoratesOpen(false); }} style={{ borderBottomWidth: 1, borderBottomColor: "#273548", paddingVertical: 15 }}><Text className="text-base text-[#F7F1E3]" style={{ textAlign: "right" }}>{item}</Text></Pressable>} /></View></View></Modal></Screen>;
}
