"use client";

/**
 * Sales invoice view at /sales/invoices/[id]. Gated 'salesorder.read'.
 *
 * Renders the invoice the way the customer will receive it: the backend's
 * HTML view endpoint (the same template the PDF is rendered from, "Official
 * Ledger" / design A) embedded in a sandboxed iframe. The Print button fetches
 * the backend PDF; there is no window.print() and no browser print stylesheet.
 *
 * Mirror-first for the underlying summary (invoice number, customer, totals),
 * so the page paints something useful even offline and shows a FreshnessBadge
 * when that summary came from the mirror. The rendered document itself is
 * online-only (the backend renders on demand); offline that surface shows an
 * honest "requires a connection" notice instead of a blank frame.
 *
 * Seventh meta-discipline: the URL last segment is "" on first render, so the
 * mirror read and the document frame are both guarded with `if (!id)`.
 */
import Link from "next/link";
import { useEffect, useState } from "react";

import InvoiceDocumentFrame from "@/components/invoices/InvoiceDocumentFrame";
import FreshnessBadge from "@/components/sync/FreshnessBadge";
import { usePermissions } from "@/lib/auth";
import { formatDateTime, formatNGN } from "@/lib/format";
import { salesInvoiceDoc } from "@/lib/invoices/pdf";
import { useMirrorFreshness } from "@/lib/sync/mirror/freshness";
import { getById } from "@/lib/sync/mirror/store";
import { useUrlLastSegment } from "@/lib/sync/use-url-segment";

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

type MirroredSalesOrder = { id: string; soNumber: string; customerId: string };
type MirroredCustomer = { id: string; name: string };

type Summary = {
  invoiceNumber: string;
  total: string;
  vatAmount: string;
  vatRate: string;
  issueDate: string;
  salesOrderId: string;
  soNumber: string;
  customerName: string;
};

export default function SalesInvoiceViewPage() {
  const { has } = usePermissions();
  const canRead = has("salesorder.read");
  const id = useUrlLastSegment();

  const [summary, setSummary] = useState<Summary | null>(null);
  const [fromMirror, setFromMirror] = useState(false);

  // Mirror-only read freshness (sixth meta-discipline): the summary is read
  // exclusively from the mirror with no network revalidate of its own (the
  // network call is the rendered-HTML fetch, a separate surface), so without
  // re-reading on mirror progress the page would snapshot at mount and miss
  // the invoice if it had not synced yet. The watermark updates on every
  // download-window commit and reconcile, so depending on it re-runs the read
  // until the invoice lands.
  const watermark = useMirrorFreshness();

  useEffect(() => {
    if (!id || !canRead) return;
    let cancelled = false;
    void (async () => {
      const inv = await getById<MirroredInvoice>("invoice", id);
      if (cancelled || !inv) return;
      const b = inv.body;
      const so = await getById<MirroredSalesOrder>("salesOrder", b.salesOrderId);
      const cust = so
        ? await getById<MirroredCustomer>("customer", so.body.customerId)
        : undefined;
      if (cancelled) return;
      setSummary({
        invoiceNumber: b.invoiceNumber,
        total: b.total,
        vatAmount: b.vatAmount,
        vatRate: b.vatRate,
        issueDate: b.issueDate,
        salesOrderId: b.salesOrderId,
        soNumber: so?.body.soNumber ?? b.salesOrderId,
        customerName: cust?.body.name ?? "(unknown)",
      });
      setFromMirror(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [id, canRead, watermark]);

  if (!canRead) {
    return (
      <div className="max-w-[1080px] mx-auto py-10 text-center text-[var(--color-ink-500)]">
        You do not have access to invoices (requires salesorder.read).
      </div>
    );
  }

  const doc = id ? salesInvoiceDoc(id) : null;

  return (
    <div className="max-w-[980px] mx-auto pb-10">
      <header className="pb-4 mb-5 border-b border-[var(--color-border-default)]">
        <div className="text-[12px] text-[var(--color-ink-500)] flex items-center gap-1.5 mb-1.5 flex-wrap">
          <Link href="/sales/invoices-payments" className="text-[var(--color-ink-500)] hover:text-[var(--color-navy-700)]">
            Sales
          </Link>
          <span className="text-[var(--color-ink-300)]">/</span>
          <Link href="/sales/invoices-payments" className="text-[var(--color-ink-500)] hover:text-[var(--color-navy-700)]">
            Invoices &amp; Payments
          </Link>
          <span className="text-[var(--color-ink-300)]">/</span>
          <span className="text-[var(--color-ink-900)] font-medium font-mono">
            {summary?.invoiceNumber ?? "Invoice"}
          </span>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-[22px] font-semibold text-[var(--color-ink-900)] m-0 tracking-[-0.01em] font-mono">
            {summary?.invoiceNumber ?? "Invoice"}
          </h1>
          {fromMirror && <FreshnessBadge />}
        </div>
      </header>

      <SummaryCard summary={summary} />

      {doc && (
        <InvoiceDocumentFrame
          htmlPath={doc.html}
          pdfPath={doc.pdf}
          pdfFilename={summary ? `${summary.invoiceNumber}.pdf` : undefined}
          docNoun="invoice"
        />
      )}
    </div>
  );
}

function SummaryCard({ summary }: { summary: Summary | null }) {
  return (
    <section className="bg-white border border-[var(--color-border-default)] rounded-[4px] mb-4">
      <header className="px-5 py-3 border-b border-[var(--color-border-default)]">
        <h2 className="m-0 text-[13px] font-semibold text-[var(--color-ink-900)]">Invoice</h2>
      </header>
      <div className="px-5 py-3">
        {!summary ? (
          <div className="text-[12.5px] text-[var(--color-ink-500)]">Loading...</div>
        ) : (
          <div className="grid grid-cols-[160px_1fr] gap-x-3 gap-y-2 text-[13px]">
            <Cell k="Invoice number">
              <span className="font-mono font-semibold text-[var(--color-navy-700)]">
                {summary.invoiceNumber}
              </span>
            </Cell>
            <Cell k="Sales order">
              <Link
                href={`/sales/sales-orders/${summary.salesOrderId}`}
                className="font-mono text-[var(--color-navy-700)] hover:underline"
              >
                {summary.soNumber}
              </Link>
            </Cell>
            <Cell k="Customer">{summary.customerName}</Cell>
            <Cell k="Issued">{formatDateTime(summary.issueDate)}</Cell>
            <Cell k="VAT rate (snapshot)">
              <span className="font-mono">{(Number(summary.vatRate) * 100).toFixed(2)}%</span>
            </Cell>
            <Cell k="VAT amount (snapshot)">
              <span className="font-mono tabular-nums">{formatNGN(summary.vatAmount)}</span>
            </Cell>
            <Cell k="Total (snapshot)">
              <span className="font-mono tabular-nums font-semibold text-[var(--color-navy-800)] text-[14px]">
                {formatNGN(summary.total)}
              </span>
            </Cell>
          </div>
        )}
      </div>
    </section>
  );
}

function Cell({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <>
      <span className="text-[12px] font-medium text-[var(--color-ink-500)]">{k}</span>
      <span>{children}</span>
    </>
  );
}
