import { useEffect, useRef, useState } from "react";
import { useRouter } from "expo-router";
import { ActivityIndicator, AppState, Image, Pressable, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView as ScrollView } from "@/components/KeyboardAwareScrollView";
import { ActionButton, Card, Pill, Screen } from "@/components/atheer-ui";
import { LoginPanel } from "@/components/LoginPanel";
import { trpc } from "@/lib/trpc";
import { manualAuthClient } from "@/lib/manual-auth-client";
import { useEphemeralMutation } from "@/hooks/use-ephemeral-mutation";
import { phoneNumberSchema } from "@/shared/registration";
import type { PhoneChangeRequestInput } from "@/shared/phone-change";
import { pickVerificationPhoto, recoverVerificationPhoto, VERIFICATION_PHOTO_KEYS, type VerificationPhotoKey, type VerificationPhoto } from "@/lib/verification-photo-picker";

const labels: Record<VerificationPhotoKey, string> = { idFront: "البطاقة الأمامية", idBack: "البطاقة الخلفية", selfie: "صورة الوجه (سيلفي)", walletProfile: "صورة ملف المحفظة الإلكترونية" };

export default function ChangePhoneScreen() {
  const router = useRouter();
  const me = trpc.auth.me.useQuery(undefined, { retry: false });
  const current = trpc.auth.phoneChange.useQuery(undefined, { enabled: Boolean(me.data), retry: false });
  const userId = me.data?.id;
  const submit = useEphemeralMutation(manualAuthClient.auth.submitPhoneChange.mutate);
  const utils = trpc.useUtils();
  const [newPhone, setNewPhone] = useState("");
  const [photos, setPhotos] = useState<Partial<Record<VerificationPhotoKey, VerificationPhoto>>>({});
  const [photoBusy, setPhotoBusy] = useState<VerificationPhotoKey | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const photoLock = useRef(false);
  const submitLock = useRef(false);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    const recover = () => recoverVerificationPhoto("phone", userId).then((result) => {
      if (active && result) setPhotos((value) => ({ ...value, [result.key]: result.photo }));
    }).catch(() => { if (active) setError("تعذر استعادة الصورة. أعد التقاطها؛ حسابك ما زال مسجلًا."); });
    void recover();
    const subscription = AppState.addEventListener("change", (state) => { if (state === "active") void recover(); });
    return () => { active = false; subscription.remove(); };
  }, [userId]);

  const choose = async (key: VerificationPhotoKey) => {
    if (photoLock.current || submitLock.current || !me.data?.id) return;
    photoLock.current = true;
    setPhotoBusy(key);
    setError("");
    try {
      const compressed = await pickVerificationPhoto("phone", me.data.id, key);
      if (compressed) setPhotos((value) => ({ ...value, [key]: compressed }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "تعذر فتح الكاميرا أو تجهيز الصورة. حاول مرة أخرى.");
    } finally {
      photoLock.current = false;
      setPhotoBusy(null);
    }
  };

  const send = async () => {
    if (submitLock.current || photoLock.current) return;
    setError("");
    const phone = phoneNumberSchema.safeParse(newPhone);
    if (!phone.success) { setError(phone.error.issues[0]?.message ?? "رقم الهاتف غير صحيح"); return; }
    if (VERIFICATION_PHOTO_KEYS.some((key) => !photos[key])) { setError("أكمل تصوير البطاقتين والوجه وإرفاق صورة المحفظة."); return; }
    const input = { newPhoneNumber: phone.data, ...Object.fromEntries(VERIFICATION_PHOTO_KEYS.map((key) => [key, { data: photos[key]!.data, mimeType: photos[key]!.mimeType }])) } as PhoneChangeRequestInput;
    submitLock.current = true;
    try {
      await submit.mutateAsync(input);
      setSuccess("تم إرسال طلب تغيير الهاتف بنجاح. يبقى رقمك الحالي حتى الموافقة على الطلب.");
      setPhotos({});
      setNewPhone("");
      await Promise.all([current.refetch(), utils.auth.me.invalidate()]);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "";
      setError(message.includes("KYC_DOCUMENT_ENCRYPTION_KEY") || message.includes("32 بايت")
        ? "تعذر تجهيز المستندات على الخادم. الصور باقية في هذه الشاشة لإعادة المحاولة."
        : message || "تعذر إرسال الطلب. الصور باقية في هذه الشاشة لإعادة المحاولة.");
    } finally { submitLock.current = false; }
  };

  if (me.isLoading || (me.data && current.isLoading)) return <Screen title="تغيير رقم الهاتف"><ActivityIndicator color="#D7A948" /></Screen>;
  if (!me.data) return <Screen title="تغيير رقم الهاتف"><ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets><LoginPanel /></ScrollView></Screen>;
  if (current.isError) return <Screen title="تغيير رقم الهاتف"><Card><Text className="text-sm text-[#FF7D8D]" style={{ textAlign: "right" }}>تعذر تحميل حالة الطلب. تحقق من الاتصال وأعد المحاولة.</Text><View className="mt-4"><ActionButton label="إعادة المحاولة" icon="refresh-outline" onPress={() => void current.refetch()} /></View></Card></Screen>;
  const request = current.data?.request;
  return <Screen title="تغيير رقم الهاتف" subtitle="لا يتغير الرقم إلا بعد موافقة المدير">
    <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets contentContainerStyle={{ paddingBottom: 120 }}>
      <Card>
        <View className="flex-row items-center justify-between"><Pill tone={request?.status === "approved" ? "green" : request?.status === "rejected" ? "red" : request?.status === "pending" ? "gold" : "muted"}>{request?.status === "pending" ? "قيد المراجعة" : request?.status === "approved" ? "تمت الموافقة" : request?.status === "rejected" ? "مرفوض" : "جاهز"}</Pill><Text className="text-base font-bold text-[#F7F1E3]">رقمك الحالي</Text></View>
        <Text className="mt-3 text-lg font-bold text-[#D7A948]" style={{ textAlign: "right", writingDirection: "ltr" }}>{current.data?.currentPhoneNumber || "غير مسجل"}</Text>
        {success ? <Text accessibilityRole="alert" className="mt-3 text-xs leading-5 text-[#47D7A5]" style={{ textAlign: "right" }}>{success}</Text> : null}
        {request?.status === "pending" ? <Text className="mt-3 text-xs leading-5 text-[#9BA8B8]" style={{ textAlign: "right" }}>لديك طلب معلّق. ستظهر النتيجة هنا بعد مراجعة الصور.</Text> : null}
        {request?.status === "rejected" ? <Text className="mt-3 text-xs leading-5 text-[#FF9BA7]" style={{ textAlign: "right" }}>سبب الرفض: {request.rejectionReason || "راجع المستندات وأعد الإرسال."}</Text> : null}
      </Card>
      {request?.status !== "pending" ? <>
        <Card className="mt-4"><Text className="text-base font-bold text-[#F7F1E3]" style={{ textAlign: "right" }}>الرقم الجديد</Text><TextInput accessibilityLabel="رقم الهاتف الجديد" value={newPhone} onChangeText={setNewPhone} placeholder="01012345678" placeholderTextColor="#657286" keyboardType="phone-pad" maxLength={20} style={{ marginTop: 12, minHeight: 48, borderWidth: 1, borderColor: "#273548", borderRadius: 14, backgroundColor: "#0B1018", color: "#F7F1E3", paddingHorizontal: 14, textAlign: "right", writingDirection: "ltr" }} /></Card>
        <Card className="mt-4"><Text className="text-base font-bold text-[#F7F1E3]" style={{ textAlign: "right" }}>المستندات المطلوبة</Text><Text className="mt-2 text-xs leading-5 text-[#9BA8B8]" style={{ textAlign: "right" }}>البطاقة والوجه بالكاميرا مباشرة. صورة المحفظة فقط من الصور، ويجب أن تظهر الاسم ورقم الهاتف الجديد.</Text>{VERIFICATION_PHOTO_KEYS.map((key) => <PhotoField key={key} label={labels[key]} photo={photos[key]} camera={key !== "walletProfile"} busy={photoBusy === key || submit.isPending} onPress={() => void choose(key)} />)}</Card>
        <Card className="mt-4 border-[#5C4A28]"><Text className="text-xs leading-5 text-[#9BA8B8]" style={{ textAlign: "right" }}>تحفظ الصور مشفرة ولا يطلع عليها إلا المدير المخول. لن يحدث الرقم المسجل قبل قرار الموافقة.</Text>{error ? <Text accessibilityRole="alert" className="mt-3 text-sm text-[#FF7D8D]" style={{ textAlign: "right" }}>{error}</Text> : null}<View className="mt-4"><ActionButton label={submit.isPending ? "جارٍ إرسال الطلب..." : "إرسال طلب تغيير الهاتف"} icon="phone-portrait-outline" onPress={() => void send()} /></View></Card>
      </> : null}
      <View className="mt-4"><ActionButton label="العودة إلى حسابي" icon="arrow-back-outline" secondary onPress={() => router.back()} /></View>
    </ScrollView>
  </Screen>;
}

function PhotoField({ label, photo, camera, busy, onPress }: { label: string; photo?: VerificationPhoto; camera: boolean; busy: boolean; onPress: () => void }) {
  return <View className="mt-4 rounded-2xl border border-[#273548] bg-[#0B1018] p-3"><Text className="mb-2 text-sm font-semibold text-[#F7F1E3]" style={{ textAlign: "right" }}>{label}</Text>{photo ? <Image source={{ uri: photo.uri }} resizeMode="contain" style={{ width: "100%", height: 150, borderRadius: 12, backgroundColor: "#121B28" }} /> : null}<Pressable accessibilityRole="button" disabled={busy} onPress={onPress} style={{ marginTop: 10, borderRadius: 12, borderWidth: 1, borderColor: "#5C4A28", padding: 12, alignItems: "center", opacity: busy ? 0.6 : 1 }}><Text className="text-xs font-bold text-[#D7A948]">{busy ? "جارٍ تجهيز الصورة..." : photo ? "تغيير الصورة" : camera ? "التقاط بالكاميرا" : "إرفاق صورة من الهاتف"}</Text></Pressable></View>;
}
