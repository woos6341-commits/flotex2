import { KeyboardAwareScrollView as ScrollView } from "@/components/KeyboardAwareScrollView";
import { useState } from "react";
import { ActivityIndicator, Linking, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ActionButton, Card, Pill, Screen } from "@/components/atheer-ui";
import { LoginPanel } from "@/components/LoginPanel";
import { trpc } from "@/lib/trpc";
import { showFinancialMessage } from "@/lib/financial-feedback";
import { buildPhoneVerificationEmailUrl, buildPhoneVerificationTelegramUrl, isPhoneVerified } from "@/shared/phone-verification";

const inputStyle = {
  minHeight: 84,
  borderWidth: 1,
  borderColor: "#273548",
  borderRadius: 14,
  backgroundColor: "#0B1018",
  color: "#F7F1E3",
  paddingHorizontal: 14,
  paddingVertical: 12,
  fontSize: 14,
  textAlign: "right" as const,
  textAlignVertical: "top" as const,
};

export default function PhoneVerificationScreen() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const me = trpc.auth.me.useQuery(undefined, { retry: false, refetchOnMount: true });
  const mine = trpc.phoneVerification.mine.useQuery(undefined, { enabled: Boolean(me.data), retry: false });
  const contacts = trpc.phoneVerification.contacts.useQuery(undefined, { enabled: Boolean(me.data), retry: false });
  const [message, setMessage] = useState("");
  const [feedback, setFeedback] = useState("");
  const submit = trpc.auth.submitPhoneVerificationRequest.useMutation({
    onSuccess: async () => {
      setFeedback("تم تسجيل طلبك. سيظهر للمدير لمراجعته يدويًا بعد التحقق من ملكية الرقم.");
      await utils.phoneVerification.mine.invalidate();
    },
    onError: (error) => showFinancialMessage("تعذر تسجيل طلب التوثيق", error.message),
  });

  const user = mine.data ?? me.data;
  const telegramUrl = contacts.data?.telegramUsername ? buildPhoneVerificationTelegramUrl(contacts.data.telegramUsername) : null;
  const emailUrl = contacts.data?.email ? buildPhoneVerificationEmailUrl(contacts.data.email, {
    customerId: user?.customerId,
    name: user?.name,
    phoneNumber: user?.phoneNumber,
  }) : null;
  const verified = isPhoneVerified(user?.phoneVerifiedAt);
  const request = mine.data?.request;
  const pending = request?.status === "pending";

  const openContact = async (url: string, label: string) => {
    try {
      await Linking.openURL(url);
    } catch {
      showFinancialMessage("تعذر فتح قناة التواصل", `تعذر فتح ${label} على هذا الجهاز. تحقق من تثبيت التطبيق أو استخدم عنوان البريد مباشرة.`);
    }
  };

  if (me.isLoading) return <Screen title="توثيق رقم الهاتف"><ActivityIndicator color="#D7A948" /></Screen>;
  if (!me.data) {
    return <Screen title="توثيق رقم الهاتف"><ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ paddingBottom: 120 }}><LoginPanel /></ScrollView></Screen>;
  }

  return (
    <Screen title="توثيق رقم الهاتف" subtitle="مراجعة يدوية لحماية ملفك">
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ paddingBottom: 120 }}>
        <Card>
          <View className="flex-row items-center justify-between">
            <Pill tone={verified ? "green" : pending ? "gold" : "muted"}>
              {verified ? "رقم موثّق" : pending ? "طلب قيد المراجعة" : "غير موثّق"}
            </Pill>
            <View className="flex-row items-center gap-2"><Ionicons name="shield-checkmark-outline" size={20} color="#D7A948" /><Text className="text-base font-bold text-[#F7F1E3]">حالة الهاتف</Text></View>
          </View>
          <Text className="mt-3 text-sm leading-6 text-[#9BA8B8]" style={{ textAlign: "right" }}>
            يتم تأكيد ملكية رقم الهاتف يدويًا من الإدارة بعد مراجعة الطلب. فتح Telegram أو البريد وحده لا يوثّق الرقم، ولا يرسل التطبيق رمز SMS.
          </Text>
          <View className="mt-4 rounded-2xl border border-[#273548] bg-[#0B1018] p-3">
            <VerifyInfo label="رقم العميل" value={user?.customerId || "غير متوفر"} ltr />
            <VerifyInfo label="الاسم المسجل" value={user?.name || "غير مكتمل"} />
            <VerifyInfo label="رقم الهاتف" value={user?.phoneNumber || "لم يُسجل بعد"} ltr last />
          </View>
          {verified ? (
            <Text className="mt-4 text-sm leading-6 text-[#47D7A5]" style={{ textAlign: "right" }}>تم توثيق هذا الرقم وتثبيته في ملفك؛ لا يمكن تغييره من الحساب.</Text>
          ) : !user?.phoneNumber ? (
            <View className="mt-4">
              <Text className="mb-3 text-xs leading-5 text-[#D7A948]" style={{ textAlign: "right" }}>أضف رقم الهاتف أولًا من صفحة حسابي. يمكنك تغييره قبل توثيقه.</Text>
              <ActionButton label="العودة إلى حسابي" icon="person-outline" onPress={() => router.replace("/(tabs)/profile")} />
            </View>
          ) : null}
        </Card>

        {!verified ? (
          <Card className="mt-4">
            <Text className="text-base font-bold text-[#F7F1E3]" style={{ textAlign: "right" }}>البيانات المطلوبة</Text>
            <Text className="mt-2 text-xs leading-6 text-[#9BA8B8]" style={{ textAlign: "right" }}>
              جهّز رقم العميل والاسم المسجل ورقم الهاتف نفسه، وأي إثبات ملكية تطلبه الإدارة عبر القناة الرسمية. لا ترسل كلمة المرور أو رمز تسجيل الدخول أو بيانات المحفظة السرية.
            </Text>
            {contacts.isLoading ? <View className="mt-3"><ActivityIndicator color="#D7A948" /></View> : null}
            {contacts.isError ? <Text className="mt-3 text-xs text-[#FF7D8D]" style={{ textAlign: "right" }}>تعذر تحميل بيانات التوثيق. أعد المحاولة لاحقًا.</Text> : null}
            {contacts.isSuccess && !telegramUrl && !emailUrl ? (
              <Text className="mt-3 text-xs leading-5 text-[#D7A948]" style={{ textAlign: "right" }}>لم يضف المدير بعد قناة اتصال خاصة بطلبات التوثيق. إعدادات هذه القناة مستقلة عن خدمة العملاء.</Text>
            ) : null}
            {telegramUrl ? <View className="mt-4"><ActionButton label="فتح Telegram للتوثيق" icon="paper-plane-outline" secondary onPress={() => void openContact(telegramUrl, "Telegram")} /></View> : null}
            {emailUrl ? <View className="mt-3"><ActionButton label="إرسال بريد طلب التوثيق" icon="mail-outline" secondary onPress={() => void openContact(emailUrl, "البريد الإلكتروني")} /></View> : null}
            {contacts.isSuccess ? (
              <>
                <Text className="mt-4 text-[11px] leading-5 text-[#657286]" style={{ textAlign: "right" }}>يمكنك تسجيل طلب المراجعة هنا. إن كانت قناة Telegram أو البريد مضبوطة، تواصل معها أيضًا لتسريع التحقق اليدوي.</Text>
                <TextInput
                  accessibilityLabel="رسالة مرفقة بطلب التوثيق"
                  value={message}
                  onChangeText={setMessage}
                  maxLength={500}
                  multiline
                  placeholder="ملاحظة اختيارية للمدير (حتى 500 حرف)"
                  placeholderTextColor="#657286"
                  style={{ ...inputStyle, marginTop: 16 }}
                />
                {pending ? (
                  <Text className="mt-3 text-xs leading-5 text-[#D7A948]" style={{ textAlign: "right" }}>يوجد طلب مفتوح لهذا الرقم منذ {request.createdAt ? new Date(request.createdAt).toLocaleDateString() : "وقت غير محدد"}. انتظر مراجعته قبل إنشاء طلب آخر.</Text>
                ) : (
                  <View className="mt-4"><ActionButton label={submit.isPending ? "جارٍ تسجيل الطلب..." : "إرسال طلب مراجعة التوثيق"} icon="checkmark-circle-outline" onPress={() => { setFeedback(""); submit.mutate({ message }); }} /></View>
                )}
              </>
            ) : null}
            {feedback ? <Text accessibilityRole="alert" className="mt-3 text-xs leading-5 text-[#47D7A5]" style={{ textAlign: "right" }}>{feedback}</Text> : null}
            {request?.status === "rejected" ? <Text className="mt-3 text-xs leading-5 text-[#FF7D8D]" style={{ textAlign: "right" }}>رُفض الطلب السابق: {request.reviewNote || "تواصل مع الإدارة عبر القنوات الرسمية."}</Text> : null}
          </Card>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function VerifyInfo({ label, value, ltr = false, last = false }: { label: string; value: string; ltr?: boolean; last?: boolean }) {
  return (
    <View className={`flex-row items-center justify-between py-2 ${last ? "" : "border-b border-[#273548]"}`}>
      <Text selectable className="text-sm font-bold text-[#F7F1E3]" style={{ writingDirection: ltr ? "ltr" : "rtl" }}>{value}</Text>
      <Text className="text-xs text-[#9BA8B8]">{label}</Text>
    </View>
  );
}
