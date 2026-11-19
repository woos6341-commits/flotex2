import { ENV } from "../_core/env";
import { getBrokerAdapter } from "./broker";
import { getMarketDataProvider } from "./market-data";
import { getPaymentProvider } from "./payments";
import { getGoldPriceSourceStatus } from "./gold";

export function getReadiness() {
  const market = getMarketDataProvider();
  const broker = getBrokerAdapter();
  const payments = getPaymentProvider();
  return {
    mode: ENV.liveTradingEnabled || ENV.livePaymentsEnabled ? "production_config_pending" : "integrations_not_configured",
    marketData: { market: "EGX", provider: market.name, connected: market.name !== "not_configured", simulated: market.simulated, lastUpdate: null, licensedSourceRequired: true },
    gold: { market: "XAU/EGP", provider: getGoldPriceSourceStatus().provider, connected: getGoldPriceSourceStatus().configured, executionEnabled: false, licensedExecutionRequired: true },
    brokerage: { market: "EGX", provider: broker.name, connected: broker.name !== "not_configured", executionEnabled: ENV.liveTradingEnabled && broker.name !== "not_configured", sandboxRequired: true },
    payments: { provider: payments.name, connected: payments.name !== "not_configured", liveEnabled: ENV.livePaymentsEnabled && payments.name !== "not_configured" },
    warning: "لا تُعرض أسعار أو تُرسل أوامر قبل إضافة مصدر سوق ووسيط مرخصين واختبارهما.",
  };
}
