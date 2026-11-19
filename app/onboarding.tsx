import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Text,
  TextInput,
  View,
  Modal,
  FlatList,
  Pressable,
} from "react-native";
import { KeyboardAwareScrollView as ScrollView } from "@/components/KeyboardAwareScrollView";
import { useRouter } from "expo-router";
import { Screen, Card, BrandMark, ActionButton } from "@/components/atheer-ui";
import { trpc } from "@/lib/trpc";
import { EGYPTIAN_GOVERNORATES, registrationSchema } from "@/shared/registration";
import { confirmFinancialAction } from "@/lib/financial-feedback";
import * as Auth from "@/lib/_core/auth";
import { authenticatedHomeRoute } from "@/shared/auth-routing";

export default function Onboarding() {
  const router = useRouter(),
    utils = trpc.useUtils();
  const me = trpc.auth.me.useQuery(undefined, { staleTime: 0, retry: false });
  const [givenName, setGivenName] = useState(""),
    [fatherName, setFatherName] = useState(""),
    [phoneNumber, setPhoneNumber] = useState(""),
    [birthDate, setBirthDate] = useState(""),
    [governorate, setGovernorate] = useState(""),
    [governoratesOpen, setGovernoratesOpen] = useState(false),
    [error, setError] = useState("");
  const save = trpc.auth.completeRegistration.useMutation({
    onSuccess: async (user) => {
      if (user)
        await Auth.setUserInfo({
          ...user,
          lastSignedIn: new Date(user.lastSignedIn),
        });
      await utils.auth.me.invalidate();
      await me.refetch();
      router.replace(authenticatedHomeRoute(user?.role));
    },
    onError: (e) => setError(e.message),
  });
  useEffect(() => {
    if (me.data?.profileCompletedAt) router.replace(authenticatedHomeRoute(me.data.role));
  }, [me.data?.profileCompletedAt, me.data?.role, router]);
  const register = async () => {
    if (save.isPending) return;
    setError("");
    const parsed = registrationSchema.safeParse({
      givenName,
      fatherName,
      phoneNumber,
      birthDate,
      governorate: governorate || undefined,
    });
    if (!governorate) { setError("اختر المحافظة قبل إكمال التسجيل."); return; }
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "تحقق من بياناتك");
      return;
    }
    const confirmed = await confirmFinancialAction(
      "تأكيد بيانات التسجيل",
      `الاسم: ${parsed.data.givenName}\nاسم الأب: ${parsed.data.fatherName}\nالهاتف: ${parsed.data.phoneNumber}\n\nستصبح هذه البيانات ثابتة بعد التسجيل. تأكد من صحتها.`,
    );
    if (confirmed) save.mutate(parsed.data);
  };
  if (me.isLoading)
    return (
      <Screen>
        <ActivityIndicator color="#D7A948" />
      </Screen>
    );
  if (!me.data)
    return (
      <Screen title="إنشاء حساب">
        <Card>
          <Text className="text-[#F7F1E3]">
            سجّل الدخول أولًا لإكمال بياناتك.
          </Text>
          <View className="mt-4">
            <ActionButton
              label="العودة للدخول"
              icon="log-in-outline"
              onPress={() => router.replace("/(tabs)")}
            />
          </View>
        </Card>
      </Screen>
    );
  return (
    <Screen title="إنشاء حساب Flotex EGP" subtitle="خطوة واحدة لإكمال حسابك">
      <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={{ paddingBottom: 100 }}
      >
        <Card>
          <BrandMark />
          <Text
            className="mt-6 text-2xl font-bold text-[#F7F1E3]"
            style={{ textAlign: "right" }}
          >
            بياناتك الأساسية
          </Text>
          <Text
            className="mt-2 text-sm leading-6 text-[#9BA8B8]"
            style={{ textAlign: "right" }}
          >
            أدخل بياناتك الصحيحة. تُحفظ مرة واحدة وترتبط برقم عميلك في Flotex EGP.
          </Text>
          <Text
            className="mt-5 text-xs text-[#9BA8B8]"
            style={{ textAlign: "right" }}
          >
            البريد الإلكتروني
          </Text>
          <Text
            selectable
            className="mt-2 text-[#D7A948]"
            style={{ writingDirection: "ltr", textAlign: "right" }}
          >
            {me.data.email || "غير متوفر في حساب الدخول"}
          </Text>
          <Field
            label="الاسم"
            value={givenName}
            onChangeText={setGivenName}
            placeholder="اسمك"
          />
          <Field
            label="اسم الأب"
            value={fatherName}
            onChangeText={setFatherName}
            placeholder="اسم الأب"
          />
          <Field
            label="رقم الهاتف"
            value={phoneNumber}
            onChangeText={setPhoneNumber}
            placeholder="01012345678"
            phone
          />
          <Field
            label="تاريخ الميلاد (YYYY-MM-DD)"
            value={birthDate}
            onChangeText={setBirthDate}
            placeholder="1990-01-31"
            date
          />
          <Text className="mb-2 mt-5 text-sm font-bold text-[#F7F1E3]" style={{ textAlign: "right" }}>المحافظة</Text>
          <Pressable onPress={() => setGovernoratesOpen(true)} style={{ minHeight: 52, justifyContent: "center", borderWidth: 1, borderColor: "#273548", borderRadius: 14, backgroundColor: "#0B1018", paddingHorizontal: 14 }}><Text className="text-base text-[#F7F1E3]" style={{ textAlign: "right" }}>{governorate || "اختر المحافظة"}  ˅</Text></Pressable>
          <Text
            className="mt-4 text-xs leading-5 text-[#9BA8B8]"
            style={{ textAlign: "right" }}
          >
            راجع البيانات قبل التسجيل؛ لن تتمكن من تعديلها من التطبيق بعد الحفظ.
          </Text>
          {error ? (
            <Text
              accessibilityRole="alert"
              className="mt-4 text-sm leading-6 text-[#F58F96]"
              style={{ textAlign: "right" }}
            >
              {error}
            </Text>
          ) : null}
          <View className="mt-6">
            <ActionButton
              label={save.isPending ? "جارٍ التسجيل" : "تسجيل"}
              icon="checkmark-circle-outline"
              onPress={register}
            />
          </View>
        </Card>
      </ScrollView>
      <Modal visible={governoratesOpen} transparent animationType="slide" onRequestClose={() => setGovernoratesOpen(false)}><View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "#0008" }}><View style={{ maxHeight: "78%", borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: "#111722", padding: 20 }}><Text className="mb-4 text-xl font-bold text-[#F7F1E3]" style={{ textAlign: "right" }}>اختر المحافظة</Text><FlatList data={EGYPTIAN_GOVERNORATES} keyExtractor={(item) => item} renderItem={({ item }) => <Pressable onPress={() => { setGovernorate(item); setGovernoratesOpen(false); }} style={{ borderBottomWidth: 1, borderBottomColor: "#273548", paddingVertical: 15 }}><Text className="text-base text-[#F7F1E3]" style={{ textAlign: "right" }}>{item}</Text></Pressable>} /></View></View></Modal>
    </Screen>
  );
}
function Field({
  label,
  value,
  onChangeText,
  placeholder,
  phone = false,
  date = false,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  phone?: boolean;
  date?: boolean;
}) {
  return (
    <View className="mt-5">
      <Text
        className="mb-2 text-sm font-bold text-[#F7F1E3]"
        style={{ textAlign: "right" }}
      >
        {label}
      </Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#657286"
        maxLength={phone ? 20 : date ? 10 : 100}
        keyboardType={phone ? "phone-pad" : "default"}
        autoComplete={phone ? "tel" : "name"}
        style={{ textAlign: "right", writingDirection: phone || date ? "ltr" : "rtl" }}
        className="rounded-2xl border border-[#273548] bg-[#0B1018] px-4 py-4 text-base text-[#F7F1E3]"
      />
    </View>
  );
}
