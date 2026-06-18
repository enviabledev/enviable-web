"use client";

import { useEffect, useState } from "react";

/**
 * Copy-to-clipboard button with transient "Copied" feedback. Used for the
 * one-time initial-password display on user create / admin reset. Uses the
 * Clipboard API with a graceful fallback to a hidden textarea + execCommand
 * for non-secure contexts where navigator.clipboard is unavailable.
 */
export default function CopyButton({ value, testId }: { value: string; testId?: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  const copy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const ta = document.createElement("textarea");
        ta.value = value;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
    } catch {
      // Clipboard blocked; leave the value visible for manual copy.
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      data-testid={testId}
      className="h-[26px] px-2.5 inline-flex items-center gap-1.5 rounded-[3px] border border-[var(--color-border-strong)] bg-white text-[11.5px] font-medium text-[var(--color-ink-700)] hover:text-[var(--color-navy-700)] hover:border-[var(--color-navy-700)]"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
