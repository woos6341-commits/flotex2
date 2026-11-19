export type AccountClosureFacts = {
  walletBalance?: string | number | null;
  reservedWithdrawals?: string | number | null;
  reservedOrders?: string | number | null;
  reservedTransfers?: string | number | null;
  reservedSavings?: string | number | null;
  coinBalance?: string | number | null;
  reservedCoin?: string | number | null;
  goldGrams?: Array<string | number | null>;
  positionQuantities?: Array<string | number | null>;
  hasPendingTransaction?: boolean;
  hasPendingPaymentRequest?: boolean;
  hasPendingMoneyTransfer?: boolean;
  hasPendingOrder?: boolean;
  hasPendingCoinOrderOrTransfer?: boolean;
  hasPendingGoldOrder?: boolean;
  hasOpenSavingsPlan?: boolean;
  hasUnpaidSavingsPayout?: boolean;
  hasPendingCashLedgerEntry?: boolean;
};

function isNonZero(value: string | number | null | undefined): boolean {
  if (value === null || value === undefined) return false;
  const normalized = String(value).trim();
  if (!normalized) return false;
  return !/^[-+]?0*(?:\.0*)?$/.test(normalized);
}

export function evaluateAccountClosure(facts: AccountClosureFacts) {
  const hasFunds = [
    facts.walletBalance,
    facts.reservedWithdrawals,
    facts.reservedOrders,
    facts.reservedTransfers,
    facts.reservedSavings,
    facts.coinBalance,
    facts.reservedCoin,
    ...(facts.goldGrams ?? []),
    ...(facts.positionQuantities ?? []),
  ].some(isNonZero);

  const blockers: string[] = [];
  if (hasFunds) blockers.push("يوجد رصيد أو أصل أو مبلغ محجوز يجب تسويته أولًا.");
  if (facts.hasPendingTransaction || facts.hasPendingPaymentRequest || facts.hasPendingMoneyTransfer) {
    blockers.push("توجد معاملة مالية معلّقة لم تُسوَّ بعد.");
  }
  if (facts.hasPendingOrder || facts.hasPendingCoinOrderOrTransfer || facts.hasPendingGoldOrder) {
    blockers.push("يوجد أمر تداول أو كوين أو ذهب قيد التنفيذ.");
  }
  if (facts.hasOpenSavingsPlan || facts.hasUnpaidSavingsPayout) {
    blockers.push("توجد خطة إدخار أو دفعة مستحقة لم تُسوَّ بعد.");
  }
  if (facts.hasPendingCashLedgerEntry) blockers.push("يوجد قيد مالي معلّق في دفتر المحفظة.");

  return { eligible: blockers.length === 0, blockers };
}
