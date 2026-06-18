"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";

import {
  flattenVariantOptions,
  listCustomers,
  listProducts,
  listUnits,
  SALE_FORM,
  VAT_RATE,
  type ApiResult,
  type CreateSoBody,
  type Customer,
  type ProductWithVariants,
  type SaleForm,
  type SalesOrderDetail,
  type UnitListRow,
} from "@/lib/api";
import { usePermissions } from "@/lib/auth";
import { formatNGN } from "@/lib/format";

type LineDraft = {
  key: string;
  productVariantId: string;
  saleForm: SaleForm;
  unitId: string;
  discountAmount: string;
};

export type SoFormInitial = {
  customerId: string;
  lines: { productVariantId: string; saleForm: SaleForm; unitId: string; discountAmount: string }[];
};

export type SoFormProps = {
  mode: "create" | "edit";
  initial?: SoFormInitial;
  submitLabel?: string;
  onSubmit: (body: CreateSoBody) => Promise<ApiResult<SalesOrderDetail>>;
};

let nextKey = 0;
const k = () => `so-line-${++nextKey}`;
const emptyLine = (): LineDraft => ({
  key: k(),
  productVariantId: "",
  saleForm: "CKD",
  unitId: "",
  discountAmount: "",
});

const UNIT_PRICE_RE = /^\d+(\.\d{1,2})?$/;

/**
 * Extract the named conflicts from an I-11 message. The backend emits one of
 * three shapes (sales-orders.service.ts formatI11Message):
 *
 *   - fallback (no conflicts surfaced): generic, no names -> []
 *   - single:   "Invariant I-11: unit <ENG> is already allocated to
 *                sales order <SO>."
 *   - multiple: "Invariant I-11: N units already allocated to other active
 *                sales order lines: ENG1 (on SO1), ENG2 (on SO2), ..."
 *
 * Mirrors the receipt page's `extractDuplicateSerial` regex pattern; the named
 * message is what makes the panel-and-highlight UX possible without any
 * client-side cross-referencing.
 */
function parseI11Conflicts(msg: string): { engineNumber: string; soNumber: string }[] {
  const single = msg.match(/unit\s+(\S+)\s+is already allocated to sales order\s+(\S+?)\.\s*$/);
  if (single) return [{ engineNumber: single[1]!, soNumber: single[2]! }];
  const idx = msg.lastIndexOf(":");
  if (idx >= 0) {
    const list = msg.slice(idx + 1);
    const items = list.match(/\S+\s+\(on\s+\S+?\)/g);
    if (items && items.length > 0) {
      const out: { engineNumber: string; soNumber: string }[] = [];
      for (const item of items) {
        const m = item.match(/(\S+)\s+\(on\s+(\S+?)\)/);
        if (m) out.push({ engineNumber: m[1]!, soNumber: m[2]! });
      }
      if (out.length > 0) return out;
    }
  }
  return [];
}

export default function SoForm({ mode, initial, submitLabel, onSubmit }: SoFormProps) {
  const { has } = usePermissions();
  const canDiscount = has("salesorder.discount");

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<ProductWithVariants[]>([]);
  const [availableUnits, setAvailableUnits] = useState<UnitListRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [customerId, setCustomerId] = useState(initial?.customerId ?? "");
  const [lines, setLines] = useState<LineDraft[]>(
    initial && initial.lines.length > 0
      ? initial.lines.map((l) => ({
          key: k(),
          productVariantId: l.productVariantId,
          saleForm: l.saleForm,
          unitId: l.unitId,
          discountAmount: l.discountAmount,
        }))
      : [emptyLine()],
  );

  const [submitting, setSubmitting] = useState(false);
  const [serverMessages, setServerMessages] = useState<string[]>([]);
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);
  const [forbiddenMessage, setForbiddenMessage] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    Promise.all([
      listCustomers({ status: "ACTIVE", pageSize: 100 }, ctrl.signal),
      listProducts(ctrl.signal),
      // Pull all units in IN_WAREHOUSE_CKD or IN_WAREHOUSE_CBU. The units
      // endpoint can't filter on "already allocated", so the picker shows all
      // matching-status units and relies on the I-11 409 to catch double-
      // allocation. That matches receipt's duplicate-handling pattern.
      listUnits({ pageSize: 250, status: ["IN_WAREHOUSE_CKD", "IN_WAREHOUSE_CBU"] }, ctrl.signal),
    ]).then(([cRes, pRes, uRes]) => {
      if (ctrl.signal.aborted) return;
      if (cRes.kind === "ok") setCustomers(cRes.data.data);
      else if (cRes.kind === "forbidden") setLoadError("You do not have permission to view customers (customer.read required).");
      if (pRes.kind === "ok") setProducts(pRes.data);
      if (uRes.kind === "ok") setAvailableUnits(uRes.data.data);
    });
    return () => ctrl.abort();
  }, []);

  const variantOptions = useMemo(() => flattenVariantOptions(products), [products]);
  const variantById = useMemo(() => {
    const m = new Map<string, (typeof variantOptions)[number]>();
    for (const v of variantOptions) m.set(v.productVariantId, v);
    return m;
  }, [variantOptions]);

  const selectedCustomer = customers.find((c) => c.id === customerId);

  /**
   * Units offered for a given line: must match the line's selected sale form's
   * warehouse status AND the line's selected variant. We additionally hide
   * units already chosen on OTHER lines in this same draft as a courtesy
   * (server still enforces via I-11).
   */
  const unitsForLine = (line: LineDraft): UnitListRow[] => {
    if (!line.productVariantId) return [];
    const wantedStatus = line.saleForm === "CKD" ? "IN_WAREHOUSE_CKD" : "IN_WAREHOUSE_CBU";
    const usedOnOtherLines = new Set(
      lines.filter((l) => l.key !== line.key && l.unitId).map((l) => l.unitId),
    );
    return availableUnits.filter(
      (u) =>
        u.productVariant.id === line.productVariantId &&
        u.status === wantedStatus &&
        !usedOnOtherLines.has(u.id),
    );
  };

  const setLine = (key: string, patch: Partial<LineDraft>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const removeLine = (key: string) =>
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((l) => l.key !== key)));

  const addLine = () => setLines((prev) => [...prev, emptyLine()]);

  /**
   * Tier-resolved unit price for display only. The server is authoritative
   * on save; this just gives the clerk a number to read. We use the variant's
   * currentMarketPrice as a display proxy and multiply by the tier factor
   * (ResellerStandard = 1.00, ResellerVolume = 0.97 per the seed).
   *
   * If the actual price differs (because someone has tweaked the price list),
   * the server's saved total will reflect reality; the form will then re-render
   * with the server numbers from the response.
   */
  const tierFactor = useMemo(() => {
    if (!selectedCustomer?.tier) return 1;
    if (selectedCustomer.tier.name === "ResellerVolume") return 0.97;
    return 1;
  }, [selectedCustomer]);

  const displayLineTotal = (line: LineDraft): number => {
    const v = variantById.get(line.productVariantId);
    if (!v) return 0;
    const unitPrice = Number(v.currentMarketPrice) * tierFactor;
    const disc = Number(line.discountAmount || "0");
    return Math.max(0, unitPrice - disc);
  };

  const subtotal = lines.reduce((s, l) => {
    const v = variantById.get(l.productVariantId);
    return v ? s + Number(v.currentMarketPrice) * tierFactor : s;
  }, 0);
  const discountTotal = lines.reduce((s, l) => s + Number(l.discountAmount || "0"), 0);
  const net = Math.max(0, subtotal - discountTotal);
  const vat = net * VAT_RATE;
  const total = net + vat;

  // Derived I-11 conflict mapping. The backend's named message tells us which
  // engine number(s) collided; we look each up in availableUnits to find the
  // unit id, then match against the current form's line.unitId to identify
  // which line(s) carry the offending unit. Purely local lookup, no fetches.
  const i11Conflicts = useMemo(() => {
    if (!conflictMessage || !conflictMessage.includes("I-11")) return [];
    return parseI11Conflicts(conflictMessage);
  }, [conflictMessage]);

  const engineToLineMeta = useMemo(() => {
    const map = new Map<string, { lineNumber: number; lineKey: string }>();
    lines.forEach((l, idx) => {
      if (!l.unitId) return;
      const unit = availableUnits.find((u) => u.id === l.unitId);
      if (unit) map.set(unit.engineNumber, { lineNumber: idx + 1, lineKey: l.key });
    });
    return map;
  }, [lines, availableUnits]);

  const conflictedLineKeys = useMemo(() => {
    const set = new Set<string>();
    for (const c of i11Conflicts) {
      const hit = engineToLineMeta.get(c.engineNumber);
      if (hit) set.add(hit.lineKey);
    }
    return set;
  }, [i11Conflicts, engineToLineMeta]);

  const clientErrors = (): string[] => {
    const errs: string[] = [];
    if (!customerId) errs.push("Pick a customer.");
    lines.forEach((l, i) => {
      const n = i + 1;
      if (!l.productVariantId) errs.push(`Line ${n}: pick a product variant.`);
      if (!l.unitId) errs.push(`Line ${n}: pick a unit to allocate.`);
      if (l.discountAmount && !UNIT_PRICE_RE.test(l.discountAmount)) {
        errs.push(`Line ${n}: discount must be a decimal with up to 2 places.`);
      }
      if (l.discountAmount && Number(l.discountAmount) > 0 && !canDiscount) {
        errs.push(`Line ${n}: you do not have salesorder.discount permission.`);
      }
    });
    return errs;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setServerMessages([]);
    setConflictMessage(null);
    setForbiddenMessage(null);
    const local = clientErrors();
    if (local.length > 0) {
      setServerMessages(local);
      return;
    }
    const body: CreateSoBody = {
      customerId,
      channel: "WAREHOUSE_PICKUP",
      lines: lines.map((l) => ({
        productVariantId: l.productVariantId,
        saleForm: l.saleForm,
        unitId: l.unitId,
        ...(l.discountAmount && Number(l.discountAmount) > 0
          ? { discountAmount: l.discountAmount }
          : {}),
      })),
    };
    setSubmitting(true);
    const r = await onSubmit(body);
    setSubmitting(false);
    if (r.kind === "ok") return;
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
      setForbiddenMessage("A line discount requires the salesorder.discount permission, or the action was otherwise refused.");
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
          <h2 className="m-0 text-[13px] font-semibold text-[var(--color-ink-900)]">Customer</h2>
        </header>
        <div className="px-4 py-3 grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-2 items-start">
          <label className="block">
            <span className="block text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--color-ink-500)] mb-1">
              Customer <span className="text-[var(--color-danger-700)] ml-0.5">*</span>
            </span>
            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              className="h-7 px-2 text-[12.5px] text-[var(--color-ink-900)] bg-white border border-[var(--color-border-strong)] rounded-[3px] focus:outline-none focus:border-[var(--color-navy-700)] focus:shadow-[0_0_0_2px_rgba(31,78,121,0.14)] w-full"
            >
              <option value="">Select a customer</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          {selectedCustomer && (
            <div className="text-[12px] text-[var(--color-ink-700)] pt-4">
              <div>
                <span className="text-[var(--color-ink-500)]">Tier:</span>{" "}
                <span className="font-medium">{selectedCustomer.tier?.name ?? "(none)"}</span>
              </div>
              <div className="text-[11px] text-[var(--color-ink-500)] mt-0.5">
                Unit prices are resolved by the server from this tier&apos;s price list. The total below
                is a display aid; the server&apos;s total on save is authoritative.
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="bg-white border border-[var(--color-border-default)] rounded-[4px] mb-4">
        <header className="px-4 py-2.5 border-b border-[var(--color-border-default)] flex items-center justify-between">
          <h2 className="m-0 text-[13px] font-semibold text-[var(--color-ink-900)]">
            Lines
            <span className="text-[11px] text-[var(--color-ink-500)] font-medium ml-2">
              {lines.length} {lines.length === 1 ? "line" : "lines"} &middot; each allocates a specific unit (soft reservation)
            </span>
          </h2>
          <button
            type="button"
            onClick={addLine}
            className="h-7 px-2.5 rounded-[3px] text-[12px] font-medium border border-[var(--color-border-strong)] bg-white text-[var(--color-navy-700)] hover:bg-[var(--color-navy-50)]"
          >
            + Add line
          </button>
        </header>
        <div className="divide-y divide-[var(--color-border-default)]">
          {lines.map((l, idx) => {
            const unitsForThis = unitsForLine(l);
            const variant = variantById.get(l.productVariantId);
            const displayUnitPrice = variant ? Number(variant.currentMarketPrice) * tierFactor : 0;
            const isConflicted = conflictedLineKeys.has(l.key);
            const conflictUnit = isConflicted
              ? availableUnits.find((u) => u.id === l.unitId)
              : undefined;
            const conflictOnSo = conflictUnit
              ? i11Conflicts.find((c) => c.engineNumber === conflictUnit.engineNumber)?.soNumber
              : undefined;
            return (
              <div
                key={l.key}
                className={`px-4 py-3 ${isConflicted ? "bg-[var(--color-danger-50)]" : ""}`}
                style={isConflicted ? { boxShadow: "inset 4px 0 0 var(--color-danger-700)" } : undefined}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.05em] text-[var(--color-ink-500)] flex items-center gap-2">
                    Line {idx + 1}
                    {isConflicted && (
                      <span
                        className="text-[10px] font-semibold uppercase tracking-[0.04em] px-1.5 py-0.5 rounded-[2px] text-white"
                        style={{ background: "var(--color-danger-700)" }}
                      >
                        Conflict{conflictOnSo ? `: on ${conflictOnSo}` : ""}
                      </span>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeLine(l.key)}
                    disabled={lines.length <= 1}
                    className="text-[11px] text-[var(--color-ink-500)] hover:text-[var(--color-danger-700)] disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Remove
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px_1fr] gap-3 items-start">
                  <label className="block">
                    <span className="block text-[10.5px] font-medium uppercase tracking-[0.04em] text-[var(--color-ink-500)] mb-1">
                      Product variant
                    </span>
                    <select
                      value={l.productVariantId}
                      onChange={(e) =>
                        setLine(l.key, { productVariantId: e.target.value, unitId: "" })
                      }
                      className="h-7 px-2 text-[12.5px] text-[var(--color-ink-900)] bg-white border border-[var(--color-border-strong)] rounded-[3px] focus:outline-none focus:border-[var(--color-navy-700)] focus:shadow-[0_0_0_2px_rgba(31,78,121,0.14)] w-full"
                    >
                      <option value="">Select a variant</option>
                      {variantOptions.map((v) => (
                        <option key={v.productVariantId} value={v.productVariantId}>
                          {v.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <fieldset className="block">
                    <legend className="block text-[10.5px] font-medium uppercase tracking-[0.04em] text-[var(--color-ink-500)] mb-1">
                      Sale form
                    </legend>
                    <div className="flex border border-[var(--color-border-strong)] rounded-[3px] h-7 overflow-hidden">
                      {SALE_FORM.map((sf) => (
                        <button
                          key={sf}
                          type="button"
                          onClick={() => setLine(l.key, { saleForm: sf, unitId: "" })}
                          className={`flex-1 text-[12px] font-medium ${
                            l.saleForm === sf
                              ? "bg-[var(--color-navy-700)] text-white"
                              : "bg-white text-[var(--color-ink-700)] hover:bg-[var(--color-ink-100)]"
                          }`}
                        >
                          {sf}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                  <label className="block">
                    <span className="block text-[10.5px] font-medium uppercase tracking-[0.04em] text-[var(--color-ink-500)] mb-1">
                      Unit to allocate{" "}
                      <span className="text-[var(--color-ink-400)] font-normal normal-case tracking-normal">
                        ({unitsForThis.length} matching {l.saleForm} in warehouse)
                      </span>
                    </span>
                    <select
                      value={l.unitId}
                      onChange={(e) => setLine(l.key, { unitId: e.target.value })}
                      disabled={!l.productVariantId}
                      className="h-7 px-2 text-[12px] font-mono text-[var(--color-ink-900)] bg-white border border-[var(--color-border-strong)] rounded-[3px] focus:outline-none focus:border-[var(--color-navy-700)] focus:shadow-[0_0_0_2px_rgba(31,78,121,0.14)] w-full disabled:bg-[var(--color-ink-100)] disabled:text-[var(--color-ink-400)]"
                    >
                      <option value="">
                        {l.productVariantId ? "Select a specific unit" : "Pick a variant first"}
                      </option>
                      {unitsForThis.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.engineNumber}  /  {u.chassisNumber}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px_1fr] gap-3 items-start mt-2">
                  <div className="text-[11px] text-[var(--color-ink-500)]">
                    {variant && (
                      <>
                        <span className="text-[var(--color-ink-500)]">Tier price (display only):</span>{" "}
                        <span className="font-mono tabular-nums text-[var(--color-ink-900)] font-medium">
                          {formatNGN(displayUnitPrice)}
                        </span>
                        <div className="text-[10.5px] text-[var(--color-ink-400)] mt-0.5">
                          Server resolves the actual price on save.
                        </div>
                      </>
                    )}
                  </div>
                  <div>
                    {canDiscount && (
                      <>
                        <span className="block text-[10.5px] font-medium uppercase tracking-[0.04em] text-[var(--color-ink-500)] mb-1">
                          Discount
                        </span>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={l.discountAmount}
                          onChange={(e) => setLine(l.key, { discountAmount: e.target.value })}
                          placeholder="0.00"
                          className="h-7 px-2 text-[12.5px] tabular-nums font-mono text-right text-[var(--color-ink-900)] bg-white border border-[var(--color-border-strong)] rounded-[3px] focus:outline-none focus:border-[var(--color-navy-700)] focus:shadow-[0_0_0_2px_rgba(31,78,121,0.14)] w-full"
                        />
                      </>
                    )}
                  </div>
                  <div className="flex items-end h-full pb-0.5 justify-end">
                    <span className="text-[11px] text-[var(--color-ink-500)] mr-2">Line total:</span>
                    <span className="font-mono tabular-nums text-[13px] font-semibold text-[var(--color-ink-900)]">
                      {variant ? formatNGN(displayLineTotal(l)) : "--"}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <footer className="px-4 py-2.5 bg-[var(--color-ink-100)] border-t border-[var(--color-border-default)] text-[12px]">
          <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-1 max-w-[640px] ml-auto">
            <span className="text-right text-[var(--color-ink-700)]">Subtotal</span>
            <span className="font-mono tabular-nums text-[var(--color-ink-900)]">{formatNGN(subtotal)}</span>
            <span />
            {discountTotal > 0 && (
              <>
                <span className="text-right text-[var(--color-ink-700)]">Discount</span>
                <span className="font-mono tabular-nums text-[var(--color-danger-700)]">
                  &minus;{formatNGN(discountTotal)}
                </span>
                <span />
              </>
            )}
            <span className="text-right text-[var(--color-ink-700)]">VAT (7.5%)</span>
            <span className="font-mono tabular-nums text-[var(--color-ink-900)]">{formatNGN(vat)}</span>
            <span />
            <span className="text-right text-[13px] font-semibold text-[var(--color-ink-900)]">Total</span>
            <span className="font-mono tabular-nums text-[14px] font-semibold text-[var(--color-navy-800)]">
              {formatNGN(total)}
            </span>
            <span className="text-[10.5px] text-[var(--color-ink-500)] self-center">
              display aid; server is authoritative
            </span>
          </div>
        </footer>
      </section>

      {serverMessages.length > 0 && (
        <Panel tone="danger" title={serverMessages.length === 1 ? "Cannot save" : `Cannot save: ${serverMessages.length} issues`}>
          <ul className="list-disc list-inside text-[12px] space-y-0.5">
            {serverMessages.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </Panel>
      )}

      {conflictMessage && (
        <Panel tone="warning" title="Server rejected the order. Nothing was saved.">
          {i11Conflicts.length > 0 ? (
            <>
              <div className="text-[12px] mb-1.5">
                {i11Conflicts.length === 1
                  ? "The unit on one of your lines is already allocated to another active sales order:"
                  : `${i11Conflicts.length} units on this order are already allocated to other active sales orders:`}
              </div>
              <ul className="text-[12px] list-disc list-inside space-y-0.5 mb-1.5">
                {i11Conflicts.map((c, i) => {
                  const lineMeta = engineToLineMeta.get(c.engineNumber);
                  return (
                    <li key={i}>
                      <span className="font-mono font-semibold">{c.engineNumber}</span>{" "}
                      is allocated on{" "}
                      <span className="font-mono">{c.soNumber}</span>
                      {lineMeta && (
                        <>
                          {" "}(<span className="font-semibold">Line {lineMeta.lineNumber}</span>)
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
              <div className="text-[12px]">
                Pick a different unit on the{" "}
                {i11Conflicts.length > 1 ? "highlighted lines" : "highlighted line"} above.
              </div>
            </>
          ) : (
            <>
              <div className="text-[12px] mb-1">
                Server message: <span className="font-mono">{conflictMessage}</span>
              </div>
              {conflictMessage.includes("I-11") && (
                <div className="text-[12px]">
                  A unit on this order is already allocated to another active sales order. Pick a
                  different unit on the affected line; nothing was saved.
                </div>
              )}
              {conflictMessage.includes("required for a CKD line") && (
                <div className="text-[12px]">
                  The selected unit&apos;s warehouse status does not match the line&apos;s CKD form.
                  Choose a unit already in IN_WAREHOUSE_CKD.
                </div>
              )}
              {conflictMessage.includes("required for a CBU line") && (
                <div className="text-[12px]">
                  The selected unit&apos;s warehouse status does not match the line&apos;s CBU form.
                  Choose a unit already in IN_WAREHOUSE_CBU.
                </div>
              )}
            </>
          )}
        </Panel>
      )}

      {forbiddenMessage && (
        <Panel tone="danger" title="Permission denied">
          <div className="text-[12px]">{forbiddenMessage}</div>
        </Panel>
      )}

      <div className="flex items-center justify-end gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="h-8 px-4 rounded-[3px] text-[13px] font-medium text-white disabled:opacity-50"
          style={{ background: "var(--color-navy-700)" }}
        >
          {submitting ? (mode === "create" ? "Creating..." : "Saving...") : submitLabel ?? (mode === "create" ? "Create Draft" : "Save Changes")}
        </button>
      </div>
    </form>
  );
}

function Panel({
  tone,
  title,
  children,
}: {
  tone: "danger" | "warning";
  title: string;
  children: React.ReactNode;
}) {
  const cls =
    tone === "danger"
      ? {
          bg: "var(--color-danger-50)",
          border: "var(--color-danger-100)",
          fg: "var(--color-danger-700)",
        }
      : {
          bg: "var(--color-warning-50)",
          border: "var(--color-warning-100)",
          fg: "var(--color-warning-700)",
        };
  return (
    <div
      role="alert"
      className="mb-4 px-3.5 py-2.5 rounded-[3px] border"
      style={{ background: cls.bg, borderColor: cls.border, color: cls.fg }}
    >
      <div className="font-semibold text-[12.5px] mb-1">{title}</div>
      {children}
    </div>
  );
}
