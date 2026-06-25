import { apiFetch, buildQuery, type ApiResult } from "./client";
import type {
  UnitDetail,
  UnitListQuery,
  UnitListResponse,
  UnitStatus,
} from "./types";

export async function listUnits(
  query: UnitListQuery = {},
  signal?: AbortSignal,
): Promise<ApiResult<UnitListResponse>> {
  const qs = buildQuery({
    page: query.page,
    pageSize: query.pageSize,
    variantId: query.variantId,
    productType: query.productType,
    status: query.status,
    warehouseId: query.warehouseId,
    receivedFrom: query.receivedFrom,
    receivedTo: query.receivedTo,
    search: query.search,
  });
  return apiFetch<UnitListResponse>(`/api/units${qs}`, { signal });
}

export async function getUnit(
  idOrEngineNumber: string,
  signal?: AbortSignal,
): Promise<ApiResult<UnitDetail>> {
  const encoded = encodeURIComponent(idOrEngineNumber);
  return apiFetch<UnitDetail>(`/api/units/${encoded}`, { signal });
}

export type AdjustUnitBody = {
  toStatus: UnitStatus;
  reason: string;
};

/**
 * IT-admin lifecycle adjustment: damage / demo / internal-use / repair /
 * write-off and the symmetric returns-to-stock, via POST /api/units/:id/adjust
 * (gated unit.adjust). The backend re-checks the transition is legal per the
 * unit state machine (409) AND is an adjustment rather than a workflow edge like
 * assembly / sale / customer-return (400). The response is the updated unit; the
 * caller refetches for the full movement timeline.
 */
export async function adjustUnit(
  idOrEngineNumber: string,
  body: AdjustUnitBody,
  signal?: AbortSignal,
): Promise<ApiResult<{ id: string; status: UnitStatus }>> {
  const encoded = encodeURIComponent(idOrEngineNumber);
  return apiFetch<{ id: string; status: UnitStatus }>(
    `/api/units/${encoded}/adjust`,
    { method: "POST", body, signal },
  );
}
