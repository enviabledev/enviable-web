"use client";

/**
 * Small freshness disclosure for offline reads off the mirror. Sits near a
 * page's header / above a list. Wording is honest: "Cached as of HH:MM"
 * when we know the timestamp, or "Showing cached data" when we don't.
 * Never claims data is fresh when it's stale.
 */
import { shortFreshness, useMirrorFreshness } from "@/lib/sync/mirror/freshness";

export default function FreshnessBadge({
  className = "",
}: {
  className?: string;
}) {
  const watermark = useMirrorFreshness();
  const label = shortFreshness(watermark?.lastSyncAt ?? null);
  return (
    <div
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[3px] text-[11px] ${className}`}
      style={{
        background: "var(--color-warning-100)",
        color: "var(--color-warning-700)",
      }}
      title={
        watermark?.lastSyncAt
          ? `Latest mirror sync at ${new Date(watermark.lastSyncAt).toLocaleString()}`
          : "The mirror has not synced yet on this device."
      }
    >
      <span
        aria-hidden
        className="w-[5px] h-[5px] rounded-full"
        style={{ background: "var(--color-warning-700)" }}
      />
      <span className="font-medium">Cached</span>
      <span className="text-[var(--color-ink-600)]">as of {label}</span>
    </div>
  );
}
