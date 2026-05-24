"use client";

/**
 * Typed helper for queueing an entity.update action. Builds the payload that
 * mirrors enviable-system/src/sync/dto/update-entity.dto.ts, enqueues it with
 * a fresh UUID clientId, and (if connectivity allows) kicks off a drain so the
 * action syncs immediately when online.
 *
 * Online path: action goes from queued -> syncing -> synced within a tick or
 * two. Offline path: action stays queued; engine drains on the next 'online'
 * event triggered by SyncBoot.
 *
 * The clientId stored on the queued action is the SAME id replayed on every
 * retry, which is what the backend's idempotency core consumes to skip
 * re-running already-processed work. Don't generate a new clientId on retry.
 */
import { connectivity } from "../connectivity";
import { syncEngine } from "../engine";
import { enqueue } from "../queue";
import type { QueuedAction } from "../types";

export type MergeableEntityType = "customer" | "unit";

export type FieldChange = {
  path: string;
  oldValue?: unknown;
  newValue?: unknown;
};

export async function queueEntityUpdate(params: {
  entityType: MergeableEntityType;
  entityId: string;
  changes: FieldChange[];
  description: string;
}): Promise<QueuedAction> {
  const action = await enqueue({
    type: "entity.update",
    payload: {
      entityType: params.entityType,
      entityId: params.entityId,
      changes: params.changes,
    },
    description: params.description,
  });

  syncEngine.notifyChange();

  if (connectivity.getState() === "online") {
    void syncEngine.drain();
  }

  return action;
}
