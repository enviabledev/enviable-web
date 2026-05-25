"use client";

/**
 * Ongoing reconciling since-delta. Once the historical 90-day download is
 * complete, this is what keeps the mirror current: pulls everything updated
 * after the watermark's `reconcilerSince`, merges into the mirror via upsert
 * (NOT wipe-and-replace), advances the since anchor, runs eviction, advances
 * lastSyncAt.
 *
 * The merge-not-replace property is the load-bearing one: a clerk's local
 * mirror is the source of read continuity, and an ongoing sync must update
 * what changed without disturbing what didn't. The IDB `put` is upsert by
 * key, so writes touch only the (entityType, id) rows the server actually
 * returned; the rest of the mirror is untouched, and the action_queue is
 * never opened by this transaction so pending writes are sacrosanct by
 * construction.
 */
import { connectivity } from "../connectivity";
import {
  STORE_META,
  STORE_MIRROR,
  reqToPromise,
  withStores,
} from "../db";
import { pullSince } from "./api";
import { evictionCutoffIso } from "./downloader";
import {
  MIRROR_WATERMARK_KEY,
  evictOlderThan,
  loadWatermark,
  saveWatermark,
} from "./store";
import {
  REF_KEY_TO_ENTITY,
  type EntityType,
  type MirrorRecord,
  type MirrorWatermark,
  type PullResponse,
  type ReferenceData,
} from "./types";

const DEFAULT_LIMIT = 500;

let inFlight = false;

export type ReconcilerListener = (w: MirrorWatermark) => void;
const listeners = new Set<ReconcilerListener>();

export function onReconcile(l: ReconcilerListener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

function emit(w: MirrorWatermark) {
  listeners.forEach((l) => l(w));
}

function refToRecords(ref: ReferenceData, mirroredAt: string): MirrorRecord[] {
  const out: MirrorRecord[] = [];
  for (const refKey of Object.keys(REF_KEY_TO_ENTITY) as Array<
    keyof ReferenceData
  >) {
    const rows = (ref[refKey] ?? []) as Array<Record<string, unknown>>;
    const entityType = REF_KEY_TO_ENTITY[refKey];
    for (const row of rows) {
      const id = row.id as string | undefined;
      const updatedAt = row.updatedAt as string | undefined;
      if (typeof id !== "string" || typeof updatedAt !== "string") continue;
      out.push({ entityType, id, updatedAt, mirroredAt, body: row });
    }
  }
  return out;
}

function unitsToRecords(
  units: PullResponse["units"],
  mirroredAt: string,
): MirrorRecord[] {
  const out: MirrorRecord[] = [];
  for (const u of units) {
    if (typeof u.id !== "string" || typeof u.updatedAt !== "string") continue;
    out.push({
      entityType: "unit" as EntityType,
      id: u.id,
      updatedAt: u.updatedAt,
      mirroredAt,
      body: u,
    });
  }
  return out;
}

/**
 * Run one reconcile cycle: pull since the current watermark, drain pagination
 * within that cycle, upsert all returned rows into the mirror, advance the
 * since anchor, run age-eviction, stamp lastSyncAt.
 *
 * Returns counts for verification: how many rows merged, how many evicted.
 * Aborts silently on offline / non-ok results; the mirror and watermark are
 * unchanged until a full cycle commits.
 */
export type ReconcileResult = {
  merged: number;
  evicted: number;
  skipped: boolean;
  reason?: string;
};

export async function reconcile(
  signal?: AbortSignal,
): Promise<ReconcileResult> {
  if (inFlight) return { merged: 0, evicted: 0, skipped: true, reason: "in-flight" };
  inFlight = true;
  try {
    const watermark = await loadWatermark();
    if (!watermark) {
      return { merged: 0, evicted: 0, skipped: true, reason: "no-watermark" };
    }
    if (!watermark.historyComplete) {
      // Let the downloader finish before turning on ongoing reconcile so the
      // since-anchor is stable. The downloader's own watermark.lastSyncAt
      // already reflects fresh history pulls, so freshness disclosure stays
      // honest during bootstrap.
      return {
        merged: 0,
        evicted: 0,
        skipped: true,
        reason: "history-incomplete",
      };
    }
    if (connectivity.getState() === "offline") {
      return { merged: 0, evicted: 0, skipped: true, reason: "offline" };
    }

    const buffered: MirrorRecord[] = [];
    let cursor: string | undefined = undefined;
    let nextSinceFromServer = watermark.reconcilerSince;
    let firstPage = true;

    while (true) {
      if (signal?.aborted) {
        return { merged: 0, evicted: 0, skipped: true, reason: "aborted" };
      }
      const res = await pullSince(
        {
          since: watermark.reconcilerSince,
          limit: DEFAULT_LIMIT,
          cursor,
        },
        signal,
      );
      if (res.kind !== "ok") {
        return { merged: 0, evicted: 0, skipped: true, reason: res.kind };
      }
      const page: PullResponse = res.data;
      const mirroredAt = new Date().toISOString();
      if (firstPage) {
        buffered.push(...refToRecords(page.referenceData, mirroredAt));
        firstPage = false;
      }
      buffered.push(...unitsToRecords(page.units, mirroredAt));
      nextSinceFromServer = page.nextSince;

      if (!page.truncated) break;
      cursor = page.cursor ?? undefined;
      if (!cursor) break;
    }

    // Merge: upsert all rows, advance since, stamp lastSyncAt. Single
    // transaction over mirror + meta only; action_queue is NOT in this
    // transaction so pending offline writes are untouched by construction.
    const commitTime = new Date().toISOString();
    const nextWatermark: MirrorWatermark = {
      ...watermark,
      reconcilerSince: nextSinceFromServer,
      lastSyncAt: commitTime,
    };
    await withStores(
      [STORE_MIRROR, STORE_META],
      "readwrite",
      async (stores) => {
        const mirror = stores[STORE_MIRROR];
        const meta = stores[STORE_META];
        for (const row of buffered) {
          await reqToPromise(mirror.put(row));
        }
        await reqToPromise(
          meta.put({ key: MIRROR_WATERMARK_KEY, value: nextWatermark }),
        );
      },
    );
    emit(nextWatermark);

    // Age-eviction in a separate, mirror-only transaction. Cannot touch the
    // action queue. Runs after each reconcile so the rolling 90-day bound
    // is maintained without requiring a separate scheduler.
    const evicted = await evictOlderThan(evictionCutoffIso());

    console.log(
      `[mirror] reconcile: ${buffered.length} merged, ${evicted} evicted, since advanced to ${nextSinceFromServer}`,
    );

    return { merged: buffered.length, evicted, skipped: false };
  } finally {
    inFlight = false;
  }
}

/**
 * Read-only helper for the SyncBoot wiring: returns the current watermark
 * without mutating it. Used to decide whether to run history vs reconcile.
 */
export async function getWatermark(): Promise<MirrorWatermark | null> {
  return loadWatermark();
}

// Re-export for completeness so callers don't need both modules.
export { saveWatermark };
