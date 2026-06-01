"use client";

/**
 * Customer detail with the foundation's proof affordance: an inline "Edit phone"
 * action that queues an entity.update sync action. The phone display re-reads
 * from the server when the engine notifies of a sync, so an offline edit that
 * later syncs becomes visible without a manual refresh.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import FreshnessBadge from "@/components/sync/FreshnessBadge";
import OfflineNotice from "@/components/sync/OfflineNotice";
import { getCustomer, type Customer } from "@/lib/api";
import { syncEngine } from "@/lib/sync/engine";
import { queueEntityUpdate } from "@/lib/sync/actions/entity-update";
import { getById } from "@/lib/sync/mirror/store";
import { useUrlLastSegment } from "@/lib/sync/use-url-segment";

export default function CustomerDetailPage() {
  const router = useRouter();
  // Read from window.location to handle the SW's sibling-URL fallback;
  // see src/lib/sync/use-url-segment.ts.
  const id = useUrlLastSegment();

  const [customer, setCustomer] = useState<Customer | null>(null);
  // errMsg is for real, surfaceable errors only (forbidden, not_found,
  // genuine validation failures). It renders in a danger banner.
  const [errMsg, setErrMsg] = useState<string>("");
  // offline is for "we tried to fetch and the backend wasn't reachable AND
  // we have no cached data yet to show." It renders in a calm gray notice,
  // never a danger banner: an offline fetch is an EXPECTED condition in an
  // offline-capable app, not an error to alarm about.
  const [offline, setOffline] = useState(false);
  // When true, the customer rendered came from the mirror. Drives the
  // FreshnessBadge so the clerk knows it's cached, not live.
  const [fromMirror, setFromMirror] = useState(false);

  const [editing, setEditing] = useState(false);
  const [phoneDraft, setPhoneDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [lastQueuedAt, setLastQueuedAt] = useState<string>("");

  // Mirror-painted tracker, separate from network state. Lets the network
  // transient branch know whether to surface offline (mirror empty) or stay
  // quiet (mirror painted, the cached render is the answer).
  const mirrorPaintedRef = useRef(false);

  // Read from the mirror; paint if found.
  const loadFromMirror = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const mirrored = await getById<Customer>("customer", id);
        if (signal?.aborted) return;
        if (mirrored) {
          mirrorPaintedRef.current = true;
          setCustomer(mirrored.body);
          setFromMirror(true);
          setOffline(false);
        }
      } catch {
        // Let network drive.
      }
    },
    [id],
  );

  // Read from the network; replace painted customer with fresh on ok.
  const loadFromNetwork = useCallback(
    (signal?: AbortSignal) => {
      getCustomer(id, signal).then((r) => {
        if (signal?.aborted) return;
        if (r.kind === "ok") {
          setCustomer(r.data);
          setErrMsg("");
          setOffline(false);
          setFromMirror(false);
        } else if (r.kind === "unauthorized") {
          router.replace("/login");
        } else if (r.kind === "forbidden") {
          setErrMsg("You do not have access to view this customer.");
        } else if (r.kind === "not_found") {
          setErrMsg("Customer not found.");
        } else if (r.kind === "network_error" || r.kind === "server_error") {
          if (!mirrorPaintedRef.current) setOffline(true);
        } else if ("message" in r) {
          setErrMsg(
            typeof r.message === "string" ? r.message : r.message.join("; "),
          );
        }
      });
    },
    [id, router],
  );

  useEffect(() => {
    const ctrl = new AbortController();
    mirrorPaintedRef.current = false;
    void loadFromMirror(ctrl.signal);
    loadFromNetwork(ctrl.signal);
    return () => ctrl.abort();
  }, [loadFromMirror, loadFromNetwork]);

  // Re-read from network whenever the engine signals a change (a drain
  // landed). Cheap and correct: if the sync caused a server-side phone
  // change, the re-read picks it up.
  useEffect(() => {
    return syncEngine.subscribe(() => {
      loadFromNetwork();
    });
  }, [loadFromNetwork]);

  const onSavePhone = async () => {
    if (!customer) return;
    setSubmitting(true);
    try {
      const action = await queueEntityUpdate({
        entityType: "customer",
        entityId: customer.id,
        changes: [
          {
            path: "phone",
            oldValue: customer.phone,
            newValue: phoneDraft || null,
          },
        ],
        description: `Update phone, ${customer.name}`,
      });
      setLastQueuedAt(action.createdAt);
      setEditing(false);
    } finally {
      setSubmitting(false);
    }
  };

  if (errMsg) {
    return (
      <div className="max-w-[820px] mx-auto pb-10">
        <div className="mb-4 px-3.5 py-2.5 rounded-[3px] bg-[var(--color-danger-100)] text-[var(--color-danger-700)] text-[12.5px]">
          {errMsg}
        </div>
        <Link
          href="/sales/customers"
          className="text-[12px] text-[var(--color-navy-700)] hover:underline"
        >
          Back to customers
        </Link>
      </div>
    );
  }

  if (!customer && offline) {
    return (
      <div className="max-w-[820px] mx-auto pb-10">
        <OfflineNotice body="This customer's details will load once you're back online. Phone edits queued while offline are saved locally and sync automatically when the connection returns." />
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="max-w-[820px] mx-auto pb-10 text-[12px] text-[var(--color-ink-500)]">
        Loading…
      </div>
    );
  }

  return (
    <div className="max-w-[820px] mx-auto pb-10">
      <header className="flex items-end justify-between gap-6 pb-4 mb-4 border-b border-[var(--color-border-default)]">
        <div>
          <div className="text-[12px] text-[var(--color-ink-500)] flex items-center gap-1.5 mb-1.5">
            <Link
              href="/sales/customers"
              className="text-[var(--color-navy-700)] hover:underline"
            >
              Sales / Customers
            </Link>
            <span className="text-[var(--color-ink-300)]">/</span>
            <span className="text-[var(--color-ink-900)] font-medium">
              {customer.name}
            </span>
          </div>
          <h1 className="text-[22px] font-semibold text-[var(--color-ink-900)] m-0 tracking-[-0.01em] flex items-center gap-3">
            {customer.name}
            {fromMirror && <FreshnessBadge />}
          </h1>
        </div>
      </header>

      <section className="bg-white border border-[var(--color-border-default)] rounded-[4px] overflow-hidden">
        <div className="px-3.5 py-2.5 border-b border-[var(--color-border-default)] flex items-center justify-between">
          <h2 className="m-0 text-[14px] font-semibold text-[var(--color-ink-900)]">
            Contact
          </h2>
          {lastQueuedAt && (
            <span className="text-[11px] text-[var(--color-ink-500)]">
              Last queued at{" "}
              {new Date(lastQueuedAt).toLocaleTimeString(undefined, {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </span>
          )}
        </div>

        <dl className="text-[12.5px] divide-y divide-[var(--color-border-default)]">
          <div className="px-3.5 py-2.5 grid grid-cols-[140px_1fr_auto] gap-3 items-center">
            <dt className="text-[var(--color-ink-600)] text-[13px]">Phone</dt>
            <dd className="m-0 text-[var(--color-ink-900)] font-mono">
              {editing ? (
                <input
                  type="tel"
                  value={phoneDraft}
                  onChange={(e) => setPhoneDraft(e.target.value)}
                  placeholder="e.g. +234-800-..."
                  autoFocus
                  className="h-[28px] w-full px-2 rounded-[3px] border border-[var(--color-navy-700)] bg-white text-[12.5px] font-mono text-[var(--color-ink-900)] focus:outline-none focus:shadow-[0_0_0_3px_rgba(31,78,121,0.10)]"
                />
              ) : (
                <span>{customer.phone ?? "--"}</span>
              )}
            </dd>
            <dd className="m-0">
              {editing ? (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={onSavePhone}
                    disabled={submitting}
                    className="h-[28px] px-3 rounded-[3px] bg-[var(--color-navy-700)] text-white text-[12px] font-medium hover:bg-[var(--color-navy-600)] disabled:opacity-50"
                  >
                    {submitting ? "Queueing…" : "Save"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(false);
                      setPhoneDraft("");
                    }}
                    disabled={submitting}
                    className="h-[28px] px-3 rounded-[3px] bg-white border border-[var(--color-border-default)] text-[var(--color-ink-700)] text-[12px] font-medium hover:border-[var(--color-navy-700)] hover:text-[var(--color-navy-700)] disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setPhoneDraft(customer.phone ?? "");
                    setEditing(true);
                  }}
                  className="h-[28px] px-3 rounded-[3px] bg-white border border-[var(--color-border-default)] text-[var(--color-ink-700)] text-[12px] font-medium hover:border-[var(--color-navy-700)] hover:text-[var(--color-navy-700)]"
                >
                  Edit phone
                </button>
              )}
            </dd>
          </div>

          <div className="px-3.5 py-2.5 grid grid-cols-[140px_1fr] gap-3 items-center">
            <dt className="text-[var(--color-ink-600)] text-[13px]">Email</dt>
            <dd className="m-0 text-[var(--color-ink-900)]">
              {customer.email ?? "--"}
            </dd>
          </div>

          <div className="px-3.5 py-2.5 grid grid-cols-[140px_1fr] gap-3 items-center">
            <dt className="text-[var(--color-ink-600)] text-[13px]">Type</dt>
            <dd className="m-0 text-[var(--color-ink-700)]">
              {customer.type === "RESELLER" ? "Reseller" : "End user"}
            </dd>
          </div>

          <div className="px-3.5 py-2.5 grid grid-cols-[140px_1fr] gap-3 items-center">
            <dt className="text-[var(--color-ink-600)] text-[13px]">Tier</dt>
            <dd className="m-0 text-[var(--color-ink-700)]">
              {customer.tier?.name ?? "--"}
            </dd>
          </div>

          <div className="px-3.5 py-2.5 grid grid-cols-[140px_1fr] gap-3 items-center">
            <dt className="text-[var(--color-ink-600)] text-[13px]">Status</dt>
            <dd className="m-0 text-[var(--color-ink-700)]">
              {customer.status === "ACTIVE" ? "Active" : "Inactive"}
            </dd>
          </div>

          <div className="px-3.5 py-2.5 grid grid-cols-[140px_1fr] gap-3 items-center">
            <dt className="text-[var(--color-ink-600)] text-[13px]">
              Customer ID
            </dt>
            <dd className="m-0 text-[var(--color-ink-700)] font-mono text-[12px]">
              {customer.id}
            </dd>
          </div>
        </dl>
      </section>

      <p className="mt-3 text-[11.5px] text-[var(--color-ink-500)] leading-[1.5]">
        Editing phone queues a sync action. When the backend is reachable, the
        engine drains it and the server reflects the change. When offline, the
        action sits queued in IndexedDB and the sync indicator shows{" "}
        <em>Saved locally, will sync</em>. The clientId stored on the queued
        action is the same id used on retry, which guarantees the backend
        reports duplicate on replay and never double-applies.
      </p>
    </div>
  );
}
