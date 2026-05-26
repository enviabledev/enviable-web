"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import ComputedDisclosure from "@/components/sync/ComputedDisclosure";
import {
  countPurchaseOrders,
  countShipments,
  getStocksReport,
  listUnits,
  type StocksReport,
} from "@/lib/api";
import { usePermissions, usePrincipal } from "@/lib/auth";
import { formatCount, formatNGN, formatNGNCompact } from "@/lib/format";
import { NAV, type NavGroup } from "@/lib/nav/config";
import { listByType } from "@/lib/sync/mirror/store";
import { recomputeStocksFromMirror } from "@/lib/sync/mirror/recompute/stocks";

type AsyncValue<T> =
  | { status: "loading" }
  | { status: "ok"; value: T; fromMirror?: boolean }
  | { status: "skipped" }
  | { status: "error" };

export default function DashboardPage() {
  const principal = usePrincipal();
  const { has, hasAll } = usePermissions();

  const [unitsTotal, setUnitsTotal] = useState<AsyncValue<number>>(
    has("unit.read") ? { status: "loading" } : { status: "skipped" },
  );
  const [stocks, setStocks] = useState<AsyncValue<StocksReport>>(
    has("report.stocks") ? { status: "loading" } : { status: "skipped" },
  );
  const [poCount, setPoCount] = useState<AsyncValue<number>>(
    has("po.read") ? { status: "loading" } : { status: "skipped" },
  );
  const [shipCount, setShipCount] = useState<AsyncValue<number>>(
    has("shipment.read") ? { status: "loading" } : { status: "skipped" },
  );

  // Mirror-first, revalidate-with-network. Paint optimistically from the
  // mirror so cards have data immediately (including offline, where the
  // network attempt will fail anyway). Then fire the network calls in the
  // background: on success, replace with the fresh value and drop the
  // fromMirror flag; on transient failure, keep the mirror render; on
  // forbidden, mark skipped. This pattern is more robust than
  // fetch-then-fallback because the card is never gated on the .then
  // completing: even a stuck or aborted fetch leaves the card showing the
  // mirror figure, which is the honest offline UX.
  useEffect(() => {
    const ctrl = new AbortController();

    // Phase 1: paint from the mirror, eagerly.
    if (has("unit.read")) {
      listByType<{ id: string }>("unit")
        .then((rows) => {
          if (ctrl.signal.aborted) return;
          setUnitsTotal({ status: "ok", value: rows.length, fromMirror: true });
        })
        .catch(() => {
          // mirror read failed (rare); leave state as it was and let the
          // network revalidation drive the final state.
        });
    }
    if (has("report.stocks")) {
      recomputeStocksFromMirror({})
        .then((report) => {
          if (ctrl.signal.aborted) return;
          setStocks({ status: "ok", value: report, fromMirror: true });
        })
        .catch(() => {});
    }
    if (has("po.read")) {
      listByType<{ id: string }>("purchaseOrder")
        .then((rows) => {
          if (ctrl.signal.aborted) return;
          setPoCount({ status: "ok", value: rows.length, fromMirror: true });
        })
        .catch(() => {});
    }
    if (has("shipment.read")) {
      listByType<{ id: string }>("shipment")
        .then((rows) => {
          if (ctrl.signal.aborted) return;
          setShipCount({ status: "ok", value: rows.length, fromMirror: true });
        })
        .catch(() => {});
    }

    // Phase 2: revalidate against the network. Each .then either upgrades
    // the optimistic mirror value to fresh (drop fromMirror flag) or leaves
    // it alone on transient failure (offline keeps the mirror render).
    if (has("unit.read")) {
      listUnits({ pageSize: 25 }, ctrl.signal).then((r) => {
        if (ctrl.signal.aborted) return;
        if (r.kind === "ok") setUnitsTotal({ status: "ok", value: r.data.total });
        else if (r.kind === "forbidden") setUnitsTotal({ status: "skipped" });
        // transient failure: keep the mirror render from phase 1.
      });
    }
    if (has("report.stocks")) {
      getStocksReport({}, ctrl.signal).then((r) => {
        if (ctrl.signal.aborted) return;
        if (r.kind === "ok") setStocks({ status: "ok", value: r.data });
        else if (r.kind === "forbidden") setStocks({ status: "skipped" });
      });
    }
    if (has("po.read")) {
      countPurchaseOrders(ctrl.signal).then((r) => {
        if (ctrl.signal.aborted) return;
        if (r.kind === "ok") setPoCount({ status: "ok", value: r.data });
        else if (r.kind === "forbidden") setPoCount({ status: "skipped" });
      });
    }
    if (has("shipment.read")) {
      countShipments(ctrl.signal).then((r) => {
        if (ctrl.signal.aborted) return;
        if (r.kind === "ok") setShipCount({ status: "ok", value: r.data });
        else if (r.kind === "forbidden") setShipCount({ status: "skipped" });
      });
    }
    return () => ctrl.abort();
  }, [has]);

  // Surface a single dashboard-level disclosure when any card recomputed
  // from the mirror, rather than badging each card individually. A stale
  // aggregation across cards is the kind of decision risk the accuracy
  // warning specifically addresses (multiple staleness compounding).
  const anyFromMirror =
    (unitsTotal.status === "ok" && unitsTotal.fromMirror) ||
    (stocks.status === "ok" && stocks.fromMirror) ||
    (poCount.status === "ok" && poCount.fromMirror) ||
    (shipCount.status === "ok" && shipCount.fromMirror);

  if (!principal) return null;
  const firstName = principal.fullName.split(" ")[0];

  // CKD/CBU/InAssembly aggregates derived from the stocks report.
  const stocksAgg =
    stocks.status === "ok"
      ? {
          ckd: stocks.value.variants.reduce((s, v) => s + v.counts.ckd, 0),
          cbu: stocks.value.variants.reduce((s, v) => s + v.counts.cbu, 0),
          inAssembly: stocks.value.variants.reduce((s, v) => s + v.counts.inAssembly, 0),
        }
      : null;

  // Quick-access tiles: same data as the sidebar, filtered by permissions.
  const visibleGroups: NavGroup[] = NAV
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => hasAll(item.permissions)),
    }))
    .filter((group) => group.items.length > 0 && group.label !== "Overview");

  return (
    <div className="max-w-[1480px] mx-auto pb-10">
      <header className="flex items-end justify-between gap-6 pb-4 mb-5 border-b border-[var(--color-border-default)]">
        <div>
          <div className="text-[12px] text-[var(--color-ink-500)] mb-1.5">
            <span className="text-[var(--color-ink-900)] font-medium">Dashboard</span>
          </div>
          <h1 className="text-[24px] font-semibold text-[var(--color-ink-900)] m-0 tracking-[-0.01em]">
            Welcome back, {firstName}.
          </h1>
          <div className="text-[13px] text-[var(--color-ink-500)] mt-1">
            Signed in as <span className="text-[var(--color-ink-700)]">{principal.roles.join(", ")}</span>
            . Cards reflect what your permissions allow.
          </div>
        </div>
      </header>

      {anyFromMirror && <ComputedDisclosure className="mb-4" />}

      <section className="grid grid-cols-4 gap-3 mb-6">
        {has("unit.read") && (
          <KpiCard label="Total Units">
            <KpiValue async={unitsTotal} render={(v) => (
              <>
                {formatCount(v)}{" "}
                <span className="text-[11px] font-medium text-[var(--color-ink-500)] ml-0.5">units</span>
              </>
            )} />
            <KpiFoot>
              {stocksAgg ? (
                <>
                  <Dot tone="navy" />
                  <b className="text-[var(--color-ink-900)] tabular-nums font-semibold">{formatCount(stocksAgg.ckd)}</b>
                  <span>CKD</span>
                  <Dot tone="success" />
                  <b className="text-[var(--color-ink-900)] tabular-nums font-semibold">{formatCount(stocksAgg.cbu)}</b>
                  <span>CBU</span>
                </>
              ) : (
                <span className="text-[var(--color-ink-400)]">--</span>
              )}
            </KpiFoot>
          </KpiCard>
        )}

        {has("report.stocks") && (
          <KpiCard label="Total Market Value" headline>
            <div className="text-[24px] font-semibold tabular-nums text-[var(--color-ink-900)] tracking-[-0.02em] leading-[1.15]">
              {stocks.status === "ok" ? formatNGNCompact(stocks.value.kpis.totalMarketValue) : "..."}
            </div>
            <KpiFoot>
              {stocks.status === "ok" ? (
                <span className="font-mono tabular-nums">
                  <b className="text-[var(--color-ink-900)]">
                    {formatNGN(stocks.value.kpis.totalMarketValue)}
                  </b>
                </span>
              ) : (
                <span className="text-[var(--color-ink-400)]">--</span>
              )}
            </KpiFoot>
          </KpiCard>
        )}

        {has("report.stocks") && (
          <KpiCard label="Available CKD">
            <KpiValue
              async={stocks.status === "ok" ? { status: "ok", value: stocksAgg!.ckd } : stocks.status === "loading" ? { status: "loading" } : { status: "skipped" }}
              render={(v) => (
                <>
                  {formatCount(v)}{" "}
                  <span className="text-[11px] font-medium text-[var(--color-ink-500)] ml-0.5">in warehouse</span>
                </>
              )}
            />
            <KpiFoot>
              <span className="text-[var(--color-ink-500)]">Ready to be assembled or sold as CKD</span>
            </KpiFoot>
          </KpiCard>
        )}

        {has("report.stocks") && (
          <KpiCard label="Available CBU">
            <KpiValue
              async={stocks.status === "ok" ? { status: "ok", value: stocksAgg!.cbu } : stocks.status === "loading" ? { status: "loading" } : { status: "skipped" }}
              render={(v) => (
                <>
                  {formatCount(v)}{" "}
                  <span className="text-[11px] font-medium text-[var(--color-ink-500)] ml-0.5">assembled</span>
                </>
              )}
            />
            <KpiFoot>
              <span className="text-[var(--color-ink-500)]">Ready to be sold as CBU</span>
            </KpiFoot>
          </KpiCard>
        )}

        {has("po.read") && (
          <KpiCard label="Purchase Orders">
            <KpiValue
              async={poCount}
              render={(v) => (
                <>
                  {formatCount(v)}{" "}
                  <span className="text-[11px] font-medium text-[var(--color-ink-500)] ml-0.5">on record</span>
                </>
              )}
            />
            <KpiFoot>
              <Link href="/procurement/purchase-orders" className="text-[var(--color-navy-700)] hover:underline">
                View all
              </Link>
            </KpiFoot>
          </KpiCard>
        )}

        {has("shipment.read") && (
          <KpiCard label="Shipments">
            <KpiValue
              async={shipCount}
              render={(v) => (
                <>
                  {formatCount(v)}{" "}
                  <span className="text-[11px] font-medium text-[var(--color-ink-500)] ml-0.5">recorded</span>
                </>
              )}
            />
            <KpiFoot>
              <Link href="/procurement/shipments" className="text-[var(--color-navy-700)] hover:underline">
                View all
              </Link>
            </KpiFoot>
          </KpiCard>
        )}
      </section>

      {visibleGroups.length > 0 && (
        <section>
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.04em] text-[var(--color-ink-500)] m-0 mb-3">
            Quick access
          </h2>
          <div className="grid grid-cols-3 gap-3">
            {visibleGroups.map((group) => (
              <div
                key={group.label}
                className="bg-white border border-[var(--color-border-default)] rounded-[4px] p-3.5"
              >
                <h3 className="m-0 mb-2 text-[12px] font-semibold uppercase tracking-[0.04em] text-[var(--color-ink-500)]">
                  {group.label}
                </h3>
                <div className="flex flex-col gap-1">
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className="flex items-center gap-2 px-2 py-1.5 rounded-[3px] text-[12.5px] text-[var(--color-ink-900)] hover:bg-[var(--color-navy-50)] hover:text-[var(--color-navy-700)]"
                      >
                        <Icon width={13} height={13} className="text-[var(--color-ink-500)]" />
                        <span>{item.label}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
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

function KpiValue<T>({ async, render }: { async: AsyncValue<T>; render: (v: T) => React.ReactNode }) {
  if (async.status === "ok") {
    return (
      <div className="text-[22px] font-semibold tabular-nums text-[var(--color-ink-900)] tracking-[-0.02em] leading-[1.15]">
        {render(async.value)}
      </div>
    );
  }
  return (
    <div className="text-[22px] font-semibold tabular-nums text-[var(--color-ink-400)] tracking-[-0.02em] leading-[1.15]">
      {async.status === "error" ? "--" : "..."}
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

function Dot({ tone }: { tone: "navy" | "success" | "amber" }) {
  const cls =
    tone === "navy"
      ? "bg-[var(--color-navy-700)]"
      : tone === "success"
        ? "bg-[var(--color-success-700)]"
        : "bg-[var(--color-warning-700)]";
  return <span className={`w-1.5 h-1.5 rounded-full ${cls}`} aria-hidden />;
}
