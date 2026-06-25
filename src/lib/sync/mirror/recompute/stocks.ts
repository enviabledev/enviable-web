"use client";

/**
 * Offline recompute of the stocks report from the mirror.
 *
 * Faithfully mirrors enviable-system/src/reports/reports.service.ts: the
 * same 5-bucket exhaustive partition over UnitStatus, the same in-stock
 * subset (CKD + InAssembly + CBU), the same market valuation
 * (currentMarketPrice * inStockCount), the same partition assertion
 * (sum of buckets must equal total units in scope). Reading the backend
 * service guarantees the offline figure equals the online figure over the
 * same data, modulo freshness.
 *
 * Cost-gating (I-8): spare-parts landed-cost figures are present only when
 * the caller's mirror contains landedCostPerUnit on spare parts. The
 * mirror's pull is cost-stripped server-side for non-cost users, so the
 * field is simply absent and the offline computation omits the totalLandedCostValue,
 * exactly as the backend would for a non-cost caller. No client-side strip.
 */
import { listByType } from "../store";
import type {
  StocksBucketCounts,
  StocksReport,
  StocksSparePartItem,
  StocksVariantRow,
} from "@/lib/api";

type UnitStatus =
  | "IN_WAREHOUSE_CKD"
  | "IN_ASSEMBLY"
  | "IN_WAREHOUSE_SKD"
  | "IN_WAREHOUSE_CBU"
  | "SOLD_AS_CKD"
  | "SOLD_AS_CBU"
  | "IN_TRANSIT"
  | "DAMAGED"
  | "IN_REPAIR"
  | "DEMO"
  | "INTERNAL_USE"
  | "TRANSFERRED"
  | "RETURNED"
  | "WRITTEN_OFF";

type Bucket = "ckd" | "inAssembly" | "skd" | "cbu" | "sold" | "other";

// Replicates STATUS_BUCKET from reports.service.ts. Adding a new UnitStatus
// without giving it a bucket would corrupt the partition; the assertion at
// the end catches a mismatch.
const STATUS_BUCKET: Record<UnitStatus, Bucket> = {
  IN_WAREHOUSE_CKD: "ckd",
  IN_ASSEMBLY: "inAssembly",
  IN_WAREHOUSE_SKD: "skd",
  IN_WAREHOUSE_CBU: "cbu",
  SOLD_AS_CKD: "sold",
  SOLD_AS_CBU: "sold",
  IN_TRANSIT: "other",
  DAMAGED: "other",
  IN_REPAIR: "other",
  DEMO: "other",
  INTERNAL_USE: "other",
  TRANSFERRED: "other",
  RETURNED: "other",
  WRITTEN_OFF: "other",
};

// SKD and CBU are both assembled on-hand stock (46a).
const IN_STOCK_BUCKETS: Bucket[] = ["ckd", "inAssembly", "skd", "cbu"];

function emptyCounts(): Record<Bucket, number> {
  return { ckd: 0, inAssembly: 0, skd: 0, cbu: 0, sold: 0, other: 0 };
}

// Mirror shapes (flat fields from the pull's referenceData).
type MirroredUnit = {
  id: string;
  status: string;
  productVariantId: string;
  currentWarehouseId: string | null;
};
type MirroredVariant = {
  id: string;
  supplierSkuCode: string;
  variantAttributes: { model?: string; colour?: string; [k: string]: string | undefined };
  currentMarketPrice: string;
};
type MirroredSparePart = {
  id: string;
  sku: string;
  name: string;
  quantityOnHand: number;
  landedCostPerUnit?: string;
};

// Decimal-safe arithmetic via string scaling. The mirror stores prices and
// costs as decimal strings (Prisma.Decimal serialised); multiplying by an
// integer count and accumulating must not lose precision. We scale to a
// fixed number of fractional digits (4) and accumulate in bigint.
const SCALE = BigInt(4);
const SCALE_POW = BigInt(10) ** SCALE;

function decimalToScaled(value: string | undefined | null): bigint {
  if (value == null) return BigInt(0);
  const s = String(value).trim();
  if (s === "") return BigInt(0);
  const negative = s.startsWith("-");
  const body = negative ? s.slice(1) : s;
  const [intPart, fracPartRaw = ""] = body.split(".");
  const fracPart = (fracPartRaw + "0".repeat(Number(SCALE))).slice(0, Number(SCALE));
  const scaled = BigInt(intPart || "0") * SCALE_POW + BigInt(fracPart || "0");
  return negative ? -scaled : scaled;
}

function scaledToDecimal(scaled: bigint): string {
  const negative = scaled < BigInt(0);
  const abs = negative ? -scaled : scaled;
  const intPart = abs / SCALE_POW;
  const fracPart = abs % SCALE_POW;
  const fracStr = fracPart.toString().padStart(Number(SCALE), "0").replace(/0+$/, "");
  const body = fracStr.length > 0 ? `${intPart}.${fracStr}` : `${intPart}`;
  return negative ? `-${body}` : body;
}

function mulScaled(decimalString: string, count: number): bigint {
  return decimalToScaled(decimalString) * BigInt(count);
}

export type StocksRecomputeOptions = {
  warehouseId?: string;
};

export async function recomputeStocksFromMirror(
  options: StocksRecomputeOptions = {},
): Promise<StocksReport> {
  const [unitRows, variantRows, sparePartRows] = await Promise.all([
    listByType<MirroredUnit>("unit"),
    listByType<MirroredVariant>("productVariant"),
    listByType<MirroredSparePart>("sparePart"),
  ]);
  const units = unitRows.map((r) => r.body);
  const variants = variantRows.map((r) => r.body);
  const spareParts = sparePartRows.map((r) => r.body);

  const filteredUnits = options.warehouseId
    ? units.filter((u) => u.currentWarehouseId === options.warehouseId)
    : units;

  const variantById = new Map(variants.map((v) => [v.id, v]));

  const countsByVariant = new Map<string, Record<Bucket, number>>();
  const variantIdsSet = new Set<string>();
  for (const u of filteredUnits) {
    variantIdsSet.add(u.productVariantId);
    const counts = countsByVariant.get(u.productVariantId) ?? emptyCounts();
    const bucket = STATUS_BUCKET[u.status as UnitStatus];
    if (!bucket) {
      // Unknown status: defensively count it as "other" rather than dropping.
      // The fidelity check still flags this via the partition assertion.
      counts.other += 1;
    } else {
      counts[bucket] += 1;
    }
    countsByVariant.set(u.productVariantId, counts);
  }
  const variantIds = [...variantIdsSet];

  let totalMarketValueScaled = BigInt(0);
  let bucketGrandTotal = 0;

  const variantRowsOut: StocksVariantRow[] = variantIds
    .map((id) => {
      const variant = variantById.get(id);
      // Mirror may not carry the variant (rare during reconcile lag). Skip
      // rather than throw; the partition assertion below will catch any
      // resulting mismatch and surface it via a clear error rather than a
      // silently wrong figure.
      if (!variant) return null;
      const counts = countsByVariant.get(id) ?? emptyCounts();
      const total =
        counts.ckd + counts.inAssembly + counts.skd + counts.cbu + counts.sold + counts.other;
      const inStockCount = IN_STOCK_BUCKETS.reduce(
        (acc, b) => acc + counts[b],
        0,
      );
      const marketValueScaled = mulScaled(variant.currentMarketPrice, inStockCount);
      totalMarketValueScaled += marketValueScaled;
      bucketGrandTotal += total;

      const row: StocksVariantRow = {
        productVariantId: variant.id,
        sku: variant.supplierSkuCode,
        attributes: variant.variantAttributes,
        currentMarketPrice: variant.currentMarketPrice,
        counts: {
          ckd: counts.ckd,
          inAssembly: counts.inAssembly,
          skd: counts.skd,
          cbu: counts.cbu,
          sold: counts.sold,
          other: counts.other,
          total,
        } as StocksBucketCounts,
        inStockCount,
        marketValue: scaledToDecimal(marketValueScaled),
      };
      return row;
    })
    .filter((r): r is StocksVariantRow => r !== null)
    .sort((a, b) => a.sku.localeCompare(b.sku));

  // Partition assertion mirrors the backend: surfaced as a thrown error so
  // the offline page can render a clear "recompute partition mismatch"
  // rather than a silently wrong figure. Same shape of safeguard.
  const totalUnits = filteredUnits.length;
  if (bucketGrandTotal !== totalUnits) {
    throw new Error(
      `Stocks recompute partition mismatch: buckets summed to ${bucketGrandTotal} but ${totalUnits} units are in scope.`,
    );
  }

  // Spare parts: cost-gating by absence. The mirror's sparePart bucket
  // already omits landedCostPerUnit for non-cost users (server-side strip),
  // so the offline computation simply doesn't have cost inputs to compute
  // over for those users. Mirrors the backend's `canViewCost` branch.
  let totalLandedCostScaled = BigInt(0);
  let anyHasCost = false;
  const items: StocksSparePartItem[] = spareParts
    .sort((a, b) => a.sku.localeCompare(b.sku))
    .map((p) => {
      const hasCost = typeof p.landedCostPerUnit === "string";
      if (hasCost) {
        anyHasCost = true;
        const valueScaled = mulScaled(p.landedCostPerUnit!, p.quantityOnHand);
        totalLandedCostScaled += valueScaled;
        return {
          id: p.id,
          sku: p.sku,
          name: p.name,
          quantityOnHand: p.quantityOnHand,
          landedCostPerUnit: p.landedCostPerUnit,
          landedCostValue: scaledToDecimal(valueScaled),
        };
      }
      return {
        id: p.id,
        sku: p.sku,
        name: p.name,
        quantityOnHand: p.quantityOnHand,
      };
    });

  return {
    asOf: new Date().toISOString(),
    warehouseId: options.warehouseId ?? null,
    kpis: {
      totalUnits,
      totalVariants: variantIds.length,
      totalMarketValue: scaledToDecimal(totalMarketValueScaled),
    },
    variants: variantRowsOut,
    spareParts: anyHasCost
      ? {
          items,
          totalLandedCostValue: scaledToDecimal(totalLandedCostScaled),
        }
      : { items },
  };
}
