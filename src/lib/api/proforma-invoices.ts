import { apiFetch, type ApiResult } from "./client";
import type {
  CreateProformaInvoiceBody,
  ProformaInvoice,
} from "./types";

/**
 * Proforma-invoice API. The backend has NO cross-supplier list endpoint;
 * the per-PO sub-resource (GET /api/purchase-orders/:poId/proforma-invoices)
 * and the per-id detail (GET /api/proforma-invoices/:id) are the only read
 * surfaces. The cross-supplier list view at /procurement/proforma-invoices
 * therefore reads from the mirror's proformaInvoices bucket and joins to
 * purchaseOrders + counterparties client-side (outcome B per prompt 20
 * audit).
 *
 * Write actions are gated 'pi.review'. Approving a PI atomically supersedes
 * any prior ACTIVE PI on the same PO; 409 on a concurrent supersede race
 * (the partial unique index 'one_active_pi_per_po' is the I-5 enforcement).
 */
export async function listProformaInvoicesForPo(
  purchaseOrderId: string,
  signal?: AbortSignal,
): Promise<ApiResult<ProformaInvoice[]>> {
  return apiFetch<ProformaInvoice[]>(
    `/api/purchase-orders/${encodeURIComponent(purchaseOrderId)}/proforma-invoices`,
    { signal },
  );
}

export async function getProformaInvoice(
  id: string,
  signal?: AbortSignal,
): Promise<ApiResult<ProformaInvoice>> {
  return apiFetch<ProformaInvoice>(`/api/proforma-invoices/${encodeURIComponent(id)}`, { signal });
}

export async function createProformaInvoice(
  purchaseOrderId: string,
  body: CreateProformaInvoiceBody,
  signal?: AbortSignal,
): Promise<ApiResult<ProformaInvoice>> {
  return apiFetch<ProformaInvoice>(
    `/api/purchase-orders/${encodeURIComponent(purchaseOrderId)}/proforma-invoices`,
    { method: "POST", body, signal },
  );
}

export async function approveProformaInvoice(
  id: string,
  signal?: AbortSignal,
): Promise<ApiResult<ProformaInvoice>> {
  return apiFetch<ProformaInvoice>(`/api/proforma-invoices/${encodeURIComponent(id)}/approve`, {
    method: "POST",
    signal,
  });
}

export async function rejectProformaInvoice(
  id: string,
  signal?: AbortSignal,
): Promise<ApiResult<ProformaInvoice>> {
  return apiFetch<ProformaInvoice>(`/api/proforma-invoices/${encodeURIComponent(id)}/reject`, {
    method: "POST",
    signal,
  });
}
