"use client";

/**
 * Deliveries view at /sales/deliveries, gated 'delivery.manage' on the nav
 * but the screen reads delivery-state SOs which is the salesorder.read
 * surface. After the backend audit (no /api/deliveries aggregation, no
 * standalone Delivery entity, DeliveryNote 1:1 to SO), the deliveries
 * screen is a DELIVERY-CENTRIC VIEW OF THE SO LIST: same source rows,
 * different emphasis columns. The per-SO delivery workflow lives on the
 * SO detail's DeliveryCard (prompt 7); this screen does NOT fork those
 * actions, it just gets the dispatcher to the right SO efficiently.
 *
 * Source: salesOrder bucket from the mirror (the backend has no
 * multi-status filter on /api/sales-orders, so we read the full set
 * from the mirror and filter client-side). Mirror-first paint with
 * FreshnessBadge since reads are mirror-sourced. Customer name joins
 * from the customer bucket. dispatchedAt / deliveredAt are on the full
 * salesOrder row (the sync pull returns the full Prisma row; the SO
 * list endpoint's select-shape doesn't carry them, but the mirror does).
 *
 * Mirror gap: deliveryNote / waybill / proofOfDelivery are NOT mirrored
 * today (BACKLOG.md). That means this screen cannot show "has note" or
 * "has POD" status offline; the workflow still works on the SO detail
 * online. Listed as a candidate for backend pull-coverage when the team
 * wants offline-capable delivery workflow.
 */
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { DeliveriesIcon, SearchIcon } from "@/components/icons";
import FreshnessBadge from "@/components/sync/FreshnessBadge";
import { usePermissions } from "@/lib/auth";
import { formatDateShort, formatDateTime } from "@/lib/format";
import { COL } from "@/lib/responsive";
import { useMirrorFreshness } from "@/lib/sync/mirror/freshness";
import { listByType } from "@/lib/sync/mirror/store";

/** SO statuses that represent a delivery in motion. The dispatcher
 * primarily cares about READY_FOR_DISPATCH (staged) through DELIVERED
 * (proof recorded). RELEASE_AUTHORISED / PICKING are pre-dispatch and
 * are included by default so the dispatcher sees what is coming up. */
const ALL_DELIVERY_STATUSES = [
  "RELEASE_AUTHORISED",
  "PICKING",
  "READY_FOR_DISPATCH",
  "DISPATCHED",
  "DELIVERED",
] as const;
type DeliveryStatus = (typeof ALL_DELIVERY_STATUSES)[number];

type MirroredSalesOrder = {
  id: string;
  soNumber: string;
  customerId: string;
  status: string;
  total: string;
  createdAt: string;
  updatedAt: string;
  dispatchedAt: string | null;
  deliveredAt: string | null;
};

type MirroredCustomer = { id: string; name: string };

type Row = {
  id: string;
  soNumber: string;
  customerName: string;
  status: DeliveryStatus;
  createdAt: string;
  dispatchedAt: string | null;
  deliveredAt: string | null;
  total: string;
};

const STATUS_LABEL: Record<DeliveryStatus, string> = {
  RELEASE_AUTHORISED: "Released",
  PICKING: "Picking",
  READY_FOR_DISPATCH: "Ready for dispatch",
  DISPATCHED: "Dispatched",
  DELIVERED: "Delivered",
};

const STATUS_TONE: Record<DeliveryStatus, { bg: string; fg: string; dot: string }> = {
  RELEASE_AUTHORISED: {
    bg: "bg-[var(--color-ink-100)]",
    fg: "text-[var(--color-ink-700)]",
    dot: "bg-[var(--color-ink-500)]",
  },
  PICKING: {
    bg: "bg-[var(--color-warning-50)]",
    fg: "text-[var(--color-warning-700)]",
    dot: "bg-[var(--color-warning-700)]",
  },
  READY_FOR_DISPATCH: {
    bg: "bg-[var(--color-navy-100)]",
    fg: "text-[var(--color-navy-800)]",
    dot: "bg-[var(--color-navy-700)]",
  },
  DISPATCHED: {
    bg: "bg-[var(--color-navy-100)]",
    fg: "text-[var(--color-navy-800)]",
    dot: "bg-[var(--color-navy-700)]",
  },
  DELIVERED: {
    bg: "bg-[var(--color-success-100)]",
    fg: "text-[var(--color-success-700)]",
    dot: "bg-[var(--color-success-700)]",
  },
};

function readParams(sp: URLSearchParams) {
  const statusRaw = sp.get("status") ?? "";
  const status: DeliveryStatus | "" = (ALL_DELIVERY_STATUSES as readonly string[]).includes(statusRaw)
    ? (statusRaw as DeliveryStatus)
    : "";
  const search = sp.get("search") ?? "";
  return { status, search };
}

function buildHref(p: Partial<ReturnType<typeof readParams>>): string {
  const sp = new URLSearchParams();
  if (p.status) sp.set("status", p.status);
  if (p.search) sp.set("search", p.search);
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

export default function DeliveriesPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const { has } = usePermissions();
  // 'delivery.manage' is the action-permission gate (per the SO detail's
  // DeliveryCard). Read access to the underlying SO data is salesorder.read.
  // The nav uses 'delivery.manage' as the membership signal for showing
  // the entry, so we follow the nav contract here.
  const canSee = has("delivery.manage") || has("salesorder.read");

  const params = useMemo(() => readParams(new URLSearchParams(sp.toString())), [sp]);
  const [searchDraft, setSearchDraft] = useState(params.search);
  useEffect(() => setSearchDraft(params.search), [params.search]);

  const [rows, setRows] = useState<Row[] | null>(null);
  const watermark = useMirrorFreshness();
  const bootstrapping = watermark ? !watermark.historyComplete : true;

  const navigate = useCallback(
    (next: Partial<ReturnType<typeof readParams>>) => {
      router.replace(`/sales/deliveries${buildHref({ ...params, ...next })}`);
    },
    [params, router],
  );

  // Mirror re-read function. The mirror is the source of truth and SyncBoot
  // keeps it current via background downloads + reconciles, but the page
  // needs a signal to know when to re-read. Without one, a clerk who opens
  // this page before SyncBoot's first reconcile completes (or who keeps
  // the tab open while a later reconcile lands) sees a stale snapshot.
  // We re-read on mount, on tab-visibility change, on window focus, and on
  // every 'online' connectivity event (when SyncBoot itself kicks off a
  // pull, which is the most likely moment new rows appear).
  useEffect(() => {
    if (!canSee) return;
    let cancelled = false;
    const read = async () => {
      try {
        const [orders, customers] = await Promise.all([
          listByType<MirroredSalesOrder>("salesOrder"),
          listByType<MirroredCustomer>("customer"),
        ]);
        if (cancelled) return;
        const customerById = new Map(customers.map((c) => [c.body.id, c.body]));
        const filtered = orders
          .map((o) => o.body)
          .filter((so) =>
            (ALL_DELIVERY_STATUSES as readonly string[]).includes(so.status),
          )
          .map<Row>((so) => ({
            id: so.id,
            soNumber: so.soNumber,
            customerName: customerById.get(so.customerId)?.name ?? so.customerId,
            status: so.status as DeliveryStatus,
            createdAt: so.createdAt,
            dispatchedAt: so.dispatchedAt,
            deliveredAt: so.deliveredAt,
            total: so.total,
          }))
          .sort((a, b) => {
            const aT = a.deliveredAt ?? a.dispatchedAt ?? a.createdAt;
            const bT = b.deliveredAt ?? b.dispatchedAt ?? b.createdAt;
            return aT < bT ? 1 : -1;
          });
        if (!cancelled) setRows(filtered);
      } catch {
        if (!cancelled) setRows([]);
      }
    };
    void read();
    const onVisible = () => {
      if (document.visibilityState === "visible") void read();
    };
    window.addEventListener("focus", read);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", read);
    // Lightweight periodic refresh while the tab is open and visible. Cheap
    // because listByType is a single indexed-range scan against IDB; runs
    // once every 15s only when the document is visible.
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void read();
    }, 15000);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", read);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", read);
      window.clearInterval(interval);
    };
  }, [canSee]);

  if (!canSee) {
    return (
      <div className="max-w-[1080px] mx-auto py-10 text-center text-[var(--color-ink-500)]">
        You do not have access to deliveries (requires delivery.manage or salesorder.read).
      </div>
    );
  }

  const visible = (rows ?? []).filter((r) => {
    if (params.status && r.status !== params.status) return false;
    if (params.search) {
      const q = params.search.toUpperCase();
      if (
        !r.soNumber.toUpperCase().includes(q) &&
        !r.customerName.toUpperCase().includes(q)
      ) {
        return false;
      }
    }
    return true;
  });

  return (
    <div className="max-w-[1480px] mx-auto pb-10">
      <header className="flex items-end justify-between gap-6 pb-4 mb-4 border-b border-[var(--color-border-default)]">
        <div>
          <div className="text-[12px] text-[var(--color-ink-500)] mb-1.5">Sales / Deliveries</div>
          <h1 className="text-[22px] font-semibold text-[var(--color-ink-900)] m-0 tracking-[-0.01em] flex items-center gap-2">
            <DeliveriesIcon className="w-[18px] h-[18px] text-[var(--color-ink-500)]" />
            Deliveries
          </h1>
          <div className="text-[12.5px] text-[var(--color-ink-500)] mt-1 max-w-[820px]">
            Sales orders in delivery states, from Released through Delivered. Click a row to open the order
            and run the delivery workflow (create note, dispatch, record proof). The per-order workflow
            lives on the order detail; this view is the dispatcher&apos;s cross-order overview.
          </div>
        </div>
      </header>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          navigate({ search: searchDraft });
        }}
        className="bg-white border border-[var(--color-border-default)] rounded-[4px] px-3 py-2.5 mb-3 flex flex-col sm:flex-row sm:items-end gap-3 sm:flex-wrap"
      >
        <Field label="Status">
          <select
            value={params.status}
            onChange={(e) => navigate({ status: e.target.value as DeliveryStatus | "" })}
            className="h-[28px] px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[12.5px] text-[var(--color-ink-900)]"
          >
            <option value="">All in-flight</option>
            {ALL_DELIVERY_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Search SO# or customer">
          <div className="relative">
            <SearchIcon className="absolute left-2 top-1/2 -translate-y-1/2 w-[12px] h-[12px] text-[var(--color-ink-500)]" />
            <input
              type="text"
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              placeholder="e.g. SO-2026-001"
              className="h-[28px] w-[260px] pl-6 pr-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[12.5px] text-[var(--color-ink-900)]"
            />
          </div>
        </Field>
        <button
          type="submit"
          className="h-[28px] px-3 rounded-[3px] bg-[var(--color-navy-700)] text-white text-[12.5px] font-medium"
        >
          Search
        </button>
        {(params.status || params.search) && (
          <button
            type="button"
            onClick={() => {
              setSearchDraft("");
              navigate({ status: "", search: "" });
            }}
            className="h-[28px] px-3 rounded-[3px] bg-white border border-[var(--color-border-default)] text-[var(--color-ink-700)] text-[12px] hover:border-[var(--color-navy-700)] hover:text-[var(--color-navy-700)]"
          >
            Clear
          </button>
        )}
      </form>

      {!rows ? (
        <div className="py-10 text-center text-[var(--color-ink-500)]">Loading deliveries...</div>
      ) : (
        <section className="bg-white border border-[var(--color-border-default)] rounded-[4px] overflow-x-auto">
          <header className="px-4 py-2.5 border-b border-[var(--color-border-default)] flex items-center justify-between">
            <h2 className="m-0 text-[13px] font-semibold text-[var(--color-ink-900)] flex items-center gap-2">
              In-flight deliveries
              <span className="text-[11px] text-[var(--color-ink-500)] font-medium ml-1">
                {visible.length} of {rows.length}
              </span>
              <FreshnessBadge />
            </h2>
          </header>
          {visible.length === 0 ? (
            bootstrapping && rows.length === 0 ? (
              <div className="px-4 py-10 text-center text-[12.5px] text-[var(--color-ink-500)]">
                <div className="inline-flex items-center gap-2.5 mb-2">
                  <span className="inline-block w-[10px] h-[10px] rounded-full bg-[var(--color-navy-700)] animate-pulse" />
                  <span className="font-medium text-[var(--color-ink-700)]">
                    Syncing your data...
                  </span>
                </div>
                <div className="max-w-[480px] mx-auto">
                  The local mirror is downloading from the server. Deliveries will appear here as
                  soon as the initial sync finishes; this usually takes a few seconds and only
                  happens on the first load.
                </div>
              </div>
            ) : (
              <div className="px-4 py-8 text-center text-[12.5px] text-[var(--color-ink-500)]">
                No deliveries match the current filters.
              </div>
            )
          ) : (
            <table className="w-full text-[13px]">
              <thead>
                <tr>
                  <Th>SO Number</Th>
                  <Th className={COL.md}>Customer</Th>
                  <Th>Status</Th>
                  <Th className={COL.lg}>Released</Th>
                  <Th className={COL.sm}>Dispatched</Th>
                  <Th className={COL.sm}>Delivered</Th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r, i) => (
                  <tr
                    key={r.id}
                    className={`${i % 2 ? "bg-[#FBFBFC]" : "bg-white"} border-b border-[var(--color-border-default)] hover:bg-[var(--color-navy-50)]`}
                  >
                    <Td mono>
                      <Link
                        href={`/sales/sales-orders/${r.id}`}
                        className="text-[var(--color-navy-700)] hover:underline font-medium"
                      >
                        {r.soNumber}
                      </Link>
                    </Td>
                    <Td className={COL.md}>{r.customerName}</Td>
                    <Td>
                      <StatusPill status={r.status} />
                    </Td>
                    <Td className={COL.lg}>{formatDateShort(r.createdAt)}</Td>
                    <Td className={COL.sm}>
                      {r.dispatchedAt ? (
                        <span title={formatDateTime(r.dispatchedAt)}>{formatDateShort(r.dispatchedAt)}</span>
                      ) : (
                        <span className="text-[var(--color-ink-400)]">--</span>
                      )}
                    </Td>
                    <Td className={COL.sm}>
                      {r.deliveredAt ? (
                        <span title={formatDateTime(r.deliveredAt)}>{formatDateShort(r.deliveredAt)}</span>
                      ) : (
                        <span className="text-[var(--color-ink-400)]">--</span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: DeliveryStatus }) {
  const tone = STATUS_TONE[status];
  return (
    <span
      className={`inline-flex items-center gap-1 h-[18px] px-2 rounded-full text-[10.5px] font-semibold uppercase tracking-[0.02em] ${tone.bg} ${tone.fg}`}
    >
      <span className={`w-[5px] h-[5px] rounded-full flex-shrink-0 ${tone.dot}`} aria-hidden />
      {STATUS_LABEL[status]}
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

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={`text-left font-medium text-[10.5px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] px-3.5 py-2.5 border-b border-[var(--color-border-default)] bg-[var(--color-ink-100)] ${className}`}>
      {children}
    </th>
  );
}

function Td({
  children,
  mono = false,
  className = "",
}: {
  children: React.ReactNode;
  mono?: boolean;
  className?: string;
}) {
  return (
    <td
      className={`px-3.5 py-2 text-[12.5px] text-[var(--color-ink-900)] whitespace-nowrap ${
        mono ? "font-mono text-[12px] tracking-[0.02em]" : ""
      } ${className}`}
    >
      {children}
    </td>
  );
}
