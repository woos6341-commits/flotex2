import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { KeyboardAwareScrollView as ScrollView } from "@/components/KeyboardAwareScrollView";
import { ActionButton, Card, Pill, Screen } from "@/components/atheer-ui";
import { GuestSupportAttachmentPicker, GuestSupportAttachmentView, useGuestSupportAttachment } from "@/components/guest-support/GuestSupportAttachments";
import { guestSupportClient, GUEST_STATUS_LABELS, newGuestOperationId, type GuestConversation } from "@/lib/guest-support-client";

const inputStyle = { minHeight: 110, borderWidth: 1, borderColor: "#273548", borderRadius: 14, backgroundColor: "#0B1018", color: "#F7F1E3", paddingHorizontal: 14, paddingTop: 14, fontSize: 16 };

export default function GuestSupportScreen() {
  const router = useRouter();
  const [body, setBody] = useState("");
  const picker = useGuestSupportAttachment();
  const [token, setToken] = useState("");
  const [conversation, setConversation] = useState<GuestConversation | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const sendingLock = useRef(false);
  const pending = useRef<{ fingerprint: string; id: string } | null>(null);

  const openConversation = async () => {
    setError(""); setLoading(true);
    try {
      const activeToken = await guestSupportClient.open();
      setToken(activeToken);
      setConversation(await guestSupportClient.messages(activeToken));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "تعذر فتح محادثة خدمة العملاء."); }
    finally { setLoading(false); }
  };
  useEffect(() => { const timer = setTimeout(() => { void openConversation(); }, 0); return () => clearTimeout(timer); }, []);
  useEffect(() => {
    if (!token) return;
    let active = true;
    const timer = setInterval(() => { void guestSupportClient.messages(token).then((data) => { if (active) setConversation(data); }).catch(() => { /* keep existing conversation; retry automatically */ }); }, 5000);
    return () => { active = false; clearInterval(timer); };
  }, [token]);
  const send = async () => {
    if (sendingLock.current) return;
    if (!token || (!body.trim() && !picker.attachment)) { setError("اكتب رسالتك أو أرفق ملفًا قبل الإرسال."); return; }
    const attachment = picker.attachment ? { data: picker.attachment.data, mimeType: picker.attachment.mimeType } : undefined;
    const fingerprint = JSON.stringify([body.trim(), attachment]);
    if (!pending.current || pending.current.fingerprint !== fingerprint) pending.current = { fingerprint, id: newGuestOperationId() };
    sendingLock.current = true; setSending(true); setError("");
    try {
      await guestSupportClient.send(token, { body: body.trim(), attachment, operationId: pending.current.id });
      pending.current = null; setBody(""); picker.setAttachment(null);
      try { setConversation(await guestSupportClient.messages(token)); } catch { setError("أُرسلت الرسالة، لكن تعذر تحديث العرض مؤقتًا."); }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "تعذر إرسال الرسالة؛ أعد المحاولة."); }
    finally { sendingLock.current = false; setSending(false); }
  };

  return <Screen title="خدمة العملاء" subtitle="تواصل مباشرة مع فريق الدعم دون تسجيل دخول أو إدخال بيانات">
    <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ paddingBottom: 120 }}>
      {loading && !conversation ? <Card><View className="items-center py-8"><ActivityIndicator color="#D7A948" /><Text className="mt-4 text-sm text-[#9BA8B8]">جارٍ فتح المحادثة...</Text></View></Card> : null}
      {error && !conversation ? <Card><Text className="text-sm leading-6 text-[#FF9BA7]" style={{ textAlign: "right" }}>{error}</Text><View className="mt-4"><ActionButton label="إعادة المحاولة" icon="refresh-outline" onPress={() => void openConversation()} /></View></Card> : null}
      {conversation ? <>
        <Card><View className="flex-row items-center justify-between"><Pill tone={conversation.ticket.status === "closed" ? "muted" : "gold"}>{GUEST_STATUS_LABELS[conversation.ticket.status] ?? conversation.ticket.status}</Pill><Text className="text-base font-bold text-[#F7F1E3]" style={{ textAlign: "right" }}>محادثة خدمة العملاء</Text></View><Text className="mt-2 text-xs text-[#D7B75E]" style={{ textAlign: "right" }}>رقم المحادثة: {conversation.ticket.ticketCode}</Text><Text className="mt-2 text-xs leading-5 text-[#9BA8B8]" style={{ textAlign: "right" }}>تظهر الردود تلقائيًا. تُحفظ الجلسة على هذا الجهاز؛ إزالة بيانات التطبيق أو المتصفح قد تفقدك الوصول إليها.</Text></Card>
        <View className="mt-4 gap-3">{conversation.messages.length ? conversation.messages.map((item) => <View key={item.id} className={`max-w-[92%] rounded-3xl border p-4 ${item.senderRole === "guest" ? "self-start border-[#273548] bg-[#121B28]" : "self-end border-[#5C4A28] bg-[#171D27]"}`}><Text className="text-[10px] text-[#9BA8B8]">{item.senderRole === "guest" ? "أنت" : "خدمة العملاء"} · {new Date(item.createdAt).toLocaleString("ar-EG")}</Text><Text className="mt-2 text-sm leading-6 text-[#F7F1E3]" style={{ textAlign: "right" }}>{item.body}</Text>{item.attachment ? <GuestSupportAttachmentView attachment={item.attachment} /> : null}<Text className="mt-2 text-[10px] text-[#657286]">{item.readAt ? "تمت القراءة" : "تم الإرسال"}</Text></View>) : <Card><Text className="text-sm text-[#9BA8B8]" style={{ textAlign: "right" }}>اكتب رسالتك الأولى لفريق خدمة العملاء.</Text></Card>}</View>
        {conversation.ticket.status === "closed" ? <Card className="mt-4"><Text className="text-sm text-[#9BA8B8]" style={{ textAlign: "right" }}>المحادثة مغلقة. يمكن للإدارة إعادة فتحها للمتابعة.</Text></Card> : <Card className="mt-4 border-[#5C4A28]"><TextInput value={body} onChangeText={setBody} editable={!sending} multiline maxLength={2000} placeholder="اكتب رسالتك..." placeholderTextColor="#657286" textAlign="right" textAlignVertical="top" style={inputStyle} /><GuestSupportAttachmentPicker picker={picker} disabled={sending} /><View className="mt-3"><ActionButton label={sending ? "جارٍ الإرسال..." : "إرسال"} icon="send-outline" onPress={() => void send()} /></View></Card>}
      </> : null}
      {error && conversation ? <Text className="mt-4 text-sm leading-6 text-[#FF9BA7]" style={{ textAlign: "right" }}>{error}</Text> : null}
      <Pressable onPress={() => router.back()} className="mt-6 self-center"><Text className="text-sm text-[#D7B75E]">العودة</Text></Pressable>
    </ScrollView>
  </Screen>;
}
