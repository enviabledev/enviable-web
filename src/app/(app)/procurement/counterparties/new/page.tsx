"use client";

/**
 * Create a new counterparty. Gated 'counterparty.manage'. Online-only
 * write (back-office work; the assembly/receipt offline-queue rationale
 * does not apply to counterparty management).
 *
 * The form mirrors CreateCounterpartyDto: name + type required, status
 * defaults to ACTIVE on the DB, contact + bankDetails are optional JSON
 * blobs. For the MVP form, contact is captured as two simple fields
 * (email + phone) and bank details only when type === BANK (SWIFT + a
 * sample account note); both can be edited later via the detail page.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  COUNTERPARTY_TYPE,
  createCounterparty,
  type CounterpartyType,
} from "@/lib/api";
import { usePermissions } from "@/lib/auth";
import { useConnectivity } from "@/lib/sync/connectivity";

const TYPE_LABEL: Record<CounterpartyType, string> = {
  MANUFACTURER: "Manufacturer",
  SUPPLIER: "Supplier",
  CLEARING_AGENT: "Clearing agent",
  FREIGHT_FORWARDER: "Freight forwarder",
  INSURANCE_COMPANY: "Insurance company",
  BANK: "Bank",
};

export default function NewCounterpartyPage() {
  const router = useRouter();
  const { has } = usePermissions();
  const canManage = has("counterparty.manage");
  const { state: connState } = useConnectivity();

  const [name, setName] = useState("");
  const [type, setType] = useState<CounterpartyType>("SUPPLIER");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [swiftBic, setSwiftBic] = useState("");
  const [bankAccountNote, setBankAccountNote] = useState("");

  const [state, setState] = useState<
    | { status: "idle" }
    | { status: "submitting" }
    | { status: "error"; message: string }
    | { status: "conflict"; message: string }
  >({ status: "idle" });

  if (!canManage) {
    return (
      <div className="max-w-[1080px] mx-auto py-10 text-center text-[var(--color-ink-500)]">
        You do not have permission to add counterparties (requires counterparty.manage).
      </div>
    );
  }

  const disabled = connState === "offline" || state.status === "submitting" || !name.trim();

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setState({ status: "submitting" });
    const contact: Record<string, string> = {};
    if (contactEmail.trim()) contact.contact_email = contactEmail.trim();
    if (contactPhone.trim()) contact.phone = contactPhone.trim();
    const bankDetails: Record<string, string> = {};
    if (type === "BANK") {
      if (swiftBic.trim()) bankDetails.swift_bic = swiftBic.trim().toUpperCase();
      if (bankAccountNote.trim()) bankDetails.sample_account = bankAccountNote.trim();
    }
    const r = await createCounterparty({
      name: name.trim(),
      type,
      ...(Object.keys(contact).length > 0 ? { contact } : {}),
      ...(type === "BANK" && Object.keys(bankDetails).length > 0
        ? { bankDetails }
        : {}),
    });
    if (r.kind === "ok") {
      router.replace(`/procurement/counterparties/${r.data.id}`);
      return;
    }
    if (r.kind === "conflict") {
      setState({ status: "conflict", message: r.message });
    } else if (r.kind === "validation") {
      setState({
        status: "error",
        message: typeof r.message === "string" ? r.message : r.message.join("; "),
      });
    } else if (r.kind === "forbidden") {
      setState({ status: "error", message: "You do not have permission to create counterparties." });
    } else if (r.kind === "network_error") {
      setState({
        status: "error",
        message: "Network error reaching the backend. Counterparty creation requires a live connection.",
      });
    } else {
      setState({ status: "error", message: "Unexpected response from the server." });
    }
  };

  return (
    <div className="max-w-[720px] mx-auto pb-10">
      <header className="pb-4 mb-5 border-b border-[var(--color-border-default)]">
        <div className="text-[12px] text-[var(--color-ink-500)] flex items-center gap-1.5 mb-1.5 flex-wrap">
          <Link href="/procurement/counterparties" className="text-[var(--color-ink-500)] hover:text-[var(--color-navy-700)]">
            Procurement
          </Link>
          <span className="text-[var(--color-ink-300)]">/</span>
          <Link href="/procurement/counterparties" className="text-[var(--color-ink-500)] hover:text-[var(--color-navy-700)]">
            Suppliers &amp; counterparties
          </Link>
          <span className="text-[var(--color-ink-300)]">/</span>
          <span className="text-[var(--color-ink-900)] font-medium">New</span>
        </div>
        <h1 className="text-[22px] font-semibold text-[var(--color-ink-900)] m-0 tracking-[-0.01em]">
          New counterparty
        </h1>
        <div className="text-[12.5px] text-[var(--color-ink-500)] mt-1">
          Each counterparty is one role for a legal entity. If the same legal entity already acts in
          another capacity, this creates a parallel record for the new role.
        </div>
      </header>

      <form onSubmit={onSubmit} className="bg-white border border-[var(--color-border-default)] rounded-[4px] p-5 space-y-4">
        <Field label="Name" required>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            data-testid="cp-name"
            placeholder="e.g. Lagos Freight Logistics Ltd"
            className="h-[32px] w-full px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[13px] text-[var(--color-ink-900)]"
          />
        </Field>

        <Field label="Type" required>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as CounterpartyType)}
            data-testid="cp-type"
            className="h-[32px] w-full px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[13px] text-[var(--color-ink-900)]"
          >
            {COUNTERPARTY_TYPE.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </Field>

        <fieldset className="border-t border-[var(--color-border-default)] pt-3">
          <legend className="text-[11px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] font-medium px-0">
            Contact (optional)
          </legend>
          <div className="grid grid-cols-2 gap-3 mt-2">
            <Field label="Email">
              <input
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                placeholder="ops@example.com"
                className="h-[32px] w-full px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[13px] text-[var(--color-ink-900)]"
              />
            </Field>
            <Field label="Phone">
              <input
                type="tel"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                placeholder="+234-..."
                className="h-[32px] w-full px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[13px] text-[var(--color-ink-900)]"
              />
            </Field>
          </div>
        </fieldset>

        {type === "BANK" && (
          <fieldset className="border-t border-[var(--color-border-default)] pt-3">
            <legend className="text-[11px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] font-medium px-0">
              Banking details (optional)
            </legend>
            <div className="grid grid-cols-2 gap-3 mt-2">
              <Field label="SWIFT / BIC">
                <input
                  type="text"
                  value={swiftBic}
                  onChange={(e) => setSwiftBic(e.target.value)}
                  placeholder="ABCDNGLA"
                  className="h-[32px] w-full px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[13px] text-[var(--color-ink-900)] font-mono"
                />
              </Field>
              <Field label="Account note">
                <input
                  type="text"
                  value={bankAccountNote}
                  onChange={(e) => setBankAccountNote(e.target.value)}
                  placeholder="e.g. trade-account-1"
                  className="h-[32px] w-full px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[13px] text-[var(--color-ink-900)]"
                />
              </Field>
            </div>
            <p className="text-[11px] text-[var(--color-ink-500)] mt-1.5">
              Banking details are stored as-is. Do not paste full account numbers; this is a note
              field, not a verified account-record field.
            </p>
          </fieldset>
        )}

        {state.status === "error" && (
          <div role="alert" className="px-3.5 py-2.5 rounded-[3px] bg-[var(--color-danger-50)] border border-[var(--color-danger-100)] text-[12.5px] text-[var(--color-danger-700)]">
            {state.message}
          </div>
        )}
        {state.status === "conflict" && (
          <div role="alert" className="px-3.5 py-2.5 rounded-[3px] bg-[var(--color-warning-50)] border border-[var(--color-warning-700)] text-[12.5px] text-[var(--color-warning-700)]">
            <div className="font-semibold mb-0.5">Server reported a conflict</div>
            <div className="text-[var(--color-ink-700)]">{state.message}</div>
          </div>
        )}

        <div className="flex items-center gap-2 pt-2">
          <button
            type="submit"
            disabled={disabled}
            data-testid="cp-submit"
            className="h-[32px] px-4 rounded-[3px] bg-[var(--color-navy-700)] text-white text-[12.5px] font-medium disabled:opacity-50"
          >
            {state.status === "submitting" ? "Creating..." : "Create counterparty"}
          </button>
          <Link
            href="/procurement/counterparties"
            className="h-[32px] px-3 inline-flex items-center rounded-[3px] border border-[var(--color-border-strong)] bg-white text-[var(--color-ink-900)] text-[12.5px] font-medium hover:bg-[var(--color-ink-100)]"
          >
            Cancel
          </Link>
          {connState === "offline" && (
            <span className="text-[11.5px] text-[var(--color-warning-700)] ml-2">
              Disabled offline. Counterparty creation requires a connection.
            </span>
          )}
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  required = false,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] font-medium">
        {label}
        {required && <span className="text-[var(--color-danger-700)] ml-1">*</span>}
      </span>
      {children}
    </label>
  );
}
