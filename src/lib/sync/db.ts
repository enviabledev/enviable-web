/**
 * Minimal IndexedDB wrapper for the offline action queue. No external
 * dependency: a ~50-line Promise shim around the bits we use (open, get, put,
 * delete, getAll-by-index, cursor scan). The schema is two stores:
 *
 *   action_queue   keyPath=clientId   indexed by status, createdAt
 *   meta           keyPath=key        single-row stores like deviceId
 *
 * The queue stores DOMAIN ACTIONS ONLY. Per the auth model (Option A,
 * see CLAUDE.md), the session cookie is httpOnly and JS NEVER stores or reads
 * auth tokens. Nothing in this DB is auth-bearing.
 */

const DB_NAME = "enviable-sync";
const DB_VERSION = 1;

export const STORE_ACTION_QUEUE = "action_queue";
export const STORE_META = "meta";

export const INDEX_STATUS = "by_status";
export const INDEX_CREATED_AT = "by_createdAt";

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(
      new Error("IndexedDB unavailable: sync queue requires a browser context"),
    );
  }
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_ACTION_QUEUE)) {
        const store = db.createObjectStore(STORE_ACTION_QUEUE, {
          keyPath: "clientId",
        });
        store.createIndex(INDEX_STATUS, "status", { unique: false });
        store.createIndex(INDEX_CREATED_AT, "createdAt", { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
    req.onblocked = () => reject(new Error("IndexedDB open blocked"));
  });

  return dbPromise;
}

type TxMode = "readonly" | "readwrite";

export async function withStore<T>(
  storeName: string,
  mode: TxMode,
  work: (store: IDBObjectStore) => Promise<T> | T,
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let result: T;
    let workError: unknown = null;
    Promise.resolve(work(store))
      .then((value) => {
        result = value;
      })
      .catch((err: unknown) => {
        workError = err;
        tx.abort();
      });
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error ?? workError ?? new Error("IDB tx error"));
    tx.onabort = () => reject(workError ?? tx.error ?? new Error("IDB tx aborted"));
  });
}

export function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IDB request failed"));
  });
}

/**
 * Test hook: drop the DB. Used by no production code; only the dev console for
 * resetting between probes.
 */
export async function deleteDb(): Promise<void> {
  dbPromise = null;
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error("IDB delete failed"));
    req.onblocked = () => resolve();
  });
}
