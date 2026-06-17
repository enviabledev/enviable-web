"use client";

/**
 * Proforma invoices at /procurement/proforma-invoices. Gated 'pi.read'.
 *
 * Build shape per prompt 20's backend audit: outcome (B) mirror-buildable.
 * The backend has no cross-supplier list endpoint, only per-PO sub-resource
 * (GET /api/purchase-orders/:poId/proforma-invoices) and per-id detail.
 * Both proformaInvoice and proformaInvoiceLine are in the mirror; the
 * cross-supplier view assembles client-side by joining:
 *
 *   proformaInvoice.purchaseOrderId  ->  purchaseOrder.id
 *   purchaseOrder.supplierId         ->  counterparty.id
 *   proformaInvoice.id               <-  proformaInvoiceLine.proformaInvoiceId
 *
 * Mirror-only screen, so the sixth meta-discipline applies: re-read on
 * visibilitychange + focus + online + 15s tick while visible. The eighth
 * (relation-read audit) applied: every X.Y dotted access in the render is
 * either a flat field on the assembled Row type or guarded.
 *
 * Per-PI detail at /procurement/proforma-invoices/[id] carries the
 * approve/reject actions (gated pi.review) and shows line items + parent
 * PO context. The list itself does NOT carry actions, the dispatcher
 * lands on the row that needs review and clicks through.
 */
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ProformaIcon, SearchIcon } from "@/components/icons";
import PrintButton from "@/components/invoices/PrintButton";
import FreshnessBadge from "@/components/sync/FreshnessBadge";
import { usePermissions } from "@/lib/auth";
import { formatDateShort, formatNGN } from "@/lib/format";
import { proformaInvoiceDoc } from "@/lib/invoices/pdf";
import { COL, FILTER_CONTROL, FILTER_FORM } from "@/lib/responsive";
import { useMirrorFreshness } from "@/lib/sync/mirror/freshness";
import { listByType } from "@/lib/sync/mirror/store";
import {
  PROFORMA_INVOICE_STATUS,
  type ProformaInvoiceStatus,
} from "@/lib/api";

type MirroredPi = {
  id: string;
  piNumber: string;
  purchaseOrderId: string;
  revisionNumber: number;
  status: ProformaInvoiceStatus;
  totalValue: string;
  freightAmount: string;
  insuranceAmount: string;
  issueDate: string | null;
  validityUntil: string | null;
  approvedAt: string | null;
  updatedAt: string;
};

type MirroredPo = {
  id: string;
  poNumber: string;
  supplierId: string;
  currency: string;
};

type MirroredCounterparty = { id: string; name: string };

type Row = {
  id: string;
  piNumber: string;
  revisionNumber: number;
  status: ProformaInvoiceStatus;
  poId: string;
  poNumber: string;
  supplierName: string;
  totalValue: string;
  issueDate: string | null;
  validityUntil: string | null;
};

const STATUS_LABEL: Record<ProformaInvoiceStatus, string> = {
  PENDING_REVIEW: "Pending review",
  ACTIVE: "Active",
  SUPERSEDED: "Superseded",
  REJECTED: "Rejected",
};

// Fixed mobile shorthand (status-pill standard, RESPONSIVE.md): same input
// always yields the same short output; full label stays on title + sm+.
const SHORT_LABEL: Record<ProformaInvoiceStatus, string> = {
  PENDING_REVIEW: "Pending",
  ACTIVE: "Active",
  SUPERSEDED: "Superseded",
  REJECTED: "Rejected",
};

const STATUS_TONE: Record<ProformaInvoiceStatus, { bg: string; fg: string; dot: string }> = {
  PENDING_REVIEW: {
    bg: "bg-[var(--color-warning-50)]",
    fg: "text-[var(--color-warning-700)]",
    dot: "bg-[var(--color-warning-700)]",
  },
  ACTIVE: {
    bg: "bg-[var(--color-success-100)]",
    fg: "text-[var(--color-success-700)]",
    dot: "bg-[var(--color-success-700)]",
  },
  SUPERSEDED: {
    bg: "bg-[var(--color-ink-100)]",
    fg: "text-[var(--color-ink-700)]",
    dot: "bg-[var(--color-ink-500)]",
  },
  REJECTED: {
    bg: "bg-[var(--color-danger-50)]",
    fg: "text-[var(--color-danger-700)]",
    dot: "bg-[var(--color-danger-700)]",
  },
};

function readParams(sp: URLSearchParams) {
  const statusRaw = sp.get("status") ?? "";
  const status: ProformaInvoiceStatus | "" = (PROFORMA_INVOICE_STATUS as readonly string[]).includes(statusRaw)
    ? (statusRaw as ProformaInvoiceStatus)
    : "";
  const search = sp.get("search") ?? "";
  return { status, search };
}

function buildHref(p: Partial<ReturnType<typeof readParams>>): string {
  const sp = new URLSearchParams();
  if (p.status) sp.set("status", p.status);
  if (p.search) sp.set("search", p.search);
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

export default function ProformaInvoicesPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const { has } = usePermissions();
  const canRead = has("pi.read");

  const params = useMemo(() => readParams(new URLSearchParams(sp.toString())), [sp]);
  const [searchDraft, setSearchDraft] = useState(params.search);
  useEffect(() => setSearchDraft(params.search), [params.search]);

  const [rows, setRows] = useState<Row[] | null>(null);
  const watermark = useMirrorFreshness();
  const bootstrapping = watermark ? !watermark.historyComplete : true;

  const navigate = useCallback(
    (next: Partial<ReturnType<typeof readParams>>) => {
      router.replace(`/procurement/proforma-invoices${buildHref({ ...params, ...next })}`);
    },
    [params, router],
  );

  useEffect(() => {
    if (!canRead) return;
    let cancelled = false;
    const read = async () => {
      try {
        const [pis, pos, suppliers] = await Promise.all([
          listByType<MirroredPi>("proformaInvoice"),
          listByType<MirroredPo>("purchaseOrder"),
          listByType<MirroredCounterparty>("counterparty"),
        ]);
        if (cancelled) return;
        const poById = new Map(pos.map((p) => [p.body.id, p.body]));
        const supplierById = new Map(suppliers.map((c) => [c.body.id, c.body]));
        const built: Row[] = pis
          .map((p) => p.body)
          .map((p) => {
            const po = poById.get(p.purchaseOrderId);
            const sup = po ? supplierById.get(po.supplierId) : undefined;
            return {
              id: p.id,
              piNumber: p.piNumber,
              revisionNumber: p.revisionNumber,
              status: p.status,
              poId: p.purchaseOrderId,
              poNumber: po?.poNumber ?? p.purchaseOrderId,
              supplierName: sup?.name ?? "(unknown supplier)",
              totalValue: p.totalValue,
              issueDate: p.issueDate,
              validityUntil: p.validityUntil,
            };
          })
          // Newest first by issueDate; PIs without an issueDate trail.
          .sort((a, b) => {
            const aT = a.issueDate ?? "";
            const bT = b.issueDate ?? "";
            return aT < bT ? 1 : -1;
          });
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
        You do not have access to proforma invoices (requires pi.read).
      </div>
    );
  }

  const visible = (rows ?? []).filter((r) => {
    if (params.status && r.status !== params.status) return false;
    if (params.search) {
      const q = params.search.toUpperCase();
      if (
        !r.piNumber.toUpperCase().includes(q) &&
        !r.poNumber.toUpperCase().includes(q) &&
        !r.supplierName.toUpperCase().includes(q)
      ) {
        return false;
      }
    }
    return true;
  });

  return (
    <div className="max-w-[1620px] mx-auto pb-10">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 sm:gap-6 pb-4 mb-4 border-b border-[var(--color-border-default)]">
        <div>
          <div className="text-[12px] text-[var(--color-ink-500)] mb-1.5">Procurement / Proforma invoices</div>
          <h1 className="text-[22px] font-semibold text-[var(--color-ink-900)] m-0 tracking-[-0.01em] flex items-center gap-2">
            <ProformaIcon className="w-[18px] h-[18px] text-[var(--color-ink-500)]" />
            Proforma invoices
          </h1>
          <div className="text-[12.5px] text-[var(--color-ink-500)] mt-1 max-w-[920px]">
            Cross-supplier view of supplier-quoted proforma invoices. Each PI is bound to one purchase
            order; the I-5 invariant forbids two ACTIVE PIs per PO, so approving a new PI atomically
            supersedes the prior active one. Click any row to review line items and approve or reject.
          </div>
        </div>
      </header>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          navigate({ search: searchDraft });
        }}
        className={`bg-white border border-[var(--color-border-default)] rounded-[4px] px-3 py-2.5 mb-3 ${FILTER_FORM}`}
      >
        <Field label="Status">
          <select
            value={params.status}
            onChange={(e) => navigate({ status: e.target.value as ProformaInvoiceStatus | "" })}
            data-testid="filter-status"
            className={`h-[28px] px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[12.5px] text-[var(--color-ink-900)] ${FILTER_CONTROL}`}
          >
            <option value="">All statuses</option>
            {PROFORMA_INVOICE_STATUS.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Search PI# / PO# / supplier">
          <div className="relative w-full sm:w-auto">
            <SearchIcon className="absolute left-2 top-1/2 -translate-y-1/2 w-[12px] h-[12px] text-[var(--color-ink-500)]" />
            <input
              type="text"
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              placeholder="e.g. PI-FIXT or PO-FIXTURE"
              className="h-[28px] w-full sm:w-[280px] pl-6 pr-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[12.5px] text-[var(--color-ink-900)]"
            />
          </div>
        </Field>
        <button
          type="submit"
          className={`h-[28px] px-3 rounded-[3px] bg-[var(--color-navy-700)] text-white text-[12.5px] font-medium ${FILTER_CONTROL}`}
        >
          Search
        </button>
        {(params.status || params.search) && (
          <button
            type="button"
            onClick={() => {
              setSearchDraft("");
              navigate({ status: "", search: "" });
            }}
            className={`h-[28px] px-3 rounded-[3px] bg-white border border-[var(--color-border-default)] text-[var(--color-ink-700)] text-[12px] hover:border-[var(--color-navy-700)] hover:text-[var(--color-navy-700)] ${FILTER_CONTROL}`}
          >
            Clear
          </button>
        )}
      </form>

      {!rows ? (
        <div className="py-10 text-center text-[var(--color-ink-500)]">Loading proforma invoices...</div>
      ) : (
        <section className="bg-white border border-[var(--color-border-default)] rounded-[4px]">
          <header className="px-4 py-2.5 border-b border-[var(--color-border-default)] flex items-center justify-between">
            <h2 className="m-0 text-[13px] font-semibold text-[var(--color-ink-900)] flex items-center gap-2">
              Proforma invoices
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
                  The local mirror is downloading from the server. Proforma invoices will appear here as
                  soon as the initial sync finishes; this usually takes a few seconds and only happens on
                  the first load.
                </div>
              </div>
            ) : (
              <div className="px-4 py-8 text-center text-[12.5px] text-[var(--color-ink-500)]">
                No proforma invoices match the current filters.
              </div>
            )
          ) : (
            <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr>
                  <Th>PI Number</Th>
                  <Th className={COL.lg}>Rev</Th>
                  <Th className={COL.sm}>Supplier</Th>
                  <Th className={COL.md}>Purchase Order</Th>
                  <Th>Status</Th>
                  <Th className={COL.md}>Issued</Th>
                  <Th className={COL.md}>Valid until</Th>
                  <Th align="right">Total (CIF)</Th>
                  <Th align="right" className={COL.lg}>Document</Th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r, i) => (
                  <tr
                    key={r.id}
                    className={`${i % 2 ? "bg-[#FBFBFC]" : "bg-white"} border-b border-[var(--color-border-default)] hover:bg-[var(--color-navy-50)]`}
                  >
                    <Td mono>
                      <Link
                        href={`/procurement/proforma-invoices/${r.id}`}
                        title={r.piNumber}
                        className="block max-w-[104px] sm:max-w-none truncate text-[var(--color-navy-700)] hover:underline font-medium"
                      >
                        {r.piNumber}
                      </Link>
                    </Td>
                    <Td mono className={COL.lg}>r{r.revisionNumber}</Td>
                    <Td className={COL.sm}>{r.supplierName}</Td>
                    <Td mono className={COL.md}>
                      <Link
                        href={`/procurement/purchase-orders/${r.poId}`}
                        className="text-[var(--color-navy-700)] hover:underline"
                      >
                        {r.poNumber}
                      </Link>
                    </Td>
                    <Td>
                      <StatusPill status={r.status} />
                    </Td>
                    <Td className={COL.md}>
                      {r.issueDate ? formatDateShort(r.issueDate) : (
                        <span className="text-[var(--color-ink-400)]">--</span>
                      )}
                    </Td>
                    <Td className={COL.md}>
                      {r.validityUntil ? formatDateShort(r.validityUntil) : (
                        <span className="text-[var(--color-ink-400)]">--</span>
                      )}
                    </Td>
                    <Td align="right" mono>
                      <span className="text-[var(--color-ink-900)] font-semibold">
                        {formatNGN(r.totalValue)}
                      </span>
                    </Td>
                    <Td align="right" className={COL.lg}>
                      <span className="inline-flex items-center gap-1.5">
                        <Link
                          href={`/procurement/proforma-invoices/${r.id}/document`}
                          className="h-[24px] px-2 inline-flex items-center rounded-[3px] border border-[var(--color-border-default)] text-[11.5px] font-medium text-[var(--color-navy-700)] hover:border-[var(--color-navy-700)]"
                        >
                          View
                        </Link>
                        <PrintButton
                          pdfPath={proformaInvoiceDoc(r.id).pdf}
                          fallbackFilename={`${r.piNumber}-rev${r.revisionNumber}.pdf`}
                          variant="row"
                        />
                      </span>
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

function StatusPill({ status }: { status: ProformaInvoiceStatus }) {
  const tone = STATUS_TONE[status];
  return (
    <span
      title={STATUS_LABEL[status]}
      className={`inline-flex items-center gap-1 h-[18px] px-2 rounded-full text-[10.5px] font-semibold uppercase tracking-[0.02em] whitespace-nowrap ${tone.bg} ${tone.fg}`}
    >
      <span className={`w-[5px] h-[5px] rounded-full flex-shrink-0 ${tone.dot}`} aria-hidden />
      <span className="sm:hidden">{SHORT_LABEL[status]}</span>
      <span className="hidden sm:inline">{STATUS_LABEL[status]}</span>
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

function Th({
  children,
  align = "left",
  className = "",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <th
      className={`text-${align} font-medium text-[10.5px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] px-2 sm:px-3.5 py-2.5 border-b border-[var(--color-border-default)] bg-[var(--color-ink-100)] ${className}`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "left",
  mono = false,
  className = "",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  mono?: boolean;
  className?: string;
}) {
  return (
    <td
      className={`px-2 sm:px-3.5 py-2 text-[12.5px] text-[var(--color-ink-900)] whitespace-nowrap text-${align} ${
        mono ? "font-mono text-[12px] tracking-[0.02em]" : ""
      } ${className}`}
    >
      {children}
    </td>
  );
}
