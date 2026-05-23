"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";

import {
  flattenVariantOptions,
  getSalesOrder,
  listCustomers,
  listProducts,
  listSalesOrders,
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
  /**
   * When editing an existing SO, pass its id so its own line allocations are
   * not treated as reservations the picker should hide; the user must still
   * see the line's current unit as a valid option.
   */
  excludeSoId?: string;
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
 * Fetch the set of unitIds currently held by an active sales order line.
 * The backend's I-11 partial unique index (one_active_so_line_per_unit
 * WHERE unitId IS NOT NULL) lets one such line per unit; we mirror that
 * by collecting every line.unitId from every non-cancelled SO. Used both
 * to pre-filter the picker and to identify which of the user's submitted
 * units is the colliding one after a 409.
 *
 * Implementation: list SOs (no envelope, plain array), then GET each
 * detail in parallel for the line set. N+1 calls; fine for the current
 * scale, would warrant a backend "active-allocations" endpoint at larger
 * volumes. Excluding `excludeSoId` lets the edit form skip its own SO so
 * the picker still offers the current line's currently-allocated unit.
 */
async function loadReservedUnitIds(
  excludeSoId: string | undefined,
  signal: AbortSignal,
): Promise<{ ids: Set<string>; idsToSoNumber: Map<string, string> }> {
  const ids = new Set<string>();
  const idsToSoNumber = new Map<string, string>();
  const listRes = await listSalesOrders({}, signal);
  if (listRes.kind !== "ok") return { ids, idsToSoNumber };
  const candidates = listRes.data.filter(
    (so) => so.status !== "CANCELLED" && so.status !== "REFUNDED" && so.id !== excludeSoId,
  );
  const details = await Promise.all(candidates.map((so) => getSalesOrder(so.id, signal)));
  for (const r of details) {
    if (r.kind !== "ok") continue;
    for (const line of r.data.lines) {
      if (line.unitId) {
        ids.add(line.unitId);
        idsToSoNumber.set(line.unitId, r.data.soNumber);
      }
    }
  }
  return { ids, idsToSoNumber };
}

export default function SoForm({ mode, initial, submitLabel, onSubmit, excludeSoId }: SoFormProps) {
  const { has } = usePermissions();
  const canDiscount = has("salesorder.discount");

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<ProductWithVariants[]>([]);
  const [availableUnits, setAvailableUnits] = useState<UnitListRow[]>([]);
  const [reservedUnitIds, setReservedUnitIds] = useState<Set<string>>(new Set());
  const [reservedToSoNumber, setReservedToSoNumber] = useState<Map<string, string>>(new Map());
  const [loadError, setLoadError] = useState<string | null>(null);
  // Set of line keys that the most recent 409 identified as colliding.
  // Cleared on edit or successful submit.
  const [conflictedLineKeys, setConflictedLineKeys] = useState<Set<string>>(new Set());

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
      // Units in IN_WAREHOUSE_CKD or IN_WAREHOUSE_CBU.
      listUnits({ pageSize: 250, status: ["IN_WAREHOUSE_CKD", "IN_WAREHOUSE_CBU"] }, ctrl.signal),
      // Pre-load the set of units already allocated to any non-cancelled SO
      // line. Pre-filtering the picker by this set means the user mostly
      // doesn't even see units that would 409; the 409 path becomes the rare
      // race-condition fallback rather than the default friction.
      loadReservedUnitIds(excludeSoId, ctrl.signal),
    ]).then(([cRes, pRes, uRes, reserved]) => {
      if (ctrl.signal.aborted) return;
      if (cRes.kind === "ok") setCustomers(cRes.data.data);
      else if (cRes.kind === "forbidden")
        setLoadError("You do not have permission to view customers (customer.read required).");
      if (pRes.kind === "ok") setProducts(pRes.data);
      if (uRes.kind === "ok") setAvailableUnits(uRes.data.data);
      setReservedUnitIds(reserved.ids);
      setReservedToSoNumber(reserved.idsToSoNumber);
    });
    return () => ctrl.abort();
  }, [excludeSoId]);

  const variantOptions = useMemo(() => flattenVariantOptions(products), [products]);
  const variantById = useMemo(() => {
    const m = new Map<string, (typeof variantOptions)[number]>();
    for (const v of variantOptions) m.set(v.productVariantId, v);
    return m;
  }, [variantOptions]);

  const selectedCustomer = customers.find((c) => c.id === customerId);

  /**
   * Units offered for a given line: must match the line's selected sale
   * form's warehouse status AND the line's selected variant. We additionally
   * hide units already chosen on OTHER lines in this same draft AND units
   * already allocated to any non-cancelled SO line elsewhere in the system
   * (the I-11 mirror). The line's currently-selected unit is always kept so
   * the user can see what they've picked even if it overlaps the reservation
   * set (relevant in edit mode where the line's own unit appears reserved
   * until excludeSoId masks it).
   */
  const unitsForLine = (line: LineDraft): { matching: UnitListRow[]; reservedCount: number } => {
    if (!line.productVariantId) return { matching: [], reservedCount: 0 };
    const wantedStatus = line.saleForm === "CKD" ? "IN_WAREHOUSE_CKD" : "IN_WAREHOUSE_CBU";
    const usedOnOtherLines = new Set(
      lines.filter((l) => l.key !== line.key && l.unitId).map((l) => l.unitId),
    );
    const variantStatusMatch = availableUnits.filter(
      (u) =>
        u.productVariant.id === line.productVariantId &&
        u.status === wantedStatus &&
        !usedOnOtherLines.has(u.id),
    );
    const reservedCount = variantStatusMatch.filter(
      (u) => reservedUnitIds.has(u.id) && u.id !== line.unitId,
    ).length;
    const matching = variantStatusMatch.filter(
      (u) => !reservedUnitIds.has(u.id) || u.id === line.unitId,
    );
    return { matching, reservedCount };
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
    setConflictedLineKeys(new Set());
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
      // For I-11 specifically, the server message is generic and doesn't name
      // which unit is the conflict. Re-fetch the reservation set, identify any
      // of OUR submitted lines whose unitId is now reserved elsewhere, and
      // highlight those specific lines in the form. Without this the user has
      // to guess which line is the problem when there are several.
      if (r.message.includes("I-11")) {
        try {
          const fresh = await loadReservedUnitIds(excludeSoId, new AbortController().signal);
          setReservedUnitIds(fresh.ids);
          setReservedToSoNumber(fresh.idsToSoNumber);
          const collidingKeys = new Set<string>();
          for (const l of lines) {
            if (l.unitId && fresh.ids.has(l.unitId)) collidingKeys.add(l.key);
          }
          setConflictedLineKeys(collidingKeys);
        } catch {
          // If the refresh fails we still have the generic panel; the user
          // sees the server's message and can guess. Best-effort.
        }
      }
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

  // Clear a line's conflict flag when the user changes its unit. If they
  // edit something else (e.g. discount) the flag stays so they can still see
  // which line was the problem.
  const clearLineConflictOnUnitChange = (key: string, prevUnitId: string, nextUnitId: string) => {
    if (prevUnitId !== nextUnitId && conflictedLineKeys.has(key)) {
      const next = new Set(conflictedLineKeys);
      next.delete(key);
      setConflictedLineKeys(next);
    }
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
        <div className="px-4 py-3 grid grid-cols-2 gap-x-5 gap-y-2 items-start">
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
            const { matching: unitsForThis, reservedCount } = unitsForLine(l);
            const variant = variantById.get(l.productVariantId);
            const displayUnitPrice = variant ? Number(variant.currentMarketPrice) * tierFactor : 0;
            const isConflicted = conflictedLineKeys.has(l.key);
            const conflictingSoNumber = l.unitId ? reservedToSoNumber.get(l.unitId) : undefined;
            const conflictingEngine = l.unitId
              ? availableUnits.find((u) => u.id === l.unitId)?.engineNumber
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
                      <span className="text-[10px] font-semibold uppercase tracking-[0.04em] px-1.5 py-0.5 rounded-[2px] text-white"
                            style={{ background: "var(--color-danger-700)" }}>
                        Conflict: unit already reserved{conflictingSoNumber ? ` on ${conflictingSoNumber}` : ""}
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
                <div className="grid grid-cols-[1fr_120px_1fr] gap-3 items-start">
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
                        ({unitsForThis.length} available {l.saleForm}
                        {reservedCount > 0 && `; ${reservedCount} reserved elsewhere, hidden`})
                      </span>
                    </span>
                    <select
                      value={l.unitId}
                      onChange={(e) => {
                        clearLineConflictOnUnitChange(l.key, l.unitId, e.target.value);
                        setLine(l.key, { unitId: e.target.value });
                      }}
                      disabled={!l.productVariantId}
                      className={`h-7 px-2 text-[12px] font-mono text-[var(--color-ink-900)] bg-white border rounded-[3px] focus:outline-none focus:shadow-[0_0_0_2px_rgba(31,78,121,0.14)] w-full disabled:bg-[var(--color-ink-100)] disabled:text-[var(--color-ink-400)] ${
                        isConflicted
                          ? "border-[var(--color-danger-700)] focus:border-[var(--color-danger-700)]"
                          : "border-[var(--color-border-strong)] focus:border-[var(--color-navy-700)]"
                      }`}
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
                    {isConflicted && conflictingEngine && (
                      <p className="text-[11px] text-[var(--color-danger-700)] mt-1">
                        <span className="font-mono">{conflictingEngine}</span> is already allocated
                        {conflictingSoNumber && (
                          <>
                            {" "}on <span className="font-mono">{conflictingSoNumber}</span>
                          </>
                        )}
                        . Pick a different unit above.
                      </p>
                    )}
                  </label>
                </div>

                <div className="grid grid-cols-[1fr_120px_1fr] gap-3 items-start mt-2">
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
          {conflictMessage.includes("I-11") && conflictedLineKeys.size > 0 ? (
            <>
              <div className="text-[12px] mb-1.5">
                {conflictedLineKeys.size === 1
                  ? "One line allocates a unit that is already reserved on another sales order:"
                  : `${conflictedLineKeys.size} lines allocate units that are already reserved on other sales orders:`}
              </div>
              <ul className="text-[12px] list-disc list-inside space-y-0.5 mb-1.5">
                {lines.map((l, idx) => {
                  if (!conflictedLineKeys.has(l.key)) return null;
                  const eng = availableUnits.find((u) => u.id === l.unitId)?.engineNumber;
                  const onSo = l.unitId ? reservedToSoNumber.get(l.unitId) : undefined;
                  return (
                    <li key={l.key}>
                      <span className="font-semibold">Line {idx + 1}</span>:{" "}
                      <span className="font-mono">{eng ?? l.unitId}</span>
                      {onSo && (
                        <>
                          {" "}is allocated on{" "}
                          <span className="font-mono">{onSo}</span>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
              <div className="text-[12px]">
                Pick a different unit on the highlighted line{conflictedLineKeys.size > 1 ? "s" : ""} above. The
                picker has been refreshed and these units are now hidden.
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
                  The selected unit&apos;s warehouse status does not match the line&apos;s CKD form. Choose a
                  unit already in IN_WAREHOUSE_CKD.
                </div>
              )}
              {conflictMessage.includes("required for a CBU line") && (
                <div className="text-[12px]">
                  The selected unit&apos;s warehouse status does not match the line&apos;s CBU form. Choose a
                  unit already in IN_WAREHOUSE_CBU.
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
