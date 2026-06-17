"use client";

/**
 * Price detail at /sales/price-lists/[variantId]?tier=<tierId>. Reads the
 * full effective-dated history for one (variant, tier) tuple from the
 * mirror first, then revalidates from /api/price-list?variantId=...&tierId=...
 * &includeClosed=true. The history is structured as a chronological
 * time-series, current entry on top, so a future graph component can
 * consume the same `{effectiveFrom, effectiveTo, price}` array directly
 * without restructuring.
 *
 * Set-new-price form is online-only (pricing.service.ts opens a Prisma
 * transaction; queueing offline is not the right pattern here per the
 * stakeholder decision). When connectivity is offline the form is
 * disabled with an honest "requires a connection" notice; the action
 * is NOT queued, NOT submitted, the price-list state is unchanged.
 *
 * Conflict handling: a concurrent supersede returns 409 with the
 * canonical "Invariant violated" message. The form surfaces it
 * verbatim with a "refresh to see the updated history" prompt; the
 * existing window is closed by the OTHER user's action, so retrying
 * the same form would re-conflict, the right next step is to reload
 * the detail and decide based on the new active price.
 */
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import FreshnessBadge from "@/components/sync/FreshnessBadge";
import OfflineNotice from "@/components/sync/OfflineNotice";
import {
  listPrices,
  setPrice,
  type PriceListEntry,
} from "@/lib/api";
import { isTransientFailure } from "@/lib/api/client";
import { usePermissions } from "@/lib/auth";
import { useConnectivity } from "@/lib/sync/connectivity";
import { formatDateTime, formatNGN } from "@/lib/format";
import { getById, listByType } from "@/lib/sync/mirror/store";
import { useUrlLastSegment } from "@/lib/sync/use-url-segment";

type MirroredEntry = {
  id: string;
  productVariantId: string;
  customerTierId: string;
  price: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  setById: string | null;
  updatedAt: string;
};
type MirroredVariant = {
  id: string;
  supplierSkuCode: string;
  productId?: string;
  variantAttributes?: { model?: string; colour?: string; [k: string]: string | undefined };
};
type MirroredProduct = { id: string; name: string };
type MirroredTier = { id: string; name: string };
type MirroredUser = { id: string; fullName: string };

type Series = {
  current: PriceListEntry | null;
  history: PriceListEntry[]; // chronological newest-first (current at index 0 when present)
};

type Context = {
  variant: MirroredVariant | null;
  product: MirroredProduct | null;
  tier: MirroredTier | null;
  userById: Map<string, MirroredUser>;
};

function variantLabel(v: MirroredVariant | null): string {
  if (!v) return "Variant";
  const attrs = v.variantAttributes ?? {};
  return [attrs.model, attrs.colour].filter(Boolean).join(" ") || v.supplierSkuCode;
}

async function loadMirrorContext(variantId: string, tierId: string): Promise<Context> {
  const [variantRow, tierRow, users] = await Promise.all([
    getById<MirroredVariant>("productVariant", variantId),
    getById<MirroredTier>("customerTier", tierId),
    listByType<MirroredUser>("user"),
  ]);
  let product: MirroredProduct | null = null;
  if (variantRow?.body.productId) {
    const productRow = await getById<MirroredProduct>("product", variantRow.body.productId);
    product = productRow?.body ?? null;
  }
  return {
    variant: variantRow?.body ?? null,
    product,
    tier: tierRow?.body ?? null,
    userById: new Map(users.map((u) => [u.body.id, u.body])),
  };
}

async function loadMirrorSeries(variantId: string, tierId: string): Promise<PriceListEntry[]> {
  const entries = await listByType<MirroredEntry>("priceListEntry");
  // Mirror rows are stored without joined productVariant / customerTier
  // shape; render-time joins fill the same fields the server include sets,
  // so we map them onto the PriceListEntry shape here.
  return entries
    .map((e) => e.body)
    .filter((e) => e.productVariantId === variantId && e.customerTierId === tierId)
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))
    .map<PriceListEntry>((e) => ({
      ...e,
      productVariant: { id: e.productVariantId, supplierSkuCode: e.productVariantId },
      customerTier: { id: e.customerTierId, name: e.customerTierId },
    }));
}

function buildSeries(entries: PriceListEntry[]): Series {
  const sorted = [...entries].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1));
  return {
    current: sorted.find((e) => e.effectiveTo == null) ?? null,
    history: sorted,
  };
}

export default function PriceDetailPage() {
  const router = useRouter();
  const { has } = usePermissions();
  const { state: connState } = useConnectivity();
  const sp = useSearchParams();
  const tierId = sp.get("tier") ?? "";
  const variantId = useUrlLastSegment();

  const canRead = has("pricelist.read");
  const canManage = has("pricelist.manage");

  const [series, setSeries] = useState<Series | null>(null);
  const [ctx, setCtx] = useState<Context | null>(null);
  const [fromMirror, setFromMirror] = useState(false);
  const [offline, setOffline] = useState(false);
  const [errMsg, setErrMsg] = useState("");
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    if (!canRead || !variantId || !tierId) return;
    const ctrl = new AbortController();
    let mirrorPainted = false;
    setOffline(false);

    (async () => {
      try {
        const [mirrorEntries, mirrorCtx] = await Promise.all([
          loadMirrorSeries(variantId, tierId),
          loadMirrorContext(variantId, tierId),
        ]);
        if (ctrl.signal.aborted) return;
        if (mirrorEntries.length > 0) {
          mirrorPainted = true;
          setSeries(buildSeries(mirrorEntries));
          setCtx(mirrorCtx);
          setFromMirror(true);
        }
      } catch {
        // network drives
      }
    })();

    listPrices({ variantId, tierId, includeClosed: true }, ctrl.signal).then(async (r) => {
      if (ctrl.signal.aborted) return;
      if (r.kind === "ok") {
        setSeries(buildSeries(r.data));
        setFromMirror(false);
        setErrMsg("");
        // Keep ctx fresh from mirror too (the server-include only echoes the
        // (variant, tier) summary; the mirror has the variant attributes used
        // for the label).
        if (!ctx) setCtx(await loadMirrorContext(variantId, tierId));
      } else if (r.kind === "unauthorized") {
        router.replace("/login");
      } else if (r.kind === "forbidden") {
        setErrMsg("You do not have access to read prices.");
      } else if (isTransientFailure(r)) {
        if (!mirrorPainted) setOffline(true);
      } else if ("message" in r) {
        setErrMsg(typeof r.message === "string" ? r.message : r.message.join("; "));
      }
    });

    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRead, variantId, tierId, router, reloadTick]);

  if (!canRead) {
    return (
      <div className="max-w-[1080px] mx-auto py-10 text-center text-[var(--color-ink-500)]">
        You do not have access to price lists (requires pricelist.read).
      </div>
    );
  }
  if (!tierId) {
    return (
      <div className="max-w-[820px] mx-auto py-10">
        <div className="px-3.5 py-2.5 rounded-[3px] bg-[var(--color-warning-50)] text-[var(--color-warning-700)] text-[12.5px]">
          The detail URL needs a <code>?tier=&lt;tierId&gt;</code> query param. Open a price from the list to
          get there.
        </div>
        <div className="text-center mt-3">
          <Link href="/sales/price-lists" className="text-[12px] text-[var(--color-navy-700)] hover:underline">
            Back to price lists
          </Link>
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
  if (!series && offline) {
    return (
      <div className="max-w-[820px] mx-auto pb-10">
        <OfflineNotice body="This price's history will load once you are back online. Prices already cached appear from the local mirror." />
      </div>
    );
  }
  if (!series) {
    return <div className="max-w-[1080px] mx-auto py-10 text-center text-[var(--color-ink-500)]">Loading price history...</div>;
  }

  const label = variantLabel(ctx?.variant ?? null);
  const sku = ctx?.variant?.supplierSkuCode ?? series.current?.productVariant.supplierSkuCode ?? variantId;
  const tierName = ctx?.tier?.name ?? series.current?.customerTier.name ?? tierId;
  const productName = ctx?.product?.name ?? null;

  return (
    <div className="max-w-[1080px] mx-auto pb-10">
      <header className="pb-4 mb-5 border-b border-[var(--color-border-default)]">
        <div className="text-[12px] text-[var(--color-ink-500)] flex items-center gap-1.5 mb-1.5 flex-wrap">
          <Link href="/sales/price-lists" className="text-[var(--color-ink-500)] hover:text-[var(--color-navy-700)]">
            Sales
          </Link>
          <span className="text-[var(--color-ink-300)]">/</span>
          <Link href="/sales/price-lists" className="text-[var(--color-ink-500)] hover:text-[var(--color-navy-700)]">
            Price lists
          </Link>
          <span className="text-[var(--color-ink-300)]">/</span>
          <span className="text-[var(--color-ink-900)] font-medium">{label}</span>
        </div>
        <div className="flex items-center gap-3 flex-wrap mb-1">
          <h1 className="text-[22px] font-semibold text-[var(--color-ink-900)] m-0 tracking-[-0.01em]">
            {label}
            <span className="text-[var(--color-ink-500)] text-[14px] font-medium ml-2">
              · for {tierName}
            </span>
          </h1>
          {fromMirror && <FreshnessBadge />}
        </div>
        <div className="text-[12.5px] text-[var(--color-ink-500)] mt-1 flex items-center gap-3 flex-wrap">
          <span className="font-mono">{sku}</span>
          {productName && <span>{productName}</span>}
        </div>
      </header>

      <CurrentPriceCard
        current={series.current}
        canManage={canManage}
        connState={connState}
      />

      {canManage && series.current && (
        <SetPriceForm
          variantId={variantId}
          tierId={tierId}
          currentPrice={series.current.price}
          connState={connState}
          onSuccess={() => setReloadTick((n) => n + 1)}
        />
      )}

      <HistoryTimeline series={series} userById={ctx?.userById ?? new Map()} />
    </div>
  );
}

function CurrentPriceCard({
  current,
  canManage,
  connState,
}: {
  current: PriceListEntry | null;
  canManage: boolean;
  connState: "online" | "offline" | "unknown";
}) {
  if (!current) {
    return (
      <section className="bg-white border border-[var(--color-border-default)] rounded-[4px] mb-5">
        <header className="px-5 py-3 border-b border-[var(--color-border-default)]">
          <h2 className="m-0 text-[13px] font-semibold text-[var(--color-ink-900)]">Current price</h2>
        </header>
        <div className="px-5 py-6 text-[12.5px] text-[var(--color-ink-500)]">
          No active price set for this (variant, tier).
        </div>
      </section>
    );
  }
  return (
    <section className="bg-white border border-[var(--color-border-default)] rounded-[4px] mb-5">
      <header className="px-5 py-3 border-b border-[var(--color-border-default)] flex items-center justify-between">
        <h2 className="m-0 text-[13px] font-semibold text-[var(--color-ink-900)]">Current price</h2>
        <span className="text-[10.5px] uppercase tracking-[0.04em] text-[var(--color-success-700)] font-semibold">
          Active
        </span>
      </header>
      <div className="px-5 py-4 flex items-center gap-6 flex-wrap">
        <div>
          <div className="text-[10.5px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] mb-1">
            Selling price
          </div>
          <div className="text-[28px] font-semibold text-[var(--color-ink-900)] font-mono tracking-[-0.01em]">
            {formatNGN(current.price)}
          </div>
        </div>
        <div className="text-[12.5px] text-[var(--color-ink-700)]">
          <div className="text-[10.5px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] mb-1">
            Effective from
          </div>
          {formatDateTime(current.effectiveFrom)}
        </div>
        {canManage && connState === "offline" && (
          <div
            role="status"
            className="ml-auto px-3 py-2 rounded-[3px] bg-[var(--color-warning-50)] border border-[var(--color-warning-100)] text-[11.5px] text-[var(--color-warning-700)]"
          >
            Setting a new price requires a connection. Reconnect to supersede.
          </div>
        )}
      </div>
    </section>
  );
}

function SetPriceForm({
  variantId,
  tierId,
  currentPrice,
  connState,
  onSuccess,
}: {
  variantId: string;
  tierId: string;
  currentPrice: string;
  connState: "online" | "offline" | "unknown";
  onSuccess: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [state, setState] = useState<
    | { status: "idle" }
    | { status: "submitting" }
    | { status: "success"; newPrice: string }
    | { status: "conflict"; message: string }
    | { status: "error"; message: string }
  >({ status: "idle" });

  const disabled = connState === "offline" || state.status === "submitting";

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d+(\.\d{1,2})?$/.test(draft)) {
      setState({ status: "error", message: "Enter a positive number with up to two decimal places." });
      return;
    }
    setState({ status: "submitting" });
    const r = await setPrice({ productVariantId: variantId, customerTierId: tierId, price: draft });
    if (r.kind === "ok") {
      setState({ status: "success", newPrice: r.data.price });
      setDraft("");
      onSuccess();
    } else if (r.kind === "conflict") {
      // I-5 enforcement returned 409. The OTHER user already set a new
      // price for this (variant, tier). Retrying with the same window
      // would re-conflict; the user needs the fresh history before
      // deciding what to do.
      setState({
        status: "conflict",
        message:
          r.message ||
          "Another user set a new price while this form was open. The current price has changed; reload to see the updated history.",
      });
    } else if (r.kind === "validation") {
      setState({
        status: "error",
        message: typeof r.message === "string" ? r.message : r.message.join("; "),
      });
    } else if (r.kind === "forbidden") {
      setState({ status: "error", message: "You do not have permission to set prices (requires pricelist.manage)." });
    } else if (r.kind === "network_error") {
      setState({
        status: "error",
        message: "Network error reaching the backend. Setting prices requires a live connection; try again.",
      });
    } else {
      setState({ status: "error", message: "Unexpected response from the server." });
    }
  };

  return (
    <section className="bg-white border border-[var(--color-border-default)] rounded-[4px] mb-5">
      <header className="px-5 py-3 border-b border-[var(--color-border-default)] flex items-center justify-between">
        <h2 className="m-0 text-[13px] font-semibold text-[var(--color-ink-900)]">Set a new price</h2>
        <span className="text-[11px] text-[var(--color-ink-500)]">
          Online-only: setting a price atomically closes the current entry and opens a new one.
        </span>
      </header>
      <form onSubmit={onSubmit} className="px-5 py-4 flex items-end gap-3 flex-wrap">
        <label className="flex flex-col gap-1">
          <span className="text-[10.5px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] font-medium">
            New price
          </span>
          <input
            type="text"
            inputMode="decimal"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              if (state.status !== "idle" && state.status !== "submitting") setState({ status: "idle" });
            }}
            placeholder={`Currently ${formatNGN(currentPrice)}`}
            disabled={disabled}
            data-testid="set-price-input"
            className="h-[32px] w-[200px] px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[14px] font-mono text-[var(--color-ink-900)] disabled:bg-[var(--color-ink-100)] disabled:text-[var(--color-ink-500)]"
          />
        </label>
        <button
          type="submit"
          disabled={disabled || !draft}
          data-testid="set-price-submit"
          className="h-[32px] px-4 rounded-[3px] bg-[var(--color-navy-700)] text-white text-[12.5px] font-medium disabled:opacity-50"
          title={connState === "offline" ? "Setting a price requires a connection" : undefined}
        >
          {state.status === "submitting" ? "Setting..." : "Set price"}
        </button>
        {connState === "offline" && (
          <span className="text-[11.5px] text-[var(--color-warning-700)]">
            Disabled offline. Reconnect to set a new price.
          </span>
        )}
      </form>
      {state.status === "success" && (
        <div
          role="status"
          data-testid="set-price-success"
          className="mx-5 mb-4 px-3.5 py-2.5 rounded-[3px] border border-[var(--color-success-700)] bg-[var(--color-success-50)] text-[12.5px] text-[var(--color-success-700)]"
        >
          New active price: <span className="font-mono font-semibold">{formatNGN(state.newPrice)}</span>. The
          prior entry has been closed and now sits in the history below.
        </div>
      )}
      {state.status === "conflict" && (
        <div
          role="alert"
          data-testid="set-price-conflict"
          className="mx-5 mb-4 px-3.5 py-2.5 rounded-[3px] border border-[var(--color-warning-700)] bg-[var(--color-warning-50)] text-[12.5px] text-[var(--color-warning-700)]"
        >
          <div className="font-semibold mb-0.5">Concurrent supersede detected</div>
          <div className="text-[var(--color-ink-700)]">{state.message}</div>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-2 h-[26px] px-3 rounded-[3px] bg-white border border-[var(--color-warning-700)] text-[var(--color-warning-700)] text-[11.5px] font-medium"
          >
            Reload to see the updated history
          </button>
        </div>
      )}
      {state.status === "error" && (
        <div
          role="alert"
          className="mx-5 mb-4 px-3.5 py-2.5 rounded-[3px] border border-[var(--color-danger-100)] bg-[var(--color-danger-50)] text-[12.5px] text-[var(--color-danger-700)]"
        >
          {state.message}
        </div>
      )}
    </section>
  );
}

function HistoryTimeline({
  series,
  userById,
}: {
  series: Series;
  userById: Map<string, MirroredUser>;
}) {
  return (
    <section className="bg-white border border-[var(--color-border-default)] rounded-[4px]">
      <header className="px-5 py-3 border-b border-[var(--color-border-default)] flex items-center justify-between">
        <h2 className="m-0 text-[13px] font-semibold text-[var(--color-ink-900)]">Price history</h2>
        <span className="text-[11px] text-[var(--color-ink-500)]">
          {series.history.length} {series.history.length === 1 ? "entry" : "entries"} (newest first)
        </span>
      </header>
      {series.history.length === 0 ? (
        <div className="px-5 py-8 text-center text-[12.5px] text-[var(--color-ink-500)]">
          No price history for this (variant, tier) yet.
        </div>
      ) : (
        <ol className="px-5 py-4 space-y-3" data-testid="price-history">
          {series.history.map((entry, idx) => {
            const isActive = entry.effectiveTo == null;
            const supersededBy = !isActive ? series.history[idx - 1] ?? null : null;
            const setBy = entry.setById ? userById.get(entry.setById) ?? null : null;
            return (
              <li
                key={entry.id}
                data-testid="price-history-entry"
                data-effective-from={entry.effectiveFrom}
                data-effective-to={entry.effectiveTo ?? ""}
                data-price={entry.price}
                className="grid grid-cols-1 sm:grid-cols-[120px_1fr] gap-2 sm:gap-4 pb-3 border-b border-dashed border-[var(--color-border-default)] last:border-b-0"
              >
                <div className="flex flex-col items-start gap-1">
                  <span
                    className={`inline-flex items-center h-[18px] px-2 rounded-full text-[10.5px] font-semibold uppercase tracking-[0.02em] ${
                      isActive
                        ? "bg-[var(--color-success-100)] text-[var(--color-success-700)]"
                        : "bg-[var(--color-ink-100)] text-[var(--color-ink-700)]"
                    }`}
                  >
                    {isActive ? "Active" : "Superseded"}
                  </span>
                  <span className="text-[10.5px] text-[var(--color-ink-500)] uppercase tracking-[0.04em]">
                    {isActive ? "Now" : `#${series.history.length - idx}`}
                  </span>
                </div>
                <div className="space-y-1">
                  <div className="text-[16px] font-semibold text-[var(--color-ink-900)] font-mono tracking-[-0.01em]">
                    {formatNGN(entry.price)}
                  </div>
                  <div className="text-[12px] text-[var(--color-ink-700)]">
                    From{" "}
                    <span className="font-medium">{formatDateTime(entry.effectiveFrom)}</span>{" "}
                    to{" "}
                    {entry.effectiveTo ? (
                      <span className="font-medium">{formatDateTime(entry.effectiveTo)}</span>
                    ) : (
                      <span className="text-[var(--color-success-700)] font-semibold">current</span>
                    )}
                  </div>
                  <div className="text-[11.5px] text-[var(--color-ink-500)]">
                    Set by{" "}
                    {setBy ? (
                      <span className="text-[var(--color-ink-700)] font-medium">{setBy.fullName}</span>
                    ) : entry.setById ? (
                      <span className="font-mono text-[11px]">{entry.setById}</span>
                    ) : (
                      <span className="italic">unattributed (seeded)</span>
                    )}
                    {supersededBy && (
                      <>
                        {" · "}superseded by entry of{" "}
                        <span className="font-medium">
                          {formatNGN(supersededBy.price)}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
