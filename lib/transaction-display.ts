import { resolveTransactionMetadata, type TransactionDirection } from "../shared/transactions";

export type TransactionDisplayInput = {
  type: string;
  amount?: string | number | null;
  status?: string | null;
  direction?: TransactionDirection | null;
  source?: string | null;
  customerTitle?: string | null;
  customerDescription?: string | null;
  displayAmount?: string | null;
  signedAmount?: string | null;
  reference?: string | null;
  createdAt?: Date | string | null;
};

export type TransactionDisplay = {
  title: string;
  description: string;
  direction: TransactionDirection;
  sign: "+" | "-" | "×";
  amount: string;
  amountText: string;
  color: "#47D7A5" | "#FF7D8D" | "#FF3B4E";
};

function absoluteDecimal(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim().replace(/^\+/, "");
  if (!/^[-]?\d+(?:\.\d+)?$/.test(normalized)) return null;
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? Math.abs(numeric).toFixed(2) : null;
}

/**
 * Converts the backend's resolved transaction metadata into the exact visual
 * contract used by every financial history row. Legacy signed amounts are
 * normalized here so neither "+-50" nor "--50" can reach the UI.
 */
export function getTransactionDisplay(item: TransactionDisplayInput): TransactionDisplay {
  const rawAmount = item.amount ?? item.signedAmount ?? item.displayAmount ?? "0";
  const resolved = resolveTransactionMetadata({
    type: item.type,
    amount: rawAmount,
    status: item.status ?? undefined,
    direction: item.direction,
    source: item.source,
    customerTitle: item.customerTitle,
    customerDescription: item.customerDescription,
  });
  const direction = item.direction ?? resolved.direction;
  const rejected = item.status === "rejected";
  const sign = rejected ? "×" : direction === "debit" ? "-" : "+";
  const title = resolved.customerTitle;
  const description = resolved.customerDescription;
  const amount = absoluteDecimal(item.displayAmount) ?? absoluteDecimal(resolved.displayAmount) ?? "0.00";

  return {
    title,
    description,
    direction,
    sign,
    amount,
    amountText: `${sign}${Number(amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ج.م`,
    color: rejected ? "#FF3B4E" : direction === "debit" ? "#FF7D8D" : "#47D7A5",
  };
}
