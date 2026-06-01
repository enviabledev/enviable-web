"use client";

/**
 * Typed helpers for the assembly offline path. Mirror the existing
 * direct-POST shapes used by /api/assembly-jobs (start) and
 * /api/assembly-jobs/:id/complete, but route through the sync engine instead
 * of a direct POST.
 *
 * Payloads match enviable-system/src/sync/dto/sync-payloads.dto.ts:
 *   assembly.start    -> { unitRefs: string[] }   (unit IDs OR engine numbers)
 *   assembly.complete -> { jobId: string }
 *
 * Online path: action goes queued -> syncing -> synced in a tick or two.
 * Offline path: action stays queued; engine drains on the next online event.
 *
 * No queueFailAssembly: the backend's SyncActionType enum (sync-batch.dto.ts)
 * does NOT include 'assembly.fail'. Adding it is a separate handoff to the
 * enviable-system session (SyncActionType + dispatch case + AssemblyFailPayloadDto).
 * Until then, Fail is online-only; the form gates the offline branch with a
 * "requires connection" notice.
 *
 * Idempotency: the clientId stored on the queued action is the SAME id replayed
 * on every retry. The backend's ProcessedSyncAction keys on clientId so a replay
 * returns 'duplicate' and never double-applies. Don't generate a new clientId.
 */
import { connectivity } from "../connectivity";
import { syncEngine } from "../engine";
import { enqueue } from "../queue";
import type { QueuedAction } from "../types";

export async function queueStartAssembly(params: {
  unitRefs: string[];
  description: string;
}): Promise<QueuedAction> {
  const action = await enqueue({
    type: "assembly.start",
    payload: { unitRefs: params.unitRefs },
    description: params.description,
  });

  syncEngine.notifyChange();

  if (connectivity.getState() === "online") {
    void syncEngine.drain();
  }

  return action;
}

export async function queueCompleteAssembly(params: {
  jobId: string;
  description: string;
}): Promise<QueuedAction> {
  const action = await enqueue({
    type: "assembly.complete",
    payload: { jobId: params.jobId },
    description: params.description,
  });

  syncEngine.notifyChange();

  if (connectivity.getState() === "online") {
    void syncEngine.drain();
  }

  return action;
}
