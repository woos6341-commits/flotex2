import { useEffect, useRef, useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { trpc } from "@/lib/trpc";

export function AdminNotificationGate() {
  const notifications = trpc.notifications.list.useQuery(undefined, { refetchInterval: 15000, refetchOnWindowFocus: true, retry: false });
  const markDelivered = trpc.notifications.markDelivered.useMutation();
  const markRead = trpc.notifications.markRead.useMutation({ onSuccess: () => { void notifications.refetch(); } });
  const [dismissedId, setDismissedId] = useState<number | null>(null);
  const deliveredId = useRef<number | null>(null);
  const item = notifications.data?.find((entry) => !entry.readAt);
  const visible = Boolean(item && item.id !== dismissedId);
  useEffect(() => {
    if (item && !item.deliveredAt && deliveredId.current !== item.id) {
      deliveredId.current = item.id;
      markDelivered.mutate({ notificationId: item.id });
    }
  }, [item, markDelivered]);
  const close = () => { if (item) { setDismissedId(item.id); markRead.mutate({ notificationId: item.id }); } };
  if (!item) return null;
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={close}><View style={{ flex: 1, backgroundColor: "#00000099", alignItems: "center", justifyContent: "center", padding: 22 }}><View style={{ width: "100%", maxWidth: 420, borderRadius: 24, borderWidth: 1, borderColor: "#8B7446", backgroundColor: "#121B28", padding: 22 }}><Text style={{ color: "#D7A948", fontSize: 12, fontWeight: "700", textAlign: "right" }}>إشعار إداري جديد</Text><Text style={{ color: "#F7F1E3", fontSize: 20, fontWeight: "800", marginTop: 10, textAlign: "right" }}>{item.title}</Text><Text style={{ color: "#C7CDD6", fontSize: 14, lineHeight: 24, marginTop: 12, textAlign: "right" }}>{item.body}</Text><Text style={{ color: "#657286", fontSize: 11, marginTop: 12, textAlign: "right" }}>{new Date(item.createdAt).toLocaleString("ar-EG")}</Text><Pressable onPress={close} style={{ marginTop: 20, borderRadius: 14, backgroundColor: "#D7A948", paddingVertical: 13, alignItems: "center" }}><Text style={{ color: "#0B1018", fontWeight: "800" }}>تمت القراءة</Text></Pressable></View></View></Modal>;
}
