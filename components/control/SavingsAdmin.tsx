import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { ActionButton, Card, EmptyState, Pill, formatMoney } from "@/components/atheer-ui";
import { trpc } from "@/lib/trpc";
import { confirmFinancialAction, showFinancialMessage } from "@/lib/financial-feedback";
import {
  calculateExpectedInterestAtRate,
  formatSavingsCountdown,
  getSavingsPayoutCountdown,
  getSavingsProduct,
  roundInterestToWallet,
  savingsPeriodKey,
  type SavingsFrequency,
} from "@/shared/savings";
import { ratePercentToPpm } from "@/shared/savings-settings";

const statusText: Record<string, string> = {
  pending_approval: "تحت المراجعة",
  active: "نشطة",
  rejected: "مرفوضة",
  completed: "مستردة/مكتملة",
  refunded: "مستردة",
  cancelled: "ملغاة",
};

export function SavingsAdmin() {
  const utils = trpc.useUtils();
  const query = trpc.admin.savings.useQuery({ status: "all" }, { refetchInterval: 10000 });
  const payoutSchedules = trpc.admin.savingsPayoutSchedules.useQuery(undefined, { refetchInterval: 10000 });
  const financing = trpc.admin.savingsFinancingWallet.useQuery(undefined, { refetchInterval: 10000 });
  const [reason, setReason] = useState("");
  const [activeTab, setActiveTab] = useState<"requests" | "archive" | "ledger">("requests");
  const transactionLog = trpc.admin.savingsTransactions.useQuery(undefined, { enabled: activeTab === "ledger", refetchInterval: 10000 });
  const [fundingAmount, setFundingAmount] = useState("");
  const [fundingSource, setFundingSource] = useState("");
  const review = trpc.admin.reviewSavings.useMutation({
    onSuccess: async (result) => {
      setReason("");
      await Promise.all([utils.admin.savings.invalidate(), utils.admin.savingsPayoutSchedules.invalidate(), utils.admin.savingsTransactions.invalidate(), utils.admin.recentOperations.invalidate()]);
      if (result.status !== "active") {
        showFinancialMessage("تم الرفض", "تم تحرير المبلغ المحجوز دون خصم.");
        return;
      }
      const scheduleMessage = result.autoPayoutSchedule === "created" || result.autoPayoutSchedule === "active" || result.autoPayoutSchedule === "reconciled"
        ? "الجدولة الخلفية لعوائد الخطط النشطة مفعّلة؛ يفحص الخادم الاستحقاق كل دقيقة بعد مهلة خمس دقائق."
        : result.autoPayoutSchedule === "deferred"
          ? "تمت الموافقة، وستُنشأ مهمة الإرسال التلقائي بعد نشر الخادم في الإنتاج."
          : "تمت الموافقة والخصم، لكن تعذّر إعداد مهمة الإرسال التلقائي. لم يبدأ الإرسال الآلي؛ أعد محاولة إعداد الجدولة من لوحة الإدارة أو أعد تشغيل الخادم المنشور.";
      showFinancialMessage("تمت الموافقة", `خُصم أصل الإدخار مرة واحدة وسُجلت الحركة. ${scheduleMessage}`);
    },
    onError: (error) => showFinancialMessage("تعذر تحديث الإدخار", error.message),
  });
  const scheduleSetup = trpc.admin.ensureSavingsPayoutSchedule.useMutation({
    onSuccess: (result) => {
      if (result.status === "created" || result.status === "active" || result.status === "reconciled") {
        showFinancialMessage("الجدولة مفعّلة", "سيفحص الخادم العوائد كل دقيقة، بعد مهلة خمس دقائق من الاستحقاق، مع منع الدفعات المكررة.");
      } else if (result.status === "deferred") {
        showFinancialMessage("الجدولة جاهزة للنشر", "لن تُنشأ مهمة إنتاجية في المعاينة؛ سيُفعّلها الخادم المنشور تلقائيًا عند وجود خطة نشطة.");
      } else {
        showFinancialMessage("لا توجد خطة نشطة", "لم تُنشأ مهمة بلا حاجة. ستُجهز الجدولة تلقائيًا عند اعتماد أول خطة نشطة.");
      }
    },
    onError: (error) => showFinancialMessage("تعذر إعداد الجدولة", `لم يبدأ الإرسال التلقائي. أعد المحاولة بعد التحقق من اتصال الخادم. ${error.message}`),
  });
  const addFunding = trpc.admin.addSavingsFinancing.useMutation({
    onSuccess: async (result) => {
      await financing.refetch();
      setFundingAmount("");
      setFundingSource("");
      showFinancialMessage("تمت إضافة التمويل", `أضيف ${formatMoney(result.amount)} إلى محفظة تمويل الإدخار وسُجلت العملية.`);
    },
    onError: (error) => showFinancialMessage("تعذر إضافة التمويل", error.message),
  });
  const confirmPayout = trpc.admin.confirmSavingsPayout.useMutation({
    onSuccess: async (result) => {
      await Promise.all([
        utils.admin.savings.invalidate(),
        utils.admin.savingsPayoutSchedules.invalidate(),
        utils.admin.savingsFinancingWallet.invalidate(),
        utils.admin.savingsTransactions.invalidate(),
        utils.savings.mine.invalidate(),
      ]);
      if (result.status === "blocked") {
        showFinancialMessage("تعذر إرسال الأرباح", "لم يُنفذ أي تحويل لأن رصيد محفظة تمويل الإدخار غير كافٍ. سُجلت الحالة ويمكن إعادة المحاولة بعد توفير التمويل.");
      } else if (result.status === "already_paid") {
        showFinancialMessage("الدفعة مسجلة مسبقًا", "لم يحدث تحويل مكرر لهذه الفترة.");
      } else if (result.status === "not_due") {
        showFinancialMessage("لم يحل موعد الاستحقاق", "لم تُنفذ أي حركة مالية. سيظهر زر التأكيد عند حلول الموعد.");
      } else {
        showFinancialMessage("تم إرسال الأرباح بنجاح", `تم اعتماد وإضافة ${formatMoney(result.amount)} إلى محفظة العميل، وبدأت الدورة التالية.`);
      }
    },
    onError: (error) => showFinancialMessage("تعذر إرسال الأرباح", error.message),
  });
  const plans = query.data ?? [];
  const pendingPlans = plans.filter((plan: any) => plan.status === "pending_approval");
  const archivedPlans = plans.filter((plan: any) => plan.status !== "pending_approval");
  const payoutPlans = payoutSchedules.data ?? [];
  const askConfirmPayout = async (plan: any) => {
    if (confirmPayout.isPending) return;
    const product = getSavingsProduct(plan.frequency as SavingsFrequency);
    const expected = calculateExpectedInterestAtRate(plan.principalAmount, Number(plan.ratePpm) || ratePercentToPpm(plan.ratePercent));
    const amount = roundInterestToWallet(expected);
    if (await confirmFinancialAction("تأكيد إرسال الأرباح", `سيُخصم ${amount} ج.م من محفظة تمويل الإدخار ويُضاف إلى محفظة ${plan.customer?.name || `العميل رقم ${plan.userId}`} عن الخطة ${product.label}. هل تريد المتابعة؟`)) {
      confirmPayout.mutate({ planId: plan.id });
    }
  };

  return <View>
    <View className="mb-4 flex-row gap-2">
      {([ ["requests", "طلبات المراجعة"], ["archive", "أرشيف الخطط"], ["ledger", "سجل المعاملات"] ] as const).map(([key, label]) => {
        const selected = activeTab === key;
        return <Pressable key={key} onPress={() => setActiveTab(key)} accessibilityRole="tab" accessibilityState={{ selected }} style={{ flex: 1, borderRadius: 14, borderWidth: 1, borderColor: selected ? "#D7A948" : "#273548", backgroundColor: selected ? "#D7A94818" : "#0B1018", paddingVertical: 11, alignItems: "center" }}><Text style={{ color: selected ? "#D7A948" : "#9BA8B8", fontWeight: "700", fontSize: 13 }}>{label}</Text></Pressable>;
      })}
    </View>
    {activeTab === "ledger" ? <SavingsTransactionLedger data={transactionLog.data ?? []} loading={transactionLog.isLoading} error={transactionLog.isError} /> : activeTab === "archive" ? <View>
      {query.isLoading ? <ActivityIndicator color="#D7A948" /> : query.isError ? <Card><Text className="text-sm text-[#FF7D8D]" style={{ textAlign: "right" }}>تعذر تحميل أرشيف الإدخار.</Text></Card> : archivedPlans.length ? archivedPlans.map((plan: any) => <Card key={plan.id} className="mb-2 p-3"><View className="flex-row items-center justify-between"><Pill tone={plan.status === "rejected" || plan.status === "cancelled" ? "red" : plan.status === "active" ? "green" : "muted"}>{statusText[plan.status] ?? plan.status}</Pill><Text className="text-sm font-bold text-[#F7F1E3]">{plan.customer?.name || `العميل #${plan.userId}`}</Text></View><Text className="mt-2 text-xs text-[#9BA8B8]" style={{ textAlign: "right" }}>{plan.reference} · {formatMoney(plan.principalAmount)} · {plan.frequency}</Text><Text className="mt-1 text-[11px] text-[#657286]" style={{ textAlign: "right" }}>تاريخ الطلب: {new Date(plan.createdAt).toLocaleString("ar-EG")} · القرار: {new Date(plan.approvedAt ?? plan.updatedAt).toLocaleString("ar-EG")}</Text></Card>) : <EmptyState title="لا توجد خطط في الأرشيف" text="ستظهر الخطط المعتمدة أو المرفوضة أو المنتهية هنا." />}
    </View> : <>
      <SavingsPayoutQueue plans={payoutPlans} loading={payoutSchedules.isLoading} error={payoutSchedules.isError} busy={confirmPayout.isPending} onConfirm={(plan) => void askConfirmPayout(plan)} />
      <FinancingWalletPanel
        data={financing.data}
        loading={financing.isLoading}
        amount={fundingAmount}
        source={fundingSource}
        setAmount={setFundingAmount}
        setSource={setFundingSource}
        busy={addFunding.isPending}
        onAdd={() => addFunding.mutate({ amount: fundingAmount, source: fundingSource, operationId: `SAV-FUND-${Date.now()}-${Math.random().toString(36).slice(2, 10)}` })}
      />
      <Card className="mb-4 border-[#5C4A28]">
        <Text className="text-base font-bold text-[#F7F1E3]" style={{ textAlign: "right" }}>ضوابط العوائد</Text>
        <Text className="mt-2 text-sm leading-6 text-[#9BA8B8]" style={{ textAlign: "right" }}>يمكن للمدير تأكيد الدفعة يدويًا خلال 5 دقائق من الاستحقاق؛ بعدها تُرسل تلقائيًا إن لم تُؤكد، مع تطبيق التحقق نفسه ومنع التكرار. يُخصم العائد من محفظة التمويل ويضاف للعميل داخل معاملة واحدة. الدفعة غير الممولة تُسجل دون تحويل حتى توفير التمويل.</Text>
        <View className="mt-3"><ActionButton label={scheduleSetup.isPending ? "جارٍ التحقق من الجدولة..." : "إعداد / إعادة محاولة الجدولة"} icon="refresh-outline" secondary onPress={() => { if (!scheduleSetup.isPending) scheduleSetup.mutate(); }} /></View>
      </Card>
      {query.isLoading ? <ActivityIndicator color="#D7A948" /> : query.isError ? <Card><Text className="text-sm text-[#FF7D8D]" style={{ textAlign: "right" }}>تعذر تحميل عمليات الإدخار.</Text></Card> : pendingPlans.length ? pendingPlans.map((plan: any) => <AdminPlan key={plan.id} plan={plan} reason={reason} setReason={setReason} busy={review.isPending} onReview={(decision) => review.mutate({ planId: plan.id, decision, rejectionReason: reason })} />) : <EmptyState title="لا توجد طلبات إدخار معلقة" text="تختفي الطلبات المعتمدة والمرفوضة من قائمة المراجعة، وتبقى محفوظة في أرشيف الخطط وسجل العمليات." />}
    </>}
  </View>;
}

function SavingsTransactionLedger({ data, loading, error }: { data: any[]; loading: boolean; error: boolean }) {
  if (loading) return <ActivityIndicator color="#D7A948" />;
  if (error) return <Card><Text className="text-sm text-[#FF7D8D]" style={{ textAlign: "right" }}>تعذر تحميل سجل معاملات الادخار.</Text></Card>;
  if (!data.length) return <EmptyState title="لا توجد معاملات ادخار" text="ستظهر هنا طلبات الادخار وحركات الخصم والعائد والاسترداد بعد تسجيلها." />;
  const statusLabel: Record<string, string> = { pending: "تحت المراجعة", approved: "مؤكدة", rejected: "مرفوضة", cancelled: "ملغاة" };
  return <View>
    <Text className="mb-3 text-sm text-[#9BA8B8]" style={{ textAlign: "right" }}>أحدث {data.length} معاملة مرتبطة بطلبات الادخار.</Text>
    {data.map((item) => <Card key={item.id} className="mb-2 p-3">
      <View className="flex-row items-center justify-between"><Pill tone={item.status === "approved" ? "green" : item.status === "rejected" || item.status === "cancelled" ? "red" : "gold"}>{statusLabel[item.status] ?? item.status}</Pill><Text className="text-sm font-bold text-[#F7F1E3]">{item.customerTitle || "معاملة ادخار"}</Text></View>
      <Text className="mt-2 text-base font-bold text-[#D7A948]" style={{ writingDirection: "ltr", textAlign: "right" }}>{item.direction === "debit" ? "−" : "+"}{formatMoney(item.amount)}</Text>
      <Text className="mt-1 text-xs text-[#9BA8B8]" style={{ textAlign: "right" }}>العميل: {item.customerName || "غير متاح"} · الرقم: {item.customerNumber || item.userId}</Text>
      <Text className="mt-1 text-xs text-[#9BA8B8]" style={{ textAlign: "right" }}>{item.note || item.source || ""}</Text>
      <Text className="mt-1 text-[11px] text-[#657286]" style={{ textAlign: "right" }}>{new Date(item.createdAt).toLocaleString("ar-EG")} · {item.reference}</Text>
    </Card>)}
  </View>;
}

function SavingsPayoutQueue({ plans, loading, error, busy, onConfirm }: { plans: any[]; loading: boolean; error: boolean; busy: boolean; onConfirm: (plan: any) => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  return <Card className="mb-4 border-[#5C4A28]">
    <View className="flex-row items-center justify-between"><Pill tone="gold">موافقة يدوية</Pill><Text className="text-base font-bold text-[#F7F1E3]">أرباح الإدخار المستحقة</Text></View>
    <Text className="mt-2 text-xs leading-5 text-[#9BA8B8]" style={{ textAlign: "right" }}>تعرض القائمة جميع خطط الإدخار النشطة. يظهر زر الإرسال عند الاستحقاق، وإذا لم يؤكد المدير خلال 5 دقائق يتولى الخادم الإرسال التلقائي بعد التحقق من الموعد والرصيد.</Text>
    {loading ? <ActivityIndicator className="mt-4" color="#D7A948" /> : error ? <Text className="mt-4 text-xs text-[#FF7D8D]" style={{ textAlign: "right" }}>تعذر تحميل مواعيد استحقاق الأرباح.</Text> : plans.length ? plans.map((plan) => <SavingsPayoutCard key={plan.id} plan={plan} now={now} busy={busy} onConfirm={() => onConfirm(plan)} />) : <Text className="mt-4 text-xs text-[#657286]" style={{ textAlign: "right" }}>لا توجد خطط نشطة بموعد استحقاق حالي.</Text>}
  </Card>;
}

function SavingsPayoutCard({ plan, now, busy, onConfirm }: { plan: any; now: number; busy: boolean; onConfirm: () => void }) {
  const frequency = plan.frequency as SavingsFrequency;
  const product = getSavingsProduct(frequency);
  const dueAt = new Date(plan.nextPayoutAt);
  const countdown = getSavingsPayoutCountdown(dueAt, now);
  const periodKey = savingsPeriodKey(frequency, dueAt);
  const payout = plan.payouts?.find((item: any) => item.periodKey === periodKey);
  const alreadyPaid = payout?.status === "paid";
  const blocked = payout?.status === "blocked";
  const expected = calculateExpectedInterestAtRate(plan.principalAmount, Number(plan.ratePpm) || ratePercentToPpm(plan.ratePercent));
  const amount = roundInterestToWallet(expected);
  const customerNumber = plan.customer?.customerId || plan.userId;

  return <View className="mt-3 rounded-2xl border border-[#273548] bg-[#0B1018] p-3">
    <View className="flex-row items-center justify-between"><Pill tone={alreadyPaid ? "green" : countdown.isDue ? "gold" : "muted"}>{alreadyPaid ? "تم الإرسال" : countdown.isDue ? "مستحقة" : "قيد الانتظار"}</Pill><Text className="text-sm font-bold text-[#F7F1E3]">{plan.customer?.name || "عميل"}</Text></View>
    <Text className="mt-2 text-xs text-[#9BA8B8]" style={{ textAlign: "right" }}>رقم المستخدم: {customerNumber} · الخطة: {product.label}</Text>
    <View className="mt-3 flex-row flex-wrap gap-2"><Stat label="المبلغ المدخر" value={`${formatMoney(plan.principalAmount)}`} /><Stat label="قيمة الأرباح" value={`${formatMoney(amount)}`} /></View>
    <Text className="mt-3 text-xs text-[#9BA8B8]" style={{ textAlign: "right" }}>موعد الاستحقاق: {dueAt.toLocaleString("ar-EG")}</Text>
    {alreadyPaid ? <Text className="mt-2 text-sm font-bold text-[#47D7A5]" style={{ textAlign: "right" }}>تم إرسال الأرباح بنجاح عن هذه الفترة.</Text> : countdown.isDue ? <>
      <Text className="mt-2 text-sm font-bold text-[#D7A948]" style={{ textAlign: "right" }}>حان موعد الاستحقاق؛ بانتظار تأكيد المدير.</Text>
      {blocked && payout?.blockReason ? <Text className="mt-1 text-xs text-[#FF9AA7]" style={{ textAlign: "right" }}>تعذر الإرسال السابق: {payout.blockReason}</Text> : null}
      <View className="mt-3"><ActionButton label={busy ? "جارٍ تأكيد الإرسال..." : "تأكيد إرسال الأرباح"} icon="checkmark-circle-outline" onPress={onConfirm} /></View>
    </> : <Text className="mt-2 text-xs text-[#D7A948]" style={{ textAlign: "right" }}>الوقت المتبقي: {formatSavingsCountdown(countdown.remainingMs ?? 0)}</Text>}
  </View>;
}

function FinancingWalletPanel({ data, loading, amount, source, setAmount, setSource, busy, onAdd }: { data?: any; loading: boolean; amount: string; source: string; setAmount: (value: string) => void; setSource: (value: string) => void; busy: boolean; onAdd: () => void }) {
  const typeText: Record<string, string> = { manual_funding: "إضافة تمويل", savings_principal: "أصل إدخار وارد", savings_profit: "عائد مصروف", savings_refund: "أصل مسترد" };
  return <Card className="mb-4 border-[#5C4A28]">
    <View className="flex-row items-center justify-between"><Pill tone="gold">EGP</Pill><Text className="text-base font-bold text-[#F7F1E3]">محفظة تمويل الإدخار</Text></View>
    <Text className="mt-2 text-xs leading-5 text-[#9BA8B8]" style={{ textAlign: "right" }}>محفظة مستقلة عن محفظة المدير الحالية. لا يُصرف أي عائد أو أصل مسترد إذا لم يكن الرصيد متاحًا، وكل حركة مرتبطة برقم عملية فريد.</Text>
    {loading ? <ActivityIndicator className="mt-4" color="#D7A948" /> : <>
      <View className="mt-4 flex-row flex-wrap gap-2"><Stat label="الرصيد المتاح" value={`${formatMoney(data?.wallet?.balance)}`} /><Stat label="الوارد من الإدخار" value={`${formatMoney(data?.totals?.savingsReceived)}`} /><Stat label="العوائد المصروفة" value={`${formatMoney(data?.totals?.profitPaid)}`} /><Stat label="المبالغ المستردة" value={`${formatMoney(data?.totals?.principalRefunded)}`} /><Stat label="التمويل اليدوي" value={`${formatMoney(data?.totals?.manualFunding)}`} /></View>
      <Text className="mb-2 mt-5 text-sm font-bold text-[#F7F1E3]" style={{ textAlign: "right" }}>إضافة تمويل</Text>
      <TextInput value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="المبلغ بالجنيه المصري" placeholderTextColor="#657286" style={{ minHeight: 48, borderWidth: 1, borderColor: "#273548", borderRadius: 14, backgroundColor: "#0B1018", color: "#F7F1E3", paddingHorizontal: 14, textAlign: "right", writingDirection: "ltr" }} />
      <TextInput value={source} onChangeText={setSource} placeholder="مصدر التمويل" placeholderTextColor="#657286" style={{ marginTop: 10, minHeight: 48, borderWidth: 1, borderColor: "#273548", borderRadius: 14, backgroundColor: "#0B1018", color: "#F7F1E3", paddingHorizontal: 14, textAlign: "right" }} />
      <View className="mt-3"><ActionButton label={busy ? "جارٍ تسجيل التمويل..." : "إضافة تمويل"} icon="add-circle-outline" onPress={onAdd} /></View>
      <Text className="mb-2 mt-6 text-sm font-bold text-[#F7F1E3]" style={{ textAlign: "right" }}>سجل إرسال أرباح الإدخار للعملاء</Text>
      {data?.profitDispatches?.length ? data.profitDispatches.map((dispatch: any) => <ProfitDispatchRow key={dispatch.id} dispatch={dispatch} />) : <Text className="text-xs text-[#657286]" style={{ textAlign: "right" }}>لا توجد عمليات إرسال أرباح أو عمليات مرفوضة بسبب عدم كفاية الرصيد.</Text>}
      <Text className="mb-2 mt-5 text-sm font-bold text-[#F7F1E3]" style={{ textAlign: "right" }}>سجل محفظة التمويل</Text>
      {data?.entries?.length ? data.entries.map((entry: any) => <View key={entry.id} className="mb-2 rounded-2xl border border-[#273548] bg-[#0B1018] p-3"><View className="flex-row items-center justify-between"><Pill tone={entry.direction === "credit" ? "green" : "red"}>{entry.direction === "credit" ? "إضافة" : "خصم"}</Pill><Text className="text-sm font-semibold text-[#F7F1E3]">{typeText[entry.type] ?? entry.type}</Text></View><Text className="mt-2 text-sm font-bold text-[#D7A948]" style={{ writingDirection: "ltr", textAlign: "right" }}>{formatMoney(entry.amount)}</Text><Text className="mt-1 text-xs text-[#9BA8B8]" style={{ textAlign: "right" }}>{entry.customerName ? `العميل: ${entry.customerName} · ` : ""}{entry.source}</Text><Text className="mt-1 text-[11px] text-[#657286]" style={{ textAlign: "right" }}>{entry.adminName} · {new Date(entry.createdAt).toLocaleString("ar-EG")} · {entry.reference} · قبل {formatMoney(entry.balanceBefore)} / بعد {formatMoney(entry.balanceAfter)}</Text></View>) : <Text className="text-xs text-[#657286]" style={{ textAlign: "right" }}>لا توجد حركات مسجلة بعد.</Text>}
    </>}
  </Card>;
}

const frequencyText: Record<string, string> = { daily: "يومي", monthly: "شهري", yearly: "سنوي" };

function ProfitDispatchRow({ dispatch }: { dispatch: any }) {
  const successful = dispatch.status === "success";
  return <View className="mb-2 rounded-2xl border border-[#5C4A28] bg-[#0B1018] p-3">
    <View className="flex-row items-center justify-between"><Pill tone={successful ? "green" : "red"}>{successful ? "ناجحة" : "مرفوضة"}</Pill><Text className="text-sm font-semibold text-[#F7F1E3]">{successful ? "إرسال عائد الإدخار" : "مرفوضة بسبب عدم كفاية الرصيد"}</Text></View>
    <Text className="mt-2 text-base font-bold text-[#D7A948]" style={{ writingDirection: "ltr", textAlign: "right" }}>{formatMoney(dispatch.amount)}</Text>
    <Text className="mt-2 text-xs leading-5 text-[#9BA8B8]" style={{ textAlign: "right" }}>العميل: {dispatch.customerName || "غير متاح"} · الرقم: {dispatch.customerNumber || "غير متاح"}</Text>
    <Text className="mt-1 text-xs leading-5 text-[#9BA8B8]" style={{ textAlign: "right" }}>الخطة: {dispatch.planReference || "غير متاح"} · الفترة: {frequencyText[dispatch.frequency] || dispatch.frequency || "غير متاح"} · الاستحقاق: {dispatch.periodKey || "غير متاح"}</Text>
    <Text className="mt-1 text-xs leading-5 text-[#9BA8B8]" style={{ textAlign: "right" }}>وقت الإرسال: {new Date(dispatch.createdAt).toLocaleString("ar-EG")}</Text>
    <Text className="mt-1 text-xs leading-5 text-[#9BA8B8]" style={{ textAlign: "right" }}>رصيد التمويل قبل الخصم: {dispatch.balanceBefore == null ? "لم يُخصم" : `${formatMoney(dispatch.balanceBefore)}`} · بعد الخصم: {dispatch.balanceAfter == null ? "لم يُخصم" : `${formatMoney(dispatch.balanceAfter)}`}</Text>
    {!successful && dispatch.statusReason ? <Text className="mt-1 text-xs leading-5 text-[#FF9AA7]" style={{ textAlign: "right" }}>السبب: {dispatch.statusReason}</Text> : null}
    <Text className="mt-1 text-[11px] text-[#657286]" style={{ textAlign: "right" }}>المرجع: {dispatch.reference}</Text>
  </View>;
}

function AdminPlan({ plan, reason, setReason, busy, onReview }: { plan: any; reason: string; setReason: (value: string) => void; busy: boolean; onReview: (decision: "approve" | "reject") => void }) {
  const product = getSavingsProduct(plan.frequency as SavingsFrequency);
  return <Card className="mb-4">
    <View className="flex-row items-center justify-between"><Pill tone={plan.status === "active" ? "green" : plan.status === "rejected" ? "red" : "gold"}>{statusText[plan.status] ?? plan.status}</Pill><Text className="text-base font-bold text-[#F7F1E3]">{plan.customer?.name || "عميل"}</Text></View>
    <Text className="mt-1 text-xs text-[#9BA8B8]" style={{ textAlign: "right" }}>{plan.customer?.email || ""} · {plan.reference}</Text>
    <View className="mt-4 flex-row flex-wrap gap-2"><Stat label="الأصل" value={`${formatMoney(plan.principalAmount)}`} /><Stat label="النظام" value={`${product.label} · ${plan.ratePercent}%`} /><Stat label="متراكم" value={`${Number(plan.totalAccrued ?? 0).toFixed(4)} ج.م`} /><Stat label="مدفوع" value={`${formatMoney(plan.totalPaid)}`} /></View>
    <Text className="mt-3 text-xs text-[#9BA8B8]" style={{ textAlign: "right" }}>تقديم: {new Date(plan.createdAt).toLocaleString("ar-EG")} · موافقة: {plan.approvedAt ? new Date(plan.approvedAt).toLocaleString("ar-EG") : "لم تتم"}</Text>
    <Text className="mt-1 text-xs text-[#9BA8B8]" style={{ textAlign: "right" }}>الاسترداد متاح: {plan.refundEligibleAt ? new Date(plan.refundEligibleAt).toLocaleString("ar-EG") : "غير محدد"}{plan.refundedAt ? ` · تم الاسترداد: ${new Date(plan.refundedAt).toLocaleString("ar-EG")}` : ""}</Text>
    {plan.status === "pending_approval" ? <View className="mt-4"><TextInput value={reason} onChangeText={setReason} placeholder="سبب الرفض عند الحاجة" placeholderTextColor="#657286" style={{ minHeight: 48, borderWidth: 1, borderColor: "#273548", borderRadius: 14, backgroundColor: "#0B1018", color: "#F7F1E3", paddingHorizontal: 14, textAlign: "right" }} /><View className="mt-3 flex-row gap-2"><View className="flex-1"><ActionButton label={busy ? "جارٍ..." : "موافقة وخصم الأصل"} icon="checkmark-circle-outline" onPress={() => onReview("approve")} /></View><View className="flex-1"><ActionButton label="رفض وتحرير الحجز" icon="close-circle-outline" secondary onPress={() => onReview("reject")} /></View></View></View> : null}
    {plan.payouts?.length ? <Text className="mt-4 text-xs text-[#9BA8B8]" style={{ textAlign: "right" }}>عدد الدفعات المسجلة: {plan.payouts.length} · آخر دفعة: {plan.lastPayoutAt ? new Date(plan.lastPayoutAt).toLocaleString("ar-EG") : "لا توجد"}</Text> : null}
  </Card>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return <View className="min-w-[46%] flex-1 rounded-2xl border border-[#273548] bg-[#0B1018] p-3"><Text className="text-[11px] text-[#9BA8B8]">{label}</Text><Text className="mt-1 text-sm font-bold text-[#F7F1E3]" style={{ writingDirection: "ltr" }}>{value}</Text></View>;
}
