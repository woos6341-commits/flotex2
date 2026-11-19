import { useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { ActionButton, Card, Pill } from "@/components/atheer-ui";
import { GuestSupportAttachmentPicker, GuestSupportAttachmentView, useGuestSupportAttachment } from "@/components/guest-support/GuestSupportAttachments";
import { GUEST_STATUS_LABELS, newGuestOperationId } from "@/lib/guest-support-client";
import { trpc } from "@/lib/trpc";

/** initialTicketId is a guest ticket id, never a user/account id. */
export function GuestSupportAdmin({ initialTicketId = null }: { initialTicketId?: number | null }) {
  const [selection, setSelection] = useState({ source: initialTicketId, ticketId: initialTicketId });
  const selectedId = selection.source === initialTicketId ? selection.ticketId : initialTicketId;
  const [body, setBody] = useState("");
  const picker = useGuestSupportAttachment();
  const pending = useRef<{ fingerprint: string; id: string } | null>(null);
  const sendLock = useRef(false);
  const tickets = trpc.admin.guestSupportTickets.useQuery(undefined, { refetchInterval: 8000, refetchIntervalInBackground: false });
  const messages = trpc.admin.guestSupportMessages.useQuery({ ticketId: selectedId ?? 0 }, { enabled: selectedId !== null && selectedId > 0, refetchInterval: 5000, refetchIntervalInBackground: false });
  const send = trpc.admin.replyGuestSupport.useMutation();
  const update = trpc.admin.updateGuestSupportStatus.useMutation();
  const selected = tickets.data?.find((item) => item.ticket.id === selectedId);
  async function sendReply() {
    if (sendLock.current || !selectedId || (!body.trim() && !picker.attachment)) return;
    const attachment = picker.attachment ? { data: picker.attachment.data, mimeType: picker.attachment.mimeType } : undefined;
    const fingerprint = JSON.stringify([selectedId, body.trim(), attachment]);
    if (!pending.current || pending.current.fingerprint !== fingerprint) pending.current = { fingerprint, id: newGuestOperationId() };
    sendLock.current = true;
    try {
      await send.mutateAsync({ ticketId: selectedId, body: body.trim(), attachment, operationId: pending.current.id });
      pending.current = null; setBody(""); picker.setAttachment(null);
      await Promise.all([messages.refetch(), tickets.refetch()]);
    } catch { /* React Query exposes the failure; keep the operation id for retry. */ }
    finally { sendLock.current = false; }
  }
  async function changeStatus(status: "pending_reply" | "closed") {
    if (!selectedId || update.isPending) return;
    try { await update.mutateAsync({ ticketId: selectedId, status }); await Promise.all([tickets.refetch(), messages.refetch()]); }
    catch { /* mutation error is displayed below */ }
  }
  return <View className="gap-4">
    <Card className="border-[#5C4A28]"><View className="flex-row items-center justify-between"><Pill tone="muted">{tickets.isError ? "العدد غير متاح" : tickets.isLoading ? "جارٍ التحميل" : `${tickets.data?.length ?? 0} محادثة`}</Pill><Text className="text-base font-bold text-[#F7F1E3]">مراسلات الزوار</Text></View><Text className="mt-2 text-sm leading-6 text-[#9BA8B8]" style={{ textAlign: "right" }}>صندوق مستقل لا يتطلب حسابًا للزائر. اضغط المحادثة لقراءة الرسائل والرد عليها أو تغيير حالتها.</Text></Card>
    <Card>
      {tickets.isLoading ? <ActivityIndicator color="#D7A948" /> : tickets.isError ? <View><Text accessibilityRole="alert" className="text-sm leading-6 text-[#FF9BA7]" style={{ textAlign: "right" }}>تعذر تحميل مراسلات الزوار؛ لا يعني ذلك عدم وجود محادثات. تحقق من اتصال قاعدة البيانات ثم أعد المحاولة.</Text><View className="mt-3"><ActionButton label={tickets.isFetching ? "جارٍ إعادة المحاولة..." : "إعادة المحاولة"} icon="refresh-outline" secondary onPress={() => { if (!tickets.isFetching) void tickets.refetch(); }} /></View></View> : tickets.data?.length ? tickets.data.map((item) => <Pressable key={item.ticket.id} accessibilityRole="button" accessibilityState={{ selected: selectedId === item.ticket.id }} onPress={() => { if (sendLock.current) return; setSelection({ source: initialTicketId, ticketId: item.ticket.id }); setBody(""); picker.setAttachment(null); picker.setAttachmentError(""); pending.current = null; send.reset(); update.reset(); }} className={`mb-2 rounded-2xl border p-3 ${selectedId === item.ticket.id ? "border-[#D7A948] bg-[#D7A94818]" : "border-[#273548] bg-[#0B1018]"}`}>
        <View className="flex-row items-center justify-between gap-2"><Pill tone={item.ticket.status === "closed" ? "red" : item.unread ? "gold" : "muted"}>{GUEST_STATUS_LABELS[item.ticket.status]}{item.unread ? ` · ${item.unread} جديد` : ""}</Pill><View className="flex-1"><Text className="text-sm font-bold text-[#F7F1E3]" style={{ textAlign: "right" }}>{item.ticket.displayName || "زائر"}</Text><Text className="mt-1 text-xs text-[#9BA8B8]" style={{ textAlign: "right" }}>{item.ticket.ticketCode}</Text></View></View>
        <Text numberOfLines={1} className="mt-2 text-xs text-[#D6C79E]" style={{ textAlign: "right" }}>{item.lastMessage?.body || "في انتظار أول رسالة"}</Text><Text className="mt-1 text-[10px] text-[#657286]" style={{ textAlign: "right" }}>{new Date(item.lastMessage?.createdAt ?? item.ticket.createdAt).toLocaleString("ar-EG")}</Text>
      </Pressable>) : <Text className="text-sm text-[#9BA8B8]" style={{ textAlign: "right" }}>لا توجد محادثات زوار بعد.</Text>}
    </Card>
    {selectedId !== null && selectedId > 0 ? <Card>
      <View className="flex-row items-center justify-between"><Pill tone={selected?.ticket.status === "closed" ? "red" : "green"}>{selected ? GUEST_STATUS_LABELS[selected.ticket.status] : "محادثة الزائر"}</Pill><View><Text className="text-base font-bold text-[#F7F1E3]" style={{ textAlign: "right" }}>{selected?.ticket.displayName || "زائر"}</Text><Text className="mt-1 text-xs text-[#9BA8B8]" style={{ textAlign: "right" }}>{selected?.ticket.ticketCode || `محادثة رقم ${selectedId}`}</Text></View></View>
      <View className="mt-4 gap-2">{messages.isLoading ? <ActivityIndicator color="#D7A948" /> : messages.isError ? <View><Text className="text-sm text-[#FF9BA7]" style={{ textAlign: "right" }}>تعذر فتح المحادثة: {messages.error.message}</Text><View className="mt-3"><ActionButton label="إعادة المحاولة" icon="refresh-outline" secondary onPress={() => void messages.refetch()} /></View></View> : messages.data?.length ? messages.data.map((item) => <View key={item.id} className={`rounded-2xl p-3 ${item.senderRole === "admin" ? "self-end bg-[#5C4A2833]" : "self-start bg-[#0B1018]"}`}><Text className="text-xs text-[#9BA8B8]">{item.senderRole === "admin" ? "الإدارة" : "الزائر"} · {new Date(item.createdAt).toLocaleString("ar-EG")}</Text><Text className="mt-1 text-sm leading-6 text-[#F7F1E3]" style={{ textAlign: "right" }}>{item.body}</Text>{item.attachment ? <GuestSupportAttachmentView attachment={item.attachment} /> : null}<Text className="mt-2 text-[10px] text-[#657286]">{item.readAt ? "تمت القراءة" : "تم الإرسال"}</Text></View>) : <Text className="text-sm text-[#9BA8B8]" style={{ textAlign: "right" }}>لا توجد رسائل بعد.</Text>}</View>
      {selected && selected.ticket.status !== "closed" ? <><TextInput value={body} onChangeText={setBody} editable={!send.isPending} multiline maxLength={2000} placeholder="اكتب رد الإدارة للزائر..." placeholderTextColor="#657286" textAlign="right" textAlignVertical="top" className="mt-4 min-h-24 rounded-2xl border border-[#273548] bg-[#0B1018] px-4 py-3 text-[#F7F1E3]" /><GuestSupportAttachmentPicker picker={picker} disabled={send.isPending} /><View className="mt-3"><ActionButton label={send.isPending ? "جارٍ الإرسال..." : "إرسال الرد"} icon="send-outline" onPress={() => void sendReply()} /></View><Text className="mt-2 text-xs text-[#9BA8B8]" style={{ textAlign: "right" }}>الرد العادي لا يغلق المحادثة.</Text></> : null}
      {send.error ? <Text className="mt-2 text-xs text-[#FF9BA7]" style={{ textAlign: "right" }}>{send.error.message}</Text> : null}
      {selected ? <View className="mt-3 flex-row gap-2">{selected.ticket.status !== "pending_reply" ? <View className="flex-1"><ActionButton label={selected.ticket.status === "closed" ? "إعادة فتح المحادثة" : "قيد المراجعة"} icon="refresh-outline" secondary onPress={() => void changeStatus("pending_reply")} /></View> : null}{selected.ticket.status !== "closed" ? <View className="flex-1"><ActionButton label={update.isPending ? "جارٍ التحديث..." : "إغلاق المحادثة"} icon="archive-outline" secondary onPress={() => void changeStatus("closed")} /></View> : null}</View> : null}
      {update.error ? <Text className="mt-2 text-xs text-[#FF9BA7]" style={{ textAlign: "right" }}>{update.error.message}</Text> : null}
    </Card> : null}
  </View>;
}
