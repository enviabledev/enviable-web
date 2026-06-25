"use client";

/**
 * SKD -> CBU upgrade confirmation (prompt 46). Authorises a single 3-wheeler's
 * full build as a new assembly job (jobType SKD_TO_CBU). The 46a contract takes
 * only the unit ref (no supervisor or notes on POST /api/assembly-jobs/upgrade),
 * so this is a confirm, not a multi-field form: adding a notes field that the
 * backend cannot persist would be dishonest. Online-only write.
 *
 * On success the unit pivots to IN_ASSEMBLY and the parent surfaces a link to the
 * newly created job.
 */
import { useEffect, useState } from "react";

import Modal from "@/components/ui/Modal";
import { upgradeToCbu, type AssemblyJob } from "@/lib/api";
import { useConnectivity } from "@/lib/sync/connectivity";

export default function UpgradeToCbuModal({
  open,
  onClose,
  unitId,
  engineNumber,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  unitId: string;
  engineNumber: string;
  onSuccess: (job: AssemblyJob) => void;
}) {
  const { state: connState } = useConnectivity();
  const offline = connState === "offline";
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setSubmitting(false);
    setError("");
  }, [open]);

  const submit = async () => {
    if (offline || submitting) return;
    setSubmitting(true);
    setError("");
    const r = await upgradeToCbu(unitId);
    if (r.kind === "ok") {
      onSuccess(r.data);
      return;
    }
    setSubmitting(false);
    if (r.kind === "conflict") {
      // 409: not SKD or not a 3-wheeler (defensive; the affordance is gated).
      setError(
        r.message ||
          "This unit can no longer be upgraded. Only a semi-knocked-down (SKD) 3-wheeler can be upgraded to CBU.",
      );
    } else if (r.kind === "forbidden") {
      setError("You do not have permission to authorise upgrades (requires assembly.upgrade).");
    } else if (r.kind === "validation") {
      setError(typeof r.message === "string" ? r.message : r.message.join("; "));
    } else if (r.kind === "network_error") {
      setError("Network error. Authorising an upgrade requires a live connection.");
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
          Upgrade <span className="font-mono">{engineNumber}</span> to CBU
        </span>
      }
      testId="upgrade-cbu-modal"
      footer={
        <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
          <button
            type="button"
            onClick={submit}
            disabled={offline || submitting}
            data-testid="upgrade-cbu-submit"
            className="h-[32px] px-4 rounded-[3px] bg-[var(--color-navy-700)] text-white text-[12.5px] font-medium disabled:opacity-50 w-full sm:w-auto order-1 sm:order-2"
          >
            {submitting ? "Authorising..." : "Authorise upgrade"}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="h-[32px] px-3 rounded-[3px] border border-[var(--color-border-strong)] bg-white text-[var(--color-ink-900)] text-[12.5px] font-medium hover:bg-[var(--color-ink-100)] w-full sm:w-auto order-2 sm:order-1"
          >
            Cancel
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-[12.5px] text-[var(--color-ink-700)] leading-[1.5]">
          This will create a new assembly job to upgrade this unit from{" "}
          <span className="font-semibold">SKD</span> to{" "}
          <span className="font-semibold">CBU</span>. The unit will transition to{" "}
          <span className="font-semibold">In Assembly</span> until the upgrade work completes; on
          completion it becomes a fully built CBU unit.
        </p>
        {offline && (
          <div className="px-3 py-2 rounded-[3px] bg-[var(--color-warning-100)] text-[var(--color-warning-700)] text-[12px]">
            Authorising an upgrade requires a live connection. Reconnect to continue.
          </div>
        )}
        {error && (
          <div
            role="alert"
            data-testid="upgrade-cbu-error"
            className="px-3 py-2 rounded-[3px] bg-[var(--color-danger-50)] border border-[var(--color-danger-100)] text-[12.5px] text-[var(--color-danger-700)]"
          >
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}
