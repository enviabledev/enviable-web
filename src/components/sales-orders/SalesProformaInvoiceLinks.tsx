"use client";

/**
 * Sales-side proforma invoice affordances (prompt 43b). The PI is auto-issued
 * on SO creation and renders LIVE from the current SO (not re-issued on edit),
 * so the copy never presents it as an immutable document: "Reflects current
 * order details. Edit the order to update."
 *
 * Both the HTML view and the PDF open in a NEW BROWSER TAB (the backend serves
 * the PDF Content-Disposition: inline), where the user prints from the browser.
 * Online-only: the backend renders on demand, so offline the open-links are
 * disabled with an honest note, consistent with PrintButton.
 *
 * Two surfaces:
 *   - SalesPiCard: the documents section on the SO detail page.
 *   - SalesPiInlineLink: a compact per-row link on /sales/invoices-payments.
 */
import { salesProformaInvoiceDoc } from "@/lib/invoices/pdf";
import { formatDateShort } from "@/lib/format";
import { useConnectivity } from "@/lib/sync/connectivity";

export type PiSummary = { id: string; piNumber: string; issuedAt: string };

const LIVE_RENDER_HINT = "Reflects current order details. Edit the order to update.";

function NewTabDocLink({
  href,
  label,
  testId,
  primary = false,
  offline,
}: {
  href: string;
  label: string;
  testId: string;
  primary?: boolean;
  offline: boolean;
}) {
  const base =
    "h-[28px] px-2.5 inline-flex items-center gap-1.5 rounded-[3px] text-[12px] font-medium border";
  if (offline) {
    return (
      <span
        data-testid={testId}
        title="Opening the proforma invoice requires a connection"
        aria-disabled
        className={`${base} border-[var(--color-border-default)] bg-[var(--color-ink-100)] text-[var(--color-ink-400)] cursor-not-allowed`}
      >
        {label}
      </span>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      data-testid={testId}
      className={
        primary
          ? `${base} border-[var(--color-navy-700)] bg-[var(--color-navy-700)] text-white hover:bg-[var(--color-navy-800)]`
          : `${base} border-[var(--color-border-strong)] bg-white text-[var(--color-navy-700)] hover:bg-[var(--color-navy-50)]`
      }
    >
      {label}
    </a>
  );
}

function InfoTooltip() {
  return (
    <span
      data-testid="pi-info-tooltip"
      title={LIVE_RENDER_HINT}
      aria-label={LIVE_RENDER_HINT}
      className="inline-flex items-center justify-center w-[15px] h-[15px] rounded-full border border-[var(--color-border-strong)] text-[10px] font-semibold text-[var(--color-ink-500)] cursor-help select-none align-middle"
    >
      i
    </span>
  );
}

/**
 * The PI documents card on the SO detail page.
 * - pi present  -> View PI + Open PDF, PI number, issued date, live-render hint.
 * - pi null AND known (network resolved) -> honest "no PI" note (legacy SO).
 * - pi null/undefined AND !known (mirror paint, offline) -> "loads when online".
 */
export function SalesPiCard({ pi, known }: { pi: PiSummary | null | undefined; known: boolean }) {
  const { state: connState } = useConnectivity();
  const offline = connState === "offline";
  const doc = pi ? salesProformaInvoiceDoc(pi.id) : null;

  return (
    <section className="bg-white border border-[var(--color-border-default)] rounded-[4px] mb-4" data-testid="sales-pi-card">
      <header className="px-5 py-3 border-b border-[var(--color-border-default)] flex items-center justify-between gap-2 flex-wrap">
        <h2 className="m-0 text-[13px] font-semibold text-[var(--color-ink-900)] inline-flex items-center gap-1.5">
          Proforma Invoice <InfoTooltip />
        </h2>
        {pi && doc && (
          <div className="flex items-center gap-2 flex-wrap">
            <NewTabDocLink href={doc.html} label="View PI" testId="view-pi-html" primary offline={offline} />
            <NewTabDocLink href={doc.pdf} label="Open PDF" testId="view-pi-pdf" offline={offline} />
          </div>
        )}
      </header>
      <div className="px-5 py-3">
        {pi ? (
          <div className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-x-3 gap-y-1.5 text-[13px]">
            <span className="text-[12px] font-medium text-[var(--color-ink-500)]">PI number</span>
            <span className="font-mono font-semibold text-[var(--color-navy-700)]" data-testid="pi-number">
              {pi.piNumber}
            </span>
            <span className="text-[12px] font-medium text-[var(--color-ink-500)]">Issued</span>
            <span data-testid="pi-issued-at">{formatDateShort(pi.issuedAt)}</span>
            <span className="text-[12px] font-medium text-[var(--color-ink-500)]">Customer copy</span>
            <span className="text-[12px] text-[var(--color-ink-700)]">
              {LIVE_RENDER_HINT}
              {offline && (
                <span className="ml-1 text-[var(--color-warning-700)]">Opening requires a connection.</span>
              )}
            </span>
          </div>
        ) : known ? (
          <div className="text-[12.5px] text-[var(--color-ink-500)]" data-testid="pi-none-note">
            No proforma invoice was issued for this order.
          </div>
        ) : (
          <div className="text-[12.5px] text-[var(--color-ink-500)]" data-testid="pi-loading-note">
            The proforma invoice loads when online.
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * Compact per-row PI link for the invoices/payments listing. Renders nothing
 * when the SO has no PI. Opens the HTML in a new tab; disabled offline.
 */
export function SalesPiInlineLink({ pi }: { pi: PiSummary | null | undefined }) {
  const { state: connState } = useConnectivity();
  const offline = connState === "offline";
  if (!pi) return null;
  const doc = salesProformaInvoiceDoc(pi.id);
  const cls =
    "inline-flex items-center gap-1 text-[11.5px] font-medium whitespace-nowrap";
  if (offline) {
    return (
      <span
        data-testid="pi-inline-link"
        title="Opening the proforma invoice requires a connection"
        className={`${cls} text-[var(--color-ink-400)] cursor-not-allowed`}
      >
        View PI
      </span>
    );
  }
  return (
    <a
      href={doc.html}
      target="_blank"
      rel="noopener noreferrer"
      data-testid="pi-inline-link"
      title={`${pi.piNumber} (proforma invoice). ${LIVE_RENDER_HINT}`}
      className={`${cls} text-[var(--color-navy-700)] hover:underline`}
    >
      View PI
      <span className="font-mono text-[10.5px] text-[var(--color-ink-500)]">{pi.piNumber}</span>
    </a>
  );
}
