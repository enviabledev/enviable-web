"use client";

/**
 * Unit lifecycle adjustment (prompt 39). One uniform action surface for every
 * IT-admin adjustment, because the backend DTO is uniform: a target status plus
 * a mandatory reason (stored on the resulting stock movement's notes). The valid
 * targets for the unit's current status come from the client mirror of the
 * backend adjustment map; the backend re-checks and 409/400s anything illegal.
 *
 * Mirrors the sales-order cancel modal pattern (gated action + reason-capture
 * confirmation). Online-only: the adjustment is a transactional write.
 */
import { useEffect, useMemo, useState } from "react";

import Modal from "@/components/ui/Modal";
import { adjustUnit, type UnitStatus } from "@/lib/api";
import { useConnectivity } from "@/lib/sync/connectivity";
import { adjustmentConsequence, adjustmentOptionLabel, adjustmentTargets } from "@/lib/units/adjustments";
import { formatUnitStatus } from "@/lib/units/format";

export default function AdjustUnitModal({
  open,
  onClose,
  unit,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  unit: { id: string; engineNumber: string; status: UnitStatus };
  onSuccess: (newStatus: UnitStatus) => void;
}) {
  const { state: connState } = useConnectivity();
  const offline = connState === "offline";

  const targets = useMemo(() => adjustmentTargets(unit.status), [unit.status]);

  const [toStatus, setToStatus] = useState<UnitStatus | "">("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setToStatus("");
    setReason("");
    setSubmitting(false);
    setError("");
  }, [open]);

  const trimmedReason = reason.trim();
  const canSubmit =
    toStatus !== "" && trimmedReason.length > 0 && !offline && !submitting;

  const submit = async () => {
    // canSubmit implies toStatus !== "" (TS narrows toStatus to UnitStatus here
    // via the aliased condition), so the body can pass toStatus directly.
    if (!canSubmit) return;
    setSubmitting(true);
    setError("");
    const r = await adjustUnit(unit.id, { toStatus, reason: trimmedReason });
    if (r.kind === "ok") {
      onSuccess(r.data.status);
      return;
    }
    setSubmitting(false);
    if (r.kind === "conflict") {
      setError(
        r.message ||
          "This unit can no longer make that transition from its current state.",
      );
    } else if (r.kind === "forbidden") {
      setError("You do not have permission to adjust units (requires unit.adjust).");
    } else if (r.kind === "validation") {
      setError(typeof r.message === "string" ? r.message : r.message.join("; "));
    } else if (r.kind === "not_found") {
      setError("This unit could not be found.");
    } else if (r.kind === "network_error") {
      setError("Network error. Adjusting a unit requires a live connection.");
    } else {
      setError("Unexpected response from the server.");
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Adjust unit ${unit.engineNumber}`}
      testId="adjust-unit-modal"
      footer={
        <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            data-testid="adjust-unit-submit"
            className="h-[32px] px-4 rounded-[3px] bg-[var(--color-navy-700)] text-white text-[12.5px] font-medium disabled:opacity-50 w-full sm:w-auto order-1 sm:order-2"
          >
            {submitting ? "Applying..." : "Apply adjustment"}
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
          Current status:{" "}
          <span className="font-medium text-[var(--color-ink-900)]">
            {formatUnitStatus(unit.status)}
          </span>
          . Adjustments are recorded as a stock movement with your reason and are
          attributed to you.
        </p>

        {offline && (
          <div className="px-3 py-2 rounded-[3px] bg-[var(--color-warning-100)] text-[var(--color-warning-700)] text-[12px]">
            Adjusting a unit requires a live connection. Reconnect to continue.
          </div>
        )}
        {error && (
          <div
            role="alert"
            data-testid="adjust-unit-error"
            className="px-3 py-2 rounded-[3px] bg-[var(--color-danger-50)] border border-[var(--color-danger-100)] text-[12.5px] text-[var(--color-danger-700)]"
          >
            {error}
          </div>
        )}

        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] font-medium">
            New status
          </span>
          <select
            value={toStatus}
            onChange={(e) => setToStatus(e.target.value as UnitStatus | "")}
            disabled={submitting}
            data-testid="adjust-unit-status"
            className="h-[32px] w-full px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[13px]"
          >
            <option value="">Select a new status…</option>
            {targets.map((t) => (
              <option key={t} value={t}>
                {adjustmentOptionLabel(unit.status, t)}
              </option>
            ))}
          </select>
        </label>

        {toStatus !== "" && (
          <div
            data-testid="adjust-unit-consequence"
            className="px-3 py-2 rounded-[3px] bg-[var(--color-ink-100)] text-[12px] text-[var(--color-ink-700)] leading-[1.5]"
          >
            {adjustmentConsequence(toStatus)}
          </div>
        )}

        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] font-medium">
            Reason (required)
          </span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={submitting}
            rows={3}
            data-testid="adjust-unit-reason"
            placeholder="Why is this unit being adjusted? Recorded on the movement."
            className="w-full px-2 py-1.5 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[13px]"
          />
        </label>
      </div>
    </Modal>
  );
}
