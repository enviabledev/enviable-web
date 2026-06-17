/**
 * Invoice document endpoints + PDF download.
 *
 * Single render path: the backend is the only artifact source. Both the
 * on-screen HTML view and the downloadable PDF are rendered from the SAME
 * backend template (sales-invoice / proforma-invoice .hbs, Puppeteer for the
 * PDF), so the screen and the printed page cannot drift. The browser's own
 * print engine is NEVER the artifact source: there is no window.print() and no
 * browser print stylesheet anywhere on the frontend. "Print" means "fetch the
 * backend PDF and let the browser save it"; the user prints paper from their
 * own PDF viewer.
 *
 * Endpoints (confirmed against the running API, the source of truth):
 *   GET /api/invoices/:id/html            text/html         (salesorder.read)
 *   GET /api/invoices/:id/pdf             application/pdf    (salesorder.read)
 *   GET /api/proforma-invoices/:id/html   text/html         (pi.read)
 *   GET /api/proforma-invoices/:id/pdf    application/pdf    (pi.read)
 *
 * The PDF responses carry Content-Disposition: attachment; filename="...",
 * so the filename is owned by the backend (invoiceNumber.pdf,
 * piNumber-revN.pdf). We read it back off the header and hand it to the
 * browser as the suggested download name.
 */

export type InvoiceDoc = { html: string; pdf: string };

export function salesInvoiceDoc(invoiceId: string): InvoiceDoc {
  const e = encodeURIComponent(invoiceId);
  return { html: `/api/invoices/${e}/html`, pdf: `/api/invoices/${e}/pdf` };
}

export function proformaInvoiceDoc(piId: string): InvoiceDoc {
  const e = encodeURIComponent(piId);
  return {
    html: `/api/proforma-invoices/${e}/html`,
    pdf: `/api/proforma-invoices/${e}/pdf`,
  };
}

export type PdfOutcome =
  | { ok: true; filename: string }
  | {
      ok: false;
      reason: "offline" | "unauthorized" | "forbidden" | "not_found" | "error";
      message: string;
    };

// Handles both `filename="x.pdf"` and the extended `filename*=UTF-8''x.pdf`.
const FILENAME_RE = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i;

function parseFilename(disposition: string | null, fallback: string): string {
  if (!disposition) return fallback;
  const m = FILENAME_RE.exec(disposition);
  if (!m) return fallback;
  const raw = m[1].trim();
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function triggerBrowserDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  // The download attribute is the browser's suggested filename. We set it from
  // the backend's Content-Disposition so the saved file matches the canonical
  // name (e.g. ENV-INV-2026-00471.pdf) regardless of how the browser handles
  // the download (save to disk, open in viewer, etc.).
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after a delay so the download has a chance to start.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Fetch a backend-rendered invoice PDF and hand it to the browser as a
 * download. Online-only: a network throw resolves to { ok:false,
 * reason:"offline" } so callers can give the same honest disabled-offline
 * treatment as other online-only actions. NEVER calls window.print().
 */
export async function downloadInvoicePdf(
  pdfPath: string,
  fallbackFilename = "invoice.pdf",
): Promise<PdfOutcome> {
  let res: Response;
  try {
    res = await fetch(pdfPath, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      headers: { Accept: "application/pdf" },
    });
  } catch {
    return {
      ok: false,
      reason: "offline",
      message: "Printing requires a connection. Reconnect and try again.",
    };
  }

  if (res.status === 401) {
    return {
      ok: false,
      reason: "unauthorized",
      message: "Your session has expired. Reload and sign in to print.",
    };
  }
  if (res.status === 403) {
    return {
      ok: false,
      reason: "forbidden",
      message: "You do not have permission to print this document.",
    };
  }
  if (res.status === 404) {
    return {
      ok: false,
      reason: "not_found",
      message: "This document is not available.",
    };
  }
  if (!res.ok) {
    return {
      ok: false,
      reason: "error",
      message: `Could not fetch the PDF (HTTP ${res.status}).`,
    };
  }

  const blob = await res.blob();
  const filename = parseFilename(
    res.headers.get("Content-Disposition"),
    fallbackFilename,
  );
  triggerBrowserDownload(blob, filename);
  return { ok: true, filename };
}
