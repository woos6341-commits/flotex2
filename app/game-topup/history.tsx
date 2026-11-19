import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { KeyboardAwareScrollView as ScrollView } from "@/components/KeyboardAwareScrollView";
import { ActionButton, Card, EmptyState, Pill, Screen, formatMoney } from "@/components/atheer-ui";
import { useAuth } from "@/hooks/use-auth";
import { trpc } from "@/lib/trpc";
import { confirmFinancialAction, showFinancialMessage } from "@/lib/financial-feedback";
import { GAME_TOPUP_STATUS_TONE, formatGameQuantity } from "@/lib/game-topup";

const GOLD = "#D7A948";
const MUTED = "#9BA8B8";

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 7, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#273548" },
  label: { color: MUTED, fontSize: 12 },
  value: { color: "#F7F1E3", fontSize: 12.5, fontWeight: "700", writingDirection: "ltr", fontVariant: ["tabular-nums"] },
  note: { color: "#B6C1CF", fontSize: 11, lineHeight: 18, textAlign: "right", marginTop: 8 },
});

function formatDate(value: unknown) {
  if (!value) return "—";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("ar-EG", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function GameTopupHistoryScreen() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const utils = trpc.useUtils();
  const mine = trpc.gameTopup.mine.useQuery(undefined, { enabled: Boolean(user), refetchInterval: 15000, refetchOnWindowFocus: true });
  const cancel = trpc.gameTopup.cancel.useMutation({
    onSuccess: async (result) => {
      await Promise.all([utils.gameTopup.mine.invalidate(), utils.gameTopup.overview.invalidate(), utils.portfolio.get.invalidate()]);
      showFinancialMessage("تم إلغاء الطلب", result.message);
    },
    onError: (error) => showFinancialMessage("تعذر إلغاء الطلب", error.message),
  });

  if (loading) return <Screen title="طلبات شحن الألعاب"><View className="flex-1 items-center justify-center"><ActivityIndicator color={GOLD} /></View></Screen>;
  if (!user) {
    return <Screen title="طلبات شحن الألعاب"><EmptyState title="سجّل الدخول" text="تحتاج إلى تسجيل الدخول لمتابعة طلبات الشحن." /><View className="mt-4"><ActionButton label="العودة للرئيسية" icon="arrow-forward" onPress={() => router.replace("/(tabs)" as never)} /></View></Screen>;
  }

  const requests = mine.data ?? [];

  return (
    <Screen title="طلبات شحن الألعاب" subtitle="تابع حالة طلبك ومرجع التنفيذ">
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        <View className="mb-4 flex-row items-center justify-between">
          <Pressable accessibilityRole="button" accessibilityLabel="العودة إلى شحن الألعاب" onPress={() => router.back()} className="h-10 w-10 items-center justify-center rounded-2xl border border-[#2A394D] bg-[#121B28]">
            <Ionicons name="arrow-forward" size={19} color={GOLD} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="شحن لعبة جديدة" onPress={() => router.push("/game-topup" as never)} className="flex-row items-center gap-1.5 rounded-full border border-[#2A394D] bg-[#121B28] px-3 py-2">
            <Ionicons name="add" size={15} color="#D7B76B" />
            <Text style={{ color: "#D7B76B", fontSize: 12, fontWeight: "700" }}>طلب جديد</Text>
          </Pressable>
        </View>

        {mine.isLoading ? <View className="py-16 items-center"><ActivityIndicator color={GOLD} /></View> : mine.isError ? (
          <Card><Text style={{ color: "#FF7D8D", fontSize: 12, textAlign: "center" }}>تعذر تحميل الطلبات. تحقق من الاتصال ثم أعد المحاولة.</Text><View className="mt-4"><ActionButton label="إعادة المحاولة" icon="refresh-outline" secondary onPress={() => void mine.refetch()} /></View></Card>
        ) : !requests.length ? (
          <EmptyState title="لا توجد طلبات شحن بعد" text="اختر لعبتك وباقة الشحن وسيظهر الطلب هنا مع حالته ومرجعه." />
        ) : (
          <View style={{ gap: 12 }}>
            {requests.map((request) => {
              const cancellable = request.status === "new" || request.status === "under_review";
              return (
                <Card key={request.id}>
                  <View className="flex-row items-start justify-between gap-2">
                    <Pill tone={GAME_TOPUP_STATUS_TONE[request.status] ?? "muted"}>{request.statusLabel}</Pill>
                    <View className="flex-1 items-end">
                      <Text style={{ color: "#F7F1E3", fontSize: 16, fontWeight: "800", textAlign: "right" }}>{request.gameName} · {request.kindLabel}</Text>
                      <Text style={{ color: MUTED, fontSize: 11, marginTop: 2, textAlign: "right" }}>{request.reference} · {formatDate(request.createdAt)}</Text>
                    </View>
                  </View>
                  <View style={{ marginTop: 10 }}>
                    {request.kind === "topup" ? <View style={styles.row}><Text style={styles.value}>{formatGameQuantity(request.quantity, request.currencyLabel ?? "وحدة")}</Text><Text style={styles.label}>الكمية</Text></View> : null}
                    <View style={styles.row}><Text style={styles.value}>{formatMoney(request.subtotalAmount)}</Text><Text style={styles.label}>{request.kind === "withdraw" ? "مبلغ السحب" : request.kind === "deposit" ? "مبلغ الإيداع" : "قيمة الشحن"}</Text></View>
                    <View style={styles.row}><Text style={styles.value}>{formatMoney(request.feeAmount)}</Text><Text style={styles.label}>{request.kind === "deposit" ? "رسوم الإيداع" : "رسوم الخدمة"}</Text></View>
                    <View style={styles.row}><Text style={styles.value}>{formatMoney(request.totalAmount)}</Text><Text style={styles.label}>الإجمالي</Text></View>
                    {request.packageLabel ? <View style={styles.row}><Text style={styles.value}>{request.packageLabel}</Text><Text style={styles.label}>الباقة</Text></View> : null}
                    <View style={[styles.row, { borderBottomWidth: 0 }]}><Text style={styles.value}>{request.providerReference ?? "—"}</Text><Text style={styles.label}>مرجع العملية</Text></View>
                  </View>
                  {request.playerData.length ? (
                    <View className="mt-2 rounded-xl border border-[#273548] bg-[#0B1018] p-3" style={{ gap: 4 }}>
                      {request.playerData.map((field) => (
                        <View key={field.key} className="flex-row items-center justify-between gap-3">
                          <Text style={{ color: "#F7F1E3", fontSize: 11.5, writingDirection: "ltr" }}>{field.value}</Text>
                          <Text style={{ color: MUTED, fontSize: 11 }}>{field.label}</Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                  {request.status === "rejected" && request.rejectionReason ? <Text style={[styles.note, { color: "#FF7D8D" }]}>سبب الرفض: {request.rejectionReason}</Text> : null}
                  {request.status === "completed" ? <Text style={[styles.note, { color: "#47D7A5" }]}>تم تنفيذ الطلب بنجاح{request.completedAt ? ` في ${formatDate(request.completedAt)}` : ""}.</Text> : null}
                  {cancellable ? (
                    <View className="mt-3">
                      <ActionButton
                        label={cancel.isPending ? "جارٍ الإلغاء…" : "إلغاء الطلب"}
                        icon="close-circle-outline"
                        secondary
                        onPress={async () => {
                          if (cancel.isPending) return;
                          const ok = await confirmFinancialAction(`إلغاء ${request.kindLabel}`, request.kind === "withdraw" ? "سيتم إلغاء طلب السحب. هل تريد المتابعة؟" : `سيتم تحرير ${formatMoney(request.totalAmount)} المحجوز دون خصم. هل تريد المتابعة؟`);
                          if (ok) cancel.mutate({ requestId: request.id });
                        }}
                      />
                    </View>
                  ) : null}
                </Card>
              );
            })}
          </View>
        )}
        <Text style={{ color: "#657286", fontSize: 11, lineHeight: 18, textAlign: "center", marginTop: 16 }}>يُحدّث هذا السجل تلقائيًا عند تغيير حالة الطلب من لوحة الإدارة.</Text>
      </ScrollView>
    </Screen>
  );
}
