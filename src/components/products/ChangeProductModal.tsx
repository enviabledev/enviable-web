"use client";

/**
 * Reclassification Modal: repoint a variant onto a different product. The
 * primary use is lifting an auto-created variant off the "Pending
 * Classification" sentinel onto its real product, but it works for any variant.
 * Gated productvariant.manage by the caller (this component assumes the gate has
 * already passed; the button that opens it is hidden otherwise).
 *
 * Sends PATCH /api/product-variants/:id { productId }. The backend validates the
 * target product exists. On success the parent applies the returned variant.
 *
 * The sentinel product is offered in the list but de-emphasised and labelled,
 * since reclassifying TO pending is almost never the intent; the real products
 * are what the admin reaches for.
 */
import { useEffect, useMemo, useState } from "react";

import Modal from "@/components/ui/Modal";
import {
  listProducts,
  updateProductVariant,
  type ProductVariant,
  type ProductWithVariants,
} from "@/lib/api";
import {
  PENDING_CLASSIFICATION_LABEL,
  SENTINEL_PRODUCT_ID,
} from "@/lib/products/variant-classification";

export default function ChangeProductModal({
  open,
  variant,
  onClose,
  onSuccess,
}: {
  open: boolean;
  variant: ProductVariant;
  onClose: () => void;
  onSuccess: (updated: ProductVariant) => void;
}) {
  const [products, setProducts] = useState<ProductWithVariants[]>([]);
  const [loadError, setLoadError] = useState<string>("");
  const [selected, setSelected] = useState<string>(
    variant.productId === SENTINEL_PRODUCT_ID ? "" : variant.productId,
  );
  const [submitting, setSubmitting] = useState(false);
  const [errMsg, setErrMsg] = useState<string>("");

  useEffect(() => {
    if (!open) return;
    setErrMsg("");
    setSelected(variant.productId === SENTINEL_PRODUCT_ID ? "" : variant.productId);
    const ctrl = new AbortController();
    listProducts(ctrl.signal).then((r) => {
      if (ctrl.signal.aborted) return;
      if (r.kind === "ok") setProducts(r.data);
      else if (r.kind === "forbidden")
        setLoadError("You do not have access to the product catalogue.");
      else if ("message" in r)
        setLoadError(typeof r.message === "string" ? r.message : r.message.join("; "));
    });
    return () => ctrl.abort();
  }, [open, variant.productId]);

  // Real products first (alphabetical), the sentinel last and labelled.
  const options = useMemo(() => {
    const real = products
      .filter((p) => p.id !== SENTINEL_PRODUCT_ID)
      .sort((a, b) => a.name.localeCompare(b.name));
    const sentinel = products.find((p) => p.id === SENTINEL_PRODUCT_ID);
    return { real, sentinel };
  }, [products]);

  const noChange = selected === variant.productId || selected === "";

  const save = async () => {
    if (noChange) return;
    setSubmitting(true);
    setErrMsg("");
    const r = await updateProductVariant(variant.id, { productId: selected });
    setSubmitting(false);
    if (r.kind === "ok") {
      onSuccess(r.data);
      return;
    }
    if (r.kind === "forbidden") {
      setErrMsg("You do not have permission to reclassify variants.");
    } else if (r.kind === "validation") {
      setErrMsg(typeof r.message === "string" ? r.message : r.message.join("; "));
    } else if (r.kind === "network_error") {
      setErrMsg("Network error. Reclassification requires a live connection.");
    } else {
      setErrMsg("Unexpected response from the server.");
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => (submitting ? undefined : onClose())}
      title="Assign a product"
      testId="change-product-modal"
      closeOnScrim={!submitting}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="h-[28px] px-3 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[12.5px] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={submitting || noChange}
            data-testid="change-product-save"
            className="h-[28px] px-4 rounded-[3px] bg-[var(--color-navy-700)] text-white text-[12.5px] font-medium disabled:opacity-50"
          >
            {submitting ? "Saving..." : "Assign product"}
          </button>
        </>
      }
    >
      <div className="text-[12.5px] text-[var(--color-ink-700)] leading-[1.55] mb-3">
        Move{" "}
        <span className="font-mono text-[var(--color-ink-900)]">{variant.supplierSkuCode}</span> to
        its real product. This lifts it out of{" "}
        <span className="font-medium">{PENDING_CLASSIFICATION_LABEL}</span> so it stops showing as
        pending.
      </div>

      {loadError && (
        <div className="mb-3 px-3 py-2 rounded-[3px] bg-[var(--color-danger-100)] text-[var(--color-danger-700)] text-[12px]">
          {loadError}
        </div>
      )}

      <label className="flex flex-col gap-1 mb-1">
        <span className="text-[10.5px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] font-medium">
          Product
        </span>
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          disabled={submitting}
          data-testid="change-product-select"
          className="h-[28px] px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[12.5px] w-full"
        >
          <option value="">Select a product...</option>
          {options.real.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
          {options.sentinel && (
            <option value={options.sentinel.id}>
              {PENDING_CLASSIFICATION_LABEL} (leave pending)
            </option>
          )}
        </select>
      </label>

      {errMsg && (
        <div
          role="alert"
          data-testid="change-product-error"
          className="mt-2 px-3 py-2 rounded-[3px] bg-[var(--color-danger-50)] border border-[var(--color-danger-100)] text-[12px] text-[var(--color-danger-700)]"
        >
          {errMsg}
        </div>
      )}
    </Modal>
  );
}
