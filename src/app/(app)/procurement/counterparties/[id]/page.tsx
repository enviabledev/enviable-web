"use client";

/**
 * Counterparty detail at /procurement/counterparties/[id]. Gated
 * 'counterparty.read'; management actions gated 'counterparty.manage'.
 *
 * Mirror-first paint via getById<Counterparty>('counterparty', id);
 * revalidates against /api/counterparties/:id. The detail's type-
 * conditional related-entities sections (POs as supplier, Products as
 * manufacturer, Shipments as forwarder/clearer/insurer, Letters of
 * Credit as bank) are all assembled client-side from the relevant
 * mirror buckets via the eighth meta-discipline (relation-read audit:
 * each section's join is explicitly filtered against the mirrored row,
 * with null lookups handled honestly as empty-state messages, not
 * silent empty arrays).
 *
 * Seventh meta-discipline (useUrlLastSegment empty-id guard) applied
 * at the top of the fetch effect. Field-access audit: the renderer
 * reads flat fields off the Counterparty row plus the related-entity
 * row arrays, no nested-relation reads on the Counterparty itself.
 *
 * Management actions: inline edit (name, status, contact, banking)
 * and soft-delete. Both online-only, confirmed-update for delete.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import FreshnessBadge from "@/components/sync/FreshnessBadge";
import OfflineNotice from "@/components/sync/OfflineNotice";
import {
  COUNTERPARTY_STATUS,
  deleteCounterparty,
  getCounterparty,
  updateCounterparty,
  type Counterparty,
  type CounterpartyStatus,
  type CounterpartyType,
} from "@/lib/api";
import { isTransientFailure } from "@/lib/api/client";
import { usePermissions } from "@/lib/auth";
import { DETAIL_GRID } from "@/lib/responsive";
import { useConnectivity } from "@/lib/sync/connectivity";
import { formatDateShort } from "@/lib/format";
import { getById, listByType } from "@/lib/sync/mirror/store";
import { useUrlLastSegment } from "@/lib/sync/use-url-segment";

const TYPE_LABEL: Record<CounterpartyType, string> = {
  MANUFACTURER: "Manufacturer",
  SUPPLIER: "Supplier",
  CLEARING_AGENT: "Clearing agent",
  FREIGHT_FORWARDER: "Freight forwarder",
  INSURANCE_COMPANY: "Insurance company",
  BANK: "Bank",
};

// Fixed mobile shorthand for the type pill, matching the list page so the
// long labels do not crowd the header at 375px (RESPONSIVE.md type-pill rule).
const TYPE_SHORT: Record<CounterpartyType, string> = {
  MANUFACTURER: "Mfr",
  SUPPLIER: "Supplier",
  CLEARING_AGENT: "Clearing",
  FREIGHT_FORWARDER: "Forwarder",
  INSURANCE_COMPANY: "Insurance",
  BANK: "Bank",
};

type RelatedPo = { id: string; poNumber: string; status: string; updatedAt: string };
type RelatedShipment = { id: string; shipmentReference: string; status: string; updatedAt: string };
type RelatedProduct = { id: string; name: string };
type RelatedLc = { id: string; lcNumber: string; status: string; updatedAt: string };

type RelatedEntities = {
  pos: RelatedPo[];
  shipments: RelatedShipment[];
  products: RelatedProduct[];
  lcs: RelatedLc[];
};

function readContact(c: Counterparty): Record<string, string> {
  if (!c.contact || typeof c.contact !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(c.contact as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

function readBankDetails(c: Counterparty): Record<string, string> {
  if (!c.bankDetails || typeof c.bankDetails !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(c.bankDetails as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

export default function CounterpartyDetailPage() {
  const router = useRouter();
  const { has } = usePermissions();
  const { state: connState } = useConnectivity();
  const canRead = has("counterparty.read");
  const canManage = has("counterparty.manage");
  const id = useUrlLastSegment();

  const [cp, setCp] = useState<Counterparty | null>(null);
  const [related, setRelated] = useState<RelatedEntities | null>(null);
  const [fromMirror, setFromMirror] = useState(false);
  const [offline, setOffline] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [errMsg, setErrMsg] = useState("");
  const [reloadTick, setReloadTick] = useState(0);
  const [edit, setEdit] = useState<
    | { status: "idle" }
    | { status: "editing"; draft: EditDraft }
    | { status: "submitting"; draft: EditDraft }
    | { status: "deleting" }
    | { status: "confirmingDelete" }
    | { status: "error"; message: string }
  >({ status: "idle" });

  useEffect(() => {
    if (!canRead || !id) return;
    const ctrl = new AbortController();
    setOffline(false);
    setNotFound(false);

    let mirrorPainted = false;
    (async () => {
      try {
        const row = await getById<Counterparty>("counterparty", id);
        if (ctrl.signal.aborted || !row) return;
        mirrorPainted = true;
        setCp(row.body);
        setFromMirror(true);
        // Related entities (eighth-meta relation-read audit: each section's
        // join is explicit, filtered against the mirror row, and the empty
        // case is rendered honestly).
        const [pos, shipments, products, lcs] = await Promise.all([
          listByType<RelatedPo & { supplierId: string }>("purchaseOrder"),
          listByType<RelatedShipment & {
            freightForwarderId: string | null;
            clearingAgentId: string | null;
            insuranceCompanyId: string | null;
          }>("shipment"),
          listByType<RelatedProduct & { manufacturerId: string | null }>("product"),
          listByType<RelatedLc & {
            issuingBankId: string | null;
            beneficiaryBankId: string | null;
          }>("letterOfCredit"),
        ]);
        if (ctrl.signal.aborted) return;
        setRelated({
          pos: pos
            .map((p) => p.body)
            .filter((p) => p.supplierId === id)
            .map((p) => ({ id: p.id, poNumber: p.poNumber, status: p.status, updatedAt: p.updatedAt }))
            .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)),
          shipments: shipments
            .map((s) => s.body)
            .filter(
              (s) =>
                s.freightForwarderId === id ||
                s.clearingAgentId === id ||
                s.insuranceCompanyId === id,
            )
            .map((s) => ({
              id: s.id,
              shipmentReference: s.shipmentReference,
              status: s.status,
              updatedAt: s.updatedAt,
            }))
            .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)),
          products: products
            .map((p) => p.body)
            .filter((p) => p.manufacturerId === id)
            .map((p) => ({ id: p.id, name: p.name })),
          lcs: lcs
            .map((l) => l.body)
            .filter((l) => l.issuingBankId === id || l.beneficiaryBankId === id)
            .map((l) => ({
              id: l.id,
              lcNumber: l.lcNumber,
              status: l.status,
              updatedAt: l.updatedAt,
            }))
            .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)),
        });
      } catch {
        // network drives
      }
    })();

    getCounterparty(id, ctrl.signal).then((r) => {
      if (ctrl.signal.aborted) return;
      if (r.kind === "ok") {
        setCp(r.data);
        setFromMirror(false);
        setErrMsg("");
      } else if (r.kind === "unauthorized") {
        router.replace("/login");
      } else if (r.kind === "forbidden") {
        setErrMsg("You do not have access to view this counterparty.");
      } else if (r.kind === "not_found") {
        if (!mirrorPainted) setNotFound(true);
      } else if (isTransientFailure(r)) {
        if (!mirrorPainted) setOffline(true);
      } else if ("message" in r) {
        setErrMsg(typeof r.message === "string" ? r.message : r.message.join("; "));
      }
    });

    return () => ctrl.abort();
  }, [canRead, id, router, reloadTick]);

  const beginEdit = () => {
    if (!cp) return;
    const contact = readContact(cp);
    const bank = readBankDetails(cp);
    setEdit({
      status: "editing",
      draft: {
        name: cp.name,
        status: cp.status,
        contactEmail: contact.contact_email ?? "",
        contactPhone: contact.phone ?? "",
        swiftBic: bank.swift_bic ?? "",
        bankAccountNote: bank.sample_account ?? "",
      },
    });
  };

  const saveEdit = async () => {
    if (edit.status !== "editing" || !cp) return;
    const draft = edit.draft;
    setEdit({ status: "submitting", draft });
    const contact: Record<string, string> = {};
    if (draft.contactEmail.trim()) contact.contact_email = draft.contactEmail.trim();
    if (draft.contactPhone.trim()) contact.phone = draft.contactPhone.trim();
    const bankDetails: Record<string, string> = {};
    if (cp.type === "BANK") {
      if (draft.swiftBic.trim()) bankDetails.swift_bic = draft.swiftBic.trim().toUpperCase();
      if (draft.bankAccountNote.trim()) bankDetails.sample_account = draft.bankAccountNote.trim();
    }
    const r = await updateCounterparty(cp.id, {
      name: draft.name.trim(),
      status: draft.status,
      contact: Object.keys(contact).length > 0 ? contact : {},
      ...(cp.type === "BANK" ? { bankDetails } : {}),
    });
    if (r.kind === "ok") {
      setEdit({ status: "idle" });
      setReloadTick((n) => n + 1);
    } else if (r.kind === "forbidden") {
      setEdit({ status: "error", message: "You do not have permission to edit counterparties." });
    } else if (r.kind === "validation") {
      setEdit({
        status: "error",
        message: typeof r.message === "string" ? r.message : r.message.join("; "),
      });
    } else if (r.kind === "network_error") {
      setEdit({ status: "error", message: "Network error. Edits require a live connection." });
    } else {
      setEdit({ status: "error", message: "Unexpected response from the server." });
    }
  };

  const doDelete = async () => {
    if (!cp) return;
    setEdit({ status: "deleting" });
    const r = await deleteCounterparty(cp.id);
    if (r.kind === "ok") {
      router.replace("/procurement/counterparties");
    } else if (r.kind === "forbidden") {
      setEdit({ status: "error", message: "You do not have permission to delete counterparties." });
    } else if (r.kind === "not_found") {
      setEdit({ status: "error", message: "Counterparty no longer exists (may have been deleted by another user)." });
    } else if (r.kind === "network_error") {
      setEdit({ status: "error", message: "Network error. Deletion requires a live connection." });
    } else {
      setEdit({ status: "error", message: "Unexpected response from the server." });
    }
  };

  if (!canRead) {
    return (
      <div className="max-w-[1080px] mx-auto py-10 text-center text-[var(--color-ink-500)]">
        You do not have access to counterparties (requires counterparty.read).
      </div>
    );
  }
  if (errMsg) {
    return (
      <div className="max-w-[820px] mx-auto py-10">
        <div className="px-3.5 py-2.5 rounded-[3px] bg-[var(--color-danger-100)] text-[var(--color-danger-700)] text-[12.5px]">
          {errMsg}
        </div>
      </div>
    );
  }
  if (notFound) {
    return (
      <div className="max-w-[640px] mx-auto py-12">
        <div className="bg-white border border-[var(--color-border-default)] rounded-[4px] px-6 py-8 text-center">
          <h1 className="text-[18px] font-semibold text-[var(--color-ink-900)] m-0 mb-2">Counterparty not found</h1>
          <p className="text-[13px] text-[var(--color-ink-700)] m-0 mb-3">
            No counterparty matches <span className="font-mono text-[var(--color-navy-700)]">{id}</span>.
          </p>
          <Link
            href="/procurement/counterparties"
            className="inline-flex items-center h-8 px-3 rounded-[3px] text-[12.5px] font-medium text-white"
            style={{ background: "var(--color-navy-700)" }}
          >
            Back to directory
          </Link>
        </div>
      </div>
    );
  }
  if (!cp && offline) {
    return (
      <div className="max-w-[820px] mx-auto pb-10">
        <OfflineNotice body="This counterparty will load once you are back online. Counterparties already cached appear from the local mirror." />
      </div>
    );
  }
  if (!cp) {
    return <div className="max-w-[1080px] mx-auto py-10 text-center text-[var(--color-ink-500)]">Loading counterparty...</div>;
  }

  const contact = readContact(cp);
  const bank = readBankDetails(cp);

  return (
    <div className="max-w-[1080px] mx-auto pb-10">
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
          <span className="text-[var(--color-ink-900)] font-medium">{cp.name}</span>
        </div>
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-3 flex-wrap mb-1">
              <h1 className="text-[22px] font-semibold text-[var(--color-ink-900)] m-0 tracking-[-0.01em]">
                {cp.name}
              </h1>
              <TypePill type={cp.type} />
              <StatusPill status={cp.status} />
              {fromMirror && <FreshnessBadge />}
            </div>
            <div className="text-[12px] text-[var(--color-ink-500)] mt-1 font-mono break-all">{cp.id}</div>
          </div>
          {canManage && edit.status === "idle" && (
            <div className="flex flex-wrap gap-2 w-full sm:w-auto">
              <button
                type="button"
                onClick={beginEdit}
                disabled={connState === "offline"}
                data-testid="edit-button"
                className="h-[32px] px-3 rounded-[3px] border border-[var(--color-border-strong)] bg-white text-[var(--color-ink-900)] text-[12.5px] font-medium disabled:opacity-50"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => setEdit({ status: "confirmingDelete" })}
                disabled={connState === "offline"}
                data-testid="delete-button"
                className="h-[32px] px-3 rounded-[3px] border border-[var(--color-danger-700)] bg-white text-[var(--color-danger-700)] text-[12.5px] font-medium disabled:opacity-50"
              >
                Delete
              </button>
            </div>
          )}
        </div>
      </header>

      {edit.status === "confirmingDelete" && (
        <div
          role="dialog"
          className="mb-4 px-4 py-3 rounded-[4px] border-2 border-[var(--color-danger-700)] bg-[var(--color-danger-50)]"
        >
          <div className="text-[13px] font-semibold text-[var(--color-danger-700)] mb-1">
            Soft-delete this counterparty?
          </div>
          <div className="text-[12.5px] text-[var(--color-ink-900)] mb-3">
            The row is marked deleted (deletedAt set). It no longer appears in the directory; the
            backend&apos;s CRUD endpoints will return 404 for further reads / updates. Existing references
            to this counterparty on POs, shipments, and other records are unchanged. This is not
            reversible from the UI.
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={doDelete}
              data-testid="delete-confirm"
              className="h-[32px] px-4 rounded-[3px] bg-[var(--color-danger-700)] text-white text-[12.5px] font-medium"
            >
              Confirm delete
            </button>
            <button
              type="button"
              onClick={() => setEdit({ status: "idle" })}
              className="h-[32px] px-3 rounded-[3px] border border-[var(--color-border-strong)] bg-white text-[var(--color-ink-900)] text-[12.5px] font-medium hover:bg-[var(--color-ink-100)]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {(edit.status === "editing" || edit.status === "submitting") && (
        <EditForm
          cp={cp}
          state={edit}
          onChange={(draft) =>
            edit.status === "editing" ? setEdit({ status: "editing", draft }) : null
          }
          onSave={saveEdit}
          onCancel={() => setEdit({ status: "idle" })}
        />
      )}

      {edit.status === "error" && (
        <div role="alert" className="mb-4 px-3.5 py-2.5 rounded-[3px] bg-[var(--color-danger-50)] border border-[var(--color-danger-100)] text-[12.5px] text-[var(--color-danger-700)]">
          {edit.message}
        </div>
      )}

      <section className="bg-white border border-[var(--color-border-default)] rounded-[4px] mb-5">
        <header className="px-4 sm:px-5 py-3 border-b border-[var(--color-border-default)]">
          <h2 className="m-0 text-[13px] font-semibold text-[var(--color-ink-900)]">Profile</h2>
        </header>
        <dl className="text-[12.5px] grid grid-cols-1 sm:grid-cols-2 gap-x-12 px-4 sm:px-5 py-3">
          <Row label="Email">
            {contact.contact_email ? (
              <a href={`mailto:${contact.contact_email}`} className="text-[var(--color-navy-700)] hover:underline break-all">
                {contact.contact_email}
              </a>
            ) : (
              <span className="text-[var(--color-ink-400)]">--</span>
            )}
          </Row>
          <Row label="Phone">
            {contact.phone ? (
              <span className="font-mono">{contact.phone}</span>
            ) : (
              <span className="text-[var(--color-ink-400)]">--</span>
            )}
          </Row>
          {cp.type === "BANK" && (
            <>
              <Row label="SWIFT / BIC">
                {bank.swift_bic ? (
                  <span className="font-mono">{bank.swift_bic}</span>
                ) : (
                  <span className="text-[var(--color-ink-400)]">--</span>
                )}
              </Row>
              <Row label="Account note">
                {bank.sample_account ?? <span className="text-[var(--color-ink-400)]">--</span>}
              </Row>
            </>
          )}
          <Row label="Created">{formatDateShort(cp.createdAt)}</Row>
          <Row label="Last updated">{formatDateShort(cp.updatedAt)}</Row>
        </dl>
      </section>

      <RelatedEntitiesPanel cp={cp} related={related} />
    </div>
  );
}

type EditDraft = {
  name: string;
  status: CounterpartyStatus;
  contactEmail: string;
  contactPhone: string;
  swiftBic: string;
  bankAccountNote: string;
};

function EditForm({
  cp,
  state,
  onChange,
  onSave,
  onCancel,
}: {
  cp: Counterparty;
  state: { status: "editing"; draft: EditDraft } | { status: "submitting"; draft: EditDraft };
  onChange: (draft: EditDraft) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const draft = state.draft;
  const submitting = state.status === "submitting";
  return (
    <section className="bg-white border border-[var(--color-border-default)] rounded-[4px] mb-5 px-4 sm:px-5 py-4">
      <h2 className="m-0 text-[13px] font-semibold text-[var(--color-ink-900)] mb-3">Edit profile</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <Field label="Name">
          <input
            type="text"
            value={draft.name}
            onChange={(e) => onChange({ ...draft, name: e.target.value })}
            disabled={submitting}
            data-testid="edit-name"
            className="h-[32px] w-full px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[13px]"
          />
        </Field>
        <Field label="Status">
          <select
            value={draft.status}
            onChange={(e) => onChange({ ...draft, status: e.target.value as CounterpartyStatus })}
            disabled={submitting}
            data-testid="edit-status"
            className="h-[32px] w-full px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[13px]"
          >
            {COUNTERPARTY_STATUS.map((s) => (
              <option key={s} value={s}>
                {s === "ACTIVE" ? "Active" : "Inactive"}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Email">
          <input
            type="email"
            value={draft.contactEmail}
            onChange={(e) => onChange({ ...draft, contactEmail: e.target.value })}
            disabled={submitting}
            className="h-[32px] w-full px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[13px]"
          />
        </Field>
        <Field label="Phone">
          <input
            type="tel"
            value={draft.contactPhone}
            onChange={(e) => onChange({ ...draft, contactPhone: e.target.value })}
            disabled={submitting}
            className="h-[32px] w-full px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[13px]"
          />
        </Field>
        {cp.type === "BANK" && (
          <>
            <Field label="SWIFT / BIC">
              <input
                type="text"
                value={draft.swiftBic}
                onChange={(e) => onChange({ ...draft, swiftBic: e.target.value })}
                disabled={submitting}
                className="h-[32px] w-full px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[13px] font-mono"
              />
            </Field>
            <Field label="Account note">
              <input
                type="text"
                value={draft.bankAccountNote}
                onChange={(e) => onChange({ ...draft, bankAccountNote: e.target.value })}
                disabled={submitting}
                className="h-[32px] w-full px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[13px]"
              />
            </Field>
          </>
        )}
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={submitting || !draft.name.trim()}
          data-testid="edit-save"
          className="h-[32px] px-4 rounded-[3px] bg-[var(--color-navy-700)] text-white text-[12.5px] font-medium disabled:opacity-50"
        >
          {submitting ? "Saving..." : "Save changes"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="h-[32px] px-3 rounded-[3px] border border-[var(--color-border-strong)] bg-white text-[var(--color-ink-900)] text-[12.5px] font-medium hover:bg-[var(--color-ink-100)]"
        >
          Cancel
        </button>
      </div>
    </section>
  );
}

function RelatedEntitiesPanel({
  cp,
  related,
}: {
  cp: Counterparty;
  related: RelatedEntities | null;
}) {
  if (!related) {
    return (
      <section className="bg-white border border-[var(--color-border-default)] rounded-[4px] px-4 sm:px-5 py-5 text-[12.5px] text-[var(--color-ink-500)]">
        Loading related records...
      </section>
    );
  }
  // Type-conditional relevance per the schema's FK fields:
  //   SUPPLIER       -> POs (purchaseOrder.supplierId)
  //   MANUFACTURER   -> Products (product.manufacturerId)
  //   FREIGHT_FORWARDER / CLEARING_AGENT / INSURANCE_COMPANY -> Shipments
  //   BANK           -> Letters of credit (lc.issuingBankId | beneficiaryBankId)
  // A counterparty may have rows in OTHER sections too (a SUPPLIER's
  // manufacturerId on a Product would be unusual but allowed); render
  // any non-empty section regardless of the primary type, with the
  // type-aligned section at the top.
  const sections: {
    key: string;
    title: string;
    primary: boolean;
    rows: React.ReactNode;
    count: number;
  }[] = [
    {
      key: "pos",
      title: "Purchase orders (as supplier)",
      primary: cp.type === "SUPPLIER",
      count: related.pos.length,
      rows: (
        <tbody>
          {related.pos.map((p, i) => (
            <tr key={p.id} className={`${i % 2 ? "bg-[#FBFBFC]" : "bg-white"} border-b border-[var(--color-border-default)] last:border-b-0`}>
              <Td>
                <Link href={`/procurement/purchase-orders/${p.id}`} className="text-[var(--color-navy-700)] hover:underline font-mono">
                  {p.poNumber}
                </Link>
              </Td>
              <Td>{p.status}</Td>
              <Td>{formatDateShort(p.updatedAt)}</Td>
            </tr>
          ))}
        </tbody>
      ),
    },
    {
      key: "shipments",
      title: "Shipments (as forwarder / clearer / insurer)",
      primary:
        cp.type === "FREIGHT_FORWARDER" ||
        cp.type === "CLEARING_AGENT" ||
        cp.type === "INSURANCE_COMPANY",
      count: related.shipments.length,
      rows: (
        <tbody>
          {related.shipments.map((s, i) => (
            <tr key={s.id} className={`${i % 2 ? "bg-[#FBFBFC]" : "bg-white"} border-b border-[var(--color-border-default)] last:border-b-0`}>
              <Td>
                <Link href={`/procurement/shipments/${s.id}`} className="text-[var(--color-navy-700)] hover:underline font-mono">
                  {s.shipmentReference}
                </Link>
              </Td>
              <Td>{s.status}</Td>
              <Td>{formatDateShort(s.updatedAt)}</Td>
            </tr>
          ))}
        </tbody>
      ),
    },
    {
      key: "products",
      title: "Products (as manufacturer)",
      primary: cp.type === "MANUFACTURER",
      count: related.products.length,
      rows: (
        <tbody>
          {related.products.map((p, i) => (
            <tr key={p.id} className={`${i % 2 ? "bg-[#FBFBFC]" : "bg-white"} border-b border-[var(--color-border-default)] last:border-b-0`}>
              <Td>{p.name}</Td>
              <Td mono>{p.id}</Td>
            </tr>
          ))}
        </tbody>
      ),
    },
    {
      key: "lcs",
      title: "Letters of credit (as issuing or beneficiary bank)",
      primary: cp.type === "BANK",
      count: related.lcs.length,
      rows: (
        <tbody>
          {related.lcs.map((l, i) => (
            <tr key={l.id} className={`${i % 2 ? "bg-[#FBFBFC]" : "bg-white"} border-b border-[var(--color-border-default)] last:border-b-0`}>
              <Td mono>{l.lcNumber}</Td>
              <Td>{l.status}</Td>
              <Td>{formatDateShort(l.updatedAt)}</Td>
            </tr>
          ))}
        </tbody>
      ),
    },
  ];

  // Show all sections that either match the primary type OR have rows.
  const surfaced = sections.filter((s) => s.primary || s.count > 0);

  if (surfaced.length === 0) {
    return (
      <section className="bg-white border border-[var(--color-border-default)] rounded-[4px] px-4 sm:px-5 py-6 text-[12.5px] text-[var(--color-ink-500)] text-center">
        No related records found in the local mirror.
      </section>
    );
  }

  return (
    <div className="space-y-5">
      {surfaced.map((s) => (
        <section key={s.key} className="bg-white border border-[var(--color-border-default)] rounded-[4px]" data-testid={`section-${s.key}`}>
          <header className="px-4 sm:px-5 py-3 border-b border-[var(--color-border-default)] flex items-center justify-between gap-2">
            <h2 className="m-0 text-[13px] font-semibold text-[var(--color-ink-900)]">{s.title}</h2>
            <span className="text-[11px] text-[var(--color-ink-500)] whitespace-nowrap">
              {s.count} {s.count === 1 ? "record" : "records"}
            </span>
          </header>
          {s.count === 0 ? (
            <div className="px-4 sm:px-5 py-6 text-center text-[12.5px] text-[var(--color-ink-500)]">
              None on file in the local mirror.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                {s.rows}
              </table>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

function TypePill({ type }: { type: CounterpartyType }) {
  return (
    <span
      title={TYPE_LABEL[type]}
      className="inline-flex items-center h-[20px] px-2 rounded-full text-[10.5px] font-semibold uppercase tracking-[0.02em] whitespace-nowrap bg-[var(--color-ink-100)] text-[var(--color-ink-700)]"
    >
      <span className="sm:hidden">{TYPE_SHORT[type]}</span>
      <span className="hidden sm:inline">{TYPE_LABEL[type]}</span>
    </span>
  );
}

function StatusPill({ status }: { status: CounterpartyStatus }) {
  const styled =
    status === "ACTIVE"
      ? "bg-[var(--color-success-100)] text-[var(--color-success-700)]"
      : "bg-[var(--color-ink-100)] text-[var(--color-ink-700)]";
  return (
    <span
      className={`inline-flex items-center h-[20px] px-2 rounded-full text-[10.5px] font-semibold uppercase tracking-[0.02em] ${styled}`}
    >
      {status === "ACTIVE" ? "Active" : "Inactive"}
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] font-medium">
        {label}
      </span>
      {children}
    </label>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`${DETAIL_GRID} gap-1 sm:gap-3 items-baseline py-2 border-b border-dashed border-[var(--color-border-default)] last:border-b-0`}>
      <dt className="text-[12px] font-medium text-[var(--color-ink-500)]">{label}</dt>
      <dd className="m-0 text-[var(--color-ink-900)] break-words min-w-0">{children}</dd>
    </div>
  );
}

function Td({ children, mono = false }: { children: React.ReactNode; mono?: boolean }) {
  return (
    <td
      className={`px-2 sm:px-3.5 py-2 text-[12.5px] text-[var(--color-ink-900)] whitespace-nowrap ${mono ? "font-mono text-[12px] tracking-[0.02em]" : ""}`}
    >
      {children}
    </td>
  );
}
