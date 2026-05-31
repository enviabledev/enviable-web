"use client";

/**
 * Windowed initial download for the 90-day mirror. Walks 7-day windows
 * oldest-to-newest from (today - 90d) to today, fully drains each window's
 * unit pagination, then commits the entire window atomically (every reference
 * record + every unit + the watermark advance, in one IDB transaction).
 *
 * Atomic-window contract: if connectivity drops mid-window, NOTHING from that
 * window has been written; the next download resumes from the same window's
 * `from` and tries again. The mirror always reflects "complete through
 * `nextWindowFrom`" at any instant; partial windows are invisible because
 * they were never committed.
 *
 * Single-flight: a module-level mutex prevents two concurrent downloads.
 *
 * Cancellation: an AbortController passed into start() lets SyncBoot stop
 * the download when offline/online transitions or auth flips happen. The
 * mutex releases on completion or abort.
 */
import { connectivity } from "../connectivity";
import {
  STORE_META,
  STORE_MIRROR,
  reqToPromise,
  withStores,
} from "../db";
import { pullWindow } from "./api";
import { pickIdAndTimestamp } from "./spine";
import { MIRROR_WATERMARK_KEY, loadWatermark, saveWatermark } from "./store";
import {
  REF_KEY_TO_ENTITY,
  type EntityType,
  type MirrorRecord,
  type MirrorWatermark,
  type PullResponse,
  type ReferenceData,
} from "./types";

export const WINDOW_DAYS = 7;
export const HISTORY_DAYS = 90;
export const DEFAULT_LIMIT = 500;

const dayMs = 24 * 60 * 60 * 1000;

let inFlight = false;

export type DownloadProgressListener = (w: MirrorWatermark) => void;
const progressListeners = new Set<DownloadProgressListener>();

export function onDownloadProgress(l: DownloadProgressListener): () => void {
  progressListeners.add(l);
  return () => progressListeners.delete(l);
}

function emitProgress(w: MirrorWatermark) {
  progressListeners.forEach((l) => l(w));
}

/**
 * Initialise (or reload) the watermark. On first run, anchor history at
 * (now - 90d) and step forward in 7-day chunks. Subsequent runs find the
 * existing watermark and resume.
 */
async function ensureWatermark(): Promise<MirrorWatermark> {
  const existing = await loadWatermark();
  if (existing) return existing;
  const now = new Date();
  const targetTo = now.toISOString();
  const initialFrom = new Date(now.getTime() - HISTORY_DAYS * dayMs).toISOString();
  const fresh: MirrorWatermark = {
    nextWindowFrom: initialFrom,
    historyTargetTo: targetTo,
    reconcilerSince: targetTo,
    lastSyncAt: null,
    historyComplete: false,
  };
  await saveWatermark(fresh);
  emitProgress(fresh);
  return fresh;
}

/**
 * One window's worth of accumulated rows, buffered in memory before the
 * single atomic IDB commit. The shape mirrors the mirror_records value
 * directly; mirroredAt is stamped on commit (not per-page) so a single
 * window's rows share one mirroredAt.
 */
type WindowBuffer = {
  rows: MirrorRecord[];
};

function refRowsToMirrorRecords(
  ref: ReferenceData,
  mirroredAt: string,
): MirrorRecord[] {
  const out: MirrorRecord[] = [];
  for (const refKey of Object.keys(REF_KEY_TO_ENTITY) as Array<
    keyof ReferenceData
  >) {
    const rows = (ref[refKey] ?? []) as Array<Record<string, unknown>>;
    const entityType = REF_KEY_TO_ENTITY[refKey];
    for (const row of rows) {
      const picked = pickIdAndTimestamp(row, entityType);
      if (!picked) continue;
      out.push({ entityType, id: picked.id, updatedAt: picked.ts, mirroredAt, body: row });
    }
  }
  return out;
}

function unitRowsToMirrorRecords(
  units: PullResponse["units"],
  mirroredAt: string,
): MirrorRecord[] {
  const out: MirrorRecord[] = [];
  for (const u of units) {
    const picked = pickIdAndTimestamp(u as Record<string, unknown>, "unit");
    if (!picked) continue;
    out.push({
      entityType: "unit" as EntityType,
      id: picked.id,
      updatedAt: picked.ts,
      mirroredAt,
      body: u,
    });
  }
  return out;
}

/**
 * Drain one [from, to) window fully into the buffer, then commit atomically.
 * Returns true if the window committed, false if connectivity was lost or the
 * abort signal fired before the commit.
 */
async function downloadAndCommitWindow(
  from: string,
  to: string,
  watermark: MirrorWatermark,
  signal?: AbortSignal,
): Promise<boolean> {
  const buffer: WindowBuffer = { rows: [] };
  let cursor: string | undefined = undefined;
  let firstPage = true;

  // Drain the whole window: first page carries reference data; subsequent
  // pages carry units-only continuation until truncated is false.
  while (true) {
    if (signal?.aborted) return false;
    if (connectivity.getState() === "offline") return false;

    const res = await pullWindow(
      { from, to, limit: DEFAULT_LIMIT, cursor },
      signal,
    );
    if (res.kind !== "ok") {
      // Any non-ok (unauthorized, network_error, server_error) aborts THIS
      // window without committing. Retry happens on next online event.
      return false;
    }
    const page: PullResponse = res.data;

    const mirroredAt = new Date().toISOString();
    if (firstPage) {
      buffer.rows.push(...refRowsToMirrorRecords(page.referenceData, mirroredAt));
      firstPage = false;
    }
    buffer.rows.push(...unitRowsToMirrorRecords(page.units, mirroredAt));

    if (!page.truncated) break;
    cursor = page.cursor ?? undefined;
    if (!cursor) {
      // Defensive: truncated true but no cursor should not happen. Stop to
      // avoid an infinite loop.
      return false;
    }
  }

  if (signal?.aborted) return false;

  // Atomic commit: every row of the window + the watermark advance, in ONE
  // transaction across mirror_records + meta. A crash or abort here leaves
  // either every row or no rows; the watermark never advances ahead of the
  // data, and the data never advances past an unrecorded watermark.
  const commitMirroredAt = new Date().toISOString();
  const nextWatermark: MirrorWatermark = {
    ...watermark,
    nextWindowFrom: to,
    lastSyncAt: commitMirroredAt,
    historyComplete: new Date(to) >= new Date(watermark.historyTargetTo),
  };

  await withStores(
    [STORE_MIRROR, STORE_META],
    "readwrite",
    async (stores) => {
      const mirror = stores[STORE_MIRROR];
      const meta = stores[STORE_META];
      for (const row of buffer.rows) {
        await reqToPromise(mirror.put(row));
      }
      await reqToPromise(
        meta.put({ key: MIRROR_WATERMARK_KEY, value: nextWatermark }),
      );
    },
  );

  console.log(
    `[mirror] window ${from.slice(0, 10)} -> ${to.slice(0, 10)} committed: ${buffer.rows.length} rows`,
  );

  emitProgress(nextWatermark);
  return true;
}

/**
 * Drive the full historical download. Walks windows oldest-to-newest until
 * `nextWindowFrom >= historyTargetTo`, at which point the reconciler takes
 * over for ongoing deltas. Safe to call repeatedly: single-flight gates
 * concurrent invocations and the watermark resumes mid-history.
 */
export async function downloadHistory(signal?: AbortSignal): Promise<void> {
  if (inFlight) {
    console.log("[mirror] history download already in flight, skip");
    return;
  }
  inFlight = true;
  try {
    let watermark = await ensureWatermark();

    if (
      new Date(watermark.nextWindowFrom) >= new Date(watermark.historyTargetTo)
    ) {
      console.log(
        "[mirror] history already complete (watermark at",
        watermark.nextWindowFrom,
        ")",
      );
      return;
    }

    console.log(
      "[mirror] history download starting from",
      watermark.nextWindowFrom,
      "to",
      watermark.historyTargetTo,
    );

    let windowIndex = 0;
    while (
      new Date(watermark.nextWindowFrom) < new Date(watermark.historyTargetTo)
    ) {
      if (signal?.aborted) {
        console.log("[mirror] history download aborted by signal");
        return;
      }
      if (connectivity.getState() === "offline") {
        console.log("[mirror] history download paused: offline");
        return;
      }

      const from = watermark.nextWindowFrom;
      const fromDate = new Date(from);
      const proposedToDate = new Date(fromDate.getTime() + WINDOW_DAYS * dayMs);
      const targetToDate = new Date(watermark.historyTargetTo);
      const toDate =
        proposedToDate > targetToDate ? targetToDate : proposedToDate;
      const to = toDate.toISOString();

      windowIndex += 1;
      console.log(
        `[mirror] window ${windowIndex}: ${from.slice(0, 10)} -> ${to.slice(0, 10)} downloading`,
      );

      const committed = await downloadAndCommitWindow(
        from,
        to,
        watermark,
        signal,
      );
      if (!committed) {
        console.log(
          `[mirror] window ${windowIndex} did NOT commit (offline / non-ok pull); will retry on next online tick`,
        );
        return;
      }

      const refreshed = await loadWatermark();
      if (!refreshed) return;
      watermark = refreshed;
    }
    console.log(
      "[mirror] history download complete; reconciler takes over from here",
    );
  } finally {
    inFlight = false;
  }
}

/**
 * Eviction cutoff: keep rows with updatedAt within the rolling HISTORY_DAYS.
 * Computed lazily so eviction always reflects "today minus 90 days," not
 * the moment the mirror was bootstrapped.
 */
export function evictionCutoffIso(): string {
  return new Date(Date.now() - HISTORY_DAYS * dayMs).toISOString();
}
