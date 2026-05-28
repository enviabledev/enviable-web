"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import AssemblyStatusPill from "@/components/assembly/AssemblyStatusPill";
import FreshnessBadge from "@/components/sync/FreshnessBadge";
import OfflineNotice from "@/components/sync/OfflineNotice";
import StatusPill from "@/components/units/StatusPill";
import {
  assemblyJobIsActionable,
  completeAssembly,
  failAssembly,
  getAssemblyJob,
  getUnit,
  type ApiResult,
  type AssemblyJob,
  type AssemblyJobStatus,
  type UnitStatus,
} from "@/lib/api";
import { usePermissions } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { getById } from "@/lib/sync/mirror/store";

// Variant context joined from the unit. Same fields online (getUnit) and
// offline (productVariant bucket), so the detail shape is source-independent.
type VariantInfo = { label: string | null; sku: string | null; productName: string | null };

// The shape the renderer consumes. Field-access audit: every field read by the
// view is assigned in detailFromJob with an explicit fallback.
type AssemblyDetail = {
  id: string;
  status: AssemblyJobStatus;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  notes: string | null;
  unitId: string;
  engineNumber: string;
  unitStatus: UnitStatus | null;
  variant: VariantInfo;
  supervisorName: string | null;
};

type LoadState =
  | { status: "loading" }
  | { status: "ok"; detail: AssemblyDetail; fromMirror: boolean }
  | { status: "not_found" }
  | { status: "offline" }
  | { status: "error"; message: string };

type ActionState =
  | { status: "idle" }
  | { status: "confirming"; action: "complete" | "fail" }
  | { status: "submitting"; action: "complete" | "fail" }
  | { status: "conflict"; message: string }
  | { status: "error"; message: string };

function detailFromJob(job: AssemblyJob, variant: VariantInfo): AssemblyDetail {
  return {
    id: job.id,
    status: job.status,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    notes: job.notes,
    unitId: job.unitId,
    engineNumber: job.unit?.engineNumber ?? job.unitId,
    unitStatus: job.unit?.status ?? null,
    variant,
    supervisorName: job.supervisor?.fullName ?? null,
  };
}

function variantLabelOf(model?: string, colour?: string, sku?: string): string | null {
  const composed = [model, colour].filter(Boolean).join(" ");
  return composed || sku || null;
}

export default function AssemblyJobDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { has } = usePermissions();
  const id = decodeURIComponent(params.id);
  const canRead = has("assembly.read");
  const canPerform = has("assembly.perform");

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [action, setAction] = useState<ActionState>({ status: "idle" });

  useEffect(() => {
    if (!canRead) return;
    const ctrl = new AbortController();

    // Phase 1: paint from the mirror. assemblyJob bucket is empty until the
    // backend emits it; when present, the job + unit + variant buckets
    // reconstruct the full detail offline. Supervisor is unavailable offline
    // (users are not mirrored).
    (async () => {
      try {
        const jobRow = await getById<Omit<AssemblyJob, "unit" | "supervisor">>("assemblyJob", id);
        if (ctrl.signal.aborted || !jobRow) return;
        const unitRow = await getById<{ id: string; engineNumber: string; status: UnitStatus; productVariantId: string }>(
          "unit",
          jobRow.body.unitId,
        );
        if (ctrl.signal.aborted) return;
        let variant: VariantInfo = { label: null, sku: null, productName: null };
        if (unitRow) {
          const variantRow = await getById<{ supplierSkuCode: string; variantAttributes: { model?: string; colour?: string } }>(
            "productVariant",
            unitRow.body.productVariantId,
          );
          if (ctrl.signal.aborted) return;
          if (variantRow) {
            variant = {
              label: variantLabelOf(
                variantRow.body.variantAttributes?.model,
                variantRow.body.variantAttributes?.colour,
                variantRow.body.supplierSkuCode,
              ),
              sku: variantRow.body.supplierSkuCode,
              productName: null,
            };
          }
        }
        const synthetic: AssemblyJob = {
          ...jobRow.body,
          unit: unitRow
            ? { id: unitRow.body.id, engineNumber: unitRow.body.engineNumber, status: unitRow.body.status }
            : null,
          supervisor: null,
        };
        setState((prev) =>
          prev.status === "ok" && !prev.fromMirror
            ? prev
            : { status: "ok", detail: detailFromJob(synthetic, variant), fromMirror: true },
        );
      } catch {
        // Mirror read failed; let the network phase drive.
      }
    })();

    // Phase 2: revalidate against the network.
    (async () => {
      const jobRes: ApiResult<AssemblyJob> = await getAssemblyJob(id, ctrl.signal);
      if (ctrl.signal.aborted) return;
      if (jobRes.kind === "not_found") {
        setState((prev) => (prev.status === "ok" && prev.fromMirror ? prev : { status: "not_found" }));
        return;
      }
      if (jobRes.kind === "unauthorized") {
        router.replace("/login");
        return;
      }
      if (jobRes.kind === "forbidden") {
        setState({ status: "error", message: "You do not have access to view this assembly job." });
        return;
      }
      if (jobRes.kind !== "ok") {
        // Transient: if we have no mirror paint yet, show offline; else keep it.
        setState((prev) => (prev.status === "ok" ? prev : { status: "offline" }));
        return;
      }
      // Join variant from the unit detail (productVariant + product).
      let variant: VariantInfo = { label: null, sku: null, productName: null };
      const unitRes = await getUnit(jobRes.data.unitId, ctrl.signal);
      if (ctrl.signal.aborted) return;
      if (unitRes.kind === "ok") {
        const pv = unitRes.data.productVariant;
        variant = {
          label: variantLabelOf(pv.variantAttributes.model, pv.variantAttributes.colour, pv.supplierSkuCode),
          sku: pv.supplierSkuCode,
          productName: pv.product?.name ?? null,
        };
      }
      setState({ status: "ok", detail: detailFromJob(jobRes.data, variant), fromMirror: false });
    })();

    return () => ctrl.abort();
  }, [id, router, canRead]);

  const runAction = async (which: "complete" | "fail") => {
    if (action.status === "submitting") return;
    setAction({ status: "submitting", action: which });
    const fn = which === "complete" ? completeAssembly : failAssembly;
    const r = await fn(id);
    if (r.kind === "ok") {
      // Reflect the server's authoritative new state. The unit/variant
      // association is unchanged, so reuse the current variant context.
      setState((prev) => {
        const variant = prev.status === "ok" ? prev.detail.variant : { label: null, sku: null, productName: null };
        return { status: "ok", detail: detailFromJob(r.data, variant), fromMirror: false };
      });
      setAction({ status: "idle" });
    } else if (r.kind === "conflict") {
      // String-message assembly conflict (e.g. job not IN_PROGRESS, or a
      // concurrent transition). Surface verbatim.
      setAction({ status: "conflict", message: r.message });
    } else if (r.kind === "forbidden") {
      setAction({ status: "error", message: "You do not have permission to perform this action (requires assembly.perform)." });
    } else if (r.kind === "validation") {
      setAction({ status: "error", message: typeof r.message === "string" ? r.message : r.message.join("; ") });
    } else if (r.kind === "network_error") {
      setAction({ status: "error", message: "You appear to be offline. Assembly actions require a connection; try again when reconnected." });
    } else {
      setAction({ status: "error", message: "Unexpected response from the server." });
    }
  };

  if (!canRead) {
    return (
      <div className="max-w-[1080px] mx-auto py-10 text-center text-[var(--color-ink-500)]">
        You do not have access to view assembly jobs (requires assembly.read).
      </div>
    );
  }
  if (state.status === "loading") {
    return <div className="max-w-[1080px] mx-auto py-10 text-center text-[var(--color-ink-500)]">Loading assembly job...</div>;
  }
  if (state.status === "not_found") {
    return (
      <div className="max-w-[640px] mx-auto py-12">
        <div className="bg-white border border-[var(--color-border-default)] rounded-[4px] px-6 py-8 text-center">
          <h1 className="text-[18px] font-semibold text-[var(--color-ink-900)] m-0 mb-2">Assembly job not found</h1>
          <p className="text-[13px] text-[var(--color-ink-700)] m-0 mb-1">
            No assembly job matches <span className="font-mono text-[var(--color-navy-700)]">{id}</span>.
          </p>
          <Link
            href="/inventory/assembly-jobs"
            className="mt-5 inline-flex items-center h-8 px-3 rounded-[3px] text-[12.5px] font-medium text-white"
            style={{ background: "var(--color-navy-700)" }}
          >
            Back to Assembly Jobs
          </Link>
        </div>
      </div>
    );
  }
  if (state.status === "error") {
    return <div className="max-w-[1080px] mx-auto py-10 text-center text-[var(--color-danger-700)]">{state.message}</div>;
  }
  if (state.status === "offline") {
    return (
      <div className="max-w-[820px] mx-auto pb-10">
        <OfflineNotice body="This assembly job's details will load when the connection returns. Jobs visited online appear here from the local mirror once the backend mirrors assembly jobs." />
        <div className="text-center mt-3">
          <Link href="/inventory/assembly-jobs" className="text-[12px] text-[var(--color-navy-700)] hover:underline">
            Back to Assembly Jobs
          </Link>
        </div>
      </div>
    );
  }

  const d = state.detail;
  const isFromMirror = state.fromMirror;
  const actionable = assemblyJobIsActionable(d.status);
  const showActions = actionable && canPerform;

  return (
    <div className="max-w-[1080px] mx-auto pb-10">
      <header className="flex items-end justify-between gap-6 pb-4 mb-5 border-b border-[var(--color-border-default)]">
        <div>
          <div className="text-[12px] text-[var(--color-ink-500)] flex items-center gap-1.5 mb-1.5 flex-wrap">
            <Link href="/inventory/assembly-jobs" className="text-[var(--color-ink-500)] hover:text-[var(--color-navy-700)]">
              Inventory
            </Link>
            <span className="text-[var(--color-ink-300)]">/</span>
            <Link href="/inventory/assembly-jobs" className="text-[var(--color-ink-500)] hover:text-[var(--color-navy-700)]">
              Assembly Jobs
            </Link>
            <span className="text-[var(--color-ink-300)]">/</span>
            <span className="text-[var(--color-ink-900)] font-medium font-mono">{d.engineNumber}</span>
          </div>
          <div className="flex items-center gap-3 flex-wrap mb-1">
            <h1 className="text-[24px] font-semibold text-[var(--color-ink-900)] m-0 tracking-[-0.01em]">
              Assembly of <span className="font-mono">{d.engineNumber}</span>
            </h1>
            <AssemblyStatusPill status={d.status} />
            {isFromMirror && <FreshnessBadge />}
          </div>
          <div className="text-[13px] text-[var(--color-ink-500)]">
            {d.variant.label ? (
              <>
                Variant: <span className="text-[var(--color-ink-900)] font-medium">{d.variant.label}</span>
                {d.variant.sku && <span className="ml-2 font-mono text-[11px]">{d.variant.sku}</span>}
              </>
            ) : (
              <span className="text-[var(--color-ink-400)]">Variant unavailable</span>
            )}
          </div>
        </div>

        {showActions && action.status !== "confirming" && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setAction({ status: "confirming", action: "complete" })}
              disabled={action.status === "submitting"}
              className="h-8 px-3 rounded-[3px] text-[12.5px] font-medium text-white disabled:opacity-50 inline-flex items-center"
              style={{ background: "var(--color-success-700)" }}
            >
              {action.status === "submitting" && action.action === "complete" ? "Completing..." : "Complete Assembly"}
            </button>
            <button
              type="button"
              onClick={() => setAction({ status: "confirming", action: "fail" })}
              disabled={action.status === "submitting"}
              className="h-8 px-3 rounded-[3px] text-[12.5px] font-medium border border-[var(--color-danger-700)] bg-white text-[var(--color-danger-700)] hover:bg-[var(--color-danger-50)] disabled:opacity-50 inline-flex items-center"
            >
              {action.status === "submitting" && action.action === "fail" ? "Failing..." : "Fail Assembly"}
            </button>
          </div>
        )}
        {actionable && !canPerform && (
          <span className="text-[11px] text-[var(--color-ink-500)] self-end">
            No actions available (requires assembly.perform)
          </span>
        )}
      </header>

      {action.status === "confirming" && (
        <ConfirmBar
          action={action.action}
          engineNumber={d.engineNumber}
          onConfirm={() => runAction(action.action)}
          onCancel={() => setAction({ status: "idle" })}
        />
      )}

      {action.status === "conflict" && (
        <div
          role="alert"
          className="mb-4 px-3.5 py-2.5 rounded-[3px] border"
          style={{ background: "var(--color-warning-50)", borderColor: "var(--color-warning-100)", color: "var(--color-warning-700)" }}
        >
          <div className="font-semibold text-[12.5px] mb-0.5">Action rejected by the server</div>
          <div className="text-[12px]">{action.message}</div>
        </div>
      )}
      {action.status === "error" && (
        <div
          role="alert"
          className="mb-4 px-3.5 py-2.5 rounded-[3px] border"
          style={{ background: "var(--color-danger-50)", borderColor: "var(--color-danger-100)", color: "var(--color-danger-700)" }}
        >
          <div className="text-[12px]">{action.message}</div>
        </div>
      )}

      <LifecycleCard unitStatus={d.unitStatus} jobStatus={d.status} />
      <DetailCard d={d} fromMirror={isFromMirror} />
    </div>
  );
}

/**
 * Confirmation step before a state-changing post (confirmed-update). Spells out
 * the unit-status consequence so the supervisor knows exactly what the action
 * pivots the unit to before committing.
 */
function ConfirmBar({
  action,
  engineNumber,
  onConfirm,
  onCancel,
}: {
  action: "complete" | "fail";
  engineNumber: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const isComplete = action === "complete";
  return (
    <div
      role="dialog"
      className="mb-4 px-4 py-3 rounded-[4px] border-2"
      style={{
        background: isComplete ? "var(--color-success-50)" : "var(--color-danger-50)",
        borderColor: isComplete ? "var(--color-success-700)" : "var(--color-danger-700)",
      }}
    >
      <div className="text-[13px] font-semibold mb-1" style={{ color: isComplete ? "var(--color-success-700)" : "var(--color-danger-700)" }}>
        {isComplete ? "Complete this assembly?" : "Fail this assembly?"}
      </div>
      <div className="text-[12.5px] text-[var(--color-ink-900)] mb-3">
        {isComplete ? (
          <>
            Unit <span className="font-mono font-semibold">{engineNumber}</span> will pivot from{" "}
            <span className="font-semibold">In Assembly</span> to{" "}
            <span className="font-semibold">In Warehouse CBU</span>. This records you as the assembler.
          </>
        ) : (
          <>
            Unit <span className="font-mono font-semibold">{engineNumber}</span> will be marked{" "}
            <span className="font-semibold">Damaged</span> and the job recorded as failed. This cannot be undone from here.
          </>
        )}
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onConfirm}
          className="h-8 px-4 rounded-[3px] text-[12.5px] font-medium text-white inline-flex items-center"
          style={{ background: isComplete ? "var(--color-success-700)" : "var(--color-danger-700)" }}
        >
          {isComplete ? "Confirm completion" : "Confirm failure"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="h-8 px-3 rounded-[3px] text-[12.5px] font-medium border border-[var(--color-border-strong)] bg-white text-[var(--color-ink-900)] hover:bg-[var(--color-ink-100)] inline-flex items-center"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function LifecycleCard({ unitStatus, jobStatus }: { unitStatus: UnitStatus | null; jobStatus: AssemblyJobStatus }) {
  // The unit pivot the job drives: CKD -> In Assembly -> CBU (or Damaged on
  // fail). Highlight the unit's current position.
  const steps: { label: string; match: UnitStatus }[] = [
    { label: "In Warehouse CKD", match: "IN_WAREHOUSE_CKD" },
    { label: "In Assembly", match: "IN_ASSEMBLY" },
    { label: "In Warehouse CBU", match: "IN_WAREHOUSE_CBU" },
  ];
  const failed = jobStatus === "FAILED";
  return (
    <section className="bg-white border border-[var(--color-border-default)] rounded-[4px] mb-5">
      <header className="px-5 py-3 border-b border-[var(--color-border-default)] flex items-center justify-between">
        <h2 className="m-0 text-[13px] font-semibold text-[var(--color-ink-900)]">Unit lifecycle</h2>
        {unitStatus && <StatusPill status={unitStatus} />}
      </header>
      <div className="px-5 py-4 flex items-center gap-2 flex-wrap">
        {steps.map((step, i) => {
          const active = unitStatus === step.match;
          return (
            <div key={step.match} className="flex items-center gap-2">
              <span
                className={`inline-flex items-center h-6 px-2.5 rounded-[3px] text-[11.5px] font-medium ${
                  active
                    ? "bg-[var(--color-navy-700)] text-white"
                    : "bg-[var(--color-ink-100)] text-[var(--color-ink-500)]"
                }`}
              >
                {step.label}
              </span>
              {i < steps.length - 1 && <span className="text-[var(--color-ink-300)]">&rarr;</span>}
            </div>
          );
        })}
        {failed && (
          <>
            <span className="text-[var(--color-ink-300)]">&middot;</span>
            <span className="inline-flex items-center h-6 px-2.5 rounded-[3px] text-[11.5px] font-medium bg-[var(--color-danger-50)] text-[var(--color-danger-700)]">
              Damaged (failed)
            </span>
          </>
        )}
      </div>
    </section>
  );
}

function DetailCard({ d, fromMirror }: { d: AssemblyDetail; fromMirror: boolean }) {
  const rows: { label: string; value: React.ReactNode; mono?: boolean }[] = [
    { label: "Engine Number", value: d.engineNumber, mono: true },
    { label: "Variant", value: d.variant.label ?? <span className="text-[var(--color-ink-400)]">--</span> },
    { label: "Job Status", value: <AssemblyStatusPill status={d.status} /> },
    { label: "Unit Status", value: d.unitStatus ? <StatusPill status={d.unitStatus} /> : <span className="text-[var(--color-ink-400)]">--</span> },
    {
      label: "Supervisor",
      value: d.supervisorName ?? (
        <span className="text-[var(--color-ink-400)]">{fromMirror ? "Unavailable offline" : "--"}</span>
      ),
    },
    { label: "Started", value: d.startedAt ? formatDateTime(d.startedAt) : <span className="text-[var(--color-ink-400)]">--</span> },
    { label: "Completed", value: d.completedAt ? formatDateTime(d.completedAt) : <span className="text-[var(--color-ink-400)]">--</span> },
    { label: "Created", value: formatDateTime(d.createdAt) },
    { label: "Notes", value: d.notes || <span className="text-[var(--color-ink-400)]">--</span> },
  ];
  return (
    <section className="bg-white border border-[var(--color-border-default)] rounded-[4px]">
      <header className="px-5 py-3 border-b border-[var(--color-border-default)] flex items-center justify-between">
        <h2 className="m-0 text-[13px] font-semibold text-[var(--color-ink-900)]">Job detail</h2>
        <span className="text-[11px] text-[var(--color-ink-500)] font-mono">{d.id}</span>
      </header>
      <div className="px-5 py-3 grid grid-cols-2 gap-x-12 gap-y-1">
        {rows.map((r, i) => (
          <div
            key={i}
            className="grid grid-cols-[160px_1fr] gap-3 items-baseline py-2 border-b border-dashed border-[var(--color-border-default)] last:border-b-0 text-[13px]"
          >
            <span className="text-[12px] font-medium text-[var(--color-ink-500)]">{r.label}</span>
            <span className={`text-[var(--color-ink-900)] font-medium ${r.mono ? "font-mono text-[13px] tracking-[0.02em]" : ""}`}>
              {r.value}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
