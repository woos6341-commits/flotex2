import { KeyboardAwareScrollView as ScrollView } from "@/components/KeyboardAwareScrollView";
import { useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Card, EmptyState, Pill, Screen, formatMoney } from "@/components/atheer-ui";
import { VerifiedName } from "@/components/VerifiedName";
import { trpc } from "@/lib/trpc";
import { manualAuthClient } from "@/lib/manual-auth-client";
import { useEphemeralMutation } from "@/hooks/use-ephemeral-mutation";
import { createPaymentOperationId, formatPaymentAmount, isPaymentAmountValid, normalizePaymentAmountText, paymentErrorMessage } from "@/lib/payment-client";
import { getTransferFeeMinorUnits } from "@/shared/fee-policy";
import { formatMoneyMinorUnits, tryParseMoneyMinorUnits } from "@/shared/transactions";

type TransferStatus = "pending" | "approved" | "rejected" | "cancelled";
const STATUS_LABELS: Record<TransferStatus, string> = { pending: "قيد المراجعة", approved: "مقبولة", rejected: "مرفوضة", cancelled: "ملغاة" };
function statusTone(status: TransferStatus): "gold" | "green" | "red" | "muted" {
  return status === "approved" ? "green" : status === "rejected" ? "red" : status === "cancelled" ? "muted" : "gold";
}
function normalizeDigits(value: string) {
  return value.replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit))).replace(/\D/g, "").slice(0, 10);
}

export default function MoneyTransferScreen() {
  const router = useRouter();
  const [customerId, setCustomerId] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [formError, setFormError] = useState("");
  const [success, setSuccess] = useState("");
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [pinVisible, setPinVisible] = useState(false);
  const [securityPin, setSecurityPin] = useState("");
  const [pinError, setPinError] = useState("");
  const operationRef = useRef<{ signature: string; id: string } | null>(null);
  const limits = trpc.payment.limits.useQuery(undefined, { refetchInterval: 30000 });
  const feePolicy = trpc.payment.fees.useQuery(undefined, { refetchInterval: 30000 });
  const portfolio = trpc.portfolio.get.useQuery(undefined, { refetchInterval: 10000, refetchOnWindowFocus: true });
  const recipientId = normalizeDigits(customerId);
  const recipient = trpc.transfers.lookupRecipient.useQuery({ customerId: recipientId }, { enabled: recipientId.length === 10, retry: false });
  const transfers = trpc.transfers.mine.useQuery(undefined, { refetchInterval: 10000, refetchOnWindowFocus: true });
  const utils = trpc.useUtils();
  const create = useEphemeralMutation(manualAuthClient.transfers.create.mutate);
  const cancel = trpc.transfers.cancel.useMutation();
  const minAmount = Number(limits.data?.minTransferAmount ?? 1200);
  const available = Number(portfolio.data?.available?.available ?? 0);
  const normalizedAmount = normalizePaymentAmountText(amount);
  const parsedAmountMinor = tryParseMoneyMinorUnits(normalizedAmount);
  const amountMinor = parsedAmountMinor !== null && parsedAmountMinor > 0 ? parsedAmountMinor : 0;
  const amountValue = amountMinor / 100;
  const availableMinor = tryParseMoneyMinorUnits(String(portfolio.data?.available?.available ?? "0")) ?? 0;
  const feeMinor = feePolicy.data ? getTransferFeeMinorUnits(feePolicy.data) : 0;
  const feeAmount = formatMoneyMinorUnits(feeMinor);
  const totalDebit = formatMoneyMinorUnits(amountMinor + feeMinor);
  const resolvedName = recipient.data?.name ?? "";

  const askForConfirmation = () => {
    setFormError("");
    setSuccess("");
    if (recipientId.length !== 10) {
      setFormError("أدخل ID صحيحًا مكوّنًا من 10 أرقام.");
      return;
    }
    if (recipient.isFetching) {
      setFormError("جارٍ التحقق من رقم المستلم؛ انتظر لحظة.");
      return;
    }
    if (recipient.isError) {
      setFormError(paymentErrorMessage(recipient.error, "تعذر التحقق من المستلم."));
      return;
    }
    if (!resolvedName) {
      setFormError("لا يوجد مستخدم مسجل بهذا الرقم.");
      return;
    }
    if (!feePolicy.data) {
      setFormError("تعذر تحميل رسوم الإرسال الآمنة من الخادم. حاول مرة أخرى.");
      return;
    }
    if (!isPaymentAmountValid(normalizedAmount) || amountValue <= 0) {
      setFormError("أدخل مبلغًا صحيحًا بالجنيه المصري حتى منزلتين عشريتين.");
      return;
    }
    if (amountValue < minAmount) {
      setFormError(`الحد الأدنى لإرسال الأموال هو ${formatPaymentAmount(minAmount)}.`);
      return;
    }
    if (amountMinor + feeMinor > availableMinor) {
      setFormError(`الرصيد غير كافٍ للمبلغ ورسوم الإرسال. المطلوب ${formatMoney(totalDebit)} والمتاح ${formatMoney(available)}.`);
      return;
    }
    if (note.trim().length > 300) {
      setFormError("الملاحظة لا تتجاوز 300 حرف.");
      return;
    }
    setConfirmVisible(true);
  };

  const confirmTransfer = async () => {
    if (create.isPending) return;
    if (!/^\d{4}$/.test(securityPin)) { setPinError("أدخل رمز الأمان المكون من 4 أرقام."); setPinVisible(true); return; }
    setPinError("");
    setPinVisible(false);
    const signature = JSON.stringify({ recipientCustomerId: recipientId, amount: normalizedAmount, note: note.trim() });
    if (!operationRef.current || operationRef.current.signature !== signature) {
      operationRef.current = { signature, id: createPaymentOperationId("transfer") };
    }
    try {
      const result = await create.mutateAsync({ recipientCustomerId: recipientId, amount: normalizedAmount, note: note.trim() || undefined, operationId: operationRef.current.id, securityPin });
        operationRef.current = null;
        setConfirmVisible(false);
        setCustomerId("");
        setAmount("");
        setNote("");
        setSecurityPin("");
        setSuccess(result.status === "pending"
          ? `تم تسجيل طلب التحويل رقم ${result.reference}. سيصل ${formatMoney(amountMinor ? formatMoneyMinorUnits(amountMinor) : normalizedAmount)} للمستلم، ورسم الإرسال ${formatMoney(result.feeAmount)}، وإجمالي المحجوز ${formatMoney(result.totalDebit)}.`
          : `الطلب ${result.reference} مسجل بالفعل؛ حالته ${STATUS_LABELS[result.status]}، ورسمه ${formatMoney(result.feeAmount)} وإجمالي الخصم ${formatMoney(result.totalDebit)}.`);
        void portfolio.refetch();
        void transfers.refetch();
        void utils.portfolio.transactions.invalidate();
    } catch (error) { setFormError(paymentErrorMessage(error, "تعذر إرسال طلب التحويل.")); }
    finally { setSecurityPin(""); }
  };

  const cancelRequest = (transferId: number) => {
    setFormError("");
    cancel.mutate({ transferId }, {
      onSuccess: () => {
        setSuccess("تم إلغاء الطلب وإعادة مبلغ التحويل ورسومه المحجوزة إلى رصيدك المتاح.");
        void transfers.refetch();
        void portfolio.refetch();
        void utils.portfolio.transactions.invalidate();
      },
      onError: (error) => setFormError(paymentErrorMessage(error, "تعذر إلغاء الطلب.")),
    });
  };

  return (
    <Screen title="إرسال أموال" subtitle="تحويل داخلي إلى عميل آخر — الإضافة للمستلم بعد موافقة الإدارة" right={<Pressable accessibilityRole="button" onPress={() => router.back()} className="h-10 w-10 items-center justify-center rounded-xl border border-[#273548] bg-[#121B28]"><Ionicons name="arrow-forward" size={20} color="#D7A948" /></Pressable>}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 120 }}>
        <Card>
          <View className="flex-row items-center justify-between"><View><Text className="text-xs text-[#9BA8B8]">الرصيد المتاح للتحويل</Text><Text className="mt-2 text-2xl font-bold text-[#F7F1E3]">{formatMoney(portfolio.data?.available?.available)}</Text></View><Ionicons name="wallet-outline" size={26} color="#D7A948" /></View>
          <Text className="mt-3 text-xs text-[#9BA8B8]">الحد الأدنى الحالي: {formatPaymentAmount(minAmount)}. عند إرسال الطلب يُحجز المبلغ حتى تتم مراجعته.</Text>
          {feePolicy.data ? <Text className="mt-2 text-xs text-[#9BA8B8]">رسوم الإرسال الحالية: {formatMoney(feeAmount)}؛ الإيداع مجاني دائمًا.</Text> : feePolicy.isError ? <Text className="mt-2 text-xs text-[#FF7D8D]">تعذر تحميل سياسة الرسوم.</Text> : <Text className="mt-2 text-xs text-[#9BA8B8]">جارٍ تحميل رسوم الإرسال من الخادم…</Text>}
        </Card>
        <Card className="mt-4">
          <Text className="text-base font-bold text-[#F7F1E3]">بيانات التحويل</Text>
          <Text className="mb-2 mt-4 text-xs text-[#9BA8B8]">ID المستلم (10 أرقام)</Text>
          <TextInput value={customerId} onChangeText={(value) => { setCustomerId(normalizeDigits(value)); setFormError(""); }} keyboardType="number-pad" maxLength={10} textAlign="right" placeholder="أدخل رقم ID" placeholderTextColor="#657286" className="rounded-2xl border border-[#273548] bg-[#0B1018] px-4 py-3 text-[#F7F1E3]" />
          {recipientId.length === 10 && <View className="mt-3 rounded-2xl border border-[#273548] bg-[#0B1018] p-3">{recipient.isFetching ? <View className="flex-row items-center gap-2"><ActivityIndicator size="small" color="#D7A948" /><Text className="text-xs text-[#9BA8B8]">جارٍ التحقق من المستلم…</Text></View> : recipient.isError ? <Text className="text-sm text-[#FF7D8D]">{paymentErrorMessage(recipient.error, "تعذر التحقق من هذا الرقم.")}</Text> : resolvedName ? <View className="flex-row flex-wrap items-center gap-1"><Text className="text-sm text-[#9BA8B8]">المستلم:</Text><VerifiedName name={resolvedName} verified={recipient.data?.isVerified === true} nameClassName="text-sm font-semibold text-[#F7F1E3]" /></View> : recipient.data === null ? <Text className="text-sm text-[#FF7D8D]">لا يوجد مستخدم مسجل بهذا الرقم.</Text> : <Text className="text-sm text-[#9BA8B8]">يتم التحقق من الرقم.</Text>}</View>}
          <Text className="mb-2 mt-4 text-xs text-[#9BA8B8]">المبلغ بالجنيه المصري</Text>
          <TextInput value={amount} onChangeText={(value) => { setAmount(value); setFormError(""); }} keyboardType="decimal-pad" textAlign="right" placeholder="مثال: 1200.00" placeholderTextColor="#657286" className="rounded-2xl border border-[#273548] bg-[#0B1018] px-4 py-3 text-[#F7F1E3]" />
          {amountMinor > 0 && feePolicy.data && <View className="mt-3 rounded-2xl border border-[#5C4A28] bg-[#171D27] p-3"><Text className="text-sm text-[#F7F1E3]">المبلغ الذي سيصل للمستلم: {formatMoney(formatMoneyMinorUnits(amountMinor))}</Text><Text className="mt-1 text-sm text-[#9BA8B8]">رسوم الإرسال: {formatMoney(feeAmount)}</Text><Text className="mt-1 text-sm font-bold text-[#D7A948]">إجمالي المخصوم من رصيدك: {formatMoney(totalDebit)}</Text></View>}
          <Text className="mb-2 mt-4 text-xs text-[#9BA8B8]">ملاحظة (اختيارية)</Text>
          <TextInput value={note} onChangeText={setNote} multiline maxLength={300} textAlign="right" textAlignVertical="top" placeholder="اكتب ملاحظة للمستلم" placeholderTextColor="#657286" className="min-h-20 rounded-2xl border border-[#273548] bg-[#0B1018] px-4 py-3 text-[#F7F1E3]" />
          {formError ? <Text className="mt-3 text-sm leading-5 text-[#FF7D8D]">{formError}</Text> : null}
          {success ? <Text className="mt-3 text-sm leading-5 text-[#47D7A5]">{success}</Text> : null}
          <Pressable accessibilityRole="button" disabled={create.isPending} onPress={askForConfirmation} className={`mt-5 flex-row items-center justify-center gap-2 rounded-2xl px-4 py-4 ${create.isPending ? "bg-[#657286]" : "bg-[#D7A948]"}`}><Ionicons name="send-outline" size={18} color="#0B1018" /><Text className="font-bold text-[#0B1018]">تأكيد التحويل</Text></Pressable>
        </Card>

        <Text className="mb-3 mt-8 text-lg font-bold text-[#F7F1E3]">طلباتي المرسلة</Text>
        {transfers.isLoading ? <ActivityIndicator color="#D7A948" /> : transfers.isError ? <Text className="text-sm text-[#FF7D8D]">تعذر تحميل طلبات التحويل.</Text> : transfers.data?.length ? transfers.data.map((item) => <Card key={item.id} className="mb-3">
          <View className="flex-row items-start justify-between gap-2"><View className="flex-1"><View className="flex-row flex-wrap items-center gap-1"><Text className="text-xs text-[#9BA8B8]">إلى</Text><VerifiedName name={item.recipient.name} verified={item.recipient.isVerified} nameClassName="font-semibold text-[#F7F1E3]" /></View><Text className="mt-1 text-xs text-[#657286]">{item.reference}</Text></View><Pill tone={statusTone(item.status as TransferStatus)}>{STATUS_LABELS[item.status as TransferStatus]}</Pill></View>
          <Text className="mt-3 text-sm text-[#F7F1E3]">المبلغ الواصل: {formatMoney(item.amount)}</Text>
          <Text className="mt-1 text-xs text-[#9BA8B8]">رسوم الإرسال: {formatMoney(item.feeAmount)}</Text>
          <Text className="mt-1 text-sm font-bold text-[#D7A948]">إجمالي الخصم: {formatMoney(item.totalDebit)}</Text>
          <Text className="mt-1 text-xs text-[#9BA8B8]">{new Date(item.createdAt).toLocaleString("ar-EG")}</Text>
          {item.note && <Text className="mt-2 text-xs leading-5 text-[#9BA8B8]">ملاحظتك: {item.note}</Text>}
          {item.rejectionReason && <Text className="mt-2 text-xs leading-5 text-[#FF7D8D]">سبب الرفض: {item.rejectionReason}</Text>}
          {item.status === "pending" && <Pressable disabled={cancel.isPending} onPress={() => cancelRequest(item.id)} className="mt-4 self-start rounded-xl border border-[#FF7D8D55] px-4 py-2"><Text className="text-sm font-semibold text-[#FF7D8D]">{cancel.isPending ? "جارٍ الإلغاء" : "إلغاء الطلب وإعادة المبلغ"}</Text></Pressable>}
        </Card>) : <EmptyState title="لا توجد طلبات إرسال" text="ستظهر هنا طلباتك وحالات المراجعة وأسباب الرفض." />}
      </ScrollView>
      <Modal transparent animationType="fade" visible={confirmVisible} onRequestClose={() => !create.isPending && setConfirmVisible(false)}>
        <ScrollView style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.70)" }} contentContainerStyle={{ flexGrow: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 20 }}>
          <View className="w-full max-w-lg rounded-3xl border border-[#273548] bg-[#121B28] p-5">
            <Text className="text-lg font-bold text-[#F7F1E3]">تأكيد تفاصيل التحويل</Text>
            <Text className="mt-4 text-sm text-[#9BA8B8]">سيُرسل الطلب للمراجعة، ولن يصل المال إلى المستلم قبل موافقة الإدارة.</Text>
            <View className="mt-4 rounded-2xl border border-[#273548] bg-[#0B1018] p-4"><Text className="text-xs text-[#9BA8B8]">اسم المستلم</Text><Text className="mt-1 text-base font-bold text-[#F7F1E3]">{resolvedName}</Text><Text className="mt-3 text-xs text-[#9BA8B8]">المبلغ الذي سيصل للمستلم</Text><Text className="mt-1 text-xl font-bold text-[#D7A948]">{formatPaymentAmount(amountValue)}</Text><Text className="mt-3 text-xs text-[#9BA8B8]">رسوم الإرسال</Text><Text className="mt-1 text-base font-semibold text-[#F7F1E3]">{formatMoney(feeAmount)}</Text><Text className="mt-3 text-xs text-[#9BA8B8]">إجمالي المخصوم من رصيدك</Text><Text className="mt-1 text-xl font-bold text-[#D7A948]">{formatMoney(totalDebit)}</Text></View>
            {note.trim() ? <Text className="mt-3 text-xs leading-5 text-[#9BA8B8]">الملاحظة: {note.trim()}</Text> : null}
            {formError ? <Text className="mt-3 text-sm text-[#FF7D8D]">{formError}</Text> : null}
            <View className="mt-5 flex-row gap-2"><Pressable disabled={create.isPending} onPress={() => setConfirmVisible(false)} className="flex-1 items-center rounded-2xl border border-[#273548] px-3 py-3"><Text className="font-semibold text-[#9BA8B8]">رجوع</Text></Pressable><Pressable disabled={create.isPending} onPress={confirmTransfer} className="flex-1 items-center rounded-2xl bg-[#D7A948] px-3 py-3"><Text className="font-bold text-[#0B1018]">{create.isPending ? "جارٍ إرسال الطلب" : "تأكيد وإرسال الطلب"}</Text></Pressable></View>
          </View>
        </ScrollView>
      </Modal>
      <Modal transparent animationType="fade" visible={pinVisible} onRequestClose={() => !create.isPending && setPinVisible(false)}>
        <ScrollView style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.70)" }} contentContainerStyle={{ flexGrow: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 20 }}>
          <View className="w-full max-w-lg rounded-3xl border border-[#5C4A28] bg-[#121B28] p-5">
            <Text className="text-lg font-bold text-[#F7F1E3]">رمز الأمان</Text>
            <Text className="mt-3 text-sm leading-6 text-[#9BA8B8]">أدخل رمز الأمان المكوّن من 4 أرقام لتأكيد إرسال الأموال. لا يُطلب الرمز قبل هذه الخطوة.</Text>
            <TextInput value={securityPin} onChangeText={(value) => { setSecurityPin(value.replace(/\D/g, "").slice(0, 4)); setPinError(""); }} keyboardType="number-pad" secureTextEntry maxLength={4} placeholder="••••" placeholderTextColor="#657286" className="mt-4 rounded-2xl border border-[#273548] bg-[#0B1018] px-4 py-4 text-center text-2xl font-bold tracking-[10px] text-[#F7F1E3]" />
            {pinError ? <Text className="mt-3 text-sm text-[#FF7D8D]">{pinError}</Text> : null}
            <View className="mt-5 flex-row gap-2"><Pressable disabled={create.isPending} onPress={() => setPinVisible(false)} className="flex-1 items-center rounded-2xl border border-[#273548] px-3 py-3"><Text className="font-semibold text-[#9BA8B8]">إلغاء</Text></Pressable><Pressable disabled={create.isPending} onPress={confirmTransfer} className="flex-1 items-center rounded-2xl bg-[#D7A948] px-3 py-3"><Text className="font-bold text-[#0B1018]">تأكيد الإرسال</Text></Pressable></View>
          </View>
        </ScrollView>
      </Modal>
    </Screen>
  );
}
