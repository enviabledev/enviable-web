"use client";

/**
 * Create-customer overlay (prompt 33-A). Uses the Modal overlay primitive,
 * matching CreateUserModal's shape: online-only write, error surfacing,
 * onSuccess(createdCustomer) so the parent closes + refreshes + raises a
 * notification with the customer's name.
 *
 * Fields: name (required), type (RESELLER / END_USER), tier, phone, email,
 * taxId. There is intentionally NO status field: new customers default to
 * ACTIVE on the backend (status is only mutated later via the detail page's
 * deactivate / reactivate affordances).
 *
 * Tier sourcing: the tier options come from the mirror "customerTier" bucket
 * (listByType("customerTier"); each body is { id, name, status }). Tier is now
 * type-aware (50a, Individual tier):
 *   - END_USER: the backend auto-assigns the Individual tier, so the picker
 *     shows Individual selected + disabled (transparency) and the request sends
 *     tierId null (the friendly path; an explicit reseller override is an
 *     API-only action).
 *   - RESELLER: a reseller tier is REQUIRED (closes the latent no-tier dead-end
 *     from 50a). The picker shows ONLY the two reseller tiers (Individual is
 *     conceptually end-user-only) and submission is blocked with an inline
 *     error until one is chosen.
 */
import { useEffect, useMemo, useState } from "react";

import Modal from "@/components/ui/Modal";
import { createCustomer, type Customer, type CustomerType } from "@/lib/api";
import { useActiveTiers } from "@/lib/pricing/use-tiers";
import { useConnectivity } from "@/lib/sync/connectivity";

// The seeded Individual tier (50a). Used for UX presentation only; the backend
// owns the auto-assignment rule.
const INDIVIDUAL_TIER_ID = "seed-tier-individual";

export default function CreateCustomerModal({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: (created: Customer) => void;
}) {
  const { state: connState } = useConnectivity();
  const offline = connState === "offline";

  // Tiers from the mirror, re-read on mirror progress (cold-mirror safe), so the
  // reseller options populate even if the modal opens before the first sync.
  const { tiers: tierOptions } = useActiveTiers();
  const [name, setName] = useState("");
  const [type, setType] = useState<CustomerType>("RESELLER");
  const [tierId, setTierId] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [taxId, setTaxId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState("");

  // Reset the form each time the modal opens so a re-open is always clean.
  useEffect(() => {
    if (!open) return;
    setName("");
    setType("RESELLER");
    setTierId("");
    setPhone("");
    setEmail("");
    setTaxId("");
    setSubmitting(false);
    setAttempted(false);
    setError("");
  }, [open]);

  // Individual is end-user-only; resellers pick from the remaining tiers.
  const resellerTiers = useMemo(
    () => tierOptions.filter((t) => t.id !== INDIVIDUAL_TIER_ID),
    [tierOptions],
  );
  const individualName =
    tierOptions.find((t) => t.id === INDIVIDUAL_TIER_ID)?.name ?? "Individual";
  const resellerTierMissing = type === "RESELLER" && tierId === "";

  const canSubmit = useMemo(
    () => name.trim().length > 0 && !offline && !submitting,
    [name, offline, submitting],
  );

  const submit = async () => {
    setAttempted(true);
    if (!canSubmit) return;
    // RESELLER requires a tier (50a dead-end fix). Block with an inline error.
    if (resellerTierMissing) return;
    setSubmitting(true);
    setError("");
    const r = await createCustomer({
      name: name.trim(),
      type,
      // END_USER is sent the explicit Individual tier; RESELLER carries its
      // chosen (required) tier. The backend auto-assigns Individual on create
      // when tierId is null, but NOT on update (PATCH), so the customer detail
      // edit must send it explicitly; sending it here too keeps create/edit
      // symmetric. "Explicit tierId always wins" (50a).
      tierId: type === "END_USER" ? INDIVIDUAL_TIER_ID : tierId,
      phone: phone.trim() || null,
      email: email.trim() || null,
      taxId: taxId.trim() || null,
    });
    if (r.kind === "ok") {
      onSuccess(r.data);
      return;
    }
    setSubmitting(false);
    if (r.kind === "forbidden") {
      setError("You do not have permission to create customers (requires customer.manage).");
    } else if (r.kind === "conflict") {
      setError(r.message || "A customer conflict prevented creation.");
    } else if (r.kind === "validation") {
      setError(typeof r.message === "string" ? r.message : r.message.join("; "));
    } else if (r.kind === "network_error") {
      setError("Network error. Creating a customer requires a live connection.");
    } else {
      setError("Unexpected response from the server.");
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create customer"
      testId="create-customer-modal"
      footer={
        <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            data-testid="create-customer-submit"
            className="h-[32px] px-4 rounded-[3px] bg-[var(--color-navy-700)] text-white text-[12.5px] font-medium disabled:opacity-50 w-full sm:w-auto order-1 sm:order-2"
          >
            {submitting ? "Creating..." : "Create customer"}
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
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="flex flex-col gap-3"
      >
        {offline && (
          <div className="px-3 py-2 rounded-[3px] bg-[var(--color-warning-100)] text-[var(--color-warning-700)] text-[12px]">
            Creating a customer requires a live connection. Reconnect to continue.
          </div>
        )}
        {error && (
          <div
            role="alert"
            data-testid="create-customer-error"
            className="px-3 py-2 rounded-[3px] bg-[var(--color-danger-50)] border border-[var(--color-danger-100)] text-[12.5px] text-[var(--color-danger-700)]"
          >
            {error}
          </div>
        )}

        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] font-medium">
            Name
          </span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={submitting}
            data-testid="create-customer-name"
            className="h-[32px] w-full px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[13px]"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] font-medium">
            Type
          </span>
          <select
            value={type}
            onChange={(e) => {
              const next = e.target.value as CustomerType;
              setType(next);
              // End users never carry a tier; clear any reseller selection.
              if (next === "END_USER") setTierId("");
            }}
            disabled={submitting}
            data-testid="create-customer-type"
            className="h-[32px] w-full px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[13px]"
          >
            <option value="RESELLER">Reseller</option>
            <option value="END_USER">End user</option>
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] font-medium">
            Tier
          </span>
          {type === "END_USER" ? (
            <>
              <select
                value={INDIVIDUAL_TIER_ID}
                disabled
                data-testid="create-customer-tier"
                className="h-[32px] w-full px-2 rounded-[3px] border border-[var(--color-border-default)] bg-[var(--color-ink-100)] text-[13px] text-[var(--color-ink-700)]"
              >
                <option value={INDIVIDUAL_TIER_ID}>{individualName}</option>
              </select>
              <span className="text-[11.5px] text-[var(--color-ink-500)]" data-testid="create-customer-tier-help">
                End-user customers are assigned the Individual tier automatically.
              </span>
            </>
          ) : (
            <>
              <select
                value={tierId}
                onChange={(e) => setTierId(e.target.value)}
                disabled={submitting}
                data-testid="create-customer-tier"
                aria-invalid={attempted && resellerTierMissing}
                className={`h-[32px] w-full px-2 rounded-[3px] border bg-white text-[13px] ${
                  attempted && resellerTierMissing
                    ? "border-[var(--color-danger-700)]"
                    : "border-[var(--color-border-default)]"
                }`}
              >
                <option value="">Select a tier…</option>
                {resellerTiers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              {attempted && resellerTierMissing ? (
                <span className="text-[11.5px] text-[var(--color-danger-700)]" data-testid="create-customer-tier-error">
                  Resellers must be assigned a reseller tier.
                </span>
              ) : (
                <span className="text-[11.5px] text-[var(--color-ink-500)]" data-testid="create-customer-tier-help">
                  Resellers must be assigned a reseller tier.
                </span>
              )}
            </>
          )}
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] font-medium">
            Phone
          </span>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            disabled={submitting}
            data-testid="create-customer-phone"
            placeholder="e.g. +234-800-..."
            className="h-[32px] w-full px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[13px] font-mono"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] font-medium">
            Email
          </span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={submitting}
            data-testid="create-customer-email"
            className="h-[32px] w-full px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[13px]"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] font-medium">
            Tax ID
          </span>
          <input
            type="text"
            value={taxId}
            onChange={(e) => setTaxId(e.target.value)}
            disabled={submitting}
            data-testid="create-customer-taxid"
            className="h-[32px] w-full px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[13px] font-mono"
          />
        </label>
      </form>
    </Modal>
  );
}
