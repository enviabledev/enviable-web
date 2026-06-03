"use client";

/**
 * Revenue report at /reports/revenue. Gated 'report.revenue'.
 *
 * Mirror-first paint via recomputeRevenueFromMirror, then revalidates
 * from /api/reports/revenue. Same pattern as the stocks report
 * (prompt 12): recompute matches the backend's logic faithfully so
 * "less accurate offline" means stale-but-correct, never computed-
 * differently. ComputedDisclosure surfaces the freshness + accuracy
 * warning whenever the visible figures came from the offline recompute.
 *
 * Cost-gating: the `margin` block and per-variant landedCost / margin
 * are absent for users without costdata.view. The backend never
 * computes them; the mirror never has Unit.landedCost for non-cost
 * users (stripped server-side); the recompute checks `anyLandedCostSeen`
 * and omits the cost outputs if no inputs are present. Three layers
 * of consistent absence; the renderer reads `?.` everywhere on cost
 * fields and there is no "₦0" or "—" placeholder that would lie about
 * the absence.
 *
 * Permission gating: if the user lacks report.revenue, render a clean
 * denial card. This matches the established treatment from earlier
 * permission-gated screens (proforma invoices detail, etc.).
 */
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { RevenueIcon } from "@/components/icons";
import ComputedDisclosure from "@/components/sync/ComputedDisclosure";
import {
  getRevenueReport,
  type RevenueReport,
} from "@/lib/api";
import { isTransientFailure } from "@/lib/api/client";
import { usePermissions } from "@/lib/auth";
import { formatDateShort, formatNGN } from "@/lib/format";
import { recomputeRevenueFromMirror } from "@/lib/sync/mirror/recompute/revenue";

function defaultFromIso(): string {
  // First instant of the current calendar month, same default the backend
  // uses if `from` is omitted on the request.
  const now = new Date();
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return first.toISOString();
}

function defaultToIso(): string {
  // First instant of next month. Exclusive bound.
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return next.toISOString();
}

function isoToDateInput(iso: string): string {
  return iso.slice(0, 10);
}

function dateInputToIso(dateStr: string, endOfDay = false): string {
  if (!dateStr) return "";
  // Treat the date input as a UTC date. The backend filter is inclusive-
  // from / exclusive-to, so a user picking "from = 2026-05-01, to =
  // 2026-05-31" should expand to [2026-05-01T00:00:00Z, 2026-06-01T00:00:00Z)
  // for the report. Compute the exclusive-to as start-of-next-day.
  if (!endOfDay) return new Date(`${dateStr}T00:00:00.000Z`).toISOString();
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

function readParams(sp: URLSearchParams) {
  const from = sp.get("from") ?? "";
  const to = sp.get("to") ?? "";
  return { from, to };
}

function buildHref(p: Partial<ReturnType<typeof readParams>>): string {
  const sp = new URLSearchParams();
  if (p.from) sp.set("from", p.from);
  if (p.to) sp.set("to", p.to);
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

export default function RevenueReportPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const { has } = usePermissions();
  const canRead = has("report.revenue");
  const showCost = has("costdata.view");

  const params = useMemo(() => readParams(new URLSearchParams(sp.toString())), [sp]);
  const fromIso = params.from || defaultFromIso();
  const toIso = params.to || defaultToIso();

  const [report, setReport] = useState<RevenueReport | null>(null);
  const [fromMirror, setFromMirror] = useState(false);
  const [errMsg, setErrMsg] = useState("");

  const navigate = useCallback(
    (next: Partial<ReturnType<typeof readParams>>) => {
      router.replace(`/reports/revenue${buildHref({ ...params, ...next })}`);
    },
    [params, router],
  );

  useEffect(() => {
    if (!canRead) return;
    const ctrl = new AbortController();
    setErrMsg("");

    // Phase 1: paint from the mirror recompute. Same recognition basis
    // (ReleaseAuthorisation.issuedAt), same arithmetic (scaled bigint),
    // same partitions; the fidelity guarantee.
    let mirrorPainted = false;
    (async () => {
      try {
        const r = await recomputeRevenueFromMirror({ from: fromIso, to: toIso });
        if (ctrl.signal.aborted) return;
        mirrorPainted = true;
        setReport(r);
        setFromMirror(true);
      } catch {
        // network drives
      }
    })();

    // Phase 2: revalidate.
    getRevenueReport({ from: fromIso, to: toIso }, ctrl.signal).then((r) => {
      if (ctrl.signal.aborted) return;
      if (r.kind === "ok") {
        setReport(r.data);
        setFromMirror(false);
        setErrMsg("");
      } else if (r.kind === "unauthorized") {
        router.replace("/login");
      } else if (r.kind === "forbidden") {
        setErrMsg("You do not have access to the revenue report (requires report.revenue).");
      } else if (isTransientFailure(r)) {
        // Keep the mirror-painted figure; the disclosure already warns
        // about freshness. If the mirror also failed, leave the figure
        // null and the page renders the loading state.
        if (!mirrorPainted) setErrMsg("");
      } else if ("message" in r) {
        setErrMsg(typeof r.message === "string" ? r.message : r.message.join("; "));
      }
    });

    return () => ctrl.abort();
  }, [canRead, fromIso, toIso, router]);

  if (!canRead) {
    return (
      <div className="max-w-[640px] mx-auto py-12">
        <div className="bg-white border border-[var(--color-border-default)] rounded-[4px] px-6 py-8 text-center">
          <h1 className="text-[18px] font-semibold text-[var(--color-ink-900)] m-0 mb-2">
            Access denied
          </h1>
          <p className="text-[13px] text-[var(--color-ink-700)] m-0">
            You do not have access to the revenue report. This screen requires the
            <span className="font-mono mx-1">report.revenue</span> permission, which is held by
            roles that need cross-customer revenue oversight (Executive Director, General Manager,
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

  return (
    <div className="max-w-[1480px] mx-auto pb-10">
      <header className="flex items-end justify-between gap-6 pb-4 mb-4 border-b border-[var(--color-border-default)]">
        <div>
          <div className="text-[12px] text-[var(--color-ink-500)] mb-1.5">Reports / Revenue</div>
          <h1 className="text-[22px] font-semibold text-[var(--color-ink-900)] m-0 tracking-[-0.01em] flex items-center gap-2">
            <RevenueIcon className="w-[18px] h-[18px] text-[var(--color-ink-500)]" />
            Revenue
          </h1>
          <div className="text-[12.5px] text-[var(--color-ink-500)] mt-1 max-w-[860px]">
            Recognized at release authorisation (when units are released to the customer). Sales
            orders that reached RELEASE_AUTHORISED in the window are included regardless of current
            status; refunded orders are NOT netted out.
          </div>
        </div>
      </header>

      <form
        onSubmit={(e) => {
          e.preventDefault();
        }}
        className="bg-white border border-[var(--color-border-default)] rounded-[4px] px-3 py-2.5 mb-3 flex items-end gap-3 flex-wrap"
      >
        <Field label="From">
          <input
            type="date"
            value={isoToDateInput(fromIso)}
            onChange={(e) => navigate({ from: dateInputToIso(e.target.value, false) })}
            data-testid="filter-from"
            className="h-[28px] px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[12.5px] text-[var(--color-ink-900)]"
          />
        </Field>
        <Field label="To (inclusive)">
          <input
            type="date"
            value={isoToDateInput(toIso)}
            onChange={(e) => navigate({ to: dateInputToIso(e.target.value, true) })}
            data-testid="filter-to"
            className="h-[28px] px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[12.5px] text-[var(--color-ink-900)]"
          />
        </Field>
        <span className="text-[11px] text-[var(--color-ink-500)] leading-[1.5] max-w-[340px]">
          Window keys on ReleaseAuthorisation.issuedAt. To-bound is the start of the day after the
          selected date (exclusive), so picking the same from + to date covers one full day.
        </span>
      </form>

      {!report ? (
        <div className="py-10 text-center text-[var(--color-ink-500)]">Loading revenue report...</div>
      ) : (
        <>
          {fromMirror && <ComputedDisclosure className="mb-4" />}
          <KpiCards report={report} showCost={showCost} />
          <Breakdowns report={report} showCost={showCost} />
        </>
      )}
    </div>
  );
}

function KpiCards({ report, showCost }: { report: RevenueReport; showCost: boolean }) {
  const kpis: { label: string; value: string; sub?: string; testid?: string }[] = [
    {
      label: "Total revenue (VAT-inclusive)",
      value: formatNGN(report.totalRevenue),
      sub: `VAT collected: ${formatNGN(report.vatCollected)}`,
      testid: "kpi-totalRevenue",
    },
    {
      label: "Units released",
      value: `${report.unitsSold.total}`,
      sub: `${report.unitsSold.ckd} CKD · ${report.unitsSold.cbu} CBU`,
      testid: "kpi-units",
    },
  ];
  if (showCost && report.margin) {
    kpis.push({
      label: "Net revenue (VAT-exclusive)",
      value: formatNGN(report.margin.netRevenue),
      sub: `Margin: ${formatNGN(report.margin.margin)} on ${formatNGN(report.margin.totalLandedCost)} cost basis`,
      testid: "kpi-margin",
    });
  }
  return (
    <section className="grid grid-cols-3 gap-3 mb-4">
      {kpis.map((k) => (
        <div
          key={k.label}
          data-testid={k.testid}
          className="bg-white border border-[var(--color-border-default)] rounded-[4px] px-4 py-3.5"
        >
          <div className="text-[10.5px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] font-medium">
            {k.label}
          </div>
          <div className="text-[22px] font-semibold text-[var(--color-ink-900)] tracking-[-0.01em] font-mono mt-1">
            {k.value}
          </div>
          {k.sub && (
            <div className="text-[11.5px] text-[var(--color-ink-500)] mt-1">{k.sub}</div>
          )}
        </div>
      ))}
    </section>
  );
}

function Breakdowns({ report, showCost }: { report: RevenueReport; showCost: boolean }) {
  return (
    <div className="grid grid-cols-[1fr_1fr] gap-3 mb-3">
      <VariantTable rows={report.revenueByVariant} showCost={showCost} />
      <CustomerTable rows={report.revenueByCustomer} />
      <TrendTable rows={report.trend} />
    </div>
  );
}

function VariantTable({
  rows,
  showCost,
}: {
  rows: RevenueReport["revenueByVariant"];
  showCost: boolean;
}) {
  return (
    <section className="bg-white border border-[var(--color-border-default)] rounded-[4px]">
      <header className="px-4 py-2.5 border-b border-[var(--color-border-default)]">
        <h2 className="m-0 text-[13px] font-semibold text-[var(--color-ink-900)]">By variant</h2>
      </header>
      {rows.length === 0 ? (
        <Empty />
      ) : (
        <table className="w-full text-[13px]">
          <thead>
            <tr>
              <Th>SKU</Th>
              <Th align="right">Units</Th>
              <Th align="right">Revenue (net)</Th>
              {showCost && <Th align="right">Cost</Th>}
              {showCost && <Th align="right">Margin</Th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.productVariantId} className={`${i % 2 ? "bg-[#FBFBFC]" : "bg-white"} border-b border-[var(--color-border-default)] last:border-b-0`}>
                <Td mono>{r.sku}</Td>
                <Td align="right" mono>{r.unitsSold}</Td>
                <Td align="right" mono>{formatNGN(r.revenue)}</Td>
                {showCost && (
                  <Td align="right" mono>
                    {r.landedCost != null ? formatNGN(r.landedCost) : <span className="text-[var(--color-ink-400)]">--</span>}
                  </Td>
                )}
                {showCost && (
                  <Td align="right" mono>
                    {r.margin != null ? formatNGN(r.margin) : <span className="text-[var(--color-ink-400)]">--</span>}
                  </Td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function CustomerTable({ rows }: { rows: RevenueReport["revenueByCustomer"] }) {
  return (
    <section className="bg-white border border-[var(--color-border-default)] rounded-[4px]">
      <header className="px-4 py-2.5 border-b border-[var(--color-border-default)]">
        <h2 className="m-0 text-[13px] font-semibold text-[var(--color-ink-900)]">By customer (top)</h2>
      </header>
      {rows.length === 0 ? (
        <Empty />
      ) : (
        <table className="w-full text-[13px]">
          <thead>
            <tr>
              <Th>Customer</Th>
              <Th align="right">Orders</Th>
              <Th align="right">Revenue (gross)</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.customerId} className={`${i % 2 ? "bg-[#FBFBFC]" : "bg-white"} border-b border-[var(--color-border-default)] last:border-b-0`}>
                <Td>{r.name}</Td>
                <Td align="right" mono>{r.orders}</Td>
                <Td align="right" mono>{formatNGN(r.revenue)}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function TrendTable({ rows }: { rows: RevenueReport["trend"] }) {
  return (
    <section className="bg-white border border-[var(--color-border-default)] rounded-[4px] col-span-2">
      <header className="px-4 py-2.5 border-b border-[var(--color-border-default)]">
        <h2 className="m-0 text-[13px] font-semibold text-[var(--color-ink-900)]">Daily trend</h2>
      </header>
      {rows.length === 0 ? (
        <Empty />
      ) : (
        <table className="w-full text-[13px]">
          <thead>
            <tr>
              <Th>Date</Th>
              <Th align="right">Revenue (gross)</Th>
              <Th align="right">Units</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.date} className={`${i % 2 ? "bg-[#FBFBFC]" : "bg-white"} border-b border-[var(--color-border-default)] last:border-b-0`}>
                <Td>{formatDateShort(r.date)}</Td>
                <Td align="right" mono>{formatNGN(r.revenue)}</Td>
                <Td align="right" mono>{r.unitsSold}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function Empty() {
  return (
    <div className="px-4 py-8 text-center text-[12.5px] text-[var(--color-ink-500)]">
      No data in the selected window.
    </div>
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
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      className={`text-${align} font-medium text-[10.5px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] px-3.5 py-2.5 border-b border-[var(--color-border-default)] bg-[var(--color-ink-100)]`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "left",
  mono = false,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  mono?: boolean;
}) {
  return (
    <td
      className={`px-3.5 py-2 text-[12.5px] text-[var(--color-ink-900)] whitespace-nowrap text-${align} ${
        mono ? "font-mono text-[12px] tracking-[0.02em]" : ""
      }`}
    >
      {children}
    </td>
  );
}
