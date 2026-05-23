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
};

export type RecordPaymentBody = {
  paymentMethodId: string;
  amount: string;
  referenceNumber?: string;
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
