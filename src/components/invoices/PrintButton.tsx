"use client";

/**
 * "Print" button for invoice surfaces. The operational mental model is "I want
 * to print this invoice for the customer", so the label is Print, but the
 * behaviour is: fetch the backend's PDF endpoint and let the browser handle
 * the rest (save to disk, open in the PDF viewer, etc.). The user prints paper
 * from their own viewer. This NEVER calls window.print() and never opens the
 * browser's print dialog; the backend PDF is the only artifact source.
 *
 * Online-only, like price-setting and the other connectivity-bound actions:
 * disabled offline with an honest "requires a connection" title and inline
 * note. Self-contained: it reads connectivity itself so callers only pass the
 * PDF path.
 */
import { useState } from "react";

import { downloadInvoicePdf } from "@/lib/invoices/pdf";
import { useConnectivity } from "@/lib/sync/connectivity";

type Variant = "primary" | "outline" | "row";

const VARIANT_CLASS: Record<Variant, string> = {
  primary:
    "h-[28px] px-3 rounded-[3px] bg-[var(--color-navy-700)] text-white border border-[var(--color-navy-700)] hover:bg-[var(--color-navy-800)]",
  outline:
    "h-[28px] px-2.5 rounded-[3px] bg-white text-[var(--color-navy-700)] border border-[var(--color-border-strong)] hover:bg-[var(--color-navy-50)]",
  row: "h-[24px] px-2 rounded-[3px] bg-white text-[var(--color-navy-700)] border border-[var(--color-border-default)] hover:border-[var(--color-navy-700)] text-[11.5px]",
};

export default function PrintButton({
  pdfPath,
  fallbackFilename,
  label = "Print",
  variant = "outline",
  className = "",
}: {
  pdfPath: string;
  fallbackFilename?: string;
  label?: string;
  variant?: Variant;
  className?: string;
}) {
  const { state: connState } = useConnectivity();
  const [status, setStatus] = useState<"idle" | "printing" | "error">("idle");
  const [errMsg, setErrMsg] = useState("");

  const offline = connState === "offline";
  const disabled = offline || status === "printing";

  const onClick = async () => {
    if (disabled) return;
    setStatus("printing");
    setErrMsg("");
    const r = await downloadInvoicePdf(pdfPath, fallbackFilename);
    if (r.ok) {
      setStatus("idle");
    } else {
      setStatus("error");
      setErrMsg(r.message);
    }
  };

  const isRow = variant === "row";

  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        data-testid="print-pdf-button"
        title={
          status === "error"
            ? errMsg
            : offline
              ? "Printing requires a connection"
              : "Fetch the PDF from the server; your browser saves or opens it"
        }
        className={`inline-flex items-center gap-1.5 font-medium ${
          isRow ? "" : "text-[12.5px]"
        } ${VARIANT_CLASS[variant]} disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        <PrinterIcon className={isRow ? "w-[12px] h-[12px]" : "w-[13px] h-[13px]"} />
        {status === "printing" ? "Preparing..." : label}
      </button>
      {offline && !isRow && (
        <span className="text-[11.5px] text-[var(--color-warning-700)]">
          Disabled offline. Reconnect to print.
        </span>
      )}
      {status === "error" && !isRow && (
        <span className="text-[11.5px] text-[var(--color-danger-700)]">{errMsg}</span>
      )}
    </span>
  );
}

function PrinterIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 6V2h8v4" />
      <path d="M4 12H3a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1" />
      <rect x="4" y="10" width="8" height="4" rx="0.5" />
    </svg>
  );
}
