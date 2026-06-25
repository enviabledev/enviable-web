"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import ProductTypeFilterChip from "@/components/products/ProductTypeFilterChip";
import SimilarityWarningModal from "@/components/products/SimilarityWarningModal";
import {
  flattenVariantOptions,
  listCounterparties,
  listProducts,
  parseSimilarVariantConflict,
  type ApiResult,
  type CreatePoBody,
  type CreatePoLine,
  type Counterparty,
  type PoDetail,
  type ProductType,
  type ProductWithVariants,
  type SimilarVariantConflict,
} from "@/lib/api";
import { formatNGN } from "@/lib/format";
import { useVariantTypeMap } from "@/lib/products/use-variant-type-map";

// A line references a variant by EITHER the picker (existing id) OR a free-text
// SKU (the auto-create path for a variant not yet in the catalogue). mode
// tracks which input is active; overrideSimilarityCheck is set per-line after
// the user picks "Create new anyway" on the similarity warning for that line.
type LineRow = {
  key: string;
  mode: "picker" | "sku";
  productVariantId: string;
  productVariantSku: string;
  overrideSimilarityCheck: boolean;
  quantityOrdered: string;
  unitPrice: string;
};

export type PoFormInitial = {
  supplierId: string;
  currency: string;
  expectedShipDate: string;
  paymentTerms: string;
  lines: { productVariantId: string; quantityOrdered: number; unitPrice: string }[];
};

export type PoFormProps = {
  mode: "create" | "edit";
  initial?: PoFormInitial;
  onSubmit: (body: CreatePoBody) => Promise<ApiResult<PoDetail>>;
  submitLabel?: string;
};

let nextKey = 0;
const newKey = () => `line-${++nextKey}`;

const EMPTY_LINE = (): LineRow => ({
  key: newKey(),
  mode: "picker",
  productVariantId: "",
  productVariantSku: "",
  overrideSimilarityCheck: false,
  quantityOrdered: "1",
  unitPrice: "",
});

const UNIT_PRICE_RE = /^\d+(\.\d{1,2})?$/;

export default function PoForm({ mode, initial, onSubmit, submitLabel }: PoFormProps) {
  const [suppliers, setSuppliers] = useState<Counterparty[]>([]);
  const [products, setProducts] = useState<ProductWithVariants[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [supplierLoadError, setSupplierLoadError] = useState<string | null>(null);
  const [productLoadError, setProductLoadError] = useState<string | null>(null);

  const [supplierId, setSupplierId] = useState(initial?.supplierId ?? "");
  const [currency, setCurrency] = useState(initial?.currency ?? "USD");
  const [expectedShipDate, setExpectedShipDate] = useState(initial?.expectedShipDate ?? "");
  const [paymentTerms, setPaymentTerms] = useState(initial?.paymentTerms ?? "");
  const [lines, setLines] = useState<LineRow[]>(() =>
    initial && initial.lines.length > 0
      ? initial.lines.map((l) => ({
          key: newKey(),
          mode: "picker" as const,
          productVariantId: l.productVariantId,
          productVariantSku: "",
          overrideSimilarityCheck: false,
          quantityOrdered: String(l.quantityOrdered),
          unitPrice: l.unitPrice,
        }))
      : [EMPTY_LINE()],
  );

  const [submitting, setSubmitting] = useState(false);
  const [serverMessages, setServerMessages] = useState<string[]>([]);
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);

  // Similarity warning: the backend 409 for a SKU-mode line that is suspiciously
  // close to an existing variant. We remember which line key it was raised for so
  // "Use existing" / "Create new anyway" apply to that specific line, then
  // resubmit. A ref mirrors the pending line so the modal callbacks read it.
  const [similarConflict, setSimilarConflict] = useState<{
    lineKey: string;
    conflict: SimilarVariantConflict;
  } | null>(null);
  const linesRef = useRef<LineRow[]>(lines);
  linesRef.current = lines;

  useEffect(() => {
    const ctrl = new AbortController();
    listCounterparties({ type: "SUPPLIER", status: "ACTIVE" }, ctrl.signal).then((r) => {
      if (ctrl.signal.aborted) return;
      if (r.kind === "ok") setSuppliers(r.data);
      else if (r.kind === "forbidden") setSupplierLoadError("You do not have permission to view suppliers (counterparty.read required).");
      else if (r.kind === "unauthorized") setLoadError("Your session has expired.");
      else if (r.kind === "network_error") setLoadError(r.message);
      else if ("message" in r) setSupplierLoadError(typeof r.message === "string" ? r.message : r.message.join("; "));
    });
    listProducts(ctrl.signal).then((r) => {
      if (ctrl.signal.aborted) return;
      if (r.kind === "ok") setProducts(r.data);
      else if (r.kind === "forbidden") setProductLoadError("You do not have permission to view the product catalogue (pricelist.read required). This is a known backend permission gap; Procurement Officer needs product.read.");
      else if ("message" in r) setProductLoadError(typeof r.message === "string" ? r.message : r.message.join("; "));
    });
    return () => ctrl.abort();
  }, []);

  const allVariantOptions = useMemo(() => flattenVariantOptions(products), [products]);
  const variantById = useMemo(() => {
    const m = new Map<string, (typeof allVariantOptions)[number]>();
    for (const v of allVariantOptions) m.set(v.productVariantId, v);
    return m;
  }, [allVariantOptions]);

  // Type filter chip (prompt 45). A PO can mix wheeler types (Enviable orders
  // both from VSK), so this is a convenience filter, not enforcement. /api/products
  // omits productType, so it is read from the shared variant-type map.
  const variantTypeMap = useVariantTypeMap();
  const [typeFilter, setTypeFilter] = useState<ProductType | "ALL">("ALL");
  const variantOptions = useMemo(() => {
    if (typeFilter === "ALL") return allVariantOptions;
    return allVariantOptions.filter((v) => variantTypeMap.get(v.productVariantId) === typeFilter);
  }, [allVariantOptions, typeFilter, variantTypeMap]);

  const lineTotal = (l: LineRow): number => {
    const q = Number(l.quantityOrdered);
    const p = Number(l.unitPrice);
    if (!Number.isFinite(q) || !Number.isFinite(p)) return 0;
    return q * p;
  };

  const orderTotal = lines.reduce((sum, l) => sum + lineTotal(l), 0);

  const onLineChange = (key: string, patch: Partial<LineRow>) => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };
  const onLineRemove = (key: string) => {
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((l) => l.key !== key)));
  };
  const onLineAdd = () => setLines((prev) => [...prev, EMPTY_LINE()]);

  const onPickVariant = (key: string, variantId: string) => {
    const v = variantById.get(variantId);
    setLines((prev) =>
      prev.map((l) =>
        l.key === key
          ? {
              ...l,
              productVariantId: variantId,
              // Pre-fill unitPrice with the variant's current market price as a starting hint.
              unitPrice: l.unitPrice === "" && v ? v.currentMarketPrice : l.unitPrice,
            }
          : l,
      ),
    );
  };

  // Switch a line between the picker (existing variant by id) and a free-text
  // SKU field (auto-create a new variant). Switching resets the other input and
  // any per-line override so a stale value never leaks into the request.
  const onToggleLineMode = (key: string) => {
    setLines((prev) =>
      prev.map((l) =>
        l.key === key
          ? l.mode === "picker"
            ? { ...l, mode: "sku", productVariantId: "", overrideSimilarityCheck: false }
            : { ...l, mode: "picker", productVariantSku: "", overrideSimilarityCheck: false }
          : l,
      ),
    );
  };

  // Client-side validation: surfaces obvious shape problems before posting.
  // The server is still authoritative; we just save a round-trip on the easy ones.
  const clientErrors = (): string[] => {
    const errs: string[] = [];
    if (!supplierId) errs.push("Pick a supplier.");
    if (!currency.trim()) errs.push("Currency is required.");
    if (lines.length === 0) errs.push("At least one line is required.");
    lines.forEach((l, i) => {
      if (l.mode === "picker" && !l.productVariantId) {
        errs.push(`Line ${i + 1}: pick a product variant.`);
      }
      if (l.mode === "sku" && !l.productVariantSku.trim()) {
        errs.push(`Line ${i + 1}: enter a supplier SKU.`);
      }
      const q = Number(l.quantityOrdered);
      if (!Number.isInteger(q) || q < 1) errs.push(`Line ${i + 1}: quantity must be an integer >= 1.`);
      if (!UNIT_PRICE_RE.test(l.unitPrice)) errs.push(`Line ${i + 1}: unit price must be a decimal with up to 2 places.`);
    });
    return errs;
  };

  // Build a line for the wire from a form row. SKU-mode lines send
  // productVariantSku (+ the per-line override when set); picker lines send the
  // id. CreatePoLine only types the id form, so the SKU shape is attached as an
  // extra field the backend accepts (PoLineDto: exactly one of id/sku).
  const toWireLine = (l: LineRow): CreatePoLine => {
    const base = { quantityOrdered: Number(l.quantityOrdered), unitPrice: l.unitPrice };
    if (l.mode === "sku") {
      return {
        ...base,
        productVariantSku: l.productVariantSku.trim(),
        ...(l.overrideSimilarityCheck ? { overrideSimilarityCheck: true } : {}),
      } as CreatePoLine & { productVariantSku: string; overrideSimilarityCheck?: boolean };
    }
    return { ...base, productVariantId: l.productVariantId };
  };

  // Submit the current line set. Shared by the initial submit and the
  // resubmit after a similarity-warning choice (which mutated a line first).
  const submitLines = async (currentLines: LineRow[]) => {
    const body: CreatePoBody = {
      supplierId,
      currency: currency.trim(),
      expectedShipDate: expectedShipDate || undefined,
      paymentTerms: paymentTerms.trim() || undefined,
      lines: currentLines.map(toWireLine),
    };
    setSubmitting(true);
    const r = await onSubmit(body);
    setSubmitting(false);
    if (r.kind === "ok") {
      setSimilarConflict(null);
      return; // page handles routing
    }
    if (r.kind === "conflict") {
      // Distinguish the similar-variant 409 (open the warning modal for the
      // offending SKU line) from any other conflict (generic banner).
      const similar = parseSimilarVariantConflict(r.body);
      if (similar) {
        const offending = currentLines.find(
          (l) => l.mode === "sku" && l.productVariantSku.trim() === similar.incomingSku,
        );
        if (offending) {
          setSimilarConflict({ lineKey: offending.key, conflict: similar });
          return;
        }
      }
      setConflictMessage(r.message);
      return;
    }
    if (r.kind === "validation") {
      const msgs = Array.isArray(r.message) ? r.message : [r.message];
      setServerMessages(msgs);
      return;
    }
    if (r.kind === "forbidden") {
      setServerMessages(["You do not have permission to perform this action."]);
      return;
    }
    if (r.kind === "network_error") {
      setServerMessages([r.message]);
      return;
    }
    setServerMessages(["Unexpected response from the server."]);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setServerMessages([]);
    setConflictMessage(null);
    const local = clientErrors();
    if (local.length > 0) {
      setServerMessages(local);
      return;
    }
    await submitLines(lines);
  };

  // Similarity-warning resolution for the offending line.
  const onSimilarityChoice = async (choice: "use-existing" | "create-new" | "cancel") => {
    const pending = similarConflict;
    if (!pending) return;
    if (choice === "cancel") {
      setSimilarConflict(null);
      return;
    }
    // Apply the choice to the offending line, then resubmit the whole set.
    const nextLines = linesRef.current.map((l) => {
      if (l.key !== pending.lineKey) return l;
      if (choice === "use-existing") {
        // Use the matched existing variant: switch the line to picker mode
        // pointing at the match id, dropping the SKU and override.
        return {
          ...l,
          mode: "picker" as const,
          productVariantId: pending.conflict.match.id,
          productVariantSku: "",
          overrideSimilarityCheck: false,
        };
      }
      // create-new: keep the SKU, set the per-line override flag.
      return { ...l, overrideSimilarityCheck: true };
    });
    setLines(nextLines);
    setSimilarConflict(null);
    setServerMessages([]);
    setConflictMessage(null);
    await submitLines(nextLines);
  };

  if (loadError) {
    return (
      <div className="bg-white border border-[var(--color-danger-100)] rounded-[4px] p-4 text-[13px] text-[var(--color-danger-700)]">
        {loadError}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <section className="bg-white border border-[var(--color-border-default)] rounded-[4px] mb-4">
        <header className="px-4 py-2.5 border-b border-[var(--color-border-default)]">
          <h2 className="m-0 text-[13px] font-semibold text-[var(--color-ink-900)]">
            Order details
          </h2>
        </header>
        <div className="px-4 py-3.5 grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-3">
          <Field label="Supplier" required>
            <select
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              className="h-7 px-2 text-[12.5px] text-[var(--color-ink-900)] bg-white border border-[var(--color-border-strong)] rounded-[3px] focus:outline-none focus:border-[var(--color-navy-700)] focus:shadow-[0_0_0_2px_rgba(31,78,121,0.14)] w-full"
            >
              <option value="">{supplierLoadError ? "(suppliers unavailable)" : "Select a supplier"}</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            {supplierLoadError && (
              <p className="text-[11px] text-[var(--color-danger-700)] mt-1">{supplierLoadError}</p>
            )}
          </Field>
          <Field label="Currency" required>
            <input
              type="text"
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))}
              maxLength={3}
              className="h-7 px-2 text-[12.5px] font-mono text-[var(--color-ink-900)] bg-white border border-[var(--color-border-strong)] rounded-[3px] focus:outline-none focus:border-[var(--color-navy-700)] focus:shadow-[0_0_0_2px_rgba(31,78,121,0.14)] w-full"
              placeholder="USD"
            />
          </Field>
          <Field label="Expected Ship Date">
            <input
              type="date"
              value={expectedShipDate}
              onChange={(e) => setExpectedShipDate(e.target.value)}
              className="h-7 px-2 text-[12.5px] text-[var(--color-ink-900)] bg-white border border-[var(--color-border-strong)] rounded-[3px] focus:outline-none focus:border-[var(--color-navy-700)] focus:shadow-[0_0_0_2px_rgba(31,78,121,0.14)] w-full"
            />
          </Field>
          <Field label="Payment Terms">
            <input
              type="text"
              value={paymentTerms}
              onChange={(e) => setPaymentTerms(e.target.value)}
              placeholder="e.g. 30% advance, 70% on shipment"
              className="h-7 px-2 text-[12.5px] text-[var(--color-ink-900)] bg-white border border-[var(--color-border-strong)] rounded-[3px] focus:outline-none focus:border-[var(--color-navy-700)] focus:shadow-[0_0_0_2px_rgba(31,78,121,0.14)] w-full"
            />
          </Field>
        </div>
      </section>

      <section className="bg-white border border-[var(--color-border-default)] rounded-[4px] mb-4">
        <header className="px-4 py-2.5 border-b border-[var(--color-border-default)] flex items-center justify-between">
          <h2 className="m-0 text-[13px] font-semibold text-[var(--color-ink-900)] flex items-center gap-3 flex-wrap">
            Line items
            <span className="text-[11px] text-[var(--color-ink-500)] font-medium">
              {lines.length} {lines.length === 1 ? "line" : "lines"}
            </span>
            <ProductTypeFilterChip value={typeFilter} onChange={setTypeFilter} testId="po-type-filter" />
          </h2>
          <button
            type="button"
            onClick={onLineAdd}
            className="h-7 px-2.5 rounded-[3px] text-[12px] font-medium border border-[var(--color-border-strong)] bg-white text-[var(--color-navy-700)] hover:bg-[var(--color-navy-50)]"
          >
            + Add line
          </button>
        </header>
        {productLoadError && (
          <div className="px-4 py-2 text-[12px] bg-[var(--color-warning-50)] text-[var(--color-warning-700)] border-b border-[var(--color-border-default)]">
            {productLoadError}
          </div>
        )}
        <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-[13px]">
          <thead>
            <tr>
              <th className="text-left font-medium text-[11px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] px-3 py-2 bg-[var(--color-ink-100)] border-b border-[var(--color-border-default)]">
                Product Variant
              </th>
              <th className="text-right font-medium text-[11px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] px-3 py-2 bg-[var(--color-ink-100)] border-b border-[var(--color-border-default)] w-[100px]">
                Quantity
              </th>
              <th className="text-right font-medium text-[11px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] px-3 py-2 bg-[var(--color-ink-100)] border-b border-[var(--color-border-default)] w-[160px]">
                Unit Price
              </th>
              <th className="text-right font-medium text-[11px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] px-3 py-2 bg-[var(--color-ink-100)] border-b border-[var(--color-border-default)] w-[160px]">
                Line Total
              </th>
              <th className="w-[44px] bg-[var(--color-ink-100)] border-b border-[var(--color-border-default)]" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.key} className="border-b border-[var(--color-border-default)]">
                <td className="px-3 py-2">
                  {l.mode === "picker" ? (
                    <>
                      <select
                        value={l.productVariantId}
                        onChange={(e) => onPickVariant(l.key, e.target.value)}
                        data-testid="po-line-variant-select"
                        className="h-7 px-2 text-[12.5px] text-[var(--color-ink-900)] bg-white border border-[var(--color-border-strong)] rounded-[3px] focus:outline-none focus:border-[var(--color-navy-700)] focus:shadow-[0_0_0_2px_rgba(31,78,121,0.14)] w-full"
                      >
                        <option value="">
                          {productLoadError ? "(variants unavailable)" : "Select a product variant"}
                        </option>
                        {variantOptions.map((v) => (
                          <option key={v.productVariantId} value={v.productVariantId}>
                            {v.label}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => onToggleLineMode(l.key)}
                        data-testid="po-line-use-sku"
                        className="mt-1 text-[11px] text-[var(--color-navy-700)] hover:underline"
                      >
                        Variant not in the picker? Enter a SKU
                      </button>
                    </>
                  ) : (
                    <>
                      <input
                        type="text"
                        value={l.productVariantSku}
                        onChange={(e) =>
                          onLineChange(l.key, {
                            productVariantSku: e.target.value,
                            // Editing the SKU invalidates a prior override choice.
                            overrideSimilarityCheck: false,
                          })
                        }
                        placeholder="Enter supplier SKU"
                        data-testid="po-line-sku-input"
                        className="h-7 px-2 text-[12.5px] font-mono text-[var(--color-ink-900)] bg-white border border-[var(--color-navy-700)] rounded-[3px] focus:outline-none focus:shadow-[0_0_0_2px_rgba(31,78,121,0.14)] w-full"
                      />
                      <div className="mt-1 flex items-center gap-2">
                        <span className="text-[11px] text-[var(--color-ink-500)]">
                          New variant will be created on this PO.
                        </span>
                        <button
                          type="button"
                          onClick={() => onToggleLineMode(l.key)}
                          data-testid="po-line-use-picker"
                          className="text-[11px] text-[var(--color-navy-700)] hover:underline"
                        >
                          Use the picker instead
                        </button>
                      </div>
                    </>
                  )}
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={l.quantityOrdered}
                    onChange={(e) => onLineChange(l.key, { quantityOrdered: e.target.value })}
                    className="h-7 px-2 text-[12.5px] tabular-nums text-right text-[var(--color-ink-900)] bg-white border border-[var(--color-border-strong)] rounded-[3px] focus:outline-none focus:border-[var(--color-navy-700)] focus:shadow-[0_0_0_2px_rgba(31,78,121,0.14)] w-full"
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={l.unitPrice}
                    onChange={(e) => onLineChange(l.key, { unitPrice: e.target.value })}
                    placeholder="0.00"
                    className="h-7 px-2 text-[12.5px] tabular-nums text-right font-mono text-[var(--color-ink-900)] bg-white border border-[var(--color-border-strong)] rounded-[3px] focus:outline-none focus:border-[var(--color-navy-700)] focus:shadow-[0_0_0_2px_rgba(31,78,121,0.14)] w-full"
                  />
                </td>
                <td className="px-3 py-2 text-right tabular-nums font-mono text-[12px] text-[var(--color-ink-900)] font-semibold">
                  {lineTotal(l) > 0 ? formatNGN(lineTotal(l)) : "--"}
                </td>
                <td className="px-2 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => onLineRemove(l.key)}
                    disabled={lines.length <= 1}
                    title="Remove line"
                    className="w-6 h-6 grid place-items-center rounded-[3px] text-[var(--color-ink-500)] hover:bg-[var(--color-danger-50)] hover:text-[var(--color-danger-700)] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-[var(--color-ink-500)]"
                  >
                    {"×"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-[var(--color-ink-100)]">
              <td colSpan={3} className="px-3 py-2.5 text-right text-[12.5px] font-medium text-[var(--color-ink-700)]">
                Order total &middot; computed client-side as display aid; server is authoritative
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums font-mono text-[14px] font-semibold text-[var(--color-navy-800)]">
                {orderTotal > 0 ? formatNGN(orderTotal) : "--"}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
        </div>
      </section>

      {serverMessages.length > 0 && (
        <div
          role="alert"
          className="mb-4 px-3.5 py-2.5 rounded-[3px] border"
          style={{
            background: "var(--color-danger-50)",
            borderColor: "var(--color-danger-100)",
            color: "var(--color-danger-700)",
          }}
        >
          <div className="font-semibold text-[12.5px] mb-1">
            {serverMessages.length === 1 ? "Cannot save" : `Cannot save: ${serverMessages.length} issues`}
          </div>
          <ul className="list-disc list-inside text-[12px] space-y-0.5">
            {serverMessages.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </div>
      )}

      {conflictMessage && (
        <div
          role="alert"
          className="mb-4 px-3.5 py-2.5 rounded-[3px] border"
          style={{
            background: "var(--color-warning-50)",
            borderColor: "var(--color-warning-100)",
            color: "var(--color-warning-700)",
          }}
        >
          <div className="font-semibold text-[12.5px] mb-0.5">Conflict</div>
          <div className="text-[12px]">{conflictMessage}</div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-end gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="h-8 px-3.5 rounded-[3px] text-[13px] font-medium text-white disabled:opacity-50 inline-flex items-center justify-center"
          style={{ background: "var(--color-navy-700)" }}
        >
          {submitting ? (mode === "create" ? "Creating..." : "Saving...") : submitLabel ?? (mode === "create" ? "Create Draft" : "Save Changes")}
        </button>
      </div>

      <SimilarityWarningModal
        open={similarConflict !== null}
        conflict={similarConflict?.conflict ?? null}
        contextLabel="this purchase-order line"
        busy={submitting}
        onChoose={onSimilarityChoice}
      />
    </form>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--color-ink-500)] mb-1">
        {label}
        {required && <span className="text-[var(--color-danger-700)] ml-1">*</span>}
      </span>
      {children}
    </label>
  );
}
