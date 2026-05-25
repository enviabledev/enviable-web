"use client";

/**
 * Disclosure banner for computed surfaces (reports, dashboard) read offline.
 * Combines the FreshnessBadge's "cached as of X" with an explicit accuracy
 * warning: a stale aggregation can mislead a decision in a way a stale single
 * record is less likely to, so computed surfaces carry both freshness AND a
 * visible "may be less accurate offline" caveat.
 *
 * The fidelity guarantee from the recompute path is: "less accurate" means
 * possibly stale, never computed differently. The recompute applies the
 * SAME logic the backend applies, over the mirrored data, so the offline
 * figure equals the online figure over the same data. The accuracy warning
 * is about staleness of inputs, not about computation divergence.
 */
import { shortFreshness, useMirrorFreshness } from "@/lib/sync/mirror/freshness";

export default function ComputedDisclosure({
  className = "",
}: {
  className?: string;
}) {
  const watermark = useMirrorFreshness();
  const label = shortFreshness(watermark?.lastSyncAt ?? null);
  return (
    <div
      className={`flex items-start gap-2 px-3.5 py-2.5 rounded-[3px] border ${className}`}
      style={{
        background: "var(--color-warning-100)",
        borderColor: "var(--color-warning-700)",
      }}
    >
      <span
        aria-hidden
        className="mt-[5px] w-[6px] h-[6px] rounded-full flex-shrink-0"
        style={{ background: "var(--color-warning-700)" }}
      />
      <div className="text-[12px] text-[var(--color-ink-900)] leading-[1.5]">
        <span className="font-semibold" style={{ color: "var(--color-warning-700)" }}>
          Computed from cached data
        </span>{" "}
        as of {label}. Offline figures use the same calculation as online, but
        may be based on data that has changed since the last sync. Reconnect
        for the most current values.
      </div>
    </div>
  );
}
