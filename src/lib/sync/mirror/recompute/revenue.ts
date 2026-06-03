"use client";

/**
 * Offline recompute of /api/reports/revenue. Replicates the backend's
 * computation FAITHFULLY (same recognition date, same sum semantics,
 * same partition logic, same scaled-bigint arithmetic) so the fidelity
 * check passes: offline figures match online figures over the same
 * data. The mirror's cost stripping (Unit.landedCost absent for non-
 * cost users) handles cost-gating by absence; the recompute simply
 * omits margin when no cost inputs exist.
 *
 * Backend reference: enviable-system/src/reports/revenue-report.service.ts
 *
 * Recognition basis:
 *   Orders are included if there exists a ReleaseAuthorisation with
 *   issuedAt in [from, to). All ordeer statuses past RELEASE_AUTHORISED
 *   are included (REFUNDED too).
 *
 * Sums (all Prisma.Decimal on backend, scaled bigint here for fidelity):
 *   totalRevenue   = sum of SalesOrder.total (VAT-inclusive)
 *   vatCollected   = sum of SalesOrder.vatAmount
 *   netRevenue     = sum of SalesOrderLine.lineTotal (VAT-exclusive)
 *   totalLandedCost = sum of Unit.landedCost per line.unit
 *   margin         = netRevenue - totalLandedCost
 *
 * Partitions:
 *   byVariant  keyed on productVariantId; revenue = sum of lineTotal
 *              per variant; unitsSold = count of lines per variant
 *   byCustomer keyed on customerId; revenue = sum of SO.total;
 *              orders = count of distinct SOs per customer; top N
 *   byDay      keyed on releaseAuthorisation.issuedAt sliced to date
 *              (YYYY-MM-DD); revenue = sum of SO.total per day;
 *              unitsSold = count of lines per day
 */
import type {
  RevenueReport,
  RevenueReportCustomerRow,
  RevenueReportTrendPoint,
  RevenueReportVariantRow,
} from "@/lib/api";
import { listByType } from "@/lib/sync/mirror/store";

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

type MirroredSalesOrder = {
  id: string;
  customerId: string;
  total: string;
  vatAmount: string;
  deletedAt: string | null;
};
type MirroredSalesOrderLine = {
  id: string;
  salesOrderId: string;
  productVariantId: string;
  unitId: string | null;
  lineTotal: string;
  saleForm: "CKD" | "CBU";
};
type MirroredReleaseAuthorisation = {
  id: string;
  salesOrderId: string;
  issuedAt: string;
};
type MirroredUnit = {
  id: string;
  landedCost?: string;
};
type MirroredVariant = { id: string; supplierSkuCode: string };
type MirroredCustomer = { id: string; name: string };

export type RecomputeRevenueOptions = {
  from: string; // ISO datetime, inclusive
  to: string; // ISO datetime, exclusive
  topN?: number;
};

export async function recomputeRevenueFromMirror(
  opts: RecomputeRevenueOptions,
): Promise<RevenueReport> {
  const topN = opts.topN ?? 5;

  const [orders, lines, releases, units, variants, customers] = await Promise.all([
    listByType<MirroredSalesOrder>("salesOrder"),
    listByType<MirroredSalesOrderLine>("salesOrderLine"),
    listByType<MirroredReleaseAuthorisation>("releaseAuthorisation"),
    listByType<MirroredUnit>("unit"),
    listByType<MirroredVariant>("productVariant"),
    listByType<MirroredCustomer>("customer"),
  ]);

  // Build lookups.
  const orderById = new Map(orders.map((o) => [o.body.id, o.body]));
  const unitById = new Map(units.map((u) => [u.body.id, u.body]));
  const variantById = new Map(variants.map((v) => [v.body.id, v.body]));
  const customerById = new Map(customers.map((c) => [c.body.id, c.body]));
  const linesBySo = new Map<string, MirroredSalesOrderLine[]>();
  for (const l of lines) {
    const so = l.body.salesOrderId;
    const list = linesBySo.get(so) ?? [];
    list.push(l.body);
    linesBySo.set(so, list);
  }

  // Pre-filter releases by issuedAt window. The backend uses
  // `issuedAt: { gte: from, lt: to }`, so inclusive-from / exclusive-to.
  const includedReleases = releases
    .map((r) => r.body)
    .filter((r) => r.issuedAt >= opts.from && r.issuedAt < opts.to)
    .map((r) => ({ ...r, order: orderById.get(r.salesOrderId) }))
    .filter((r): r is MirroredReleaseAuthorisation & { order: MirroredSalesOrder } =>
      r.order != null && r.order.deletedAt == null,
    );

  // Accumulators.
  let totalRevenueScaled = BigInt(0);
  let vatCollectedScaled = BigInt(0);
  let netRevenueScaled = BigInt(0);
  let totalLandedCostScaled = BigInt(0);
  let anyLandedCostSeen = false;
  let unitsSold = 0;
  let ckd = 0;
  let cbu = 0;

  type VariantAcc = { sku: string; units: number; revenueScaled: bigint; landedCostScaled: bigint };
  type CustomerAcc = { name: string; revenueScaled: bigint; orderIds: Set<string> };
  type DayAcc = { revenueScaled: bigint; unitsSold: number };

  const byVariant = new Map<string, VariantAcc>();
  const byCustomer = new Map<string, CustomerAcc>();
  const byDay = new Map<string, DayAcc>();

  for (const { order, issuedAt } of includedReleases) {
    totalRevenueScaled += decimalToScaled(order.total);
    vatCollectedScaled += decimalToScaled(order.vatAmount);

    const day = issuedAt.slice(0, 10);
    const dayAcc = byDay.get(day) ?? { revenueScaled: BigInt(0), unitsSold: 0 };
    dayAcc.revenueScaled += decimalToScaled(order.total);
    byDay.set(day, dayAcc);

    const custAcc = byCustomer.get(order.customerId) ?? {
      name: customerById.get(order.customerId)?.name ?? order.customerId,
      revenueScaled: BigInt(0),
      orderIds: new Set<string>(),
    };
    custAcc.revenueScaled += decimalToScaled(order.total);
    custAcc.orderIds.add(order.id);
    byCustomer.set(order.customerId, custAcc);

    const orderLines = linesBySo.get(order.id) ?? [];
    for (const l of orderLines) {
      unitsSold += 1;
      if (l.saleForm === "CKD") ckd += 1;
      else cbu += 1;

      netRevenueScaled += decimalToScaled(l.lineTotal);
      dayAcc.unitsSold += 1;

      const u = l.unitId ? unitById.get(l.unitId) : undefined;
      const lineCostScaled = u?.landedCost != null ? decimalToScaled(u.landedCost) : BigInt(0);
      if (u?.landedCost != null) anyLandedCostSeen = true;
      totalLandedCostScaled += lineCostScaled;

      const sku = variantById.get(l.productVariantId)?.supplierSkuCode ?? l.productVariantId;
      const vAcc = byVariant.get(l.productVariantId) ?? {
        sku,
        units: 0,
        revenueScaled: BigInt(0),
        landedCostScaled: BigInt(0),
      };
      vAcc.units += 1;
      vAcc.revenueScaled += decimalToScaled(l.lineTotal);
      vAcc.landedCostScaled += lineCostScaled;
      byVariant.set(l.productVariantId, vAcc);
    }
  }

  const revenueByVariant: RevenueReportVariantRow[] = [...byVariant.entries()]
    .map(([productVariantId, v]) => ({
      productVariantId,
      sku: v.sku,
      unitsSold: v.units,
      revenue: scaledToDecimal(v.revenueScaled),
      ...(anyLandedCostSeen
        ? {
            landedCost: scaledToDecimal(v.landedCostScaled),
            margin: scaledToDecimal(v.revenueScaled - v.landedCostScaled),
          }
        : {}),
    }))
    .sort((a, b) => (a.revenue < b.revenue ? 1 : a.revenue > b.revenue ? -1 : 0));

  const revenueByCustomer: RevenueReportCustomerRow[] = [...byCustomer.entries()]
    .map(([customerId, c]) => ({
      customerId,
      name: c.name,
      orders: c.orderIds.size,
      revenue: scaledToDecimal(c.revenueScaled),
    }))
    .sort((a, b) => (a.revenue < b.revenue ? 1 : a.revenue > b.revenue ? -1 : 0))
    .slice(0, topN);

  const trend: RevenueReportTrendPoint[] = [...byDay.entries()]
    .map(([date, b]) => ({
      date,
      revenue: scaledToDecimal(b.revenueScaled),
      unitsSold: b.unitsSold,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    from: opts.from,
    to: opts.to,
    recognitionBasis: "order-released-in-range (ReleaseAuthorisation.issuedAt)",
    totalRevenue: scaledToDecimal(totalRevenueScaled),
    vatCollected: scaledToDecimal(vatCollectedScaled),
    unitsSold: { total: unitsSold, ckd, cbu },
    revenueByVariant,
    revenueByCustomer,
    trend,
    ...(anyLandedCostSeen
      ? {
          margin: {
            netRevenue: scaledToDecimal(netRevenueScaled),
            totalLandedCost: scaledToDecimal(totalLandedCostScaled),
            margin: scaledToDecimal(netRevenueScaled - totalLandedCostScaled),
          },
        }
      : {}),
  };
}
