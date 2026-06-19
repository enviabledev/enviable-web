"use client";

/**
 * "Add variant to price list" picker (prompt 34). Lets a pricelist.manage user
 * pick an ACTIVE variant + a tier and routes to the per-variant tier editor
 * (/sales/price-lists/<variantId>?tier=<tierId>), where the existing set-price
 * flow creates the first entry. The picker does NOT create the entry itself;
 * the editor is the single source of truth for entry creation.
 *
 * ACTIVE-only: variant options come from flattenVariantOptions, which already
 * filters to status === "ACTIVE" (the cross-context filtering convention), so
 * discontinued variants are never offered for new pricing.
 *
 * Online-only: routing leads to a write context, so the action is disabled
 * offline with an honest notice.
 */
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import Modal from "@/components/ui/Modal";
import { flattenVariantOptions, listProducts, type ProductWithVariants } from "@/lib/api";
import { useConnectivity } from "@/lib/sync/connectivity";

type TierOption = { id: string; name: string };

export default function AddVariantToPriceListModal({
  open,
  onClose,
  tiers,
  initialTierId,
}: {
  open: boolean;
  onClose: () => void;
  tiers: readonly TierOption[];
  initialTierId: string;
}) {
  const router = useRouter();
  const { state: connState } = useConnectivity();
  const offline = connState === "offline";

  const [products, setProducts] = useState<ProductWithVariants[]>([]);
  const [search, setSearch] = useState("");
  const [variantId, setVariantId] = useState("");
  const [tierId, setTierId] = useState(initialTierId);

  useEffect(() => {
    if (!open) return;
    setSearch("");
    setVariantId("");
    setTierId(initialTierId);
    const ctrl = new AbortController();
    listProducts(ctrl.signal).then((r) => {
      if (!ctrl.signal.aborted && r.kind === "ok") setProducts(r.data);
    });
    return () => ctrl.abort();
  }, [open, initialTierId]);

  // ACTIVE-only options (flattenVariantOptions filters status !== ACTIVE).
  const options = useMemo(() => flattenVariantOptions(products), [products]);

  const filtered = useMemo(() => {
    const q = search.trim().toUpperCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.label.toUpperCase().includes(q) || o.productName.toUpperCase().includes(q),
    );
  }, [options, search]);

  const canSubmit = variantId.length > 0 && tierId.length > 0 && !offline;

  const submit = () => {
    if (!canSubmit) return;
    onClose();
    router.push(
      `/sales/price-lists/${encodeURIComponent(variantId)}?tier=${encodeURIComponent(tierId)}`,
    );
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add variant to price list"
      testId="add-variant-modal"
      footer={
        <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            data-testid="add-variant-submit"
            className="h-[32px] px-4 rounded-[3px] bg-[var(--color-navy-700)] text-white text-[12.5px] font-medium disabled:opacity-50 w-full sm:w-auto order-1 sm:order-2"
          >
            Set price
          </button>
          <button
            type="button"
            onClick={onClose}
            className="h-[32px] px-3 rounded-[3px] border border-[var(--color-border-strong)] bg-white text-[var(--color-ink-900)] text-[12.5px] font-medium hover:bg-[var(--color-ink-100)] w-full sm:w-auto order-2 sm:order-1"
          >
            Cancel
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        {offline && (
          <div className="px-3 py-2 rounded-[3px] bg-[var(--color-warning-100)] text-[var(--color-warning-700)] text-[12px]">
            Setting a price requires a live connection. Reconnect to continue.
          </div>
        )}

        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] font-medium">
            Tier
          </span>
          <select
            value={tierId}
            onChange={(e) => setTierId(e.target.value)}
            data-testid="add-variant-tier"
            className="h-[32px] w-full px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[13px]"
          >
            <option value="">Select a tier…</option>
            {tiers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] font-medium">
            Variant
          </span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by SKU or attributes"
            data-testid="add-variant-search"
            className="h-[32px] w-full px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[13px]"
          />
        </label>

        <div
          className="max-h-[280px] overflow-y-auto border border-[var(--color-border-default)] rounded-[3px] divide-y divide-[var(--color-border-default)]"
          data-testid="add-variant-list"
        >
          {filtered.length === 0 ? (
            <div className="px-3 py-6 text-center text-[12px] text-[var(--color-ink-500)]">
              {options.length === 0 ? "No active variants." : "No variants match your search."}
            </div>
          ) : (
            filtered.map((o) => {
              const selected = o.productVariantId === variantId;
              return (
                <button
                  key={o.productVariantId}
                  type="button"
                  onClick={() => setVariantId(o.productVariantId)}
                  data-testid={`add-variant-option-${o.productVariantId}`}
                  className={`w-full text-left px-3 py-2 text-[12.5px] flex items-center gap-2 ${
                    selected
                      ? "bg-[var(--color-navy-50)] text-[var(--color-navy-800)]"
                      : "hover:bg-[var(--color-ink-100)] text-[var(--color-ink-900)]"
                  }`}
                >
                  <span
                    aria-hidden
                    className={`w-[10px] h-[10px] rounded-full border flex-shrink-0 ${
                      selected
                        ? "border-[var(--color-navy-700)] bg-[var(--color-navy-700)]"
                        : "border-[var(--color-border-strong)]"
                    }`}
                  />
                  <span className="truncate">{o.label}</span>
                </button>
              );
            })
          )}
        </div>
        <p className="text-[11.5px] text-[var(--color-ink-500)] leading-[1.5]">
          Only active variants can be priced. You will be taken to the price editor to set the first price for the selected variant and tier.
        </p>
      </div>
    </Modal>
  );
}
