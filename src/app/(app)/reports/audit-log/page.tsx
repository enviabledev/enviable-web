"use client";

/**
 * Audit-log report at /reports/audit-log. Gated 'audit.read', which is held
 * by Internal Auditor / Compliance and Executive Director (the narrow audit
 * audience by I-8 design). The backend's controller is @SkipCostStrip(): the
 * audit log returns the COMPLETE record (cost data in afterState included),
 * privacy comes from the gate narrowness, not from row sanitisation.
 *
 * Offline-handling shape: bounded-subset-with-horizon-disclosure. The mirror
 * has up to 90 days of audit entries (per the rolling pull window); offline,
 * the screen renders that subset with a HorizonDisclosure showing the actual
 * earliest cached date. The disclosure is danger-toned (red) rather than
 * warning-toned (amber, used by ComputedDisclosure) because the failure mode
 * is "answering an audit question with incomplete history," which is a
 * stronger limitation than "an aggregate may be stale."
 *
 * Online: the screen queries /api/reports/audit-log with the filter set and
 * paginates server-side. The mirror paint is replaced by the backend response
 * (which may include entries older than 90 days that the mirror doesn't have).
 *
 * Deep-linking: entityType + entityId resolves to a detail-page route for the
 * entity types that have one (PurchaseOrder, SalesOrder, Shipment, Counterparty,
 * AssemblyJob, ProformaInvoice, Customer, Unit, SparePart). Entity types without
 * a detail page (Invoice, Payment, ReleaseAuthorisation, DeliveryNote, Waybill,
 * PriceListEntry, Product, ConflictReviewItem, Return, LandedCost) render
 * entityType / entityId as plain text. The gaps are recorded in BACKLOG.md.
 *
 * NOT a recompute: no aggregation, no fidelity check needed. The "fidelity"
 * here is structural (raw rows pass through unchanged) rather than computational.
 */
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { AuditIcon } from "@/components/icons";
import HorizonDisclosure from "@/components/sync/HorizonDisclosure";
import { getAuditLog, type AuditLogEntry, type AuditLogResponse } from "@/lib/api";
import { isTransientFailure } from "@/lib/api/client";
import { usePermissions } from "@/lib/auth";
import { listAuditLogFromMirror } from "@/lib/sync/mirror/recompute/audit-log";
import { listByType } from "@/lib/sync/mirror/store";

const PAGE_SIZES = [25, 50, 100, 250];

// Entity-type -> detail-page route. Only entity types with a built detail
// page appear here; the rest render as plain text. See file header.
const ENTITY_ROUTE: Record<string, (id: string) => string> = {
  PurchaseOrder: (id) => `/procurement/purchase-orders/${encodeURIComponent(id)}`,
  SalesOrder: (id) => `/sales/sales-orders/${encodeURIComponent(id)}`,
  Shipment: (id) => `/procurement/shipments/${encodeURIComponent(id)}`,
  Counterparty: (id) => `/procurement/counterparties/${encodeURIComponent(id)}`,
  AssemblyJob: (id) => `/inventory/assembly-jobs/${encodeURIComponent(id)}`,
  ProformaInvoice: (id) => `/procurement/proforma-invoices/${encodeURIComponent(id)}`,
  Customer: (id) => `/sales/customers/${encodeURIComponent(id)}`,
  Unit: (id) => `/inventory/units/${encodeURIComponent(id)}`,
  SparePart: (id) => `/inventory/spare-parts/${encodeURIComponent(id)}`,
};

type MirroredUser = { id: string; fullName: string };

type Params = {
  actorUserId: string;
  action: string;
  entityType: string;
  entityId: string;
  occurredFrom: string;
  occurredTo: string;
  page: number;
  pageSize: number;
};

function readParams(sp: URLSearchParams): Params {
  return {
    actorUserId: sp.get("actorUserId") ?? "",
    action: sp.get("action") ?? "",
    entityType: sp.get("entityType") ?? "",
    entityId: sp.get("entityId") ?? "",
    occurredFrom: sp.get("occurredFrom") ?? "",
    occurredTo: sp.get("occurredTo") ?? "",
    page: Math.max(1, Number(sp.get("page") ?? "1") || 1),
    pageSize: PAGE_SIZES.includes(Number(sp.get("pageSize")))
      ? Number(sp.get("pageSize"))
      : 50,
  };
}

function buildHref(p: Partial<Params>): string {
  const sp = new URLSearchParams();
  if (p.actorUserId) sp.set("actorUserId", p.actorUserId);
  if (p.action) sp.set("action", p.action);
  if (p.entityType) sp.set("entityType", p.entityType);
  if (p.entityId) sp.set("entityId", p.entityId);
  if (p.occurredFrom) sp.set("occurredFrom", p.occurredFrom);
  if (p.occurredTo) sp.set("occurredTo", p.occurredTo);
  if (p.page && p.page > 1) sp.set("page", String(p.page));
  if (p.pageSize && p.pageSize !== 50) sp.set("pageSize", String(p.pageSize));
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

function isoDateInputToIso(dateStr: string, endOfDay = false): string {
  if (!dateStr) return "";
  if (!endOfDay) return new Date(`${dateStr}T00:00:00.000Z`).toISOString();
  return new Date(`${dateStr}T23:59:59.999Z`).toISOString();
}

function isoToDateInput(iso: string): string {
  return iso ? iso.slice(0, 10) : "";
}

export default function AuditLogPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const { has } = usePermissions();
  const canRead = has("audit.read");

  const params = useMemo(() => readParams(new URLSearchParams(sp.toString())), [sp]);

  const [response, setResponse] = useState<AuditLogResponse | null>(null);
  const [earliestInMirror, setEarliestInMirror] = useState<string | null>(null);
  const [fromMirror, setFromMirror] = useState(false);
  const [errMsg, setErrMsg] = useState("");
  const [actors, setActors] = useState<MirroredUser[]>([]);
  const [entityTypes, setEntityTypes] = useState<string[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const navigate = useCallback(
    (next: Partial<Params>) => {
      router.replace(`/reports/audit-log${buildHref({ ...params, ...next })}`);
    },
    [params, router],
  );

  // Populate actor and entity-type filter dropdowns from the mirror so they
  // work offline. Distinct entityTypes are derived from the audit entries
  // themselves (the set the backend has actually written).
  useEffect(() => {
    if (!canRead) return;
    let cancelled = false;
    Promise.all([
      listByType<MirroredUser>("user"),
      listByType<{ entityType: string }>("auditLogEntry"),
    ])
      .then(([us, es]) => {
        if (cancelled) return;
        setActors(us.map((u) => u.body).sort((a, b) => a.fullName.localeCompare(b.fullName)));
        const types = Array.from(new Set(es.map((e) => e.body.entityType)))
          .filter(Boolean)
          .sort((a, b) => a.localeCompare(b));
        setEntityTypes(types);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [canRead]);

  useEffect(() => {
    if (!canRead) return;
    const ctrl = new AbortController();
    setErrMsg("");

    const opts = {
      actorUserId: params.actorUserId || undefined,
      action: params.action || undefined,
      entityType: params.entityType || undefined,
      entityId: params.entityId || undefined,
      occurredFrom: params.occurredFrom || undefined,
      occurredTo: params.occurredTo || undefined,
      page: params.page,
      pageSize: params.pageSize,
    };

    // Phase 1: paint from the mirror (bounded subset).
    let mirrorPainted = false;
    (async () => {
      try {
        const r = await listAuditLogFromMirror(opts);
        if (ctrl.signal.aborted) return;
        mirrorPainted = true;
        setResponse({ data: r.data, page: r.page, pageSize: r.pageSize, total: r.total });
        setEarliestInMirror(r.earliestOccurredAt);
        setFromMirror(true);
      } catch {
        // network drives
      }
    })();

    // Phase 2: revalidate from the backend (the comprehensive trail).
    getAuditLog(opts, ctrl.signal).then((r) => {
      if (ctrl.signal.aborted) return;
      if (r.kind === "ok") {
        setResponse(r.data);
        setFromMirror(false);
        setErrMsg("");
      } else if (r.kind === "unauthorized") {
        router.replace("/login");
      } else if (r.kind === "forbidden") {
        setErrMsg("You do not have access to the audit log (requires audit.read).");
      } else if (isTransientFailure(r)) {
        if (!mirrorPainted) setErrMsg("");
      } else if ("message" in r) {
        setErrMsg(typeof r.message === "string" ? r.message : r.message.join("; "));
      }
    });

    return () => ctrl.abort();
  }, [
    canRead,
    params.actorUserId,
    params.action,
    params.entityType,
    params.entityId,
    params.occurredFrom,
    params.occurredTo,
    params.page,
    params.pageSize,
    router,
  ]);

  if (!canRead) {
    return (
      <div className="max-w-[640px] mx-auto py-12">
        <div className="bg-white border border-[var(--color-border-default)] rounded-[4px] px-6 py-8 text-center">
          <h1 className="text-[18px] font-semibold text-[var(--color-ink-900)] m-0 mb-2">
            Access denied
          </h1>
          <p className="text-[13px] text-[var(--color-ink-700)] m-0">
            You do not have access to the audit log. This screen requires the
            <span className="font-mono mx-1">audit.read</span> permission, which is held by
            roles that need oversight of system activity (Internal Auditor / Compliance,
            Executive Director).
          </p>
        </div>
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

  const rows = response?.data ?? [];
  const total = response?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / params.pageSize));

  return (
    <div className="max-w-[1480px] mx-auto pb-10">
      <header className="flex items-end justify-between gap-6 pb-4 mb-4 border-b border-[var(--color-border-default)]">
        <div>
          <div className="text-[12px] text-[var(--color-ink-500)] mb-1.5">Reports / Audit log</div>
          <h1 className="text-[22px] font-semibold text-[var(--color-ink-900)] m-0 tracking-[-0.01em] flex items-center gap-2">
            <AuditIcon className="w-[18px] h-[18px] text-[var(--color-ink-500)]" />
            Audit log
          </h1>
          <div className="text-[12.5px] text-[var(--color-ink-500)] mt-1 max-w-[860px]">
            Append-only record of every audited action (Invariant I-10). Filter by actor, action,
            entity type / id, or occurred-at range. Each entry carries the actor, the action, the
            entity affected, the request context, and a full before / after snapshot for diff.
          </div>
        </div>
      </header>

      <form
        onSubmit={(e) => e.preventDefault()}
        className="bg-white border border-[var(--color-border-default)] rounded-[4px] px-3 py-2.5 mb-3 flex items-end gap-3 flex-wrap"
      >
        <Field label="Actor">
          <select
            value={params.actorUserId}
            onChange={(e) => navigate({ actorUserId: e.target.value, page: 1 })}
            data-testid="filter-actor"
            className="h-[28px] px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[12.5px] text-[var(--color-ink-900)] min-w-[200px]"
          >
            <option value="">All actors</option>
            {actors.map((u) => (
              <option key={u.id} value={u.id}>
                {u.fullName}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Action">
          <input
            type="text"
            value={params.action}
            onChange={(e) => navigate({ action: e.target.value, page: 1 })}
            placeholder="e.g. payment.confirm"
            data-testid="filter-action"
            className="h-[28px] px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[12.5px] text-[var(--color-ink-900)] font-mono min-w-[180px]"
          />
        </Field>
        <Field label="Entity type">
          <select
            value={params.entityType}
            onChange={(e) => navigate({ entityType: e.target.value, page: 1 })}
            data-testid="filter-entityType"
            className="h-[28px] px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[12.5px] text-[var(--color-ink-900)] min-w-[160px]"
          >
            <option value="">All types</option>
            {entityTypes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Entity id">
          <input
            type="text"
            value={params.entityId}
            onChange={(e) => navigate({ entityId: e.target.value, page: 1 })}
            placeholder="exact match"
            data-testid="filter-entityId"
            className="h-[28px] px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[12.5px] text-[var(--color-ink-900)] font-mono min-w-[200px]"
          />
        </Field>
        <Field label="From">
          <input
            type="date"
            value={isoToDateInput(params.occurredFrom)}
            onChange={(e) => navigate({ occurredFrom: isoDateInputToIso(e.target.value, false), page: 1 })}
            data-testid="filter-occurredFrom"
            className="h-[28px] px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[12.5px] text-[var(--color-ink-900)]"
          />
        </Field>
        <Field label="To (inclusive)">
          <input
            type="date"
            value={isoToDateInput(params.occurredTo)}
            onChange={(e) => navigate({ occurredTo: isoDateInputToIso(e.target.value, true), page: 1 })}
            data-testid="filter-occurredTo"
            className="h-[28px] px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[12.5px] text-[var(--color-ink-900)]"
          />
        </Field>
        <Field label="Page size">
          <select
            value={params.pageSize}
            onChange={(e) => navigate({ pageSize: Number(e.target.value), page: 1 })}
            className="h-[28px] px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[12.5px] text-[var(--color-ink-900)]"
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </Field>
      </form>

      {fromMirror && (
        <HorizonDisclosure earliestOccurredAt={earliestInMirror} className="mb-4" />
      )}

      {!response ? (
        <div className="py-10 text-center text-[var(--color-ink-500)]">Loading audit log...</div>
      ) : (
        <section className="bg-white border border-[var(--color-border-default)] rounded-[4px]">
          <header className="px-4 py-2.5 border-b border-[var(--color-border-default)] flex items-center justify-between">
            <h2 className="m-0 text-[13px] font-semibold text-[var(--color-ink-900)]">
              Entries (newest first)
            </h2>
            <div
              data-testid="audit-summary"
              className="text-[11.5px] text-[var(--color-ink-500)] font-mono"
            >
              Page {params.page} of {lastPage} · {total} entr{total === 1 ? "y" : "ies"}
            </div>
          </header>
          {rows.length === 0 ? (
            <div className="px-4 py-8 text-center text-[12.5px] text-[var(--color-ink-500)]">
              No audit entries match the current filters.
            </div>
          ) : (
            <table className="w-full text-[13px]" data-testid="audit-table">
              <thead>
                <tr>
                  <Th>When</Th>
                  <Th>Actor</Th>
                  <Th>Action</Th>
                  <Th>Entity</Th>
                  <Th align="right">{""}</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <Row
                    key={r.id}
                    row={r}
                    odd={i % 2 === 1}
                    expanded={expandedId === r.id}
                    onToggle={() => setExpandedId(expandedId === r.id ? null : r.id)}
                  />
                ))}
              </tbody>
            </table>
          )}
          {lastPage > 1 && (
            <footer className="px-4 py-2.5 border-t border-[var(--color-border-default)] flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={params.page <= 1}
                onClick={() => navigate({ page: params.page - 1 })}
                className="h-[28px] px-3 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[12.5px] text-[var(--color-ink-900)] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={params.page >= lastPage}
                onClick={() => navigate({ page: params.page + 1 })}
                data-testid="page-next"
                className="h-[28px] px-3 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[12.5px] text-[var(--color-ink-900)] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </footer>
          )}
        </section>
      )}
    </div>
  );
}

function Row({
  row,
  odd,
  expanded,
  onToggle,
}: {
  row: AuditLogEntry;
  odd: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const dateStr = new Date(row.occurredAt).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const route = row.entityId ? ENTITY_ROUTE[row.entityType] : undefined;
  const href = route ? route(row.entityId!) : null;
  const bg = odd ? "bg-[#FBFBFC]" : "bg-white";
  return (
    <>
      <tr
        data-testid={`audit-row-${row.id}`}
        className={`${bg} border-b border-[var(--color-border-default)] last:border-b-0 cursor-pointer hover:bg-[var(--color-ink-100)]`}
        onClick={onToggle}
      >
        <Td mono>{dateStr}</Td>
        <Td>{row.actor?.fullName ?? <span className="text-[var(--color-ink-500)]">system</span>}</Td>
        <Td mono>
          <span className="text-[var(--color-navy-700)]">{row.action}</span>
        </Td>
        <Td>
          <span className="text-[var(--color-ink-500)] mr-1.5">{row.entityType}</span>
          {row.entityId ? (
            href ? (
              <Link
                href={href}
                onClick={(e) => e.stopPropagation()}
                data-testid={`audit-entity-link-${row.id}`}
                className="font-mono text-[12px] text-[var(--color-navy-700)] hover:underline"
              >
                {row.entityId}
              </Link>
            ) : (
              <span
                data-testid={`audit-entity-plain-${row.id}`}
                className="font-mono text-[12px] text-[var(--color-ink-700)]"
              >
                {row.entityId}
              </span>
            )
          ) : (
            <span className="text-[var(--color-ink-500)]">--</span>
          )}
        </Td>
        <Td align="right" mono>
          <span className="text-[11px] text-[var(--color-ink-500)]">{expanded ? "Hide" : "View"}</span>
        </Td>
      </tr>
      {expanded && (
        <tr className={`${bg} border-b border-[var(--color-border-default)]`}>
          <td colSpan={5} className="px-3.5 py-3">
            <DiffPanel row={row} />
          </td>
        </tr>
      )}
    </>
  );
}

function DiffPanel({ row }: { row: AuditLogEntry }) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <JsonBlock title="Context" value={row.context} />
      <JsonBlock title="Before" value={row.beforeState} />
      <JsonBlock title="After" value={row.afterState} />
    </div>
  );
}

function JsonBlock({ title, value }: { title: string; value: unknown }) {
  const isNull = value == null;
  return (
    <div className="border border-[var(--color-border-default)] rounded-[3px] overflow-hidden">
      <header className="px-2.5 py-1.5 bg-[var(--color-ink-100)] text-[10.5px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] font-medium">
        {title}
      </header>
      <pre className="m-0 px-2.5 py-2 text-[11px] font-mono text-[var(--color-ink-900)] whitespace-pre-wrap break-all max-h-[280px] overflow-auto">
        {isNull ? <span className="text-[var(--color-ink-500)]">--</span> : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10.5px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] font-medium">
        {label}
      </span>
      {children}
    </label>
  );
}

function Th({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      className={`text-${align} font-medium text-[10.5px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] px-3.5 py-2.5 border-b border-[var(--color-border-default)] bg-[var(--color-ink-100)]`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "left",
  mono = false,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  mono?: boolean;
}) {
  return (
    <td
      className={`px-3.5 py-2 text-[12.5px] text-[var(--color-ink-900)] whitespace-nowrap text-${align} ${
        mono ? "font-mono text-[12px] tracking-[0.02em]" : ""
      }`}
    >
      {children}
    </td>
  );
}
