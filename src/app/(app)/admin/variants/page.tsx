"use client";

/**
 * Product-variant catalogue + management (prompt 33-B). Lists every variant
 * across all products with its SKU, attributes, market price and status, with
 * a status filter and a gated "Create variant" affordance.
 *
 * Read source: there is no dedicated variant LIST endpoint; the catalogue list
 * is GET /api/products (nested variants). Mirror-first: read the product +
 * productVariant buckets and join by productId, then revalidate from the
 * network (listProducts). Phase-2 revalidate gives freshness for free, so no
 * explicit freshness signal is wired here.
 *
 * Management (create) is gated on productvariant.manage; the list itself only
 * needs product.read.
 */
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import CreateVariantModal from "@/components/products/CreateVariantModal";
import PendingClassificationPill from "@/components/products/PendingClassificationPill";
import VariantStatusPill from "@/components/products/VariantStatusPill";
import FreshnessBadge from "@/components/sync/FreshnessBadge";
import OfflineNotice from "@/components/sync/OfflineNotice";
import {
  listProducts,
  type ProductStatus,
  type VariantAttributesMap,
} from "@/lib/api";
import { usePermissions } from "@/lib/auth";
import { formatNGN } from "@/lib/format";
import { isPendingClassification } from "@/lib/products/variant-classification";
import { useActiveTiers } from "@/lib/pricing/use-tiers";
import { useMirrorFreshness } from "@/lib/sync/mirror/freshness";
import { COL } from "@/lib/responsive";
import { listByType } from "@/lib/sync/mirror/store";

type VariantRow = {
  id: string;
  sku: string;
  productId: string;
  productName: string;
  attributes: VariantAttributesMap;
  currentMarketPrice: string;
  status: ProductStatus;
  pending: boolean;
};

// Mirror bucket bodies (raw Prisma rows; foreign keys only, no joins).
type MirrorProduct = { id: string; name: string };
type MirrorVariant = {
  id: string;
  productId: string;
  supplierSkuCode: string;
  variantAttributes: VariantAttributesMap;
  currentMarketPrice: string;
  status: ProductStatus;
};

function attributesLabel(attrs: VariantAttributesMap): string {
  const parts = [attrs.model, attrs.colour].filter(
    (x): x is string => typeof x === "string" && x.length > 0,
  );
  if (parts.length > 0) return parts.join(" ");
  // Fall back to any other string attributes so a non model/colour variant is
  // not rendered blank.
  const rest = Object.entries(attrs)
    .filter(([k, v]) => k !== "model" && k !== "colour" && typeof v === "string" && v)
    .map(([, v]) => v as string);
  return rest.length > 0 ? rest.join(" ") : "--";
}

function sortRows(rows: VariantRow[]): VariantRow[] {
  return rows.sort(
    (a, b) =>
      a.productName.localeCompare(b.productName) || a.sku.localeCompare(b.sku),
  );
}

type StatusFilter = "ALL" | "ACTIVE" | "DISCONTINUED" | "PENDING";

export default function VariantsListPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { has } = usePermissions();
  const canManage = has("productvariant.manage");
  // Pricing deep-link on the post-create notification is gated independently.
  const canPrice = has("pricelist.manage");
  const watermark = useMirrorFreshness();
  const historyComplete = watermark?.historyComplete ?? false;

  const [rows, setRows] = useState<VariantRow[] | null>(null);
  const [errMsg, setErrMsg] = useState<string>("");
  const [offline, setOffline] = useState(false);
  const [fromMirror, setFromMirror] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(
    searchParams.get("filter") === "pending" ? "PENDING" : "ALL",
  );

  const [createOpen, setCreateOpen] = useState(false);
  const [createdVariant, setCreatedVariant] = useState<{ id: string; sku: string } | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  // Default tier for the post-create "Set price" deep-link (resilient to a cold
  // mirror). The link renders only when pricing is permitted and a tier exists.
  const { defaultTierId } = useActiveTiers();

  const mirrorPaintedRef = useRef(false);
  useEffect(() => {
    const ctrl = new AbortController();
    mirrorPaintedRef.current = false;

    // Phase 1: mirror (join productVariant -> product by productId).
    (async () => {
      try {
        const [variants, products] = await Promise.all([
          listByType<MirrorVariant>("productVariant"),
          listByType<MirrorProduct>("product"),
        ]);
        if (ctrl.signal.aborted) return;
        const productById = new Map(products.map((p) => [p.body.id, p.body]));
        const built = variants.map<VariantRow>((v) => ({
          id: v.body.id,
          sku: v.body.supplierSkuCode,
          productId: v.body.productId,
          productName: productById.get(v.body.productId)?.name ?? "--",
          attributes: v.body.variantAttributes ?? {},
          currentMarketPrice: v.body.currentMarketPrice,
          status: v.body.status,
          pending: isPendingClassification(v.body.productId),
        }));
        if (built.length > 0) {
          mirrorPaintedRef.current = true;
          setRows(sortRows(built));
          setFromMirror(true);
          setOffline(false);
        }
      } catch {
        // Let network drive.
      }
    })();

    // Phase 2: network revalidate (flatten products -> variants).
    listProducts(ctrl.signal).then((r) => {
      if (ctrl.signal.aborted) return;
      if (r.kind === "ok") {
        const built: VariantRow[] = [];
        for (const p of r.data) {
          for (const v of p.variants) {
            built.push({
              id: v.id,
              sku: v.supplierSkuCode,
              productId: p.id,
              productName: p.name,
              attributes: v.variantAttributes ?? {},
              currentMarketPrice: v.currentMarketPrice,
              status: v.status,
              pending: isPendingClassification(p.id),
            });
          }
        }
        setRows(sortRows(built));
        setFromMirror(false);
        setOffline(false);
      } else if (r.kind === "unauthorized") {
        router.replace("/login");
      } else if (r.kind === "forbidden") {
        setErrMsg("You do not have access to the product catalogue.");
      } else if (r.kind === "network_error" || r.kind === "server_error") {
        if (!mirrorPaintedRef.current) setOffline(true);
      } else if ("message" in r) {
        setErrMsg(
          typeof r.message === "string" ? r.message : r.message.join("; "),
        );
      }
    });
    return () => ctrl.abort();
  }, [router, reloadTick]);

  const filtered = useMemo(() => {
    if (!rows) return null;
    if (statusFilter === "ALL") return rows;
    if (statusFilter === "PENDING") return rows.filter((r) => r.pending);
    return rows.filter((r) => r.status === statusFilter);
  }, [rows, statusFilter]);

  const pendingCount = useMemo(
    () => (rows ? rows.filter((r) => r.pending).length : 0),
    [rows],
  );

  const bootstrapping = !historyComplete && (rows === null || rows.length === 0);

  return (
    <div className="max-w-[1480px] mx-auto pb-10">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 sm:gap-6 pb-4 mb-4 border-b border-[var(--color-border-default)]">
        <div>
          <div className="text-[12px] text-[var(--color-ink-500)] flex items-center gap-1.5 mb-1.5">
            <span>Admin</span>
            <span className="text-[var(--color-ink-300)]">/</span>
            <span className="text-[var(--color-ink-900)] font-medium">Variants</span>
          </div>
          <h1 className="text-[24px] font-semibold text-[var(--color-ink-900)] m-0 tracking-[-0.01em] flex items-center gap-3">
            Variants
            {rows && (
              <span className="font-mono text-[12px] bg-[var(--color-navy-50)] text-[var(--color-navy-800)] px-2.5 py-1 rounded-[3px] font-semibold">
                {rows.length} total
              </span>
            )}
            {fromMirror && <FreshnessBadge />}
          </h1>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            data-testid="create-variant-button"
            className="h-[32px] px-4 inline-flex items-center rounded-[3px] bg-[var(--color-navy-700)] text-white text-[12.5px] font-medium self-start"
          >
            Create variant
          </button>
        )}
      </header>

      {canManage && createdVariant && (
        <div
          role="status"
          data-testid="create-variant-notification"
          className="mb-4 px-3.5 py-2.5 rounded-[3px] bg-[var(--color-success-100)] text-[var(--color-success-700)] text-[12.5px] flex items-center justify-between gap-3"
        >
          <span className="flex items-center gap-3 flex-wrap">
            <span>Variant {createdVariant.sku} created.</span>
            {/* Bridge to pricing: a freshly created variant is usually about to
                be made sellable. Only when the user can price and a tier exists. */}
            {canPrice && defaultTierId && (
              <Link
                href={`/sales/price-lists/${encodeURIComponent(createdVariant.id)}?tier=${encodeURIComponent(defaultTierId)}`}
                data-testid="create-variant-set-price-link"
                className="underline font-medium hover:opacity-70"
              >
                Set price for this variant
              </Link>
            )}
          </span>
          <button
            type="button"
            onClick={() => setCreatedVariant(null)}
            aria-label="Dismiss"
            className="text-[var(--color-success-700)] hover:opacity-70 text-[14px] leading-none px-1"
          >
            &times;
          </button>
        </div>
      )}

      {canManage && (
        <CreateVariantModal
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onSuccess={(created) => {
            setCreateOpen(false);
            setCreatedVariant({ id: created.id, sku: created.supplierSkuCode });
            setReloadTick((n) => n + 1);
          }}
        />
      )}

      {errMsg && (
        <div className="mb-4 px-3.5 py-2.5 rounded-[3px] bg-[var(--color-danger-100)] text-[var(--color-danger-700)] text-[12.5px]">
          {errMsg}
        </div>
      )}

      {offline && rows === null && (
        <OfflineNotice body="The variant catalogue will load when the connection returns." />
      )}

      {!offline && pendingCount > 0 && statusFilter !== "PENDING" && (
        <div
          role="status"
          data-testid="pending-classification-banner"
          className="mb-3 px-3.5 py-2.5 rounded-[3px] bg-[var(--color-warning-100)] text-[var(--color-warning-700)] text-[12.5px] flex items-center justify-between gap-3 flex-wrap"
        >
          <span>
            <span className="font-semibold">
              {pendingCount} variant{pendingCount === 1 ? "" : "s"} pending classification.
            </span>{" "}
            Auto-created from supply activity. Each needs a real product and a price before it can
            be sold.
          </span>
          <button
            type="button"
            onClick={() => setStatusFilter("PENDING")}
            data-testid="pending-classification-review"
            className="underline font-medium hover:opacity-70 shrink-0"
          >
            Review pending variants
          </button>
        </div>
      )}

      {!offline && (
        <>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[11px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] font-medium">
              Status
            </span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              data-testid="variant-status-filter"
              className="h-[28px] px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[12.5px]"
            >
              <option value="ALL">All</option>
              <option value="ACTIVE">Active</option>
              <option value="DISCONTINUED">Discontinued</option>
              <option value="PENDING">Pending classification</option>
            </select>
            {pendingCount > 0 && (
              <button
                type="button"
                onClick={() =>
                  setStatusFilter(statusFilter === "PENDING" ? "ALL" : "PENDING")
                }
                data-testid="pending-filter-toggle"
                className={`h-[28px] px-2.5 rounded-[3px] border text-[12px] font-medium ${
                  statusFilter === "PENDING"
                    ? "border-[var(--color-warning-700)] bg-[var(--color-warning-100)] text-[var(--color-warning-700)]"
                    : "border-[var(--color-border-default)] bg-white text-[var(--color-ink-700)]"
                }`}
              >
                Pending {pendingCount}
              </button>
            )}
          </div>

          <div className="bg-white border border-[var(--color-border-default)] rounded-[4px] overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-[var(--color-ink-100)] text-[10.5px] uppercase text-[var(--color-ink-600)] tracking-[0.04em]">
                  <th className="text-left font-semibold px-3 py-2 border-b border-[var(--color-border-default)]">
                    SKU
                  </th>
                  <th className={`text-left font-semibold px-3 py-2 border-b border-[var(--color-border-default)] ${COL.sm}`}>
                    Product
                  </th>
                  <th className={`text-left font-semibold px-3 py-2 border-b border-[var(--color-border-default)] ${COL.md}`}>
                    Attributes
                  </th>
                  <th className="text-right font-semibold px-3 py-2 border-b border-[var(--color-border-default)]">
                    Market price
                  </th>
                  <th className="text-left font-semibold px-3 py-2 border-b border-[var(--color-border-default)]">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered === null && (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-[12px] text-[var(--color-ink-500)]">
                      {bootstrapping ? (
                        <span className="inline-flex items-center gap-2">
                          <span className="inline-block w-2 h-2 rounded-full bg-[var(--color-navy-500)] animate-pulse" />
                          Syncing your data…
                        </span>
                      ) : (
                        "Loading…"
                      )}
                    </td>
                  </tr>
                )}
                {filtered && filtered.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-[12px] text-[var(--color-ink-500)]">
                      {bootstrapping ? (
                        <span className="inline-flex items-center gap-2">
                          <span className="inline-block w-2 h-2 rounded-full bg-[var(--color-navy-500)] animate-pulse" />
                          Syncing your data…
                        </span>
                      ) : statusFilter === "ALL" ? (
                        "No variants."
                      ) : statusFilter === "PENDING" ? (
                        "No variants are pending classification. Nothing to curate right now."
                      ) : (
                        "No variants match this status."
                      )}
                    </td>
                  </tr>
                )}
                {filtered?.map((v) => (
                  <tr
                    key={v.id}
                    data-testid={`variant-row-${v.id}`}
                    data-pending={v.pending ? "true" : "false"}
                    className="text-[12.5px] hover:bg-[var(--color-ink-100)]"
                  >
                    <td
                      className={`px-3 h-[30px] border-b border-[var(--color-border-default)] ${
                        v.pending
                          ? "border-l-2 border-l-[var(--color-warning-700)]"
                          : "border-l-2 border-l-transparent"
                      }`}
                    >
                      <Link
                        href={`/admin/variants/${v.id}`}
                        title={v.sku}
                        className="block max-w-[180px] sm:max-w-none truncate text-[var(--color-navy-700)] hover:underline font-mono text-[12px] font-medium"
                      >
                        {v.sku}
                      </Link>
                    </td>
                    <td className={`px-3 h-[30px] border-b border-[var(--color-border-default)] text-[var(--color-ink-700)] ${COL.sm}`}>
                      {v.productName}
                    </td>
                    <td className={`px-3 h-[30px] border-b border-[var(--color-border-default)] text-[var(--color-ink-700)] ${COL.md}`}>
                      {attributesLabel(v.attributes)}
                    </td>
                    <td className="px-3 h-[30px] border-b border-[var(--color-border-default)] text-[var(--color-ink-900)] text-right font-mono text-[12px]">
                      {formatNGN(v.currentMarketPrice)}
                    </td>
                    <td className="px-3 h-[30px] border-b border-[var(--color-border-default)]">
                      <span className="inline-flex items-center gap-1.5">
                        <VariantStatusPill status={v.status} />
                        {v.pending && <PendingClassificationPill />}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
