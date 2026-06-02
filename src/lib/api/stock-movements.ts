import { apiFetch, buildQuery, type ApiResult } from "./client";
import type {
  StockMovementListQuery,
  StockMovementListResponse,
} from "./types";

/**
 * Stock movements list. Gated 'movement.read' on the backend. The shape is
 * the canonical cross-unit movements log; per-unit movement history is
 * served by GET /api/units/:id (different permission, unit.read).
 *
 * No detail endpoint exists; the detail page reads from the mirror by id.
 */
export async function listStockMovements(
  query: StockMovementListQuery = {},
  signal?: AbortSignal,
): Promise<ApiResult<StockMovementListResponse>> {
  const qs = buildQuery({
    page: query.page,
    pageSize: query.pageSize,
    unitId: query.unitId,
    movementType: query.movementType,
    actorId: query.actorId,
    occurredFrom: query.occurredFrom,
    occurredTo: query.occurredTo,
  });
  return apiFetch<StockMovementListResponse>(`/api/stock-movements${qs}`, { signal });
}
