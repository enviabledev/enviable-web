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
import {
  deleteCustomer,
  getCustomer,
  updateCustomer,
  type Customer,
  type CustomerType,
} from "@/lib/api";
import { usePermissions } from "@/lib/auth";
import { useConnectivity } from "@/lib/sync/connectivity";
import { syncEngine } from "@/lib/sync/engine";
import { queueEntityUpdate } from "@/lib/sync/actions/entity-update";
import { getById, listByType } from "@/lib/sync/mirror/store";
import { useUrlLastSegment } from "@/lib/sync/use-url-segment";

type TierOption = { id: string; name: string };
type MirrorCustomerTier = {
  id: string;
  name: string;
  status: string;
  deletedAt?: string | null;
};

type EditDraft = {
  name: string;
  type: CustomerType;
  tierId: string;
  phone: string;
  email: string;
  taxId: string;
};

// Management state machine for the inline edit / confirmation panels
// (matching the counterparties detail). All transitions are online-only.
type ManageState =
  | { status: "idle" }
  | { status: "editing"; draft: EditDraft }
  | { status: "submitting"; draft: EditDraft }
  | { status: "confirmingDeactivate" }
  | { status: "confirmingReactivate" }
  | { status: "confirmingDelete" }
  | { status: "working" }
  | { status: "error"; message: string }
  | { status: "deleteError"; message: string };

export default function CustomerDetailPage() {
  const router = useRouter();
  const { has } = usePermissions();
  const canManage = has("customer.manage");
  const { state: connState } = useConnectivity();
  const offlineConn = connState === "offline";
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

  // Management affordances (prompt 33-A): edit / deactivate / reactivate /
  // delete. All online-only (writes go straight to the backend, not the
  // offline-capable phone queue). Tier options come from the mirror
  // customerTier bucket; only resellers carry a tier.
  const [manage, setManage] = useState<ManageState>({ status: "idle" });
  const [tierOptions, setTierOptions] = useState<TierOption[]>([]);

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
    // Skip the first render's empty-id pass; useUrlLastSegment starts as ""
    // until its mount-time effect reads window.location.pathname. Without
    // this, the network call hits /api/customers/ (the LIST route), the
    // response gets typed-cast as a detail, and the render crashes when
    // it reads fields off what is actually an array.
    if (!id) return;
    const ctrl = new AbortController();
    mirrorPaintedRef.current = false;
    void loadFromMirror(ctrl.signal);
    loadFromNetwork(ctrl.signal);
    return () => ctrl.abort();
  }, [id, loadFromMirror, loadFromNetwork]);

  // Tier options for the edit form, from the mirror customerTier bucket
  // (active, non-deleted). Loaded once management is permitted.
  useEffect(() => {
    if (!canManage) return;
    let cancelled = false;
    (async () => {
      try {
        const rows = await listByType<MirrorCustomerTier>("customerTier");
        if (cancelled) return;
        const opts = rows
          .map((r) => r.body)
          .filter((t) => t.deletedAt == null && t.status === "ACTIVE")
          .map<TierOption>((t) => ({ id: t.id, name: t.name }))
          .sort((a, b) => a.name.localeCompare(b.name));
        setTierOptions(opts);
      } catch {
        // Mirror unavailable; the select renders empty and tier stays optional.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canManage]);

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

  const beginEdit = () => {
    if (!customer) return;
    setManage({
      status: "editing",
      draft: {
        name: customer.name,
        type: customer.type,
        tierId: customer.tierId ?? "",
        phone: customer.phone ?? "",
        email: customer.email ?? "",
        taxId: customer.taxId ?? "",
      },
    });
  };

  const saveEdit = async () => {
    if (manage.status !== "editing" || !customer) return;
    const draft = manage.draft;
    setManage({ status: "submitting", draft });
    const r = await updateCustomer(customer.id, {
      name: draft.name.trim(),
      type: draft.type,
      // Only resellers carry a tier; end users always send null.
      tierId: draft.type === "RESELLER" && draft.tierId ? draft.tierId : null,
      phone: draft.phone.trim() || null,
      email: draft.email.trim() || null,
      taxId: draft.taxId.trim() || null,
    });
    if (r.kind === "ok") {
      // The PATCH response is the fresh, authoritative customer. Apply it
      // directly: a mirror-first re-read would repaint the stale pre-edit row
      // (the mirror only refreshes on the next sync pull).
      setCustomer(r.data);
      setManage({ status: "idle" });
    } else if (r.kind === "forbidden") {
      setManage({ status: "error", message: "You do not have permission to edit customers." });
    } else if (r.kind === "validation") {
      setManage({
        status: "error",
        message: typeof r.message === "string" ? r.message : r.message.join("; "),
      });
    } else if (r.kind === "network_error") {
      setManage({ status: "error", message: "Network error. Edits require a live connection." });
    } else {
      setManage({ status: "error", message: "Unexpected response from the server." });
    }
  };

  const setStatus = async (status: "ACTIVE" | "INACTIVE") => {
    if (!customer) return;
    setManage({ status: "working" });
    const r = await updateCustomer(customer.id, { status });
    if (r.kind === "ok") {
      setCustomer(r.data);
      setManage({ status: "idle" });
    } else if (r.kind === "forbidden") {
      setManage({ status: "error", message: "You do not have permission to change this customer." });
    } else if (r.kind === "network_error") {
      setManage({
        status: "error",
        message: "Network error. Status changes require a live connection.",
      });
    } else if (r.kind === "validation") {
      setManage({
        status: "error",
        message: typeof r.message === "string" ? r.message : r.message.join("; "),
      });
    } else {
      setManage({ status: "error", message: "Unexpected response from the server." });
    }
  };

  const doDelete = async () => {
    if (!customer) return;
    setManage({ status: "working" });
    const r = await deleteCustomer(customer.id);
    if (r.kind === "ok") {
      router.replace("/sales/customers");
    } else if (r.kind === "conflict") {
      // Active sales orders block deletion. Surface the backend's exact
      // message honestly and steer the user toward Deactivate.
      setManage({ status: "deleteError", message: r.message });
    } else if (r.kind === "forbidden") {
      setManage({ status: "error", message: "You do not have permission to delete customers." });
    } else if (r.kind === "not_found") {
      setManage({
        status: "error",
        message: "Customer no longer exists (may have been deleted by another user).",
      });
    } else if (r.kind === "network_error") {
      setManage({ status: "error", message: "Network error. Deletion requires a live connection." });
    } else {
      setManage({ status: "error", message: "Unexpected response from the server." });
    }
  };

  const manageBusy = manage.status === "submitting" || manage.status === "working";

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
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 sm:gap-6 pb-4 mb-4 border-b border-[var(--color-border-default)]">
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
        {canManage && manage.status === "idle" && (
          <div className="flex flex-wrap gap-2 w-full sm:w-auto">
            <button
              type="button"
              onClick={beginEdit}
              disabled={offlineConn}
              data-testid="edit-button"
              className="h-[32px] px-3 rounded-[3px] border border-[var(--color-border-strong)] bg-white text-[var(--color-ink-900)] text-[12.5px] font-medium disabled:opacity-50"
            >
              Edit
            </button>
            {customer.status === "ACTIVE" ? (
              <button
                type="button"
                onClick={() => setManage({ status: "confirmingDeactivate" })}
                disabled={offlineConn}
                data-testid="deactivate-button"
                className="h-[32px] px-3 rounded-[3px] border border-[var(--color-warning-700)] bg-white text-[var(--color-warning-700)] text-[12.5px] font-medium disabled:opacity-50"
              >
                Deactivate
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setManage({ status: "confirmingReactivate" })}
                disabled={offlineConn}
                data-testid="reactivate-button"
                className="h-[32px] px-3 rounded-[3px] border border-[var(--color-success-700)] bg-white text-[var(--color-success-700)] text-[12.5px] font-medium disabled:opacity-50"
              >
                Reactivate
              </button>
            )}
            <button
              type="button"
              onClick={() => setManage({ status: "confirmingDelete" })}
              disabled={offlineConn}
              data-testid="delete-button"
              className="h-[32px] px-3 rounded-[3px] border border-[var(--color-danger-700)] bg-white text-[var(--color-danger-700)] text-[12.5px] font-medium disabled:opacity-50"
            >
              Delete
            </button>
          </div>
        )}
      </header>

      {canManage && offlineConn && (
        <div className="mb-4 px-3.5 py-2.5 rounded-[3px] bg-[var(--color-warning-100)] text-[var(--color-warning-700)] text-[12.5px]">
          Editing, deactivating, and deleting a customer require a live connection. Reconnect to manage this customer.
        </div>
      )}

      {canManage && manage.status === "error" && (
        <div
          role="alert"
          className="mb-4 px-3.5 py-2.5 rounded-[3px] bg-[var(--color-danger-50)] border border-[var(--color-danger-100)] text-[12.5px] text-[var(--color-danger-700)]"
        >
          {manage.message}
          <button
            type="button"
            onClick={() => setManage({ status: "idle" })}
            className="ml-3 underline hover:opacity-70"
          >
            Dismiss
          </button>
        </div>
      )}

      {canManage && manage.status === "confirmingDeactivate" && (
        <div
          role="dialog"
          className="mb-4 px-4 py-3 rounded-[4px] border-2 border-[var(--color-warning-700)] bg-[var(--color-warning-100)]"
        >
          <div className="text-[13px] font-semibold text-[var(--color-warning-700)] mb-1">
            Deactivate this customer?
          </div>
          <div className="text-[12.5px] text-[var(--color-ink-900)] mb-3">
            This customer will not be available for new sales orders. Their historical sales orders and audit log entries remain attributable.
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setStatus("INACTIVE")}
              disabled={manageBusy}
              data-testid="deactivate-confirm"
              className="h-[32px] px-4 rounded-[3px] bg-[var(--color-warning-700)] text-white text-[12.5px] font-medium disabled:opacity-50"
            >
              {manageBusy ? "Working..." : "Confirm deactivate"}
            </button>
            <button
              type="button"
              onClick={() => setManage({ status: "idle" })}
              disabled={manageBusy}
              className="h-[32px] px-3 rounded-[3px] border border-[var(--color-border-strong)] bg-white text-[var(--color-ink-900)] text-[12.5px] font-medium hover:bg-[var(--color-ink-100)] disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {canManage && manage.status === "confirmingReactivate" && (
        <div
          role="dialog"
          className="mb-4 px-4 py-3 rounded-[4px] border-2 border-[var(--color-success-700)] bg-[var(--color-success-100)]"
        >
          <div className="text-[13px] font-semibold text-[var(--color-success-700)] mb-1">
            Reactivate this customer?
          </div>
          <div className="text-[12.5px] text-[var(--color-ink-900)] mb-3">
            This customer will become available again for new sales orders.
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setStatus("ACTIVE")}
              disabled={manageBusy}
              data-testid="reactivate-confirm"
              className="h-[32px] px-4 rounded-[3px] bg-[var(--color-success-700)] text-white text-[12.5px] font-medium disabled:opacity-50"
            >
              {manageBusy ? "Working..." : "Confirm reactivate"}
            </button>
            <button
              type="button"
              onClick={() => setManage({ status: "idle" })}
              disabled={manageBusy}
              className="h-[32px] px-3 rounded-[3px] border border-[var(--color-border-strong)] bg-white text-[var(--color-ink-900)] text-[12.5px] font-medium hover:bg-[var(--color-ink-100)] disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {canManage && (manage.status === "confirmingDelete" || manage.status === "deleteError") && (
        <div
          role="dialog"
          className="mb-4 px-4 py-3 rounded-[4px] border-2 border-[var(--color-danger-700)] bg-[var(--color-danger-50)]"
        >
          <div className="text-[13px] font-semibold text-[var(--color-danger-700)] mb-1">
            Delete this customer?
          </div>
          <div className="text-[12.5px] text-[var(--color-ink-900)] mb-3">
            Deletion is irreversible from this UI. If this customer has active sales orders, the deletion will be rejected; you can deactivate instead.
          </div>
          {manage.status === "deleteError" && (
            <div
              role="alert"
              data-testid="delete-error"
              className="mb-3 px-3 py-2 rounded-[3px] bg-[var(--color-danger-100)] text-[var(--color-danger-700)] text-[12.5px]"
            >
              {manage.message}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={doDelete}
              disabled={manageBusy}
              data-testid="delete-confirm"
              className="h-[32px] px-4 rounded-[3px] bg-[var(--color-danger-700)] text-white text-[12.5px] font-medium disabled:opacity-50"
            >
              {manageBusy ? "Deleting..." : "Confirm delete"}
            </button>
            {manage.status === "deleteError" && customer.status === "ACTIVE" && (
              <button
                type="button"
                onClick={() => setManage({ status: "confirmingDeactivate" })}
                disabled={manageBusy}
                className="h-[32px] px-3 rounded-[3px] border border-[var(--color-warning-700)] bg-white text-[var(--color-warning-700)] text-[12.5px] font-medium disabled:opacity-50"
              >
                Deactivate instead
              </button>
            )}
            <button
              type="button"
              onClick={() => setManage({ status: "idle" })}
              disabled={manageBusy}
              className="h-[32px] px-3 rounded-[3px] border border-[var(--color-border-strong)] bg-white text-[var(--color-ink-900)] text-[12.5px] font-medium hover:bg-[var(--color-ink-100)] disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {canManage && (manage.status === "editing" || manage.status === "submitting") && (
        <section className="bg-white border border-[var(--color-border-default)] rounded-[4px] mb-4 px-4 sm:px-5 py-4">
          <h2 className="m-0 text-[13px] font-semibold text-[var(--color-ink-900)] mb-3">Edit customer</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] font-medium">Name</span>
              <input
                type="text"
                value={manage.draft.name}
                onChange={(e) =>
                  manage.status === "editing" &&
                  setManage({ status: "editing", draft: { ...manage.draft, name: e.target.value } })
                }
                disabled={manageBusy}
                data-testid="edit-name"
                className="h-[32px] w-full px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[13px]"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] font-medium">Type</span>
              <select
                value={manage.draft.type}
                onChange={(e) => {
                  if (manage.status !== "editing") return;
                  const next = e.target.value as CustomerType;
                  setManage({
                    status: "editing",
                    draft: {
                      ...manage.draft,
                      type: next,
                      tierId: next === "END_USER" ? "" : manage.draft.tierId,
                    },
                  });
                }}
                disabled={manageBusy}
                data-testid="edit-type"
                className="h-[32px] w-full px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[13px]"
              >
                <option value="RESELLER">Reseller</option>
                <option value="END_USER">End user</option>
              </select>
            </label>
            {manage.draft.type === "RESELLER" && (
              <label className="flex flex-col gap-1">
                <span className="text-[11px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] font-medium">Tier</span>
                <select
                  value={manage.draft.tierId}
                  onChange={(e) =>
                    manage.status === "editing" &&
                    setManage({ status: "editing", draft: { ...manage.draft, tierId: e.target.value } })
                  }
                  disabled={manageBusy}
                  data-testid="edit-tier"
                  className="h-[32px] w-full px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[13px]"
                >
                  <option value="">No tier</option>
                  {tierOptions.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="flex flex-col gap-1">
              <span className="text-[11px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] font-medium">Phone</span>
              <input
                type="tel"
                value={manage.draft.phone}
                onChange={(e) =>
                  manage.status === "editing" &&
                  setManage({ status: "editing", draft: { ...manage.draft, phone: e.target.value } })
                }
                disabled={manageBusy}
                data-testid="edit-phone"
                className="h-[32px] w-full px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[13px] font-mono"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] font-medium">Email</span>
              <input
                type="email"
                value={manage.draft.email}
                onChange={(e) =>
                  manage.status === "editing" &&
                  setManage({ status: "editing", draft: { ...manage.draft, email: e.target.value } })
                }
                disabled={manageBusy}
                data-testid="edit-email"
                className="h-[32px] w-full px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[13px]"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] font-medium">Tax ID</span>
              <input
                type="text"
                value={manage.draft.taxId}
                onChange={(e) =>
                  manage.status === "editing" &&
                  setManage({ status: "editing", draft: { ...manage.draft, taxId: e.target.value } })
                }
                disabled={manageBusy}
                data-testid="edit-taxid"
                className="h-[32px] w-full px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[13px] font-mono"
              />
            </label>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={saveEdit}
              disabled={manageBusy || !manage.draft.name.trim()}
              data-testid="edit-save"
              className="h-[32px] px-4 rounded-[3px] bg-[var(--color-navy-700)] text-white text-[12.5px] font-medium disabled:opacity-50"
            >
              {manage.status === "submitting" ? "Saving..." : "Save changes"}
            </button>
            <button
              type="button"
              onClick={() => setManage({ status: "idle" })}
              disabled={manageBusy}
              data-testid="edit-cancel"
              className="h-[32px] px-3 rounded-[3px] border border-[var(--color-border-strong)] bg-white text-[var(--color-ink-900)] text-[12.5px] font-medium hover:bg-[var(--color-ink-100)] disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </section>
      )}

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
          <div className="px-3.5 py-2.5 grid grid-cols-1 sm:grid-cols-[140px_1fr_auto] gap-3 sm:items-center">
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

          <div className="px-3.5 py-2.5 grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-3 sm:items-center">
            <dt className="text-[var(--color-ink-600)] text-[13px]">Email</dt>
            <dd className="m-0 text-[var(--color-ink-900)]">
              {customer.email ?? "--"}
            </dd>
          </div>

          <div className="px-3.5 py-2.5 grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-3 sm:items-center">
            <dt className="text-[var(--color-ink-600)] text-[13px]">Type</dt>
            <dd className="m-0 text-[var(--color-ink-700)]">
              {customer.type === "RESELLER" ? "Reseller" : "End user"}
            </dd>
          </div>

          <div className="px-3.5 py-2.5 grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-3 sm:items-center">
            <dt className="text-[var(--color-ink-600)] text-[13px]">Tier</dt>
            <dd className="m-0 text-[var(--color-ink-700)]">
              {customer.tier?.name ?? "--"}
            </dd>
          </div>

          <div className="px-3.5 py-2.5 grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-3 sm:items-center">
            <dt className="text-[var(--color-ink-600)] text-[13px]">Status</dt>
            <dd className="m-0 text-[var(--color-ink-700)]">
              {customer.status === "ACTIVE" ? "Active" : "Inactive"}
            </dd>
          </div>

          <div className="px-3.5 py-2.5 grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-3 sm:items-center">
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
