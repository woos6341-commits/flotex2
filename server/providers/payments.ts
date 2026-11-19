export type PaymentVerification = {
  status: "verified" | "failed" | "unavailable";
  providerReference?: string;
  amount?: string;
  reason?: string;
};

export interface PaymentProvider {
  readonly name: string;
  verifyInbound(reference: string, expectedAmount: string): Promise<PaymentVerification>;
  initiateOutbound(reference: string, amount: string, destination: string): Promise<PaymentVerification>;
}

export class UnconfiguredPaymentProvider implements PaymentProvider {
  readonly name = "not_configured";
  async verifyInbound(): Promise<PaymentVerification> {
    return { status: "unavailable", reason: "لم يتم ربط مزود دفع معتمد بعد" };
  }
  async initiateOutbound(): Promise<PaymentVerification> {
    return { status: "unavailable", reason: "لم يتم ربط مزود دفع معتمد بعد" };
  }
}

export function getPaymentProvider(): PaymentProvider {
  return new UnconfiguredPaymentProvider();
}
