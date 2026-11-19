import { getApiBaseUrl } from "@/constants/api";
import type { PaymentMethodField } from "@/shared/payment-method-fields";

export const PAYMENT_METHOD_IDS = ["vodafone", "orange", "etisalat", "instapay"] as const;
export type PaymentMethodId = string;

export type PaymentMethod = {
  id: string;
  name: string;
  imageUrl: string | null;
  transferNumber: string | null;
  enabled: boolean;
  fields: PaymentMethodField[];
};

export type PaymentLimits = {
  minDepositAmount: number;
  minWithdrawalAmount: number;
  minTransferAmount: number;
  maxDepositAmount: number | null;
  maxWithdrawalAmount: number | null;
  [key: string]: unknown;
};

export type PaymentImageMimeType = "image/jpeg" | "image/png" | "image/webp";

/** Turns managed storage paths into URLs that also work on native devices. */
export function resolvePaymentImageUrl(imageUrl: string | null | undefined) {
  if (!imageUrl) return null;
  if (/^https?:\/\//i.test(imageUrl) || imageUrl.startsWith("data:")) return imageUrl;
  const origin = getApiBaseUrl();
  if (!origin) return imageUrl;
  return `${origin}${imageUrl.startsWith("/") ? "" : "/"}${imageUrl}`;
}

export function createPaymentOperationId(type: "deposit" | "withdrawal" | "transfer") {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  const random = cryptoApi?.randomUUID?.()?.replace(/-/g, "").slice(0, 16) ?? Math.random().toString(36).slice(2, 14);
  const operation = type === "deposit" ? "DEP" : type === "withdrawal" ? "WDR" : "TRF";
  return `ATH-${operation}-${Date.now().toString(36).toUpperCase()}-${random.toUpperCase()}`;
}

export function normalizePaymentAmountText(value: string) {
  return value.replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit))).replace(/,/g, "").trim();
}

export function normalizePaymentAmount(value: string) {
  return Number(normalizePaymentAmountText(value));
}

export function isPaymentAmountValid(value: string) {
  const normalized = normalizePaymentAmountText(value);
  return /^\d+(?:\.\d{1,2})?$/.test(normalized) && Number.isFinite(Number(normalized));
}

/** Expo returns JPEG bytes for native base64 image data even when asset.mimeType says PNG. */
export function detectPaymentImageMimeType(base64: string): PaymentImageMimeType | null {
  const signature = base64.replace(/\s/g, "");
  if (signature.startsWith("/9j/")) return "image/jpeg";
  if (signature.startsWith("iVBORw0KGgo")) return "image/png";
  if (signature.startsWith("UklGR")) return "image/webp";
  return null;
}

export function formatPaymentAmount(value: number | string | null | undefined) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return "0.00 ج.م";
  return `${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ج.م`;
}

/** Keep API failures readable without exposing a serialized error envelope to users. */
export function paymentErrorMessage(error: unknown, fallback: string) {
  const candidate = error instanceof Error ? error.message : "";
  const message = candidate.replace(/\s+/g, " ").trim();
  if (!message || message.length > 220 || /^(TRPC|Fetch|Network|JSON|HTTP)\b/i.test(message)) return fallback;
  return message;
}
