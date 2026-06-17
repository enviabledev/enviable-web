"use client";

/**
 * Proforma invoice document view at
 * /procurement/proforma-invoices/[id]/document. Gated 'pi.read'.
 *
 * Renders the proforma the way it goes out: the backend's HTML view endpoint
 * ("Branded Band" / design C, the same template the PDF is rendered from)
 * embedded in a sandboxed iframe. The Print button fetches the backend PDF;
 * no window.print(), no browser print stylesheet.
 *
 * Mirror-first for the underlying summary (PI number, supplier, CIF total);
 * the rendered document is online-only. Same honest offline treatment as the
 * sales invoice view.
 *
 * The PI id is the segment BEFORE the trailing "document" in the path, so this
 * page reads it explicitly rather than using useUrlLastSegment (which would
 * return "document"). The same empty-id guard discipline applies: the mirror
 * read and the document frame are guarded with `if (!id)`.
 */
import Link from "next/link";
import { useEffect, useState } from "react";

import InvoiceDocumentFrame from "@/components/invoices/InvoiceDocumentFrame";
import FreshnessBadge from "@/components/sync/FreshnessBadge";
import { usePermissions } from "@/lib/auth";
import { formatDateShort, formatNGN } from "@/lib/format";
import { proformaInvoiceDoc } from "@/lib/invoices/pdf";
import { useMirrorFreshness } from "@/lib/sync/mirror/freshness";
import { getById } from "@/lib/sync/mirror/store";

type MirroredPi = {
  id: string;
  piNumber: string;
  purchaseOrderId: string;
  revisionNumber: number;
  status: string;
  totalValue: string;
  freightAmount: string;
  insuranceAmount: string;
  issueDate: string | null;
  validityUntil: string | null;
};

type MirroredPo = { id: string; poNumber: string; supplierId: string };
type MirroredCounterparty = { id: string; name: string };

type Summary = {
  piNumber: string;
  revisionNumber: number;
  totalValue: string;
  issueDate: string | null;
  validityUntil: string | null;
  poId: string;
  poNumber: string;
  supplierName: string;
};

/**
 * Read the PI id as the path segment immediately after "proforma-invoices".
 * The route's last segment is "document", so useUrlLastSegment is wrong here.
 */
function useProformaIdFromDocumentUrl(): string {
  const [id, setId] = useState("");
  useEffect(() => {
    const read = () => {
      const segs = window.location.pathname.split("/").filter(Boolean);
      const i = segs.indexOf("proforma-invoices");
      const next = i >= 0 ? segs[i + 1] : "";
      setId(next ? decodeURIComponent(next) : "");
    };
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);
  return id;
}

export default function ProformaInvoiceDocumentPage() {
  const { has } = usePermissions();
  const canRead = has("pi.read");
  const id = useProformaIdFromDocumentUrl();

  const [summary, setSummary] = useState<Summary | null>(null);
  const [fromMirror, setFromMirror] = useState(false);

  // Mirror-only read freshness (sixth meta-discipline): re-read the summary as
  // the mirror progresses so the page reflects the PI once it syncs, rather
  // than snapshotting null at mount. See the sales invoice view for the rationale.
  const watermark = useMirrorFreshness();

  useEffect(() => {
    if (!id || !canRead) return;
    let cancelled = false;
    void (async () => {
      const pi = await getById<MirroredPi>("proformaInvoice", id);
      if (cancelled || !pi) return;
      const b = pi.body;
      const po = await getById<MirroredPo>("purchaseOrder", b.purchaseOrderId);
      const sup = po
        ? await getById<MirroredCounterparty>("counterparty", po.body.supplierId)
        : undefined;
      if (cancelled) return;
      setSummary({
        piNumber: b.piNumber,
        revisionNumber: b.revisionNumber,
        totalValue: b.totalValue,
        issueDate: b.issueDate,
        validityUntil: b.validityUntil,
        poId: b.purchaseOrderId,
        poNumber: po?.body.poNumber ?? b.purchaseOrderId,
        supplierName: sup?.body.name ?? "(unknown supplier)",
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
        You do not have access to proforma invoices (requires pi.read).
      </div>
    );
  }

  const doc = id ? proformaInvoiceDoc(id) : null;

  return (
    <div className="max-w-[980px] mx-auto pb-10">
      <header className="pb-4 mb-5 border-b border-[var(--color-border-default)]">
        <div className="text-[12px] text-[var(--color-ink-500)] flex items-center gap-1.5 mb-1.5 flex-wrap">
          <Link href="/procurement/proforma-invoices" className="text-[var(--color-ink-500)] hover:text-[var(--color-navy-700)]">
            Procurement
          </Link>
          <span className="text-[var(--color-ink-300)]">/</span>
          <Link href="/procurement/proforma-invoices" className="text-[var(--color-ink-500)] hover:text-[var(--color-navy-700)]">
            Proforma invoices
          </Link>
          <span className="text-[var(--color-ink-300)]">/</span>
          {id ? (
            <Link href={`/procurement/proforma-invoices/${id}`} className="text-[var(--color-ink-500)] hover:text-[var(--color-navy-700)] font-mono">
              {summary?.piNumber ?? "Proforma"}
            </Link>
          ) : (
            <span className="text-[var(--color-ink-900)] font-medium font-mono">
              {summary?.piNumber ?? "Proforma"}
            </span>
          )}
          <span className="text-[var(--color-ink-300)]">/</span>
          <span className="text-[var(--color-ink-900)] font-medium">Document</span>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-[22px] font-semibold text-[var(--color-ink-900)] m-0 tracking-[-0.01em] font-mono">
            {summary?.piNumber ?? "Proforma"}
          </h1>
          {summary && (
            <span className="text-[12px] text-[var(--color-ink-500)] font-medium">
              Revision {summary.revisionNumber}
            </span>
          )}
          {fromMirror && <FreshnessBadge />}
        </div>
      </header>

      <SummaryCard summary={summary} />

      {doc && (
        <InvoiceDocumentFrame
          htmlPath={doc.html}
          pdfPath={doc.pdf}
          pdfFilename={
            summary ? `${summary.piNumber}-rev${summary.revisionNumber}.pdf` : undefined
          }
          docNoun="proforma invoice"
        />
      )}
    </div>
  );
}

function SummaryCard({ summary }: { summary: Summary | null }) {
  return (
    <section className="bg-white border border-[var(--color-border-default)] rounded-[4px] mb-4">
      <header className="px-5 py-3 border-b border-[var(--color-border-default)]">
        <h2 className="m-0 text-[13px] font-semibold text-[var(--color-ink-900)]">
          Proforma invoice
        </h2>
      </header>
      <div className="px-5 py-3">
        {!summary ? (
          <div className="text-[12.5px] text-[var(--color-ink-500)]">Loading...</div>
        ) : (
          <div className="grid grid-cols-[160px_1fr] gap-x-3 gap-y-2 text-[13px]">
            <Cell k="PI number">
              <span className="font-mono font-semibold text-[var(--color-navy-700)]">
                {summary.piNumber}
              </span>
            </Cell>
            <Cell k="Revision">
              <span className="font-mono">r{summary.revisionNumber}</span>
            </Cell>
            <Cell k="Purchase order">
              <Link
                href={`/procurement/purchase-orders/${summary.poId}`}
                className="font-mono text-[var(--color-navy-700)] hover:underline"
              >
                {summary.poNumber}
              </Link>
            </Cell>
            <Cell k="Supplier">{summary.supplierName}</Cell>
            <Cell k="Issued">
              {summary.issueDate ? (
                formatDateShort(summary.issueDate)
              ) : (
                <span className="text-[var(--color-ink-400)]">--</span>
              )}
            </Cell>
            <Cell k="Valid until">
              {summary.validityUntil ? (
                formatDateShort(summary.validityUntil)
              ) : (
                <span className="text-[var(--color-ink-400)]">--</span>
              )}
            </Cell>
            <Cell k="Total (CIF)">
              <span className="font-mono tabular-nums font-semibold text-[var(--color-navy-800)] text-[14px]">
                {formatNGN(summary.totalValue)}
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
