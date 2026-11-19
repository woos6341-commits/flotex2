export function formatMoneyAmount(value: string | number | null | undefined): string {
  return Number(value ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatMoney(value: string | number | null | undefined): string {
  return `${formatMoneyAmount(value)} ج.م`;
}
