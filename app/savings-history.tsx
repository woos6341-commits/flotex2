import { KeyboardAwareScrollView as ScrollView } from "@/components/KeyboardAwareScrollView";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, AppState, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { ActionButton, Card, EmptyState, Pill, Screen, formatMoney } from "@/components/atheer-ui";
import { LoginPanel } from "@/components/LoginPanel";
import { useAuth } from "@/hooks/use-auth";
import { trpc } from "@/lib/trpc";
import { confirmFinancialAction, showFinancialMessage } from "@/lib/financial-feedback";
import { formatSavingsCountdown, getSavingsPayoutCountdown, getSavingsProduct, savingsPeriodKey, type SavingsFrequency } from "@/shared/savings";

const statusText: Record<string, string> = { pending_approval: "تحت المراجعة", active: "نشطة", rejected: "مرفوضة", completed: "مستردة/مكتملة", refunded: "مستردة", cancelled: "ملغاة" };
const statusTone = (status: string): "gold" | "green" | "red" | "muted" => status === "active" ? "green" : status === "rejected" || status === "cancelled" ? "red" : status === "pending_approval" ? "gold" : "muted";

export default function SavingsHistoryScreen() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const query = trpc.savings.mine.useQuery(undefined, { enabled: Boolean(user), refetchInterval: 15000, refetchOnWindowFocus: true });
  const [now, setNow] = useState(() => Date.now());
  const hasActivePlans = Boolean(user && query.data?.some((plan) => plan.status === "active"));
  useEffect(() => {
    if (!hasActivePlans) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const stop = () => { if (timer) clearInterval(timer); timer = undefined; };
    const refresh = (status: string) => {
      stop();
      if (status !== "active") return;
      setNow(Date.now());
      // One clock for the entire list, and no ticking for archived plans/background.
      timer = setInterval(() => setNow(Date.now()), 1000);
    };
    refresh(AppState.currentState);
    const subscription = AppState.addEventListener("change", refresh);
    return () => { stop(); subscription.remove(); };
  }, [hasActivePlans]);
  const utils = trpc.useUtils();
  const cancel = trpc.savings.cancel.useMutation({
    onSuccess: async (result) => { await Promise.all([utils.savings.mine.invalidate(), utils.portfolio.get.invalidate(), utils.portfolio.transactions.invalidate()]); showFinancialMessage("تم إلغاء الإدخار", `تم تحرير ${result.releasedAmount} ج.م من الحجز إلى رصيدك المتاح.`); },
    onError: (error) => showFinancialMessage("تعذر إلغاء الإدخار", error.message),
  });
  const refund = trpc.savings.refund.useMutation({
    onSuccess: async (result) => { await Promise.all([utils.savings.mine.invalidate(), utils.portfolio.get.invalidate(), utils.portfolio.transactions.invalidate()]); showFinancialMessage("تم استرداد الإدخار", `أُعيد ${result.refundedAmount} ج.م إلى محفظتك. الأرباح المدفوعة فعليًا: ${result.paidProfit} ج.م.`); },
    onError: (error) => showFinancialMessage("تعذر إعادة المبلغ إلى المحفظة", error.message),
  });
  if (loading) return <Screen title="سجل معاملات الإدخار"><ActivityIndicator color="#D7A948" /></Screen>;
  if (!user) return <Screen title="سجل معاملات الإدخار"><ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ flexGrow: 1, paddingBottom: 120 }}><LoginPanel /></ScrollView></Screen>;
  const plans = query.data ?? [];
  const askCancel = async (plan: any) => {
    if (await confirmFinancialAction("تأكيد إلغاء الإدخار", `سيُلغى طلب ${plan.reference} ويُحرر الأصل والرسوم المحجوزان إلى رصيدك المتاح. لن يُخصم أي مبلغ. هل تريد المتابعة؟`)) cancel.mutate({ planId: plan.id });
  };
  const askRefund = async (plan: any) => {
    if (await confirmFinancialAction("تأكيد استرداد الإدخار", `سيُعاد أصل ${plan.principalAmount} ج.م مرة واحدة إلى محفظتك، وتبقى الأرباح المدفوعة فعليًا فقط. ستتوقف العوائد المستقبلية. هل تريد المتابعة؟`)) refund.mutate({ planId: plan.id });
  };
  return <Screen title="سجل الإدخار" subtitle="الأصل والدفعات الفعلية من قاعدة البيانات">
    <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ paddingBottom: 120 }}>
      <ActionButton label="إضافة طلب إدخار" icon="add-circle-outline" onPress={() => router.push("/savings")} />
      <Text className="mb-3 mt-7 text-lg font-bold text-[#F7F1E3]" style={{ textAlign: "right" }}>عمليات الإدخار</Text>
      {query.isLoading ? <ActivityIndicator color="#D7A948" /> : query.isError ? <Card><Text className="text-sm text-[#FF7D8D]" style={{ textAlign: "right" }}>تعذر تحميل السجل من الخادم. أعد المحاولة.</Text></Card> : plans.length ? plans.map((plan) => <PlanCard key={plan.id} plan={plan} now={now} busy={cancel.isPending || refund.isPending} onCancel={() => void askCancel(plan)} onRefund={() => void askRefund(plan)} />) : <EmptyState title="لا توجد عمليات إدخار" text="أنشئ أول طلب من صفحة الإدخار، وسيظهر هنا بعد حفظه على الخادم." />}
    </ScrollView>
  </Screen>;
}

function PlanCard({ plan, now, busy, onCancel, onRefund }: { plan: any; now: number; busy: boolean; onCancel: () => void; onRefund: () => void }) {
  const frequency = plan.frequency as SavingsFrequency;
  const product = getSavingsProduct(frequency);
  const nextPayoutAt = plan.nextPayoutAt ? new Date(plan.nextPayoutAt) : null;
  const payoutCountdown = getSavingsPayoutCountdown(nextPayoutAt, now);
  const currentPeriodKey = nextPayoutAt ? savingsPeriodKey(frequency, nextPayoutAt) : "";
  const currentPayout = plan.payouts?.find((payout: any) => payout.periodKey === currentPeriodKey);
  const currentPeriodPaid = currentPayout?.status === "paid";
  const latestPaidPayout = useMemo(() => plan.payouts?.filter((payout: any) => payout.status === "paid").sort((a: any, b: any) => new Date(b.paidAt ?? b.createdAt).getTime() - new Date(a.paidAt ?? a.createdAt).getTime())[0], [plan.payouts]);
  return <Card className="mb-4">
    <View className="flex-row items-center justify-between"><Pill tone={statusTone(plan.status)}>{statusText[plan.status] ?? plan.status}</Pill><Text className="text-base font-bold text-[#F7F1E3]">إدخار {product.label}</Text></View>
    <Text className="mt-2 text-xs text-[#657286]" style={{ textAlign: "right" }}>{plan.reference}</Text>
    <View className="mt-4 flex-row flex-wrap gap-2"><Metric label="الأصل" value={`${formatMoney(plan.principalAmount)}`} /><Metric label="النسبة" value={`${plan.ratePercent}%`} /><Metric label="متراكم" value={`${Number(plan.totalAccrued ?? 0).toFixed(4)} ج.م`} /><Metric label="مدفوع" value={`${formatMoney(plan.totalPaid)}`} /></View>
    <Detail label="تاريخ الطلب" value={new Date(plan.createdAt).toLocaleString("ar-EG")} />
    <Detail label="تاريخ الموافقة" value={plan.approvedAt ? new Date(plan.approvedAt).toLocaleString("ar-EG") : "لم تتم الموافقة بعد"} />
    {latestPaidPayout ? <Text className="mt-3 text-right text-sm font-bold text-[#47D7A5]">تم إرسال الأرباح بنجاح · {formatMoney(latestPaidPayout.paidAmount)} · {new Date(latestPaidPayout.paidAt ?? latestPaidPayout.createdAt).toLocaleString("ar-EG")}</Text> : null}
    {plan.status === "active" && nextPayoutAt ? <>
      <Detail label="موعد استحقاق الأرباح" value={nextPayoutAt.toLocaleString("ar-EG")} />
      {currentPeriodPaid ? <Text className="mt-3 text-sm font-bold text-[#47D7A5]" style={{ textAlign: "right" }}>تم إرسال الأرباح بنجاح عن هذه الفترة.</Text> : payoutCountdown.isDue ? <Text className="mt-3 rounded-2xl border border-[#D7A94844] bg-[#D7A94812] p-3 text-sm font-bold text-[#D7A948]" style={{ textAlign: "right" }}>الأرباح مستحقة؛ بانتظار المعالجة، وتُضاف تلقائيًا بعد 5 دقائق إن لم تتم الموافقة.</Text> : <Text className="mt-3 text-xs text-[#D7A948]" style={{ textAlign: "right" }}>الوقت المتبقي حتى استحقاق الأرباح: {formatSavingsCountdown(payoutCountdown.remainingMs ?? 0)}</Text>}
    </> : null}
    <Detail label="إمكانية الاسترداد" value={plan.refundEligibleAt ? `${new Date(plan.refundEligibleAt).toLocaleString("ar-EG")} (بعد 48 ساعة من الطلب)` : "بعد 48 ساعة من الطلب"} />
    {plan.refundedAt ? <Detail label="تاريخ الاسترداد" value={new Date(plan.refundedAt).toLocaleString("ar-EG")} /> : null}
    {plan.rejectionReason ? <Detail label="سبب الرفض" value={plan.rejectionReason} /> : null}
    <Text className="mb-2 mt-5 text-sm font-bold text-[#F7F1E3]" style={{ textAlign: "right" }}>دفعات العائد</Text>
    {plan.payouts?.length ? plan.payouts.map((payout: any) => <View key={payout.id} className="mb-2 rounded-2xl border border-[#273548] bg-[#0B1018] p-3"><View className="flex-row items-center justify-between"><Pill tone={payout.status === "paid" ? "green" : payout.status === "blocked" ? "red" : "gold"}>{payout.status === "paid" ? "تم إرسال الأرباح بنجاح" : payout.status === "blocked" ? "مرفوضة/موقوفة" : "معلّقة"}</Pill><Text className="text-xs text-[#9BA8B8]">{payout.periodKey}</Text></View><Text className="mt-2 text-right text-sm text-[#F7F1E3]">المستحق: <Text style={{ writingDirection: "ltr" }}>{Number(payout.expectedAmount).toFixed(4)} ج.م</Text></Text><Text className="mt-1 text-right text-xs text-[#9BA8B8]">المدفوع فعليًا: <Text style={{ writingDirection: "ltr" }}>{formatMoney(payout.paidAmount)}</Text></Text>{payout.blockReason ? <Text className="mt-1 text-right text-xs text-[#D7A948]">{payout.status === "paid" ? "محاولة سابقة متوقفة: " : ""}{payout.blockReason}</Text> : null}{payout.paidAt ? <Text className="mt-1 text-right text-xs text-[#9BA8B8]">وقت الإرسال: {new Date(payout.paidAt).toLocaleString("ar-EG")}</Text> : null}</View>) : <Text className="text-xs text-[#657286]" style={{ textAlign: "right" }}>لم تستحق دفعة كاملة بعد.</Text>}
    {plan.status === "pending_approval" ? <View className="mt-4"><ActionButton label={busy ? "جارٍ الإلغاء..." : "إلغاء الطلب واسترداد الحجز"} icon="close-circle-outline" secondary onPress={onCancel} /></View> : null}
    {plan.status === "active" && plan.refundEligibleAt && new Date(plan.refundEligibleAt).getTime() <= now ? <View className="mt-4"><ActionButton label={busy ? "جارٍ الاسترداد..." : "استرداد الإدخار"} icon="return-down-back-outline" onPress={onRefund} /></View> : null}
    {plan.status === "active" && plan.refundEligibleAt && new Date(plan.refundEligibleAt).getTime() > now ? <Text className="mt-4 text-xs leading-5 text-[#D7A948]" style={{ textAlign: "right" }}>يُتاح استرداد أصل المبلغ بعد 48 ساعة من وقت تقديم الطلب لجميع الخطط اليومية والشهرية والسنوية. لا تُحتسب أرباح عن أي فترة غير مكتملة.</Text> : null}
  </Card>;
}

function Metric({ label, value }: { label: string; value: string }) { return <View className="min-w-[46%] flex-1 rounded-2xl border border-[#273548] bg-[#0B1018] p-3"><Text className="text-[11px] text-[#9BA8B8]">{label}</Text><Text className="mt-1 text-sm font-bold text-[#F7F1E3]" style={{ writingDirection: "ltr" }}>{value}</Text></View>; }
function Detail({ label, value }: { label: string; value: string }) { return <View className="mt-3 flex-row items-center justify-between border-b border-[#273548] pb-2"><Text className="max-w-[65%] text-xs text-[#F7F1E3]" style={{ textAlign: "right" }}>{value}</Text><Text className="text-xs text-[#9BA8B8]">{label}</Text></View>; }
