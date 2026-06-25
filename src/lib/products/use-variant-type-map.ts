"use client";

/**
 * Shared variantId -> ProductType map (prompt 45). Several surfaces need a
 * variant's wheeler type but read it from an API that omits productType:
 *   - GET /api/products (the SO/PO/price-list picker source) omits productType.
 *   - GET /api/units rows omit productType.
 * The dedicated GET /api/product-variants DOES carry it, and the mirror's
 * productVariant bucket stores the raw column. This hook paints the map from the
 * mirror first (offline-capable) then refines from the network, so a row's type
 * can be reconstructed by FK join without each surface re-implementing it.
 */
import { useEffect, useState } from "react";

import { listProductVariants } from "@/lib/api";
import type { ProductType } from "@/lib/products/product-type";
import { isProductType } from "@/lib/products/product-type";
import { listByType } from "@/lib/sync/mirror/store";

type MirrorVariantRow = { id: string; productType?: string };

export function useVariantTypeMap(): Map<string, ProductType> {
  const [map, setMap] = useState<Map<string, ProductType>>(new Map());

  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();

    // Phase 1: mirror (raw productVariant rows carry the productType column).
    (async () => {
      try {
        const rows = await listByType<MirrorVariantRow>("productVariant");
        if (cancelled) return;
        const m = new Map<string, ProductType>();
        for (const r of rows) {
          if (isProductType(r.body.productType)) m.set(r.body.id, r.body.productType);
        }
        if (m.size > 0) setMap((prev) => (prev.size > 0 ? prev : m));
      } catch {
        // Let the network phase drive.
      }
    })();

    // Phase 2: network refine (authoritative; replaces the mirror paint).
    (async () => {
      const r = await listProductVariants({}, ctrl.signal);
      if (cancelled || r.kind !== "ok") return;
      const m = new Map<string, ProductType>();
      for (const v of r.data) m.set(v.id, v.productType);
      setMap(m);
    })();

    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, []);

  return map;
}
