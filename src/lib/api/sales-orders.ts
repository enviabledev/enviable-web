import { apiFetch, buildQuery, type ApiResult } from "./client";

/**
 * Types mirroring the Enviable backend's SalesOrder endpoints.
 *
 * Soft-reservation model (Invariant I-11):
 *   Allocating a unit to a sales order line does NOT change the unit's
 *   status. The line holds the unit via `unitId`; the partial unique
 *   index `one_active_so_line_per_unit` (WHERE unitId IS NOT NULL) enforces
 *   that only one active SO line at a time can hold a given unit. The unit
 *   stays IN_WAREHOUSE_CKD or IN_WAREHOUSE_CBU until release; the UI must
 *   surface this honestly (reserved-but-still-in-warehouse, not sold).
 *
 * Pricing: client does NOT send unitPrice. The backend resolves it from
 * (productVariantId, customer.tierId) -> most-recent PriceListEntry.
 *
 * VAT: 7.5% computed server-side on (subtotal - discountTotal). Client
 * displays as an aid only; the server's totals are authoritative.
 */

export const SO_STATUS = [
  "DRAFT",
  "AWAITING_PAYMENT",
  "PAYMENT_RECEIVED",
  "RELEASE_AUTHORISED",
  "PICKING",
  "READY_FOR_DISPATCH",
  "DISPATCHED",
  "DELIVERED",
  "CLOSED",
  "CANCELLED",
  "REFUNDED",
] as const;
export type SoStatus = (typeof SO_STATUS)[number];

export const SALE_FORM = ["CKD", "CBU"] as const;
export type SaleForm = (typeof SALE_FORM)[number];

export const SALES_CHANNEL = ["WAREHOUSE_PICKUP"] as const;
export type SalesChannel = (typeof SALES_CHANNEL)[number];

export type SoCustomerSummary = {
  id: string;
  name: string;
  tierId: string | null;
  type: string;
};

export type SoProductVariantSummary = {
  id: string;
  supplierSkuCode: string;
};

export type SoLineUnitSummary = {
  id: string;
  engineNumber: string;
  status: string;
};

export type SalesOrderLine = {
  id: string;
  salesOrderId: string;
  productVariantId: string;
  unitId: string | null;
  saleForm: SaleForm;
  unitPrice: string;
  discountAmount: string;
  lineTotal: string;
  productVariant: SoProductVariantSummary;
  unit: SoLineUnitSummary | null;
};

export type SalesOrderListRow = {
  id: string;
  soNumber: string;
  customerId: string;
  channel: SalesChannel;
  status: SoStatus;
  subtotal: string;
  discountTotal: string;
  vatAmount: string;
  total: string;
  createdAt: string;
  updatedAt: string;
  customer: { id: string; name: string };
  _count?: { lines: number };
};

export type SalesOrderDetail = {
  id: string;
  soNumber: string;
  customerId: string;
  channel: SalesChannel;
  status: SoStatus;
  subtotal: string;
  discountTotal: string;
  vatAmount: string;
  total: string;
  paymentReceivedTotal: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  createdById: string | null;
  dispatchedAt: string | null;
  deliveredAt: string | null;
  cancellationReason: string | null;
  cancelledAt: string | null;
  cancelledById: string | null;
  customer: SoCustomerSummary;
  lines: SalesOrderLine[];
};

export type SalesOrderListQuery = {
  customerId?: string;
  status?: SoStatus;
  channel?: SalesChannel;
};

export type CreateSoLine = {
  productVariantId: string;
  unitId: string;
  saleForm: SaleForm;
  discountAmount?: string;
};

export type CreateSoBody = {
  customerId: string;
  channel?: SalesChannel;
  lines: CreateSoLine[];
};

export type UpdateSoBody = Partial<CreateSoBody>;

export async function listSalesOrders(
  query: SalesOrderListQuery = {},
  signal?: AbortSignal,
): Promise<ApiResult<SalesOrderListRow[]>> {
  const qs = buildQuery({
    customerId: query.customerId,
    status: query.status,
    channel: query.channel,
  });
  return apiFetch<SalesOrderListRow[]>(`/api/sales-orders${qs}`, { signal });
}

export async function getSalesOrder(
  id: string,
  signal?: AbortSignal,
): Promise<ApiResult<SalesOrderDetail>> {
  return apiFetch<SalesOrderDetail>(`/api/sales-orders/${encodeURIComponent(id)}`, { signal });
}

export async function createSalesOrder(
  body: CreateSoBody,
  signal?: AbortSignal,
): Promise<ApiResult<SalesOrderDetail>> {
  return apiFetch<SalesOrderDetail>(`/api/sales-orders`, { method: "POST", body, signal });
}

export async function updateSalesOrder(
  id: string,
  body: UpdateSoBody,
  signal?: AbortSignal,
): Promise<ApiResult<SalesOrderDetail>> {
  return apiFetch<SalesOrderDetail>(`/api/sales-orders/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body,
    signal,
  });
}

export async function submitSalesOrder(
  id: string,
  signal?: AbortSignal,
): Promise<ApiResult<SalesOrderDetail>> {
  return apiFetch<SalesOrderDetail>(`/api/sales-orders/${encodeURIComponent(id)}/submit`, {
    method: "POST",
    body: {},
    signal,
  });
}

export const SO_LEGAL_TRANSITIONS: Readonly<Record<SoStatus, readonly SoStatus[]>> = {
  DRAFT: ["AWAITING_PAYMENT", "CANCELLED"],
  AWAITING_PAYMENT: ["PAYMENT_RECEIVED", "CANCELLED"],
  PAYMENT_RECEIVED: ["RELEASE_AUTHORISED", "CANCELLED"],
  RELEASE_AUTHORISED: ["PICKING", "CANCELLED"],
  PICKING: ["READY_FOR_DISPATCH", "CANCELLED"],
  READY_FOR_DISPATCH: ["DISPATCHED"],
  DISPATCHED: ["DELIVERED"],
  DELIVERED: ["CLOSED", "REFUNDED"],
  CLOSED: ["REFUNDED"],
  CANCELLED: [],
  REFUNDED: [],
};

export function soIsEditable(status: SoStatus): boolean {
  return status === "DRAFT";
}

/**
 * States from which a sales order can be cancelled. This mirrors the backend
 * service's CANCELLABLE_STATUSES allowlist (DRAFT, AWAITING_PAYMENT,
 * PAYMENT_RECEIVED), which is NARROWER than the legal-transition map: once an
 * order is released or later, its units are committed and any reversal is the
 * returns/refund flow, not a cancel.
 */
export const SO_CANCELLABLE_STATUSES: readonly SoStatus[] = [
  "DRAFT",
  "AWAITING_PAYMENT",
  "PAYMENT_RECEIVED",
];

export function soIsCancellable(status: SoStatus): boolean {
  return SO_CANCELLABLE_STATUSES.includes(status);
}

export type CancelSalesOrderBody = { reason: string };

/**
 * The cancel response is the updated SalesOrderDetail plus a refund-outstanding
 * flag: cancelling a PAYMENT_RECEIVED order with confirmed payments surfaces
 * (does not process) the refund amount so the UI can warn the user.
 */
export type CancelSalesOrderResult = SalesOrderDetail & {
  refundOutstanding?: boolean;
  refundAmount?: string;
};

/**
 * Cancel a sales order (gated salesorder.create, matching the backend). The
 * reason is required. Cancelling frees the soft unit reservation (each line's
 * unitId is nulled; unit STATUS is unchanged because allocation never moved the
 * units out of warehouse status) and moves the order to CANCELLED, atomically.
 */
export async function cancelSalesOrder(
  id: string,
  body: CancelSalesOrderBody,
  signal?: AbortSignal,
): Promise<ApiResult<CancelSalesOrderResult>> {
  return apiFetch<CancelSalesOrderResult>(
    `/api/sales-orders/${encodeURIComponent(id)}/cancel`,
    { method: "POST", body, signal },
  );
}

export const VAT_RATE = 0.075;
