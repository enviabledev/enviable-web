"use client";

/**
 * Counterparties at /procurement/counterparties. Gated 'counterparty.read'.
 *
 * Outcome A per prompt 21's audit: backend has full CRUD endpoints with
 * separate read / manage permissions, the data is in the mirror, and the
 * frontend was greenfield. This builds the managed catalogue.
 *
 * Mirror-only screen, sixth meta-discipline applies: re-read on
 * visibilitychange + focus + online + 15s tick. Eighth-discipline relation
 * audit: this list's rendered fields come from a flat Counterparty row,
 * no cross-bucket joins, so the audit is trivial; the detail page does
 * the joins.
 *
 * Single-typed model: each Counterparty row has exactly one CounterpartyType
 * (the schema's enum). A legal entity acting in multiple capacities is
 * represented as multiple rows (one per role). The list shows the type
 * column as the primary discriminator.
 */
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { SearchIcon, SuppliersIcon } from "@/components/icons";
import FreshnessBadge from "@/components/sync/FreshnessBadge";
import {
  COUNTERPARTY_STATUS,
  COUNTERPARTY_TYPE,
  type Counterparty,
  type CounterpartyStatus,
  type CounterpartyType,
} from "@/lib/api";
import { usePermissions } from "@/lib/auth";
import { COL, FILTER_CONTROL, FILTER_FORM } from "@/lib/responsive";
import { useMirrorFreshness } from "@/lib/sync/mirror/freshness";
import { listByType } from "@/lib/sync/mirror/store";

type Row = Pick<Counterparty, "id" | "name" | "type" | "status" | "updatedAt"> & {
  hasContact: boolean;
};

const TYPE_LABEL: Record<CounterpartyType, string> = {
  MANUFACTURER: "Manufacturer",
  SUPPLIER: "Supplier",
  CLEARING_AGENT: "Clearing agent",
  FREIGHT_FORWARDER: "Freight forwarder",
  INSURANCE_COMPANY: "Insurance",
  BANK: "Bank",
};

// Fixed mobile shorthand for the type pill so the long labels (Freight
// forwarder, Insurance company, Clearing agent) do not push Tier 1 past
// 375px. Same SoStatusPill two-span shape; full label stays on title +
// the sm+ span (RESPONSIVE.md status/type-pill rule).
const TYPE_SHORT: Record<CounterpartyType, string> = {
  MANUFACTURER: "Mfr",
  SUPPLIER: "Supplier",
  CLEARING_AGENT: "Clearing",
  FREIGHT_FORWARDER: "Forwarder",
  INSURANCE_COMPANY: "Insurance",
  BANK: "Bank",
};

function readParams(sp: URLSearchParams) {
  const typeRaw = sp.get("type") ?? "";
  const type: CounterpartyType | "" = (COUNTERPARTY_TYPE as readonly string[]).includes(typeRaw)
    ? (typeRaw as CounterpartyType)
    : "";
  const statusRaw = sp.get("status") ?? "";
  const status: CounterpartyStatus | "" = (COUNTERPARTY_STATUS as readonly string[]).includes(statusRaw)
    ? (statusRaw as CounterpartyStatus)
    : "";
  const search = sp.get("search") ?? "";
  return { type, status, search };
}

function buildHref(p: Partial<ReturnType<typeof readParams>>): string {
  const sp = new URLSearchParams();
  if (p.type) sp.set("type", p.type);
  if (p.status) sp.set("status", p.status);
  if (p.search) sp.set("search", p.search);
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

export default function CounterpartiesPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const { has } = usePermissions();
  const canRead = has("counterparty.read");
  const canManage = has("counterparty.manage");

  const params = useMemo(() => readParams(new URLSearchParams(sp.toString())), [sp]);
  const [searchDraft, setSearchDraft] = useState(params.search);
  useEffect(() => setSearchDraft(params.search), [params.search]);

  const [rows, setRows] = useState<Row[] | null>(null);
  const watermark = useMirrorFreshness();
  const bootstrapping = watermark ? !watermark.historyComplete : true;

  const navigate = useCallback(
    (next: Partial<ReturnType<typeof readParams>>) => {
      router.replace(`/procurement/counterparties${buildHref({ ...params, ...next })}`);
    },
    [params, router],
  );

  useEffect(() => {
    if (!canRead) return;
    let cancelled = false;
    const read = async () => {
      try {
        const rs = await listByType<Counterparty>("counterparty");
        if (cancelled) return;
        const built: Row[] = rs
          .map((r) => r.body)
          // Hide soft-deleted rows from the catalogue view.
          .filter((c) => c.deletedAt == null)
          .map<Row>((c) => ({
            id: c.id,
            name: c.name,
            type: c.type,
            status: c.status,
            updatedAt: c.updatedAt,
            hasContact: c.contact != null && Object.keys((c.contact as object) ?? {}).length > 0,
          }))
          .sort((a, b) => a.name.localeCompare(b.name));
        if (!cancelled) setRows(built);
      } catch {
        if (!cancelled) setRows([]);
      }
    };
    void read();
    const onVisible = () => {
      if (document.visibilityState === "visible") void read();
    };
    window.addEventListener("focus", read);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", read);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void read();
    }, 15000);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", read);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", read);
      window.clearInterval(interval);
    };
  }, [canRead]);

  if (!canRead) {
    return (
      <div className="max-w-[1080px] mx-auto py-10 text-center text-[var(--color-ink-500)]">
        You do not have access to counterparties (requires counterparty.read).
      </div>
    );
  }

  const visible = (rows ?? []).filter((r) => {
    if (params.type && r.type !== params.type) return false;
    if (params.status && r.status !== params.status) return false;
    if (params.search) {
      const q = params.search.toUpperCase();
      if (!r.name.toUpperCase().includes(q)) return false;
    }
    return true;
  });

  return (
    <div className="max-w-[1480px] mx-auto pb-10">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 sm:gap-6 pb-4 mb-4 border-b border-[var(--color-border-default)]">
        <div>
          <div className="text-[12px] text-[var(--color-ink-500)] mb-1.5">Procurement / Suppliers &amp; counterparties</div>
          <h1 className="text-[22px] font-semibold text-[var(--color-ink-900)] m-0 tracking-[-0.01em] flex items-center gap-2">
            <SuppliersIcon className="w-[18px] h-[18px] text-[var(--color-ink-500)]" />
            Suppliers &amp; counterparties
          </h1>
          <div className="text-[12.5px] text-[var(--color-ink-500)] mt-1 max-w-[920px]">
            Directory of the business entities we transact with: suppliers, manufacturers, freight
            forwarders, clearing agents, insurers, and banks. Each row is a single role for a legal
            entity; the same legal entity acting in multiple capacities lives as multiple rows.
          </div>
        </div>
        {canManage && (
          <Link
            href="/procurement/counterparties/new"
            data-testid="new-counterparty"
            className="h-[32px] px-4 inline-flex items-center rounded-[3px] bg-[var(--color-navy-700)] text-white text-[12.5px] font-medium self-start"
          >
            New counterparty
          </Link>
        )}
      </header>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          navigate({ search: searchDraft });
        }}
        className={`bg-white border border-[var(--color-border-default)] rounded-[4px] px-3 py-2.5 mb-3 ${FILTER_FORM}`}
      >
        <Field label="Type">
          <select
            value={params.type}
            onChange={(e) => navigate({ type: e.target.value as CounterpartyType | "" })}
            data-testid="filter-type"
            className={`h-[28px] px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[12.5px] text-[var(--color-ink-900)] ${FILTER_CONTROL}`}
          >
            <option value="">All types</option>
            {COUNTERPARTY_TYPE.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Status">
          <select
            value={params.status}
            onChange={(e) => navigate({ status: e.target.value as CounterpartyStatus | "" })}
            data-testid="filter-status"
            className={`h-[28px] px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[12.5px] text-[var(--color-ink-900)] ${FILTER_CONTROL}`}
          >
            <option value="">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </select>
        </Field>
        <Field label="Search by name">
          <div className="relative">
            <SearchIcon className="absolute left-2 top-1/2 -translate-y-1/2 w-[12px] h-[12px] text-[var(--color-ink-500)]" />
            <input
              type="text"
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              placeholder="e.g. Lagos Freight"
              className="h-[28px] w-full sm:w-[260px] pl-6 pr-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[12.5px] text-[var(--color-ink-900)]"
            />
          </div>
        </Field>
        <button
          type="submit"
          className="h-[28px] px-3 rounded-[3px] bg-[var(--color-navy-700)] text-white text-[12.5px] font-medium"
        >
          Search
        </button>
        {(params.type || params.status || params.search) && (
          <button
            type="button"
            onClick={() => {
              setSearchDraft("");
              navigate({ type: "", status: "", search: "" });
            }}
            className="h-[28px] px-3 rounded-[3px] bg-white border border-[var(--color-border-default)] text-[var(--color-ink-700)] text-[12px] hover:border-[var(--color-navy-700)] hover:text-[var(--color-navy-700)]"
          >
            Clear
          </button>
        )}
      </form>

      {!rows ? (
        <div className="py-10 text-center text-[var(--color-ink-500)]">Loading counterparties...</div>
      ) : (
        <section className="bg-white border border-[var(--color-border-default)] rounded-[4px]">
          <header className="px-4 py-2.5 border-b border-[var(--color-border-default)] flex items-center justify-between">
            <h2 className="m-0 text-[13px] font-semibold text-[var(--color-ink-900)] flex items-center gap-2">
              Directory
              <span className="text-[11px] text-[var(--color-ink-500)] font-medium ml-1">
                {visible.length} of {rows.length}
              </span>
              <FreshnessBadge />
            </h2>
          </header>
          {visible.length === 0 ? (
            bootstrapping && rows.length === 0 ? (
              <div className="px-4 py-10 text-center text-[12.5px] text-[var(--color-ink-500)]">
                <div className="inline-flex items-center gap-2.5 mb-2">
                  <span className="inline-block w-[10px] h-[10px] rounded-full bg-[var(--color-navy-700)] animate-pulse" />
                  <span className="font-medium text-[var(--color-ink-700)]">
                    Syncing your data...
                  </span>
                </div>
                <div className="max-w-[480px] mx-auto">
                  The local mirror is downloading from the server. Counterparties will appear here as
                  soon as the initial sync finishes.
                </div>
              </div>
            ) : (
              <div className="px-4 py-8 text-center text-[12.5px] text-[var(--color-ink-500)]">
                No counterparties match the current filters.
              </div>
            )
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr>
                    <Th>Name</Th>
                    <Th>Type</Th>
                    <Th>Status</Th>
                    <Th className={COL.sm}>Contact</Th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r, i) => (
                    <tr
                      key={r.id}
                      className={`${i % 2 ? "bg-[#FBFBFC]" : "bg-white"} border-b border-[var(--color-border-default)] hover:bg-[var(--color-navy-50)]`}
                    >
                      <Td>
                        <Link
                          href={`/procurement/counterparties/${r.id}`}
                          title={r.name}
                          className="text-[var(--color-navy-700)] hover:underline font-medium block max-w-[180px] sm:max-w-none truncate"
                        >
                          {r.name}
                        </Link>
                      </Td>
                      <Td>
                        <TypePill type={r.type} />
                      </Td>
                      <Td>
                        <StatusPill status={r.status} />
                      </Td>
                      <Td className={COL.sm}>
                        {r.hasContact ? (
                          <span className="text-[11.5px] text-[var(--color-ink-700)]">on file</span>
                        ) : (
                          <span className="text-[11.5px] text-[var(--color-ink-400)]">--</span>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function TypePill({ type }: { type: CounterpartyType }) {
  return (
    <span
      title={TYPE_LABEL[type]}
      className="inline-flex items-center h-[18px] px-2 rounded-full text-[10.5px] font-semibold uppercase tracking-[0.02em] whitespace-nowrap bg-[var(--color-ink-100)] text-[var(--color-ink-700)]"
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
      className={`inline-flex items-center h-[18px] px-2 rounded-full text-[10.5px] font-semibold uppercase tracking-[0.02em] ${styled}`}
    >
      {status === "ACTIVE" ? "Active" : "Inactive"}
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 w-full sm:w-auto">
      <span className="text-[10.5px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] font-medium">
        {label}
      </span>
      {children}
    </label>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={`text-left font-medium text-[10.5px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] px-2 sm:px-3.5 py-2.5 border-b border-[var(--color-border-default)] bg-[var(--color-ink-100)] ${className}`}
    >
      {children}
    </th>
  );
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <td className={`px-2 sm:px-3.5 py-2 text-[12.5px] text-[var(--color-ink-900)] whitespace-nowrap ${className}`}>
      {children}
    </td>
  );
}
