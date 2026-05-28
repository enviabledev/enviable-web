import { apiFetch, type ApiResult } from "./client";
import type { UnitStatus } from "./types";

/**
 * Assembly jobs API. Shapes pinned to the running backend (enviable-system
 * src/assembly), which is the source of truth:
 *
 *   GET  /api/assembly-jobs            list      (assembly.read)
 *   GET  /api/assembly-jobs/:id        detail    (assembly.read)
 *   POST /api/assembly-jobs            bulk start (assembly.perform), body { unitRefs }
 *   POST /api/assembly-jobs/:id/complete         (assembly.perform)
 *   POST /api/assembly-jobs/:id/fail             (assembly.perform)
 *
 * NOTE the corrected permission: every write requires assembly.perform (not
 * the assembly.start / assembly.complete the design handoff implied). Start is
 * a BULK operation over unit refs (cuid id or engineNumber): it creates one
 * IN_PROGRESS job per unit and pivots each IN_WAREHOUSE_CKD unit to
 * IN_ASSEMBLY, atomically. complete pivots the unit to IN_WAREHOUSE_CBU; fail
 * pivots it to DAMAGED.
 *
 * Conflicts are string-message ConflictExceptions (not the structured-
 * violations shape that unit receipt uses), e.g.:
 *   "Unit <engine> is <status>, not IN_WAREHOUSE_CKD; cannot start assembly."
 *   "Assembly job <id> is <status>, not IN_PROGRESS."
 *   "Unit <ref> is referenced more than once in the batch"
 * Surface them verbatim as errors.
 */

export const ASSEMBLY_JOB_STATUS = [
  "IN_PROGRESS",
  "COMPLETED",
  "FAILED",
] as const;
export type AssemblyJobStatus = (typeof ASSEMBLY_JOB_STATUS)[number];

/** Joined unit summary the API embeds on each job (JOB_INCLUDE). */
export type AssemblyJobUnitSummary = {
  id: string;
  engineNumber: string;
  status: UnitStatus;
};

/** Joined supervisor summary the API embeds (nullable: supervisorId is optional). */
export type AssemblyJobSupervisor = {
  id: string;
  fullName: string;
};

/**
 * An assembly job as the LIST and DETAIL endpoints return it (with the unit
 * and supervisor joined). The mirror's assemblyJob bucket (once the backend
 * emits it) carries the flat row only; the unit summary is reconstructed
 * client-side from the unit bucket, and supervisor is unavailable offline
 * because users are not mirrored (rendered as a graceful fallback).
 */
export type AssemblyJob = {
  id: string;
  unitId: string;
  status: AssemblyJobStatus;
  startedAt: string | null;
  completedAt: string | null;
  supervisorId: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  unit: AssemblyJobUnitSummary | null;
  supervisor: AssemblyJobSupervisor | null;
};

export async function listAssemblyJobs(
  signal?: AbortSignal,
): Promise<ApiResult<AssemblyJob[]>> {
  return apiFetch<AssemblyJob[]>("/api/assembly-jobs", { signal });
}

export async function getAssemblyJob(
  id: string,
  signal?: AbortSignal,
): Promise<ApiResult<AssemblyJob>> {
  const encoded = encodeURIComponent(id);
  return apiFetch<AssemblyJob>(`/api/assembly-jobs/${encoded}`, { signal });
}

/**
 * Bulk start. unitRefs are cuid ids or engine numbers; the backend resolves,
 * rejects unknown/duplicate refs, and requires every unit IN_WAREHOUSE_CKD.
 * Returns the created jobs (bare rows, no joins).
 */
export async function startAssembly(
  unitRefs: string[],
): Promise<ApiResult<AssemblyJob[]>> {
  return apiFetch<AssemblyJob[]>("/api/assembly-jobs", {
    method: "POST",
    body: { unitRefs },
  });
}

export async function completeAssembly(
  id: string,
): Promise<ApiResult<AssemblyJob>> {
  const encoded = encodeURIComponent(id);
  return apiFetch<AssemblyJob>(`/api/assembly-jobs/${encoded}/complete`, {
    method: "POST",
  });
}

export async function failAssembly(
  id: string,
): Promise<ApiResult<AssemblyJob>> {
  const encoded = encodeURIComponent(id);
  return apiFetch<AssemblyJob>(`/api/assembly-jobs/${encoded}/fail`, {
    method: "POST",
  });
}

/**
 * State-machine legality. complete and fail both require the job to be
 * IN_PROGRESS (the backend re-asserts this and 409s otherwise). Mirror the
 * gate on the client so the action only renders when legal, the same
 * state-and-permission gate the other workflow screens use.
 */
export function assemblyJobIsActionable(status: AssemblyJobStatus): boolean {
  return status === "IN_PROGRESS";
}
