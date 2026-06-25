import { apiFetch, type ApiResult } from "./client";

/**
 * Payments for sales orders. The record/confirm split is a deliberate
 * separation of duties:
 *   - payment.record: create a PENDING payment (does NOT mutate the SO)
 *   - payment.confirm: confirm or reject a PENDING payment; on confirm the
 *     server re-derives the SO's paymentReceivedTotal as the SUM of CONFIRMED
 *     payments (never incremented) and advances the SO to PAYMENT_RECEIVED
 *     when the covered amount meets the total.
 *
 * The seeded Sales Officer (Warehouse) holds payment.record without
 * payment.confirm; Sales Manager holds payment.confirm without
 * payment.record. The UI hides the action a user lacks; the server returns
 * 403 if forced.
 */

export const PAYMENT_STATUS = ["PENDING", "CONFIRMED", "REJECTED"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUS)[number];

export type PaymentConfirmationSource = "MANUAL_UPLOAD" | "WEBHOOK";

/**
 * Overpayment capture (42a). When a payment's amount exceeds the SO's remaining
 * balance (total minus the sum of CONFIRMED payments, floored at 0), the excess
 * and how the user resolved it are recorded 1:1 with the payment. The system is
 * a recording medium: it does not process the refund or issue the credit, it
 * captures the user's stated resolution. REFUND carries a mechanism (and an
 * optional reference); CREDIT carries an optional note.
 */
export const OVERPAYMENT_RESOLUTION = ["REFUND", "CREDIT"] as const;
export type OverpaymentResolution = (typeof OVERPAYMENT_RESOLUTION)[number];

export const REFUND_MECHANISM = ["BANK_TRANSFER", "CASH"] as const;
export type RefundMechanism = (typeof REFUND_MECHANISM)[number];

export type PaymentMethodSummary = {
  id: string;
  name: string;
  status: string;
};

export type Payment = {
  id: string;
  salesOrderId: string;
  paymentMethodId: string;
  amount: string;
  receivedAt: string;
  referenceNumber: string | null;
  confirmationSource: PaymentConfirmationSource;
  confirmedById: string | null;
  receiptDocumentId: string | null;
  status: PaymentStatus;
  clientId: string | null;
  createdAt: string;
  paymentMethod: PaymentMethodSummary;
  // Overpayment fields, all null on a normal (non-overpaying) payment.
  overpaymentAmount: string | null;
  overpaymentResolution: OverpaymentResolution | null;
  refundMechanism: RefundMechanism | null;
  refundReference: string | null;
  creditNotes: string | null;
};

export type RecordPaymentBody = {
  paymentMethodId: string;
  amount: string;
  referenceNumber?: string;
  // Overpayment resolution. Sent only when the amount exceeds the remaining
  // balance; the backend 400s if supplied without an overpayment, and 400s if
  // an overpayment is present without it. REFUND requires refundMechanism.
  overpaymentResolution?: OverpaymentResolution;
  refundMechanism?: RefundMechanism;
  refundReference?: string;
  creditNotes?: string;
};

export async function listPayments(
  salesOrderId: string,
  signal?: AbortSignal,
): Promise<ApiResult<Payment[]>> {
  return apiFetch<Payment[]>(
    `/api/sales-orders/${encodeURIComponent(salesOrderId)}/payments`,
    { signal },
  );
}

export async function recordPayment(
  salesOrderId: string,
  body: RecordPaymentBody,
  signal?: AbortSignal,
): Promise<ApiResult<Payment>> {
  return apiFetch<Payment>(
    `/api/sales-orders/${encodeURIComponent(salesOrderId)}/payments`,
    { method: "POST", body, signal },
  );
}

export async function confirmPayment(
  paymentId: string,
  signal?: AbortSignal,
): Promise<ApiResult<Payment>> {
  return apiFetch<Payment>(`/api/payments/${encodeURIComponent(paymentId)}/confirm`, {
    method: "POST",
    body: {},
    signal,
  });
}

export async function rejectPayment(
  paymentId: string,
  signal?: AbortSignal,
): Promise<ApiResult<Payment>> {
  return apiFetch<Payment>(`/api/payments/${encodeURIComponent(paymentId)}/reject`, {
    method: "POST",
    body: {},
    signal,
  });
}

/**
 * Active payment methods. No /api/payment-methods endpoint is exposed yet
 * (per the prompt-7 Explore probe), so the frontend hardcodes the seed's
 * known-active method. When the backend exposes a listing endpoint, swap
 * this for a real fetch; the rest of the form doesn't change.
 */
export const SEED_PAYMENT_METHODS: PaymentMethodSummary[] = [
  { id: "seed-pm-bank", name: "Bank Transfer", status: "ACTIVE" },
];
