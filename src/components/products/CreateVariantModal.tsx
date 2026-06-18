"use client";

/**
 * Create-variant overlay (prompt 33-B). Mirrors CreateCustomerModal's shape:
 * online-only write, error surfacing, onSuccess(createdVariant) so the parent
 * closes + refreshes + raises a notification.
 *
 * Fields: product (required), SKU (required, the immutable identifier),
 * model + colour (structured variantAttributes), market price (required,
 * decimal string). There is intentionally NO status field: new variants
 * default to ACTIVE on the backend; DISCONTINUED is only reached later via the
 * detail page's deactivate affordance.
 *
 * Product options come from listProducts (GET /api/products, product.read).
 * The modal is online-only, so a live fetch is appropriate; the variant
 * pickers elsewhere read the mirror, but here we always want the current
 * catalogue to attach a new variant to.
 *
 * Two backend rejections are surfaced honestly: 409 when the SKU already
 * exists, 400 when the product is unknown.
 */
import { useEffect, useMemo, useState } from "react";

import Modal from "@/components/ui/Modal";
import {
  createProductVariant,
  listProducts,
  type ProductVariant,
} from "@/lib/api";
import { useConnectivity } from "@/lib/sync/connectivity";

type ProductOption = { id: string; name: string };

export default function CreateVariantModal({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: (created: ProductVariant) => void;
}) {
  const { state: connState } = useConnectivity();
  const offline = connState === "offline";

  const [products, setProducts] = useState<ProductOption[]>([]);
  const [productId, setProductId] = useState("");
  const [sku, setSku] = useState("");
  const [model, setModel] = useState("");
  const [colour, setColour] = useState("");
  const [price, setPrice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Reset the form each time the modal opens so a re-open is always clean.
  useEffect(() => {
    if (!open) return;
    setProductId("");
    setSku("");
    setModel("");
    setColour("");
    setPrice("");
    setSubmitting(false);
    setError("");
  }, [open]);

  // Product options from the live catalogue (online-only modal).
  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    listProducts(ctrl.signal).then((r) => {
      if (ctrl.signal.aborted) return;
      if (r.kind === "ok") {
        setProducts(
          r.data
            .map((p) => ({ id: p.id, name: p.name }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
      }
      // On failure the select renders empty; submit stays blocked until a
      // product is chosen, so a variant is never created without one.
    });
    return () => ctrl.abort();
  }, [open]);

  // currentMarketPrice must be a decimal string (the backend validates it as a
  // number string). Accept a plain non-negative decimal.
  const priceValid = useMemo(
    () => /^\d+(\.\d{1,2})?$/.test(price.trim()),
    [price],
  );

  const canSubmit = useMemo(
    () =>
      productId.length > 0 &&
      sku.trim().length > 0 &&
      priceValid &&
      !offline &&
      !submitting,
    [productId, sku, priceValid, offline, submitting],
  );

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError("");
    const variantAttributes: Record<string, string> = {};
    if (model.trim()) variantAttributes.model = model.trim();
    if (colour.trim()) variantAttributes.colour = colour.trim();
    const r = await createProductVariant({
      productId,
      supplierSkuCode: sku.trim(),
      variantAttributes,
      currentMarketPrice: price.trim(),
    });
    if (r.kind === "ok") {
      onSuccess(r.data);
      return;
    }
    setSubmitting(false);
    if (r.kind === "forbidden") {
      setError(
        "You do not have permission to create variants (requires productvariant.manage).",
      );
    } else if (r.kind === "conflict") {
      setError(r.message || `A variant with SKU "${sku.trim()}" already exists.`);
    } else if (r.kind === "validation") {
      setError(typeof r.message === "string" ? r.message : r.message.join("; "));
    } else if (r.kind === "network_error") {
      setError("Network error. Creating a variant requires a live connection.");
    } else {
      setError("Unexpected response from the server.");
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create variant"
      testId="create-variant-modal"
      footer={
        <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            data-testid="create-variant-submit"
            className="h-[32px] px-4 rounded-[3px] bg-[var(--color-navy-700)] text-white text-[12.5px] font-medium disabled:opacity-50 w-full sm:w-auto order-1 sm:order-2"
          >
            {submitting ? "Creating..." : "Create variant"}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="h-[32px] px-3 rounded-[3px] border border-[var(--color-border-strong)] bg-white text-[var(--color-ink-900)] text-[12.5px] font-medium hover:bg-[var(--color-ink-100)] w-full sm:w-auto order-2 sm:order-1"
          >
            Cancel
          </button>
        </div>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="flex flex-col gap-3"
      >
        {offline && (
          <div className="px-3 py-2 rounded-[3px] bg-[var(--color-warning-100)] text-[var(--color-warning-700)] text-[12px]">
            Creating a variant requires a live connection. Reconnect to continue.
          </div>
        )}
        {error && (
          <div
            role="alert"
            data-testid="create-variant-error"
            className="px-3 py-2 rounded-[3px] bg-[var(--color-danger-50)] border border-[var(--color-danger-100)] text-[12.5px] text-[var(--color-danger-700)]"
          >
            {error}
          </div>
        )}

        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] font-medium">
            Product
          </span>
          <select
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            disabled={submitting}
            data-testid="create-variant-product"
            className="h-[32px] w-full px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[13px]"
          >
            <option value="">Select a product…</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] font-medium">
            SKU
          </span>
          <input
            type="text"
            value={sku}
            onChange={(e) => setSku(e.target.value)}
            disabled={submitting}
            data-testid="create-variant-sku"
            placeholder="e.g. GSP-G-YELLOW"
            className="h-[32px] w-full px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[13px] font-mono"
          />
          <span className="text-[11.5px] text-[var(--color-ink-500)]">
            The catalogue-wide identifier. It cannot be changed once the variant
            is created.
          </span>
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] font-medium">
              Model
            </span>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={submitting}
              data-testid="create-variant-model"
              placeholder="e.g. GS+"
              className="h-[32px] w-full px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[13px]"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] font-medium">
              Colour
            </span>
            <input
              type="text"
              value={colour}
              onChange={(e) => setColour(e.target.value)}
              disabled={submitting}
              data-testid="create-variant-colour"
              placeholder="e.g. G Yellow"
              className="h-[32px] w-full px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[13px]"
            />
          </label>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] font-medium">
            Market price
          </span>
          <input
            type="text"
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            disabled={submitting}
            data-testid="create-variant-price"
            placeholder="e.g. 2800000"
            className="h-[32px] w-full px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[13px] font-mono"
          />
          {price.trim() && !priceValid && (
            <span className="text-[11.5px] text-[var(--color-danger-700)]">
              Enter a whole number or a decimal with up to two places.
            </span>
          )}
        </label>
      </form>
    </Modal>
  );
}
