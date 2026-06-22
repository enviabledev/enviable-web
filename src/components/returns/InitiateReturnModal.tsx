"use client";

/**
 * Initiate a return (prompt 40). The workflow is sales-order-scoped: pick one of
 * the order's currently-SOLD units and give a reason. On success the backend
 * creates the Return (INITIATED) and cascades the unit SOLD_* -> RETURNED.
 * Online-only (transactional write).
 */
import { useEffect, useState } from "react";

import Modal from "@/components/ui/Modal";
import { initiateReturn, type ReturnDetail } from "@/lib/api";
import { useConnectivity } from "@/lib/sync/connectivity";

export type ReturnableUnit = { id: string; engineNumber: string };

export default function InitiateReturnModal({
  open,
  onClose,
  salesOrderId,
  soNumber,
  units,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  salesOrderId: string;
  soNumber: string;
  /** The order's currently-SOLD units (the only ones a return is allowed on). */
  units: ReturnableUnit[];
  onSuccess: (created: ReturnDetail) => void;
}) {
  const { state: connState } = useConnectivity();
  const offline = connState === "offline";

  const [unitId, setUnitId] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    // Pre-select when there is exactly one returnable unit.
    setUnitId(units.length === 1 ? units[0].id : "");
    setReason("");
    setSubmitting(false);
    setError("");
  }, [open, units]);

  const canSubmit = unitId !== "" && reason.trim().length > 0 && !offline && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError("");
    const r = await initiateReturn(salesOrderId, { unitId, reason: reason.trim() });
    if (r.kind === "ok") {
      onSuccess(r.data);
      return;
    }
    setSubmitting(false);
    if (r.kind === "conflict") {
      setError(r.message || "A return cannot be initiated for this unit.");
    } else if (r.kind === "forbidden") {
      setError("You do not have permission to initiate returns (requires return.manage).");
    } else if (r.kind === "validation") {
      setError(typeof r.message === "string" ? r.message : r.message.join("; "));
    } else if (r.kind === "network_error") {
      setError("Network error. Initiating a return requires a live connection.");
    } else {
      setError("Unexpected response from the server.");
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Initiate return on ${soNumber}`}
      testId="initiate-return-modal"
      footer={
        <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            data-testid="initiate-return-submit"
            className="h-[32px] px-4 rounded-[3px] bg-[var(--color-navy-700)] text-white text-[12.5px] font-medium disabled:opacity-50 w-full sm:w-auto order-1 sm:order-2"
          >
            {submitting ? "Initiating..." : "Initiate return"}
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
          A return moves the sold unit back into inventory as RETURNED for inspection. Only units
          currently sold on this order can be returned.
        </p>

        {offline && (
          <div className="px-3 py-2 rounded-[3px] bg-[var(--color-warning-100)] text-[var(--color-warning-700)] text-[12px]">
            Initiating a return requires a live connection. Reconnect to continue.
          </div>
        )}
        {error && (
          <div
            role="alert"
            data-testid="initiate-return-error"
            className="px-3 py-2 rounded-[3px] bg-[var(--color-danger-50)] border border-[var(--color-danger-100)] text-[12.5px] text-[var(--color-danger-700)]"
          >
            {error}
          </div>
        )}

        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] font-medium">
            Unit
          </span>
          <select
            value={unitId}
            onChange={(e) => setUnitId(e.target.value)}
            disabled={submitting}
            data-testid="initiate-return-unit"
            className="h-[32px] w-full px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[13px] font-mono"
          >
            <option value="">Select a unit…</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.engineNumber}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] font-medium">
            Reason (required)
          </span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={submitting}
            rows={3}
            data-testid="initiate-return-reason"
            placeholder="What is wrong with the unit? Recorded on the return."
            className="w-full px-2 py-1.5 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[13px]"
          />
        </label>
      </div>
    </Modal>
  );
}
