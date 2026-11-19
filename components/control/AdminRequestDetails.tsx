import { useState } from "react";
import { ActivityIndicator, Image, Pressable, Text, View } from "react-native";
import { Card } from "@/components/atheer-ui";
import { trpc } from "@/lib/trpc";
import type { AdminRequestDetailsData, AdminRequestReviewTarget } from "@/shared/admin-request-details";
import { formatEgyptDateTime } from "@/shared/ui-button-visibility";

type DetailsQuery = { data?: AdminRequestDetailsData | null; isLoading?: boolean; isFetching?: boolean; isError?: boolean; refetch: () => unknown };
export type AdminRequestDetailsProps = {
  requestKey: string;
  details: DetailsQuery;
  onBack: () => void;
  onOpenReview: (target: AdminRequestReviewTarget) => void;
};

const statuses: Record<string, string> = {
  pending: "قيد المراجعة", pending_approval: "بانتظار الموافقة", pending_review: "قيد المراجعة", new: "جديد",
  under_review: "قيد المراجعة", awaiting_details: "بانتظار البيانات", awaiting_execution: "بانتظار التنفيذ",
  pending_reply: "بانتظار الرد", replied: "تم الرد؛ المحادثة مفتوحة", open: "مفتوحة", closed: "مغلقة",
  processing: "جارٍ التنفيذ", approved: "مقبول", rejected: "مرفوض", completed: "مكتمل", active: "نشط",
  cancelled: "ملغي", refunded: "مسترد", executed: "منفذ", delivered: "تم التسليم",
};
function Line({ label, value }: { label: string; value: string | null | undefined }) {
  return <View style={{ paddingVertical: 5 }}><Text style={{ textAlign: "right", color: "#9BA8B8", fontSize: 12 }}>{label}</Text><Text selectable style={{ textAlign: "right", color: "#F7F1E3", lineHeight: 21, marginTop: 2 }}>{value || "غير متاح"}</Text></View>;
}
function Button({ label, onPress }: { label: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={{ borderWidth: 1, borderColor: "#D7A948", borderRadius: 12, padding: 12, marginTop: 9, backgroundColor: "#D7A94818" }}><Text style={{ color: "#D7A948", textAlign: "center", fontWeight: "700" }}>{label}</Text></Pressable>;
}

/** Rendering is intentionally read-only. All review actions remain on existing authorized screens. */
export function AdminRequestDetails({ requestKey, details, onBack, onOpenReview }: AdminRequestDetailsProps) {
  const [openReceiptKey, setOpenReceiptKey] = useState<string | null>(null);
  // Never show data retained from a previous selection while a different key is loading.
  const data = details.data?.key === requestKey ? details.data : null;
  const canShowReceipt = Boolean(data?.attachments.some((item) => item.access === "payment-receipt"));
  const receiptOpen = canShowReceipt && openReceiptKey === requestKey;
  const receipt = trpc.admin.receipt.useQuery({ requestId: receiptOpen && data ? data.review.id : 0 }, { enabled: receiptOpen, retry: false, gcTime: 0, refetchOnWindowFocus: false });
  const dateLabel = (value: string | null) => formatEgyptDateTime(value, "غير مسجل");
  if (details.isError) return <Card><Text style={{ textAlign: "right", color: "#FF9BA7" }}>تعذر تحميل تفاصيل هذا الطلب أو لم يعد متاحًا.</Text><Button label="إعادة المحاولة" onPress={() => void details.refetch()} /><Button label="رجوع" onPress={onBack} /></Card>;
  if (!data) return <Card><Text style={{ textAlign: "right", color: "#9BA8B8" }}>{details.isLoading || details.isFetching ? "جارٍ تحميل الطلب المحدد..." : "تفاصيل هذا الطلب غير متاحة."}</Text>{details.isLoading || details.isFetching ? <ActivityIndicator color="#D7A948" /> : null}<Button label="رجوع" onPress={onBack} /></Card>;

  return <View style={{ gap: 12 }}>
    <Card>
      <Text style={{ textAlign: "right", color: "#F7F1E3", fontSize: 19, fontWeight: "800" }}>تفاصيل الطلب · {data.title}</Text>
      <Line label="رقم الطلب" value={data.reference} />
      <Line label="العميل أو الزائر" value={`${data.customerName}${data.customerId ? ` · ${data.customerId}` : ""}`} />
      <Line label="النوع" value={data.title} />
      <Line label="الحالة الحالية" value={statuses[data.status] ?? data.status} />
      <Line label="تاريخ ووقت الإنشاء" value={dateLabel(data.createdAt)} />
      <Line label="المبلغ والعملة" value={data.amount !== null ? `${data.amount}${data.currency ? ` ${data.currency}` : " (العملة غير مسجلة)"}` : "غير مسجل"} />
      <Button label="فتح شاشة المراجعة المختصة" onPress={() => onOpenReview(data.review)} />
      <Text style={{ textAlign: "right", color: "#9BA8B8", marginTop: 8, fontSize: 12, lineHeight: 20 }}>تنفّذ الموافقة أو الرفض أو الرد من شاشة الخدمة القائمة فقط. قد تحتاج إلى اختيار المرجع داخلها؛ بعض الإجراءات قد لا تكون متاحة لهذه الحالة.</Text>
      <Button label="رجوع إلى القائمة" onPress={onBack} />
    </Card>
    <Card>
      <Text style={{ textAlign: "right", color: "#F7F1E3", fontSize: 16, fontWeight: "700" }}>البيانات المتاحة</Text>
      {data.fields.length ? data.fields.map((field, index) => <Line key={`${index}-${field.label}`} label={field.label} value={field.value} />) : <Text style={{ textAlign: "right", color: "#9BA8B8", marginTop: 8 }}>لا توجد حقول إضافية متاحة في هذا الملخص.</Text>}
    </Card>
    <Card>
      <Text style={{ textAlign: "right", color: "#F7F1E3", fontSize: 16, fontWeight: "700" }}>المرفقات</Text>
      {!data.attachments.length ? <Text style={{ textAlign: "right", color: "#9BA8B8", marginTop: 8 }}>لا توجد مرفقات مسجلة في البيانات المتاحة.</Text> : data.attachments.map((item, index) => item.access === "payment-receipt" ? <View key={`${index}-${item.label}`}>
        <Button label={receiptOpen ? "إخفاء إيصال التحويل" : "عرض إيصال التحويل المحمي"} onPress={() => setOpenReceiptKey(receiptOpen ? null : requestKey)} />
        {receiptOpen ? <View style={{ minHeight: 100, alignItems: "center", justifyContent: "center", marginTop: 10 }}>{receipt.isFetching ? <ActivityIndicator color="#D7A948" /> : receipt.isError ? <Text style={{ color: "#FF9BA7" }}>تعذر تحميل الإيصال المحمي.</Text> : receipt.data?.dataUrl ? <Image accessibilityLabel="صورة إيصال التحويل" source={{ uri: receipt.data.dataUrl }} resizeMode="contain" style={{ width: "100%", height: 240 }} /> : <Text style={{ color: "#9BA8B8" }}>الإيصال غير متاح.</Text>}</View> : null}
      </View> : <View key={`${index}-${item.label}`}><Text style={{ textAlign: "right", color: "#9BA8B8", marginTop: 8, lineHeight: 20 }}>{item.label}</Text></View>)}
      {data.attachments.some((item) => item.access === "specialist") ? <Button label="فتح شاشة المرفقات المختصة" onPress={() => onOpenReview(data.review)} /> : null}
    </Card>
    <Card>
      <Text style={{ textAlign: "right", color: "#F7F1E3", fontSize: 16, fontWeight: "700" }}>السجل المتاح</Text>
      {data.history.length ? data.history.map((event, index) => <View key={`${index}-${event.label}`} style={{ borderBottomWidth: 1, borderBottomColor: "#273548", paddingVertical: 9 }}><Text style={{ textAlign: "right", color: "#D7A948", fontWeight: "700" }}>{event.label}</Text><Text style={{ textAlign: "right", color: "#9BA8B8", marginTop: 3 }}>{dateLabel(event.at)}{event.actor ? ` · ${event.actor}` : ""}</Text>{event.detail ? <Text selectable style={{ textAlign: "right", color: "#F7F1E3", marginTop: 4, lineHeight: 20 }}>{event.detail}</Text> : null}</View>) : <Text style={{ textAlign: "right", color: "#9BA8B8", marginTop: 8 }}>لا توجد أحداث محفوظة.</Text>}
      {data.limitations.map((item, index) => <Text key={index} style={{ textAlign: "right", color: "#9BA8B8", fontSize: 12, lineHeight: 19, marginTop: 8 }}>{item}</Text>)}
    </Card>
  </View>;
}
