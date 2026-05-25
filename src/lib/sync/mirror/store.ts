"use client";

/**
 * CRUD over the mirror_records IDB store. The store is the rolling 90-day
 * cache of server data that the read screens consume offline.
 *
 * CRITICAL: every operation here is scoped to STORE_MIRROR. The action_queue
 * (pending offline writes) is in a separate store and these helpers cannot
 * touch it; eviction by age cannot accidentally evict a clerk's unsynced
 * work because the eviction transaction is opened only over STORE_MIRROR.
 *
 * The meta-key watermark helpers also live here because they are part of the
 * same mirror-state surface (where do we stand, when did we last sync).
 */
import {
  INDEX_MIRROR_UPDATED_AT,
  STORE_META,
  STORE_MIRROR,
  reqToPromise,
  withStore,
} from "../db";
import type { EntityType, MirrorRecord, MirrorWatermark } from "./types";

export const MIRROR_WATERMARK_KEY = "mirror_watermark";

export async function upsertOne(rec: MirrorRecord): Promise<void> {
  await withStore(STORE_MIRROR, "readwrite", (store) =>
    reqToPromise(store.put(rec)),
  );
}

/**
 * Bulk upsert into the mirror store. Reuses one transaction across all puts
 * so a large window's commit is atomic at the IDB level: either every row
 * lands or the transaction aborts and the mirror is unchanged. The atomic
 * window contract relies on this.
 */
export async function upsertMany(records: MirrorRecord[]): Promise<void> {
  if (records.length === 0) return;
  await withStore(STORE_MIRROR, "readwrite", async (store) => {
    for (const rec of records) {
      await reqToPromise(store.put(rec));
    }
  });
}

export async function getById<T = Record<string, unknown>>(
  entityType: EntityType,
  id: string,
): Promise<(MirrorRecord & { body: T }) | undefined> {
  return withStore<(MirrorRecord & { body: T }) | undefined>(
    STORE_MIRROR,
    "readonly",
    async (store) => {
      const row = (await reqToPromise(store.get([entityType, id]))) as
        | MirrorRecord
        | undefined;
      return row as (MirrorRecord & { body: T }) | undefined;
    },
  );
}

/**
 * List every mirrored row of one entity type. Uses a key range over the
 * compound key's first element, [type, ''] to [type, '￿'], so the
 * scan visits only this type's rows without filtering after the fact.
 */
export async function listByType<T = Record<string, unknown>>(
  entityType: EntityType,
): Promise<Array<MirrorRecord & { body: T }>> {
  return withStore<Array<MirrorRecord & { body: T }>>(
    STORE_MIRROR,
    "readonly",
    async (store) => {
      const range = IDBKeyRange.bound(
        [entityType, ""],
        [entityType, "￿"],
        false,
        false,
      );
      const rows = (await reqToPromise(store.getAll(range))) as MirrorRecord[];
      return rows as Array<MirrorRecord & { body: T }>;
    },
  );
}

export async function countByType(entityType: EntityType): Promise<number> {
  return withStore<number>(STORE_MIRROR, "readonly", async (store) => {
    const range = IDBKeyRange.bound(
      [entityType, ""],
      [entityType, "￿"],
      false,
      false,
    );
    return reqToPromise(store.count(range));
  });
}

export async function countAll(): Promise<number> {
  return withStore<number>(STORE_MIRROR, "readonly", (store) =>
    reqToPromise(store.count()),
  );
}

/**
 * Evict records with updatedAt strictly before `cutoffIso`. ONLY touches
 * STORE_MIRROR; cannot reach STORE_ACTION_QUEUE by construction (the
 * transaction is opened over the mirror store alone). This is the safety
 * property that makes the age policy never erase pending offline work.
 *
 * Returns the count evicted.
 */
export async function evictOlderThan(cutoffIso: string): Promise<number> {
  return withStore<number>(STORE_MIRROR, "readwrite", async (store) => {
    const idx = store.index(INDEX_MIRROR_UPDATED_AT);
    const range = IDBKeyRange.upperBound(cutoffIso, true);
    let evicted = 0;
    await new Promise<void>((resolve, reject) => {
      const req = idx.openCursor(range);
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          resolve();
          return;
        }
        cursor.delete();
        evicted += 1;
        cursor.continue();
      };
      req.onerror = () => reject(req.error ?? new Error("evict cursor error"));
    });
    return evicted;
  });
}

export async function loadWatermark(): Promise<MirrorWatermark | null> {
  const row = await withStore<{ key: string; value: MirrorWatermark } | undefined>(
    STORE_META,
    "readonly",
    (store) => reqToPromise(store.get(MIRROR_WATERMARK_KEY)),
  );
  return row?.value ?? null;
}

export async function saveWatermark(w: MirrorWatermark): Promise<void> {
  await withStore(STORE_META, "readwrite", (store) =>
    reqToPromise(store.put({ key: MIRROR_WATERMARK_KEY, value: w })),
  );
}

export async function clearMirror(): Promise<void> {
  await withStore(STORE_MIRROR, "readwrite", (store) =>
    reqToPromise(store.clear()),
  );
}
