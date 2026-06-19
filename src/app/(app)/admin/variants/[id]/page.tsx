"use client";

/**
 * Product-variant detail + management (prompt 33-B). Renders a single variant
 * with its immutable SKU, product, attributes, market price and status, and
 * (gated on productvariant.manage) inline edit + deactivate/reactivate.
 *
 * There is deliberately NO delete: deactivation (PATCH status=DISCONTINUED) is
 * the deletion semantic. Existing references (units, SO lines, price-list
 * entries) keep resolving; only new use is prevented (the pickers filter to
 * ACTIVE). The SKU is immutable and is rendered read-only; the edit form never
 * sends it.
 *
 * Read source: getProductVariant (GET /api/product-variants/:id). Mirror-first
 * paint from the productVariant bucket (joined to the product bucket for the
 * product name), then network revalidate.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import VariantStatusPill from "@/components/products/VariantStatusPill";
import FreshnessBadge from "@/components/sync/FreshnessBadge";
import OfflineNotice from "@/components/sync/OfflineNotice";
import {
  getProductVariant,
  listPrices,
  updateProductVariant,
  type ProductStatus,
  type ProductVariant,
  type VariantAttributesMap,
} from "@/lib/api";
import { usePermissions } from "@/lib/auth";
import { formatNGN } from "@/lib/format";
import { useActiveTiers } from "@/lib/pricing/use-tiers";
import { useConnectivity } from "@/lib/sync/connectivity";
import { getById, listByType } from "@/lib/sync/mirror/store";
import { useUrlLastSegment } from "@/lib/sync/use-url-segment";

type MirrorProduct = { id: string; name: string };
type MirrorPriceEntry = {
  id: string;
  productVariantId: string;
  customerTierId: string;
  effectiveTo: string | null;
};
type MirrorVariant = {
  id: string;
  productId: string;
  supplierSkuCode: string;
  variantAttributes: VariantAttributesMap;
  currentMarketPrice: string;
  status: ProductStatus;
};

type EditDraft = { model: string; colour: string; price: string };

type ManageState =
  | { status: "idle" }
  | { status: "editing"; draft: EditDraft }
  | { status: "submitting"; draft: EditDraft }
  | { status: "confirmingDeactivate" }
  | { status: "confirmingReactivate" }
  | { status: "working" }
  | { status: "error"; message: string };

const priceValid = (s: string) => /^\d+(\.\d{1,2})?$/.test(s.trim());

export default function VariantDetailPage() {
  const router = useRouter();
  const { has } = usePermissions();
  const canManage = has("productvariant.manage");
  // Pricing entry point is gated independently: a user may hold pricelist.manage
  // without productvariant.manage (and vice versa).
  const canPrice = has("pricelist.manage");
  const { state: connState } = useConnectivity();
  const offlineConn = connState === "offline";
  const id = useUrlLastSegment();

  const [variant, setVariant] = useState<ProductVariant | null>(null);
  const [errMsg, setErrMsg] = useState<string>("");
  const [offline, setOffline] = useState(false);
  const [fromMirror, setFromMirror] = useState(false);
  const [manage, setManage] = useState<ManageState>({ status: "idle" });

  // Pricing summary for the "Set price" / "Manage prices" affordance: which
  // tiers already have a current (open) price entry. The default tier (to land
  // on when none do) comes from useActiveTiers, which is resilient to a cold
  // mirror (re-reads on sync). Loaded only when the user can price.
  const [pricedTierIds, setPricedTierIds] = useState<string[]>([]);
  const { defaultTierId } = useActiveTiers();

  const mirrorPaintedRef = useRef(false);

  const loadFromMirror = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const mirrored = await getById<MirrorVariant>("productVariant", id);
        if (signal?.aborted || !mirrored) return;
        const v = mirrored.body;
        const product = v.productId
          ? await getById<MirrorProduct>("product", v.productId)
          : null;
        if (signal?.aborted) return;
        mirrorPaintedRef.current = true;
        setVariant({
          id: v.id,
          productId: v.productId,
          supplierSkuCode: v.supplierSkuCode,
          variantAttributes: v.variantAttributes ?? {},
          currentMarketPrice: v.currentMarketPrice,
          status: v.status,
          product: { id: v.productId, name: product?.body.name ?? "--" },
        });
        setFromMirror(true);
        setOffline(false);
      } catch {
        // Let network drive.
      }
    },
    [id],
  );

  const loadFromNetwork = useCallback(
    (signal?: AbortSignal) => {
      getProductVariant(id, signal).then((r) => {
        if (signal?.aborted) return;
        if (r.kind === "ok") {
          setVariant(r.data);
          setErrMsg("");
          setOffline(false);
          setFromMirror(false);
        } else if (r.kind === "unauthorized") {
          router.replace("/login");
        } else if (r.kind === "forbidden") {
          setErrMsg("You do not have access to view this variant.");
        } else if (r.kind === "not_found") {
          setErrMsg("Variant not found.");
        } else if (r.kind === "network_error" || r.kind === "server_error") {
          if (!mirrorPaintedRef.current) setOffline(true);
        } else if ("message" in r) {
          setErrMsg(
            typeof r.message === "string" ? r.message : r.message.join("; "),
          );
        }
      });
    },
    [id, router],
  );

  useEffect(() => {
    // Skip the empty-id first render (useUrlLastSegment starts as ""); without
    // this the network call hits the variant LIST shape and the render crashes.
    if (!id) return;
    const ctrl = new AbortController();
    mirrorPaintedRef.current = false;
    void loadFromMirror(ctrl.signal);
    loadFromNetwork(ctrl.signal);
    return () => ctrl.abort();
  }, [id, loadFromMirror, loadFromNetwork]);

  // Pricing summary (drives the Set price / Manage prices affordance copy and
  // routing target). Default tier from the mirror; current priced tiers from
  // the mirror first then the network. Only when the user can price.
  useEffect(() => {
    if (!canPrice || !id) return;
    let cancelled = false;
    const distinctOpenTiers = (
      entries: { productVariantId?: string; customerTierId: string; effectiveTo: string | null }[],
      forVariant: boolean,
    ) =>
      Array.from(
        new Set(
          entries
            .filter((e) => (forVariant ? e.productVariantId === id : true) && e.effectiveTo == null)
            .map((e) => e.customerTierId),
        ),
      );
    (async () => {
      try {
        const mirrorEntries = await listByType<MirrorPriceEntry>("priceListEntry");
        if (!cancelled) setPricedTierIds(distinctOpenTiers(mirrorEntries.map((r) => r.body), true));
      } catch {
        // Mirror unavailable; the network refine below drives.
      }
      const r = await listPrices({ variantId: id, includeClosed: false });
      if (!cancelled && r.kind === "ok") {
        setPricedTierIds(distinctOpenTiers(r.data, false));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canPrice, id]);

  const beginEdit = () => {
    if (!variant) return;
    setManage({
      status: "editing",
      draft: {
        model: variant.variantAttributes.model ?? "",
        colour: variant.variantAttributes.colour ?? "",
        price: variant.currentMarketPrice,
      },
    });
  };

  const saveEdit = async () => {
    if (manage.status !== "editing" || !variant) return;
    const draft = manage.draft;
    if (!priceValid(draft.price)) {
      setManage({
        status: "error",
        message: "Market price must be a whole number or a decimal with up to two places.",
      });
      return;
    }
    setManage({ status: "submitting", draft });
    // Preserve any attributes beyond model/colour; override those two from the
    // draft (the backend replaces the whole variantAttributes object).
    const nextAttrs: VariantAttributesMap = { ...variant.variantAttributes };
    if (draft.model.trim()) nextAttrs.model = draft.model.trim();
    else delete nextAttrs.model;
    if (draft.colour.trim()) nextAttrs.colour = draft.colour.trim();
    else delete nextAttrs.colour;
    const r = await updateProductVariant(variant.id, {
      variantAttributes: nextAttrs,
      currentMarketPrice: draft.price.trim(),
    });
    if (r.kind === "ok") {
      // PATCH response is the authoritative variant; apply it directly (a
      // mirror re-read would repaint the stale pre-edit row).
      setVariant(r.data);
      setManage({ status: "idle" });
    } else if (r.kind === "forbidden") {
      setManage({ status: "error", message: "You do not have permission to edit variants." });
    } else if (r.kind === "validation") {
      setManage({
        status: "error",
        message: typeof r.message === "string" ? r.message : r.message.join("; "),
      });
    } else if (r.kind === "network_error") {
      setManage({ status: "error", message: "Network error. Edits require a live connection." });
    } else {
      setManage({ status: "error", message: "Unexpected response from the server." });
    }
  };

  const setStatus = async (status: ProductStatus) => {
    if (!variant) return;
    setManage({ status: "working" });
    const r = await updateProductVariant(variant.id, { status });
    if (r.kind === "ok") {
      setVariant(r.data);
      setManage({ status: "idle" });
    } else if (r.kind === "forbidden") {
      setManage({ status: "error", message: "You do not have permission to change this variant." });
    } else if (r.kind === "network_error") {
      setManage({
        status: "error",
        message: "Network error. Status changes require a live connection.",
      });
    } else if (r.kind === "validation") {
      setManage({
        status: "error",
        message: typeof r.message === "string" ? r.message : r.message.join("; "),
      });
    } else {
      setManage({ status: "error", message: "Unexpected response from the server." });
    }
  };

  const manageBusy = manage.status === "submitting" || manage.status === "working";

  if (errMsg) {
    return (
      <div className="max-w-[820px] mx-auto pb-10">
        <div className="mb-4 px-3.5 py-2.5 rounded-[3px] bg-[var(--color-danger-100)] text-[var(--color-danger-700)] text-[12.5px]">
          {errMsg}
        </div>
        <Link href="/admin/variants" className="text-[12px] text-[var(--color-navy-700)] hover:underline">
          Back to variants
        </Link>
      </div>
    );
  }

  if (!variant && offline) {
    return (
      <div className="max-w-[820px] mx-auto pb-10">
        <OfflineNotice body="This variant's details will load once you're back online." />
      </div>
    );
  }

  if (!variant) {
    return (
      <div className="max-w-[820px] mx-auto pb-10 text-[12px] text-[var(--color-ink-500)]">
        Loading…
      </div>
    );
  }

  return (
    <div className="max-w-[820px] mx-auto pb-10">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 sm:gap-6 pb-4 mb-4 border-b border-[var(--color-border-default)]">
        <div className="min-w-0">
          <div className="text-[12px] text-[var(--color-ink-500)] flex items-center gap-1.5 mb-1.5">
            <Link href="/admin/variants" className="text-[var(--color-navy-700)] hover:underline">
              Admin / Variants
            </Link>
            <span className="text-[var(--color-ink-300)]">/</span>
            <span className="text-[var(--color-ink-900)] font-medium font-mono">
              {variant.supplierSkuCode}
            </span>
          </div>
          <h1 className="text-[22px] font-semibold text-[var(--color-ink-900)] m-0 tracking-[-0.01em] flex items-center gap-3 flex-wrap">
            <span className="font-mono">{variant.supplierSkuCode}</span>
            <VariantStatusPill status={variant.status} />
            {fromMirror && <FreshnessBadge />}
          </h1>
        </div>
        {manage.status === "idle" &&
          (canManage || (canPrice && variant.status === "ACTIVE")) && (
            <div className="flex flex-wrap gap-2 w-full sm:w-auto">
              {canManage && (
                <>
                  <button
                    type="button"
                    onClick={beginEdit}
                    disabled={offlineConn}
                    data-testid="edit-button"
                    className="h-[32px] px-3 rounded-[3px] border border-[var(--color-border-strong)] bg-white text-[var(--color-ink-900)] text-[12.5px] font-medium disabled:opacity-50"
                  >
                    Edit
                  </button>
                  {variant.status === "ACTIVE" ? (
                    <button
                      type="button"
                      onClick={() => setManage({ status: "confirmingDeactivate" })}
                      disabled={offlineConn}
                      data-testid="deactivate-button"
                      className="h-[32px] px-3 rounded-[3px] border border-[var(--color-warning-700)] bg-white text-[var(--color-warning-700)] text-[12.5px] font-medium disabled:opacity-50"
                    >
                      Deactivate
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setManage({ status: "confirmingReactivate" })}
                      disabled={offlineConn}
                      data-testid="reactivate-button"
                      className="h-[32px] px-3 rounded-[3px] border border-[var(--color-success-700)] bg-white text-[var(--color-success-700)] text-[12.5px] font-medium disabled:opacity-50"
                    >
                      Reactivate
                    </button>
                  )}
                </>
              )}
              {/* Pricing entry point (prompt 34). ACTIVE variants only; gated
                  on pricelist.manage independently of productvariant.manage.
                  Routes to the per-variant tier editor: an already-priced tier
                  if any, else the default tier for setting the first price. */}
              {canPrice &&
                variant.status === "ACTIVE" &&
                (pricedTierIds[0] || defaultTierId) && (
                  <Link
                    href={`/sales/price-lists/${encodeURIComponent(variant.id)}?tier=${encodeURIComponent(
                      pricedTierIds[0] ?? defaultTierId,
                    )}`}
                    data-testid="set-price-link"
                    className="h-[32px] px-3 inline-flex items-center rounded-[3px] border border-[var(--color-navy-700)] bg-white text-[var(--color-navy-700)] text-[12.5px] font-medium"
                  >
                    {pricedTierIds.length > 0
                      ? `Manage prices (${pricedTierIds.length} ${
                          pricedTierIds.length === 1 ? "tier" : "tiers"
                        })`
                      : "Set price"}
                  </Link>
                )}
            </div>
          )}
      </header>

      {canPrice && variant.status === "DISCONTINUED" && (
        <div
          data-testid="price-discontinued-hint"
          className="mb-4 px-3.5 py-2.5 rounded-[3px] bg-[var(--color-ink-100)] text-[var(--color-ink-700)] text-[12.5px]"
        >
          This variant is discontinued, so it cannot be priced. Reactivate it to set or manage prices.
        </div>
      )}

      {canManage && offlineConn && (
        <div className="mb-4 px-3.5 py-2.5 rounded-[3px] bg-[var(--color-warning-100)] text-[var(--color-warning-700)] text-[12.5px]">
          Editing and deactivating a variant require a live connection. Reconnect to manage this variant.
        </div>
      )}

      {canManage && manage.status === "error" && (
        <div
          role="alert"
          data-testid="manage-error"
          className="mb-4 px-3.5 py-2.5 rounded-[3px] bg-[var(--color-danger-50)] border border-[var(--color-danger-100)] text-[12.5px] text-[var(--color-danger-700)]"
        >
          {manage.message}
          <button
            type="button"
            onClick={() => setManage({ status: "idle" })}
            className="ml-3 underline hover:opacity-70"
          >
            Dismiss
          </button>
        </div>
      )}

      {canManage && manage.status === "confirmingDeactivate" && (
        <div role="dialog" className="mb-4 px-4 py-3 rounded-[4px] border-2 border-[var(--color-warning-700)] bg-[var(--color-warning-100)]">
          <div className="text-[13px] font-semibold text-[var(--color-warning-700)] mb-1">
            Deactivate this variant?
          </div>
          <div className="text-[12.5px] text-[var(--color-ink-900)] mb-3">
            It will be marked Discontinued and hidden from new sales orders, purchase orders and price lists. Every existing unit, sales-order line and price-list entry that references it keeps resolving.
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setStatus("DISCONTINUED")}
              disabled={manageBusy}
              data-testid="deactivate-confirm"
              className="h-[32px] px-4 rounded-[3px] bg-[var(--color-warning-700)] text-white text-[12.5px] font-medium disabled:opacity-50"
            >
              {manageBusy ? "Working..." : "Confirm deactivate"}
            </button>
            <button
              type="button"
              onClick={() => setManage({ status: "idle" })}
              disabled={manageBusy}
              className="h-[32px] px-3 rounded-[3px] border border-[var(--color-border-strong)] bg-white text-[var(--color-ink-900)] text-[12.5px] font-medium hover:bg-[var(--color-ink-100)] disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {canManage && manage.status === "confirmingReactivate" && (
        <div role="dialog" className="mb-4 px-4 py-3 rounded-[4px] border-2 border-[var(--color-success-700)] bg-[var(--color-success-100)]">
          <div className="text-[13px] font-semibold text-[var(--color-success-700)] mb-1">
            Reactivate this variant?
          </div>
          <div className="text-[12.5px] text-[var(--color-ink-900)] mb-3">
            It will become available again for new sales orders, purchase orders and price lists.
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setStatus("ACTIVE")}
              disabled={manageBusy}
              data-testid="reactivate-confirm"
              className="h-[32px] px-4 rounded-[3px] bg-[var(--color-success-700)] text-white text-[12.5px] font-medium disabled:opacity-50"
            >
              {manageBusy ? "Working..." : "Confirm reactivate"}
            </button>
            <button
              type="button"
              onClick={() => setManage({ status: "idle" })}
              disabled={manageBusy}
              className="h-[32px] px-3 rounded-[3px] border border-[var(--color-border-strong)] bg-white text-[var(--color-ink-900)] text-[12.5px] font-medium hover:bg-[var(--color-ink-100)] disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {canManage && (manage.status === "editing" || manage.status === "submitting") && (
        <section className="bg-white border border-[var(--color-border-default)] rounded-[4px] mb-4 px-4 sm:px-5 py-4">
          <h2 className="m-0 text-[13px] font-semibold text-[var(--color-ink-900)] mb-3">Edit variant</h2>
          <div className="mb-3 px-3 py-2 rounded-[3px] bg-[var(--color-ink-100)] text-[12px] text-[var(--color-ink-600)]">
            SKU <span className="font-mono text-[var(--color-ink-900)]">{variant.supplierSkuCode}</span> is immutable. To change it, deactivate this variant and create a new one.
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] font-medium">Model</span>
              <input
                type="text"
                value={manage.draft.model}
                onChange={(e) =>
                  manage.status === "editing" &&
                  setManage({ status: "editing", draft: { ...manage.draft, model: e.target.value } })
                }
                disabled={manageBusy}
                data-testid="edit-model"
                className="h-[32px] w-full px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[13px]"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] font-medium">Colour</span>
              <input
                type="text"
                value={manage.draft.colour}
                onChange={(e) =>
                  manage.status === "editing" &&
                  setManage({ status: "editing", draft: { ...manage.draft, colour: e.target.value } })
                }
                disabled={manageBusy}
                data-testid="edit-colour"
                className="h-[32px] w-full px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[13px]"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] font-medium">Market price</span>
              <input
                type="text"
                inputMode="decimal"
                value={manage.draft.price}
                onChange={(e) =>
                  manage.status === "editing" &&
                  setManage({ status: "editing", draft: { ...manage.draft, price: e.target.value } })
                }
                disabled={manageBusy}
                data-testid="edit-price"
                className="h-[32px] w-full px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[13px] font-mono"
              />
            </label>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={saveEdit}
              disabled={manageBusy || !priceValid(manage.draft.price)}
              data-testid="edit-save"
              className="h-[32px] px-4 rounded-[3px] bg-[var(--color-navy-700)] text-white text-[12.5px] font-medium disabled:opacity-50"
            >
              {manage.status === "submitting" ? "Saving..." : "Save changes"}
            </button>
            <button
              type="button"
              onClick={() => setManage({ status: "idle" })}
              disabled={manageBusy}
              data-testid="edit-cancel"
              className="h-[32px] px-3 rounded-[3px] border border-[var(--color-border-strong)] bg-white text-[var(--color-ink-900)] text-[12.5px] font-medium hover:bg-[var(--color-ink-100)] disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </section>
      )}

      <section className="bg-white border border-[var(--color-border-default)] rounded-[4px] overflow-hidden">
        <div className="px-3.5 py-2.5 border-b border-[var(--color-border-default)]">
          <h2 className="m-0 text-[14px] font-semibold text-[var(--color-ink-900)]">Variant</h2>
        </div>
        <dl className="text-[12.5px] divide-y divide-[var(--color-border-default)]">
          <div className="px-3.5 py-2.5 grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-3 sm:items-center">
            <dt className="text-[var(--color-ink-600)] text-[13px]">SKU</dt>
            <dd className="m-0 text-[var(--color-ink-900)] font-mono" data-testid="variant-sku">
              {variant.supplierSkuCode}
              <span className="ml-2 text-[11px] text-[var(--color-ink-500)] font-sans">immutable</span>
            </dd>
          </div>
          <div className="px-3.5 py-2.5 grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-3 sm:items-center">
            <dt className="text-[var(--color-ink-600)] text-[13px]">Product</dt>
            <dd className="m-0 text-[var(--color-ink-700)]">{variant.product.name}</dd>
          </div>
          <div className="px-3.5 py-2.5 grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-3 sm:items-center">
            <dt className="text-[var(--color-ink-600)] text-[13px]">Model</dt>
            <dd className="m-0 text-[var(--color-ink-700)]">{variant.variantAttributes.model ?? "--"}</dd>
          </div>
          <div className="px-3.5 py-2.5 grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-3 sm:items-center">
            <dt className="text-[var(--color-ink-600)] text-[13px]">Colour</dt>
            <dd className="m-0 text-[var(--color-ink-700)]">{variant.variantAttributes.colour ?? "--"}</dd>
          </div>
          <div className="px-3.5 py-2.5 grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-3 sm:items-center">
            <dt className="text-[var(--color-ink-600)] text-[13px]">Market price</dt>
            <dd className="m-0 text-[var(--color-ink-900)] font-mono" data-testid="variant-price">
              {formatNGN(variant.currentMarketPrice)}
            </dd>
          </div>
          <div className="px-3.5 py-2.5 grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-3 sm:items-center">
            <dt className="text-[var(--color-ink-600)] text-[13px]">Status</dt>
            <dd className="m-0"><VariantStatusPill status={variant.status} /></dd>
          </div>
          <div className="px-3.5 py-2.5 grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-3 sm:items-center">
            <dt className="text-[var(--color-ink-600)] text-[13px]">Variant ID</dt>
            <dd className="m-0 text-[var(--color-ink-700)] font-mono text-[12px]">{variant.id}</dd>
          </div>
        </dl>
      </section>

      <p className="mt-3 text-[11.5px] text-[var(--color-ink-500)] leading-[1.5]">
        Variants are never deleted. Deactivating sets the status to Discontinued, which removes the variant from new order, purchase and price-list pickers while preserving every historical reference. Reactivate to make it selectable again.
      </p>
    </div>
  );
}
