"use client";

/**
 * Topbar sync-status pill. The indicator's honesty is load-bearing: a clerk
 * must never be unsure whether their work is saved on the server or sitting
 * locally. Concretely:
 *
 *   queued    -> "Saved locally, will sync"  NOT "Done"
 *   syncing   -> "Syncing now"
 *   synced    -> "Synced"                    (processed AND duplicate land here)
 *   failed    -> "Failed" with verbatim error
 *   conflict  -> "Needs review"
 *
 * The pill summary picks the most-important state currently in the queue:
 *   conflict > failed > offline > syncing > queued > synced > online
 *
 * Dev-only Force Replay button is rendered in the popover when
 * NODE_ENV !== "production". It resets the most-recent synced action back to
 * queued with the SAME clientId so the engine re-POSTs it; the backend returns
 * `duplicate` and the action flips back to synced. Demonstrates that a replay
 * produces zero additional server effect, the foundation's core guarantee.
 */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { syncEngine } from "@/lib/sync/engine";
import {
  listForDisplay,
  removeByClientId,
  resetForReplay,
} from "@/lib/sync/queue";
import { useSyncSnapshot } from "@/lib/sync/state";
import type { ActionStatus, QueuedAction } from "@/lib/sync/types";

type Tone = "navy" | "success" | "warning" | "danger" | "ink";

type Summary = {
  label: string;
  tone: Tone;
  dot: boolean;
};

function pickSummary(snapshot: ReturnType<typeof useSyncSnapshot>): Summary {
  const { connectivity, engineState, counts } = snapshot;
  if (counts.conflict > 0) {
    return { label: `${counts.conflict} needs review`, tone: "danger", dot: true };
  }
  if (counts.failed > 0) {
    return { label: `${counts.failed} failed`, tone: "danger", dot: true };
  }
  if (connectivity === "offline") {
    const waiting = counts.queued + counts.syncing;
    return {
      label: waiting > 0 ? `Offline · ${waiting} waiting` : "Offline",
      tone: "warning",
      dot: true,
    };
  }
  if (engineState === "syncing" || counts.syncing > 0) {
    return {
      label: `Syncing${counts.syncing > 0 ? ` ${counts.syncing}` : ""}`,
      tone: "navy",
      dot: true,
    };
  }
  if (counts.queued > 0) {
    return { label: `${counts.queued} queued`, tone: "warning", dot: true };
  }
  if (connectivity === "online") {
    return { label: "Online", tone: "success", dot: true };
  }
  return { label: "Connecting…", tone: "ink", dot: true };
}

const TONE_DOT: Record<Tone, string> = {
  navy: "var(--color-navy-700)",
  success: "var(--color-success-700)",
  warning: "var(--color-warning-700)",
  danger: "var(--color-danger-700)",
  ink: "var(--color-ink-500)",
};

const TONE_BG: Record<Tone, string> = {
  navy: "var(--color-navy-100)",
  success: "var(--color-success-100)",
  warning: "var(--color-warning-100)",
  danger: "var(--color-danger-100)",
  ink: "var(--color-ink-100)",
};

const TONE_TEXT: Record<Tone, string> = {
  navy: "var(--color-navy-700)",
  success: "var(--color-success-700)",
  warning: "var(--color-warning-700)",
  danger: "var(--color-danger-700)",
  ink: "var(--color-ink-700)",
};

function statusLabel(status: ActionStatus, action: QueuedAction): string {
  switch (status) {
    case "queued":
      return "Saved locally, will sync";
    case "syncing":
      return "Syncing now";
    case "synced":
      return "Synced";
    case "failed":
      return action.errorMessage
        ? `Failed: ${action.errorMessage}`
        : "Failed";
    case "conflict":
      return "Needs review";
  }
}

function statusTone(status: ActionStatus): Tone {
  switch (status) {
    case "queued":
      return "warning";
    case "syncing":
      return "navy";
    case "synced":
      return "success";
    case "failed":
      return "danger";
    case "conflict":
      return "danger";
  }
}

function shortTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function SyncStatusIndicator() {
  const snapshot = useSyncSnapshot();
  const [open, setOpen] = useState(false);
  const popRef = useRef<HTMLDivElement | null>(null);
  const isDev = process.env.NODE_ENV !== "production";

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const summary = pickSummary(snapshot);

  const onForceReplay = async () => {
    const recent = await listForDisplay(20);
    const synced = recent.find((a) => a.status === "synced");
    if (!synced) return;
    await resetForReplay(synced.clientId);
    syncEngine.notifyChange();
    await syncEngine.drain();
  };

  // Dismiss a failed action. The user has read the verbatim server message
  // on the row; "Dismiss" removes the action from the queue so the failed-
  // count stops nagging. Safe by retry: failed actions are terminal (the
  // engine does NOT re-pick them), so removal does not interrupt in-flight
  // work. For string-message assembly conflicts there is no structured
  // resolution flow (no payload to fix; the underlying state moved on),
  // so Dismiss IS the resolution.
  const onDismiss = async (clientId: string) => {
    await removeByClientId(clientId);
    syncEngine.notifyChange();
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="h-[26px] inline-flex items-center gap-1.5 px-2 rounded-[4px] text-[11.5px] font-medium border border-transparent hover:border-[var(--color-border-default)] transition-colors"
        style={{
          background: TONE_BG[summary.tone],
          color: TONE_TEXT[summary.tone],
        }}
        title="Sync status"
      >
        {summary.dot && (
          <span
            aria-hidden
            className="w-[6px] h-[6px] rounded-full"
            style={{ background: TONE_DOT[summary.tone] }}
          />
        )}
        <span>{summary.label}</span>
      </button>

      {open && (
        <div
          ref={popRef}
          // Mobile: a fixed, near-full-width panel below the topbar so it never
          // clips off-screen (the pill sits mid-right, so an absolute right-0
          // 360px popover would overflow the left edge at 375px). sm+: the
          // original popover anchored to the pill's right edge.
          className="fixed left-2 right-2 top-[48px] w-auto sm:absolute sm:left-auto sm:right-0 sm:top-[calc(100%+4px)] sm:w-[360px] bg-white border border-[var(--color-border-default)] rounded-[4px] overflow-hidden z-50"
          style={{
            boxShadow:
              "0 6px 20px rgba(15,42,68,0.11), 0 2px 5px rgba(15,42,68,0.07)",
          }}
        >
          <div className="px-3.5 py-2.5 border-b border-[var(--color-border-default)] flex items-center justify-between">
            <h4 className="m-0 text-[13px] font-semibold text-[var(--color-ink-900)]">
              Sync status
            </h4>
            <span className="text-[11px] text-[var(--color-ink-500)]">
              {snapshot.connectivity === "online"
                ? "Online"
                : snapshot.connectivity === "offline"
                  ? "Offline"
                  : "Connecting…"}
            </span>
          </div>

          <div className="px-3.5 py-2 text-[11px] text-[var(--color-ink-600)] flex gap-4 border-b border-[var(--color-border-default)]">
            <span>
              <strong className="text-[var(--color-ink-900)]">
                {snapshot.counts.queued}
              </strong>{" "}
              queued
            </span>
            <span>
              <strong className="text-[var(--color-ink-900)]">
                {snapshot.counts.syncing}
              </strong>{" "}
              syncing
            </span>
            <span>
              <strong className="text-[var(--color-ink-900)]">
                {snapshot.counts.synced}
              </strong>{" "}
              synced
            </span>
            {(snapshot.counts.failed > 0 || snapshot.counts.conflict > 0) && (
              <span style={{ color: "var(--color-danger-700)" }}>
                <strong>
                  {snapshot.counts.failed + snapshot.counts.conflict}
                </strong>{" "}
                attention
              </span>
            )}
          </div>

          {snapshot.counts.conflict > 0 && (
            <Link
              href="/sync/conflicts"
              onClick={() => setOpen(false)}
              className="block px-3.5 py-2 border-b border-[var(--color-border-default)] text-[12px] hover:bg-[var(--color-danger-50)]"
              style={{ color: "var(--color-danger-700)" }}
            >
              <span className="font-semibold">
                {snapshot.counts.conflict} need{snapshot.counts.conflict === 1 ? "s" : ""} resolution.
              </span>{" "}
              Open conflicts page &rarr;
            </Link>
          )}

          <div className="max-h-[280px] overflow-y-auto">
            {snapshot.recent.length === 0 ? (
              <div className="px-3.5 py-6 text-center text-[12px] text-[var(--color-ink-500)]">
                No sync activity yet.
              </div>
            ) : (
              <ul className="py-1">
                {snapshot.recent.map((a) => {
                  const tone = statusTone(a.status);
                  return (
                    <li
                      key={a.clientId}
                      className="px-3.5 py-2 flex items-start gap-2.5 hover:bg-[var(--color-ink-100)]"
                    >
                      <span
                        aria-hidden
                        className="mt-[6px] w-[6px] h-[6px] rounded-full flex-shrink-0"
                        style={{ background: TONE_DOT[tone] }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-[12px] text-[var(--color-ink-900)] truncate">
                          {a.description}
                        </div>
                        <div className="text-[11px] text-[var(--color-ink-500)] truncate">
                          {statusLabel(a.status, a)}
                        </div>
                      </div>
                      <span className="text-[11px] text-[var(--color-ink-500)] flex-shrink-0">
                        {shortTime(a.createdAt)}
                      </span>
                      {a.status === "failed" && (
                        <button
                          type="button"
                          onClick={() => onDismiss(a.clientId)}
                          aria-label="Dismiss failed action"
                          title="Dismiss this failed action"
                          className="flex-shrink-0 w-[18px] h-[18px] inline-flex items-center justify-center rounded-[3px] text-[12px] leading-none text-[var(--color-ink-500)] hover:bg-[var(--color-danger-100)] hover:text-[var(--color-danger-700)]"
                        >
                          &times;
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {isDev && (
            <div className="px-3.5 py-2 border-t border-[var(--color-border-default)] bg-[var(--color-ink-100)]">
              <button
                type="button"
                onClick={onForceReplay}
                disabled={snapshot.recent.every((a) => a.status !== "synced")}
                className="w-full h-[26px] inline-flex items-center justify-center gap-1.5 px-2 rounded-[3px] text-[11.5px] font-medium bg-white border border-[var(--color-border-default)] text-[var(--color-ink-700)] hover:border-[var(--color-navy-700)] hover:text-[var(--color-navy-700)] disabled:opacity-50 disabled:cursor-not-allowed"
                title="Reset the most-recent synced action to queued so the engine re-POSTs it with the same clientId. The backend reports duplicate and produces no additional server effect."
              >
                Force replay last synced (dev)
              </button>
              <div className="mt-1.5 text-[10.5px] text-[var(--color-ink-500)] leading-[1.4]">
                Re-POSTs the same clientId. Backend returns duplicate; server
                state unchanged. Visible only in dev.
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
