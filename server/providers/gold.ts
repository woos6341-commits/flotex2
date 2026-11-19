import { ENV } from "../_core/env";

const TROY_OUNCE_GRAMS = 31.1034768;

type GoldApiResponse = {
  timestamp?: number;
  datetime?: string;
  price?: number;
  bid?: number;
  ask?: number;
  price_per_unit?: { gram?: number; troy_ounce?: number };
  melt_price_per_gram?: { "24k"?: number; "21k"?: number; "18k"?: number };
};

export type GoldQuote = {
  source: "GoldAPI.io";
  sourceSymbol: "XAU/EGP";
  ouncePrice: string;
  gram24: string;
  gram21: string;
  gram18: string;
  bid: string | null;
  ask: string | null;
  quotedAt: Date;
  isIndicative: boolean;
  rawPayload: string;
};

function fixed(value: number, digits: number) {
  if (!Number.isFinite(value) || value < 0) throw new Error("مصدر الذهب أعاد سعرًا غير صالح");
  return value.toFixed(digits);
}

export async function fetchGoldQuote(): Promise<GoldQuote> {
  if (!ENV.goldApiKey) throw new Error("لم يتم ضبط مفتاح GoldAPI على الخادم بعد");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(`${ENV.goldApiBaseUrl.replace(/\/$/, "")}/price/XAU/EGP`, {
      headers: { "x-access-token": ENV.goldApiKey, accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`تعذر جلب سعر الذهب من المصدر (${response.status})`);
    const raw = await response.text();
    const data = JSON.parse(raw) as GoldApiResponse;
    const ouncePrice = Number(data.price ?? data.price_per_unit?.troy_ounce);
    const gram24 = Number(data.melt_price_per_gram?.["24k"] ?? data.price_per_unit?.gram ?? ouncePrice / TROY_OUNCE_GRAMS);
    const quotedAt = data.timestamp ? new Date(data.timestamp * 1000) : data.datetime ? new Date(data.datetime) : new Date();
    if (!Number.isFinite(ouncePrice) || !Number.isFinite(gram24) || gram24 <= 0 || Number.isNaN(quotedAt.getTime())) throw new Error("استجابة مصدر الذهب ناقصة أو غير صالحة");
    return {
      source: "GoldAPI.io",
      sourceSymbol: "XAU/EGP",
      ouncePrice: fixed(ouncePrice, 4),
      gram24: fixed(gram24, 4),
      gram21: fixed(Number(data.melt_price_per_gram?.["21k"] ?? gram24 * 21 / 24), 4),
      gram18: fixed(Number(data.melt_price_per_gram?.["18k"] ?? gram24 * 18 / 24), 4),
      bid: data.bid == null ? null : fixed(data.bid, 4),
      ask: data.ask == null ? null : fixed(data.ask, 4),
      quotedAt,
      isIndicative: true,
      rawPayload: raw,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function getGoldPriceSourceStatus() {
  return { configured: Boolean(ENV.goldApiKey), provider: "GoldAPI.io", sourceSymbol: "XAU/EGP" };
}
