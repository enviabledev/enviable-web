"use client";

/**
 * /sync/conflicts: the discoverable home for offline actions that synced
 * back with a clerk-resolvable conflict (e.g. an offline receipt rejected
 * because a serial duplicates one already in the DB). Persistent route so
 * the conflict outlives the indicator popover the clerk may never open.
 *
 * Flow-agnostic. Each row shows the type + description + when. Click routes
 * to the detail page, which looks up the registered plugin for the action's
 * type and renders the DetailRenderer + ReOpener.
 *
 * Field-merge conflicts (entity.update with `kind: "field-review"`) are NOT
 * shown here; they route to the supervisor review queue (a separate surface,
 * not in this prompt). This page is only for clerk-resolvable conflicts.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { getConflictPlugin } from "@/lib/sync/conflicts-registry";
import { syncEngine } from "@/lib/sync/engine";
import { listByStatus } from "@/lib/sync/queue";
import type { QueuedAction } from "@/lib/sync/types";

function isClerkResolvable(a: QueuedAction): boolean {
  const body = a.conflictBody as { kind?: string } | undefined;
  return body?.kind === "constraint-violations";
}

function shortTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ConflictsListPage() {
  const router = useRouter();
  const [conflicts, setConflicts] = useState<QueuedAction[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const all = await listByStatus("conflict");
      if (!active) return;
      const clerkResolvable = all.filter(isClerkResolvable);
      clerkResolvable.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      setConflicts(clerkResolvable);
      setLoaded(true);
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

  return (
    <div className="max-w-[1080px] mx-auto pb-10">
      <header className="flex items-end justify-between gap-6 pb-4 mb-5 border-b border-[var(--color-border-default)]">
        <div>
          <div className="text-[12px] text-[var(--color-ink-500)] flex items-center gap-1.5 mb-1.5">
            <span>Sync</span>
            <span className="text-[var(--color-ink-300)]">/</span>
            <span className="text-[var(--color-ink-900)] font-medium">Conflicts</span>
          </div>
          <h1 className="text-[22px] font-semibold text-[var(--color-ink-900)] m-0 tracking-[-0.01em] flex items-center gap-3">
            Sync Conflicts
            {loaded && (
              <span
                className="font-mono text-[12px] px-2.5 py-1 rounded-[3px] font-semibold"
                style={{
                  background:
                    conflicts.length > 0
                      ? "var(--color-danger-100)"
                      : "var(--color-ink-100)",
                  color:
                    conflicts.length > 0
                      ? "var(--color-danger-700)"
                      : "var(--color-ink-700)",
                }}
              >
                {conflicts.length}
              </span>
            )}
          </h1>
          <p className="text-[12.5px] text-[var(--color-ink-500)] mt-1 max-w-[760px]">
            Offline actions that synced back with a conflict you need to resolve.
            Re-open each conflict, fix the offending inputs against current state,
            and re-submit. The same client id is re-used so the corrected work is
            applied exactly once.
          </p>
        </div>
      </header>

      {!loaded ? (
        <div className="text-[12px] text-[var(--color-ink-500)] py-10 text-center">
          Loading...
        </div>
      ) : conflicts.length === 0 ? (
        <div className="bg-white border border-[var(--color-border-default)] rounded-[4px] px-4 py-8 text-center">
          <div className="text-[13px] font-semibold text-[var(--color-ink-900)] mb-1">
            No conflicts.
          </div>
          <div className="text-[12px] text-[var(--color-ink-500)]">
            Offline work that needs your attention will appear here.
          </div>
        </div>
      ) : (
        <div className="bg-white border border-[var(--color-border-default)] rounded-[4px] overflow-hidden">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-[var(--color-ink-100)] text-[10.5px] uppercase text-[var(--color-ink-600)] tracking-[0.04em]">
                <th className="text-left font-semibold px-3 py-2 border-b border-[var(--color-border-default)]">
                  Action
                </th>
                <th className="text-left font-semibold px-3 py-2 border-b border-[var(--color-border-default)]">
                  Description
                </th>
                <th className="text-left font-semibold px-3 py-2 border-b border-[var(--color-border-default)]">
                  Conflicted
                </th>
                <th className="text-right font-semibold px-3 py-2 border-b border-[var(--color-border-default)]">
                  &nbsp;
                </th>
              </tr>
            </thead>
            <tbody>
              {conflicts.map((c) => {
                const plugin = getConflictPlugin(c.type);
                const label = plugin?.rowLabel ?? c.type;
                return (
                  <tr
                    key={c.clientId}
                    className="text-[12.5px] hover:bg-[var(--color-ink-100)]"
                    onClick={() =>
                      router.push(`/sync/conflicts/${encodeURIComponent(c.clientId)}`)
                    }
                    style={{ cursor: "pointer" }}
                  >
                    <td className="px-3 h-[36px] border-b border-[var(--color-border-default)] text-[var(--color-ink-900)] font-medium">
                      {label}
                    </td>
                    <td className="px-3 h-[36px] border-b border-[var(--color-border-default)] text-[var(--color-ink-700)]">
                      {c.description}
                    </td>
                    <td className="px-3 h-[36px] border-b border-[var(--color-border-default)] text-[var(--color-ink-700)] font-mono text-[12px]">
                      {shortTime(c.createdAt)}
                    </td>
                    <td className="px-3 h-[36px] border-b border-[var(--color-border-default)] text-right">
                      <Link
                        href={`/sync/conflicts/${encodeURIComponent(c.clientId)}`}
                        className="text-[var(--color-navy-700)] hover:underline text-[12px] font-medium"
                        onClick={(e) => e.stopPropagation()}
                      >
                        Resolve &rarr;
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
