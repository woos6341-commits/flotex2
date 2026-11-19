import { useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView as ScrollView } from "@/components/KeyboardAwareScrollView";
import { useRouter } from "expo-router";
import { ActionButton, Card, Pill, Screen } from "@/components/atheer-ui";
import { useEphemeralMutation } from "@/hooks/use-ephemeral-mutation";
import { manualAuthClient } from "@/lib/manual-auth-client";
import { trpc } from "@/lib/trpc";

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

export default function DeletedAccountSupportScreen() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const requestCode = useEphemeralMutation(manualAuthClient.supportPortal.requestCode.mutate);
  const verifyCode = useEphemeralMutation(manualAuthClient.auth.verifyEmailCode.mutate);
  const sendMessage = useEphemeralMutation(manualAuthClient.supportPortal.send.mutate);
  const [email, setEmail] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [code, setCode] = useState("");
  const [supportToken, setSupportToken] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [phase, setPhase] = useState<"identity" | "code" | "messages">("identity");
  const pending = requestCode.isPending || verifyCode.isPending || sendMessage.isPending;
  const messages = trpc.supportPortal.messages.useQuery({ token: supportToken || "" }, { enabled: Boolean(supportToken), retry: false, refetchInterval: supportToken ? 10000 : false });

  const submitIdentity = async () => {
    setError(""); setInfo("");
    if (!/^\d{10}$/.test(customerId)) { setError("أدخل رقم العميل المكوّن من 10 أرقام."); return; }
    try {
      const result = await requestCode.mutateAsync({ email: email.trim(), customerId });
      setChallengeId(result.challengeId);
      setPhase("code");
      setInfo("إذا طابقت البيانات حسابًا موقوفًا، سيصل رمز صالح لمدة 10 دقائق إلى البريد الإلكتروني.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "تعذر طلب التحقق. راجع البيانات وحاول مجددًا.");
    }
  };

  const submitCode = async () => {
    setError("");
    if (!challengeId || !/^\d{6}$/.test(code.trim())) { setError("أدخل رمز التحقق المكوّن من 6 أرقام."); return; }
    try {
      const result = await verifyCode.mutateAsync({ challengeId, code: code.trim() });
      if (result.nextStep !== "support" || typeof result.supportToken !== "string") throw new Error("تعذر فتح قناة الدعم. راجع البريد ورقم العميل.");
      setSupportToken(result.supportToken);
      setCode("");
      setPhase("messages");
      setInfo("تم فتح جلسة دعم محدودة لمدة 30 دقيقة. لا تتيح تسجيل الدخول أو الاطلاع على الأرصدة.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "تعذر التحقق من الرمز.");
    }
  };

  const submitMessage = async () => {
    setError("");
    if (!supportToken || !body.trim()) { setError("اكتب رسالتك قبل الإرسال."); return; }
    try {
      await sendMessage.mutateAsync({ token: supportToken, body: body.trim() });
      setBody("");
      await utils.supportPortal.messages.invalidate({ token: supportToken });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "تعذر إرسال الرسالة.");
    }
  };

  const endSession = async () => {
    if (supportToken) await utils.supportPortal.messages.cancel({ token: supportToken }).catch(() => undefined);
    setSupportToken(""); setChallengeId(""); setCode(""); setBody(""); setPhase("identity"); setInfo(""); setError("");
  };

  return (
    <Screen title="دعم الحساب الموقوف" subtitle="تواصل مع الإدارة دون تسجيل الدخول">
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ paddingBottom: 120 }}>
        <Card>
          <View className="flex-row items-center justify-between"><Pill tone="gold">دعم محدود</Pill><Text className="text-base font-bold text-[#F7F1E3]" style={{ textAlign: "right" }}>حسابك موقوف؟</Text></View>
          <Text className="mt-3 text-sm leading-6 text-[#9BA8B8]" style={{ textAlign: "right" }}>
            أدخل البريد المرتبط بالحساب ورقم العميل. بعد التحقق بالبريد يمكنك مراسلة الإدارة؛ هذه القناة لا تنشئ جلسة دخول ولا تعرض بيانات مالية.
          </Text>
        </Card>

        {phase === "identity" ? <Card className="mt-4">
          <Text className="mb-2 text-sm font-semibold text-[#C7B98D]" style={{ textAlign: "right" }}>البريد الإلكتروني للحساب</Text>
          <TextInput accessibilityLabel="البريد الإلكتروني للحساب" autoCapitalize="none" autoComplete="email" keyboardType="email-address" value={email} onChangeText={setEmail} placeholder="name@example.com" placeholderTextColor="#657286" style={{ ...inputStyle, writingDirection: "ltr", textAlign: "left" }} />
          <Text className="mb-2 mt-4 text-sm font-semibold text-[#C7B98D]" style={{ textAlign: "right" }}>رقم العميل</Text>
          <TextInput accessibilityLabel="رقم العميل" keyboardType="number-pad" maxLength={10} value={customerId} onChangeText={(value) => setCustomerId(value.replace(/\D/g, "").slice(0, 10))} placeholder="10 أرقام" placeholderTextColor="#657286" style={{ ...inputStyle, writingDirection: "ltr", textAlign: "left" }} />
          <Text className="mt-3 text-xs leading-5 text-[#657286]" style={{ textAlign: "right" }}>لمنع كشف حالة أي بريد، لا نوضح إن كان الحساب موجودًا. لا نرسل رمزًا إلا عند مطابقة الحساب الموقوف.</Text>
          <View className="mt-5"><ActionButton label={requestCode.isPending ? "جارٍ طلب الرمز..." : "إرسال رمز تحقق"} icon="mail-outline" onPress={() => void submitIdentity()} /></View>
        </Card> : null}

        {phase === "code" ? <Card className="mt-4">
          <Text className="text-base font-bold text-[#F7F1E3]" style={{ textAlign: "right" }}>تحقق من ملكية البريد</Text>
          <Text className="mt-2 text-sm leading-6 text-[#9BA8B8]" style={{ textAlign: "right" }}>{info || `أدخل الرمز الذي وصل إلى ${email}.`}</Text>
          <TextInput accessibilityLabel="رمز تحقق الدعم" keyboardType="number-pad" maxLength={6} value={code} onChangeText={(value) => setCode(value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" placeholderTextColor="#657286" style={{ ...inputStyle, marginTop: 18, textAlign: "center", letterSpacing: 8, fontSize: 22 }} />
          <View className="mt-5"><ActionButton label={verifyCode.isPending ? "جارٍ التحقق..." : "فتح قناة الدعم"} icon="shield-checkmark-outline" onPress={() => void submitCode()} /></View>
          <View className="mt-3"><ActionButton label="العودة إلى البيانات" icon="arrow-back-outline" secondary onPress={() => { setPhase("identity"); setCode(""); setError(""); }} /></View>
        </Card> : null}

        {phase === "messages" ? <>
          <Card className="mt-4">
            <View className="flex-row items-center justify-between"><Pill tone="green">جلسة 30 دقيقة</Pill><Text className="text-base font-bold text-[#F7F1E3]" style={{ textAlign: "right" }}>محادثة الدعم</Text></View>
            <Text className="mt-2 text-xs leading-5 text-[#9BA8B8]" style={{ textAlign: "right" }}>{info}</Text>
          </Card>
          {messages.isLoading ? <ActivityIndicator className="mt-5" color="#D7A948" /> : messages.isError ? <Card className="mt-4"><Text className="text-sm leading-6 text-[#FF9BA7]" style={{ textAlign: "right" }}>انتهت صلاحية الجلسة أو تعذر تحميل الرسائل. اطلب رمزًا جديدًا.</Text></Card> : <View className="mt-4 gap-3">{messages.data?.length ? messages.data.map((item) => <View key={item.id} className={`max-w-[92%] rounded-3xl border p-4 ${item.senderRole === "user" ? "self-start border-[#273548] bg-[#121B28]" : "self-end border-[#5C4A28] bg-[#171D27]"}`}><Text className="text-[10px] text-[#9BA8B8]">{item.senderRole === "user" ? "أنت" : "الإدارة"} · {new Date(item.createdAt).toLocaleString("ar-EG")}</Text><Text className="mt-2 text-sm leading-6 text-[#F7F1E3]" style={{ textAlign: "right" }}>{item.body}</Text></View>) : <Card><Text className="text-sm text-[#9BA8B8]" style={{ textAlign: "right" }}>لم تُرسل رسالة بعد. اكتب استفسارك أدناه.</Text></Card>}</View>}
          <Card className="mt-4 border-[#5C4A28]"><TextInput accessibilityLabel="رسالة الدعم" value={body} onChangeText={setBody} multiline maxLength={2000} placeholder="اكتب رسالتك للإدارة..." placeholderTextColor="#657286" textAlign="right" textAlignVertical="top" className="min-h-28 rounded-2xl border border-[#273548] bg-[#0B1018] px-4 py-3 text-[#F7F1E3]" />
            <View className="mt-4"><ActionButton label={sendMessage.isPending ? "جارٍ الإرسال..." : "إرسال الرسالة"} icon="send-outline" onPress={() => void submitMessage()} /></View>
            <View className="mt-3"><ActionButton label="إنهاء جلسة الدعم" icon="log-out-outline" secondary onPress={() => void endSession()} /></View>
          </Card>
        </> : null}

        {error ? <Text accessibilityRole="alert" className="mt-4 text-sm leading-6 text-[#F58F96]" style={{ textAlign: "right" }}>{error}</Text> : null}
        {pending && phase !== "messages" ? <View className="mt-4 items-center"><ActivityIndicator color="#D7A948" /></View> : null}
        <Pressable onPress={() => router.replace("/(tabs)")} className="mt-6 self-center"><Text className="text-sm text-[#D7B75E]">العودة إلى تسجيل الدخول</Text></Pressable>
      </ScrollView>
    </Screen>
  );
}
