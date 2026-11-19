import type { PaymentMethodField } from "@/shared/payment-method-fields";

export type PaymentMethodId = string;

export type PaymentMethod = {
  id: PaymentMethodId;
  name: string;
  imageUrl: string | null;
  transferNumber: string | null;
  enabled?: boolean;
  deleted?: boolean;
  fields?: PaymentMethodField[];
  depositFields?: PaymentMethodField[];
  withdrawalFields?: PaymentMethodField[];
};

export type OperationLimits = {
  minDepositAmount: number;
  minWithdrawalAmount: number;
  minTransferAmount: number;
  maxTradeAmount: number | null;
  maxDepositAmount: number | null;
  maxWithdrawalAmount: number | null;
};

export type AdminRequest = {
  id: number;
  type: "deposit" | "withdrawal" | string;
  amount: number | string;
  feeAmount?: number | string | null;
  reference?: string | null;
  paymentChannel?: string | null;
  paymentMethodId?: PaymentMethodId | null;
  transferReference?: string | null;
  submittedTransferReference?: string | null;
  senderReference?: string | null;
  destination?: string | null;
  note?: string | null;
  customFields?: string | null;
  transferNumberSnapshot?: string | null;
  receiptImageUrl?: string | null;
  status: "pending" | "approved" | "rejected" | "completed" | string;
  rejectionReason?: string | null;
  createdAt?: Date | string;
  reviewedAt?: Date | string | null;
  customer: {
    name?: string | null;
    email?: string | null;
    customerId?: string | null;
  } | null;
};

/** Supports the current nested response and the incoming flattened admin.requests contract. */
export function normalizeAdminRequest(value: any): AdminRequest {
  const request = value?.request ?? value ?? {};
  return {
    ...request,
    customer: value?.customer ?? request.customer ?? null,
  } as AdminRequest;
}

export const PAYMENT_METHOD_IDS: PaymentMethodId[] = ["vodafone", "orange", "etisalat", "instapay"];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethodId, string> = {
  vodafone: "Vodafone Cash",
  orange: "Orange Cash",
  etisalat: "Etisalat Cash",
  instapay: "InstaPay",
};

export function requestMethodLabel(request: AdminRequest) {
  // paymentChannel is the historical snapshot; never replace it with a current method name.
  return request.paymentChannel || (request as any).paymentMethodName || request.paymentMethodId || "بدون طريقة";
}

export function requestReferenceLabel(request: AdminRequest) {
  return request.type === "withdrawal"
    ? request.destination || request.transferReference || request.reference || "بدون وجهة"
    : [request.senderReference, request.submittedTransferReference || request.transferReference].filter(Boolean).join(" · ") || request.reference || "بدون مرجع";
}

export function requestNote(request: AdminRequest) {
  return request.note || (request as any).reason || null;
}
