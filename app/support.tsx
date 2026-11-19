import { KeyboardAwareScrollView as ScrollView } from "@/components/KeyboardAwareScrollView";
import { useState } from "react";
import * as ImagePicker from "expo-image-picker";
import { ActivityIndicator, Image, Modal, Pressable, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, usePathname, useRouter } from "expo-router";
import { ActionButton, Card, Screen } from "@/components/atheer-ui";
import { trpc } from "@/lib/trpc";
import { compressImageForUpload, type CompressedImage } from "@/lib/image-compression";
import { ACTIVE_SUPPORT_CATEGORIES, SUPPORT_CATEGORY_LABELS, type ActiveSupportCategory } from "@/shared/support-categories";

export default function SupportScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useLocalSearchParams<{ externalRequest?: string; category?: string }>();
  const isFrozenSupport = pathname === "/frozen-support";
  const requestedCategory = Array.isArray(params.category) ? params.category[0] : params.category;
  const initialCategory: ActiveSupportCategory = requestedCategory === "external_transaction" ? "external_transaction" : "account";
  const [categorySelection, setCategorySelection] = useState({ routeCategory: initialCategory, selectedCategory: initialCategory });
  const category = categorySelection.routeCategory === initialCategory ? categorySelection.selectedCategory : initialCategory;
  const selectCategory = (selectedCategory: ActiveSupportCategory) => setCategorySelection({ routeCategory: initialCategory, selectedCategory });
  const messages = trpc.support.mine.useQuery({ category }, {
    enabled: !isFrozenSupport,
    refetchInterval: 8000,
    refetchIntervalInBackground: false,
    retry: false,
  });
  const frozenMessages = trpc.frozenSupport.mine.useQuery(undefined, {
    enabled: isFrozenSupport,
    refetchInterval: 8000,
    refetchIntervalInBackground: false,
    retry: false,
  });
  const send = trpc.support.send.useMutation();
  const frozenSend = trpc.frozenSupport.send.useMutation();
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState<CompressedImage[]>([]);
  const [viewerUri, setViewerUri] = useState<string | null>(null);
  const [error, setError] = useState("");
  const activeMessages = isFrozenSupport ? frozenMessages : messages;
  const isSending = isFrozenSupport ? frozenSend.isPending : send.isPending;

  const pickImage = async () => {
    setError("");
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError("اسمح بالوصول إلى الصور لإرفاق صورة للدعم.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: false,
      allowsMultipleSelection: true,
      selectionLimit: 4,
      base64: false,
      quality: 0.75,
    });
    if (result.canceled || !result.assets?.length) return;
    try {
      const remaining = 4 - attachments.length;
      if (remaining <= 0) { setError("يمكن إرفاق أربع صور كحد أقصى في الرسالة الواحدة."); return; }
      if (result.assets.length > remaining) { setError(`يمكنك إضافة ${remaining} صورة أخرى فقط.`); return; }
      const prepared: CompressedImage[] = [];
      for (const asset of result.assets) prepared.push(await compressImageForUpload(asset));
      const totalBytes = [...attachments, ...prepared].reduce((sum, item) => sum + item.size, 0);
      if (totalBytes > 5 * 1024 * 1024) { setError("إجمالي حجم الصور أكبر من المسموح. احذف صورة أو اختر صورًا أصغر."); return; }
      setAttachments((current) => [...current, ...prepared]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "تعذر تجهيز الصورة.");
    }
  };

  const submit = async () => {
    setError("");
    if (!body.trim() && !attachments.length) {
      setError("اكتب رسالتك أو أرفق صورة.");
      return;
    }
    const payload = {
      body: body.trim(),
      attachments: attachments.map(({ data, mimeType }) => ({ data, mimeType })),
    };
    try {
      if (isFrozenSupport) await frozenSend.mutateAsync(payload);
      else await send.mutateAsync({ ...payload, category });
      setBody("");
      setAttachments([]);
      await activeMessages.refetch();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "تعذر إرسال الرسالة.");
    }
  };

  return (
    <Screen
      title={isFrozenSupport ? "دعم الحساب المجمد" : "المراسلة والدعم"}
      subtitle={isFrozenSupport ? "تواصل مع الإدارة مباشرة دون تسجيل الدخول من جديد" : "تواصل مباشرة مع الإدارة واحفظ المحادثة داخل حسابك"}
    >
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ paddingBottom: 120 }}>
        <Card>
          <Text className="text-sm leading-6 text-[#9BA8B8]" style={{ textAlign: "right" }}>
            {isFrozenSupport
              ? "هذه القناة مرتبطة بحسابك المجمد. يمكنك إرسال الرسائل والصور واستقبال رد الإدارة، بينما تظل الخدمات المالية مغلقة حتى إعادة التفعيل."
              : "اختر موضوع المحادثة المناسب؛ تبقى رسائل كل موضوع منفصلة عن طلبات التجميد والتحويلات الخارجية."}
          </Text>
        </Card>

        {!isFrozenSupport ? <Card className="mt-4">
          <Text className="mb-3 text-right text-sm font-bold text-[#F7F1E3]">اختر موضوع المحادثة</Text>
          <View className="flex-row flex-wrap justify-end gap-2">
            {ACTIVE_SUPPORT_CATEGORIES.map((item) => {
              const selected = category === item;
              return <Pressable key={item} accessibilityRole="button" accessibilityState={{ selected }} onPress={() => {
                selectCategory(item);
                setError("");
                setAttachments([]);
              }} className={`rounded-2xl border px-3 py-2.5 ${selected ? "border-[#D7A948] bg-[#D7A94822]" : "border-[#273548] bg-[#0B1018]"}`}>
                <Text className={`text-xs font-bold ${selected ? "text-[#D7A948]" : "text-[#9BA8B8]"}`}>{SUPPORT_CATEGORY_LABELS[item]}</Text>
              </Pressable>;
            })}
          </View>
        </Card> : null}

        {activeMessages.isLoading ? (
          <ActivityIndicator className="mt-5" color="#D7A948" />
        ) : activeMessages.isError ? (
          <Card className="mt-4">
            <Text className="text-sm text-[#FF7D8D]" style={{ textAlign: "right" }}>
              تعذر تحميل المحادثة. تحقق من الاتصال ثم أعد المحاولة.
            </Text>
            <View className="mt-3">
              <ActionButton label="إعادة المحاولة" icon="refresh-outline" onPress={() => void activeMessages.refetch()} />
            </View>
          </Card>
        ) : (
          <View className="mt-4 gap-3">
            {activeMessages.data?.length === 200 ? <Text className="text-xs text-[#9BA8B8]" style={{ textAlign: "right" }}>تُعرض أحدث 200 رسالة. قد توجد رسائل أقدم لا يمكن تحميلها حاليًا.</Text> : null}
            {activeMessages.data?.length ? (
              activeMessages.data.map((item) => {
                const photos = item.attachments?.length ? item.attachments : item.attachment ? [item.attachment] : [];
                return <View
                  key={item.id}
                  className={`max-w-[92%] rounded-3xl border p-4 ${item.senderRole === "user" ? "self-start border-[#273548] bg-[#121B28]" : "self-end border-[#5C4A28] bg-[#171D27]"}`}
                >
                  <Text className="text-[10px] text-[#9BA8B8]">
                    {item.senderRole === "user" ? "أنت" : "الإدارة"} · {new Date(item.createdAt).toLocaleString("ar-EG")}
                  </Text>
                  <Text className="mt-2 text-sm leading-6 text-[#F7F1E3]" style={{ textAlign: "right" }}>{item.body}</Text>
                  {photos.length ? <View className="mt-2 flex-row flex-wrap justify-end gap-2">{photos.map((photo, index) => {
                    const uri = `data:${photo.mimeType};base64,${photo.data}`;
                    return <Pressable key={`${item.id}-photo-${index}`} accessibilityRole="button" accessibilityLabel={`تكبير الصورة ${index + 1}`} onPress={() => setViewerUri(uri)}>
                      <Image source={{ uri }} resizeMode="cover" style={{ width: 92, height: 76, borderRadius: 12, backgroundColor: "#0B1018" }} />
                    </Pressable>;
                  })}</View> : null}
                  <Text className="mt-2 text-[10px] text-[#657286]" style={{ textAlign: item.senderRole === "user" ? "left" : "right" }}>{item.readAt ? "تمت القراءة" : "تم الإرسال"}</Text>
                </View>;
              })
            ) : (
              <Card>
                <Text className="text-sm text-[#9BA8B8]" style={{ textAlign: "right" }}>
                  لا توجد رسائل في {isFrozenSupport ? "دعم الحساب المجمد" : SUPPORT_CATEGORY_LABELS[category]} بعد.
                </Text>
              </Card>
            )}
            {params.externalRequest === "sent" ? (
              <Card className="border-[#5C4A28] bg-[#171D27]">
                <Text className="text-sm font-bold leading-6 text-[#47D7A5]" style={{ textAlign: "right" }}>
                  تم إرسال طلبك إلى الإدارة بنجاح. يرجى الانتظار حتى تتواصل معك الإدارة لاستكمال إجراءات التحويل.
                </Text>
              </Card>
            ) : null}
          </View>
        )}

        <Card className="mt-4 border-[#5C4A28]">
          <TextInput
            value={body}
            onChangeText={setBody}
            multiline
            maxLength={2000}
            placeholder="اكتب رسالتك للإدارة..."
            placeholderTextColor="#657286"
            textAlign="right"
            textAlignVertical="top"
            className="min-h-28 rounded-2xl border border-[#273548] bg-[#0B1018] px-4 py-3 text-[#F7F1E3]"
          />
          {attachments.length ? <View className="mt-3 flex-row flex-wrap justify-end gap-2">{attachments.map((item, index) => <View key={`${item.uri}-${index}`} className="items-center gap-1">
            <Pressable accessibilityRole="button" accessibilityLabel={`معاينة الصورة ${index + 1}`} onPress={() => setViewerUri(item.uri)}><Image source={{ uri: item.uri }} style={{ width: 78, height: 62, borderRadius: 10 }} /></Pressable>
            <Pressable accessibilityRole="button" onPress={() => setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Text className="text-[10px] font-bold text-[#FF7D8D]">حذف</Text></Pressable>
          </View>)}</View> : null}
          {error ? <Text className="mt-3 text-sm text-[#FF7D8D]" style={{ textAlign: "right" }}>{error}</Text> : null}
          <View className="mt-4 flex-row gap-2">
            <View className="flex-1"><ActionButton label={`إضافة صور (${attachments.length}/4)`} icon="image-outline" secondary onPress={() => void pickImage()} /></View>
            <View className="flex-1"><ActionButton label={isSending ? "جارٍ الإرسال..." : "إرسال الرسالة"} icon="send-outline" onPress={() => void submit()} /></View>
          </View>
        </Card>
        <View className="mt-4"><ActionButton label="العودة إلى حسابي" icon="arrow-back-outline" secondary onPress={() => router.back()} /></View>
      </ScrollView>
      <Modal transparent animationType="fade" visible={Boolean(viewerUri)} onRequestClose={() => setViewerUri(null)}>
        <Pressable accessibilityRole="button" accessibilityLabel="إغلاق معاينة الصورة" onPress={() => setViewerUri(null)} style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 16, backgroundColor: "rgba(0,0,0,0.92)" }}>
          {viewerUri ? <Image source={{ uri: viewerUri }} resizeMode="contain" style={{ width: "100%", height: "82%" }} /> : null}
          <Text className="mt-3 text-xs text-[#F7F1E3]">اضغط للإغلاق</Text>
        </Pressable>
      </Modal>
    </Screen>
  );
}
