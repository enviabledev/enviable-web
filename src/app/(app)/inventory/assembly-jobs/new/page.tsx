"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import FreshnessBadge from "@/components/sync/FreshnessBadge";
import { listUnits, startAssembly, type UnitListRow, type UnitStatus } from "@/lib/api";
import { isTransientFailure } from "@/lib/api/client";
import { usePermissions } from "@/lib/auth";
import { queueStartAssembly } from "@/lib/sync/actions/assembly";
import { useConnectivity } from "@/lib/sync/connectivity";
import { listByType } from "@/lib/sync/mirror/store";

// Field-access audit: the renderer reads id, engineNumber, chassisNumber,
// variantLabel; all assigned here from UnitListRow fields that the units API
// guarantees (productVariant is always joined on the list row).
type CkdUnit = {
  id: string;
  engineNumber: string;
  chassisNumber: string;
  variantLabel: string;
};

type LoadState =
  | { status: "loading" }
  | { status: "ok"; units: CkdUnit[]; fromMirror: boolean }
  | { status: "error"; message: string };

type SubmitState =
  | { status: "idle" }
  | { status: "confirming" }
  | { status: "submitting" }
  | { status: "queued-offline"; count: number }
  | { status: "rejected"; message: string }
  | { status: "error"; message: string };

// Cached unit row from the mirror; same field shape as the API list row
// because the mirror stores the rows the backend emitted.
type MirroredUnit = {
  id: string;
  engineNumber: string;
  chassisNumber: string;
  status: UnitStatus;
  productVariant?: UnitListRow["productVariant"];
};

function ckdUnitsFromList(rows: UnitListRow[]): CkdUnit[] {
  return rows.map((u) => {
    const attrs = u.productVariant.variantAttributes;
    const variantLabel =
      [attrs.model, attrs.colour].filter(Boolean).join(" ") || u.productVariant.supplierSkuCode;
    return {
      id: u.id,
      engineNumber: u.engineNumber,
      chassisNumber: u.chassisNumber,
      variantLabel,
    };
  });
}

function ckdUnitsFromMirror(rows: MirroredUnit[]): CkdUnit[] {
  return rows
    .filter((u) => u.status === "IN_WAREHOUSE_CKD")
    .map((u) => {
      const attrs = u.productVariant?.variantAttributes ?? {};
      const variantLabel =
        [attrs.model, attrs.colour].filter(Boolean).join(" ") ||
        u.productVariant?.supplierSkuCode ||
        "(variant unavailable offline)";
      return {
        id: u.id,
        engineNumber: u.engineNumber,
        chassisNumber: u.chassisNumber,
        variantLabel,
      };
    });
}

export default function StartAssemblyPage() {
  const router = useRouter();
  const { has } = usePermissions();
  const { state: connState } = useConnectivity();
  const canPerform = has("assembly.perform");

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submit, setSubmit] = useState<SubmitState>({ status: "idle" });

  useEffect(() => {
    if (!canPerform) return;
    const ctrl = new AbortController();
    // Mirror-first paint, then network revalidate. The mirror picker offers
    // CKD units even cold-offline (filtered locally from the units bucket);
    // when the network confirms, the network list takes over.
    let mirrorPainted = false;
    (async () => {
      try {
        const rows = await listByType<MirroredUnit>("unit");
        if (ctrl.signal.aborted) return;
        const units = ckdUnitsFromMirror(rows.map((r) => r.body));
        if (units.length > 0) {
          mirrorPainted = true;
          setState({ status: "ok", units, fromMirror: true });
        }
      } catch {
        // let network drive
      }
    })();

    // Only IN_WAREHOUSE_CKD units are eligible to start assembly (the backend
    // rejects anything else). Filter at the source so the picker only offers
    // legal units, mirroring the state-machine gate.
    listUnits({ status: ["IN_WAREHOUSE_CKD"], pageSize: 250 }, ctrl.signal).then((r) => {
      if (ctrl.signal.aborted) return;
      if (r.kind === "ok") {
        setState({ status: "ok", units: ckdUnitsFromList(r.data.data), fromMirror: false });
      } else if (r.kind === "unauthorized") {
        router.replace("/login");
      } else if (r.kind === "forbidden") {
        setState({ status: "error", message: "You do not have access to read units." });
      } else if (isTransientFailure(r)) {
        // Network unreachable. If the mirror already painted, keep it (the
        // clerk can still queue starts offline). If the mirror is empty,
        // surface offline so they know nothing was loaded.
        if (!mirrorPainted) {
          setState({ status: "ok", units: [], fromMirror: true });
        }
      } else {
        setState({ status: "error", message: "message" in r ? String(r.message) : "Error loading units." });
      }
    });
    return () => ctrl.abort();
  }, [canPerform, router]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    if (submit.status === "rejected" || submit.status === "error") setSubmit({ status: "idle" });
  };

  const doSubmit = async () => {
    if (submit.status === "submitting") return;
    const unitRefs = [...selected];
    if (unitRefs.length === 0) return;
    setSubmit({ status: "submitting" });

    // Offline path: queue via assembly.start. The picker may have come from
    // the mirror (a CKD unit moved on the server while the clerk was offline
    // will fail at drain time as a string-message conflict, surfaced via the
    // sync indicator). Wording is honest: not "started", "saved locally".
    if (connState === "offline") {
      await queueStartAssembly({
        unitRefs,
        description: `Start assembly for ${unitRefs.length} unit${unitRefs.length === 1 ? "" : "s"}`,
      });
      setSubmit({ status: "queued-offline", count: unitRefs.length });
      return;
    }

    const r = await startAssembly(unitRefs);
    if (r.kind === "ok") {
      router.replace("/inventory/assembly-jobs");
      return;
    }
    if (r.kind === "conflict") {
      // String-message assembly conflict (unit not IN_WAREHOUSE_CKD, duplicate
      // ref in the batch). Surface verbatim; nothing was started (the backend
      // rejects the whole batch atomically).
      setSubmit({ status: "rejected", message: r.message });
      return;
    }
    if (r.kind === "not_found") {
      setSubmit({ status: "rejected", message: "One of the selected units no longer exists. Refresh and try again." });
      return;
    }
    if (r.kind === "forbidden") {
      setSubmit({ status: "error", message: "You do not have permission to start assembly (requires assembly.perform)." });
      return;
    }
    if (r.kind === "validation") {
      setSubmit({ status: "error", message: typeof r.message === "string" ? r.message : r.message.join("; ") });
      return;
    }
    if (r.kind === "network_error") {
      // Connectivity flipped between the conn check and the POST; fall
      // through to the offline-enqueue path so the clerk's work is not lost.
      await queueStartAssembly({
        unitRefs,
        description: `Start assembly for ${unitRefs.length} unit${unitRefs.length === 1 ? "" : "s"}`,
      });
      setSubmit({ status: "queued-offline", count: unitRefs.length });
      return;
    }
    setSubmit({ status: "error", message: "Unexpected response from the server." });
  };

  if (!canPerform) {
    return (
      <div className="max-w-[1080px] mx-auto py-10 text-center text-[var(--color-ink-500)]">
        You do not have permission to start assembly (requires assembly.perform).
      </div>
    );
  }

  return (
    <div className="max-w-[1080px] mx-auto pb-10">
      <header className="pb-4 mb-5 border-b border-[var(--color-border-default)]">
        <div className="text-[12px] text-[var(--color-ink-500)] flex items-center gap-1.5 mb-1.5 flex-wrap">
          <Link href="/inventory/assembly-jobs" className="text-[var(--color-ink-500)] hover:text-[var(--color-navy-700)]">
            Inventory
          </Link>
          <span className="text-[var(--color-ink-300)]">/</span>
          <Link href="/inventory/assembly-jobs" className="text-[var(--color-ink-500)] hover:text-[var(--color-navy-700)]">
            Assembly Jobs
          </Link>
          <span className="text-[var(--color-ink-300)]">/</span>
          <span className="text-[var(--color-ink-900)] font-medium">Start Assembly</span>
        </div>
        <h1 className="text-[24px] font-semibold text-[var(--color-ink-900)] m-0 tracking-[-0.01em]">Start Assembly</h1>
        <div className="text-[13px] text-[var(--color-ink-500)] mt-1 max-w-[820px]">
          Select the CKD units to put into assembly. Starting creates one job per unit and pivots each
          unit from In Warehouse CKD to In Assembly. Only units currently in CKD are listed.
        </div>
      </header>

      {state.status === "loading" && (
        <div className="py-10 text-center text-[var(--color-ink-500)]">Loading eligible units...</div>
      )}
      {state.status === "error" && (
        <div className="py-10 text-center text-[var(--color-danger-700)]">{state.message}</div>
      )}

      {state.status === "ok" && (
        <>
          {submit.status === "queued-offline" && (
            <div
              role="status"
              className="mb-4 px-3.5 py-2.5 rounded-[3px] border"
              style={{
                background: "var(--color-success-100)",
                borderColor: "var(--color-success-700)",
                color: "var(--color-success-700)",
              }}
            >
              <div className="text-[12.5px] leading-[1.5]">
                <span className="font-semibold">Saved locally, will sync.</span>{" "}
                Start queued for {submit.count} unit{submit.count === 1 ? "" : "s"}. The units are
                NOT yet in assembly; the server will run the transition (atomically, all-or-nothing)
                when the connection returns. Watch the sync indicator in the topbar; if the server
                rejects the batch (e.g. a selected unit is no longer in CKD), the action will fail
                with the server&apos;s message readable there.
              </div>
              <div className="mt-2 flex gap-2">
                <Link
                  href="/inventory/assembly-jobs"
                  className="h-7 px-3 inline-flex items-center rounded-[3px] text-[12px] font-medium text-white"
                  style={{ background: "var(--color-success-700)" }}
                >
                  Back to Assembly Jobs
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    setSelected(new Set());
                    setSubmit({ status: "idle" });
                  }}
                  className="h-7 px-3 inline-flex items-center rounded-[3px] text-[12px] font-medium border border-[var(--color-border-strong)] bg-white text-[var(--color-ink-900)] hover:bg-[var(--color-ink-100)]"
                >
                  Queue another
                </button>
              </div>
            </div>
          )}

          {submit.status === "rejected" && (
            <div
              role="alert"
              className="mb-4 px-4 py-3 rounded-[4px] border-2"
              style={{ background: "var(--color-danger-50)", borderColor: "var(--color-danger-700)" }}
            >
              <div className="font-semibold text-[13px] text-[var(--color-danger-700)] mb-1">
                Batch rejected. Nothing was started.
              </div>
              <div className="text-[12px] text-[var(--color-ink-700)]">
                <span className="font-medium">Server message:</span>{" "}
                <span className="font-mono">{submit.message}</span>
              </div>
              <div className="text-[12px] text-[var(--color-ink-700)] mt-1">
                Starting is all-or-nothing; fix the selection and try again.
              </div>
            </div>
          )}
          {submit.status === "error" && (
            <div
              role="alert"
              className="mb-4 px-3.5 py-2.5 rounded-[3px] border"
              style={{ background: "var(--color-danger-50)", borderColor: "var(--color-danger-100)", color: "var(--color-danger-700)" }}
            >
              <div className="text-[12px]">{submit.message}</div>
            </div>
          )}

          {submit.status === "confirming" && (
            <div
              role="dialog"
              className="mb-4 px-4 py-3 rounded-[4px] border-2"
              style={{ background: "var(--color-navy-50)", borderColor: "var(--color-navy-700)" }}
            >
              <div className="text-[13px] font-semibold text-[var(--color-navy-800)] mb-1">
                Start assembly for {selected.size} unit{selected.size === 1 ? "" : "s"}?
              </div>
              <div className="text-[12.5px] text-[var(--color-ink-900)] mb-3">
                Each selected unit pivots from In Warehouse CKD to In Assembly, and a job is opened for it.
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={doSubmit}
                  className="h-8 px-4 rounded-[3px] text-[12.5px] font-medium text-white inline-flex items-center"
                  style={{ background: "var(--color-navy-700)" }}
                >
                  Confirm and start
                </button>
                <button
                  type="button"
                  onClick={() => setSubmit({ status: "idle" })}
                  className="h-8 px-3 rounded-[3px] text-[12.5px] font-medium border border-[var(--color-border-strong)] bg-white text-[var(--color-ink-900)] hover:bg-[var(--color-ink-100)] inline-flex items-center"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <section className="bg-white border border-[var(--color-border-default)] rounded-[4px] mb-4">
            <header className="px-4 py-2.5 border-b border-[var(--color-border-default)] flex items-center justify-between">
              <h2 className="m-0 text-[13px] font-semibold text-[var(--color-ink-900)] flex items-center gap-2">
                Eligible units{" "}
                <span className="text-[11px] text-[var(--color-ink-500)] font-medium ml-1">
                  {state.units.length} in CKD
                </span>
                {state.fromMirror && <FreshnessBadge />}
              </h2>
              {state.units.length > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    setSelected((prev) =>
                      prev.size === state.units.length ? new Set() : new Set(state.units.map((u) => u.id)),
                    )
                  }
                  className="text-[12px] text-[var(--color-navy-700)] hover:underline"
                >
                  {selected.size === state.units.length ? "Clear all" : "Select all"}
                </button>
              )}
            </header>
            {state.units.length === 0 ? (
              <div className="px-4 py-8 text-center text-[12.5px] text-[var(--color-ink-500)]">
                {state.fromMirror
                  ? "No CKD units are cached locally. Connect to load eligible units."
                  : "No units are currently in CKD. Receive and stock CKD units before starting assembly."}
              </div>
            ) : (
              <table className="w-full text-[13px]">
                <thead>
                  <tr>
                    <th className="w-[40px] bg-[var(--color-ink-100)] border-b border-[var(--color-border-default)]" />
                    <th className="text-left font-medium text-[11px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] px-3.5 py-2.5 border-b border-[var(--color-border-default)] bg-[var(--color-ink-100)]">
                      Engine Number
                    </th>
                    <th className="text-left font-medium text-[11px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] px-3.5 py-2.5 border-b border-[var(--color-border-default)] bg-[var(--color-ink-100)]">
                      Chassis Number
                    </th>
                    <th className="text-left font-medium text-[11px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] px-3.5 py-2.5 border-b border-[var(--color-border-default)] bg-[var(--color-ink-100)]">
                      Variant
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {state.units.map((u, i) => {
                    const checked = selected.has(u.id);
                    return (
                      <tr
                        key={u.id}
                        onClick={() => toggle(u.id)}
                        className={`${i % 2 ? "bg-[#FBFBFC]" : "bg-white"} border-b border-[var(--color-border-default)] cursor-pointer ${
                          checked ? "bg-[var(--color-navy-50)]" : "hover:bg-[var(--color-navy-50)]"
                        }`}
                      >
                        <td className="px-3.5 py-2.5 text-center">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggle(u.id)}
                            onClick={(e) => e.stopPropagation()}
                            aria-label={`Select ${u.engineNumber}`}
                          />
                        </td>
                        <td className="px-3.5 py-2.5 font-mono text-[12px] text-[var(--color-ink-900)] tracking-[0.02em] whitespace-nowrap">
                          {u.engineNumber}
                        </td>
                        <td className="px-3.5 py-2.5 font-mono text-[12px] text-[var(--color-ink-700)] tracking-[0.02em] whitespace-nowrap">
                          {u.chassisNumber}
                        </td>
                        <td className="px-3.5 py-2.5 text-[12.5px] text-[var(--color-ink-900)] whitespace-nowrap">
                          {u.variantLabel}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>

          <div className="bg-white border border-[var(--color-border-default)] rounded-[4px] px-4 py-3 flex items-center justify-between">
            <div className="text-[12.5px] text-[var(--color-ink-700)]">
              <span className="font-semibold text-[var(--color-ink-900)] tabular-nums">{selected.size}</span>{" "}
              unit{selected.size === 1 ? "" : "s"} selected
            </div>
            <div className="flex gap-2">
              <Link
                href="/inventory/assembly-jobs"
                className="h-8 px-3 rounded-[3px] text-[12.5px] font-medium border border-[var(--color-border-strong)] bg-white text-[var(--color-ink-900)] hover:bg-[var(--color-ink-100)] inline-flex items-center"
              >
                Cancel
              </Link>
              <button
                type="button"
                onClick={() => setSubmit({ status: "confirming" })}
                disabled={
                  selected.size === 0 ||
                  submit.status === "submitting" ||
                  submit.status === "confirming" ||
                  submit.status === "queued-offline"
                }
                className="h-8 px-4 rounded-[3px] text-[12.5px] font-medium text-white disabled:opacity-50 inline-flex items-center"
                style={{ background: "var(--color-navy-700)" }}
              >
                {submit.status === "submitting"
                  ? "Starting..."
                  : `Start assembly for ${selected.size} unit${selected.size === 1 ? "" : "s"}`}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
