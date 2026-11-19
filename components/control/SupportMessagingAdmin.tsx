import { useState } from "react";
import { ActivityIndicator, Image, Modal, Pressable, Text, TextInput, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { ActionButton, Card, Pill } from "@/components/atheer-ui";
import { compressImageForUpload, type CompressedImage } from "@/lib/image-compression";
import type { GuestAttachment } from "@/lib/guest-support-client";
import { trpc } from "@/lib/trpc";
import { SUPPORT_CATEGORIES, SUPPORT_CATEGORY_LABELS, type SupportCategory } from "@/shared/support-categories";

type AdminAttachment = CompressedImage & GuestAttachment;
const dateLabel = (value: string | Date) => new Date(value).toLocaleString("ar-EG");

export function SupportMessagingAdmin({
  initialUserId = null,
  initialCategory = "account",
  onOpenGuest,
}: { initialUserId?: number | null; initialCategory?: SupportCategory; onOpenGuest?: (ticketId?: number) => void }) {
  const selectionKey = `${initialCategory}:${initialUserId ?? "none"}`;
  const [selection, setSelection] = useState({ key: selectionKey, category: initialCategory, userId: initialUserId, guestId: null as number | null });
  const effectiveSelection = selection.key === selectionKey ? selection : { key: selectionKey, category: initialCategory, userId: initialUserId, guestId: null };
  const category = effectiveSelection.category;
  const selectedUserId = effectiveSelection.userId;
  const updateSelection = (patch: Partial<typeof effectiveSelection>) => setSelection((current) => {
    const base = current.key === selectionKey ? current : { key: selectionKey, category: initialCategory, userId: initialUserId, guestId: null };
    return { ...base, ...patch, key: selectionKey };
  });
  const setCategory = (next: SupportCategory) => updateSelection({ category: next, userId: null, guestId: null });
  const setSelectedUserId = (userId: number | null) => updateSelection({ userId, guestId: null });
  const setSelectedGuestId = (guestId: number | null) => updateSelection({ guestId, userId: null });
  const [reply, setReply] = useState("");
  const [userAttachments, setUserAttachments] = useState<AdminAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState("");
  const [viewerUri, setViewerUri] = useState<string | null>(null);

  const conversations = trpc.admin.supportConversations.useQuery({ category }, {
    refetchInterval: 8000,
    refetchIntervalInBackground: false,
  });
  const messages = trpc.admin.supportMessages.useQuery(
    { userId: selectedUserId ?? 0, category },
    { enabled: selectedUserId !== null, refetchInterval: 5000, refetchIntervalInBackground: false },
  );
  const guestTickets = trpc.admin.guestSupportTickets.useQuery(undefined, {
    refetchInterval: 8000,
    refetchIntervalInBackground: false,
  });
  const send = trpc.admin.replySupport.useMutation({
    onSuccess: async () => {
      setReply("");
      setUserAttachments([]);
      await Promise.all([messages.refetch(), conversations.refetch()]);
    },
  });
  const closeConversation = trpc.admin.closeSupportConversation.useMutation({
    onSuccess: async () => { await conversations.refetch(); },
  });
  const selected = conversations.data?.find((item) => item.user.id === selectedUserId);

  const pickImage = async () => {
    setAttachmentError("");
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setAttachmentError("اسمح بالوصول إلى الصور لإرفاقها في الرد.");
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
      const available = 4 - userAttachments.length;
      if (result.assets.length > available) { setAttachmentError(`يمكنك إضافة ${available} صورة فقط.`); return; }
      const images: AdminAttachment[] = [];
      for (const asset of result.assets) images.push(await compressImageForUpload(asset));
      {
        if ([...userAttachments, ...images].reduce((sum, item) => sum + item.size, 0) > 5 * 1024 * 1024) {
          setAttachmentError("إجمالي حجم الصور أكبر من المسموح.");
          return;
        }
        setUserAttachments((current) => [...current, ...images]);
      }
    } catch (reason) {
      setAttachmentError(reason instanceof Error ? reason.message : "تعذر تجهيز الصورة.");
    }
  };

  return <View className="gap-4">
    <Card className="border-[#5C4A28]">
      <Text className="text-sm leading-6 text-[#9BA8B8]" style={{ textAlign: "right" }}>
        لكل مستخدم محادثة مستقلة حسب الموضوع: الحساب، تجميد الحساب، أو المعاملة الخارجية. يظهر آخر رد وحالة المتابعة والرسائل غير المقروءة قبل فتح المحادثة. مراسلات الزوار تبقى في قسم مستقل.
      </Text>
    </Card>

    <Card>
      <View className="mb-3 flex-row items-center justify-between">
        <Pill tone="muted">{conversations.data?.length ?? 0} محادثة</Pill>
        <Text className="text-base font-bold text-[#F7F1E3]" style={{ textAlign: "right" }}>صندوق المراسلات</Text>
      </View>
      <View className="mb-3 flex-row flex-wrap justify-end gap-2">
        {SUPPORT_CATEGORIES.map((item) => {
          const active = item === category;
          return <Pressable key={item} accessibilityRole="button" accessibilityState={{ selected: active }} onPress={() => {
            setCategory(item);
            setSelectedUserId(null);
            setSelectedGuestId(null);
            setReply("");
            setUserAttachments([]);
            setAttachmentError("");
          }} className={`rounded-2xl border px-3 py-2.5 ${active ? "border-[#D7A948] bg-[#D7A94822]" : "border-[#273548] bg-[#0B1018]"}`}>
            <Text className={`text-xs font-bold ${active ? "text-[#D7A948]" : "text-[#9BA8B8]"}`}>{SUPPORT_CATEGORY_LABELS[item]}</Text>
          </Pressable>;
        })}
      </View>
      {conversations.isLoading ? <ActivityIndicator color="#D7A948" /> : conversations.isError ? (
        <View>
          <Text className="text-sm text-[#FF9BA7]" style={{ textAlign: "right" }}>تعذر تحميل محادثات هذا القسم.</Text>
          <View className="mt-3"><ActionButton label="إعادة المحاولة" icon="refresh-outline" secondary onPress={() => void conversations.refetch()} /></View>
        </View>
      ) : conversations.data?.length ? conversations.data.map((item) => {
        const active = selectedUserId === item.user.id;
        const waiting = item.lastMessage.senderRole === "user";
        return <Pressable key={`${item.user.id}:${item.category}`} onPress={() => {
          setSelectedUserId(item.user.id);
          setSelectedGuestId(null);
          setReply("");
          setUserAttachments([]);
          setAttachmentError("");
        }} className={`mb-2 rounded-2xl border p-3 ${active ? "border-[#D7A948] bg-[#D7A94818]" : "border-[#273548] bg-[#0B1018]"}`}>
          <View className="flex-row items-center justify-between gap-2">
            <Pill tone={item.threadStatus === "closed" ? "muted" : item.user.status === "deleted" ? "red" : item.unread ? "gold" : waiting ? "muted" : "green"}>
              {item.threadStatus === "closed" ? "مؤرشفة" : item.user.status === "deleted" ? "حساب موقوف" : item.unread ? `${item.unread} جديد` : waiting ? "بانتظار رد الإدارة" : "تم الرد"}
            </Pill>
            <View className="flex-1">
              <Text className="text-sm font-bold text-[#F7F1E3]" style={{ textAlign: "right" }}>{item.user.name || "مستخدم بلا اسم"}</Text>
              <Text className="mt-1 text-xs text-[#9BA8B8]" style={{ textAlign: "right" }}>الحساب {item.user.customerId} · {item.user.phoneNumber || "بدون هاتف"}</Text>
            </View>
          </View>
          <Text numberOfLines={1} className="mt-2 text-xs text-[#D6C79E]" style={{ textAlign: "right" }}>{item.lastMessage.body}</Text>
          <Text className="mt-1 text-[10px] text-[#657286]" style={{ textAlign: "right" }}>آخر رسالة: {dateLabel(item.lastMessage.createdAt)}{item.threadStatus === "closed" ? ` · أغلقت ${item.closedAt ? dateLabel(item.closedAt) : ""} بواسطة ${item.closedByName || "موظف الإدارة"}` : ""}</Text>
        </Pressable>;
      }) : <Text className="text-sm text-[#9BA8B8]" style={{ textAlign: "right" }}>لا توجد محادثات في قسم {SUPPORT_CATEGORY_LABELS[category]} حتى الآن.</Text>}
    </Card>

    {selectedUserId !== null ? <Card>
      <View className="flex-row items-center justify-between gap-2">
        <Pill tone={selected?.threadStatus === "closed" ? "muted" : selected?.user.status === "deleted" ? "red" : "green"}>{selected?.threadStatus === "closed" ? "مؤرشفة" : selected?.user.status === "deleted" ? "حساب موقوف" : "حساب نشط"}</Pill>
        <View className="flex-1">
          <Text className="text-base font-bold text-[#F7F1E3]" style={{ textAlign: "right" }}>محادثة {selected?.user.name || "المستخدم"}</Text>
          <Text className="mt-1 text-xs text-[#9BA8B8]" style={{ textAlign: "right" }}>الحساب {selected?.user.customerId || "—"} · {SUPPORT_CATEGORY_LABELS[category]}</Text>
        </View>
      </View>
      {selected?.threadStatus === "closed" ? <Text className="mt-2 text-xs text-[#9BA8B8]" style={{ textAlign: "right" }}>تاريخ الأرشفة: {selected.closedAt ? dateLabel(selected.closedAt) : "—"} · الموظف: {selected.closedByName || "موظف الإدارة"}</Text> : null}
      <View className="mt-4 gap-2">
        {!messages.isError && messages.data?.length === 200 ? <Text className="text-xs text-[#9BA8B8]" style={{ textAlign: "right" }}>تُعرض أحدث 200 رسالة. قد توجد رسائل أقدم لا يمكن تحميلها حاليًا.</Text> : null}
        {messages.isLoading ? <ActivityIndicator color="#D7A948" /> : messages.isError ? (
          <Text className="text-sm text-[#FF9BA7]" style={{ textAlign: "right" }}>تعذر تحميل الرسائل؛ أعد فتح المحادثة بعد التحقق من الاتصال.</Text>
        ) : messages.data?.length ? messages.data.map((item) => {
          const photos = item.attachments?.length ? item.attachments : item.attachment ? [item.attachment] : [];
          return <View key={item.id} className={`rounded-2xl p-3 ${item.senderRole === "admin" ? "self-end bg-[#5C4A2833]" : "self-start bg-[#0B1018]"}`}>
            <Text className="text-xs text-[#9BA8B8]">{item.senderRole === "admin" ? "الإدارة" : "المستخدم"} · {dateLabel(item.createdAt)}</Text>
            <Text className="mt-1 text-sm leading-6 text-[#F7F1E3]" style={{ textAlign: "right" }}>{item.body}</Text>
            {photos.length ? <View className="mt-2 flex-row flex-wrap justify-end gap-2">{photos.map((photo, index) => {
              const uri = `data:${photo.mimeType};base64,${photo.data}`;
              return <Pressable key={`${item.id}-photo-${index}`} accessibilityRole="button" accessibilityLabel={`تكبير الصورة ${index + 1}`} onPress={() => setViewerUri(uri)}><Image source={{ uri }} resizeMode="cover" style={{ width: 92, height: 76, borderRadius: 12, backgroundColor: "#0B1018" }} /></Pressable>;
            })}</View> : null}
            <Text className="mt-2 text-[10px] text-[#657286]" style={{ textAlign: item.senderRole === "admin" ? "right" : "left" }}>{item.readAt ? "تمت القراءة" : "تم الإرسال"}</Text>
          </View>;
        }) : <Text className="text-sm text-[#9BA8B8]" style={{ textAlign: "right" }}>لا توجد رسائل بعد.</Text>}
      </View>
      <TextInput value={reply} onChangeText={setReply} multiline maxLength={2000} placeholder="اكتب رد الإدارة..." placeholderTextColor="#657286" textAlign="right" textAlignVertical="top" className="mt-4 min-h-24 rounded-2xl border border-[#273548] bg-[#0B1018] px-4 py-3 text-[#F7F1E3]" />
      {userAttachments.length ? <View className="mt-3 flex-row flex-wrap justify-end gap-2">{userAttachments.map((item, index) => <View key={`${item.uri}-${index}`} className="items-center gap-1"><Pressable accessibilityRole="button" onPress={() => setViewerUri(item.uri)}><Image source={{ uri: item.uri }} style={{ width: 78, height: 62, borderRadius: 10 }} /></Pressable><Pressable accessibilityRole="button" onPress={() => setUserAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Text className="text-[10px] text-[#FF9BA7]">حذف</Text></Pressable></View>)}</View> : null}
      {attachmentError ? <Text className="mt-2 text-xs text-[#FF9BA7]" style={{ textAlign: "right" }}>{attachmentError}</Text> : null}
      {send.error ? <Text className="mt-2 text-xs text-[#FF9BA7]" style={{ textAlign: "right" }}>{send.error.message}</Text> : null}
      <View className="mt-3 flex-row gap-2">
        <View className="flex-1"><ActionButton label={`إضافة صور (${userAttachments.length}/4)`} icon="image-outline" secondary onPress={() => void pickImage()} /></View>
        <View className="flex-1"><ActionButton label={send.isPending ? "جارٍ الإرسال..." : "إرسال الرد"} icon="send-outline" onPress={() => {
          if (!send.isPending && (reply.trim() || userAttachments.length)) send.mutate({ userId: selectedUserId, category, body: reply.trim(), attachments: userAttachments.map(({ data, mimeType }) => ({ data, mimeType })) });
        }} /></View>
      </View>
      {selected?.threadStatus !== "closed" ? <View className="mt-3"><ActionButton label={closeConversation.isPending ? "جارٍ الأرشفة..." : "إغلاق المحادثة وأرشفتها"} icon="archive-outline" secondary onPress={() => { if (!closeConversation.isPending) closeConversation.mutate({ userId: selectedUserId, category }); }} /></View> : null}
      {closeConversation.error ? <Text className="mt-2 text-xs text-[#FF9BA7]" style={{ textAlign: "right" }}>{closeConversation.error.message}</Text> : null}
    </Card> : null}

    <Card>
      <View className="mb-2 flex-row items-center justify-between"><Pill tone="muted">{guestTickets.data?.length ?? 0}</Pill><Text className="text-base font-bold text-[#F7F1E3]" style={{ textAlign: "right" }}>مراسلات الزوار</Text></View>
      <Text className="mb-3 text-sm leading-6 text-[#9BA8B8]" style={{ textAlign: "right" }}>هذا صندوق مستقل لمحادثات مستخدم غير مسجل الدخول، مع إمكانية الرد والصور وإغلاق التذكرة.</Text>
      <View className="mb-3"><ActionButton label="فتح صندوق مراسلات الزوار" icon="chatbubble-ellipses-outline" secondary onPress={() => onOpenGuest?.()} /></View>
      {guestTickets.isLoading ? <ActivityIndicator color="#D7A948" /> : guestTickets.data?.length ? guestTickets.data.map((item) => <Pressable key={item.ticket.id} onPress={() => onOpenGuest?.(item.ticket.id)} className={`mb-2 rounded-2xl border p-3 ${"border-[#273548] bg-[#0B1018]"}`}>
        <View className="flex-row items-center justify-between gap-2"><Pill tone={item.ticket.status === "closed" ? "red" : item.unread ? "gold" : "muted"}>{item.ticket.status === "closed" ? "مغلقة" : item.unread ? `${item.unread} جديد` : "متابعة"}</Pill><View className="flex-1"><Text className="text-sm font-bold text-[#F7F1E3]" style={{ textAlign: "right" }}>{item.ticket.displayName || "زائر"}</Text><Text className="mt-1 text-xs text-[#9BA8B8]" style={{ textAlign: "right" }}>{item.ticket.ticketCode} · {item.ticket.contactEmail || item.ticket.contactPhone || "محادثة مباشرة"}</Text></View></View>
        <Text numberOfLines={1} className="mt-2 text-xs text-[#657286]" style={{ textAlign: "right" }}>{item.lastMessage?.body || "في انتظار أول رسالة"}</Text>
      </Pressable>) : <Text className="text-sm text-[#9BA8B8]" style={{ textAlign: "right" }}>لا توجد محادثات زوار بعد.</Text>}
    </Card>

    <Modal transparent animationType="fade" visible={Boolean(viewerUri)} onRequestClose={() => setViewerUri(null)}>
      <Pressable accessibilityRole="button" accessibilityLabel="إغلاق معاينة الصورة" onPress={() => setViewerUri(null)} style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 16, backgroundColor: "rgba(0,0,0,0.92)" }}>
        {viewerUri ? <Image source={{ uri: viewerUri }} resizeMode="contain" style={{ width: "100%", height: "82%" }} /> : null}
        <Text className="mt-3 text-xs text-[#F7F1E3]">اضغط للإغلاق</Text>
      </Pressable>
    </Modal>
  </View>;
}
