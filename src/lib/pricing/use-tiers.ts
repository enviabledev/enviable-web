"use client";

/**
 * Active customer tiers from the mirror, RE-READ on every mirror download /
 * reconcile (prompt 34). Tiers are a mirror-only read (no list endpoint is
 * usable; the dedicated /api/customers/customer-tiers route is shadowed by the
 * :id handler, see BACKLOG), so a single mount-time read would snapshot an
 * empty bucket on a cold mirror and never recover. Subscribing to mirror
 * progress means the tiers (and the derived default tier) populate as soon as
 * the customerTier bucket syncs, which is the freshness-signal rule for
 * mirror-only reads.
 *
 * Used by the price-list "Add variant" picker, the variant-detail "Set price"
 * affordance, and the post-create deep-link, all of which need a tier to route
 * to the per-variant tier editor.
 */
import { useEffect, useMemo, useState } from "react";

import { onDownloadProgress } from "@/lib/sync/mirror/downloader";
import { onReconcile } from "@/lib/sync/mirror/reconciler";
import { listByType } from "@/lib/sync/mirror/store";
import { pickDefaultTier } from "./default-tier";

export type Tier = { id: string; name: string };

type MirrorTierRow = { id: string; name: string; status?: string; deletedAt?: string | null };

export function useActiveTiers(): { tiers: Tier[]; defaultTierId: string } {
  const [tiers, setTiers] = useState<Tier[]>([]);

  useEffect(() => {
    let cancelled = false;
    const read = async () => {
      try {
        const rows = await listByType<MirrorTierRow>("customerTier");
        if (cancelled) return;
        const active = rows
          .map((r) => r.body)
          .filter((t) => t.deletedAt == null && (t.status ?? "ACTIVE") === "ACTIVE")
          .map<Tier>((t) => ({ id: t.id, name: t.name }))
          .sort((a, b) => a.name.localeCompare(b.name));
        setTiers(active);
      } catch {
        // Mirror not ready; a later progress event re-reads.
      }
    };
    void read();
    const unsubDownload = onDownloadProgress(() => void read());
    const unsubReconcile = onReconcile(() => void read());
    return () => {
      cancelled = true;
      unsubDownload();
      unsubReconcile();
    };
  }, []);

  const defaultTierId = useMemo(() => pickDefaultTier(tiers)?.id ?? "", [tiers]);
  return { tiers, defaultTierId };
}
