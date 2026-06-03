import { apiFetch, buildQuery, type ApiResult } from "./client";
import type {
  PriceListEntry,
  PriceListQuery,
  SetPriceBody,
} from "./types";

/**
 * Price-list API. Reads gated 'pricelist.read', writes gated
 * 'pricelist.manage'. The backend returns a plain array (not paginated)
 * on GET; the response shape is the same on both list and "get one
 * (variant, tier) history" since the endpoint filters by query params.
 *
 * The supersede semantics live entirely on the server: the client POSTS
 * the new price for (variant, tier), and the backend's transaction in
 * pricing.service.ts atomically closes the prior current entry's
 * effectiveTo and opens the new entry with effectiveFrom = the same
 * moment. A concurrent supersede returns 409 ConflictException with the
 * canonical message ("Invariant violated: ...").
 */
export async function listPrices(
  query: PriceListQuery = {},
  signal?: AbortSignal,
): Promise<ApiResult<PriceListEntry[]>> {
  const qs = buildQuery({
    variantId: query.variantId,
    tierId: query.tierId,
    includeClosed: query.includeClosed,
  });
  return apiFetch<PriceListEntry[]>(`/api/price-list${qs}`, { signal });
}

export async function setPrice(
  body: SetPriceBody,
  signal?: AbortSignal,
): Promise<ApiResult<PriceListEntry>> {
  return apiFetch<PriceListEntry>("/api/price-list", {
    method: "POST",
    body,
    signal,
  });
}
