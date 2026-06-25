"use client";

/**
 * Return detail (prompt 40). Network-only read (no returns mirror bucket).
 * State-gated actions, all gated return.manage:
 *   INITIATED  -> Begin inspection (no form; advances to INSPECTING)
 *   INSPECTING -> Resolve return (REPAIR or WRITE_OFF; cascades the unit)
 *   RESOLVED   -> read-only
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import ResolveReturnModal from "@/components/returns/ResolveReturnModal";
import ReturnStatusPill, { formatReturnStatus } from "@/components/returns/ReturnStatusPill";
import OfflineNotice from "@/components/sync/OfflineNotice";
import StatusPill from "@/components/units/StatusPill";
import {
  getCounterparty,
  getReturn,
  inspectReturn,
  type Counterparty,
  type ReturnDetail,
  type UnitStatus,
} from "@/lib/api";
import { usePermissions } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { DETAIL_GRID } from "@/lib/responsive";
import { useConnectivity } from "@/lib/sync/connectivity";
import { useUrlLastSegment } from "@/lib/sync/use-url-segment";

type LoadState =
  | { status: "loading" }
  | { status: "ok"; ret: ReturnDetail }
  | { status: "not_found" }
  | { status: "forbidden" }
  | { status: "offline" }
  | { status: "error"; message: string };

function dispositionLabel(d: ReturnDetail["disposition"]): string {
  switch (d) {
    case "REPAIR":
      return "Repair";
    case "WRITE_OFF":
      return "Write-off";
    case "SUPPLIER_WARRANTY_CLAIM":
      return "Supplier Warranty Claim";
    default:
      return "Pending decision";
  }
}

export default function ReturnDetailPage() {
  const router = useRouter();
  const id = useUrlLastSegment();
  const { has } = usePermissions();
  const canManage = has("return.manage");
  const { state: connState } = useConnectivity();
  const offlineConn = connState === "offline";

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [working, setWorking] = useState(false);
  const [actionError, setActionError] = useState("");
  const [resolveOpen, setResolveOpen] = useState(false);
  // Supplier name for a warranty claim. The claim carries only the counterparty
  // id, so resolve the name (and the detail link) by id when a claim is present.
  const [supplier, setSupplier] = useState<Counterparty | null>(null);

  useEffect(() => {
    if (!id) return;
    const ctrl = new AbortController();
    getReturn(id, ctrl.signal).then((r) => {
      if (ctrl.signal.aborted) return;
      if (r.kind === "ok") setState({ status: "ok", ret: r.data });
      else if (r.kind === "not_found") setState({ status: "not_found" });
      else if (r.kind === "unauthorized") router.replace("/login");
      else if (r.kind === "forbidden") setState({ status: "forbidden" });
      else if (r.kind === "network_error" || r.kind === "server_error")
        setState({ status: "offline" });
      else
        setState({ status: "error", message: "message" in r ? String(r.message) : "Error" });
    });
    return () => ctrl.abort();
  }, [id, router]);

  // Resolve the supplier counterparty for a warranty-claim resolution.
  const claimSupplierId =
    state.status === "ok" ? state.ret.supplierWarrantyClaim?.supplierCounterpartyId ?? null : null;
  useEffect(() => {
    if (!claimSupplierId) {
      setSupplier(null);
      return;
    }
    const ctrl = new AbortController();
    getCounterparty(claimSupplierId, ctrl.signal).then((r) => {
      if (!ctrl.signal.aborted && r.kind === "ok") setSupplier(r.data);
    });
    return () => ctrl.abort();
  }, [claimSupplierId]);

  const beginInspection = async () => {
    if (state.status !== "ok") return;
    setWorking(true);
    setActionError("");
    const r = await inspectReturn(state.ret.id);
    setWorking(false);
    if (r.kind === "ok") {
      setState({ status: "ok", ret: r.data });
    } else if (r.kind === "conflict") {
      setActionError(r.message || "This return can no longer be inspected.");
    } else if (r.kind === "forbidden") {
      setActionError("You do not have permission to inspect returns (requires return.manage).");
    } else if (r.kind === "network_error") {
      setActionError("Network error. Inspecting a return requires a live connection.");
    } else if (r.kind === "validation") {
      setActionError(typeof r.message === "string" ? r.message : r.message.join("; "));
    } else {
      setActionError("Unexpected response from the server.");
    }
  };

  if (state.status === "loading") {
    return (
      <div className="max-w-[820px] mx-auto py-10 text-center text-[var(--color-ink-500)]">
        Loading return…
      </div>
    );
  }
  if (state.status === "offline") {
    return (
      <div className="max-w-[820px] mx-auto pb-10">
        <OfflineNotice body="This return will load when the connection returns." />
        <div className="text-center mt-3">
          <Link href="/sales/returns" className="text-[12px] text-[var(--color-navy-700)] hover:underline">
            Back to Returns
          </Link>
        </div>
      </div>
    );
  }
  if (state.status === "not_found") {
    return (
      <div className="max-w-[640px] mx-auto py-12 text-center">
        <h1 className="text-[18px] font-semibold text-[var(--color-ink-900)] m-0 mb-2">Return not found</h1>
        <Link href="/sales/returns" className="text-[12px] text-[var(--color-navy-700)] hover:underline">
          Back to Returns
        </Link>
      </div>
    );
  }
  if (state.status === "forbidden") {
    return (
      <div className="max-w-[820px] mx-auto py-10 text-center text-[var(--color-ink-500)]">
        You do not have access to view this return.
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="max-w-[820px] mx-auto py-10 text-center text-[var(--color-danger-700)]">
        {state.message}
      </div>
    );
  }

  const ret = state.ret;
  const kvs: { label: string; value: React.ReactNode }[] = [
    {
      label: "Unit",
      value: (
        <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link
            href={`/inventory/units/${encodeURIComponent(ret.unit.engineNumber)}`}
            className="font-mono text-[var(--color-navy-700)] hover:underline"
          >
            {ret.unit.engineNumber}
          </Link>
          <StatusPill status={ret.unit.status as UnitStatus} />
        </span>
      ),
    },
    {
      label: "Sales order",
      value: (
        <Link
          href={`/sales/sales-orders/${ret.salesOrderId}`}
          className="font-mono text-[var(--color-navy-700)] hover:underline"
        >
          {ret.salesOrder.soNumber}
        </Link>
      ),
    },
    { label: "Reason", value: ret.reason ?? <span className="text-[var(--color-ink-400)]">--</span> },
    { label: "Initiated", value: formatDateTime(ret.initiatedAt) },
    {
      label: "Disposition",
      value:
        ret.status === "RESOLVED" ? (
          <span data-testid="return-disposition">{dispositionLabel(ret.disposition)}</span>
        ) : (
          <span className="text-[var(--color-ink-400)]">Not yet decided</span>
        ),
    },
    ...(ret.dispositionDecidedAt
      ? [{ label: "Resolved at", value: formatDateTime(ret.dispositionDecidedAt) }]
      : []),
    // Supplier warranty claim metadata (48a), shown only for a claim resolution.
    ...(ret.supplierWarrantyClaim
      ? [
          {
            label: "Supplier",
            value: (
              <span data-testid="claim-supplier-name" className="inline-flex items-center gap-2 flex-wrap">
                <Link
                  href={`/procurement/counterparties/${ret.supplierWarrantyClaim.supplierCounterpartyId}`}
                  className="text-[var(--color-navy-700)] hover:underline"
                >
                  {supplier?.name ?? ret.supplierWarrantyClaim.supplierCounterpartyId}
                </Link>
              </span>
            ),
          },
          {
            label: "Claim reference",
            value: ret.supplierWarrantyClaim.claimReference ? (
              <span data-testid="claim-reference-value" className="font-mono">{ret.supplierWarrantyClaim.claimReference}</span>
            ) : (
              <span data-testid="claim-reference-pending" className="text-[var(--color-warning-700)]">Pending VSK assignment</span>
            ),
          },
          {
            label: "Claim notes",
            value: ret.supplierWarrantyClaim.claimNotes ? (
              <span data-testid="claim-notes-value" className="whitespace-pre-wrap">{ret.supplierWarrantyClaim.claimNotes}</span>
            ) : (
              <span className="text-[var(--color-ink-400)]">--</span>
            ),
          },
          {
            label: "Claim status",
            value: (
              <span
                data-testid="claim-status"
                className="inline-flex items-center h-4 px-1.5 rounded-full text-[10px] font-semibold uppercase tracking-[0.02em] bg-[var(--color-warning-50)] text-[var(--color-warning-700)]"
              >
                Claimed
              </span>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="max-w-[820px] mx-auto pb-10">
      <header className="flex flex-wrap items-end justify-between gap-3 sm:gap-6 pb-4 mb-5 border-b border-[var(--color-border-default)]">
        <div className="min-w-0">
          <div className="text-[12px] text-[var(--color-ink-500)] flex items-center gap-1.5 mb-1.5 flex-wrap">
            <Link href="/sales/returns" className="text-[var(--color-ink-500)] hover:text-[var(--color-navy-700)]">
              Sales / Returns
            </Link>
            <span className="text-[var(--color-ink-300)]">/</span>
            <span className="text-[var(--color-ink-900)] font-medium font-mono">{ret.unit.engineNumber}</span>
          </div>
          <h1 className="text-[22px] font-semibold text-[var(--color-ink-900)] m-0 tracking-[-0.01em] flex items-center gap-3 flex-wrap">
            Return
            <ReturnStatusPill status={ret.status} />
          </h1>
        </div>
        {canManage && ret.status !== "RESOLVED" && (
          <div className="flex flex-wrap gap-2">
            {ret.status === "INITIATED" && (
              <button
                type="button"
                onClick={beginInspection}
                disabled={offlineConn || working}
                data-testid="begin-inspection-button"
                className="h-[32px] px-3 rounded-[3px] border border-[var(--color-navy-700)] bg-white text-[var(--color-navy-700)] text-[12.5px] font-medium disabled:opacity-50"
              >
                {working ? "Working…" : "Begin inspection"}
              </button>
            )}
            {ret.status === "INSPECTING" && (
              <button
                type="button"
                onClick={() => setResolveOpen(true)}
                disabled={offlineConn}
                data-testid="resolve-return-button"
                className="h-[32px] px-3 rounded-[3px] bg-[var(--color-navy-700)] text-white text-[12.5px] font-medium disabled:opacity-50"
              >
                Resolve return
              </button>
            )}
          </div>
        )}
      </header>

      {actionError && (
        <div
          role="alert"
          data-testid="return-action-error"
          className="mb-4 px-3.5 py-2.5 rounded-[3px] bg-[var(--color-danger-50)] border border-[var(--color-danger-100)] text-[12.5px] text-[var(--color-danger-700)]"
        >
          {actionError}
        </div>
      )}

      <section className="bg-white border border-[var(--color-border-default)] rounded-[4px] overflow-hidden">
        <header className="px-4 sm:px-5 py-3.5 border-b border-[var(--color-border-default)] flex items-center justify-between gap-3">
          <h2 className="m-0 text-[14px] font-semibold text-[var(--color-ink-900)]">Return detail</h2>
          <span className="text-[11px] text-[var(--color-ink-500)]">{formatReturnStatus(ret.status)}</span>
        </header>
        <div className="px-4 sm:px-6 py-5 grid grid-cols-1 sm:grid-cols-2 gap-x-6 lg:gap-x-16 gap-y-1">
          {kvs.map((kv, i) => (
            <div
              key={i}
              className={`${DETAIL_GRID} gap-1 sm:gap-4 items-baseline py-2.5 border-b border-dashed border-[var(--color-border-default)] last:border-b-0 text-[13px]`}
            >
              <span className="text-[12px] font-medium text-[var(--color-ink-500)]">{kv.label}</span>
              <span className="min-w-0 break-words text-[var(--color-ink-900)] font-medium">{kv.value}</span>
            </div>
          ))}
        </div>
      </section>

      {canManage && (
        <ResolveReturnModal
          open={resolveOpen}
          onClose={() => setResolveOpen(false)}
          returnId={ret.id}
          unitEngineNumber={ret.unit.engineNumber}
          onSuccess={(updated) => {
            setResolveOpen(false);
            setState({ status: "ok", ret: updated });
          }}
        />
      )}
    </div>
  );
}
