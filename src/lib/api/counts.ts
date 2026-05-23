/**
 * Lightweight count fetchers for endpoints that currently return a plain array
 * instead of a paginated wrapper (purchase orders, shipments). They count the
 * array length so the dashboard can show a KPI without depending on a paged
 * response shape that doesn't exist yet.
 *
 * When these endpoints later move to a paginated shape, swap to listX() with
 * pageSize=1 and read .total instead. Until then, this keeps the dashboard
 * unblocked.
 */
import { apiFetch, type ApiResult } from "./client";

export async function countPurchaseOrders(signal?: AbortSignal): Promise<ApiResult<number>> {
  const r = await apiFetch<unknown[]>("/api/purchase-orders", { signal });
  if (r.kind !== "ok") return r;
  return { kind: "ok", data: Array.isArray(r.data) ? r.data.length : 0 };
}

export async function countShipments(signal?: AbortSignal): Promise<ApiResult<number>> {
  const r = await apiFetch<unknown[]>("/api/shipments", { signal });
  if (r.kind !== "ok") return r;
  return { kind: "ok", data: Array.isArray(r.data) ? r.data.length : 0 };
}
