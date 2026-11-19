import { useState } from "react";
import { ActivityIndicator, Text, TextInput, View } from "react-native";
import { ActionButton, Card, formatMoney } from "@/components/atheer-ui";
import { trpc } from "@/lib/trpc";
import { confirmFinancialAction, showFinancialMessage } from "@/lib/financial-feedback";
import { formatMoneyMinorUnits, parseMoneyMinorUnits } from "@/shared/transactions";

const newOperationId = () => `ATH-TOPUP-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export function CustomerTopUp({ onUpdated }: { onUpdated?: () => void }) {
  const utils = trpc.useUtils();
  const [customerId, setCustomerId] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [operationId, setOperationId] = useState(newOperationId);
  const customer = trpc.admin.findCustomer.useQuery({ customerId }, { enabled: /^\d{10}$/.test(customerId) });
  const topUp = trpc.admin.topUp.useMutation({
    onSuccess: (result) => {
      void utils.admin.customerDetails.invalidate();
      void utils.admin.customers.invalidate();
      void utils.admin.stats.invalidate();
      void utils.admin.findCustomer.invalidate();
      void utils.portfolio.get.invalidate();
      void utils.portfolio.transactions.invalidate();
      onUpdated?.();
      setAmount(""); setReason(""); setOperationId(newOperationId());
      showFinancialMessage("تمت إضافة الرصيد للعميل بنجاح", `تمت إضافة ${result.amount} جنيه إلى رصيد ${result.name || result.customerId}.`);
    },
    onError: (error) => showFinancialMessage("تعذر إضافة الرصيد", error.message),
  });

  const submit = async () => {
    if (topUp.isPending) return;
    if (!customer.data?.user) { showFinancialMessage("تحقق من العميل", "أدخل رقم ID صحيحًا وتأكد من ظهور اسم العميل."); return; }
    let minor: number;
    try { minor = parseMoneyMinorUnits(amount); } catch { showFinancialMessage("مبلغ غير صالح", "أدخل مبلغًا صحيحًا حتى منزلتين عشريتين."); return; }
    if (minor <= 0) { showFinancialMessage("مبلغ غير صالح", "يجب أن يكون مبلغ الشحن أكبر من صفر."); return; }
    if (reason.trim().length < 3) { showFinancialMessage("السبب مطلوب", "اكتب سبب الشحن قبل التأكيد."); return; }
    const normalizedAmount = formatMoneyMinorUnits(minor);
    const confirmed = await confirmFinancialAction("تأكيد شحن الرصيد", `إضافة ${normalizedAmount} ج.م إلى العميل ${customer.data.user.customerId}؟`);
    if (!confirmed) return;
    topUp.mutate({ customerId: customer.data.user.customerId, amount: normalizedAmount, reason: reason.trim(), operationId });
  };

  return <Card><Text className="text-lg font-bold text-[#F7F1E3]">شحن رصيد عميل</Text><Text className="mt-1 text-xs leading-5 text-[#9BA8B8]">ابحث برقم العميل المكون من 10 أرقام، راجع الاسم، ثم سجّل شحنًا موثقًا. هذه العملية إدارية ولا تعني وصول أموال خارجية.</Text><TextInput value={customerId} onChangeText={(value) => setCustomerId(value.replace(/\D/g, "").slice(0, 10))} keyboardType="number-pad" maxLength={10} placeholder="رقم العميل: 10 أرقام" placeholderTextColor="#657286" className="mt-4 rounded-2xl border border-[#273548] bg-[#0B1018] px-4 py-3 text-[#F7F1E3]" />{/^\d{10}$/.test(customerId) && <View className="mt-3 rounded-2xl border border-[#5C4A28] bg-[#0B1018] p-3">{customer.isLoading ? <ActivityIndicator color="#D7A948" /> : <><Text className="font-bold text-[#F7F1E3]">{customer.data?.user?.name || "لم يتم العثور على العميل"}</Text>{customer.data?.user && <Text className="mt-1 text-xs text-[#D7A948]">ID: {customer.data.user.customerId} · الرصيد الحالي: {formatMoney(customer.data.wallet?.balance)}</Text>}</>}</View>}<TextInput value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="مبلغ الشحن بالجنيه المصري" placeholderTextColor="#657286" className="mt-3 rounded-2xl border border-[#273548] bg-[#0B1018] px-4 py-3 text-[#F7F1E3]" /><TextInput value={reason} onChangeText={setReason} placeholder="سبب الشحن" placeholderTextColor="#657286" className="mt-3 rounded-2xl border border-[#273548] bg-[#0B1018] px-4 py-3 text-[#F7F1E3]" /><View className="mt-4"><ActionButton label={topUp.isPending ? "جارٍ التأكيد" : "تأكيد الشحن"} icon="add-circle-outline" onPress={() => { void submit(); }} /></View><Text className="mt-3 text-[11px] leading-5 text-[#657286]">يمنع الخادم التكرار بمعرف العملية، ويسجل الرصيد قبل وبعد الشحن واسم العميل ورقمه وتاريخ العملية.</Text></Card>;
}
