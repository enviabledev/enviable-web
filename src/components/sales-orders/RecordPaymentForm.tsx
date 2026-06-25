"use client";

/**
 * Record-payment form with client-side overpayment detection (prompt 42b).
 *
 * Theresa's framing: the system is a recording medium. As the user types an
 * amount, the form detects amount > remaining balance (remaining = SO total
 * minus the sum of CONFIRMED payments, floored at 0) and reveals a resolution
 * sub-form so the user states HOW the overpayment was resolved (a refund issued,
 * or a credit applied). The system records intent; it does not decide or process
 * the refund/credit. Client-side detection is a usability guide only; the
 * backend re-derives the balance and is the source of truth (it 400s if a
 * resolution is missing when required, missing a refund mechanism, or supplied
 * with no overpayment).
 *
 * Online-only write (the parent gates submission on connectivity / permissions).
 */
import { useEffect, useMemo, useState } from "react";

import {
  OVERPAYMENT_RESOLUTION,
  REFUND_MECHANISM,
  SEED_PAYMENT_METHODS,
  type OverpaymentResolution,
  type RecordPaymentBody,
  type RefundMechanism,
} from "@/lib/api";
import { formatNGN } from "@/lib/format";

const AMOUNT_RE = /^\d+(\.\d{1,2})?$/;

// Exact integer-cents parse so the overpayment comparison never drifts on
// floating point (0.1 + 0.2 etc). Returns null for a non-decimal string.
function toCents(s: string): number | null {
  const t = s.trim();
  if (!AMOUNT_RE.test(t)) return null;
  const [whole, frac = ""] = t.split(".");
  return Number(whole) * 100 + Number((frac + "00").slice(0, 2));
}

const REFUND_MECHANISM_LABEL: Record<RefundMechanism, string> = {
  BANK_TRANSFER: "Bank Transfer",
  CASH: "Cash",
};

export default function RecordPaymentForm({
  remainingBalance,
  hasPendingPayments,
  submitting,
  onCancel,
  onSubmit,
}: {
  remainingBalance: number;
  hasPendingPayments: boolean;
  submitting: boolean;
  onCancel: () => void;
  // Returns the server outcome so the form can map known 400s onto specific
  // fields (refundMechanism -> mechanism field, etc). On ok the parent unmounts
  // this form, so no local reset is needed.
  onSubmit: (body: RecordPaymentBody) => Promise<{ ok: boolean; message?: string }>;
}) {
  const [amount, setAmount] = useState("");
  const [methodId, setMethodId] = useState(SEED_PAYMENT_METHODS[0]?.id ?? "");
  const [reference, setReference] = useState("");

  const [resolution, setResolution] = useState<OverpaymentResolution | "">("");
  const [mechanism, setMechanism] = useState<RefundMechanism | "">("");
  const [refundReference, setRefundReference] = useState("");
  const [creditNotes, setCreditNotes] = useState("");

  const [attempted, setAttempted] = useState(false);
  const [formError, setFormError] = useState("");
  const [mechError, setMechError] = useState("");
  const [resolutionError, setResolutionError] = useState("");

  const remainingCents = Math.max(0, Math.round(remainingBalance * 100));
  const amountCents = toCents(amount);
  const isOverpayment = amountCents !== null && amountCents > remainingCents;
  const excessCents = isOverpayment ? amountCents - remainingCents : 0;
  const excessLabel = useMemo(
    () => formatNGN((excessCents / 100).toFixed(2)),
    [excessCents],
  );

  // When the amount drops back to or below the remaining balance, hide AND
  // clear the resolution sub-form so stale resolution data is never sent
  // (the backend rejects a resolution with no overpayment).
  useEffect(() => {
    if (!isOverpayment) {
      setResolution("");
      setMechanism("");
      setRefundReference("");
      setCreditNotes("");
      setMechError("");
      setResolutionError("");
    }
  }, [isOverpayment]);

  const submit = async () => {
    setAttempted(true);
    setFormError("");
    setMechError("");
    setResolutionError("");

    if (amountCents === null) {
      setFormError("Amount must be a decimal with up to 2 places.");
      return;
    }
    if (amountCents <= 0) {
      setFormError("Amount must be greater than zero.");
      return;
    }
    if (!methodId) {
      setFormError("Pick a payment method.");
      return;
    }
    if (isOverpayment) {
      if (!resolution) {
        setResolutionError("Choose how the overpayment was resolved.");
        return;
      }
      if (resolution === "REFUND" && !mechanism) {
        setMechError("Select the refund mechanism.");
        return;
      }
    }

    const body: RecordPaymentBody = {
      paymentMethodId: methodId,
      amount,
      ...(reference.trim() ? { referenceNumber: reference.trim() } : {}),
    };
    if (isOverpayment && resolution) {
      body.overpaymentResolution = resolution;
      if (resolution === "REFUND") {
        body.refundMechanism = mechanism as RefundMechanism;
        if (refundReference.trim()) body.refundReference = refundReference.trim();
      } else {
        if (creditNotes.trim()) body.creditNotes = creditNotes.trim();
      }
    }

    const res = await onSubmit(body);
    if (res.ok) return; // parent unmounts the form
    const msg = res.message ?? "Could not record the payment.";
    // Map known backend 400s onto the field that caused them (defensive: with
    // working client-side detection these should not fire).
    if (/refundmechanism/i.test(msg)) {
      setMechError(msg);
    } else if (/overpaymentresolution/i.test(msg) && /required/i.test(msg)) {
      setResolutionError(msg);
    } else if (/does not exceed the remaining balance/i.test(msg)) {
      // The balance moved since the form opened (another payment confirmed or
      // rejected). The parent refreshes remaining on a validation error, so the
      // sub-form re-derives correctly; tell the user to review.
      setFormError(
        "The balance changed since you opened this form (another payment may have been confirmed or rejected). Review the amount and resolution, then submit again.",
      );
    } else {
      setFormError(msg);
    }
  };

  const inputCls =
    "h-7 w-full px-2 text-[12.5px] text-[var(--color-ink-900)] bg-white border border-[var(--color-border-strong)] rounded-[3px] focus:outline-none focus:border-[var(--color-navy-700)] focus:shadow-[0_0_0_2px_rgba(31,78,121,0.14)]";
  const labelCls =
    "block text-[10.5px] font-medium uppercase tracking-[0.04em] text-[var(--color-ink-500)] mb-1";

  return (
    <div className="px-5 py-3 border-b border-[var(--color-border-default)] bg-[var(--color-navy-50)]" data-testid="record-payment-form">
      <h3 className="m-0 mb-2 text-[12.5px] font-semibold text-[var(--color-ink-900)]">Record payment (PENDING)</h3>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-2">
        <label className="block">
          <span className={labelCls}>Amount (NGN)</span>
          <input
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            data-testid="record-payment-amount"
            className={`${inputCls} tabular-nums font-mono text-right`}
          />
        </label>
        <label className="block">
          <span className={labelCls}>Method</span>
          <select value={methodId} onChange={(e) => setMethodId(e.target.value)} className={inputCls}>
            {SEED_PAYMENT_METHODS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={labelCls}>Reference</span>
          <input
            type="text"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="optional"
            className={inputCls}
          />
        </label>
      </div>

      {/* Overpayment indicator + resolution sub-form, revealed live as the amount
          crosses the remaining balance. */}
      {isOverpayment && (
        <div
          data-testid="overpayment-panel"
          className="mb-2 rounded-[3px] border border-[var(--color-warning-700)] bg-[var(--color-warning-50)] px-3 py-2.5"
        >
          <div className="text-[12.5px] font-semibold text-[var(--color-warning-700)]">
            This is an overpayment of <span data-testid="overpayment-excess" className="font-mono tabular-nums">{excessLabel}</span>. How was it resolved?
          </div>
          {hasPendingPayments && (
            <div className="mt-1 text-[11px] text-[var(--color-ink-500)]">
              Based on payments currently confirmed. Pending payments may affect the actual balance.
            </div>
          )}

          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1" role="radiogroup" aria-label="Overpayment resolution">
            {OVERPAYMENT_RESOLUTION.map((r) => (
              <label key={r} className="inline-flex items-center gap-1.5 text-[12.5px] text-[var(--color-ink-900)] cursor-pointer">
                <input
                  type="radio"
                  name="overpayment-resolution"
                  value={r}
                  checked={resolution === r}
                  onChange={() => setResolution(r)}
                  data-testid={`resolution-${r.toLowerCase()}`}
                  className="accent-[var(--color-navy-700)]"
                />
                {r === "REFUND" ? "Refund" : "Credit"}
              </label>
            ))}
          </div>
          {resolutionError && (
            <div role="alert" data-testid="resolution-error" className="mt-1 text-[11px] text-[var(--color-danger-700)]">
              {resolutionError}
            </div>
          )}

          {resolution === "REFUND" && (
            <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block">
                <span className={labelCls}>Refund mechanism (required)</span>
                <select
                  value={mechanism}
                  onChange={(e) => setMechanism(e.target.value as RefundMechanism | "")}
                  data-testid="refund-mechanism"
                  className={`${inputCls} ${mechError ? "border-[var(--color-danger-700)]" : ""}`}
                >
                  <option value="">Select...</option>
                  {REFUND_MECHANISM.map((m) => (
                    <option key={m} value={m}>
                      {REFUND_MECHANISM_LABEL[m]}
                    </option>
                  ))}
                </select>
                {mechError && (
                  <span role="alert" data-testid="mechanism-error" className="mt-1 block text-[11px] text-[var(--color-danger-700)]">
                    {mechError}
                  </span>
                )}
              </label>
              <label className="block">
                <span className={labelCls}>Refund reference</span>
                <input
                  type="text"
                  value={refundReference}
                  onChange={(e) => setRefundReference(e.target.value)}
                  placeholder="optional, transfer id / note"
                  data-testid="refund-reference"
                  className={inputCls}
                />
              </label>
            </div>
          )}

          {resolution === "CREDIT" && (
            <div className="mt-2">
              <label className="block">
                <span className={labelCls}>Credit notes</span>
                <input
                  type="text"
                  value={creditNotes}
                  onChange={(e) => setCreditNotes(e.target.value)}
                  placeholder="optional"
                  data-testid="credit-notes"
                  className={inputCls}
                />
              </label>
            </div>
          )}
        </div>
      )}

      {attempted && formError && (
        <div role="alert" data-testid="record-payment-error" className="mb-2 text-[11.5px] text-[var(--color-danger-700)]">
          {formError}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={onCancel} className="h-7 px-2.5 text-[12px] text-[var(--color-ink-700)]">
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={submitting}
          data-testid="record-payment-submit"
          className="h-7 px-3 rounded-[3px] text-[12px] font-medium text-white disabled:opacity-50"
          style={{ background: "var(--color-navy-700)" }}
        >
          {submitting ? "Recording..." : "Record"}
        </button>
      </div>
    </div>
  );
}
