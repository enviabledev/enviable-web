import { apiFetch, type ApiResult } from "./client";

/**
 * Invoice for a sales order. One per SO; the backend rejects a second
 * attempt with a 409 "...already has an invoice (one invoice per order)."
 *
 * vatRate is snapshotted as Decimal(5,4) ("0.0750" at the time of writing);
 * vatAmount and total are snapshotted from the SO at generation time.
 *
 * The PDF and HTML are rendered on demand by the backend (Puppeteer over the
 * Official Ledger template), not stored: GET /api/invoices/:id/html for the
 * in-app view and GET /api/invoices/:id/pdf for the download. See
 * src/lib/invoices/pdf.ts for the endpoint builders and download helper.
 * pdfDocumentId remains null unless a PDF is also persisted as a Document.
 */
export type Invoice = {
  id: string;
  salesOrderId: string;
  invoiceNumber: string;
  issueDate: string;
  vatRate: string;
  vatAmount: string;
  total: string;
  pdfDocumentId: string | null;
  createdAt: string;
};

export async function generateInvoice(
  salesOrderId: string,
  signal?: AbortSignal,
): Promise<ApiResult<Invoice>> {
  return apiFetch<Invoice>(`/api/sales-orders/${encodeURIComponent(salesOrderId)}/invoice`, {
    method: "POST",
    body: {},
    signal,
  });
}

export async function getInvoiceForSo(
  salesOrderId: string,
  signal?: AbortSignal,
): Promise<ApiResult<Invoice>> {
  return apiFetch<Invoice>(`/api/sales-orders/${encodeURIComponent(salesOrderId)}/invoice`, { signal });
}

export async function getInvoice(
  invoiceId: string,
  signal?: AbortSignal,
): Promise<ApiResult<Invoice>> {
  return apiFetch<Invoice>(`/api/invoices/${encodeURIComponent(invoiceId)}`, { signal });
}
