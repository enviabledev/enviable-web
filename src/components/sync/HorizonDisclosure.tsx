"use client";

/**
 * Disclosure banner for offline reads of a bounded-history surface (the
 * audit log specifically). Distinct from ComputedDisclosure: the failure
 * mode here is NOT staleness of inputs to a computation; it is the
 * absence of older entries the user might be looking for. The audit log
 * is the comprehensive system of record, and showing a 90-day cached
 * subset without naming it as a subset would let a user conclude "X did
 * not happen" when X happened outside the window.
 *
 * The horizon date is the actual earliest entry held in the mirror, so
 * the user can read the boundary directly rather than infer it from "90
 * days." If the mirror has no entries, the boundary degrades to the
 * mirror's last-sync timestamp (the wider envelope), but the screen
 * still renders the empty state honestly.
 *
 * This disclosure is danger-toned (red border) rather than warning-toned
 * because the failure mode is "answering an audit question with
 * incomplete data," not "an aggregate may be slightly stale." Bounded-
 * truth is a stronger limitation than slightly-stale-truth.
 */
export default function HorizonDisclosure({
  earliestOccurredAt,
  className = "",
}: {
  earliestOccurredAt: string | null;
  className?: string;
}) {
  const horizonLabel = earliestOccurredAt
    ? new Date(earliestOccurredAt).toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "the cached window";
  return (
    <div
      className={`flex items-start gap-2 px-3.5 py-2.5 rounded-[3px] border ${className}`}
      style={{
        background: "var(--color-danger-100)",
        borderColor: "var(--color-danger-700)",
      }}
    >
      <span
        aria-hidden
        className="mt-[5px] w-[6px] h-[6px] rounded-full flex-shrink-0"
        style={{ background: "var(--color-danger-700)" }}
      />
      <div className="text-[12px] text-[var(--color-ink-900)] leading-[1.5]">
        <span className="font-semibold" style={{ color: "var(--color-danger-700)" }}>
          Showing cached audit entries from {horizonLabel} onward.
        </span>{" "}
        This is a subset of the full audit log, not the comprehensive history.
        Reconnect to query the complete trail (entries older than this date are
        not available offline).
      </div>
    </div>
  );
}
