"use client";

/**
 * Sync engine. Single-flight drain of the IndexedDB action queue against the
 * backend's POST /api/sync/actions intake.
 *
 * Per-action atomicity: each queued action travels in its own slot of the batch,
 * and the backend reports per-action status (processed / duplicate / error /
 * conflict). One action's failure does NOT undo or block the others, mirroring
 * the backend's intake loop.
 *
 * Single-flight: a module-level mutex flag prevents two concurrent drains. Even
 * though idempotency makes a concurrent drain SAFE (the duplicate clientIds
 * would just return `duplicate`), single-flight avoids the wasted work and the
 * confusing double-processing. Belt and braces.
 *
 * Connectivity-dropped-mid-drain: if the network errors out partway, the actions
 * not yet POSTed stay queued (their status untouched), and the in-flight POST's
 * actions stay in `syncing` state until the next drain attempt resets them. The
 * backend's idempotency ensures the re-drain produces no double-effect even if
 * the original batch was processed but the response was lost.
 */
import { connectivity } from "./connectivity";
import {
  listDrainable,
  markConflict,
  markFailed,
  markSynced,
  markSyncing,
} from "./queue";
import type {
  ActionResult,
  QueuedAction,
  SyncBatchResponse,
  SyncEngineState,
} from "./types";

type Listener = () => void;

class SyncEngine {
  private state: SyncEngineState = "idle";
  private inFlight = false;
  private listeners = new Set<Listener>();

  getState(): SyncEngineState {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Notify subscribers (the indicator, the state hook). Called by the engine
   * after every state change AND by code that mutates the queue (the
   * entity-update helper, the dev replay affordance) so the indicator
   * re-renders without a polling loop.
   */
  notifyChange() {
    this.listeners.forEach((l) => l());
  }

  private setState(next: SyncEngineState) {
    if (this.state === next) return;
    this.state = next;
    this.notifyChange();
  }

  /**
   * Drain the queue once. Returns the count of actions touched (any status).
   * Safe to call concurrently: the single-flight guard ensures only one drain
   * is in flight.
   */
  async drain(): Promise<number> {
    if (this.inFlight) return 0;
    if (connectivity.getState() === "offline") return 0;

    this.inFlight = true;
    this.setState("syncing");
    try {
      return await this.drainOnce();
    } finally {
      this.inFlight = false;
      this.setState("idle");
    }
  }

  private async drainOnce(): Promise<number> {
    const drainable = await listDrainable();
    if (drainable.length === 0) return 0;

    // Mark all as syncing first so the indicator reflects in-flight state. If
    // the POST throws mid-flight (network drop), the markSyncing rows stay as
    // such until the next drain re-marks them; effectively the queue treats
    // queued and syncing identically as "drainable", and idempotency guards
    // the re-attempt.
    for (const action of drainable) {
      await markSyncing(action.clientId);
    }
    this.notifyChange();

    const body = {
      actions: drainable.map((a) => ({
        clientId: a.clientId,
        type: a.type,
        payload: a.payload,
        clientTimestamp: a.clientTimestamp,
        deviceId: a.deviceId,
      })),
    };

    let response: SyncBatchResponse;
    try {
      const res = await fetch("/api/sync/actions", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
      });

      if (res.status === 401) {
        // Session expired mid-drain. Treat as a transient failure on each
        // action (still queued for re-drain after re-auth). The AuthProvider
        // separately handles re-auth from elsewhere; connectivity stays online.
        for (const action of drainable) {
          await markFailed(action.clientId, "Session expired during sync");
        }
        return drainable.length;
      }

      if (res.status >= 500 || !res.ok) {
        const errText = await res.text().catch(() => `HTTP ${res.status}`);
        for (const action of drainable) {
          await markFailed(action.clientId, errText.slice(0, 240));
        }
        return drainable.length;
      }

      response = (await res.json()) as SyncBatchResponse;
    } catch (err) {
      // Network error (no route to backend, DNS, abort). Mark each action
      // failed with the network message; the connectivity manager flips to
      // offline so the indicator reflects it without waiting for a heartbeat.
      connectivity.markOfflineFromNetworkError();
      const msg = err instanceof Error ? err.message : "Network error";
      for (const action of drainable) {
        await markFailed(action.clientId, msg);
      }
      return drainable.length;
    }

    // Apply per-action outcomes. The backend returns results in the order it
    // processed them, keyed by clientId; reconcile by clientId rather than
    // index in case the order ever diverges.
    const byClientId = new Map<string, ActionResult>();
    for (const r of response.results) byClientId.set(r.clientId, r);

    for (const action of drainable) {
      const result = byClientId.get(action.clientId);
      if (!result) {
        await markFailed(
          action.clientId,
          "No server result returned for this action",
        );
        continue;
      }
      await this.applyResult(action, result);
    }

    this.notifyChange();
    return drainable.length;
  }

  /**
   * Apply one per-action result. `processed` and `duplicate` both flip the
   * action to synced; the user-facing model treats them identically. The
   * serverWasDuplicate flag carries the distinction for verification.
   */
  private async applyResult(action: QueuedAction, result: ActionResult) {
    switch (result.status) {
      case "processed":
        await markSynced(action.clientId, {
          serverResultRef: result.resultRef ?? null,
          serverWasDuplicate: false,
          lastWriteWins: result.lastWriteWins,
          applied: result.applied,
        });
        return;
      case "duplicate":
        await markSynced(action.clientId, {
          serverResultRef: result.resultRef ?? null,
          serverWasDuplicate: true,
        });
        return;
      case "error":
        await markFailed(
          action.clientId,
          result.error ?? "Unknown server error",
        );
        return;
      case "conflict":
        await markConflict(
          action.clientId,
          (result.conflict ?? {}) as Record<string, unknown>,
        );
        return;
      default: {
        // Defensive: an unexpected status from the server still terminates the
        // action's "in flight" state so it doesn't stay stuck on syncing.
        await markFailed(action.clientId, `Unknown status: ${result.status}`);
      }
    }
  }
}

export const syncEngine = new SyncEngine();
