import { apiFetch, type ApiResult } from "./client";
import type { SalesOrderDetail } from "./sales-orders";

/**
 * Delivery workflow endpoints. State transitions on the SO:
 *   RELEASE_AUTHORISED -> PICKING -> READY_FOR_DISPATCH  (via createDeliveryNote)
 *   READY_FOR_DISPATCH -> DISPATCHED                     (via dispatch)
 *   DISPATCHED         -> DELIVERED                      (via recordProofOfDelivery)
 *   DELIVERED          -> CLOSED                         (via closeSalesOrder)
 *
 * createWaybill does not change the SO status; it attaches a waybill to the
 * existing delivery note (one per note).
 *
 * documentId stays null on each artifact: PDF generation is deferred to a
 * later milestone.
 */

export type DeliveryNote = {
  id: string;
  salesOrderId: string;
  dnNumber: string;
  preparedById: string | null;
  preparedAt: string;
  vehicleReg: string | null;
  driverName: string | null;
  documentId: string | null;
};

export type Waybill = {
  id: string;
  deliveryNoteId: string;
  wbNumber: string;
  documentId: string | null;
  createdAt: string;
};

export type ProofOfDelivery = {
  id: string;
  deliveryNoteId: string;
  receivedBy: string | null;
  signedAt: string | null;
  documentId: string | null;
  createdAt: string;
};

export type CreateDeliveryNoteBody = {
  vehicleReg?: string;
  driverName?: string;
};

export type ProofOfDeliveryBody = {
  receivedBy?: string;
  signedAt?: string;
};

export async function createDeliveryNote(
  salesOrderId: string,
  body: CreateDeliveryNoteBody,
  signal?: AbortSignal,
): Promise<ApiResult<DeliveryNote>> {
  return apiFetch<DeliveryNote>(
    `/api/sales-orders/${encodeURIComponent(salesOrderId)}/delivery-note`,
    { method: "POST", body, signal },
  );
}

export async function createWaybill(
  deliveryNoteId: string,
  signal?: AbortSignal,
): Promise<ApiResult<Waybill>> {
  return apiFetch<Waybill>(
    `/api/delivery-notes/${encodeURIComponent(deliveryNoteId)}/waybill`,
    { method: "POST", body: {}, signal },
  );
}

export async function dispatch(
  salesOrderId: string,
  signal?: AbortSignal,
): Promise<ApiResult<SalesOrderDetail>> {
  return apiFetch<SalesOrderDetail>(
    `/api/sales-orders/${encodeURIComponent(salesOrderId)}/dispatch`,
    { method: "POST", body: {}, signal },
  );
}

export async function recordProofOfDelivery(
  salesOrderId: string,
  body: ProofOfDeliveryBody,
  signal?: AbortSignal,
): Promise<ApiResult<SalesOrderDetail>> {
  return apiFetch<SalesOrderDetail>(
    `/api/sales-orders/${encodeURIComponent(salesOrderId)}/proof-of-delivery`,
    { method: "POST", body, signal },
  );
}

export async function closeSalesOrder(
  salesOrderId: string,
  signal?: AbortSignal,
): Promise<ApiResult<SalesOrderDetail>> {
  return apiFetch<SalesOrderDetail>(
    `/api/sales-orders/${encodeURIComponent(salesOrderId)}/close`,
    { method: "POST", body: {}, signal },
  );
}
