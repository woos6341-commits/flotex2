import { useState } from "react";
import { ActivityIndicator, Image, Pressable, Switch, Text, TextInput, View } from "react-native";
import { ActionButton, Card, Pill } from "@/components/atheer-ui";
import { trpc } from "@/lib/trpc";

export function AccountVerificationAdmin() {
  const settings = trpc.admin.accountVerificationSettings.useQuery(undefined, { refetchOnWindowFocus: true });
  const requests = trpc.admin.accountVerificationRequests.useQuery({ status: "all" }, { refetchOnWindowFocus: true });
  const utils = trpc.useUtils();
  const [queueTab, setQueueTab] = useState<"pending" | "archive">("pending");
  const pendingRequests = requests.data?.filter((request) => request.status === "pending") ?? [];
  const archivedRequests = requests.data?.filter((request) => request.status !== "pending") ?? [];
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [profileDraftState, setProfileDraftState] = useState<{ userId: number; name: string; birthDate: string; phoneNumber: string } | null>(null);
  const [profileMessage, setProfileMessage] = useState("");
  const documents = trpc.admin.accountVerificationDocuments.useQuery({ userId: selectedUserId ?? 0 }, {
    enabled: selectedUserId !== null,
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });
  const updateSettings = trpc.admin.updateAccountVerificationSettings.useMutation({
    onSuccess: () => void utils.admin.accountVerificationSettings.invalidate(),
  });
  const review = trpc.admin.reviewAccountVerification.useMutation({
    onSuccess: async () => {
      setSelectedUserId(null);
      setRejectionReason("");
      await Promise.all([requests.refetch(), utils.admin.accountVerificationDocuments.invalidate(), utils.admin.recentOperations.invalidate()]);
    },
  });
  const updateProfile = trpc.admin.updateAccountVerificationProfile.useMutation({
    onSuccess: async (saved) => {
      setProfileDraftState({ userId: saved.userId, name: saved.name, birthDate: saved.birthDate, phoneNumber: saved.phoneNumber });
      setProfileMessage("تم حفظ بيانات العميل ولقطات طلب التوثيق.");
      await Promise.all([requests.refetch(), utils.admin.accountVerificationDocuments.invalidate({ userId: saved.userId })]);
    },
  });
  const activeRequest = requests.data?.find((request) => request.userId === selectedUserId);
  const profileDraft = activeRequest && profileDraftState?.userId === activeRequest.userId
    ? profileDraftState
    : { userId: activeRequest?.userId ?? 0, name: activeRequest?.name ?? "", birthDate: activeRequest?.birthDate ?? "", phoneNumber: activeRequest?.phoneNumber ?? "" };
  const changeProfileDraft = (field: "name" | "birthDate" | "phoneNumber", value: string) => {
    if (!activeRequest) return;
    setProfileDraftState((current) => ({ ...profileDraft, userId: activeRequest.userId, [field]: value }));
    setProfileMessage("");
  };

  const profileHasChanges = Boolean(activeRequest && (profileDraft.name.trim() !== activeRequest.name || profileDraft.birthDate !== activeRequest.birthDate || profileDraft.phoneNumber.trim() !== activeRequest.phoneNumber));

  const decide = (decision: "approve" | "reject") => {
    if (!selectedUserId || review.isPending) return;
    if (decision === "reject" && rejectionReason.trim().length < 3) return;
    if (decision === "approve" && profileHasChanges) { setProfileMessage("احفظ تعديلات الاسم والميلاد والهاتف قبل اعتماد الطلب."); return; }
    review.mutate({ userId: selectedUserId, decision, ...(decision === "reject" ? { rejectionReason: rejectionReason.trim() } : {}) });
  };

  const selectRequest = (request: NonNullable<typeof requests.data>[number]) => {
    setSelectedUserId(request.userId);
    setRejectionReason("");
    setProfileMessage("");
    setProfileDraftState({ userId: request.userId, name: request.name, birthDate: request.birthDate, phoneNumber: request.phoneNumber });
  };

  return (
    <View className="gap-4">
      <Card className="border-[#5C4A28]">
        <View className="flex-row items-center justify-between gap-3">
          <Switch
            value={settings.data?.requiredBeforeMoney ?? false}
            onValueChange={(requiredBeforeMoney) => updateSettings.mutate({ requiredBeforeMoney })}
            disabled={!settings.data || updateSettings.isPending}
            trackColor={{ false: "#273548", true: "#47D7A566" }}
            thumbColor={settings.data?.requiredBeforeMoney ? "#47D7A5" : "#9BA8B8"}
          />
          <View className="flex-1">
            <Text className="text-base font-bold text-[#F7F1E3]" style={{ textAlign: "right" }}>إلزام التوثيق قبل الإيداع والسحب</Text>
            <Text className="mt-1 text-xs leading-5 text-[#9BA8B8]" style={{ textAlign: "right" }}>عند التفعيل يمنع الخادم الطلبات المالية حتى اعتماد الحساب. الإعداد متوقف افتراضيًا.</Text>
          </View>
        </View>
        {settings.isLoading ? <ActivityIndicator className="mt-3" color="#D7A948" /> : null}
        {settings.isError || updateSettings.isError ? <Text className="mt-3 text-xs text-[#FF7D8D]" style={{ textAlign: "right" }}>{updateSettings.error?.message ?? "تعذر تحميل إعداد التوثيق."}</Text> : null}
      </Card>

      <Card>
        <View className="flex-row items-center justify-between"><Pill>{queueTab === "pending" ? pendingRequests.length : archivedRequests.length} طلب</Pill><Text className="text-base font-bold text-[#F7F1E3]">{queueTab === "pending" ? "طلبات توثيق الحساب قيد المراجعة" : "أرشيف توثيق الحساب"}</Text></View>
        <View className="mt-3 flex-row gap-2">{([ ["pending", "قيد المراجعة"], ["archive", "الأرشيف"] ] as const).map(([key, label]) => <Pressable key={key} onPress={() => { setQueueTab(key); setSelectedUserId(null); }} className={`flex-1 items-center rounded-xl border py-2 ${queueTab === key ? "border-[#D7A948] bg-[#D7A94818]" : "border-[#273548] bg-[#0B1018]"}`}><Text className={`text-xs font-bold ${queueTab === key ? "text-[#D7A948]" : "text-[#9BA8B8]"}`}>{label}</Text></Pressable>)}</View>
        {requests.isLoading ? <ActivityIndicator className="mt-5" color="#D7A948" /> : null}
        {requests.isError ? <Text className="mt-4 text-sm text-[#FF7D8D]" style={{ textAlign: "right" }}>تعذر تحميل طلبات التوثيق.</Text> : null}
        {!requests.isLoading && !(queueTab === "pending" ? pendingRequests : archivedRequests).length ? <Text className="mt-4 text-sm leading-6 text-[#9BA8B8]" style={{ textAlign: "right" }}>{queueTab === "pending" ? "لا توجد طلبات توثيق معلقة." : "لا توجد قرارات محفوظة في الأرشيف."}</Text> : null}
        <View className="mt-3 gap-2">
          {(queueTab === "pending" ? pendingRequests : archivedRequests).map((request) => {
            const selected = selectedUserId === request.userId;
            const tone = request.status === "approved" ? "green" : request.status === "rejected" ? "red" : "gold";
            const label = request.status === "approved" ? "معتمد" : request.status === "rejected" ? "مرفوض" : "قيد المراجعة";
            return (
              <Pressable key={request.id} onPress={() => { if (selected) { setSelectedUserId(null); setProfileMessage(""); } else selectRequest(request); }} style={{ borderWidth: 1, borderColor: selected ? "#D7A948" : "#273548", borderRadius: 16, padding: 12, backgroundColor: "#0B1018" }}>
                <View className="flex-row items-center justify-between"><Pill tone={tone}>{label}</Pill><Text className="font-bold text-[#F7F1E3]" style={{ textAlign: "right" }}>{request.name || "عميل"}</Text></View>
                <Text className="mt-2 text-xs leading-5 text-[#9BA8B8]" style={{ textAlign: "right" }}>رقم العميل: {request.customerId || "—"} · الهاتف: {request.phoneNumber} · الميلاد: {request.birthDate}</Text>
                <Text className="mt-1 text-[11px] text-[#657286]" style={{ textAlign: "right" }}>{request.email || "لا يوجد بريد"} · آخر 4 أرقام قومية: {request.nationalIdLast4}</Text>
                {request.reviewedAt ? <Text className="mt-1 text-[10px] text-[#657286]" style={{ textAlign: "right" }}>تاريخ القرار: {new Date(request.reviewedAt).toLocaleString("ar-EG")}</Text> : null}
              </Pressable>
            );
          })}
        </View>
      </Card>

      {selectedUserId !== null ? <Card className="border-[#5C4A28]">
        <View className="flex-row items-center justify-between"><Pressable accessibilityRole="button" onPress={() => { setSelectedUserId(null); setRejectionReason(""); }}><Text className="text-xs text-[#D7A948]">إغلاق</Text></Pressable><Text className="text-base font-bold text-[#F7F1E3]">مراجعة مستندات العميل</Text></View>
        {activeRequest ? <View className="mt-3"><Info label="الاسم" value={activeRequest.name} /><Info label="الهاتف" value={activeRequest.phoneNumber} /><Info label="تاريخ الميلاد" value={activeRequest.birthDate} /><Info label="البريد" value={activeRequest.email || "—"} /><Info label="رقم العميل" value={activeRequest.customerId || "—"} /></View> : null}
        <Text className="mt-4 text-xs leading-5 text-[#C7B98D]" style={{ textAlign: "right" }}>طابق صورة السيلفي مع وجه البطاقة، وتحقق من وضوح البيانات، واسم ورقم الهاتف الظاهرين في الملف الشخصي داخل المحفظة الإلكترونية. ارفض الصور غير الواضحة.</Text>
        {documents.data?.status === "pending" ? <View className="mt-4 rounded-2xl border border-[#273548] bg-[#0B1018] p-3">
          <Text className="text-sm font-bold text-[#F7F1E3]" style={{ textAlign: "right" }}>تصحيح بيانات العميل خلال المراجعة اليدوية</Text>
          <AdminProfileField label="الاسم بالكامل" value={profileDraft.name} onChangeText={(name) => changeProfileDraft("name", name)} placeholder="اسم صاحب الحساب" />
          <AdminProfileField label="تاريخ الميلاد (YYYY-MM-DD)" value={profileDraft.birthDate} onChangeText={(birthDate) => changeProfileDraft("birthDate", birthDate)} placeholder="1990-01-31" keyboardType="numbers-and-punctuation" />
          <AdminProfileField label="رقم الهاتف" value={profileDraft.phoneNumber} onChangeText={(phoneNumber) => changeProfileDraft("phoneNumber", phoneNumber)} placeholder="01xxxxxxxxx" keyboardType="phone-pad" />
          {profileMessage ? <Text className="mt-2 text-xs text-[#D7A948]" style={{ textAlign: "right" }}>{profileMessage}</Text> : null}
          {updateProfile.isError ? <Text className="mt-2 text-xs text-[#FF7D8D]" style={{ textAlign: "right" }}>{updateProfile.error.message}</Text> : null}
          <View className="mt-3"><ActionButton label={updateProfile.isPending ? "جارٍ حفظ التعديلات..." : "حفظ تعديلات البيانات"} icon="save-outline" secondary onPress={() => {
            if (!selectedUserId || updateProfile.isPending) return;
            setProfileMessage("");
            updateProfile.mutate({ userId: selectedUserId, name: profileDraft.name.trim(), birthDate: profileDraft.birthDate.trim(), phoneNumber: profileDraft.phoneNumber.trim() });
          }} /></View>
        </View> : null}
        {documents.isLoading ? <ActivityIndicator className="mt-5" color="#D7A948" /> : null}
        {documents.isError ? <Text className="mt-4 text-sm text-[#FF7D8D]" style={{ textAlign: "right" }}>تعذر تحميل المستندات الخاصة؛ أعد فتح الطلب.</Text> : null}
        {documents.data ? <>
          <SecurePhoto label="الرقم القومي — الأمام" uri={documents.data.documents.idFront} />
          <SecurePhoto label="الرقم القومي — الخلف" uri={documents.data.documents.idBack} />
          <SecurePhoto label="سيلفي الكاميرا الأمامية" uri={documents.data.documents.selfie} />
          <SecurePhoto label="ملف المحفظة الإلكترونية (اسم ورقم الهاتف)" uri={documents.data.documents.walletProfile} />
          {documents.data.status === "pending" ? <>
            <TextInput
              accessibilityLabel="سبب رفض التوثيق"
              value={rejectionReason}
              onChangeText={setRejectionReason}
              placeholder="سبب الرفض (إلزامي عند الرفض)"
              placeholderTextColor="#657286"
              multiline
              maxLength={500}
              textAlign="right"
              style={{ minHeight: 72, marginTop: 16, borderRadius: 14, borderWidth: 1, borderColor: "#273548", backgroundColor: "#0B1018", color: "#F7F1E3", padding: 12 }}
            />
            {review.isError ? <Text className="mt-2 text-xs text-[#FF7D8D]" style={{ textAlign: "right" }}>{review.error.message}</Text> : null}
            <View className="mt-4 flex-row gap-2">
              <View className="flex-1"><ActionButton label={review.isPending ? "جارٍ الحفظ..." : "اعتماد التوثيق"} icon="checkmark-circle-outline" onPress={() => decide("approve")} /></View>
              <View className="flex-1"><ActionButton label="رفض مع السبب" icon="close-circle-outline" secondary onPress={() => decide("reject")} /></View>
            </View>
            {rejectionReason.trim().length < 3 ? <Text className="mt-2 text-[11px] text-[#657286]" style={{ textAlign: "right" }}>اكتب سببًا من 3 أحرف على الأقل قبل الرفض.</Text> : null}
          </> : <Text className="mt-4 text-xs text-[#9BA8B8]" style={{ textAlign: "right" }}>تمت مراجعة هذا الطلب بالفعل؛ يلزم طلب جديد من المستخدم بعد الرفض.</Text>}
        </> : null}
      </Card> : null}
    </View>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return <View className="mt-2 flex-row justify-between border-b border-[#273548] pb-2"><Text className="text-sm font-bold text-[#F7F1E3]">{value}</Text><Text className="text-xs text-[#9BA8B8]">{label}</Text></View>;
}

function AdminProfileField({ label, value, onChangeText, placeholder, keyboardType = "default" }: { label: string; value: string; onChangeText: (value: string) => void; placeholder: string; keyboardType?: "default" | "numbers-and-punctuation" | "phone-pad" }) {
  return <View className="mt-3"><Text className="mb-2 text-xs font-semibold text-[#9BA8B8]" style={{ textAlign: "right" }}>{label}</Text><TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor="#657286" keyboardType={keyboardType} maxLength={keyboardType === "phone-pad" ? 20 : 120} textAlign="right" style={{ minHeight: 46, borderWidth: 1, borderColor: "#273548", borderRadius: 14, backgroundColor: "#121B28", color: "#F7F1E3", paddingHorizontal: 12 }} /></View>;
}

function SecurePhoto({ label, uri }: { label: string; uri: string }) {
  return <View className="mt-4 rounded-2xl border border-[#273548] bg-[#0B1018] p-3"><Text className="mb-2 text-xs font-bold text-[#F7F1E3]" style={{ textAlign: "right" }}>{label}</Text><Image source={{ uri }} resizeMode="contain" style={{ width: "100%", height: 220, borderRadius: 10, backgroundColor: "#121B28" }} /></View>;
}
