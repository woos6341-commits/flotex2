import { formatMoneyMinorUnits, parseMoneyMinorUnits } from "../shared/transactions";

export function buildRequestSubmittedPush(
  type: "deposit" | "withdrawal",
  reference: string,
  amount: string,
  feeAmount: string,
) {
  const totalAmount = formatMoneyMinorUnits(parseMoneyMinorUnits(amount) + parseMoneyMinorUnits(feeAmount));
  const title = type === "deposit" ? "تم تسجيل طلب الإيداع" : "تم تسجيل طلب السحب";
  const body = type === "deposit"
    ? `رقم الطلب ${reference} وقيمته ${amount} ج.م قيد المراجعة. الإيداع مجاني بلا رسوم.`
    : `طلب السحب ${amount} ج.م؛ الرسوم ${feeAmount} ج.م؛ إجمالي المبلغ المحجوز ${totalAmount} ج.م. الطلب قيد المراجعة.`;

  return {
    operationId: `request-created:${reference}`,
    title,
    body,
    data: { type, reference, event: "submitted" },
  };
}
