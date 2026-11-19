import { getApiBaseUrl } from "@/constants/api";

export const GAME_TOPUP_STATUS_TONE: Record<string, "gold" | "green" | "red" | "muted"> = {
  new: "gold",
  under_review: "gold",
  approved: "green",
  processing: "gold",
  completed: "green",
  rejected: "red",
  cancelled: "muted",
};

export const GAME_TOPUP_STATUS_LABELS: Record<string, string> = {
  new: "جديد",
  under_review: "قيد المراجعة",
  approved: "مقبول",
  processing: "جارٍ التنفيذ",
  completed: "مكتمل",
  rejected: "مرفوض",
  cancelled: "ملغي",
};

/** Game images may be absolute CDN URLs or project-relative `/manus-storage/...` paths. */
export function resolveGameImageUrl(url?: string | null): string | null {
  if (!url) return null;
  if (/^(https?:|data:|file:|blob:)/i.test(url)) return url;
  const base = getApiBaseUrl();
  return `${base}${url.startsWith("/") ? "" : "/"}${url}`;
}

export function formatGameQuantity(quantity: number, currencyLabel: string) {
  return `${quantity.toLocaleString("en-US")} ${currencyLabel}`;
}

export function parseGameQuantity(value: string) {
  const normalized = value.replace(/[,\s]/g, "");
  if (!/^\d{1,9}$/.test(normalized)) return null;
  const quantity = Number(normalized);
  return Number.isInteger(quantity) && quantity > 0 ? quantity : null;
}
