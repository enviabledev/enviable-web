"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import ComputedDisclosure from "@/components/sync/ComputedDisclosure";
import OfflineNotice from "@/components/sync/OfflineNotice";
import { getStocksReport, type ApiResult, type StocksReport } from "@/lib/api";
import {
  formatCount,
  formatDateTime,
  formatNGN,
  formatNGNCompact,
} from "@/lib/format";
import { COL } from "@/lib/responsive";
import { recomputeStocksFromMirror } from "@/lib/sync/mirror/recompute/stocks";

type LoadState =
  | { status: "loading" }
  | { status: "ok"; data: StocksReport; fromMirror?: boolean }
  | { status: "forbidden" }
  | { status: "offline" }
  | { status: "error"; message: string };

export default function StocksReportPage() {
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ status: "loading" });

  // Mirror-first, revalidate-with-network. Same pattern as the dashboard:
  // paint from the mirror immediately so the report is never gated on the
  // network attempt's .then completing, then upgrade to fresh in the
  // background. On a partition mismatch the mirror is honestly broken and
  // we surface that as an error (the recompute would lie if we showed the
  // figure); on any other mirror failure we leave state at loading and let
  // the network result drive (the only outcome there is a successful
  // network, since the mirror would have to be working for the offline
  // case to make sense).
  useEffect(() => {
    const ctrl = new AbortController();

    recomputeStocksFromMirror({})
      .then((recomputed) => {
        if (ctrl.signal.aborted) return;
        setState((prev) => {
          if (prev.status === "ok" && !prev.fromMirror) return prev;
          return { status: "ok", data: recomputed, fromMirror: true };
        });
      })
      .catch((err) => {
        if (ctrl.signal.aborted) return;
        if (err instanceof Error && err.message.includes("partition mismatch")) {
          setState({ status: "error", message: err.message });
        }
      });

    getStocksReport({}, ctrl.signal).then((r: ApiResult<StocksReport>) => {
      if (ctrl.signal.aborted) return;
      if (r.kind === "ok") setState({ status: "ok", data: r.data });
      else if (r.kind === "unauthorized") router.replace("/login");
      else if (r.kind === "forbidden") setState({ status: "forbidden" });
      else if (r.kind === "network_error" || r.kind === "server_error") {
        // Keep whatever the mirror revalidation produced. If the mirror
        // came back empty/successful, the report is showing the cached
        // figures with the disclosure banner; if the mirror is still
        // pending, the loading state stays until it resolves. Either way
        // a transient network failure does not regress the screen.
        setState((prev) =>
          prev.status === "loading" ? { status: "offline" } : prev,
        );
      } else setState({ status: "error", message: "message" in r ? String(r.message) : "Error" });
    });
    return () => ctrl.abort();
  }, [router]);

  if (state.status === "loading") {
    return (
      <div className="max-w-[1480px] mx-auto py-10 text-center text-[var(--color-ink-500)]">
        Loading stocks report...
      </div>
    );
  }
  if (state.status === "forbidden") {
    return (
      <div className="max-w-[1480px] mx-auto py-10 text-center text-[var(--color-ink-500)]">
        You do not have access to view the stocks report.
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="max-w-[1480px] mx-auto py-10 text-center text-[var(--color-danger-700)]">
        {state.message}
      </div>
    );
  }
  if (state.status === "offline") {
    return (
      <div className="max-w-[820px] mx-auto py-10">
        <OfflineNotice body="The stocks report needs cached unit and variant data to recompute offline. Come back online or wait for the mirror to populate, and the report will compute from cached data with a freshness disclosure." />
      </div>
    );
  }

  const r = state.data;
  const isFromMirror = state.fromMirror === true;
  const showSpareCosts = r.spareParts.totalLandedCostValue !== undefined;

  // Per-variant totals for the tfoot row.
  const totals = r.variants.reduce(
    (acc, v) => ({
      ckd: acc.ckd + v.counts.ckd,
      inAssembly: acc.inAssembly + v.counts.inAssembly,
      cbu: acc.cbu + v.counts.cbu,
      sold: acc.sold + v.counts.sold,
      other: acc.other + v.counts.other,
      total: acc.total + v.counts.total,
    }),
    { ckd: 0, inAssembly: 0, cbu: 0, sold: 0, other: 0, total: 0 },
  );

  // CKD/CBU split for the Total Units footer breakdown.
  const totalsInStock = {
    ckd: r.variants.reduce((s, v) => s + v.counts.ckd, 0),
    cbu: r.variants.reduce((s, v) => s + v.counts.cbu, 0),
    inAssembly: r.variants.reduce((s, v) => s + v.counts.inAssembly, 0),
  };

  const spareTotalQty = r.spareParts.items.reduce((s, it) => s + it.quantityOnHand, 0);

  return (
    <div className="max-w-[1480px] mx-auto pb-10">
      <header className="flex items-end justify-between gap-6 pb-4 mb-5 border-b border-[var(--color-border-default)]">
        <div>
          <div className="text-[12px] text-[var(--color-ink-500)] flex items-center gap-1.5 mb-1.5">
            <span>Reports</span>
            <span className="text-[var(--color-ink-300)]">/</span>
            <span className="text-[var(--color-ink-900)] font-medium">Stocks</span>
          </div>
          <h1 className="text-[24px] font-semibold text-[var(--color-ink-900)] m-0 tracking-[-0.01em]">
            Stocks Report
          </h1>
          <div className="text-[13px] text-[var(--color-ink-500)] mt-1">
            Inventory snapshot across the warehouse. As of{" "}
            <span className="font-medium text-[var(--color-ink-700)]">{formatDateTime(r.asOf)}</span>
            .
          </div>
        </div>
      </header>

      {isFromMirror && <ComputedDisclosure className="mb-4" />}

      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-5">
        <KpiCard label="Total Units">
          <KpiValue>
            {formatCount(r.kpis.totalUnits)} <span className="text-[12px] font-medium text-[var(--color-ink-500)] ml-0.5">units</span>
          </KpiValue>
          <KpiFoot>
            <Split label="CKD" value={formatCount(totalsInStock.ckd)} tone="navy" />
            <Split label="CBU" value={formatCount(totalsInStock.cbu)} tone="success" />
            <Split label="In Assembly" value={formatCount(totalsInStock.inAssembly)} tone="amber" />
          </KpiFoot>
        </KpiCard>

        <KpiCard headline label="Total Market Value">
          <div className="text-[24px] font-semibold tabular-nums text-[var(--color-ink-900)] tracking-[-0.02em] leading-[1.15]">
            {formatNGNCompact(r.kpis.totalMarketValue)}
          </div>
          <KpiFoot>
            <span className="font-mono tabular-nums text-[var(--color-ink-700)]">
              <b>{formatNGN(r.kpis.totalMarketValue)}</b>
            </span>
          </KpiFoot>
        </KpiCard>

        <KpiCard label="Total Variants">
          <KpiValue>
            {formatCount(r.kpis.totalVariants)} <span className="text-[12px] font-medium text-[var(--color-ink-500)] ml-0.5">SKUs</span>
          </KpiValue>
          <KpiFoot>
            <span className="text-[var(--color-ink-500)]">{r.variants.length} represented</span>
          </KpiFoot>
        </KpiCard>
      </section>

      <section className="bg-white border border-[var(--color-border-default)] rounded-[4px] mb-5">
        <header className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--color-border-default)]">
          <h2 className="m-0 text-[13px] font-semibold text-[var(--color-ink-900)]">
            Stock by Variant{" "}
            <span className="text-[11px] text-[var(--color-ink-500)] font-medium ml-2">
              {r.variants.length} variants &middot; {formatCount(totals.total)} units
            </span>
          </h2>
          <span className="text-[11px] text-[var(--color-ink-500)]">
            Counts shown per lifecycle state &middot; Market Value = Total &times; Market Price
          </span>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr>
                <Th>Variant</Th>
                <Th align="right" sub="in warehouse" className={COL.md}>CKD</Th>
                <Th align="right" className={COL.lg}>In Assembly</Th>
                <Th align="right" sub="in warehouse" className={COL.md}>CBU</Th>
                <Th align="right" className={COL.lg}>Sold</Th>
                <Th align="right" className={COL.lg}>Other</Th>
                <Th align="right">Total</Th>
                <Th align="right" className={COL.sm}>Market Price &middot; NGN</Th>
                <Th align="right">Market Value &middot; NGN</Th>
              </tr>
            </thead>
            <tbody>
              {r.variants.map((v) => (
                <tr key={v.productVariantId} className="border-b border-[var(--color-border-default)] hover:bg-[var(--color-navy-50)]">
                  <Td>
                    <div className="font-medium text-[var(--color-ink-900)] text-[12.5px] leading-tight whitespace-nowrap">
                      {[v.attributes.model, v.attributes.colour].filter(Boolean).join(" ") || v.sku}
                    </div>
                    <div className="font-mono text-[10.5px] text-[var(--color-ink-500)] font-medium mt-0.5">
                      {v.sku}
                    </div>
                  </Td>
                  <NumTd zero={v.counts.ckd === 0} className={COL.md}>{formatCount(v.counts.ckd)}</NumTd>
                  <NumTd zero={v.counts.inAssembly === 0} className={COL.lg}>{formatCount(v.counts.inAssembly)}</NumTd>
                  <NumTd zero={v.counts.cbu === 0} className={COL.md}>{formatCount(v.counts.cbu)}</NumTd>
                  <NumTd zero={v.counts.sold === 0} className={COL.lg}>{formatCount(v.counts.sold)}</NumTd>
                  <NumTd zero={v.counts.other === 0} className={COL.lg}>{formatCount(v.counts.other)}</NumTd>
                  <NumTd strong>{formatCount(v.counts.total)}</NumTd>
                  <NumTd className={COL.sm}>{formatNGN(v.currentMarketPrice)}</NumTd>
                  <NumTd strong>{formatNGN(v.marketValue)}</NumTd>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-[var(--color-ink-100)]">
                <FootTd>
                  Totals &middot; {r.variants.length} variants
                </FootTd>
                <FootNumTd className={COL.md}>{formatCount(totals.ckd)}</FootNumTd>
                <FootNumTd className={COL.lg}>{formatCount(totals.inAssembly)}</FootNumTd>
                <FootNumTd className={COL.md}>{formatCount(totals.cbu)}</FootNumTd>
                <FootNumTd className={COL.lg}>{formatCount(totals.sold)}</FootNumTd>
                <FootNumTd className={COL.lg}>{formatCount(totals.other)}</FootNumTd>
                <FootNumTd>{formatCount(totals.total)}</FootNumTd>
                <FootNumTd muted className={COL.sm}>--</FootNumTd>
                <FootNumTd strong navy>{formatNGN(r.kpis.totalMarketValue)}</FootNumTd>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <section className="bg-white border border-[var(--color-border-default)] rounded-[4px]">
        <header className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--color-border-default)]">
          <h2 className="m-0 text-[13px] font-semibold text-[var(--color-ink-900)]">
            Spare Parts{" "}
            <span className="text-[11px] text-[var(--color-ink-500)] font-medium ml-2">
              {formatCount(r.spareParts.items.length)} SKUs &middot; {formatCount(spareTotalQty)} pieces on hand
            </span>
          </h2>
          <span className="text-[11px] text-[var(--color-ink-500)]">
            {showSpareCosts ? "Valued at landed cost · not sold in MVP (no market price)" : "Inventory only · cost data not at your access level"}
          </span>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr>
                <Th>SKU</Th>
                <Th className={COL.sm}>Description</Th>
                <Th align="right">Qty on Hand</Th>
                {showSpareCosts && <Th align="right" className={COL.md}>Landed Cost / Unit &middot; NGN</Th>}
                {showSpareCosts && <Th align="right" className={COL.sm}>Total Landed Cost &middot; NGN</Th>}
              </tr>
            </thead>
            <tbody>
              {r.spareParts.items.length === 0 && (
                <tr>
                  <td
                    colSpan={showSpareCosts ? 5 : 3}
                    className="px-3.5 py-8 text-center text-[var(--color-ink-500)] text-[12.5px]"
                  >
                    No spare parts on hand.
                  </td>
                </tr>
              )}
              {r.spareParts.items.map((it) => (
                <tr key={it.id} className="border-b border-[var(--color-border-default)] hover:bg-[var(--color-navy-50)]">
                  <Td>
                    <span className="font-mono text-[12px] text-[var(--color-ink-900)] font-medium tracking-[0.02em] block max-w-[140px] sm:max-w-none truncate" title={it.sku}>
                      {it.sku}
                    </span>
                  </Td>
                  <Td className={COL.sm}>{it.name}</Td>
                  <NumTd>{formatCount(it.quantityOnHand)}</NumTd>
                  {showSpareCosts && (
                    <NumTd className={COL.md}>{it.landedCostPerUnit !== undefined ? formatNGN(it.landedCostPerUnit) : "--"}</NumTd>
                  )}
                  {showSpareCosts && (
                    <NumTd strong className={COL.sm}>{it.landedCostValue !== undefined ? formatNGN(it.landedCostValue) : "--"}</NumTd>
                  )}
                </tr>
              ))}
            </tbody>
            {showSpareCosts && r.spareParts.items.length > 0 && (
              <tfoot>
                <tr className="bg-[var(--color-ink-100)]">
                  <FootTd colSpan={2}>Totals &middot; {r.spareParts.items.length} SKUs</FootTd>
                  <FootNumTd>{formatCount(spareTotalQty)}</FootNumTd>
                  <FootNumTd muted className={COL.md}>--</FootNumTd>
                  <FootNumTd strong navy className={COL.sm}>{formatNGN(r.spareParts.totalLandedCostValue)}</FootNumTd>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </section>
    </div>
  );
}

function KpiCard({
  label,
  headline,
  children,
}: {
  label: string;
  headline?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`bg-white border rounded-[4px] px-4 py-3 ${
        headline
          ? "border-[var(--color-navy-700)] shadow-[0_0_0_1px_var(--color-navy-700)]"
          : "border-[var(--color-border-default)]"
      }`}
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.05em] text-[var(--color-ink-500)]">
          {label}
        </span>
      </div>
      {children}
    </div>
  );
}

function KpiValue({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[22px] font-semibold tabular-nums text-[var(--color-ink-900)] tracking-[-0.02em] leading-[1.15]">
      {children}
    </div>
  );
}

function KpiFoot({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] text-[var(--color-ink-500)] mt-1.5 flex items-center gap-2 flex-wrap">
      {children}
    </div>
  );
}

function Split({ label, value, tone }: { label: string; value: string; tone: "navy" | "success" | "amber" }) {
  const dotClass =
    tone === "navy"
      ? "bg-[var(--color-navy-700)]"
      : tone === "success"
        ? "bg-[var(--color-success-700)]"
        : "bg-[var(--color-warning-700)]";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`w-1.5 h-1.5 rounded-full ${dotClass}`} aria-hidden />
      <b className="text-[var(--color-ink-900)] tabular-nums font-semibold">{value}</b>
      <span>{label}</span>
    </span>
  );
}

function Th({ children, align = "left", sub, className = "" }: { children: React.ReactNode; align?: "left" | "right"; sub?: string; className?: string }) {
  return (
    <th
      className={`font-medium text-[11px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] px-2 sm:px-3.5 py-2.5 border-b border-[var(--color-border-default)] bg-[var(--color-ink-100)] whitespace-nowrap ${
        align === "right" ? "text-right" : "text-left"
      } ${className}`}
    >
      {children}
      {sub && (
        <span className="block text-[10px] font-normal text-[var(--color-ink-400)] normal-case tracking-normal mt-0.5">
          {sub}
        </span>
      )}
    </th>
  );
}

function Td({ children, colSpan, className = "" }: { children: React.ReactNode; colSpan?: number; className?: string }) {
  return (
    <td colSpan={colSpan} className={`px-2 sm:px-3.5 py-2.5 align-middle text-[var(--color-ink-900)] whitespace-nowrap ${className}`}>
      {children}
    </td>
  );
}

function NumTd({
  children,
  zero,
  strong,
  className = "",
}: {
  children: React.ReactNode;
  zero?: boolean;
  strong?: boolean;
  className?: string;
}) {
  return (
    <td
      className={`px-2 sm:px-3.5 py-2.5 text-right tabular-nums whitespace-nowrap ${
        zero
          ? "text-[var(--color-ink-400)]"
          : strong
            ? "text-[var(--color-ink-900)] font-semibold"
            : "text-[var(--color-ink-900)]"
      } ${className}`}
    >
      {children}
    </td>
  );
}

function FootTd({ children, colSpan, className = "" }: { children: React.ReactNode; colSpan?: number; className?: string }) {
  return (
    <td
      colSpan={colSpan}
      className={`px-2 sm:px-3.5 py-2.5 text-[12.5px] font-medium text-[var(--color-ink-700)] whitespace-nowrap ${className}`}
    >
      {children}
    </td>
  );
}

function FootNumTd({
  children,
  strong,
  navy,
  muted,
  className = "",
}: {
  children: React.ReactNode;
  strong?: boolean;
  navy?: boolean;
  muted?: boolean;
  className?: string;
}) {
  const cls = navy
    ? "text-[var(--color-navy-800)]"
    : muted
      ? "text-[var(--color-ink-500)] font-normal"
      : "text-[var(--color-ink-900)]";
  return (
    <td
      className={`px-2 sm:px-3.5 py-2.5 text-right tabular-nums whitespace-nowrap text-[12.5px] ${strong ? "font-semibold" : "font-medium"} ${cls} ${className}`}
    >
      {children}
    </td>
  );
}
