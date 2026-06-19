"use client";

/**
 * Record proforma invoice (prompt 35). The supplier responds to a PO with their
 * proforma (CIF terms + line prices); a pi.review user records it against the
 * PO here. Creates the PI as PENDING_REVIEW (POST
 * /api/purchase-orders/:poId/proforma-invoices); the existing PI detail page's
 * approve flow then activates it and pulls the PO to PI_RECEIVED.
 *
 * Lines are pre-seeded from the PO's own lines (same variant, quantity, unit
 * price) so the user confirms/adjusts against the supplier's document rather
 * than retyping. Pre-seeded lines keep their variant even if it is now
 * DISCONTINUED (an existing commitment; shown with a tag and not re-pickable);
 * NEW lines use the ACTIVE-only variant picker.
 *
 * Online-only: the create is a transactional write; offline the submit is
 * disabled with an honest notice.
 */
import { useEffect, useMemo, useState } from "react";

import Modal from "@/components/ui/Modal";
import {
  createProformaInvoice,
  flattenVariantOptions,
  type CreateProformaInvoiceBody,
  type PoLine,
  type ProductWithVariants,
  type ProformaInvoice,
} from "@/lib/api";
import { formatNGN } from "@/lib/format";
import { useConnectivity } from "@/lib/sync/connectivity";

const MONEY = /^\d+(\.\d{1,2})?$/;

type LineDraft = {
  key: string;
  productVariantId: string;
  quantity: string;
  unitPrice: string;
  // Pre-seeded from a PO line: the variant is fixed (existing commitment), even
  // if it is now DISCONTINUED. New lines use the ACTIVE-only picker.
  preseeded: boolean;
};

type VariantMeta = { label: string; discontinued: boolean };

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
function plusDaysISO(base: string, days: number): string {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function RecordProformaInvoiceModal({
  open,
  onClose,
  poId,
  poLines,
  products,
  isRevision,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  poId: string;
  poLines: PoLine[];
  products: ProductWithVariants[];
  isRevision: boolean;
  onSuccess: (pi: ProformaInvoice) => void;
}) {
  const { state: connState } = useConnectivity();
  const offline = connState === "offline";

  const [piNumber, setPiNumber] = useState("");
  const [issueDate, setIssueDate] = useState("");
  const [validityUntil, setValidityUntil] = useState("");
  const [freight, setFreight] = useState("");
  const [insurance, setInsurance] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [portOfLoading, setPortOfLoading] = useState("");
  const [portOfDischarge, setPortOfDischarge] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [newCounter, setNewCounter] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Label + status for EVERY variant (incl. discontinued), for pre-seeded line
  // display. The new-line picker uses the ACTIVE-only subset below.
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

  // Reset + pre-seed from the PO lines each time the modal opens.
  useEffect(() => {
    if (!open) return;
    const today = todayISO();
    setPiNumber("");
    setIssueDate(today);
    setValidityUntil(plusDaysISO(today, 30));
    setFreight("");
    setInsurance("");
    setPaymentTerms("");
    setPortOfLoading("");
    setPortOfDischarge("");
    setLines(
      poLines.map((l) => ({
        key: `po-${l.id}`,
        productVariantId: l.productVariantId,
        quantity: String(l.quantityOrdered),
        unitPrice: l.unitPrice,
        preseeded: true,
      })),
    );
    setNewCounter(0);
    setSubmitting(false);
    setError("");
  }, [open, poLines]);

  const updateLine = (key: string, patch: Partial<LineDraft>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const addLine = () => {
    setLines((prev) => [
      ...prev,
      { key: `new-${newCounter}`, productVariantId: "", quantity: "1", unitPrice: "", preseeded: false },
    ]);
    setNewCounter((n) => n + 1);
  };
  const removeLine = (key: string) =>
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((l) => l.key !== key)));

  const lineValid = (l: LineDraft) =>
    l.productVariantId.length > 0 &&
    /^\d+$/.test(l.quantity) &&
    parseInt(l.quantity, 10) >= 1 &&
    MONEY.test(l.unitPrice.trim());

  const allLinesValid = lines.length >= 1 && lines.every(lineValid);
  const canSubmit = piNumber.trim().length > 0 && allLinesValid && !offline && !submitting;

  // Client-side preview of the CIF total (server is the source of truth).
  const goods = lines.reduce((acc, l) => {
    const q = parseInt(l.quantity, 10);
    const p = Number(l.unitPrice);
    return acc + (Number.isFinite(q) && Number.isFinite(p) ? q * p : 0);
  }, 0);
  const freightNum = MONEY.test(freight.trim()) ? Number(freight) : 0;
  const insuranceNum = MONEY.test(insurance.trim()) ? Number(insurance) : 0;
  const grand = goods + freightNum + insuranceNum;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError("");
    const body: CreateProformaInvoiceBody = {
      piNumber: piNumber.trim(),
      issueDate: issueDate || undefined,
      validityUntil: validityUntil || undefined,
      freightAmount: freight.trim() || undefined,
      insuranceAmount: insurance.trim() || undefined,
      paymentTerms: paymentTerms.trim() || undefined,
      portOfLoading: portOfLoading.trim() || undefined,
      portOfDischarge: portOfDischarge.trim() || undefined,
      lines: lines.map((l) => ({
        productVariantId: l.productVariantId,
        quantity: parseInt(l.quantity, 10),
        unitPrice: l.unitPrice.trim(),
      })),
    };
    const r = await createProformaInvoice(poId, body);
    if (r.kind === "ok") {
      onSuccess(r.data);
      return;
    }
    setSubmitting(false);
    if (r.kind === "forbidden") {
      setError("You do not have permission to record proforma invoices (requires pi.review).");
    } else if (r.kind === "validation") {
      setError(typeof r.message === "string" ? r.message : r.message.join("; "));
    } else if (r.kind === "conflict") {
      setError(r.message || "The server rejected this proforma invoice.");
    } else if (r.kind === "network_error") {
      setError("Network error. Recording a proforma invoice requires a live connection.");
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
      title={isRevision ? "Record proforma invoice (revision)" : "Record proforma invoice"}
      testId="record-pi-modal"
      maxWidthClass="max-w-[680px]"
      footer={
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 w-full">
          <div className="text-[12px] text-[var(--color-ink-600)] sm:mr-auto" data-testid="record-pi-grand-total">
            CIF total preview: <span className="font-mono font-semibold text-[var(--color-ink-900)]">{formatNGN(grand)}</span>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="h-[32px] px-3 rounded-[3px] border border-[var(--color-border-strong)] bg-white text-[var(--color-ink-900)] text-[12.5px] font-medium hover:bg-[var(--color-ink-100)] order-2 sm:order-1"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={!canSubmit}
              data-testid="record-pi-submit"
              className="h-[32px] px-4 rounded-[3px] bg-[var(--color-navy-700)] text-white text-[12.5px] font-medium disabled:opacity-50 order-1 sm:order-2"
            >
              {submitting ? "Recording..." : "Record proforma invoice"}
            </button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        {offline && (
          <div className="px-3 py-2 rounded-[3px] bg-[var(--color-warning-100)] text-[var(--color-warning-700)] text-[12px]">
            Recording a proforma invoice requires a live connection. Reconnect to submit.
          </div>
        )}
        {error && (
          <div
            role="alert"
            data-testid="record-pi-error"
            className="px-3 py-2 rounded-[3px] bg-[var(--color-danger-50)] border border-[var(--color-danger-100)] text-[12.5px] text-[var(--color-danger-700)]"
          >
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className={labelCls}>PI number (supplier reference)</span>
            <input
              type="text"
              value={piNumber}
              onChange={(e) => setPiNumber(e.target.value)}
              disabled={submitting}
              data-testid="record-pi-number"
              className={`${inputCls} font-mono`}
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className={labelCls}>Issue date</span>
              <input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} disabled={submitting} data-testid="record-pi-issue-date" className={inputCls} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelCls}>Valid until</span>
              <input type="date" value={validityUntil} onChange={(e) => setValidityUntil(e.target.value)} disabled={submitting} className={inputCls} />
            </label>
          </div>
          <label className="flex flex-col gap-1">
            <span className={labelCls}>Freight amount</span>
            <input type="text" inputMode="decimal" value={freight} onChange={(e) => setFreight(e.target.value)} disabled={submitting} placeholder="0" className={`${inputCls} font-mono`} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelCls}>Insurance amount</span>
            <input type="text" inputMode="decimal" value={insurance} onChange={(e) => setInsurance(e.target.value)} disabled={submitting} placeholder="0" className={`${inputCls} font-mono`} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelCls}>Port of loading</span>
            <input type="text" value={portOfLoading} onChange={(e) => setPortOfLoading(e.target.value)} disabled={submitting} className={inputCls} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelCls}>Port of discharge</span>
            <input type="text" value={portOfDischarge} onChange={(e) => setPortOfDischarge(e.target.value)} disabled={submitting} className={inputCls} />
          </label>
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className={labelCls}>Payment terms</span>
            <textarea value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} disabled={submitting} rows={2} className="w-full px-2 py-1.5 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[13px]" />
          </label>
        </div>

        <div className="border-t border-[var(--color-border-default)] pt-3">
          <div className="flex items-center justify-between mb-2">
            <h3 className="m-0 text-[12.5px] font-semibold text-[var(--color-ink-900)]">Lines</h3>
            <button
              type="button"
              onClick={addLine}
              disabled={submitting}
              data-testid="record-pi-add-line"
              className="h-[28px] px-3 rounded-[3px] border border-[var(--color-border-strong)] bg-white text-[var(--color-ink-900)] text-[12px] font-medium hover:bg-[var(--color-ink-100)]"
            >
              Add line
            </button>
          </div>
          <div className="flex flex-col gap-2" data-testid="record-pi-lines">
            {lines.map((l, idx) => {
              const meta = variantMeta.get(l.productVariantId);
              return (
                <div
                  key={l.key}
                  data-testid="record-pi-line"
                  className="border border-[var(--color-border-default)] rounded-[3px] p-2.5 flex flex-col gap-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    {l.preseeded ? (
                      <div className="min-w-0 text-[12.5px] text-[var(--color-ink-900)]">
                        <span className="font-medium">{meta?.label ?? l.productVariantId}</span>
                        {meta?.discontinued && (
                          <span
                            data-testid="record-pi-line-discontinued"
                            className="ml-2 inline-flex items-center h-[16px] px-1.5 rounded-full text-[10px] font-semibold uppercase tracking-[0.02em] bg-[var(--color-ink-100)] text-[var(--color-ink-700)]"
                          >
                            Discontinued
                          </span>
                        )}
                      </div>
                    ) : (
                      <label className="flex-1 flex flex-col gap-1 min-w-0">
                        <span className={labelCls}>Variant</span>
                        <select
                          value={l.productVariantId}
                          onChange={(e) => updateLine(l.key, { productVariantId: e.target.value })}
                          disabled={submitting}
                          data-testid={`record-pi-line-variant-${idx}`}
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
                    <button
                      type="button"
                      onClick={() => removeLine(l.key)}
                      disabled={submitting || lines.length <= 1}
                      aria-label="Remove line"
                      data-testid={`record-pi-remove-line-${idx}`}
                      className="flex-shrink-0 w-[24px] h-[24px] inline-flex items-center justify-center rounded-[3px] text-[14px] leading-none text-[var(--color-ink-500)] hover:bg-[var(--color-danger-100)] hover:text-[var(--color-danger-700)] disabled:opacity-40"
                    >
                      &times;
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex flex-col gap-1">
                      <span className={labelCls}>Quantity</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={l.quantity}
                        onChange={(e) => updateLine(l.key, { quantity: e.target.value })}
                        disabled={submitting}
                        data-testid={`record-pi-line-qty-${idx}`}
                        className={`${inputCls} font-mono`}
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className={labelCls}>Unit price</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={l.unitPrice}
                        onChange={(e) => updateLine(l.key, { unitPrice: e.target.value })}
                        disabled={submitting}
                        data-testid={`record-pi-line-price-${idx}`}
                        className={`${inputCls} font-mono`}
                      />
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Modal>
  );
}
