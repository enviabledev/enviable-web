/**
 * Offline action queue. CRUD over the action_queue IndexedDB store with the
 * status-machine transitions enforced by the engine, and per-browser deviceId
 * persisted once in the meta store.
 *
 * Crucially the queue is keyed on clientId, which is the SAME id used as the
 * backend's idempotency key. A re-drain reuses the stored clientId, which is
 * what guarantees that the server reports `duplicate` on replay and skips the
 * work. The client side of idempotency is literally "use the same clientId on
 * replay"; storing it as the primary key makes that automatic.
 */
import {
  INDEX_CREATED_AT,
  INDEX_STATUS,
  STORE_ACTION_QUEUE,
  STORE_META,
  reqToPromise,
  withStore,
} from "./db";
import type {
  ActionStatus,
  LwwOutcome,
  QueuedAction,
  SyncActionType,
} from "./types";

const META_DEVICE_ID = "deviceId";

function uuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Defensive fallback for unusual environments. Evergreen browsers and Node 18+
  // have crypto.randomUUID, so this is rarely hit; not cryptographically strong.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export async function getDeviceId(): Promise<string> {
  const existing = await withStore<{ key: string; value: string } | undefined>(
    STORE_META,
    "readonly",
    (store) => reqToPromise(store.get(META_DEVICE_ID)),
  );
  if (existing?.value) return existing.value;
  const value = uuid();
  await withStore(STORE_META, "readwrite", (store) =>
    reqToPromise(store.put({ key: META_DEVICE_ID, value })),
  );
  return value;
}

export async function enqueue(params: {
  type: SyncActionType;
  payload: Record<string, unknown>;
  description: string;
}): Promise<QueuedAction> {
  const deviceId = await getDeviceId();
  const now = new Date().toISOString();
  const action: QueuedAction = {
    clientId: uuid(),
    type: params.type,
    payload: params.payload,
    clientTimestamp: now,
    deviceId,
    createdAt: now,
    status: "queued",
    description: params.description,
  };
  await withStore(STORE_ACTION_QUEUE, "readwrite", (store) =>
    reqToPromise(store.add(action)),
  );
  return action;
}

export async function listAll(): Promise<QueuedAction[]> {
  return withStore<QueuedAction[]>(
    STORE_ACTION_QUEUE,
    "readonly",
    (store) => {
      const idx = store.index(INDEX_CREATED_AT);
      return reqToPromise(idx.getAll());
    },
  );
}

export async function listByStatus(
  status: ActionStatus,
): Promise<QueuedAction[]> {
  return withStore<QueuedAction[]>(
    STORE_ACTION_QUEUE,
    "readonly",
    (store) => {
      const idx = store.index(INDEX_STATUS);
      return reqToPromise(idx.getAll(IDBKeyRange.only(status)));
    },
  );
}

/**
 * FIFO list of actions that are queued or in mid-drain (syncing). Used by
 * engine.drain() to find work. Returned in createdAt order.
 */
export async function listDrainable(): Promise<QueuedAction[]> {
  const all = await listAll();
  return all
    .filter((a) => a.status === "queued" || a.status === "syncing")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function listForDisplay(limit = 20): Promise<QueuedAction[]> {
  const all = await listAll();
  return all
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

export async function getByClientId(
  clientId: string,
): Promise<QueuedAction | undefined> {
  return withStore<QueuedAction | undefined>(
    STORE_ACTION_QUEUE,
    "readonly",
    (store) => reqToPromise(store.get(clientId)),
  );
}

async function patch(
  clientId: string,
  patcher: (a: QueuedAction) => QueuedAction,
): Promise<QueuedAction | undefined> {
  return withStore<QueuedAction | undefined>(
    STORE_ACTION_QUEUE,
    "readwrite",
    async (store) => {
      const current = await reqToPromise(store.get(clientId));
      if (!current) return undefined;
      const next = patcher(current as QueuedAction);
      await reqToPromise(store.put(next));
      return next;
    },
  );
}

export function markSyncing(clientId: string) {
  return patch(clientId, (a) => ({ ...a, status: "syncing" }));
}

/**
 * Mark synced. Used for BOTH `processed` AND `duplicate` server outcomes,
 * because per the user-facing model both mean "your work is saved on the
 * server." The serverWasDuplicate flag preserves the distinction for diagnostics
 * and verification; it is never used to alarm the user.
 */
export function markSynced(
  clientId: string,
  details: {
    serverResultRef?: string | null;
    serverWasDuplicate: boolean;
    lastWriteWins?: LwwOutcome[];
    applied?: string[];
  },
) {
  return patch(clientId, (a) => ({
    ...a,
    status: "synced",
    syncedAt: new Date().toISOString(),
    serverResultRef: details.serverResultRef ?? null,
    serverWasDuplicate: details.serverWasDuplicate,
    lastWriteWins: details.lastWriteWins,
    applied: details.applied,
    errorMessage: undefined,
    conflictBody: undefined,
  }));
}

/**
 * Mark failed (transient error: the action will be retried on next drain). The
 * backend's idempotency core does NOT record actions whose work threw, so a
 * retry of a failed action re-runs the work; this is correct and safe.
 */
export function markFailed(clientId: string, errorMessage: string) {
  return patch(clientId, (a) => ({
    ...a,
    status: "failed",
    errorMessage,
  }));
}

/**
 * Reset a failed action back to queued so it will be re-attempted on the next
 * drain. The clientId is preserved, so if the previous attempt actually
 * succeeded on the server but the response was lost, the retry returns
 * `duplicate` and the server state is unchanged.
 */
export function retryFailed(clientId: string) {
  return patch(clientId, (a) => ({
    ...a,
    status: "queued",
    errorMessage: undefined,
  }));
}

export function markConflict(
  clientId: string,
  conflictBody: Record<string, unknown>,
) {
  return patch(clientId, (a) => ({
    ...a,
    status: "conflict",
    conflictBody,
  }));
}

export async function removeByClientId(clientId: string): Promise<void> {
  await withStore(STORE_ACTION_QUEUE, "readwrite", (store) =>
    reqToPromise(store.delete(clientId)),
  );
}

/**
 * Reset a synced action back to queued, reusing the same clientId. The engine
 * will re-POST it and the backend will return `duplicate` because that clientId
 * is already in ProcessedSyncAction. Used only by the dev-only Force Replay
 * affordance; not a production behaviour.
 */
export function resetForReplay(clientId: string) {
  return patch(clientId, (a) => ({
    ...a,
    status: "queued",
    syncedAt: undefined,
  }));
}
