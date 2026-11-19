import { KeyboardAwareScrollView as ScrollView } from "@/components/KeyboardAwareScrollView";
import { useState } from "react";
import { ActivityIndicator, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { ActionButton, Card, Screen } from "@/components/atheer-ui";
import { trpc } from "@/lib/trpc";
import { manualAuthClient } from "@/lib/manual-auth-client";
import { useEphemeralMutation } from "@/hooks/use-ephemeral-mutation";

export default function SecurityPinScreen() {
  const router = useRouter();
  const status = trpc.securityPin.status.useQuery();
  const utils = trpc.useUtils();
  const setPin = useEphemeralMutation(manualAuthClient.securityPin.set.mutate);
  const resetPin = useEphemeralMutation(manualAuthClient.securityPin.reset.mutate);
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const save = async (reset = false) => {
    if (setPin.isPending || resetPin.isPending) return;
    setMessage(""); setError("");
    if (!/^\d{4}$/.test(newPin) || newPin !== confirmPin) { setError("أدخل رمزًا جديدًا من 4 أرقام وتأكد من تطابقه."); return; }
    try {
      if (reset) await resetPin.mutateAsync({ newPin });
      else await setPin.mutateAsync({ newPin, currentPin: status.data?.configured ? currentPin : undefined });
      setCurrentPin(""); setNewPin(""); setConfirmPin(""); setMessage(reset ? "تمت إعادة تعيين رمز الأمان بعد التحقق من اعتماد الحساب." : "تم حفظ رمز الأمان بشكل مشفر."); await utils.securityPin.status.invalidate();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "تعذر حفظ رمز الأمان."); }
  };
  if (status.isLoading) return <Screen title="رمز الأمان"><ActivityIndicator color="#D7A948" /></Screen>;
  return <Screen title="رمز الأمان" subtitle="يُطلب فقط عند التأكيد النهائي للسحب أو إرسال الأموال">
    <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ paddingBottom: 120 }}>
      <Card><Text className="text-sm leading-6 text-[#9BA8B8]" style={{ textAlign: "right" }}>الرمز لا يُحفظ كنص عادي. لا تشاركه مع أي شخص، ولا يظهر حتى للإدارة.</Text><Text className="mt-4 text-sm font-bold text-[#D7A948]" style={{ textAlign: "right" }}>{status.data?.configured ? "الحالة: رمز مفعّل" : "الحالة: لم يتم إنشاء رمز بعد"}</Text></Card>
      {status.data?.configured ? <TextInput value={currentPin} onChangeText={(v) => setCurrentPin(v.replace(/\D/g, "").slice(0, 4))} keyboardType="number-pad" secureTextEntry maxLength={4} placeholder="الرمز الحالي" placeholderTextColor="#657286" className="mt-4 rounded-2xl border border-[#273548] bg-[#0B1018] px-4 py-4 text-center text-xl text-[#F7F1E3]" /> : null}
      <TextInput value={newPin} onChangeText={(v) => setNewPin(v.replace(/\D/g, "").slice(0, 4))} keyboardType="number-pad" secureTextEntry maxLength={4} placeholder="الرمز الجديد — 4 أرقام" placeholderTextColor="#657286" className="mt-4 rounded-2xl border border-[#273548] bg-[#0B1018] px-4 py-4 text-center text-xl text-[#F7F1E3]" />
      <TextInput value={confirmPin} onChangeText={(v) => setConfirmPin(v.replace(/\D/g, "").slice(0, 4))} keyboardType="number-pad" secureTextEntry maxLength={4} placeholder="تأكيد الرمز الجديد" placeholderTextColor="#657286" className="mt-3 rounded-2xl border border-[#273548] bg-[#0B1018] px-4 py-4 text-center text-xl text-[#F7F1E3]" />
      {error ? <Text className="mt-3 text-sm text-[#FF7D8D]" style={{ textAlign: "right" }}>{error}</Text> : null}{message ? <Text className="mt-3 text-sm text-[#47D7A5]" style={{ textAlign: "right" }}>{message}</Text> : null}
      <View className="mt-4"><ActionButton label={setPin.isPending ? "جارٍ الحفظ..." : status.data?.configured ? "تغيير رمز الأمان" : "إنشاء رمز الأمان"} icon="lock-closed-outline" onPress={() => void save(false)} /></View>
      {status.data?.configured ? <View className="mt-3"><ActionButton label={resetPin.isPending ? "جارٍ التحقق..." : "نسيت الرمز؟ إعادة التعيين بعد اعتماد الحساب"} icon="refresh-outline" secondary onPress={() => void save(true)} /></View> : null}
      <View className="mt-4"><ActionButton label="العودة إلى حسابي" icon="arrow-back-outline" secondary onPress={() => router.back()} /></View>
    </ScrollView>
  </Screen>;
}
