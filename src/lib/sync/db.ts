/**
 * Minimal IndexedDB wrapper for the offline sync layer. No external
 * dependency: a ~70-line Promise shim around the bits we use (open, get, put,
 * delete, getAll-by-index, cursor scan). The schema is three stores:
 *
 *   action_queue    keyPath=clientId            indexed by status, createdAt
 *   meta            keyPath=key                 single-row stores (deviceId,
 *                                               cached principal, mirror watermark)
 *   mirror_records  keyPath=[entityType, id]    indexed by updatedAt
 *
 * The action_queue stores DOMAIN ACTIONS ONLY (pending offline writes, sacred,
 * never evicted by the mirror's age policy).
 *
 * The mirror_records store holds the rolling 90-day server-data cache the
 * read screens consume offline. Keyed compound on entityType + id so each
 * (type, id) is one row; range scans by [type, ''] to [type, '￿'] iterate
 * all rows of one type without needing a separate type index. The updatedAt
 * index supports eviction (delete rows with updatedAt < cutoff).
 *
 * Per the auth model (Option A, see CLAUDE.md), the session cookie is httpOnly
 * and JS NEVER stores or reads auth tokens. Nothing in this DB is auth-bearing
 * in the credential sense; the principal cache is identity metadata only,
 * see lib/auth/principal-cache.ts.
 */

const DB_NAME = "enviable-sync";
const DB_VERSION = 2;

export const STORE_ACTION_QUEUE = "action_queue";
export const STORE_META = "meta";
export const STORE_MIRROR = "mirror_records";

export const INDEX_STATUS = "by_status";
export const INDEX_CREATED_AT = "by_createdAt";
export const INDEX_MIRROR_UPDATED_AT = "by_updatedAt";

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
      // v1 stores: created on first install, preserved across upgrade.
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
      // v2 add: the mirror_records store for the rolling 90-day read mirror.
      // Compound key keeps each (type, id) as one row; range scans on the
      // first key element iterate one type at a time.
      if (!db.objectStoreNames.contains(STORE_MIRROR)) {
        const mirror = db.createObjectStore(STORE_MIRROR, {
          keyPath: ["entityType", "id"],
        });
        mirror.createIndex(INDEX_MIRROR_UPDATED_AT, "updatedAt", {
          unique: false,
        });
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

/**
 * Multi-store transaction. Used for atomic-per-window commits where we upsert
 * to mirror_records AND advance the watermark in meta in one transaction, so
 * a crash mid-commit leaves no half-state. The work callback receives the
 * stores by name; only those declared in `storeNames` are accessible.
 */
export async function withStores<T>(
  storeNames: string[],
  mode: TxMode,
  work: (stores: Record<string, IDBObjectStore>) => Promise<T> | T,
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(storeNames, mode);
    const stores: Record<string, IDBObjectStore> = {};
    for (const name of storeNames) stores[name] = tx.objectStore(name);
    let result: T;
    let workError: unknown = null;
    Promise.resolve(work(stores))
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
