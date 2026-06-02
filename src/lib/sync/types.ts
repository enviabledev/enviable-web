import type { ReceiptDuplicateViolation } from "@/lib/api";

/**
 * Client-side action types mirroring enviable-system/src/sync/dto/sync-batch.dto.ts.
 * Keep aligned with the backend SyncActionType enum; the wire value (the string
 * after =) is what the intake validates against.
 */
export type SyncActionType =
  | "unit.receipt"
  | "assembly.start"
  | "assembly.complete"
  | "assembly.fail"
  | "salesorder.create"
  | "entity.update";

/**
 * Local queue lifecycle. Authoritative source is the action_queue store in
 * IndexedDB; transitions are driven by the engine.
 *
 *   queued -> syncing -> synced       (server reported processed OR duplicate)
 *   queued -> syncing -> failed       (server reported error; retryable)
 *   queued -> syncing -> conflict     (unique-key clash or field-review)
 *   queued -> syncing -> queued       (network dropped mid-drain; safe re-drain)
 */
export type ActionStatus =
  | "queued"
  | "syncing"
  | "synced"
  | "failed"
  | "conflict";

/**
 * LWW outcome echoed back by the server's merge service for entity.update
 * actions. Carries which side won and what value was kept vs discarded.
 * Mirrors enviable-system/src/sync/sync-merge.service.ts's LwwOutcome.
 */
export type LwwOutcome = {
  path: string;
  policy: "LAST_WRITE_WINS";
  winner: "incoming" | "server";
  appliedValue: unknown;
  discardedValue: unknown;
};

export type ReviewRef = {
  id: string;
  field: string;
};

/**
 * Per-action result from POST /api/sync/actions. Mirrors the backend's
 * ActionResult in sync-actions.service.ts.
 *
 * IMPORTANT: `processed` and `duplicate` are both successes from the user's
 * perspective. `duplicate` means the same clientId was already processed (the
 * backend's idempotency core skipped re-running the work); the server state is
 * what it became on first processing, and a re-drain produces no additional
 * effect. The engine treats both as "synced" for the user-facing status; the
 * distinction lives in serverWasDuplicate for diagnostics and verification.
 */
export type SyncActionStatus = "processed" | "duplicate" | "error" | "conflict";

/**
 * Conflict kinds the sync intake surfaces. Each is routed differently:
 *
 *   constraint-violations  Clerk-resolvable conflict carrying the exhaustive
 *                          named-violation array (the convention from prompt
 *                          5.5, restored across the sync intake by the
 *                          subsequent backend fix). The /sync/conflicts page
 *                          renders the registered DetailRenderer + ReOpener
 *                          for the action's type; the clerk re-opens the
 *                          flow's form, fixes the offending cells against
 *                          current state, and re-submits with the SAME
 *                          clientId (safe-by-retry: conflicts are not
 *                          recorded by idempotency, so corrected re-runs are
 *                          clean).
 *   unique                 Lower-level unique-constraint clash; pre-prompt-9
 *                          shape, kept for compatibility.
 *   field-review           High-stakes entity.update field collision; goes
 *                          to the supervisor review queue, NOT the
 *                          clerk-resolvable conflicts page. Distinct surface.
 */
export type SyncConflict =
  | { kind: "constraint-violations"; violations: ReceiptDuplicateViolation[] }
  | { kind: "unique"; field: string; value: unknown }
  | { kind: "field-review"; reviews: ReviewRef[] };

export type ActionResult = {
  clientId: string;
  type: SyncActionType | string;
  status: SyncActionStatus;
  resultRef?: string | null;
  applied?: string[];
  lastWriteWins?: LwwOutcome[];
  conflict?: SyncConflict;
  error?: string;
};

export type SyncBatchResponse = {
  results: ActionResult[];
};

/**
 * What goes into the action_queue store. Keyed on clientId (UUID); the backend
 * uses the same clientId as its idempotency key. Replaying an already-processed
 * clientId returns `duplicate` with NO additional server effect, which is the
 * foundation's core guarantee.
 */
export type QueuedAction = {
  clientId: string;
  type: SyncActionType;
  payload: Record<string, unknown>;
  clientTimestamp: string;
  deviceId: string;
  createdAt: string;
  status: ActionStatus;
  description: string;

  syncedAt?: string;
  serverResultRef?: string | null;
  serverWasDuplicate?: boolean;
  lastWriteWins?: LwwOutcome[];
  applied?: string[];

  errorMessage?: string;
  conflictBody?: Record<string, unknown>;
};

export type ConnectivityState = "online" | "offline" | "unknown";

export type SyncEngineState = "idle" | "syncing";
