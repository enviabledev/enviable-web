import { apiFetch, buildQuery, type ApiResult } from "./client";
import type {
  SparePartDetail,
  SparePartListQuery,
  SparePartListResponse,
} from "./types";

/**
 * Spare-parts catalogue. The backend exposes only read endpoints
 * (GET /api/spare-parts, GET /api/spare-parts/:id), both gated
 * 'sparepart.read'. There are no create/update/delete endpoints on the
 * spare-parts controller; the only write path is /api/historical-load/
 * spare-parts (admin bulk import), which is out of scope for the
 * catalogue screen.
 *
 * landedCostPerUnit is cost-gated server-side (CostVisibilityInterceptor);
 * non-cost users see the field as absent on the response.
 */
export async function listSpareParts(
  query: SparePartListQuery = {},
  signal?: AbortSignal,
): Promise<ApiResult<SparePartListResponse>> {
  const qs = buildQuery({
    page: query.page,
    pageSize: query.pageSize,
    status: query.status,
    search: query.search,
  });
  return apiFetch<SparePartListResponse>(`/api/spare-parts${qs}`, { signal });
}

export async function getSparePart(
  id: string,
  signal?: AbortSignal,
): Promise<ApiResult<SparePartDetail>> {
  return apiFetch<SparePartDetail>(`/api/spare-parts/${encodeURIComponent(id)}`, { signal });
}
