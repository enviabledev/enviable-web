"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import AssemblyStatusPill from "@/components/assembly/AssemblyStatusPill";
import FreshnessBadge from "@/components/sync/FreshnessBadge";
import StatusPill from "@/components/units/StatusPill";
import {
  listAssemblyJobs,
  listProducts,
  listUnits,
  type AssemblyJob,
  type AssemblyJobStatus,
  type UnitStatus,
} from "@/lib/api";
import { usePermissions } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { COL } from "@/lib/responsive";
import { listByType } from "@/lib/sync/mirror/store";

// The row shape the renderer consumes. Built by reconstruct(), which joins the
// job to its unit (engine number, status pivot) and the unit to its variant
// (label). Every field the renderer reads is set explicitly here with a
// fallback, so a missing mirror bucket can never crash the row (field-access
// audit: see reconstruct).
type AssemblyRow = {
  id: string;
  status: AssemblyJobStatus;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  unitId: string;
  engineNumber: string;
  unitStatus: UnitStatus | null;
  variantLabel: string | null;
  supervisorName: string | null;
};

// Minimal shapes we read from the unit and variant sources (online API rows
// and mirror bucket rows share these field names).
type UnitInfo = { id: string; engineNumber: string; status: UnitStatus; productVariantId: string };
type VariantInfo = { model?: string; colour?: string; sku: string };

type LoadState =
  | { status: "loading" }
  | { status: "ok"; rows: AssemblyRow[]; fromMirror: boolean }
  | { status: "error"; message: string };

/**
 * Reconstruct rows from jobs + a unit map + a variant map. Used identically
 * for the online fetch and the offline mirror read, so the rendered shape is
 * the same regardless of source. Field-access audit: the renderer reads id,
 * status, startedAt, completedAt, createdAt, unitId, engineNumber, unitStatus,
 * variantLabel, supervisorName, every one is assigned here with an explicit
 * fallback, never read off a possibly-absent nested object at render time.
 */
function reconstruct(
  jobs: AssemblyJob[],
  unitById: Map<string, UnitInfo>,
  variantById: Map<string, VariantInfo>,
  userById: Map<string, string>,
): AssemblyRow[] {
  return jobs.map((job) => {
    // Unit summary: prefer the API-embedded unit (online), fall back to the
    // mirror unit bucket (offline). Either gives engineNumber + status.
    const unitInfo = unitById.get(job.unitId);
    const engineNumber = job.unit?.engineNumber ?? unitInfo?.engineNumber ?? job.unitId;
    const unitStatus = job.unit?.status ?? unitInfo?.status ?? null;
    // Variant: the embedded unit summary has no productVariantId, so the
    // variant join always goes through the unit map (full unit row).
    const productVariantId = unitInfo?.productVariantId;
    const variant = productVariantId ? variantById.get(productVariantId) : undefined;
    const variantLabel = variant
      ? [variant.model, variant.colour].filter(Boolean).join(" ") || variant.sku
      : null;
    // Supervisor: embedded online; offline, resolved from the mirrored user
    // directory by supervisorId (falls back to null if the directory has not
    // synced the supervisor yet).
    const supervisorName =
      job.supervisor?.fullName ??
      (job.supervisorId ? userById.get(job.supervisorId) ?? null : null);
    return {
      id: job.id,
      status: job.status,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      createdAt: job.createdAt,
      unitId: job.unitId,
      engineNumber,
      unitStatus,
      variantLabel,
      supervisorName,
    };
  });
}

export default function AssemblyJobsListPage() {
  const { has } = usePermissions();
  const canRead = has("assembly.read");
  const canPerform = has("assembly.perform");
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    if (!canRead) return;
    const ctrl = new AbortController();

    // Phase 1: paint from the mirror immediately (the standing convention).
    // assemblyJob bucket is empty until the backend sync-pull emits it, but
    // the reconstruction still runs against the unit + productVariant buckets
    // so the machinery is exercised and lights up the moment the backend
    // ships the bucket.
    (async () => {
      try {
        const [jobRows, unitRows, variantRows, userRows] = await Promise.all([
          listByType<AssemblyJob>("assemblyJob"),
          listByType<UnitInfo>("unit"),
          listByType<{ id: string; supplierSkuCode: string; variantAttributes: { model?: string; colour?: string } }>("productVariant"),
          listByType<{ id: string; fullName: string }>("user"),
        ]);
        if (ctrl.signal.aborted) return;
        const unitById = new Map(unitRows.map((u) => [u.body.id, u.body]));
        const variantById = new Map<string, VariantInfo>(
          variantRows.map((v) => [
            v.body.id,
            {
              model: v.body.variantAttributes?.model,
              colour: v.body.variantAttributes?.colour,
              sku: v.body.supplierSkuCode,
            },
          ]),
        );
        const userById = new Map(userRows.map((u) => [u.body.id, u.body.fullName]));
        const rows = reconstruct(
          jobRows.map((r) => r.body),
          unitById,
          variantById,
          userById,
        );
        setState((prev) =>
          prev.status === "ok" && !prev.fromMirror ? prev : { status: "ok", rows, fromMirror: true },
        );
      } catch {
        // Mirror read failed (rare); let the network phase drive.
      }
    })();

    // Phase 2: revalidate against the network. On ok, replace with fresh and
    // drop the fromMirror flag. On transient failure, keep the mirror render.
    (async () => {
      const [jobsRes, unitsRes, productsRes] = await Promise.all([
        listAssemblyJobs(ctrl.signal),
        listUnits({ pageSize: 250 }, ctrl.signal),
        listProducts(ctrl.signal),
      ]);
      if (ctrl.signal.aborted) return;
      if (jobsRes.kind === "forbidden") {
        setState({ status: "error", message: "You do not have access to view assembly jobs." });
        return;
      }
      if (jobsRes.kind === "unauthorized") return;
      if (jobsRes.kind !== "ok") return; // transient or other: keep mirror render

      const unitById = new Map<string, UnitInfo>();
      if (unitsRes.kind === "ok") {
        for (const u of unitsRes.data.data) {
          unitById.set(u.id, {
            id: u.id,
            engineNumber: u.engineNumber,
            status: u.status,
            productVariantId: u.productVariant.id,
          });
        }
      }
      const variantById = new Map<string, VariantInfo>();
      if (productsRes.kind === "ok") {
        for (const p of productsRes.data) {
          for (const v of p.variants) {
            variantById.set(v.id, {
              model: v.variantAttributes.model,
              colour: v.variantAttributes.colour,
              sku: v.supplierSkuCode,
            });
          }
        }
      }
      // Online jobs carry the supervisor embedded, so no user map is needed.
      const rows = reconstruct(jobsRes.data, unitById, variantById, new Map());
      setState({ status: "ok", rows, fromMirror: false });
    })();

    return () => ctrl.abort();
  }, [canRead]);

  if (!canRead) {
    return (
      <div className="max-w-[1480px] mx-auto py-10 text-center text-[var(--color-ink-500)]">
        You do not have access to view assembly jobs (requires assembly.read).
      </div>
    );
  }

  const rows = state.status === "ok" ? state.rows : null;
  const fromMirror = state.status === "ok" && state.fromMirror;

  return (
    <div className="max-w-[1480px] mx-auto pb-10">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 sm:gap-6 pb-4 mb-4 border-b border-[var(--color-border-default)]">
        <div>
          <div className="text-[12px] text-[var(--color-ink-500)] flex items-center gap-1.5 mb-1.5">
            <span>Inventory</span>
            <span className="text-[var(--color-ink-300)]">/</span>
            <span className="text-[var(--color-ink-900)] font-medium">Assembly Jobs</span>
          </div>
          <h1 className="text-[24px] font-semibold text-[var(--color-ink-900)] m-0 tracking-[-0.01em] flex items-center gap-3">
            Assembly Jobs
            {rows && (
              <span className="font-mono text-[12px] bg-[var(--color-navy-50)] text-[var(--color-navy-800)] px-2.5 py-1 rounded-[3px] font-semibold">
                {rows.length} total
              </span>
            )}
            {fromMirror && <FreshnessBadge />}
          </h1>
          <div className="text-[13px] text-[var(--color-ink-500)] mt-1 max-w-[820px]">
            An assembly job takes a unit from knocked-down (CKD) through assembly to built-up (CBU).
            Starting a job pivots the unit to In Assembly; completing it pivots to In Warehouse CBU;
            failing it marks the unit Damaged.
          </div>
        </div>
        {canPerform && (
          <Link
            href="/inventory/assembly-jobs/new"
            className="h-8 px-3 rounded-[3px] text-[12.5px] font-medium text-white inline-flex items-center self-start"
            style={{ background: "var(--color-navy-700)" }}
          >
            + Start Assembly
          </Link>
        )}
      </header>

      <section className="bg-white border border-[var(--color-border-default)] rounded-[4px] overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr>
              <Th>Unit</Th>
              <Th className={COL.sm}>Variant</Th>
              <Th className={COL.md}>Unit Status</Th>
              <Th>Job Status</Th>
              <Th className={COL.md}>Started</Th>
              <Th className={COL.lg}>Completed</Th>
              <Th className={COL.lg}>Supervisor</Th>
            </tr>
          </thead>
          <tbody>
            {state.status === "loading" && (
              <tr>
                <td colSpan={7} className="px-3.5 py-12 text-center text-[var(--color-ink-500)]">
                  Loading assembly jobs...
                </td>
              </tr>
            )}
            {state.status === "error" && (
              <tr>
                <td colSpan={7} className="px-3.5 py-12 text-center text-[var(--color-danger-700)]">
                  {state.message}
                </td>
              </tr>
            )}
            {rows && rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3.5 py-12 text-center text-[var(--color-ink-500)]">
                  {fromMirror
                    ? "No assembly jobs are cached on this device. Jobs appear here after syncing online."
                    : "No assembly jobs yet. Start one to take a CKD unit through assembly."}
                </td>
              </tr>
            )}
            {rows &&
              rows.map((row, i) => (
                <tr
                  key={row.id}
                  className={`${i % 2 ? "bg-[#FBFBFC]" : "bg-white"} hover:bg-[var(--color-navy-50)] border-b border-[var(--color-border-default)]`}
                >
                  <Td>
                    <Link
                      href={`/inventory/assembly-jobs/${row.id}`}
                      title={row.engineNumber}
                      className="block max-w-[104px] sm:max-w-none truncate font-mono text-[12px] text-[var(--color-navy-700)] hover:underline tracking-[0.02em]"
                    >
                      {row.engineNumber}
                    </Link>
                  </Td>
                  <Td className={COL.sm}>
                    {row.variantLabel ? (
                      <span className="text-[12.5px] text-[var(--color-ink-900)]">{row.variantLabel}</span>
                    ) : (
                      <span className="text-[var(--color-ink-400)]">--</span>
                    )}
                  </Td>
                  <Td className={COL.md}>
                    {row.unitStatus ? (
                      <StatusPill status={row.unitStatus} />
                    ) : (
                      <span className="text-[var(--color-ink-400)]">--</span>
                    )}
                  </Td>
                  <Td>
                    <AssemblyStatusPill status={row.status} />
                  </Td>
                  <Td className={COL.md}>
                    {row.startedAt ? (
                      <span className="text-[12px] text-[var(--color-ink-700)]">{formatDateTime(row.startedAt)}</span>
                    ) : (
                      <span className="text-[var(--color-ink-400)]">--</span>
                    )}
                  </Td>
                  <Td className={COL.lg}>
                    {row.completedAt ? (
                      <span className="text-[12px] text-[var(--color-ink-700)]">{formatDateTime(row.completedAt)}</span>
                    ) : (
                      <span className="text-[var(--color-ink-400)]">--</span>
                    )}
                  </Td>
                  <Td className={COL.lg}>
                    {row.supervisorName ? (
                      <span className="text-[12px] text-[var(--color-ink-700)]">{row.supervisorName}</span>
                    ) : (
                      <span className="text-[var(--color-ink-400)]">--</span>
                    )}
                  </Td>
                </tr>
              ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={`font-medium text-[11px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] px-2 sm:px-3.5 py-2.5 border-b border-[var(--color-border-default)] bg-[var(--color-ink-100)] whitespace-nowrap text-left ${className}`}>
      {children}
    </th>
  );
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-2 sm:px-3.5 py-2.5 align-middle text-[var(--color-ink-900)] whitespace-nowrap ${className}`}>{children}</td>;
}
