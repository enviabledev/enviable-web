"use client";

/**
 * Mirror freshness hook. Reads the watermark from IDB on mount + on every
 * downloader/reconciler progress event. Exposes the wall-clock time of the
 * latest successful pull (downloader OR reconciler advance) plus the
 * historyComplete flag for any UI that wants to distinguish "still
 * bootstrapping" from "rolling-current."
 */
import { useEffect, useState } from "react";

import { onDownloadProgress } from "./downloader";
import { onReconcile } from "./reconciler";
import { loadWatermark } from "./store";
import type { MirrorWatermark } from "./types";

export function useMirrorFreshness(): MirrorWatermark | null {
  const [watermark, setWatermark] = useState<MirrorWatermark | null>(null);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const w = await loadWatermark();
      if (active) setWatermark(w);
    };
    void refresh();
    const unsubDownload = onDownloadProgress(setWatermark);
    const unsubReconcile = onReconcile(setWatermark);
    return () => {
      active = false;
      unsubDownload();
      unsubReconcile();
    };
  }, []);

  return watermark;
}

/**
 * Short relative-time string for the freshness badge. "Just synced" within
 * 60 seconds; "N min ago" up to 60 min; "HH:MM" up to today's date; full
 * date beyond. Stable on second precision so re-renders aren't jumpy.
 */
export function shortFreshness(iso: string | null | undefined): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  const now = Date.now();
  const sec = Math.max(0, Math.floor((now - then) / 1000));
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const sameDay =
    new Date(then).toDateString() === new Date(now).toDateString();
  if (sameDay) {
    return new Date(then).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return new Date(then).toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
