import { apiFetch, buildQuery, type ApiResult } from "./client";
import type {
  UnitDetail,
  UnitListQuery,
  UnitListResponse,
} from "./types";

export async function listUnits(
  query: UnitListQuery = {},
  signal?: AbortSignal,
): Promise<ApiResult<UnitListResponse>> {
  const qs = buildQuery({
    page: query.page,
    pageSize: query.pageSize,
    variantId: query.variantId,
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
