import { useEffect, useRef, useState } from "react";
import { useRouter } from "expo-router";
import { ActivityIndicator, AppState, Image, Pressable, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView as ScrollView } from "@/components/KeyboardAwareScrollView";
import { ActionButton, Card, Pill, Screen } from "@/components/atheer-ui";
import { DateOnlyField } from "@/components/DateOnlyField";
import { trpc } from "@/lib/trpc";
import { manualAuthClient } from "@/lib/manual-auth-client";
import { useEphemeralMutation } from "@/hooks/use-ephemeral-mutation";
import { isDateOnlyNotFuture } from "@/shared/date-only";
import { isValidEgyptianNationalId } from "@/shared/national-id";
import { getPendingVerificationRoute, pickVerificationPhoto, recoverVerificationPhoto, removeLegacyVerificationDrafts } from "@/lib/verification-photo-picker";

type PhotoKey = "idFront" | "idBack" | "selfie" | "walletProfile";
type PickedPhoto = { uri: string; data: string; mimeType: "image/jpeg" | "image/png" };
const PHOTO_LABELS: Record<PhotoKey, string> = { idFront: "بطاقة الرقم القومي — الأمام", idBack: "بطاقة الرقم القومي — الخلف", selfie: "سيلفي مباشر من كاميرا الهاتف", walletProfile: "ملف المحفظة الإلكترونية" };

export default function AccountVerificationScreen() {
  const router = useRouter();
  const profile = trpc.auth.me.useQuery(undefined, { retry: false });
  const status = trpc.accountVerification.status.useQuery(undefined, { enabled: Boolean(profile.data), retry: false, refetchOnWindowFocus: true });
  const utils = trpc.useUtils();
  const submit = useEphemeralMutation(manualAuthClient.accountVerification.submit.mutate);
  const updateNationalId = useEphemeralMutation(manualAuthClient.auth.updateNationalId.mutate);
  const [photos, setPhotos] = useState<Partial<Record<PhotoKey, PickedPhoto>>>({});
  const [photoErrors, setPhotoErrors] = useState<Partial<Record<PhotoKey, string>>>({});
  const [photoBusy, setPhotoBusy] = useState<PhotoKey | null>(null);
  const [birthDateDraft, setBirthDateDraft] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [nationalIdDraft, setNationalIdDraft] = useState("");
  const [nationalIdDirty, setNationalIdDirty] = useState(false);
  const photoLock = useRef(false);
  const submitLock = useRef(false);
  const busy = submit.isPending;
  const verificationLocked = status.data?.status === "pending" || status.data?.status === "approved";

  useEffect(() => {
    const userId = profile.data?.id;
    if (!userId) return;
    let active = true;
    let recovering = false;
    const recover = async () => {
      if (!active || recovering || photoLock.current) return;
      recovering = true;
      try {
        const result = await recoverVerificationPhoto("account", userId);
        if (active && result) {
          setPhotos((current) => ({ ...current, [result.key]: result.photo }));
          setPhotoErrors((current) => ({ ...current, [result.key]: undefined }));
          setError("");
        }
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : "تعذر استعادة الصورة. أعد التقاطها؛ حسابك ما زال مسجلًا.");
      } finally { recovering = false; }
    };
    void removeLegacyVerificationDrafts();
    void recover();
    const subscription = AppState.addEventListener("change", (state) => { if (state === "active") void recover(); });
    return () => { active = false; subscription.remove(); };
  }, [profile.data?.id]);

  const birthDate = birthDateDraft ?? profile.data?.birthDate ?? "";

  const choosePhoto = async (key: PhotoKey) => {
    setError("");
    if (photoLock.current || submitLock.current || !profile.data?.id) return;
    setPhotoErrors((current) => ({ ...current, [key]: undefined }));
    photoLock.current = true;
    setPhotoBusy(key);
    try {
      const compressed = await pickVerificationPhoto("account", profile.data.id, key);
      if (compressed) {
        setPhotos((current) => ({ ...current, [key]: compressed }));
        setPhotoErrors((current) => ({ ...current, [key]: undefined }));
        return;
      }
      const pendingRoute = await getPendingVerificationRoute(profile.data.id);
      if (pendingRoute === "/account-verification") {
        setPhotoErrors((current) => ({ ...current, [key]: "لم تصل نتيجة الكاميرا بعد. أعد التقاط الصورة؛ ستبقى بقية الصور محفوظة." }));
      }
    } catch (reason) {
      setPhotoErrors((current) => ({ ...current, [key]: reason instanceof Error ? reason.message : "تعذر فتح الكاميرا أو الصور. تحقق من الإذن وحاول مرة أخرى." }));
    } finally {
      photoLock.current = false;
      setPhotoBusy(null);
    }
  };

  const sendRequest = async () => {
    if (submitLock.current || photoLock.current) return;
    setError("");
    if (!isDateOnlyNotFuture(birthDate)) { setError("اختر تاريخ ميلاد صحيحًا لا يتجاوز اليوم."); return; }
    const requiredPhotos: PhotoKey[] = ["idFront", "idBack", "selfie", "walletProfile"];
    if (requiredPhotos.some((key) => !photos[key])) { setError("أكمل الصور الأربع قبل إرسال طلب التوثيق."); return; }
    const payload = { birthDate, ...Object.fromEntries(requiredPhotos.map((key) => [key, { data: photos[key]!.data, mimeType: photos[key]!.mimeType }])) } as { birthDate: string } & Record<PhotoKey, { data: string; mimeType: "image/jpeg" | "image/png" }>;
    submitLock.current = true;
    try {
      await submit.mutateAsync(payload);
      setPhotos({});
      await utils.accountVerification.status.invalidate();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "";
      const technicalEncryptionError = message.includes("KYC_DOCUMENT_ENCRYPTION_KEY") || message.includes("32 بايت");
      setError(technicalEncryptionError ? "تعذر تجهيز مستندات التوثيق على الخادم. الصور باقية في هذه الشاشة لإعادة المحاولة." : message || "تعذر إرسال طلب التوثيق. الصور باقية في هذه الشاشة لإعادة المحاولة.");
    } finally { submitLock.current = false; }
  };

  const saveNationalId = async () => {
    setError("");
    if (!isValidEgyptianNationalId(nationalIdDraft)) { setError("أدخل الرقم القومي المكون من 14 رقمًا بصورة صحيحة."); return; }
    try {
      await updateNationalId.mutateAsync({ nationalId: nationalIdDraft });
      setNationalIdDraft("");
      setNationalIdDirty(false);
      await utils.auth.me.invalidate();
      await status.refetch();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "تعذر حفظ الرقم القومي."); }
  };

  if (profile.isLoading || (profile.data && status.isLoading)) return <Screen title="توثيق الحساب"><View className="flex-1 items-center justify-center"><ActivityIndicator color="#D7A948" /></View></Screen>;
  if (!profile.data) return <Screen title="توثيق الحساب"><Card><Text className="text-sm leading-6 text-[#9BA8B8]" style={{ textAlign: "right" }}>سجّل الدخول أولًا لطلب توثيق الحساب.</Text><View className="mt-4"><ActionButton label="العودة لتسجيل الدخول" icon="log-in-outline" onPress={() => router.replace("/(tabs)")} /></View></Card></Screen>;
  if (status.isError) return <Screen title="توثيق الحساب"><Card><Text className="text-sm leading-6 text-[#FF7D8D]" style={{ textAlign: "right" }}>تعذر تحميل حالة التوثيق. تحقق من الاتصال ثم أعد المحاولة.</Text><View className="mt-4"><ActionButton label="إعادة المحاولة" icon="refresh-outline" onPress={() => void status.refetch()} /></View></Card></Screen>;

  const requestStatus = status.data?.status ?? "not_submitted";
  const isPending = requestStatus === "pending";
  const isApproved = requestStatus === "approved";
  const isRejected = requestStatus === "rejected";
  const tone = isApproved ? "green" : isRejected ? "red" : "gold";
  const statusLabel = isApproved ? "تم توثيق الحساب" : isPending ? "قيد المراجعة" : isRejected ? "مرفوض — يمكن إعادة التقديم" : "لم يُقدّم طلب";

  return (
    <Screen title="توثيق الحساب" subtitle="أرسل بيانات واضحة للمراجعة الآمنة">
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets contentContainerStyle={{ paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
        <Card className="border-[#5C4A28]">
          <View className="flex-row items-center justify-between"><Pill tone={tone}>{statusLabel}</Pill><Text className="text-lg font-bold text-[#F7F1E3]">حالة الطلب</Text></View>
          {isPending ? <Text className="mt-3 text-sm leading-6 text-[#9BA8B8]" style={{ textAlign: "right" }}>وصل طلبك وسيراجعه المدير يدويًا. لا ترسل طلبًا آخر أثناء المراجعة.</Text> : null}
          {isApproved ? <Text className="mt-3 text-sm leading-6 text-[#47D7A5]" style={{ textAlign: "right" }}>تم توثيق الحساب واعتماده يدويًا من المدير. يمكنك استخدام الإيداع والسحب وفق إعدادات الحساب.</Text> : null}
          {isRejected ? <Text className="mt-3 text-sm leading-6 text-[#FF7D8D]" style={{ textAlign: "right" }}>سبب الرفض: {status.data?.rejectionReason || "راجع الصور والبيانات قبل إعادة التقديم."}</Text> : null}
        </Card>
        {error ? <Card className="mt-4 border-[#5C4A28]"><Text accessibilityRole="alert" className="text-sm leading-6 text-[#FF7D8D]" style={{ textAlign: "right" }}>{error}</Text></Card> : null}

        {!isPending && !isApproved ? <>
          <Card className="mt-4">
            <Text className="text-base font-bold text-[#F7F1E3]" style={{ textAlign: "right" }}>البيانات المسجلة للمطابقة</Text>
            <Info label="الاسم" value={profile.data.name} />
            <Info label="رقم الهاتف" value={profile.data.phoneNumber} />
            <Info label="الرقم القومي" value={profile.data.nationalIdMasked} />
            {!verificationLocked ? <View className="mt-3"><Text className="text-xs leading-5 text-[#9BA8B8]" style={{ textAlign: "right" }}>أدخل الرقم القومي المكون من 14 رقمًا لإكمال التوثيق. يُحفظ مشفرًا ولا يظهر كاملًا.</Text><TextInput accessibilityLabel="الرقم القومي" value={nationalIdDirty ? nationalIdDraft : ""} onChangeText={(value) => { setNationalIdDraft(value); setNationalIdDirty(true); }} placeholder="أدخل الرقم القومي المكون من 14 رقمًا" placeholderTextColor="#657286" keyboardType="number-pad" maxLength={14} style={{ minHeight: 48, marginTop: 10, borderWidth: 1, borderColor: "#273548", borderRadius: 14, backgroundColor: "#0B1018", color: "#F7F1E3", paddingHorizontal: 14, textAlign: "right", writingDirection: "ltr" }} />{nationalIdDirty ? <View className="mt-3"><ActionButton label={updateNationalId.isPending ? "جارٍ حفظ الرقم" : "حفظ الرقم القومي المشفر"} icon="shield-checkmark-outline" onPress={() => void saveNationalId()} /></View> : null}</View> : null}
            <Text className="mt-3 text-xs leading-5 text-[#9BA8B8]" style={{ textAlign: "right" }}>تُراجع البيانات والصور يدويًا بواسطة المدير؛ لا يجري التطبيق مطابقة وجه أو اعتمادًا تلقائيًا. طابق رقم الهاتف مع صورة الملف الشخصي داخل تطبيق المحفظة.</Text>
          </Card>
          <Card className="mt-4">
            <Text className="text-base font-bold text-[#F7F1E3]" style={{ textAlign: "right" }}>المستندات المطلوبة</Text>
            <Text className="mt-2 text-xs leading-5 text-[#9BA8B8]" style={{ textAlign: "right" }}>صور واضحة، كاملة الحواف، بلا قص أو انعكاس. يراجع المدير تطابق الوجه مع البطاقة وصحة البيانات يدويًا؛ لا يتم إعلان التوثيق ناجحًا قبل المراجعة الفعلية.</Text>
            <DateOnlyField value={birthDate} onChange={setBirthDateDraft} />
            <Text className="mt-2 text-xs leading-5 text-[#9BA8B8]" style={{ textAlign: "right" }}>اختر التاريخ من العجلات؛ لا يمكن إدخال تاريخ يتجاوز اليوم.</Text>
            <PhotoField label={PHOTO_LABELS.idFront} photo={photos.idFront} error={photoErrors.idFront} onPress={() => void choosePhoto("idFront")} camera busy={photoBusy === "idFront"} />
            <PhotoField label={PHOTO_LABELS.idBack} photo={photos.idBack} error={photoErrors.idBack} onPress={() => void choosePhoto("idBack")} camera busy={photoBusy === "idBack"} />
            <PhotoField label={PHOTO_LABELS.selfie} photo={photos.selfie} error={photoErrors.selfie} onPress={() => void choosePhoto("selfie")} busy={photoBusy === "selfie"} />
            <Text className="mt-2 text-[11px] leading-5 text-[#C7B98D]" style={{ textAlign: "right" }}>السيلفي يلتقط مباشرة من الكاميرا الأمامية ولا يمكن اختياره من معرض الصور.</Text>
            <PhotoField label={PHOTO_LABELS.walletProfile} photo={photos.walletProfile} error={photoErrors.walletProfile} onPress={() => void choosePhoto("walletProfile")} busy={photoBusy === "walletProfile"} />
            <Text className="mt-2 text-[11px] leading-5 text-[#C7B98D]" style={{ textAlign: "right" }}>ارفع لقطة من صفحة الملف الشخصي في تطبيق المحفظة تظهر اسم صاحب المحفظة ورقم الهاتف المسجل. لا ترفع إيصال إيداع أو إثبات تحويل.</Text>
          </Card>
          <Card className="mt-4 border-[#5C4A28]">
            <Text className="text-xs leading-5 text-[#9BA8B8]" style={{ textAlign: "right" }}>تُستخدم الصور لمراجعة طلب التوثيق، وتُعرض فقط للمراجع المصرّح له داخل لوحة المراجعة.</Text>
            <View className="mt-4"><ActionButton label={busy ? "جارٍ حفظ الطلب..." : "إرسال طلب التوثيق"} icon="shield-checkmark-outline" onPress={() => void sendRequest()} /></View>
            {error && ["idFront", "idBack", "selfie", "walletProfile"].every((key) => photos[key as PhotoKey]) ? <View className="mt-3"><ActionButton label="إعادة إرسال الطلب" icon="refresh-outline" secondary onPress={() => void sendRequest()} /></View> : null}
          </Card>
        </> : null}
        <View className="mt-4"><ActionButton label="العودة إلى حسابي" icon="arrow-back-outline" secondary onPress={() => router.push("/(tabs)/profile")} /></View>
      </ScrollView>
    </Screen>
  );
}

function PhotoField({ label, photo, error, onPress, camera = false, busy = false }: { label: string; photo?: PickedPhoto; error?: string; onPress: () => void; camera?: boolean; busy?: boolean }) {
  return (
    <View className="mt-4 rounded-2xl border border-[#273548] bg-[#0B1018] p-3">
      <Text className="mb-3 text-sm font-semibold text-[#F7F1E3]" style={{ textAlign: "right" }}>{label}</Text>
      {photo ? <Image source={{ uri: photo.uri }} resizeMode="contain" style={{ width: "100%", height: 190, borderRadius: 12, backgroundColor: "#121B28" }} /> : null}
      <Pressable accessibilityRole="button" accessibilityHint={error ? "أعد التقاط الصورة أو اختر صورة أخرى" : undefined} disabled={busy} onPress={onPress} style={({ pressed }) => ({ marginTop: 10, borderRadius: 12, borderWidth: 1, borderColor: "#5C4A28", padding: 12, alignItems: "center", backgroundColor: pressed ? "#D7A94818" : "transparent", opacity: busy ? 0.6 : 1 })}>
        <Text className="text-xs font-bold text-[#D7A948]">{busy ? "جارٍ تجهيز الصورة..." : error ? "إعادة اختيار الصورة" : photo ? "تغيير الصورة" : camera ? "التقاط الصورة بالكاميرا" : label === PHOTO_LABELS.selfie ? "التقاط سيلفي بالكاميرا الأمامية" : "اختيار صورة واضحة"}</Text>
      </Pressable>
      {error ? <Text accessibilityRole="alert" className="mt-2 text-xs leading-5 text-[#FF7D8D]" style={{ textAlign: "right" }}>{error}</Text> : null}
    </View>
  );
}

function Info({ label, value }: { label: string; value?: string | null }) {
  return <View className="mt-3 flex-row items-center justify-between border-b border-[#273548] pb-2"><Text className="text-sm font-bold text-[#F7F1E3]" style={{ writingDirection: "ltr" }}>{value || "غير مسجل"}</Text><Text className="text-xs text-[#9BA8B8]">{label}</Text></View>;
}
