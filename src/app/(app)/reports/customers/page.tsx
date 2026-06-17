"use client";

/**
 * Customers report at /reports/customers. Gated 'report.customers'.
 *
 * Mirror-first paint via recomputeCustomersFromMirror, then revalidates
 * from /api/reports/customers. Same template as the revenue report:
 * faithful client-side recompute, ComputedDisclosure offline, permission-
 * denied treatment for users lacking the gate.
 *
 * No cost gating on this report. Outstanding balance is a sales/AR figure
 * (NOT cost data), so cost-permitted and non-cost users see identical
 * figures. This is verified at the visible-outcome level rather than
 * assumed; the fact that the report has no cost-blind variant is a
 * deliberate backend design.
 *
 * The customer base stays visible regardless of in-range activity: a
 * customer with no orders in the window appears with zeros, not absent.
 * The tier and status filters narrow the customer set; the date range
 * narrows the per-customer metrics within each visible row.
 */
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { CustomersIcon } from "@/components/icons";
import ComputedDisclosure from "@/components/sync/ComputedDisclosure";
import {
  getCustomersReport,
  type CustomersReportResponse,
} from "@/lib/api";
import { isTransientFailure } from "@/lib/api/client";
import { usePermissions } from "@/lib/auth";
import { formatDateShort, formatNGN } from "@/lib/format";
import { COL, FILTER_CONTROL, FILTER_FORM } from "@/lib/responsive";
import { recomputeCustomersFromMirror } from "@/lib/sync/mirror/recompute/customers";
import { listByType } from "@/lib/sync/mirror/store";

const PAGE_SIZES = [25, 50, 100, 250];
const STATUSES = ["ACTIVE", "INACTIVE", "BLOCKED"];

type MirroredTier = { id: string; name: string };

type Params = {
  from: string;
  to: string;
  tierId: string;
  status: string;
  page: number;
  pageSize: number;
};

function readParams(sp: URLSearchParams): Params {
  return {
    from: sp.get("from") ?? "",
    to: sp.get("to") ?? "",
    tierId: sp.get("tierId") ?? "",
    status: sp.get("status") ?? "",
    page: Math.max(1, Number(sp.get("page") ?? "1") || 1),
    pageSize: PAGE_SIZES.includes(Number(sp.get("pageSize")))
      ? Number(sp.get("pageSize"))
      : 50,
  };
}

function buildHref(p: Partial<Params>): string {
  const sp = new URLSearchParams();
  if (p.from) sp.set("from", p.from);
  if (p.to) sp.set("to", p.to);
  if (p.tierId) sp.set("tierId", p.tierId);
  if (p.status) sp.set("status", p.status);
  if (p.page && p.page > 1) sp.set("page", String(p.page));
  if (p.pageSize && p.pageSize !== 50) sp.set("pageSize", String(p.pageSize));
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

function isoToDateInput(iso: string): string {
  return iso ? iso.slice(0, 10) : "";
}

function dateInputToIso(dateStr: string, endOfDay = false): string {
  if (!dateStr) return "";
  if (!endOfDay) return new Date(`${dateStr}T00:00:00.000Z`).toISOString();
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

export default function CustomersReportPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const { has } = usePermissions();
  const canRead = has("report.customers");

  const params = useMemo(() => readParams(new URLSearchParams(sp.toString())), [sp]);

  const [report, setReport] = useState<CustomersReportResponse | null>(null);
  const [fromMirror, setFromMirror] = useState(false);
  const [errMsg, setErrMsg] = useState("");
  const [tiers, setTiers] = useState<MirroredTier[]>([]);

  const navigate = useCallback(
    (next: Partial<Params>) => {
      router.replace(`/reports/customers${buildHref({ ...params, ...next })}`);
    },
    [params, router],
  );

  // Load tiers from the mirror so the filter dropdown is populated offline.
  useEffect(() => {
    if (!canRead) return;
    let cancelled = false;
    listByType<MirroredTier>("customerTier")
      .then((rows) => {
        if (cancelled) return;
        setTiers(rows.map((r) => r.body).sort((a, b) => a.name.localeCompare(b.name)));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [canRead]);

  useEffect(() => {
    if (!canRead) return;
    const ctrl = new AbortController();
    setErrMsg("");

    const opts = {
      from: params.from || undefined,
      to: params.to || undefined,
      tierId: params.tierId || undefined,
      status: params.status || undefined,
      page: params.page,
      pageSize: params.pageSize,
    };

    // Phase 1: paint from the mirror recompute.
    let mirrorPainted = false;
    (async () => {
      try {
        const r = await recomputeCustomersFromMirror(opts);
        if (ctrl.signal.aborted) return;
        mirrorPainted = true;
        setReport(r);
        setFromMirror(true);
      } catch {
        // network drives
      }
    })();

    // Phase 2: revalidate.
    getCustomersReport(opts, ctrl.signal).then((r) => {
      if (ctrl.signal.aborted) return;
      if (r.kind === "ok") {
        setReport(r.data);
        setFromMirror(false);
        setErrMsg("");
      } else if (r.kind === "unauthorized") {
        router.replace("/login");
      } else if (r.kind === "forbidden") {
        setErrMsg("You do not have access to the customers report (requires report.customers).");
      } else if (isTransientFailure(r)) {
        if (!mirrorPainted) setErrMsg("");
      } else if ("message" in r) {
        setErrMsg(typeof r.message === "string" ? r.message : r.message.join("; "));
      }
    });

    return () => ctrl.abort();
  }, [canRead, params.from, params.to, params.tierId, params.status, params.page, params.pageSize, router]);

  if (!canRead) {
    return (
      <div className="max-w-[640px] mx-auto py-12">
        <div className="bg-white border border-[var(--color-border-default)] rounded-[4px] px-6 py-8 text-center">
          <h1 className="text-[18px] font-semibold text-[var(--color-ink-900)] m-0 mb-2">
            Access denied
          </h1>
          <p className="text-[13px] text-[var(--color-ink-700)] m-0">
            You do not have access to the customers report. This screen requires the
            <span className="font-mono mx-1">report.customers</span> permission, which is held by
            roles that need cross-customer sales oversight (Executive Director, General Manager,
            Sales Manager, Internal Auditor).
          </p>
        </div>
      </div>
    );
  }

  if (errMsg) {
    return (
      <div className="max-w-[820px] mx-auto py-10">
        <div className="px-3.5 py-2.5 rounded-[3px] bg-[var(--color-danger-100)] text-[var(--color-danger-700)] text-[12.5px]">
          {errMsg}
        </div>
      </div>
    );
  }

  const rows = report?.data ?? [];
  const totalCustomers = report?.total ?? 0;
  const aggTotalOrderValue = rows.reduce((acc, r) => acc + Number(r.totalOrderValue || "0"), 0);
  const aggOutstanding = rows.reduce((acc, r) => acc + Number(r.outstandingBalance || "0"), 0);
  const topRow = rows.length > 0 ? rows[0] : null;

  return (
    <div className="max-w-[1480px] mx-auto pb-10">
      <header className="flex items-end justify-between gap-6 pb-4 mb-4 border-b border-[var(--color-border-default)]">
        <div>
          <div className="text-[12px] text-[var(--color-ink-500)] mb-1.5">Reports / Customers</div>
          <h1 className="text-[22px] font-semibold text-[var(--color-ink-900)] m-0 tracking-[-0.01em] flex items-center gap-2">
            <CustomersIcon className="w-[18px] h-[18px] text-[var(--color-ink-500)]" />
            Customers
          </h1>
          <div className="text-[12.5px] text-[var(--color-ink-500)] mt-1 max-w-[860px]">
            Per-customer sales and outstanding receivables. The customer base stays visible
            regardless of in-range activity; tier and status filters narrow the customer set, while
            the date range narrows order metrics within each visible row.
          </div>
        </div>
      </header>

      <form
        onSubmit={(e) => e.preventDefault()}
        className={`bg-white border border-[var(--color-border-default)] rounded-[4px] px-3 py-2.5 mb-3 ${FILTER_FORM}`}
      >
        <Field label="From">
          <input
            type="date"
            value={isoToDateInput(params.from)}
            onChange={(e) => navigate({ from: dateInputToIso(e.target.value, false), page: 1 })}
            data-testid="filter-from"
            className={`h-[28px] px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[12.5px] text-[var(--color-ink-900)] ${FILTER_CONTROL}`}
          />
        </Field>
        <Field label="To (inclusive)">
          <input
            type="date"
            value={isoToDateInput(params.to)}
            onChange={(e) => navigate({ to: dateInputToIso(e.target.value, true), page: 1 })}
            data-testid="filter-to"
            className={`h-[28px] px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[12.5px] text-[var(--color-ink-900)] ${FILTER_CONTROL}`}
          />
        </Field>
        <Field label="Tier">
          <select
            value={params.tierId}
            onChange={(e) => navigate({ tierId: e.target.value, page: 1 })}
            data-testid="filter-tier"
            className={`h-[28px] px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[12.5px] text-[var(--color-ink-900)] sm:min-w-[160px] ${FILTER_CONTROL}`}
          >
            <option value="">All tiers</option>
            {tiers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Status">
          <select
            value={params.status}
            onChange={(e) => navigate({ status: e.target.value, page: 1 })}
            data-testid="filter-status"
            className={`h-[28px] px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[12.5px] text-[var(--color-ink-900)] sm:min-w-[140px] ${FILTER_CONTROL}`}
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Page size">
          <select
            value={params.pageSize}
            onChange={(e) => navigate({ pageSize: Number(e.target.value), page: 1 })}
            className={`h-[28px] px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[12.5px] text-[var(--color-ink-900)] ${FILTER_CONTROL}`}
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </Field>
        <span className="text-[11px] text-[var(--color-ink-500)] leading-[1.5] sm:max-w-[300px]">
          Date range scopes order metrics (createdAt). To-bound is exclusive (start of day after).
        </span>
      </form>

      {!report ? (
        <div className="py-10 text-center text-[var(--color-ink-500)]">
          Loading customers report...
        </div>
      ) : (
        <>
          {fromMirror && <ComputedDisclosure className="mb-4" />}
          <KpiCards
            totalCustomers={totalCustomers}
            aggTotalOrderValue={aggTotalOrderValue}
            aggOutstanding={aggOutstanding}
            topRow={topRow}
          />
          <CustomersTable
            rows={rows}
            total={totalCustomers}
            page={params.page}
            pageSize={params.pageSize}
            onPage={(p) => navigate({ page: p })}
          />
        </>
      )}
    </div>
  );
}

function KpiCards({
  totalCustomers,
  aggTotalOrderValue,
  aggOutstanding,
  topRow,
}: {
  totalCustomers: number;
  aggTotalOrderValue: number;
  aggOutstanding: number;
  topRow: { name: string; totalOrderValue: string } | null;
}) {
  return (
    <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
      <KpiCard
        label="Customers in scope"
        value={`${totalCustomers}`}
        sub="Filtered customer set"
        testid="kpi-customers"
      />
      <KpiCard
        label="Total order value (page)"
        value={formatNGN(String(aggTotalOrderValue))}
        sub="Released orders only"
        testid="kpi-totalOrderValue"
      />
      <KpiCard
        label="Outstanding balance (page)"
        value={formatNGN(String(aggOutstanding))}
        sub="Awaiting or partial payment"
        testid="kpi-outstanding"
      />
      <KpiCard
        label="Top customer"
        value={topRow ? topRow.name : "--"}
        sub={topRow ? formatNGN(topRow.totalOrderValue) : "No data"}
        testid="kpi-topCustomer"
      />
    </section>
  );
}

function KpiCard({
  label,
  value,
  sub,
  testid,
}: {
  label: string;
  value: string;
  sub?: string;
  testid?: string;
}) {
  return (
    <div
      data-testid={testid}
      className="bg-white border border-[var(--color-border-default)] rounded-[4px] px-4 py-3.5"
    >
      <div className="text-[10.5px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] font-medium">
        {label}
      </div>
      <div className="text-[22px] font-semibold text-[var(--color-ink-900)] tracking-[-0.01em] font-mono mt-1 truncate">
        {value}
      </div>
      {sub && <div className="text-[11.5px] text-[var(--color-ink-500)] mt-1">{sub}</div>}
    </div>
  );
}

function CustomersTable({
  rows,
  total,
  page,
  pageSize,
  onPage,
}: {
  rows: import("@/lib/api").CustomersReportRow[];
  total: number;
  page: number;
  pageSize: number;
  onPage: (p: number) => void;
}) {
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  return (
    <section className="bg-white border border-[var(--color-border-default)] rounded-[4px]">
      <header className="px-4 py-2.5 border-b border-[var(--color-border-default)] flex items-center justify-between">
        <h2 className="m-0 text-[13px] font-semibold text-[var(--color-ink-900)]">
          Customers (sorted by total order value)
        </h2>
        <div className="text-[11.5px] text-[var(--color-ink-500)] font-mono">
          Page {page} of {lastPage} · {total} customer{total === 1 ? "" : "s"}
        </div>
      </header>
      {rows.length === 0 ? (
        <div className="px-4 py-8 text-center text-[12.5px] text-[var(--color-ink-500)]">
          No customers match the current filters.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]" data-testid="customers-table">
            <thead>
              <tr>
                <Th>Customer</Th>
                <Th className={COL.sm}>Type</Th>
                <Th className={COL.md}>Tier</Th>
                <Th>Status</Th>
                <Th align="right" className={COL.sm}>Orders</Th>
                <Th align="right">Total order value</Th>
                <Th className={COL.md}>Last order</Th>
                <Th align="right" className={COL.sm}>Outstanding</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={r.customerId}
                  data-testid={`customer-row-${r.customerId}`}
                  className={`${i % 2 ? "bg-[#FBFBFC]" : "bg-white"} border-b border-[var(--color-border-default)] last:border-b-0`}
                >
                  <Td>
                    <span className="block max-w-[160px] sm:max-w-none truncate" title={r.name}>
                      {r.name}
                    </span>
                  </Td>
                  <Td className={COL.sm}>{r.type}</Td>
                  <Td className={COL.md}>{r.tier?.name ?? "--"}</Td>
                  <Td>
                    <StatusPill status={r.status} />
                  </Td>
                  <Td align="right" mono className={COL.sm}>
                    {r.totalOrders}
                  </Td>
                  <Td align="right" mono>
                    {formatNGN(r.totalOrderValue)}
                  </Td>
                  <Td className={COL.md}>{r.lastOrderDate ? formatDateShort(r.lastOrderDate) : "--"}</Td>
                  <Td align="right" mono className={COL.sm}>
                    {Number(r.outstandingBalance) > 0 ? (
                      <span className="text-[var(--color-warning-700)]">
                        {formatNGN(r.outstandingBalance)}
                      </span>
                    ) : (
                      formatNGN(r.outstandingBalance)
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {lastPage > 1 && (
        <footer className="px-4 py-2.5 border-t border-[var(--color-border-default)] flex items-center justify-end gap-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => onPage(page - 1)}
            className="h-[28px] px-3 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[12.5px] text-[var(--color-ink-900)] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Previous
          </button>
          <button
            type="button"
            disabled={page >= lastPage}
            onClick={() => onPage(page + 1)}
            className="h-[28px] px-3 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[12.5px] text-[var(--color-ink-900)] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Next
          </button>
        </footer>
      )}
    </section>
  );
}

// Fixed mobile shorthand so a long status never pushes the primary metric out
// of view at 375; full label returns at sm+ (two spans, per the standard).
const SHORT_STATUS: Record<string, string> = {
  ACTIVE: "Act.",
  INACTIVE: "Inact.",
  BLOCKED: "Block.",
};

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "ACTIVE"
      ? "bg-[var(--color-success-100)] text-[var(--color-success-700)]"
      : status === "BLOCKED"
        ? "bg-[var(--color-danger-100)] text-[var(--color-danger-700)]"
        : "bg-[var(--color-ink-100)] text-[var(--color-ink-700)]";
  const short = SHORT_STATUS[status] ?? status;
  return (
    <span
      title={status}
      className={`inline-flex items-center px-2 py-[2px] rounded-[2px] text-[11px] uppercase tracking-[0.04em] font-medium ${tone}`}
    >
      <span className="sm:hidden">{short}</span>
      <span className="hidden sm:inline">{status}</span>
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10.5px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] font-medium">
        {label}
      </span>
      {children}
    </label>
  );
}

function Th({
  children,
  align = "left",
  className = "",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <th
      className={`${align === "right" ? "text-right" : "text-left"} font-medium text-[10.5px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] px-2 sm:px-3.5 py-2.5 border-b border-[var(--color-border-default)] bg-[var(--color-ink-100)] ${className}`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "left",
  mono = false,
  className = "",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  mono?: boolean;
  className?: string;
}) {
  return (
    <td
      className={`px-2 sm:px-3.5 py-2 text-[12.5px] text-[var(--color-ink-900)] whitespace-nowrap ${align === "right" ? "text-right" : "text-left"} ${
        mono ? "font-mono text-[12px] tracking-[0.02em]" : ""
      } ${className}`}
    >
      {children}
    </td>
  );
}
