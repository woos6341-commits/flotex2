export type MarketQuote = {
  symbol: string;
  lastPrice: string;
  change: string;
  changePercent: string;
  source: string;
  isIndicative: boolean;
  quotedAt: Date;
};

export type MarketInstrument = {
  symbol: string;
  nameArabic: string;
  assetClass: "egyptian_equity" | "gold" | "investment_fund";
  exchange: string;
  dataSource: string;
  dataLicense: string | null;
  active: number;
};

export interface MarketDataProvider {
  readonly name: string;
  readonly simulated: boolean;
  getQuotes(symbols?: string[]): Promise<MarketQuote[]>;
  getQuote(symbol: string): Promise<MarketQuote | null>;
}

/**
 * Safe default: no market value is invented. A licensed provider must implement
 * this adapter and be enabled only after its credentials and redistribution rights
 * are configured in the server environment.
 */
export class UnconfiguredMarketDataProvider implements MarketDataProvider {
  readonly name = "not_configured";
  readonly simulated = false;
  async getQuotes(): Promise<MarketQuote[]> { return []; }
  async getQuote(): Promise<MarketQuote | null> { return null; }
}

export function getMarketDataProvider(): MarketDataProvider {
  return new UnconfiguredMarketDataProvider();
}
