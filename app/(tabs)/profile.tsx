import { KeyboardAwareScrollView as ScrollView } from "@/components/KeyboardAwareScrollView";
import { useEffect, useState } from "react";
import { ActivityIndicator, Animated, Easing, Platform, Pressable, Share, Text, TextInput, View } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Screen, BrandMark, Card, ActionButton, Pill } from "@/components/atheer-ui";
import { VerifiedName } from "@/components/VerifiedName";
import { LoginPanel } from "@/components/LoginPanel";
import { useAuth } from "@/hooks/use-auth";
import { trpc } from "@/lib/trpc";
import { copyText } from "@/lib/copy";
import { showFinancialMessage } from "@/lib/financial-feedback";
import { ADMIN_EMAIL } from "@/shared/admin";
import { isPhoneVerified } from "@/shared/phone-verification";
import { isValidEgyptianNationalId } from "@/shared/national-id";
import { getApiBaseUrl } from "@/constants/api";

const phoneInputStyle = {
  minHeight: 48,
  borderWidth: 1,
  borderColor: "#35445A",
  borderRadius: 14,
  backgroundColor: "#0B1018",
  color: "#F7F1E3",
  paddingHorizontal: 14,
  fontSize: 15,
  textAlign: "right" as const,
  writingDirection: "ltr" as const,
};

export default function ProfileScreen() {
  const { logout } = useAuth();
  const router = useRouter();
  const utils = trpc.useUtils();
  const me = trpc.auth.me.useQuery(undefined, { staleTime: 0, refetchOnMount: true, retry: false });
  const accountVerification = trpc.accountVerification.status.useQuery(undefined, { enabled: Boolean(me.data), retry: false });
  const profile = me.data;
  const shareFile = trpc.shareFile.useQuery(undefined, { enabled: Boolean(profile), retry: false });
  const isAccountApproved = accountVerification.data?.status === "approved";
  const isVerificationPending = accountVerification.data?.status === "pending";
  const verificationLocked = isVerificationPending || isAccountApproved;
  const isConfiguredAdmin = profile?.email?.trim().toLowerCase() === ADMIN_EMAIL;
  const [nationalIdDraft, setNationalIdDraft] = useState("");
  const [nationalIdDirty, setNationalIdDirty] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  const [entrance] = useState(() => new Animated.Value(0));
  const updateNationalId = trpc.auth.updateNationalId.useMutation({
    onSuccess: async () => {
      setNationalIdDirty(false);
      setNationalIdDraft("");
      await utils.auth.me.invalidate();
      showFinancialMessage("تم حفظ الرقم القومي", "تم حفظه مشفرًا ويظهر جزء منه فقط داخل الحساب.");
    },
    onError: (error) => showFinancialMessage("تعذر حفظ الرقم القومي", error.message),
  });

  useEffect(() => {
    Animated.timing(entrance, { toValue: 1, duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [entrance]);

  const copyId = async () => {
    if (!profile?.customerId || !/^\d{10}$/.test(profile.customerId)) {
      showFinancialMessage("رقم المستخدم ID غير جاهز", "أعد تحميل الصفحة لجلب رقمك من الخادم.");
      return;
    }
    try {
      await copyText(profile.customerId);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2000);
    } catch {
      showFinancialMessage("تعذر النسخ", "حاول مرة أخرى أو انسخ الرقم المعروض يدويًا.");
    }
  };

  const saveNationalId = () => {
    if (updateNationalId.isPending || !nationalIdDirty) return;
    if (!isValidEgyptianNationalId(nationalIdDraft)) {
      showFinancialMessage("الرقم القومي غير صحيح", "أدخل رقمًا قوميًا مصريًا صحيحًا مكوّنًا من 14 رقمًا.");
      return;
    }
    updateNationalId.mutate({ nationalId: nationalIdDraft });
  };

  const shareAccountFile = async () => {
    try {
      const file = shareFile.data as { url?: string; fileName?: string; mimeType?: string } | null | undefined;
      if (!file?.url) { showFinancialMessage("لا يوجد ملف للمشاركة", "لم ترفع الإدارة ملفًا متاحًا للمشاركة بعد."); return; }
      const url = file.url.startsWith("http") ? file.url : `${getApiBaseUrl()}${file.url}`;
      if (Platform.OS === "web") {
        const shared = await Share.share({ message: url, url });
        if (shared.action === Share.dismissedAction) window.open(url, "_blank", "noopener,noreferrer");
        return;
      }
      if (!FileSystem.cacheDirectory) throw new Error("لا توجد مساحة مؤقتة لتنزيل الملف.");
      const target = `${FileSystem.cacheDirectory}flotex-share-${Date.now()}-${file.fileName || "file"}`;
      const downloaded = await FileSystem.downloadAsync(url, target);
      if (!(await Sharing.isAvailableAsync())) throw new Error("المشاركة غير متاحة على هذا الجهاز.");
      await Sharing.shareAsync(downloaded.uri, { mimeType: file.mimeType || "application/octet-stream", dialogTitle: "مشاركة ملف Flotex" });
    } catch (error) {
      showFinancialMessage("تعذر مشاركة الملف", error instanceof Error ? error.message : "تحقق من الاتصال وحاول مرة أخرى.");
    }
  };

  if (me.isLoading) return <Screen title="حسابي"><ActivityIndicator color="#D7A948" /></Screen>;
  if (me.isError) {
    return (
      <Screen title="حسابي">
        <Card>
          <Text className="text-[#9BA8B8]" style={{ textAlign: "right" }}>تعذر الاتصال بالخادم لعرض ملفك.</Text>
          <View className="mt-4"><ActionButton label="إعادة المحاولة" icon="refresh-outline" onPress={() => me.refetch()} /></View>
        </Card>
      </Screen>
    );
  }
  if (!profile) {
    return <Screen title="حسابي"><ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ paddingBottom: 120 }}><LoginPanel /></ScrollView></Screen>;
  }

  const phoneVerified = isPhoneVerified(profile.phoneVerifiedAt);

  return (
    <Screen title="حسابي" subtitle="ملفك الشخصي في Flotex EGP">
      <Animated.View style={{ flex: 1, opacity: entrance, transform: [{ translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] }}>
        <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ paddingBottom: 120 }}>
          <Card className="overflow-hidden border-[#5C4A28] bg-[#121C2A]">
            <View className="flex-row items-center justify-between">
              <BrandMark />
              <Pill tone={isConfiguredAdmin ? "gold" : "muted"}>{isConfiguredAdmin ? "الإدارة" : "عميل Flotex EGP"}</Pill>
            </View>
            <View className="mt-6 flex-row items-center justify-end gap-3 rounded-2xl border border-[#35445A] bg-[#0D1520] p-4">
              <View className="flex-1 items-end">
                <Text className="text-[11px] font-semibold text-[#9BA8B8]" style={{ textAlign: "right" }}>الهوية المالية</Text>
                <View className="mt-1 flex-row items-center justify-end gap-2">
                  <VerifiedName name={profile.name || "أكمل بيانات حسابك"} verified={isAccountApproved} nameClassName="text-xl font-bold text-[#F7F1E3]" className="min-w-0 justify-end" />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="فتح دردشة خدمة العملاء"
                    onPress={() => router.push("/support" as never)}
                    style={({ pressed }) => ({ width: 32, height: 32, borderRadius: 11, borderWidth: 1, borderColor: "#D7A94855", backgroundColor: "#D7A94818", alignItems: "center", justifyContent: "center", opacity: pressed ? 0.7 : 1 })}
                  >
                    <Ionicons name="headset-outline" size={17} color="#D7A948" />
                  </Pressable>
                </View>
              </View>
              <View className="h-12 w-12 items-center justify-center rounded-2xl border border-[#D7A94855] bg-[#D7A94818]"><Ionicons name={isAccountApproved ? "shield-checkmark" : "person-outline"} size={24} color="#D7A948" /></View>
            </View>
            {!isConfiguredAdmin && !isAccountApproved ? (
              <View className="mt-4 rounded-2xl border border-[#5C4A28] bg-[#171D27] p-4">
                <View className="flex-row items-center justify-between">
                  <Pill tone={isVerificationPending ? "gold" : accountVerification.data?.status === "rejected" ? "red" : "muted"}>
                    {isVerificationPending ? "قيد المراجعة" : accountVerification.data?.status === "rejected" ? "يحتاج إعادة تقديم" : "متاح"}
                  </Pill>
                  <View className="flex-row items-center gap-2"><Ionicons name="shield-checkmark-outline" size={17} color="#D7A948" /><Text className="text-sm font-bold text-[#F7F1E3]" style={{ textAlign: "right" }}>توثيق الحساب</Text></View>
                </View>
                {accountVerification.data?.status === "rejected" && accountVerification.data.rejectionReason ? <Text className="mt-2 text-xs leading-5 text-[#FF9BA7]" style={{ textAlign: "right" }}>سبب الرفض: {accountVerification.data.rejectionReason}</Text> : null}
                {isVerificationPending ? (
                  <Text className="mt-2 text-xs text-[#9BA8B8]" style={{ textAlign: "right" }}>طلب التوثيق لدى المدير للمراجعة اليدوية.</Text>
                ) : (
                  <View className="mt-3"><ActionButton label="توثيق الحساب" icon="shield-checkmark-outline" onPress={() => router.push("/account-verification")} /></View>
                )}
              </View>
            ) : null}
            <View className="mt-5 flex-row items-center justify-between"><Text className="text-xs font-semibold text-[#9BA8B8]" style={{ textAlign: "right" }}>رقم المستخدم ID</Text><Text className="text-[10px] text-[#657286]">هوية ثابتة</Text></View>
            <View className="mt-2 flex-row items-center justify-between rounded-2xl border border-[#D7A94866] bg-[#0B1018] p-4">
              <Text selectable className="text-xl font-bold tracking-[2px] text-[#D7A948]" style={{ writingDirection: "ltr" }}>
                {/^[0-9]{10}$/.test(profile.customerId) ? profile.customerId : "جارٍ جلب الرقم..."}
              </Text>
              <ActionButton label="نسخ" icon="copy-outline" secondary onPress={copyId} />
            </View>
            {copiedId ? <Text accessibilityRole="alert" className="mt-2 text-xs font-bold text-[#47D7A5]" style={{ textAlign: "left" }}>تم النسخ ✓</Text> : null}
            <Text className="mt-3 text-xs leading-5 text-[#657286]" style={{ textAlign: "right" }}>هذا الرقم ثابت ومرتبط بملفك ومحفظتك ومعاملاتك.</Text>
          </Card>

          <Card className="mt-4 border-[#35445A] bg-[#111B28]">
            <SectionHeading icon="person-circle-outline" title="بيانات الحساب" subtitle="بياناتك الشخصية المحفوظة بأمان" />
            <View className="mt-2 rounded-2xl border border-[#273548] bg-[#0D1520] px-4">
              <Info label="الاسم" value={profile.givenName} icon="person-outline" />
              <Info label="اسم الأب" value={profile.fatherName} icon="people-outline" />
              <Info label="البريد الإلكتروني" value={profile.email} ltr icon="mail-outline" />
              <Info label="تاريخ الميلاد" value={profile.birthDate} ltr icon="calendar-outline" />
              <Info label="المحافظة" value={profile.governorate} icon="location-outline" last />
            </View>
            {!isAccountApproved ? <View className="mt-4 rounded-2xl border border-[#273548] bg-[#0D1520] p-4">
              <View className="flex-row items-center justify-between"><Text className="text-xs text-[#9BA8B8]" style={{ textAlign: "right" }}>الرقم القومي</Text><Ionicons name="lock-closed-outline" size={16} color="#D7A948" /></View>
              <Text selectable className="mt-2 text-base font-bold text-[#F7F1E3]" style={{ textAlign: "right", writingDirection: "ltr" }}>
                {profile.nationalIdMasked || "لم يُسجل بعد"}
              </Text>
              <TextInput
                accessibilityLabel="الرقم القومي"
                value={nationalIdDirty ? nationalIdDraft : ""}
                editable={!verificationLocked}
                onChangeText={(value) => { setNationalIdDraft(value); setNationalIdDirty(true); }}
                placeholder="أدخل 14 رقمًا للتحديث"
                placeholderTextColor="#657286"
                keyboardType="number-pad"
                maxLength={18}
                style={{ ...phoneInputStyle, marginTop: 10 }}
              />
              <Text className="mt-2 text-[11px] leading-5 text-[#657286]" style={{ textAlign: "right" }}>يُحفظ الرقم مشفرًا ولا يُعرض كاملًا.</Text>
              {nationalIdDirty && !verificationLocked ? <View className="mt-3"><ActionButton label={updateNationalId.isPending ? "جارٍ الحفظ..." : "حفظ الرقم القومي"} icon="shield-checkmark-outline" onPress={saveNationalId} /></View> : null}
            </View> : null}
            {phoneVerified ? (
              <View className="mt-4 rounded-2xl border border-[#273548] bg-[#0D1520] p-4">
                <View className="flex-row items-center justify-between"><Pressable onPress={() => router.push("/change-phone")}><Text className="text-xs font-bold text-[#D7A948]">تغيير</Text></Pressable><View className="flex-row items-center gap-2"><Pill tone="green">رقم موثّق</Pill><Text className="text-xs text-[#9BA8B8]">رقم الهاتف</Text></View></View>
                <Text selectable className="mt-2 text-base font-bold text-[#F7F1E3]" style={{ textAlign: "right", writingDirection: "ltr" }}>{profile.phoneNumber || "لم يُسجل بعد"}</Text>
                <Text className="mt-2 text-xs leading-5 text-[#657286]" style={{ textAlign: "right" }}>أي تغيير يرسل طلبًا جديدًا للمراجعة، ولا يتغير الرقم إلا بعد موافقة الإدارة.</Text>
              </View>
            ) : (
              <View className="mt-4 rounded-2xl border border-[#273548] bg-[#0D1520] p-4">
                <View className="flex-row items-center justify-between"><Pressable onPress={() => router.push("/change-phone")}><Text className="text-xs font-bold text-[#D7A948]">تغيير</Text></Pressable><Text className="text-xs font-semibold text-[#9BA8B8]" style={{ textAlign: "right" }}>رقم الهاتف</Text></View>
                <Text className="mt-2 text-base font-bold text-[#F7F1E3]" style={{ textAlign: "right", writingDirection: "ltr" }}>{profile.phoneNumber || "لم يُسجل بعد"}</Text>
                <Text className="mt-2 text-[11px] leading-5 text-[#657286]" style={{ textAlign: "right" }}>يُرسل طلب تغيير الرقم مع مستندات الهوية وصورة المحفظة للمراجعة اليدوية.</Text>
              </View>
            )}
            {profile.profileCompletedAt ? (
              <View className="mt-5"><Pill tone="muted">بيانات التسجيل الأساسية ثابتة</Pill></View>
            ) : (
              <View className="mt-5"><ActionButton label="إكمال بيانات التسجيل" icon="person-add-outline" onPress={() => router.push("/onboarding")} /></View>
            )}
          </Card>

          <SectionHeading icon="apps-outline" title="اختصارات الحساب" subtitle="وصول سريع إلى أدواتك الأساسية" className="mt-5" />
          <View className="mt-3 gap-3"><ActionButton label="المراسلة والدعم" icon="chatbubbles-outline" onPress={() => router.push("/support" as never)} /><ActionButton label="مشاركة" icon="share-social-outline" secondary onPress={() => { void shareAccountFile(); }} /><ActionButton label="رمز الأمان" icon="lock-closed-outline" secondary onPress={() => router.push("/security-pin" as never)} /><ActionButton label="الأجهزة والجلسات" icon="phone-portrait-outline" secondary onPress={() => router.push("/sessions" as never)} /></View>
          <View className="mt-5 rounded-3xl border border-[#273548] bg-[#111B28] p-4">
            <SectionHeading icon="settings-outline" title="إدارة الحساب" subtitle="إعدادات الوصول والحماية" />
            <View className="mt-4 gap-3">
              {isConfiguredAdmin ? <ActionButton label="فتح لوحة التحكم" icon="desktop-outline" onPress={() => router.push("/control")} /> : null}
              <ActionButton
                label="تسجيل الخروج"
                icon="log-out-outline"
                secondary
                onPress={() => {
                  const request = logout();
                  router.replace("/(tabs)");
                  void request.catch((reason) => showFinancialMessage("تنبيه تسجيل الخروج", reason instanceof Error ? reason.message : "تعذر تأكيد إبطال الجلسة على الخادم."));
                }}
              />
              <ActionButton label="تغيير كلمة المرور" icon="key-outline" secondary onPress={() => router.push("/change-password" as never)} />
              {!isConfiguredAdmin ? <ActionButton label="حذف الحساب" icon="person-remove-outline" secondary onPress={() => router.push("/delete-account" as never)} /> : null}
            </View>
          </View>
        </ScrollView>
      </Animated.View>
    </Screen>
  );
}

function SectionHeading({ icon, title, subtitle, className = "" }: { icon: keyof typeof Ionicons.glyphMap; title: string; subtitle?: string; className?: string }) {
  return <View className={`flex-row items-center justify-end gap-3 ${className}`}><View className="flex-1 items-end"><Text className="text-lg font-bold text-[#F7F1E3]" style={{ textAlign: "right" }}>{title}</Text>{subtitle ? <Text className="mt-1 text-xs text-[#9BA8B8]" style={{ textAlign: "right" }}>{subtitle}</Text> : null}</View><View className="h-10 w-10 items-center justify-center rounded-2xl border border-[#D7A94844] bg-[#D7A94814]"><Ionicons name={icon} size={20} color="#D7A948" /></View></View>;
}

function Info({ label, value, ltr = false, icon = "ellipse-outline", last = false }: { label: string; value: string | null | undefined; ltr?: boolean; icon?: keyof typeof Ionicons.glyphMap; last?: boolean }) {
  return (
    <View className={`${last ? "" : "border-b border-[#273548]"} flex-row items-center gap-3 py-4`}>
      <Ionicons name={icon} size={18} color="#738198" />
      <View className="flex-1 items-end"><Text className="text-xs text-[#9BA8B8]" style={{ textAlign: "right" }}>{label}</Text><Text selectable className="mt-1 text-base font-bold text-[#F7F1E3]" style={{ textAlign: "right", writingDirection: ltr ? "ltr" : "rtl" }}>{value || "لم يُسجل بعد"}</Text></View>
    </View>
  );
}
