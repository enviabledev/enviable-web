"use client";

/**
 * Single-conflict detail view. Looks up the registered plugin for the
 * action's type and delegates the structured display to its DetailRenderer.
 * The "Re-open and fix" button calls the plugin's ReOpener, which navigates
 * the clerk into the flow's form to re-submit with the SAME clientId
 * (safe-by-retry: conflicts are not recorded by idempotency, the corrected
 * work re-runs cleanly).
 */
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { getConflictPlugin } from "@/lib/sync/conflicts-registry";
import { getByClientId, removeByClientId } from "@/lib/sync/queue";
import { syncEngine } from "@/lib/sync/engine";
import type { QueuedAction } from "@/lib/sync/types";

export default function ConflictDetailPage() {
  const router = useRouter();
  const params = useParams<{ clientId: string }>();
  const clientId = decodeURIComponent(params.clientId);

  const [action, setAction] = useState<QueuedAction | null | undefined>(undefined);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const a = await getByClientId(clientId);
      if (!active) return;
      setAction(a ?? null);
    };
    void load();
    const unsub = syncEngine.subscribe(() => {
      void load();
    });
    return () => {
      active = false;
      unsub();
    };
  }, [clientId]);

  if (action === undefined) {
    return (
      <div className="max-w-[1080px] mx-auto pb-10 py-10 text-center text-[12px] text-[var(--color-ink-500)]">
        Loading conflict...
      </div>
    );
  }
  if (action === null) {
    return (
      <div className="max-w-[1080px] mx-auto pb-10">
        <div className="px-3.5 py-2.5 rounded-[3px] bg-[var(--color-ink-100)] text-[12.5px] text-[var(--color-ink-700)] mb-4">
          This conflict has been resolved or dismissed.
        </div>
        <Link
          href="/sync/conflicts"
          className="text-[12px] text-[var(--color-navy-700)] hover:underline"
        >
          Back to conflicts
        </Link>
      </div>
    );
  }

  // Action no longer in conflict state (e.g. it drained successfully on a
  // background re-run, or was reset). Tell the clerk and route back; the
  // engine's notifyChange will pick this up automatically on subsequent
  // visits because of the subscribe + load.
  if (action.status !== "conflict") {
    return (
      <div className="max-w-[1080px] mx-auto pb-10">
        <div className="px-3.5 py-2.5 rounded-[3px] bg-[var(--color-success-100)] text-[var(--color-success-700)] text-[12.5px] mb-4">
          This action is no longer in conflict (current status:{" "}
          <span className="font-mono font-semibold">{action.status}</span>).
        </div>
        <Link
          href="/sync/conflicts"
          className="text-[12px] text-[var(--color-navy-700)] hover:underline"
        >
          Back to conflicts
        </Link>
      </div>
    );
  }

  const plugin = getConflictPlugin(action.type);
  const onReOpen = () => {
    if (!plugin) return;
    plugin.ReOpener(action, (href) => router.push(href));
  };
  const onDismiss = async () => {
    if (
      !confirm(
        "Dismiss this conflict and discard the offline submission? The action is removed from the queue and the work it represents is not done.",
      )
    ) {
      return;
    }
    await removeByClientId(action.clientId);
    syncEngine.notifyChange();
    router.replace("/sync/conflicts");
  };

  return (
    <div className="max-w-[1080px] mx-auto pb-10">
      <header className="flex items-end justify-between gap-6 pb-4 mb-5 border-b border-[var(--color-border-default)]">
        <div>
          <div className="text-[12px] text-[var(--color-ink-500)] flex items-center gap-1.5 mb-1.5 flex-wrap">
            <Link
              href="/sync/conflicts"
              className="text-[var(--color-ink-500)] hover:text-[var(--color-navy-700)]"
            >
              Sync / Conflicts
            </Link>
            <span className="text-[var(--color-ink-300)]">/</span>
            <span className="text-[var(--color-ink-900)] font-medium">
              {plugin?.rowLabel ?? action.type}
            </span>
          </div>
          <h1 className="text-[22px] font-semibold text-[var(--color-ink-900)] m-0 tracking-[-0.01em]">
            {action.description}
          </h1>
          <div className="text-[12px] text-[var(--color-ink-500)] mt-1 font-mono">
            clientId: {action.clientId}
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onDismiss}
            className="h-8 px-3 rounded-[3px] text-[12.5px] font-medium border border-[var(--color-border-strong)] bg-white text-[var(--color-ink-700)] hover:bg-[var(--color-ink-100)]"
          >
            Dismiss
          </button>
          <button
            type="button"
            onClick={onReOpen}
            disabled={!plugin}
            className="h-8 px-4 rounded-[3px] text-[12.5px] font-medium text-white disabled:opacity-50"
            style={{ background: "var(--color-navy-700)" }}
          >
            Re-open and fix
          </button>
        </div>
      </header>

      {plugin ? (
        <plugin.DetailRenderer action={action} />
      ) : (
        <div className="bg-white border border-[var(--color-border-default)] rounded-[4px] px-4 py-4">
          <div className="text-[13px] font-semibold text-[var(--color-ink-900)] mb-1">
            No renderer registered for this action type.
          </div>
          <div className="text-[12px] text-[var(--color-ink-700)] mb-3">
            Action type: <span className="font-mono">{action.type}</span>
          </div>
          <pre className="bg-[var(--color-ink-100)] border border-[var(--color-border-default)] rounded-[3px] px-3 py-2 text-[11px] overflow-auto font-mono">
            {JSON.stringify(action.conflictBody, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
