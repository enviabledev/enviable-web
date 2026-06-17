"use client";

/**
 * Invoices & Payments at /sales/invoices-payments. Gated 'salesorder.read'.
 *
 * Build shape: outcome (B) per prompt 19's backend audit. The backend has
 * NO cross-SO aggregation endpoints for invoices or payments, but both
 * buckets are in the mirror (synced via updatedAt spine). The screen
 * assembles the finance-centric view client-side by joining the mirror's
 * invoices / payments / salesOrders / customers buckets.
 *
 * UX shape: TABS. Invoices are immutable documents (one per SO); payments
 * are state-machine transactions (PENDING / CONFIRMED / REJECTED, many per
 * SO). Different filters (no status on invoices; status leading on
 * payments), different columns, different next-step affordances. Unifying
 * them under one table would conflate two distinct operational questions
 * ("which invoices are outstanding" vs "which payments are pending
 * confirmation"); tabs let each view's filters and columns be optimized
 * for its question.
 *
 * Mirror-only screen, so the sixth meta-discipline applies: re-read on
 * visibilitychange + focus + online + a 15s tick while visible. Without
 * this, the page snapshots the mirror at mount and never reflects a
 * later reconcile (the bug deliveries exposed).
 *
 * No new dynamic detail route: rows link to the existing
 * /sales/sales-orders/[id] which already carries the prompt-7 invoice +
 * payment workflow. No workflow code forked here.
 */
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { PaymentsIcon, SearchIcon } from "@/components/icons";
import PrintButton from "@/components/invoices/PrintButton";
import FreshnessBadge from "@/components/sync/FreshnessBadge";
import { usePermissions } from "@/lib/auth";
import { formatDateShort, formatDateTime, formatNGN } from "@/lib/format";
import { salesInvoiceDoc } from "@/lib/invoices/pdf";
import { useMirrorFreshness } from "@/lib/sync/mirror/freshness";
import { listByType } from "@/lib/sync/mirror/store";

type Tab = "invoices" | "payments";

type PaymentStatus = "PENDING" | "CONFIRMED" | "REJECTED";

type MirroredInvoice = {
  id: string;
  salesOrderId: string;
  invoiceNumber: string;
  issueDate: string;
  vatRate: string;
  vatAmount: string;
  total: string;
  pdfDocumentId: string | null;
  createdAt: string;
  updatedAt: string;
};

type MirroredPayment = {
  id: string;
  salesOrderId: string;
  paymentMethodId: string;
  amount: string;
  receivedAt: string;
  referenceNumber: string | null;
  confirmationSource: string;
  confirmedById: string | null;
  receiptDocumentId: string | null;
  status: PaymentStatus;
  clientId: string | null;
  createdAt: string;
  updatedAt: string;
};

type MirroredSalesOrder = {
  id: string;
  soNumber: string;
  customerId: string;
  status: string;
};

type MirroredCustomer = { id: string; name: string };
type MirroredPaymentMethod = { id: string; name: string };
type MirroredUser = { id: string; fullName: string };

type InvoiceRow = {
  id: string;
  invoiceNumber: string;
  salesOrderId: string;
  soNumber: string;
  customerName: string;
  issueDate: string;
  vatAmount: string;
  total: string;
};

type PaymentRow = {
  id: string;
  salesOrderId: string;
  soNumber: string;
  customerName: string;
  amount: string;
  status: PaymentStatus;
  receivedAt: string;
  paymentMethodName: string;
  referenceNumber: string | null;
  confirmedByName: string | null;
};

function readParams(sp: URLSearchParams) {
  const tabRaw = sp.get("tab");
  const tab: Tab = tabRaw === "payments" ? "payments" : "invoices";
  const statusRaw = sp.get("status") ?? "";
  const status: PaymentStatus | "" =
    statusRaw === "PENDING" || statusRaw === "CONFIRMED" || statusRaw === "REJECTED"
      ? statusRaw
      : "";
  const search = sp.get("search") ?? "";
  const from = sp.get("from") ?? "";
  const to = sp.get("to") ?? "";
  return { tab, status, search, from, to };
}

function buildHref(p: Partial<ReturnType<typeof readParams>>): string {
  const sp = new URLSearchParams();
  if (p.tab && p.tab !== "invoices") sp.set("tab", p.tab);
  if (p.status) sp.set("status", p.status);
  if (p.search) sp.set("search", p.search);
  if (p.from) sp.set("from", p.from);
  if (p.to) sp.set("to", p.to);
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

export default function InvoicesPaymentsPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const { has } = usePermissions();
  const canSee = has("salesorder.read");

  const params = useMemo(() => readParams(new URLSearchParams(sp.toString())), [sp]);
  const [searchDraft, setSearchDraft] = useState(params.search);
  useEffect(() => setSearchDraft(params.search), [params.search]);

  const [invoices, setInvoices] = useState<InvoiceRow[] | null>(null);
  const [payments, setPayments] = useState<PaymentRow[] | null>(null);
  const watermark = useMirrorFreshness();
  const bootstrapping = watermark ? !watermark.historyComplete : true;

  const navigate = useCallback(
    (next: Partial<ReturnType<typeof readParams>>) => {
      router.replace(`/sales/invoices-payments${buildHref({ ...params, ...next })}`);
    },
    [params, router],
  );

  // Mirror-only freshness signal per the sixth meta-discipline. The screen
  // reads the mirror exclusively (no /api/invoices or /api/payments
  // aggregation endpoint exists), so without this it would snapshot at
  // mount and never reflect a later reconcile.
  useEffect(() => {
    if (!canSee) return;
    let cancelled = false;
    const read = async () => {
      try {
        const [invs, pmts, sos, cust, methods, users] = await Promise.all([
          listByType<MirroredInvoice>("invoice"),
          listByType<MirroredPayment>("payment"),
          listByType<MirroredSalesOrder>("salesOrder"),
          listByType<MirroredCustomer>("customer"),
          listByType<MirroredPaymentMethod>("paymentMethod"),
          listByType<MirroredUser>("user"),
        ]);
        if (cancelled) return;
        const soById = new Map(sos.map((s) => [s.body.id, s.body]));
        const custById = new Map(cust.map((c) => [c.body.id, c.body]));
        const methodById = new Map(methods.map((m) => [m.body.id, m.body]));
        const userById = new Map(users.map((u) => [u.body.id, u.body]));

        const invoiceRows: InvoiceRow[] = invs
          .map((i) => i.body)
          .map((i) => {
            const so = soById.get(i.salesOrderId);
            const cu = so ? custById.get(so.customerId) : undefined;
            return {
              id: i.id,
              invoiceNumber: i.invoiceNumber,
              salesOrderId: i.salesOrderId,
              soNumber: so?.soNumber ?? i.salesOrderId,
              customerName: cu?.name ?? "(unknown)",
              issueDate: i.issueDate,
              vatAmount: i.vatAmount,
              total: i.total,
            };
          })
          .sort((a, b) => (a.issueDate < b.issueDate ? 1 : -1));

        const paymentRows: PaymentRow[] = pmts
          .map((p) => p.body)
          .map((p) => {
            const so = soById.get(p.salesOrderId);
            const cu = so ? custById.get(so.customerId) : undefined;
            const m = methodById.get(p.paymentMethodId);
            const confirmer = p.confirmedById ? userById.get(p.confirmedById) : undefined;
            return {
              id: p.id,
              salesOrderId: p.salesOrderId,
              soNumber: so?.soNumber ?? p.salesOrderId,
              customerName: cu?.name ?? "(unknown)",
              amount: p.amount,
              status: p.status,
              receivedAt: p.receivedAt,
              paymentMethodName: m?.name ?? p.paymentMethodId,
              referenceNumber: p.referenceNumber,
              confirmedByName: confirmer?.fullName ?? null,
            };
          })
          .sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1));

        if (cancelled) return;
        setInvoices(invoiceRows);
        setPayments(paymentRows);
      } catch {
        if (!cancelled) {
          setInvoices([]);
          setPayments([]);
        }
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
  }, [canSee]);

  if (!canSee) {
    return (
      <div className="max-w-[1080px] mx-auto py-10 text-center text-[var(--color-ink-500)]">
        You do not have access to invoices &amp; payments (requires salesorder.read).
      </div>
    );
  }

  return (
    <div className="max-w-[1620px] mx-auto pb-10">
      <header className="flex items-end justify-between gap-6 pb-4 mb-4 border-b border-[var(--color-border-default)]">
        <div>
          <div className="text-[12px] text-[var(--color-ink-500)] mb-1.5">Sales / Invoices &amp; Payments</div>
          <h1 className="text-[22px] font-semibold text-[var(--color-ink-900)] m-0 tracking-[-0.01em] flex items-center gap-2">
            <PaymentsIcon className="w-[18px] h-[18px] text-[var(--color-ink-500)]" />
            Invoices &amp; Payments
          </h1>
          <div className="text-[12.5px] text-[var(--color-ink-500)] mt-1 max-w-[920px]">
            Finance-centric cross-order view. Invoices and payments live on each sales order; this screen
            assembles them across orders so the finance team can scan outstanding invoices and
            pending-confirmation payments at a glance. Per-order actions (generate invoice, record payment,
            confirm payment) live on the order detail; click any row to open it.
          </div>
        </div>
        <nav className="flex gap-1 self-start" role="tablist">
          <TabButton active={params.tab === "invoices"} onClick={() => navigate({ tab: "invoices" })}>
            Invoices
          </TabButton>
          <TabButton active={params.tab === "payments"} onClick={() => navigate({ tab: "payments" })}>
            Payments
          </TabButton>
        </nav>
      </header>

      <FiltersBar
        params={params}
        searchDraft={searchDraft}
        setSearchDraft={setSearchDraft}
        navigate={navigate}
      />

      {params.tab === "invoices" ? (
        <InvoicesPanel rows={invoices} params={params} bootstrapping={bootstrapping} />
      ) : (
        <PaymentsPanel rows={payments} params={params} bootstrapping={bootstrapping} />
      )}
    </div>
  );
}

/**
 * Empty-state copy for mirror-only screens. The distinction matters:
 *   - History still loading: "we are still downloading; come back in a moment"
 *   - History complete + filtered to zero: "nothing matches your filters"
 *   - History complete + no rows AT ALL: "nothing here yet"
 *
 * Without it, a first-time user sees "No invoices match the current filters."
 * while the mirror is still bootstrapping, which reads as a broken page.
 */
function EmptyState({
  bootstrapping,
  filtered,
  totalInMirror,
  noun,
}: {
  bootstrapping: boolean;
  filtered: number;
  totalInMirror: number;
  noun: string;
}) {
  if (bootstrapping && totalInMirror === 0) {
    return (
      <div className="px-4 py-10 text-center text-[12.5px] text-[var(--color-ink-500)]">
        <div className="inline-flex items-center gap-2.5 mb-2">
          <span className="inline-block w-[10px] h-[10px] rounded-full bg-[var(--color-navy-700)] animate-pulse" />
          <span className="font-medium text-[var(--color-ink-700)]">
            Syncing your data...
          </span>
        </div>
        <div className="max-w-[480px] mx-auto">
          The local mirror is downloading from the server. {noun} will appear here as soon as the
          initial sync finishes; this usually takes a few seconds and only happens on the first
          load.
        </div>
      </div>
    );
  }
  if (filtered === 0 && totalInMirror > 0) {
    return (
      <div className="px-4 py-8 text-center text-[12.5px] text-[var(--color-ink-500)]">
        No {noun} match the current filters.
      </div>
    );
  }
  return (
    <div className="px-4 py-8 text-center text-[12.5px] text-[var(--color-ink-500)]">
      No {noun} yet.
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`h-[28px] px-3 rounded-[3px] text-[12.5px] font-medium ${
        active
          ? "bg-[var(--color-navy-700)] text-white"
          : "bg-white border border-[var(--color-border-default)] text-[var(--color-ink-700)] hover:border-[var(--color-navy-700)] hover:text-[var(--color-navy-700)]"
      }`}
    >
      {children}
    </button>
  );
}

function FiltersBar({
  params,
  searchDraft,
  setSearchDraft,
  navigate,
}: {
  params: ReturnType<typeof readParams>;
  searchDraft: string;
  setSearchDraft: (v: string) => void;
  navigate: (n: Partial<ReturnType<typeof readParams>>) => void;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        navigate({ search: searchDraft });
      }}
      className="bg-white border border-[var(--color-border-default)] rounded-[4px] px-3 py-2.5 mb-3 flex items-end gap-3 flex-wrap"
    >
      {params.tab === "payments" && (
        <Field label="Status">
          <select
            value={params.status}
            onChange={(e) => navigate({ status: (e.target.value as PaymentStatus | "") || "" })}
            data-testid="filter-status"
            className="h-[28px] px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[12.5px] text-[var(--color-ink-900)]"
          >
            <option value="">All statuses</option>
            <option value="PENDING">Pending</option>
            <option value="CONFIRMED">Confirmed</option>
            <option value="REJECTED">Rejected</option>
          </select>
        </Field>
      )}
      <Field label="From">
        <input
          type="date"
          value={params.from}
          onChange={(e) => navigate({ from: e.target.value })}
          className="h-[28px] px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[12.5px] text-[var(--color-ink-900)]"
        />
      </Field>
      <Field label="To">
        <input
          type="date"
          value={params.to}
          onChange={(e) => navigate({ to: e.target.value })}
          className="h-[28px] px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[12.5px] text-[var(--color-ink-900)]"
        />
      </Field>
      <Field label="Search SO# or customer">
        <div className="relative">
          <SearchIcon className="absolute left-2 top-1/2 -translate-y-1/2 w-[12px] h-[12px] text-[var(--color-ink-500)]" />
          <input
            type="text"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            placeholder="e.g. SO-FIXT-DELIV"
            className="h-[28px] w-[260px] pl-6 pr-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[12.5px] text-[var(--color-ink-900)]"
          />
        </div>
      </Field>
      <button
        type="submit"
        className="h-[28px] px-3 rounded-[3px] bg-[var(--color-navy-700)] text-white text-[12.5px] font-medium"
      >
        Search
      </button>
      {(params.status || params.search || params.from || params.to) && (
        <button
          type="button"
          onClick={() => {
            setSearchDraft("");
            navigate({ status: "", search: "", from: "", to: "" });
          }}
          className="h-[28px] px-3 rounded-[3px] bg-white border border-[var(--color-border-default)] text-[var(--color-ink-700)] text-[12px] hover:border-[var(--color-navy-700)] hover:text-[var(--color-navy-700)]"
        >
          Clear
        </button>
      )}
    </form>
  );
}

function InvoicesPanel({
  rows,
  params,
  bootstrapping,
}: {
  rows: InvoiceRow[] | null;
  params: ReturnType<typeof readParams>;
  bootstrapping: boolean;
}) {
  if (!rows) {
    return <div className="py-10 text-center text-[var(--color-ink-500)]">Loading invoices...</div>;
  }
  const filtered = rows.filter((r) => {
    if (params.from && r.issueDate < params.from) return false;
    if (params.to && r.issueDate > params.to + "T23:59:59.999Z") return false;
    if (params.search) {
      const q = params.search.toUpperCase();
      if (
        !r.invoiceNumber.toUpperCase().includes(q) &&
        !r.soNumber.toUpperCase().includes(q) &&
        !r.customerName.toUpperCase().includes(q)
      ) {
        return false;
      }
    }
    return true;
  });
  return (
    <section className="bg-white border border-[var(--color-border-default)] rounded-[4px]">
      <header className="px-4 py-2.5 border-b border-[var(--color-border-default)] flex items-center justify-between">
        <h2 className="m-0 text-[13px] font-semibold text-[var(--color-ink-900)] flex items-center gap-2">
          Invoices
          <span className="text-[11px] text-[var(--color-ink-500)] font-medium ml-1">
            {filtered.length} of {rows.length}
          </span>
          <FreshnessBadge />
        </h2>
      </header>
      {filtered.length === 0 ? (
        <EmptyState
          bootstrapping={bootstrapping}
          filtered={filtered.length}
          totalInMirror={rows.length}
          noun="invoices"
        />
      ) : (
        <table className="w-full text-[13px]">
          <thead>
            <tr>
              <Th>Invoice #</Th>
              <Th>SO Number</Th>
              <Th>Customer</Th>
              <Th>Issued</Th>
              <Th align="right">VAT</Th>
              <Th align="right">Total</Th>
              <Th align="right">Document</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => (
              <tr
                key={r.id}
                className={`${i % 2 ? "bg-[#FBFBFC]" : "bg-white"} border-b border-[var(--color-border-default)] hover:bg-[var(--color-navy-50)]`}
              >
                <Td mono>
                  <Link
                    href={`/sales/sales-orders/${r.salesOrderId}`}
                    className="text-[var(--color-navy-700)] hover:underline font-medium"
                  >
                    {r.invoiceNumber}
                  </Link>
                </Td>
                <Td mono>{r.soNumber}</Td>
                <Td>{r.customerName}</Td>
                <Td>{formatDateShort(r.issueDate)}</Td>
                <Td align="right" mono>
                  {Number(r.vatAmount) > 0 ? formatNGN(r.vatAmount) : (
                    <span className="text-[var(--color-ink-400)]">--</span>
                  )}
                </Td>
                <Td align="right" mono>
                  <span className="text-[var(--color-ink-900)] font-semibold">{formatNGN(r.total)}</span>
                </Td>
                <Td align="right">
                  <span className="inline-flex items-center gap-1.5">
                    <Link
                      href={`/sales/invoices/${r.id}`}
                      className="h-[24px] px-2 inline-flex items-center rounded-[3px] border border-[var(--color-border-default)] text-[11.5px] font-medium text-[var(--color-navy-700)] hover:border-[var(--color-navy-700)]"
                    >
                      View
                    </Link>
                    <PrintButton
                      pdfPath={salesInvoiceDoc(r.id).pdf}
                      fallbackFilename={`${r.invoiceNumber}.pdf`}
                      variant="row"
                    />
                  </span>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function PaymentsPanel({
  rows,
  params,
  bootstrapping,
}: {
  rows: PaymentRow[] | null;
  params: ReturnType<typeof readParams>;
  bootstrapping: boolean;
}) {
  if (!rows) {
    return <div className="py-10 text-center text-[var(--color-ink-500)]">Loading payments...</div>;
  }
  const filtered = rows.filter((r) => {
    if (params.status && r.status !== params.status) return false;
    if (params.from && r.receivedAt < params.from) return false;
    if (params.to && r.receivedAt > params.to + "T23:59:59.999Z") return false;
    if (params.search) {
      const q = params.search.toUpperCase();
      if (
        !r.soNumber.toUpperCase().includes(q) &&
        !r.customerName.toUpperCase().includes(q) &&
        !(r.referenceNumber ?? "").toUpperCase().includes(q)
      ) {
        return false;
      }
    }
    return true;
  });
  return (
    <section className="bg-white border border-[var(--color-border-default)] rounded-[4px]">
      <header className="px-4 py-2.5 border-b border-[var(--color-border-default)] flex items-center justify-between">
        <h2 className="m-0 text-[13px] font-semibold text-[var(--color-ink-900)] flex items-center gap-2">
          Payments
          <span className="text-[11px] text-[var(--color-ink-500)] font-medium ml-1">
            {filtered.length} of {rows.length}
          </span>
          <FreshnessBadge />
        </h2>
      </header>
      {filtered.length === 0 ? (
        <EmptyState
          bootstrapping={bootstrapping}
          filtered={filtered.length}
          totalInMirror={rows.length}
          noun="payments"
        />
      ) : (
        <table className="w-full text-[13px]">
          <thead>
            <tr>
              <Th>SO Number</Th>
              <Th>Customer</Th>
              <Th align="right">Amount</Th>
              <Th>Status</Th>
              <Th>Method</Th>
              <Th>Received</Th>
              <Th>Reference</Th>
              <Th>Confirmed by</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => (
              <tr
                key={r.id}
                className={`${i % 2 ? "bg-[#FBFBFC]" : "bg-white"} border-b border-[var(--color-border-default)] hover:bg-[var(--color-navy-50)]`}
              >
                <Td mono>
                  <Link
                    href={`/sales/sales-orders/${r.salesOrderId}`}
                    className="text-[var(--color-navy-700)] hover:underline font-medium"
                  >
                    {r.soNumber}
                  </Link>
                </Td>
                <Td>{r.customerName}</Td>
                <Td align="right" mono>
                  <span className="text-[var(--color-ink-900)] font-semibold">{formatNGN(r.amount)}</span>
                </Td>
                <Td>
                  <StatusPill status={r.status} />
                </Td>
                <Td>{r.paymentMethodName}</Td>
                <Td>
                  <span title={formatDateTime(r.receivedAt)}>{formatDateShort(r.receivedAt)}</span>
                </Td>
                <Td mono>{r.referenceNumber ?? <span className="text-[var(--color-ink-400)]">--</span>}</Td>
                <Td>
                  {r.confirmedByName ? (
                    r.confirmedByName
                  ) : (
                    <span className="text-[var(--color-ink-400)]">--</span>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function StatusPill({ status }: { status: PaymentStatus }) {
  const tone =
    status === "CONFIRMED"
      ? { bg: "bg-[var(--color-success-100)]", fg: "text-[var(--color-success-700)]", dot: "bg-[var(--color-success-700)]" }
      : status === "PENDING"
        ? { bg: "bg-[var(--color-warning-50)]", fg: "text-[var(--color-warning-700)]", dot: "bg-[var(--color-warning-700)]" }
        : { bg: "bg-[var(--color-danger-50)]", fg: "text-[var(--color-danger-700)]", dot: "bg-[var(--color-danger-700)]" };
  return (
    <span
      className={`inline-flex items-center gap-1 h-[18px] px-2 rounded-full text-[10.5px] font-semibold uppercase tracking-[0.02em] ${tone.bg} ${tone.fg}`}
    >
      <span className={`w-[5px] h-[5px] rounded-full flex-shrink-0 ${tone.dot}`} aria-hidden />
      {status === "PENDING" ? "Pending" : status === "CONFIRMED" ? "Confirmed" : "Rejected"}
    </span>
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
