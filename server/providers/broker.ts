export type BrokerOrderInput = {
  clientOrderId: string;
  symbol: string;
  side: "buy" | "sell";
  orderType: "market" | "limit";
  quantity: string;
  limitPrice?: string;
};

export type BrokerOrderResult = {
  status: "submitted" | "rejected";
  brokerOrderId?: string;
  reason?: string;
};

export interface BrokerAdapter {
  readonly name: string;
  submitOrder(input: BrokerOrderInput): Promise<BrokerOrderResult>;
  cancelOrder(brokerOrderId: string): Promise<BrokerOrderResult>;
}

export class UnconfiguredBrokerAdapter implements BrokerAdapter {
  readonly name = "not_configured";
  async submitOrder(): Promise<BrokerOrderResult> {
    return { status: "rejected", reason: "لم يتم ربط وسيط مرخص بعد" };
  }
  async cancelOrder(): Promise<BrokerOrderResult> {
    return { status: "rejected", reason: "لم يتم ربط وسيط مرخص بعد" };
  }
}

export function getBrokerAdapter(): BrokerAdapter {
  return new UnconfiguredBrokerAdapter();
}
