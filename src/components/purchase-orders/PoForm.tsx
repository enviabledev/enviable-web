"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";

import {
  flattenVariantOptions,
  listCounterparties,
  listProducts,
  type ApiResult,
  type CreatePoBody,
  type Counterparty,
  type PoDetail,
  type ProductWithVariants,
} from "@/lib/api";
import { formatNGN } from "@/lib/format";

type LineRow = {
  key: string;
  productVariantId: string;
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
  productVariantId: "",
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
          productVariantId: l.productVariantId,
          quantityOrdered: String(l.quantityOrdered),
          unitPrice: l.unitPrice,
        }))
      : [EMPTY_LINE()],
  );

  const [submitting, setSubmitting] = useState(false);
  const [serverMessages, setServerMessages] = useState<string[]>([]);
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);

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

  const variantOptions = useMemo(() => flattenVariantOptions(products), [products]);
  const variantById = useMemo(() => {
    const m = new Map<string, (typeof variantOptions)[number]>();
    for (const v of variantOptions) m.set(v.productVariantId, v);
    return m;
  }, [variantOptions]);

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

  // Client-side validation: surfaces obvious shape problems before posting.
  // The server is still authoritative; we just save a round-trip on the easy ones.
  const clientErrors = (): string[] => {
    const errs: string[] = [];
    if (!supplierId) errs.push("Pick a supplier.");
    if (!currency.trim()) errs.push("Currency is required.");
    if (lines.length === 0) errs.push("At least one line is required.");
    lines.forEach((l, i) => {
      if (!l.productVariantId) errs.push(`Line ${i + 1}: pick a product variant.`);
      const q = Number(l.quantityOrdered);
      if (!Number.isInteger(q) || q < 1) errs.push(`Line ${i + 1}: quantity must be an integer >= 1.`);
      if (!UNIT_PRICE_RE.test(l.unitPrice)) errs.push(`Line ${i + 1}: unit price must be a decimal with up to 2 places.`);
    });
    return errs;
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
    const body: CreatePoBody = {
      supplierId,
      currency: currency.trim(),
      expectedShipDate: expectedShipDate || undefined,
      paymentTerms: paymentTerms.trim() || undefined,
      lines: lines.map((l) => ({
        productVariantId: l.productVariantId,
        quantityOrdered: Number(l.quantityOrdered),
        unitPrice: l.unitPrice,
      })),
    };
    setSubmitting(true);
    const r = await onSubmit(body);
    setSubmitting(false);
    if (r.kind === "ok") return; // page handles routing
    if (r.kind === "validation") {
      const msgs = Array.isArray(r.message) ? r.message : [r.message];
      setServerMessages(msgs);
      return;
    }
    if (r.kind === "conflict") {
      setConflictMessage(r.message);
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
        <div className="px-4 py-3.5 grid grid-cols-2 gap-x-5 gap-y-3">
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
          <h2 className="m-0 text-[13px] font-semibold text-[var(--color-ink-900)]">
            Line items
            <span className="text-[11px] text-[var(--color-ink-500)] font-medium ml-2">
              {lines.length} {lines.length === 1 ? "line" : "lines"}
            </span>
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
        <table className="w-full text-[13px]">
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
                  <select
                    value={l.productVariantId}
                    onChange={(e) => onPickVariant(l.key, e.target.value)}
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

      <div className="flex items-center justify-end gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="h-8 px-3.5 rounded-[3px] text-[13px] font-medium text-white disabled:opacity-50"
          style={{ background: "var(--color-navy-700)" }}
        >
          {submitting ? (mode === "create" ? "Creating..." : "Saving...") : submitLabel ?? (mode === "create" ? "Create Draft" : "Save Changes")}
        </button>
      </div>
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
