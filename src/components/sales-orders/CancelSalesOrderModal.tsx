"use client";

/**
 * Cancel-sales-order confirmation (prompt 37). A required reason is captured
 * (the backend mandates a non-empty reason and stores it on the order). Reason
 * is a pick-list of common cases with an "Other" free-text path that requires
 * elaboration. There is no notes field: the backend stores only the reason.
 *
 * Cancelling frees the soft unit reservation (line unitIds nulled) and moves
 * the order to CANCELLED, atomically. Online-only (transactional write).
 */
import { useEffect, useMemo, useState } from "react";

import Modal from "@/components/ui/Modal";
import { cancelSalesOrder, type CancelSalesOrderResult } from "@/lib/api";
import { useConnectivity } from "@/lib/sync/connectivity";

const REASONS = [
  "Customer changed mind",
  "Duplicate order",
  "Data entry error",
  "Customer unreachable",
  "Other",
] as const;

export default function CancelSalesOrderModal({
  open,
  onClose,
  soId,
  soNumber,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  soId: string;
  soNumber: string;
  onSuccess: (result: CancelSalesOrderResult) => void;
}) {
  const { state: connState } = useConnectivity();
  const offline = connState === "offline";

  const [reason, setReason] = useState<string>("");
  const [other, setOther] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setReason("");
    setOther("");
    setSubmitting(false);
    setError("");
  }, [open]);

  // The reason string actually sent: the elaboration when "Other", else the
  // chosen label.
  const finalReason = useMemo(
    () => (reason === "Other" ? other.trim() : reason),
    [reason, other],
  );
  const canSubmit = finalReason.length > 0 && !offline && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError("");
    const r = await cancelSalesOrder(soId, { reason: finalReason });
    if (r.kind === "ok") {
      onSuccess(r.data);
      return;
    }
    setSubmitting(false);
    if (r.kind === "conflict") {
      setError(r.message || "This sales order can no longer be cancelled from its current state.");
    } else if (r.kind === "forbidden") {
      setError("You do not have permission to cancel sales orders (requires salesorder.create).");
    } else if (r.kind === "validation") {
      setError(typeof r.message === "string" ? r.message : r.message.join("; "));
    } else if (r.kind === "network_error") {
      setError("Network error. Cancelling a sales order requires a live connection.");
    } else {
      setError("Unexpected response from the server.");
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Cancel sales order ${soNumber}`}
      testId="cancel-so-modal"
      footer={
        <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            data-testid="cancel-so-submit"
            className="h-[32px] px-4 rounded-[3px] bg-[var(--color-danger-700)] text-white text-[12.5px] font-medium disabled:opacity-50 w-full sm:w-auto order-1 sm:order-2"
          >
            {submitting ? "Cancelling..." : "Cancel this order"}
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
          This will cancel the sales order and release any reserved units back to inventory. Cancelled orders cannot be reopened.
        </p>
        {offline && (
          <div className="px-3 py-2 rounded-[3px] bg-[var(--color-warning-100)] text-[var(--color-warning-700)] text-[12px]">
            Cancelling requires a live connection. Reconnect to continue.
          </div>
        )}
        {error && (
          <div
            role="alert"
            data-testid="cancel-so-error"
            className="px-3 py-2 rounded-[3px] bg-[var(--color-danger-50)] border border-[var(--color-danger-100)] text-[12.5px] text-[var(--color-danger-700)]"
          >
            {error}
          </div>
        )}

        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] font-medium">
            Reason
          </span>
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={submitting}
            data-testid="cancel-so-reason"
            className="h-[32px] w-full px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[13px]"
          >
            <option value="">Select a reason…</option>
            {REASONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>

        {reason === "Other" && (
          <label className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] font-medium">
              Please elaborate
            </span>
            <textarea
              value={other}
              onChange={(e) => setOther(e.target.value)}
              disabled={submitting}
              rows={3}
              data-testid="cancel-so-other"
              className="w-full px-2 py-1.5 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[13px]"
            />
          </label>
        )}
      </div>
    </Modal>
  );
}
