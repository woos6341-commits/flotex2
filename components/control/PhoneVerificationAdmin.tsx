import { useState } from "react";
import { ActivityIndicator, Linking, Pressable, Switch, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ActionButton, Card, Pill } from "@/components/atheer-ui";
import { trpc } from "@/lib/trpc";
import { confirmFinancialAction, showFinancialMessage } from "@/lib/financial-feedback";
import { buildPhoneVerificationTelegramUrl, phoneVerificationContactsSchema } from "@/shared/phone-verification";

type Request = {
  id: number;
  userId: number;
  phoneNumber: string;
  phoneNormalized: string;
  message: string | null;
  status: "pending" | "approved" | "rejected" | "cancelled";
  reviewedBy: number | null;
  reviewedAt: Date | string | null;
  reviewNote: string | null;
  createdAt: Date | string;
};

type Customer = {
  id: number;
  customerId: string | null;
  name: string | null;
  email: string | null;
  givenName: string | null;
  fatherName: string | null;
  phoneNumber: string | null;
  phoneNormalized: string | null;
  phoneVerifiedAt: Date | string | null;
  profileCompletedAt: Date | string | null;
  role: string;
  request: Request | null;
};

const inputStyle = {
  minHeight: 46,
  borderWidth: 1,
  borderColor: "#273548",
  borderRadius: 13,
  backgroundColor: "#0B1018",
  color: "#F7F1E3",
  paddingHorizontal: 12,
  fontSize: 13,
  textAlign: "right" as const,
};

export function PhoneVerificationAdmin() {
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const contacts = trpc.admin.phoneVerificationContacts.useQuery(undefined, { retry: false });
  const users = trpc.admin.phoneVerificationUsers.useQuery({ search }, { retry: false, staleTime: 0 });

  return (
    <View className="gap-4">
      <Card>
        <View className="flex-row items-center justify-between"><Pill tone="gold">قسم مستقل</Pill><Text className="text-base font-bold text-[#F7F1E3]">قنوات طلب توثيق الهاتف</Text></View>
        <Text className="mt-2 text-xs leading-5 text-[#9BA8B8]" style={{ textAlign: "right" }}>
          هذه القنوات مخصصة لتوثيق ملكية رقم الهاتف فقط، ولا تغيّر أو تستبدل قنوات «خدمة العملاء». اترك القناة فارغة لإخفائها عن العملاء.
        </Text>
        {contacts.isLoading ? <View className="mt-4"><ActivityIndicator color="#D7A948" /></View> : null}
        {contacts.isError ? <View className="mt-3"><Text className="text-xs text-[#FF7D8D]" style={{ textAlign: "right" }}>تعذر تحميل قنوات التوثيق.</Text><View className="mt-3"><ActionButton label="إعادة المحاولة" icon="refresh-outline" onPress={() => void contacts.refetch()} /></View></View> : null}
        {contacts.data ? <ContactSettingsForm key={`${contacts.data.email}:${contacts.data.telegramUsername}`} initial={contacts.data} /> : null}
      </Card>

      <Card>
        <Text className="text-base font-bold text-[#F7F1E3]" style={{ textAlign: "right" }}>طلبات التوثيق وملفات العملاء</Text>
        <Text className="mt-1 text-xs leading-5 text-[#9BA8B8]" style={{ textAlign: "right" }}>ابحث برقم الهاتف أو رقم العميل. لا تعتمد أي طلب قبل التحقق من ملكية الرقم خارج التطبيق.</Text>
        <View className="mt-4 flex-row gap-2">
          <View style={{ flex: 1 }}><TextInput accessibilityLabel="بحث برقم الهاتف أو العميل" value={searchDraft} onChangeText={setSearchDraft} onSubmitEditing={() => setSearch(searchDraft.trim())} placeholder="الهاتف أو رقم العميل" placeholderTextColor="#657286" returnKeyType="search" style={inputStyle} /></View>
          <Pressable accessibilityRole="button" onPress={() => setSearch(searchDraft.trim())} style={({ pressed }) => ({ minWidth: 68, borderRadius: 13, backgroundColor: "#D7A948", alignItems: "center", justifyContent: "center", opacity: pressed ? 0.78 : 1 })}><Text className="px-3 text-xs font-bold text-[#0B1018]">بحث</Text></Pressable>
        </View>
        {users.isLoading ? <View className="mt-5"><ActivityIndicator color="#D7A948" /></View> : null}
        {users.isError ? <View className="mt-4"><Text className="text-xs text-[#FF7D8D]" style={{ textAlign: "right" }}>تعذر تحميل ملفات العملاء.</Text><View className="mt-3"><ActionButton label="إعادة المحاولة" icon="refresh-outline" onPress={() => void users.refetch()} /></View></View> : null}
        {users.data?.length === 0 ? <Text className="mt-4 text-xs text-[#9BA8B8]" style={{ textAlign: "right" }}>لا توجد نتائج مطابقة.</Text> : null}
        <View className="mt-3 gap-3">{(users.data ?? []).map((user) => <PhoneVerificationCustomerCard key={user.id} customer={user as Customer} />)}</View>
        {users.data && users.data.length === 50 ? <Text className="mt-3 text-[11px] text-[#657286]" style={{ textAlign: "right" }}>تظهر أحدث 50 نتيجة كحد أقصى؛ أدخل رقم الهاتف أو رقم العميل لتضييق البحث.</Text> : null}
      </Card>
    </View>
  );
}

function ContactSettingsForm({ initial }: { initial: { email: string; telegramUsername: string } }) {
  const utils = trpc.useUtils();
  const [email, setEmail] = useState(initial.email);
  const [telegramUsername, setTelegramUsername] = useState(initial.telegramUsername);
  const [feedback, setFeedback] = useState("");
  const validation = phoneVerificationContactsSchema.safeParse({ email, telegramUsername });
  const telegramUrl = validation.success ? buildPhoneVerificationTelegramUrl(validation.data.telegramUsername) : null;
  const save = trpc.admin.updatePhoneVerificationContacts.useMutation({
    onSuccess: async (saved) => {
      setEmail(saved.email);
      setTelegramUsername(saved.telegramUsername);
      setFeedback("تم حفظ إعدادات توثيق الهاتف.");
      utils.admin.phoneVerificationContacts.setData(undefined, saved);
      await utils.phoneVerification.contacts.invalidate();
    },
    onError: (error) => setFeedback(error.message || "تعذر حفظ إعدادات التوثيق."),
  });

  const submit = () => {
    if (!validation.success) {
      setFeedback(validation.error.issues[0]?.message ?? "راجع البريد واسم مستخدم Telegram.");
      return;
    }
    setFeedback("");
    save.mutate(validation.data);
  };

  return (
    <View className="mt-4">
      <Text className="mb-2 text-xs font-semibold text-[#C7B98D]" style={{ textAlign: "right" }}>البريد الخاص بالتوثيق (اختياري)</Text>
      <TextInput accessibilityLabel="بريد توثيق الهاتف" value={email} onChangeText={(value) => { setEmail(value); setFeedback(""); }} autoCapitalize="none" keyboardType="email-address" autoComplete="email" placeholder="اتركه فارغًا حتى تضبط البريد الرسمي" placeholderTextColor="#657286" style={inputStyle} />
      <Text className="mb-2 mt-4 text-xs font-semibold text-[#C7B98D]" style={{ textAlign: "right" }}>اسم مستخدم Telegram أو رابط t.me (اختياري)</Text>
      <TextInput accessibilityLabel="Telegram لتوثيق الهاتف" value={telegramUsername} onChangeText={(value) => { setTelegramUsername(value); setFeedback(""); }} autoCapitalize="none" autoCorrect={false} placeholder="اتركه فارغًا حتى تضبط القناة الرسمية" placeholderTextColor="#657286" style={inputStyle} />
      {telegramUrl ? <Pressable accessibilityRole="button" onPress={() => void Linking.openURL(telegramUrl).catch(() => showFinancialMessage("تعذر فتح Telegram", "تحقق من القناة على هذا الجهاز."))} style={({ pressed }) => ({ alignSelf: "flex-end", marginTop: 8, borderRadius: 12, borderWidth: 1, borderColor: "#273548", paddingHorizontal: 12, paddingVertical: 9, opacity: pressed ? 0.75 : 1 })}><Text className="text-xs font-bold text-[#D7A948]">معاينة: {telegramUrl}</Text></Pressable> : null}
      <Text className="mt-2 text-[11px] leading-5 text-[#657286]" style={{ textAlign: "right" }}>تظهر القيم المحفوظة للمستخدمين المسجلين في صفحة التوثيق. استخدم قناة رسمية تملكها الإدارة فقط.</Text>
      {feedback ? <Text accessibilityRole="alert" className={`mt-3 text-xs ${feedback.includes("تم حفظ") ? "text-[#47D7A5]" : "text-[#FF7D8D]"}`} style={{ textAlign: "right" }}>{feedback}</Text> : null}
      <View className="mt-3"><ActionButton label={save.isPending ? "جارٍ الحفظ..." : "حفظ إعدادات التوثيق"} icon="save-outline" onPress={submit} /></View>
    </View>
  );
}

function PhoneVerificationCustomerCard({ customer }: { customer: Customer }) {
  const utils = trpc.useUtils();
  const [expanded, setExpanded] = useState(false);
  const [givenName, setGivenName] = useState(customer.givenName ?? "");
  const [fatherName, setFatherName] = useState(customer.fatherName ?? "");
  const [phoneNumber, setPhoneNumber] = useState(customer.phoneNumber ?? "");
  const [reviewNote, setReviewNote] = useState("");
  const [ownershipConfirmed, setOwnershipConfirmed] = useState(false);
  const audits = trpc.admin.customerProfileAudits.useQuery({ userId: customer.id }, { enabled: expanded, retry: false });

  const refresh = async () => {
    await Promise.all([
      utils.admin.phoneVerificationUsers.invalidate(),
      utils.admin.customerProfileAudits.invalidate({ userId: customer.id }),
      utils.auth.me.invalidate(),
      utils.admin.recentOperations.invalidate(),
    ]);
  };
  const edit = trpc.admin.updateCustomerProfile.useMutation({
    onSuccess: async (saved) => {
      setGivenName(saved.givenName ?? "");
      setFatherName(saved.fatherName ?? "");
      setPhoneNumber(saved.phoneNumber ?? "");
      await refresh();
      showFinancialMessage("تم تحديث ملف العميل", saved.phoneChanged ? "تم إلغاء التوثيق السابق للرقم. أرسل العميل طلب توثيق جديدًا للرقم الحالي." : "تم حفظ التغييرات وتسجيلها في سجل التدقيق.");
    },
    onError: (error) => showFinancialMessage("تعذر تحديث الملف", error.message),
  });
  const review = trpc.admin.reviewPhoneVerificationRequest.useMutation({
    onSuccess: async (result) => {
      setOwnershipConfirmed(false);
      setReviewNote("");
      await refresh();
      showFinancialMessage(result.status === "approved" ? "تم توثيق الهاتف" : "تم رفض طلب التوثيق", result.status === "approved" ? "تم حفظ حالة التوثيق وتسجيل هوية المدير ووقت المراجعة." : "تم حفظ سبب رفض الطلب.");
    },
    onError: (error) => showFinancialMessage("تعذرت مراجعة الطلب", error.message),
  });

  const saveProfile = () => {
    const normalizedPhoneInput = phoneNumber.trim();
    edit.mutate({ userId: customer.id, ...(normalizedPhoneInput ? { phoneNumber: normalizedPhoneInput } : {}), ...(givenName.trim() ? { givenName } : {}), ...(fatherName.trim() ? { fatherName } : {}) });
  };
  const approve = async () => {
    if (!customer.request || !ownershipConfirmed || review.isPending) return;
    const confirmed = await confirmFinancialAction("تأكيد توثيق الهاتف", `رقم الهاتف: ${customer.request.phoneNumber}\nرقم العميل: ${customer.customerId ?? "غير متوفر"}\n\nأكد فقط بعد التحقق يدويًا من ملكية الرقم خارج التطبيق.`);
    if (!confirmed) return;
    review.mutate({ requestId: customer.request.id, status: "approved", ownershipConfirmed: true, note: reviewNote.trim() });
  };
  const reject = () => {
    if (!customer.request || review.isPending) return;
    if (reviewNote.trim().length < 3) {
      showFinancialMessage("أدخل سبب الرفض", "يجب أن يكون السبب ثلاثة أحرف على الأقل.");
      return;
    }
    review.mutate({ requestId: customer.request.id, status: "rejected", ownershipConfirmed: false, note: reviewNote.trim() });
  };

  return (
    <View className="rounded-2xl border border-[#273548] bg-[#0B1018] p-3">
      <Pressable accessibilityRole="button" onPress={() => setExpanded((value) => !value)} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", justifyContent: "space-between", opacity: pressed ? 0.8 : 1 })}>
        <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={18} color="#D7A948" />
        <View className="flex-1 px-3">
          <Text className="text-sm font-bold text-[#F7F1E3]" style={{ textAlign: "right" }}>{customer.name || "اسم غير مكتمل"}</Text>
          <Text className="mt-1 text-[11px] text-[#9BA8B8]" style={{ textAlign: "right" }}>ID: {customer.customerId || "غير متوفر"} · هاتف: {customer.phoneNumber || "غير مسجل"}</Text>
        </View>
        <Pill tone={customer.phoneVerifiedAt ? "green" : customer.request?.status === "pending" ? "gold" : "muted"}>{customer.phoneVerifiedAt ? "موثّق" : customer.request?.status === "pending" ? "طلب جديد" : "غير موثّق"}</Pill>
      </Pressable>
      {expanded ? (
        <View className="mt-4 border-t border-[#273548] pt-3">
          <Text className="text-xs leading-5 text-[#9BA8B8]" style={{ textAlign: "right" }}>البريد: {customer.email || "غير مسجل"} · الدور: {customer.role}</Text>
          {customer.request ? (
            <View className="mt-3 rounded-xl border border-[#5C4A28] bg-[#171D27] p-3">
              <View className="flex-row items-center justify-between"><Text className="text-[10px] text-[#9BA8B8]">{formatDate(customer.request.createdAt)}</Text><Text className="text-xs font-bold text-[#D7A948]">طلب {requestStatusLabel(customer.request.status)}</Text></View>
              <Text className="mt-2 text-xs text-[#F7F1E3]" style={{ textAlign: "right" }}>الرقم المرسل للمراجعة: {customer.request.phoneNumber}</Text>
              {customer.request.message ? <Text className="mt-2 text-xs leading-5 text-[#9BA8B8]" style={{ textAlign: "right" }}>ملاحظة العميل: {customer.request.message}</Text> : null}
              {customer.request.reviewNote && customer.request.status !== "pending" ? <Text className="mt-2 text-xs leading-5 text-[#9BA8B8]" style={{ textAlign: "right" }}>ملاحظة المراجعة: {customer.request.reviewNote}</Text> : null}
              {customer.request.status === "pending" ? (
                <>
                  <TextInput accessibilityLabel="ملاحظة التوثيق أو سبب الرفض" value={reviewNote} onChangeText={setReviewNote} maxLength={500} placeholder="ملاحظة مراجعة؛ سبب الرفض مطلوب عند الرفض" placeholderTextColor="#657286" style={{ ...inputStyle, marginTop: 10 }} />
                  <View className="mt-3 flex-row items-center justify-between rounded-xl border border-[#273548] bg-[#0B1018] px-3 py-2">
                    <Switch value={ownershipConfirmed} onValueChange={setOwnershipConfirmed} trackColor={{ false: "#273548", true: "#5C4A28" }} thumbColor={ownershipConfirmed ? "#D7A948" : "#9BA8B8"} />
                    <Text className="ml-3 flex-1 text-[11px] leading-4 text-[#C7B98D]" style={{ textAlign: "right" }}>تحققت يدويًا من ملكية الرقم قبل اعتماده</Text>
                  </View>
                  <View className="mt-3 gap-2">
                    <ActionButton label={review.isPending ? "جارٍ التحديث..." : "تأكيد التوثيق بعد مراجعة الملكية"} icon="shield-checkmark-outline" onPress={() => void approve()} />
                    <ActionButton label="رفض الطلب مع سبب" icon="close-circle-outline" secondary onPress={reject} />
                  </View>
                </>
              ) : null}
            </View>
          ) : <Text className="mt-3 text-xs text-[#657286]" style={{ textAlign: "right" }}>لا يوجد طلب مرتبط برقم الهاتف الحالي.</Text>}

          {customer.role !== "admin" ? (
            <View className="mt-4 rounded-xl border border-[#273548] bg-[#121B28] p-3">
              <Text className="mb-3 text-sm font-bold text-[#F7F1E3]" style={{ textAlign: "right" }}>تعديل بيانات الملف المسموح بها</Text>
              <TextInput accessibilityLabel="الاسم الأول" value={givenName} onChangeText={setGivenName} maxLength={100} placeholder="الاسم الأول" placeholderTextColor="#657286" style={inputStyle} />
              <TextInput accessibilityLabel="اسم الأب" value={fatherName} onChangeText={setFatherName} maxLength={100} placeholder="اسم الأب" placeholderTextColor="#657286" style={{ ...inputStyle, marginTop: 8 }} />
              <TextInput accessibilityLabel="رقم هاتف العميل" value={phoneNumber} onChangeText={setPhoneNumber} keyboardType="phone-pad" maxLength={20} placeholder="رقم الهاتف" placeholderTextColor="#657286" style={{ ...inputStyle, marginTop: 8, writingDirection: "ltr" }} />
              <Text className="mt-2 text-[10px] leading-4 text-[#657286]" style={{ textAlign: "right" }}>اترك حقل الهاتف فارغًا إذا أردت تعديل الأسماء فقط. لن يتغير البريد المستخدم للدخول أو كلمة المرور أو رقم العميل أو الدور أو الرصيد. تغيير الهاتف الإداري يعيد الحالة إلى غير موثّق.</Text>
              <View className="mt-3"><ActionButton label={edit.isPending ? "جارٍ الحفظ..." : "حفظ الملف وتسجيل التعديل"} icon="save-outline" onPress={saveProfile} /></View>
            </View>
          ) : null}

          <Text className="mb-2 mt-4 text-xs font-bold text-[#C7B98D]" style={{ textAlign: "right" }}>سجل تغييرات الملف</Text>
          {audits.isLoading ? <ActivityIndicator color="#D7A948" /> : null}
          {audits.data?.length === 0 ? <Text className="text-[11px] text-[#657286]" style={{ textAlign: "right" }}>لا توجد تغييرات إدارية مسجلة.</Text> : null}
          {audits.data?.map((audit) => <AuditRow key={audit.id} audit={audit} />)}
        </View>
      ) : null}
    </View>
  );
}

function AuditRow({ audit }: { audit: { id: number; adminId: number; changes: string; createdAt: Date | string; admin: { id: number; name: string | null; email: string | null } | null } }) {
  let fields: string[] = [];
  try {
    const parsed = JSON.parse(audit.changes) as Record<string, unknown>;
    fields = Object.keys(parsed).map((key) => auditFieldLabel(key));
  } catch {
    fields = ["تعديل ملف"];
  }
  return (
    <View className="mt-2 rounded-xl border border-[#273548] bg-[#0B1018] px-3 py-2">
      <Text className="text-[10px] text-[#9BA8B8]" style={{ textAlign: "right" }}>{audit.admin?.name || audit.admin?.email || `المدير #${audit.adminId}`} · {formatDate(audit.createdAt)}</Text>
      <Text className="mt-1 text-[11px] text-[#D7A948]" style={{ textAlign: "right" }}>الحقول: {fields.join("، ") || "تعديل ملف"}</Text>
    </View>
  );
}

function auditFieldLabel(key: string) {
  const labels: Record<string, string> = { name: "الاسم الكامل", givenName: "الاسم", fatherName: "اسم الأب", phoneNumber: "الهاتف", phoneVerifiedAt: "حالة التوثيق" };
  return labels[key] ?? "حقل ملف";
}

function requestStatusLabel(status: Request["status"]) {
  const labels: Record<Request["status"], string> = { pending: "قيد المراجعة", approved: "مقبول", rejected: "مرفوض", cancelled: "ملغي" };
  return labels[status];
}

function formatDate(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "تاريخ غير متوفر" : date.toLocaleString("ar-EG");
}
