"use client";

/**
 * Resolve a return (prompt 40, extended in 48). The disposition is REPAIR,
 * WRITE_OFF, or SUPPLIER_WARRANTY_CLAIM (48a), each cascading the unit's state:
 * REPAIR -> IN_REPAIR, WRITE_OFF -> WRITTEN_OFF, SUPPLIER_WARRANTY_CLAIM ->
 * CLAIMED_TO_SUPPLIER (and a SupplierWarrantyClaim is created). A supplier claim
 * requires a supplier counterparty (defaults to VSK, the sole supplier today);
 * the claim reference and notes are optional, notes recommended. Only an
 * INSPECTING return can be resolved (backend 409s otherwise). Online-only write.
 */
import { useEffect, useMemo, useState } from "react";

import Modal from "@/components/ui/Modal";
import {
  listCounterparties,
  resolveReturn,
  type Counterparty,
  type ResolvableDisposition,
  type ReturnDetail,
} from "@/lib/api";
import { useConnectivity } from "@/lib/sync/connectivity";

const VSK_ID = "seed-cp-vsk";

function consequence(d: ResolvableDisposition): string {
  switch (d) {
    case "REPAIR":
      return "The unit moves into repair (IN_REPAIR) and can be restocked once repaired.";
    case "WRITE_OFF":
      return "The unit is written off (WRITTEN_OFF). This is terminal: it cannot be sold, repaired, or adjusted again.";
    case "SUPPLIER_WARRANTY_CLAIM":
      return "A warranty claim is filed against the supplier and the unit moves to CLAIMED_TO_SUPPLIER. Once the supplier rules on the claim, record the outcome from the unit's Adjust action.";
  }
}

export default function ResolveReturnModal({
  open,
  onClose,
  returnId,
  unitEngineNumber,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  returnId: string;
  unitEngineNumber: string;
  onSuccess: (updated: ReturnDetail) => void;
}) {
  const { state: connState } = useConnectivity();
  const offline = connState === "offline";

  const [disposition, setDisposition] = useState<ResolvableDisposition | "">("");
  const [suppliers, setSuppliers] = useState<Counterparty[]>([]);
  const [suppliersLoaded, setSuppliersLoaded] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [claimReference, setClaimReference] = useState("");
  const [claimNotes, setClaimNotes] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [supplierError, setSupplierError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Reset on open.
  useEffect(() => {
    if (!open) return;
    setDisposition("");
    setSupplierId("");
    setClaimReference("");
    setClaimNotes("");
    setAttempted(false);
    setSupplierError("");
    setSubmitting(false);
    setError("");
  }, [open]);

  // Load active supplier counterparties when the claim disposition is chosen.
  // Default to VSK (the primary case); fall back to the first supplier.
  useEffect(() => {
    if (!open || disposition !== "SUPPLIER_WARRANTY_CLAIM" || suppliersLoaded) return;
    const ctrl = new AbortController();
    listCounterparties({ type: "SUPPLIER", status: "ACTIVE" }, ctrl.signal).then((r) => {
      if (ctrl.signal.aborted) return;
      if (r.kind === "ok") {
        setSuppliers(r.data);
        setSuppliersLoaded(true);
        setSupplierId((prev) =>
          prev || (r.data.some((c) => c.id === VSK_ID) ? VSK_ID : r.data[0]?.id ?? ""),
        );
      }
    });
    return () => ctrl.abort();
  }, [open, disposition, suppliersLoaded]);

  const isClaim = disposition === "SUPPLIER_WARRANTY_CLAIM";
  // The button stays enabled once a disposition is chosen; submit() enforces the
  // supplier-required rule and surfaces the inline error (so the user sees WHY,
  // rather than a silently disabled button).
  const canSubmit = disposition !== "" && !offline && !submitting;

  const submit = async () => {
    setAttempted(true);
    setSupplierError("");
    if (disposition === "" || offline || submitting) return;
    if (isClaim && supplierId === "") {
      setSupplierError("Select the supplier the claim is filed against.");
      return;
    }
    setSubmitting(true);
    setError("");
    const body =
      disposition === "SUPPLIER_WARRANTY_CLAIM"
        ? {
            disposition,
            supplierCounterpartyId: supplierId,
            ...(claimReference.trim() ? { claimReference: claimReference.trim() } : {}),
            ...(claimNotes.trim() ? { claimNotes: claimNotes.trim() } : {}),
          }
        : { disposition };
    const r = await resolveReturn(returnId, body);
    if (r.kind === "ok") {
      onSuccess(r.data);
      return;
    }
    setSubmitting(false);
    if (r.kind === "conflict") {
      setError(r.message || "This return can no longer be resolved from its current state.");
    } else if (r.kind === "forbidden") {
      setError("You do not have permission to resolve returns (requires return.manage).");
    } else if (r.kind === "validation") {
      const msg = typeof r.message === "string" ? r.message : r.message.join("; ");
      // Surface supplier-specific 400s inline on the supplier field.
      if (/counterparty|supplierCounterpartyId|not active|not found/i.test(msg)) {
        setSupplierError(msg);
      } else {
        setError(msg);
      }
    } else if (r.kind === "network_error") {
      setError("Network error. Resolving a return requires a live connection.");
    } else {
      setError("Unexpected response from the server.");
    }
  };

  const inputCls =
    "h-[32px] w-full px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[13px]";
  const labelCls = "text-[11px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] font-medium";

  const noSuppliers = useMemo(
    () => isClaim && suppliersLoaded && suppliers.length === 0,
    [isClaim, suppliersLoaded, suppliers.length],
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Resolve return for ${unitEngineNumber}`}
      testId="resolve-return-modal"
      footer={
        <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            data-testid="resolve-return-submit"
            className="h-[32px] px-4 rounded-[3px] bg-[var(--color-navy-700)] text-white text-[12.5px] font-medium disabled:opacity-50 w-full sm:w-auto order-1 sm:order-2"
          >
            {submitting ? "Resolving..." : "Resolve return"}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="h-[32px] px-3 rounded-[3px] border border-[var(--color-border-strong)] bg-white text-[var(--color-ink-900)] text-[12.5px] font-medium hover:bg-[var(--color-ink-100)] w-full sm:w-auto order-2 sm:order-1"
          >
            Back
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-[12.5px] text-[var(--color-ink-700)] leading-[1.5]">
          Choose how this returned unit is dispositioned. The choice cascades to the unit and is
          recorded against the return.
        </p>

        {offline && (
          <div className="px-3 py-2 rounded-[3px] bg-[var(--color-warning-100)] text-[var(--color-warning-700)] text-[12px]">
            Resolving a return requires a live connection. Reconnect to continue.
          </div>
        )}
        {error && (
          <div
            role="alert"
            data-testid="resolve-return-error"
            className="px-3 py-2 rounded-[3px] bg-[var(--color-danger-50)] border border-[var(--color-danger-100)] text-[12.5px] text-[var(--color-danger-700)]"
          >
            {error}
          </div>
        )}

        <label className="flex flex-col gap-1">
          <span className={labelCls}>Disposition</span>
          <select
            value={disposition}
            onChange={(e) => setDisposition(e.target.value as ResolvableDisposition | "")}
            disabled={submitting}
            data-testid="resolve-return-disposition"
            className={inputCls}
          >
            <option value="">Select a disposition…</option>
            <option value="REPAIR">Repair</option>
            <option value="WRITE_OFF">Write off</option>
            <option value="SUPPLIER_WARRANTY_CLAIM">Supplier warranty claim</option>
          </select>
        </label>

        {disposition !== "" && (
          <div
            data-testid="resolve-return-consequence"
            className="px-3 py-2 rounded-[3px] bg-[var(--color-ink-100)] text-[12px] text-[var(--color-ink-700)] leading-[1.5]"
          >
            {consequence(disposition)}
          </div>
        )}

        {isClaim && (
          <div className="flex flex-col gap-3 rounded-[3px] border border-[var(--color-border-default)] bg-[var(--color-navy-50)] px-3 py-3" data-testid="claim-fields">
            <label className="flex flex-col gap-1">
              <span className={labelCls}>
                Supplier <span className="text-[var(--color-danger-700)]">*</span>
              </span>
              {noSuppliers ? (
                <span
                  data-testid="claim-no-suppliers"
                  className="text-[12px] text-[var(--color-warning-700)]"
                >
                  No supplier counterparties available. Add a supplier via counterparty management
                  before filing a warranty claim.
                </span>
              ) : (
                <select
                  value={supplierId}
                  onChange={(e) => setSupplierId(e.target.value)}
                  disabled={submitting || !suppliersLoaded}
                  data-testid="claim-supplier"
                  className={`${inputCls} ${supplierError || (attempted && supplierId === "") ? "border-[var(--color-danger-700)]" : ""}`}
                >
                  <option value="">{suppliersLoaded ? "Select a supplier…" : "Loading suppliers…"}</option>
                  {suppliers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}
              {(supplierError || (attempted && isClaim && supplierId === "" && !noSuppliers)) && (
                <span role="alert" data-testid="claim-supplier-error" className="text-[11.5px] text-[var(--color-danger-700)]">
                  {supplierError || "Select the supplier the claim is filed against."}
                </span>
              )}
            </label>

            <label className="flex flex-col gap-1">
              <span className={labelCls}>Claim reference</span>
              <input
                type="text"
                value={claimReference}
                onChange={(e) => setClaimReference(e.target.value)}
                disabled={submitting}
                data-testid="claim-reference"
                placeholder="VSK ticket number (optional, may not be assigned yet)"
                className={inputCls}
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className={labelCls}>Claim notes</span>
              <textarea
                value={claimNotes}
                onChange={(e) => setClaimNotes(e.target.value)}
                disabled={submitting}
                rows={3}
                data-testid="claim-notes"
                placeholder="Recommended: defect description, expected outcome, escalation path."
                className="w-full px-2 py-1.5 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[13px]"
              />
              {!claimNotes.trim() && (
                <span className="text-[11.5px] text-[var(--color-ink-500)]">
                  Notes are not required but strongly recommended for traceability.
                </span>
              )}
            </label>
          </div>
        )}
      </div>
    </Modal>
  );
}
