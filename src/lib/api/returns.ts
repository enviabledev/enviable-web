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
] as const;
export type ReturnDisposition = (typeof RETURN_DISPOSITION)[number];
export type ResolvableDisposition = "REPAIR" | "WRITE_OFF";

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
};

export type ReturnDetail = ReturnRow;

export type InitiateReturnBody = { unitId: string; reason: string };
export type ResolveReturnBody = { disposition: ResolvableDisposition };

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
