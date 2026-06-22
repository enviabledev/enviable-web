"use client";

/**
 * Resolve a return (prompt 40). The backend disposition is a simple choice of
 * REPAIR or WRITE_OFF (no refund / replace / supplier-claim in the current
 * model), each cascading the unit's state: REPAIR -> IN_REPAIR, WRITE_OFF ->
 * WRITTEN_OFF. Only an INSPECTING return can be resolved (backend 409s
 * otherwise). Online-only (transactional write).
 */
import { useEffect, useState } from "react";

import Modal from "@/components/ui/Modal";
import { resolveReturn, type ResolvableDisposition, type ReturnDetail } from "@/lib/api";
import { useConnectivity } from "@/lib/sync/connectivity";

function consequence(d: ResolvableDisposition): string {
  return d === "REPAIR"
    ? "The unit moves into repair (IN_REPAIR) and can be restocked once repaired."
    : "The unit is written off (WRITTEN_OFF). This is terminal: it cannot be sold, repaired, or adjusted again.";
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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setDisposition("");
    setSubmitting(false);
    setError("");
  }, [open]);

  const canSubmit = disposition !== "" && !offline && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError("");
    const r = await resolveReturn(returnId, { disposition });
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
      setError(typeof r.message === "string" ? r.message : r.message.join("; "));
    } else if (r.kind === "network_error") {
      setError("Network error. Resolving a return requires a live connection.");
    } else {
      setError("Unexpected response from the server.");
    }
  };

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
          <span className="text-[11px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] font-medium">
            Disposition
          </span>
          <select
            value={disposition}
            onChange={(e) => setDisposition(e.target.value as ResolvableDisposition | "")}
            disabled={submitting}
            data-testid="resolve-return-disposition"
            className="h-[32px] w-full px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[13px]"
          >
            <option value="">Select a disposition…</option>
            <option value="REPAIR">Repair</option>
            <option value="WRITE_OFF">Write off</option>
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
      </div>
    </Modal>
  );
}
