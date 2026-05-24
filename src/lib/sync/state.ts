"use client";

/**
 * Reactive view over the queue + engine + connectivity state for the indicator.
 *
 * Subscribes to engine change pings (fired on every queue mutation and on
 * engine state transitions) and re-reads the queue from IndexedDB on each ping.
 * Connectivity is its own subscription. This is intentionally simple: there is
 * no separate event bus and no caching; the queue size stays tiny (most
 * sessions will have at most a handful of unsynced actions) and a getAll() per
 * ping is cheap.
 */
import { useEffect, useState } from "react";

import { connectivity } from "./connectivity";
import { syncEngine } from "./engine";
import { listForDisplay } from "./queue";
import type {
  ActionStatus,
  ConnectivityState,
  QueuedAction,
  SyncEngineState,
} from "./types";

export type SyncCounts = Record<ActionStatus, number>;

export type SyncSnapshot = {
  connectivity: ConnectivityState;
  engineState: SyncEngineState;
  counts: SyncCounts;
  recent: QueuedAction[];
};

const EMPTY_COUNTS: SyncCounts = {
  queued: 0,
  syncing: 0,
  synced: 0,
  failed: 0,
  conflict: 0,
};

function countBy(actions: QueuedAction[]): SyncCounts {
  const c: SyncCounts = { ...EMPTY_COUNTS };
  for (const a of actions) c[a.status] += 1;
  return c;
}

export function useSyncSnapshot(): SyncSnapshot {
  const [conn, setConn] = useState<ConnectivityState>(() =>
    connectivity.getState(),
  );
  const [engineState, setEngineState] = useState<SyncEngineState>(() =>
    syncEngine.getState(),
  );
  const [recent, setRecent] = useState<QueuedAction[]>([]);

  useEffect(() => connectivity.subscribe(setConn), []);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const list = await listForDisplay(20);
      if (!active) return;
      setRecent(list);
      setEngineState(syncEngine.getState());
    };
    void refresh();
    const unsub = syncEngine.subscribe(() => {
      void refresh();
    });
    return () => {
      active = false;
      unsub();
    };
  }, []);

  return {
    connectivity: conn,
    engineState,
    counts: countBy(recent),
    recent,
  };
}
