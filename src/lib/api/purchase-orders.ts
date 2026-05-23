import { apiFetch, buildQuery, type ApiResult } from "./client";

/**
 * Types mirroring the Enviable backend's PurchaseOrder endpoints. Source of
 * truth is the running API (per CLAUDE.md). All money fields are serialized as
 * Decimal strings on the wire (Prisma Decimal(18,2)); never floats.
 */

export const PO_STATUS = [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "SENT_TO_SUPPLIER",
  "PI_RECEIVED",
  "AWAITING_SHIPMENT",
  "PARTIALLY_RECEIVED",
  "FULLY_RECEIVED",
  "CLOSED",
  "CANCELLED",
] as const;
export type PoStatus = (typeof PO_STATUS)[number];

export type PoSupplierSummary = {
  id: string;
  name: string;
  type: string;
  status: string;
};

export type PoLine = {
  id: string;
  purchaseOrderId: string;
  productVariantId: string;
  quantityOrdered: number;
  unitPrice: string;
};

export type PoListRow = {
  id: string;
  poNumber: string;
  supplierPortalRef: string | null;
  supplierId: string;
  status: PoStatus;
  currency: string;
  totalValue: string;
  expectedShipDate: string | null;
  paymentTerms: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  supplier: PoSupplierSummary;
};

export type PoDetail = PoListRow & {
  lines: PoLine[];
};

export type PoListQuery = {
  status?: PoStatus;
  supplierId?: string;
};

export type CreatePoLine = {
  productVariantId: string;
  quantityOrdered: number;
  unitPrice: string;
};

export type CreatePoBody = {
  supplierId: string;
  currency: string;
  expectedShipDate?: string;
  paymentTerms?: string;
  lines: CreatePoLine[];
};

export type UpdatePoBody = Partial<CreatePoBody>;

export async function listPurchaseOrders(
  query: PoListQuery = {},
  signal?: AbortSignal,
): Promise<ApiResult<PoListRow[]>> {
  const qs = buildQuery({ status: query.status, supplierId: query.supplierId });
  return apiFetch<PoListRow[]>(`/api/purchase-orders${qs}`, { signal });
}

export async function getPurchaseOrder(
  id: string,
  signal?: AbortSignal,
): Promise<ApiResult<PoDetail>> {
  return apiFetch<PoDetail>(`/api/purchase-orders/${encodeURIComponent(id)}`, { signal });
}

export async function createPurchaseOrder(
  body: CreatePoBody,
  signal?: AbortSignal,
): Promise<ApiResult<PoDetail>> {
  return apiFetch<PoDetail>(`/api/purchase-orders`, { method: "POST", body, signal });
}

export async function updatePurchaseOrder(
  id: string,
  body: UpdatePoBody,
  signal?: AbortSignal,
): Promise<ApiResult<PoDetail>> {
  return apiFetch<PoDetail>(`/api/purchase-orders/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body,
    signal,
  });
}

export async function submitPurchaseOrder(
  id: string,
  signal?: AbortSignal,
): Promise<ApiResult<PoDetail>> {
  return apiFetch<PoDetail>(`/api/purchase-orders/${encodeURIComponent(id)}/submit`, {
    method: "POST",
    body: {},
    signal,
  });
}

export async function approvePurchaseOrder(
  id: string,
  signal?: AbortSignal,
): Promise<ApiResult<PoDetail>> {
  return apiFetch<PoDetail>(`/api/purchase-orders/${encodeURIComponent(id)}/approve`, {
    method: "POST",
    body: {},
    signal,
  });
}

/**
 * State-machine legal transitions (mirrors enviable-system/src/purchase-orders/
 * state-machine.ts). Used to decide whether to render an action button at all,
 * BEFORE checking the user's permission. UI mirrors the backend's two gates
 * (state machine + RBAC); the API enforces both authoritatively on call.
 */
export const PO_LEGAL_TRANSITIONS: Readonly<Record<PoStatus, readonly PoStatus[]>> = {
  DRAFT: ["PENDING_APPROVAL", "CANCELLED"],
  PENDING_APPROVAL: ["APPROVED", "DRAFT", "CANCELLED"],
  APPROVED: ["SENT_TO_SUPPLIER", "CANCELLED"],
  SENT_TO_SUPPLIER: ["PI_RECEIVED", "CANCELLED"],
  PI_RECEIVED: ["AWAITING_SHIPMENT", "CANCELLED"],
  AWAITING_SHIPMENT: ["PARTIALLY_RECEIVED", "FULLY_RECEIVED", "CANCELLED"],
  PARTIALLY_RECEIVED: ["PARTIALLY_RECEIVED", "FULLY_RECEIVED", "CANCELLED"],
  FULLY_RECEIVED: ["CLOSED"],
  CLOSED: [],
  CANCELLED: [],
};

export function poCanTransitionTo(from: PoStatus, to: PoStatus): boolean {
  return PO_LEGAL_TRANSITIONS[from].includes(to);
}

export function poIsEditable(status: PoStatus): boolean {
  return status === "DRAFT";
}
