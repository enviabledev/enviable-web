"use client";

/**
 * Cancel-assembly-job confirmation (prompt 44). A required reason is captured
 * (the backend mandates a non-empty, trimmed reason and stores it on both the
 * reversal movement and the job). Reason is a pick-list of common cases with an
 * "Other" free-text path that requires elaboration, mirroring the SO-cancel
 * modal (prompt 37).
 *
 * Cancelling reverts the unit to IN_WAREHOUSE_CKD (intact) and closes the job
 * as CANCELLED, atomically. This is the clean in-progress reversal; a completed
 * CBU unit needing damage handling goes through the generic adjust flow
 * instead. Online-only (transactional write).
 */
import { useEffect, useMemo, useState } from "react";

import Modal from "@/components/ui/Modal";
import { cancelAssembly, type AssemblyJob, type AssemblyJobType } from "@/lib/api";
import { useConnectivity } from "@/lib/sync/connectivity";

const REASONS = [
  "Wrong unit selected for assembly",
  "Started in error",
  "Administrative correction",
  "Unit needed elsewhere",
  "Other",
] as const;

export default function CancelAssemblyJobModal({
  open,
  onClose,
  jobId,
  jobType = "CKD_TO_ASSEMBLED",
  engineNumber,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  jobId: string;
  jobType?: AssemblyJobType;
  engineNumber: string;
  onSuccess: (job: AssemblyJob) => void;
}) {
  const { state: connState } = useConnectivity();
  const offline = connState === "offline";
  // The intact revert target differs by job type: an upgrade reverts to SKD, a
  // kit build reverts to CKD (44a).
  const revertLabel = jobType === "SKD_TO_CBU" ? "In Warehouse SKD" : "In Warehouse CKD";

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
  // chosen label. Trimmed to match the backend's trimmed non-empty check.
  const finalReason = useMemo(
    () => (reason === "Other" ? other.trim() : reason),
    [reason, other],
  );
  const canSubmit = finalReason.length > 0 && !offline && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError("");
    const r = await cancelAssembly(jobId, finalReason);
    if (r.kind === "ok") {
      onSuccess(r.data);
      return;
    }
    setSubmitting(false);
    if (r.kind === "conflict") {
      // 409: the job is no longer IN_PROGRESS (e.g. another supervisor
      // completed, failed, or cancelled it first). Surface the server message.
      setError(
        r.message ||
          "This assembly job is no longer in progress and can no longer be cancelled.",
      );
    } else if (r.kind === "forbidden") {
      setError("You do not have permission to cancel assembly jobs (requires assembly.perform).");
    } else if (r.kind === "validation") {
      // 400: a blank reason slipped past the client guard. Surface it.
      setError(typeof r.message === "string" ? r.message : r.message.join("; "));
    } else if (r.kind === "network_error") {
      setError("Network error. Cancelling an assembly job requires a live connection.");
    } else {
      setError("Unexpected response from the server.");
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        <span>
          Cancel assembly of <span className="font-mono">{engineNumber}</span>
        </span>
      }
      testId="cancel-assembly-modal"
      footer={
        <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            data-testid="cancel-assembly-submit"
            className="h-[32px] px-4 rounded-[3px] bg-[var(--color-navy-700)] text-white text-[12.5px] font-medium disabled:opacity-50 w-full sm:w-auto order-1 sm:order-2"
          >
            {submitting ? "Cancelling..." : "Cancel this assembly"}
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
        <p className="text-[12.5px] text-[var(--color-ink-700)] leading-[1.5]" data-testid="cancel-revert-copy">
          Cancelling will return the unit to <span className="font-semibold">{revertLabel}</span> and
          close this assembly job as <span className="font-semibold">Cancelled</span>.{" "}
          {jobType === "SKD_TO_CBU"
            ? "The unit can be upgraded again later."
            : "The unit can be re-assembled later."}{" "}
          This action is irreversible for this job.
        </p>
        {offline && (
          <div className="px-3 py-2 rounded-[3px] bg-[var(--color-warning-100)] text-[var(--color-warning-700)] text-[12px]">
            Cancelling requires a live connection. Reconnect to continue.
          </div>
        )}
        {error && (
          <div
            role="alert"
            data-testid="cancel-assembly-error"
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
            data-testid="cancel-assembly-reason"
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
              data-testid="cancel-assembly-other"
              className="w-full px-2 py-1.5 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[13px]"
            />
          </label>
        )}
      </div>
    </Modal>
  );
}
