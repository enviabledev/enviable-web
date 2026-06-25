import { apiFetch, type ApiResult } from "./client";

/**
 * Returns endpoints. A return is one sold unit on one sales order, moving
 * through a small workflow:
 *
 *   INITIATED  -> (inspect) -> INSPECTING -> (resolve) -> RESOLVED
 *
 * Initiate (POST /sales-orders/:id/returns) creates the Return and cascades the
 * unit SOLD_* -> RETURNED. Inspect (POST /returns/:id/inspect, no body) just
 * advances the status. Resolve (POST /returns/:id/resolve) sets a disposition,
 * REPAIR cascades the unit to IN_REPAIR, WRITE_OFF to WRITTEN_OFF. All writes
 * are gated return.manage; reads are gated salesorder.read. The backend is the
 * source of truth on legality (409 on a bad state, 400 on a bad disposition).
 */

export const RETURN_STATUS = ["INITIATED", "INSPECTING", "RESOLVED"] as const;
export type ReturnStatus = (typeof RETURN_STATUS)[number];

// PENDING_DECISION is the pre-resolution default; resolve accepts only the
// latter two.
export const RETURN_DISPOSITION = [
  "PENDING_DECISION",
  "REPAIR",
  "WRITE_OFF",
  "SUPPLIER_WARRANTY_CLAIM",
] as const;
export type ReturnDisposition = (typeof RETURN_DISPOSITION)[number];
export type ResolvableDisposition = "REPAIR" | "WRITE_OFF" | "SUPPLIER_WARRANTY_CLAIM";

export type SupplierWarrantyClaimStatus = "CLAIMED";

/**
 * Supplier warranty claim (48a), 1:1 with the return that filed it. Nested on
 * the return when disposition is SUPPLIER_WARRANTY_CLAIM; null for REPAIR /
 * WRITE_OFF. status is CLAIMED for the MVP (claim-status-update is a deferred
 * follow-up). The supplier's name is NOT embedded; resolve it from the
 * counterparty id (getCounterparty) where the name is shown.
 */
export type SupplierWarrantyClaim = {
  id: string;
  returnId: string;
  supplierCounterpartyId: string;
  claimReference: string | null;
  claimedAt: string;
  claimNotes: string | null;
  status: SupplierWarrantyClaimStatus;
};

export type ReturnRow = {
  id: string;
  salesOrderId: string;
  unitId: string;
  initiatedAt: string;
  initiatedById: string | null;
  reason: string | null;
  disposition: ReturnDisposition;
  dispositionDecidedById: string | null;
  dispositionDecidedAt: string | null;
  status: ReturnStatus;
  createdAt: string;
  unit: { id: string; engineNumber: string; status: string };
  salesOrder: { id: string; soNumber: string };
  supplierWarrantyClaim: SupplierWarrantyClaim | null;
};

export type ReturnDetail = ReturnRow;

export type InitiateReturnBody = { unitId: string; reason: string };

/**
 * Resolve body (48a). supplierCounterpartyId is required IFF disposition is
 * SUPPLIER_WARRANTY_CLAIM (the backend 400s otherwise); claimReference and
 * claimNotes are optional and ignored for REPAIR / WRITE_OFF.
 */
export type ResolveReturnBody = {
  disposition: ResolvableDisposition;
  supplierCounterpartyId?: string;
  claimReference?: string;
  claimNotes?: string;
};

export async function listReturns(
  signal?: AbortSignal,
): Promise<ApiResult<ReturnRow[]>> {
  return apiFetch<ReturnRow[]>("/api/returns", { signal });
}

export async function getReturn(
  id: string,
  signal?: AbortSignal,
): Promise<ApiResult<ReturnDetail>> {
  return apiFetch<ReturnDetail>(`/api/returns/${encodeURIComponent(id)}`, {
    signal,
  });
}

export async function initiateReturn(
  salesOrderId: string,
  body: InitiateReturnBody,
  signal?: AbortSignal,
): Promise<ApiResult<ReturnDetail>> {
  return apiFetch<ReturnDetail>(
    `/api/sales-orders/${encodeURIComponent(salesOrderId)}/returns`,
    { method: "POST", body, signal },
  );
}

export async function inspectReturn(
  id: string,
  signal?: AbortSignal,
): Promise<ApiResult<ReturnDetail>> {
  return apiFetch<ReturnDetail>(
    `/api/returns/${encodeURIComponent(id)}/inspect`,
    { method: "POST", signal },
  );
}

export async function resolveReturn(
  id: string,
  body: ResolveReturnBody,
  signal?: AbortSignal,
): Promise<ApiResult<ReturnDetail>> {
  return apiFetch<ReturnDetail>(
    `/api/returns/${encodeURIComponent(id)}/resolve`,
    { method: "POST", body, signal },
  );
}
