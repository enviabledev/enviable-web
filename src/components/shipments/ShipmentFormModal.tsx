"use client";

/**
 * Record / edit a shipment (prompt 38). Create runs from a PO context with the
 * manifest pre-seeded from the PO lines; edit runs from the shipment detail
 * (pre-receive only). Same form shape, mirroring the PI-create pre-seeding.
 *
 * Manifest lines are DECLARED quantities, independent of the PO quantities, so
 * partial fulfilment (ship fewer than ordered, or across several shipments) is
 * the natural case: adjust quantities or drop lines. Pre-seeded lines keep
 * their variant even if it is now DISCONTINUED (the supplier is fulfilling an
 * existing order); only NEW lines use the ACTIVE-only picker.
 *
 * Online-only. Optional logistics parties (freight forwarder / clearing agent /
 * insurer) are not surfaced here yet; see BACKLOG.
 */
import { useEffect, useMemo, useState } from "react";

import Modal from "@/components/ui/Modal";
import {
  createShipment,
  flattenVariantOptions,
  updateShipment,
  type CreateShipmentBody,
  type ProductWithVariants,
  type ShipmentDetail,
} from "@/lib/api";
import { useConnectivity } from "@/lib/sync/connectivity";

export type ShipmentSeedLine = { productVariantId: string; quantityDeclared: number };

type LineDraft = {
  key: string;
  productVariantId: string;
  quantityDeclared: string;
  // Pre-seeded lines keep their (possibly discontinued) variant; new lines pick
  // from the ACTIVE-only options.
  preseeded: boolean;
};

type VariantMeta = { label: string; discontinued: boolean };

export default function ShipmentFormModal({
  open,
  onClose,
  mode,
  poId,
  shipmentId,
  seed,
  products,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  mode: "create" | "edit";
  poId?: string;
  shipmentId?: string;
  seed: {
    billOfLadingNumber?: string | null;
    vesselName?: string | null;
    etd?: string | null;
    eta?: string | null;
    lines: ShipmentSeedLine[];
  };
  products: ProductWithVariants[];
  onSuccess: (shipment: ShipmentDetail) => void;
}) {
  const { state: connState } = useConnectivity();
  const offline = connState === "offline";

  const [bl, setBl] = useState("");
  const [vessel, setVessel] = useState("");
  const [etd, setEtd] = useState("");
  const [eta, setEta] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [newCounter, setNewCounter] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const variantMeta = useMemo(() => {
    const m = new Map<string, VariantMeta>();
    for (const p of products) {
      for (const v of p.variants) {
        const attrs = [v.variantAttributes?.model, v.variantAttributes?.colour]
          .filter((x): x is string => typeof x === "string" && x.length > 0)
          .join(" ");
        m.set(v.id, {
          label: `${p.name}${attrs ? ` ${attrs}` : ""} [${v.supplierSkuCode}]`,
          discontinued: v.status !== "ACTIVE",
        });
      }
    }
    return m;
  }, [products]);

  const activeOptions = useMemo(() => flattenVariantOptions(products), [products]);

  useEffect(() => {
    if (!open) return;
    setBl(seed.billOfLadingNumber ?? "");
    setVessel(seed.vesselName ?? "");
    setEtd(seed.etd ? seed.etd.slice(0, 10) : "");
    setEta(seed.eta ? seed.eta.slice(0, 10) : "");
    setLines(
      seed.lines.map((l, i) => ({
        key: `seed-${i}-${l.productVariantId}`,
        productVariantId: l.productVariantId,
        quantityDeclared: String(l.quantityDeclared),
        preseeded: true,
      })),
    );
    setNewCounter(0);
    setSubmitting(false);
    setError("");
  }, [open, seed]);

  const updateLine = (key: string, patch: Partial<LineDraft>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const addLine = () => {
    setLines((prev) => [
      ...prev,
      { key: `new-${newCounter}`, productVariantId: "", quantityDeclared: "1", preseeded: false },
    ]);
    setNewCounter((n) => n + 1);
  };
  const removeLine = (key: string) =>
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((l) => l.key !== key)));

  const lineValid = (l: LineDraft) =>
    l.productVariantId.length > 0 && /^\d+$/.test(l.quantityDeclared) && parseInt(l.quantityDeclared, 10) >= 1;
  const canSubmit = lines.length >= 1 && lines.every(lineValid) && !offline && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError("");
    const body: CreateShipmentBody = {
      billOfLadingNumber: bl.trim() || undefined,
      vesselName: vessel.trim() || undefined,
      etd: etd || undefined,
      eta: eta || undefined,
      manifestLines: lines.map((l) => ({
        productVariantId: l.productVariantId,
        quantityDeclared: parseInt(l.quantityDeclared, 10),
      })),
    };
    const r =
      mode === "create"
        ? await createShipment(poId ?? "", body)
        : await updateShipment(shipmentId ?? "", body);
    if (r.kind === "ok") {
      onSuccess(r.data);
      return;
    }
    setSubmitting(false);
    if (r.kind === "forbidden") {
      setError("You do not have permission to manage shipments (requires shipment.manage).");
    } else if (r.kind === "conflict") {
      setError(r.message || "This shipment can no longer be edited.");
    } else if (r.kind === "validation") {
      setError(typeof r.message === "string" ? r.message : r.message.join("; "));
    } else if (r.kind === "network_error") {
      setError("Network error. Recording a shipment requires a live connection.");
    } else {
      setError("Unexpected response from the server.");
    }
  };

  const labelCls = "text-[11px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] font-medium";
  const inputCls = "h-[32px] w-full px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[13px]";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={mode === "create" ? "Record shipment" : "Edit shipment"}
      testId="shipment-form-modal"
      maxWidthClass="max-w-[620px]"
      footer={
        <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            data-testid="shipment-submit"
            className="h-[32px] px-4 rounded-[3px] bg-[var(--color-navy-700)] text-white text-[12.5px] font-medium disabled:opacity-50 w-full sm:w-auto order-1 sm:order-2"
          >
            {submitting ? "Saving..." : mode === "create" ? "Record shipment" : "Save changes"}
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
      <div className="flex flex-col gap-3">
        {offline && (
          <div className="px-3 py-2 rounded-[3px] bg-[var(--color-warning-100)] text-[var(--color-warning-700)] text-[12px]">
            Recording a shipment requires a live connection. Reconnect to continue.
          </div>
        )}
        {error && (
          <div
            role="alert"
            data-testid="shipment-error"
            className="px-3 py-2 rounded-[3px] bg-[var(--color-danger-50)] border border-[var(--color-danger-100)] text-[12.5px] text-[var(--color-danger-700)]"
          >
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className={labelCls}>Bill of lading no.</span>
            <input type="text" value={bl} onChange={(e) => setBl(e.target.value)} disabled={submitting} data-testid="shipment-bl" className={`${inputCls} font-mono`} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelCls}>Vessel name</span>
            <input type="text" value={vessel} onChange={(e) => setVessel(e.target.value)} disabled={submitting} data-testid="shipment-vessel" className={inputCls} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelCls}>ETD</span>
            <input type="date" value={etd} onChange={(e) => setEtd(e.target.value)} disabled={submitting} data-testid="shipment-etd" className={inputCls} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelCls}>ETA</span>
            <input type="date" value={eta} onChange={(e) => setEta(e.target.value)} disabled={submitting} data-testid="shipment-eta" className={inputCls} />
          </label>
        </div>

        <div className="border-t border-[var(--color-border-default)] pt-3">
          <div className="flex items-center justify-between mb-2">
            <h3 className="m-0 text-[12.5px] font-semibold text-[var(--color-ink-900)]">Manifest lines</h3>
            <button
              type="button"
              onClick={addLine}
              disabled={submitting}
              data-testid="shipment-add-line"
              className="h-[28px] px-3 rounded-[3px] border border-[var(--color-border-strong)] bg-white text-[var(--color-ink-900)] text-[12px] font-medium hover:bg-[var(--color-ink-100)]"
            >
              Add line
            </button>
          </div>
          <div className="flex flex-col gap-2" data-testid="shipment-lines">
            {lines.map((l, idx) => {
              const meta = variantMeta.get(l.productVariantId);
              return (
                <div key={l.key} data-testid="shipment-line" className="border border-[var(--color-border-default)] rounded-[3px] p-2.5 flex items-end gap-2">
                  <div className="flex-1 min-w-0">
                    {l.preseeded ? (
                      <div className="text-[12.5px] text-[var(--color-ink-900)]">
                        <span className="font-medium">{meta?.label ?? l.productVariantId}</span>
                        {meta?.discontinued && (
                          <span
                            data-testid="shipment-line-discontinued"
                            className="ml-2 inline-flex items-center h-[16px] px-1.5 rounded-full text-[10px] font-semibold uppercase tracking-[0.02em] bg-[var(--color-ink-100)] text-[var(--color-ink-700)]"
                          >
                            Discontinued
                          </span>
                        )}
                      </div>
                    ) : (
                      <label className="flex flex-col gap-1">
                        <span className={labelCls}>Variant</span>
                        <select
                          value={l.productVariantId}
                          onChange={(e) => updateLine(l.key, { productVariantId: e.target.value })}
                          disabled={submitting}
                          data-testid={`shipment-line-variant-${idx}`}
                          className={inputCls}
                        >
                          <option value="">Select a variant…</option>
                          {activeOptions.map((o) => (
                            <option key={o.productVariantId} value={o.productVariantId}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>
                  <label className="flex flex-col gap-1 w-[110px] flex-shrink-0">
                    <span className={labelCls}>Qty shipped</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={l.quantityDeclared}
                      onChange={(e) => updateLine(l.key, { quantityDeclared: e.target.value })}
                      disabled={submitting}
                      data-testid={`shipment-line-qty-${idx}`}
                      className={`${inputCls} font-mono`}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => removeLine(l.key)}
                    disabled={submitting || lines.length <= 1}
                    aria-label="Remove line"
                    data-testid={`shipment-remove-line-${idx}`}
                    className="flex-shrink-0 w-[24px] h-[32px] inline-flex items-center justify-center rounded-[3px] text-[14px] leading-none text-[var(--color-ink-500)] hover:bg-[var(--color-danger-100)] hover:text-[var(--color-danger-700)] disabled:opacity-40"
                  >
                    &times;
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Modal>
  );
}
