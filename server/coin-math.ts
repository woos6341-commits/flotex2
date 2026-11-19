/** Integer-backed decimal arithmetic for persisted EGP (2dp) and coins (6dp). */
export function scaled(value: string | number, scale: number): bigint {
  const raw = String(value);
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(raw);
  if (!match || (match[3]?.length ?? 0) > scale) throw new Error("قيمة مالية عشرية غير صالحة");
  const units = BigInt(match[2]) * 10n ** BigInt(scale) + BigInt((match[3] ?? "").padEnd(scale, "0"));
  return match[1] ? -units : units;
}
export function decimal(units: bigint, scale: number): string {
  const absolute = units < 0n ? -units : units;
  const factor = 10n ** BigInt(scale);
  return `${units < 0n ? "-" : ""}${absolute / factor}.${String(absolute % factor).padStart(scale, "0")}`;
}
function checked(units: bigint, scale: number): string {
  const max = 10n ** BigInt(scale === 6 ? 18 : 14) - 1n;
  if (units < 0n || units > max) throw new Error("العملية تتجاوز حدود الرصيد المالي المسموح");
  return decimal(units, scale);
}
export function addDecimal(left: string | number, right: string | number, scale: number): string {
  return checked(scaled(left, scale) + scaled(right, scale), scale);
}
export function subtractDecimal(left: string | number, right: string | number, scale: number): string {
  return checked(scaled(left, scale) - scaled(right, scale), scale);
}
export function quoteCoinOrder(qty: string, price: string, fee: string, side: "buy" | "sell") {
  const micro = scaled(qty, 6);
  const cents = scaled(price, 2);
  const feeCents = scaled(fee, 2);
  // Round the product half-up exactly once to EGP cents.
  const grossCents = (micro * cents + 500_000n) / 1_000_000n;
  const totalCents = side === "buy" ? grossCents + feeCents : grossCents - feeCents;
  if (micro <= 0n || cents <= 0n || totalCents <= 0n) throw new Error("القيمة بعد الرسوم يجب أن تكون أكبر من صفر");
  return { gross: checked(grossCents, 2), fee: checked(feeCents, 2), total: checked(totalCents, 2) };
}
