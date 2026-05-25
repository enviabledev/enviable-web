"use client";

/**
 * Typed wrapper for GET /api/sync/pull. Two modes:
 *   since-mode    (since, serverTime]   ongoing reconciling delta
 *   windowed-mode [from, to)            initial 90-day download, 7-day windows
 *
 * Pagination via opaque cursor for the units collection only; reference
 * data buckets are returned full on the first page of a cycle (paging=false
 * on the server side), then empty on continuation pages.
 *
 * I-8 cost-stripping is server-side via the global CostVisibilityInterceptor;
 * the client just renders what arrives, so the mirror naturally inherits the
 * absence-not-stripping pattern.
 */
import { apiFetch, buildQuery, type ApiResult } from "@/lib/api/client";
import type { PullResponse } from "./types";

export type PullSinceParams = {
  since?: string;
  scope?: string;
  limit?: number;
  cursor?: string;
};

export type PullWindowedParams = {
  from: string;
  to: string;
  scope?: string;
  limit?: number;
  cursor?: string;
};

export async function pullSince(
  params: PullSinceParams = {},
  signal?: AbortSignal,
): Promise<ApiResult<PullResponse>> {
  const qs = buildQuery({
    since: params.since,
    scope: params.scope,
    limit: params.limit,
    cursor: params.cursor,
  });
  return apiFetch<PullResponse>(`/api/sync/pull${qs}`, { signal });
}

export async function pullWindow(
  params: PullWindowedParams,
  signal?: AbortSignal,
): Promise<ApiResult<PullResponse>> {
  const qs = buildQuery({
    from: params.from,
    to: params.to,
    scope: params.scope,
    limit: params.limit,
    cursor: params.cursor,
  });
  return apiFetch<PullResponse>(`/api/sync/pull${qs}`, { signal });
}
