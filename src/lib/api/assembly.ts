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
 *   POST /api/assembly-jobs/:id/cancel           (assembly.perform), body { reason }
 *
 * NOTE the corrected permission: every write requires assembly.perform (not
 * the assembly.start / assembly.complete the design handoff implied). Start is
 * a BULK operation over unit refs (cuid id or engineNumber): it creates one
 * IN_PROGRESS job per unit and pivots each IN_WAREHOUSE_CKD unit to
 * IN_ASSEMBLY, atomically. complete pivots the unit to IN_WAREHOUSE_CBU; fail
 * pivots it to DAMAGED.
 *
 * cancel (prompt 44) cleanly reverses an IN_PROGRESS job: it pivots the unit
 * back to IN_WAREHOUSE_CKD (intact) via an ADJUSTMENT movement and closes the
 * job as CANCELLED, atomically. It requires a non-empty (trimmed) reason,
 * threaded to the reversal movement notes and the job notes. The intact
 * reversal is only legal from IN_PROGRESS; a completed CBU unit that needs
 * damage handling goes through the generic adjust flow instead.
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
  "CANCELLED",
] as const;
export type AssemblyJobStatus = (typeof ASSEMBLY_JOB_STATUS)[number];

/**
 * Assembly job type (46a). CKD_TO_ASSEMBLED is the kit build (CKD -> SKD for a
 * 3-wheeler, CKD -> CBU for a 2-wheeler); SKD_TO_CBU is the separately
 * authorised storefront upgrade of a 3-wheeler from SKD to CBU. The same
 * complete/fail/cancel endpoints serve both; jobType drives their target state.
 */
export const ASSEMBLY_JOB_TYPE = ["CKD_TO_ASSEMBLED", "SKD_TO_CBU"] as const;
export type AssemblyJobType = (typeof ASSEMBLY_JOB_TYPE)[number];

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
  jobType: AssemblyJobType;
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
 * SKD -> CBU upgrade (46a). Authorises the full build of a single 3-wheeler that
 * is IN_WAREHOUSE_SKD, as a new assembly job (jobType SKD_TO_CBU). The unit
 * pivots to IN_ASSEMBLY; the returned job then runs through the shared
 * complete/fail/cancel endpoints (complete -> CBU, fail -> DAMAGED, cancel ->
 * back to SKD). Permission assembly.upgrade. 409 if the unit is not SKD or not a
 * 3-wheeler. unitRef is a cuid id or an engine number.
 */
export async function upgradeToCbu(
  unitRef: string,
): Promise<ApiResult<AssemblyJob>> {
  return apiFetch<AssemblyJob>("/api/assembly-jobs/upgrade", {
    method: "POST",
    body: { unitRef },
  });
}

/**
 * Human label + the cancel/complete consequence for a job type. CKD_TO_ASSEMBLED
 * is the kit build; SKD_TO_CBU is the storefront upgrade.
 */
export function assemblyJobTypeLabel(t: AssemblyJobType): string {
  return t === "SKD_TO_CBU" ? "Upgrade to CBU" : "Initial Build";
}

/**
 * Clean cancel of an IN_PROGRESS job. Reverts the unit intact and closes the job
 * as CANCELLED. The revert target depends on jobType: CKD_TO_ASSEMBLED -> CKD,
 * SKD_TO_CBU -> SKD. The reason is mandatory and non-empty after trimming; the
 * backend 400s on a blank reason (mirror that client-side) and 409s if the job
 * is no longer IN_PROGRESS. Returns the updated job (full JOB_INCLUDE shape).
 */
export async function cancelAssembly(
  id: string,
  reason: string,
): Promise<ApiResult<AssemblyJob>> {
  const encoded = encodeURIComponent(id);
  return apiFetch<AssemblyJob>(`/api/assembly-jobs/${encoded}/cancel`, {
    method: "POST",
    body: { reason },
  });
}

/**
 * State-machine legality. complete, fail, and cancel all require the job to be
 * IN_PROGRESS (the backend re-asserts this and 409s otherwise). Mirror the
 * gate on the client so the actions only render when legal, the same
 * state-and-permission gate the other workflow screens use.
 */
export function assemblyJobIsActionable(status: AssemblyJobStatus): boolean {
  return status === "IN_PROGRESS";
}
