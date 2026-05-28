"use client";

/**
 * App-level error boundary for every authenticated route. Without this, any
 * error thrown while navigating or rendering (most commonly an offline soft-
 * navigation to a route whose RSC payload / JS chunk was never cached, which
 * fails at Next's loader level before the page component runs) bubbles to
 * Next's raw error overlay, which is not a graceful experience.
 *
 * This boundary catches that class of failure and degrades gracefully:
 *   - If we're offline (or the error looks like a chunk/RSC load failure),
 *     explain it's an offline-load issue and offer retry + a way back, rather
 *     than implying the data is broken.
 *   - Otherwise, show a generic recoverable error with retry.
 *
 * `reset()` re-renders the segment; once back online (or after the chunk is
 * re-fetched) the retry succeeds.
 */
import Link from "next/link";
import { useEffect } from "react";

import { useConnectivity } from "@/lib/sync/connectivity";

function looksLikeLoadFailure(error: Error): boolean {
  const s = `${error.name} ${error.message}`.toLowerCase();
  return (
    s.includes("chunk") ||
    s.includes("failed to fetch") ||
    s.includes("dynamically imported module") ||
    s.includes("loading css") ||
    s.includes("networkerror") ||
    s.includes("load failed")
  );
}

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { state: connState } = useConnectivity();

  useEffect(() => {
    // Keep a console trace for diagnosis; the UI stays calm.
    console.error("Route error boundary caught:", error);
  }, [error]);

  const offlineish = connState === "offline" || looksLikeLoadFailure(error);

  return (
    <div className="max-w-[560px] mx-auto mt-12">
      <div className="bg-white border border-[var(--color-border-default)] rounded-[4px] px-6 py-6">
        <div className="flex items-center gap-2 mb-2">
          <span
            aria-hidden
            className="w-[7px] h-[7px] rounded-full"
            style={{ background: offlineish ? "var(--color-warning-700)" : "var(--color-danger-700)" }}
          />
          <h1 className="m-0 text-[16px] font-semibold text-[var(--color-ink-900)]">
            {offlineish ? "This page couldn't load offline" : "Something went wrong"}
          </h1>
        </div>
        <p className="text-[13px] text-[var(--color-ink-700)] leading-[1.55] m-0 mb-4">
          {offlineish ? (
            <>
              This screen hasn&apos;t been cached on this device yet, so it can&apos;t open while
              you&apos;re offline. Reconnect and retry, or open it once online to cache it. Pages you&apos;ve
              already visited online stay available offline.
            </>
          ) : (
            <>
              An unexpected error interrupted this page. You can retry, or head back to the
              dashboard. If it keeps happening, the detail below helps with diagnosis.
            </>
          )}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => reset()}
            className="h-8 px-3 rounded-[3px] text-[12.5px] font-medium text-white inline-flex items-center"
            style={{ background: "var(--color-navy-700)" }}
          >
            Retry
          </button>
          <Link
            href="/"
            className="h-8 px-3 rounded-[3px] text-[12.5px] font-medium border border-[var(--color-border-strong)] bg-white text-[var(--color-ink-900)] hover:bg-[var(--color-ink-100)] inline-flex items-center"
          >
            Back to dashboard
          </Link>
        </div>
        <details className="mt-4">
          <summary className="text-[11px] text-[var(--color-ink-500)] cursor-pointer select-none">
            Error detail
          </summary>
          <pre className="mt-2 text-[11px] text-[var(--color-ink-600)] whitespace-pre-wrap break-words font-mono bg-[var(--color-ink-100)] rounded-[3px] p-2">
            {error.name}: {error.message}
            {error.digest ? `\n\ndigest: ${error.digest}` : ""}
          </pre>
        </details>
      </div>
    </div>
  );
}
