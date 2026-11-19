import { useState } from "react";
import { ActivityIndicator, Linking, Pressable, Switch, Text, TextInput, View } from "react-native";
import { ActionButton, Card } from "@/components/atheer-ui";
import { trpc } from "@/lib/trpc";
import {
  buildTelegramUrl,
  customerSupportSettingsSchema,
  supportLinkIcons,
  type CustomerSupportLink,
  type CustomerSupportSettings as CustomerSupportSettingsValue,
} from "@/shared/customer-support";

const inputStyle = {
  minHeight: 48,
  borderWidth: 1,
  borderColor: "#273548",
  borderRadius: 14,
  backgroundColor: "#0B1018",
  color: "#F7F1E3",
  paddingHorizontal: 14,
  fontSize: 14,
  textAlign: "right" as const,
};

export function CustomerSupportSettings() {
  const settings = trpc.admin.customerSupportSettings.useQuery(undefined, { retry: false });

  return (
    <View className="gap-4">
      {settings.isLoading ? <Card><ActivityIndicator color="#D7A948" /><Text className="mt-2 text-center text-xs text-[#9BA8B8]">جارٍ تحميل الإعدادات...</Text></Card> : null}
      {settings.isError ? <Card><Text className="text-sm text-[#FF7D8D]" style={{ textAlign: "right" }}>تعذر تحميل الإعدادات المحفوظة.</Text><View className="mt-3"><ActionButton label="إعادة المحاولة" icon="refresh-outline" onPress={() => void settings.refetch()} /></View></Card> : null}
      {settings.data ? <CustomerSupportSettingsForm initialSettings={settings.data} /> : null}
    </View>
  );
}

function CustomerSupportSettingsForm({ initialSettings }: { initialSettings: CustomerSupportSettingsValue }) {
  const utils = trpc.useUtils();
  const [email, setEmail] = useState(initialSettings.email);
  const [telegramUsername, setTelegramUsername] = useState(initialSettings.telegramUsername);
  const [links, setLinks] = useState<CustomerSupportLink[]>(initialSettings.links ?? []);
  const [feedback, setFeedback] = useState("");
  const [feedbackIsError, setFeedbackIsError] = useState(false);
  const save = trpc.admin.updateCustomerSupportSettings.useMutation({
    onSuccess: async (saved) => {
      setEmail(saved.email);
      setTelegramUsername(saved.telegramUsername);
      setLinks(saved.links ?? []);
      setFeedback("تم حفظ إعدادات خدمة العملاء.");
      setFeedbackIsError(false);
      utils.admin.customerSupportSettings.setData(undefined, saved);
      await utils.customerSupport.settings.invalidate();
    },
    onError: (error) => {
      setFeedback(error.message || "تعذر حفظ إعدادات خدمة العملاء.");
      setFeedbackIsError(true);
    },
  });

  const validation = customerSupportSettingsSchema.safeParse({ email, telegramUsername, links });
  const telegramUrl = validation.success ? buildTelegramUrl(validation.data.telegramUsername) : null;

  const submit = () => {
    setFeedback("");
    if (!validation.success) {
      setFeedback(validation.error.issues[0]?.message ?? "راجع البريد واسم مستخدم Telegram.");
      setFeedbackIsError(true);
      return;
    }
    save.mutate(validation.data);
  };

  const previewTelegram = async () => {
    if (!telegramUrl) return;
    try {
      await Linking.openURL(telegramUrl);
    } catch {
      setFeedback("تعذر فتح رابط t.me للمعاينة على هذا الجهاز.");
      setFeedbackIsError(true);
    }
  };

  const patchLink = (index: number, patch: Partial<CustomerSupportLink>) => setLinks((previous) => previous.map((link, i) => i === index ? { ...link, ...patch } : link));
  const addLink = () => {
    if (links.length >= 12) return;
    setLinks((previous) => [...previous, { id: `link_${Date.now().toString(36)}`, label: "قناة تواصل إضافية", url: "", icon: "link-outline", enabled: true }]);
  };

  return (
    <Card>
      <Text className="text-base font-bold text-[#F7F1E3]" style={{ textAlign: "right" }}>إعدادات خدمة العملاء</Text>
      <Text className="mb-4 mt-1 text-xs leading-5 text-[#9BA8B8]" style={{ textAlign: "right" }}>تظهر القنوات للعملاء من الخادم عند فتح حسابي أو الإيداع أو السحب، دون تحديث التطبيق. اترك الحقل فارغًا لإخفاء قناته.</Text>

      <Text className="mb-2 text-xs font-semibold text-[#C7B98D]" style={{ textAlign: "right" }}>البريد الإلكتروني لخدمة العملاء</Text>
      <TextInput accessibilityLabel="البريد الإلكتروني لخدمة العملاء" autoCapitalize="none" autoComplete="email" keyboardType="email-address" placeholder="أدخل البريد الرسمي لخدمة العملاء" placeholderTextColor="#657286" value={email} onChangeText={(value) => { setEmail(value); setFeedback(""); }} style={inputStyle} />

      <Text className="mb-2 mt-4 text-xs font-semibold text-[#C7B98D]" style={{ textAlign: "right" }}>اسم مستخدم Telegram أو رابط t.me</Text>
      <TextInput accessibilityLabel="اسم مستخدم Telegram أو رابط t.me" autoCapitalize="none" autoCorrect={false} placeholder="اسم المستخدم أو رابط t.me" placeholderTextColor="#657286" value={telegramUsername} onChangeText={(value) => { setTelegramUsername(value); setFeedback(""); }} style={inputStyle} />
      {telegramUrl ? (
        <View className="mt-2 flex-row items-center justify-between rounded-xl border border-[#273548] bg-[#0B1018] px-3 py-2">
          <Pressable accessibilityRole="button" onPress={() => void previewTelegram()}><Text className="text-xs font-bold text-[#D7A948]">معاينة</Text></Pressable>
          <Text selectable className="text-xs text-[#9BA8B8]" style={{ writingDirection: "ltr" }}>{telegramUrl}</Text>
        </View>
      ) : null}
      <Text className="mt-2 text-[11px] leading-5 text-[#657286]" style={{ textAlign: "right" }}>يتم التحقق من صيغة الاسم وأن الرابط على t.me فقط. لا يمكن للتطبيق تأكيد توفر الحساب أو ملكيته دون مصادقة Telegram؛ افتح المعاينة وتأكد أنها جهة الدعم الرسمية قبل الحفظ.</Text>

      <View className="mt-5 flex-row items-center justify-between">
        <Pressable disabled={links.length >= 12} onPress={addLink} style={{ borderRadius: 10, borderWidth: 1, borderColor: "#5C4A28", paddingHorizontal: 10, paddingVertical: 7, opacity: links.length >= 12 ? 0.5 : 1 }}><Text className="text-xs font-bold text-[#D7A948]">إضافة زر تواصل</Text></Pressable>
        <Text className="text-sm font-bold text-[#F7F1E3]">روابط إضافية ({links.length}/12)</Text>
      </View>
      <Text className="mt-1 text-[11px] leading-5 text-[#657286]" style={{ textAlign: "right" }}>تُقبل روابط HTTPS فقط أو mailto: وtel:. لا تستخدم روابط مختصرة أو مخططات تشغيل غير موثوقة.</Text>
      {links.map((link, index) => <View key={link.id} className="mt-3 rounded-2xl border border-[#273548] bg-[#0B1018] p-3">
        <View className="flex-row items-center justify-between">
          <Pressable onPress={() => patchLink(index, { icon: supportLinkIcons[(supportLinkIcons.indexOf(link.icon) + 1) % supportLinkIcons.length] })} style={{ paddingHorizontal: 8, paddingVertical: 5, borderRadius: 9, borderWidth: 1, borderColor: "#273548" }}><Text className="text-[10px] text-[#D7A948]">الأيقونة: {link.icon} · تغيير</Text></Pressable>
          <View className="flex-row-reverse items-center gap-2"><Text className="text-xs text-[#9BA8B8]">إظهار</Text><Switch value={link.enabled} onValueChange={(enabled) => patchLink(index, { enabled })} trackColor={{ false: "#273548", true: "#5C4A28" }} thumbColor={link.enabled ? "#D7A948" : "#9BA8B8"} /></View>
        </View>
        <TextInput value={link.label} onChangeText={(label) => patchLink(index, { label })} maxLength={48} placeholder="اسم الزر الذي سيظهر للعميل" placeholderTextColor="#657286" style={{ ...inputStyle, marginTop: 9 }} />
        <TextInput value={link.url} onChangeText={(url) => patchLink(index, { url })} autoCapitalize="none" autoCorrect={false} maxLength={600} placeholder="https://... أو mailto: أو tel:" placeholderTextColor="#657286" style={{ ...inputStyle, marginTop: 8, writingDirection: "ltr" }} />
        <Pressable onPress={() => setLinks((previous) => previous.filter((_, i) => i !== index))} style={{ alignSelf: "flex-end", paddingVertical: 7 }}><Text className="text-xs font-bold text-[#FF7D8D]">حذف الزر</Text></Pressable>
      </View>)}

      {feedback ? <Text accessibilityRole="alert" className={`mt-3 text-xs leading-5 ${feedbackIsError ? "text-[#FF7D8D]" : "text-[#47D7A5]"}`} style={{ textAlign: "right" }}>{feedback}</Text> : null}
      <View className="mt-4">
        <Pressable accessibilityRole="button" disabled={save.isPending} onPress={submit} style={({ pressed }) => ({ minHeight: 48, borderRadius: 16, backgroundColor: "#D7A948", alignItems: "center", justifyContent: "center", opacity: save.isPending ? 0.6 : pressed ? 0.82 : 1 })}>
          {save.isPending ? <ActivityIndicator color="#0B1018" /> : <Text className="font-bold text-[#0B1018]">حفظ التغييرات</Text>}
        </Pressable>
      </View>
    </Card>
  );
}
