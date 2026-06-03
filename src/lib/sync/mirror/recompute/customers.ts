"use client";

/**
 * Offline recompute of /api/reports/customers. Replicates the backend's
 * computation FAITHFULLY (same customer filter, same sum semantics, same
 * outstanding-balance derivation, same sort/paginate) so the fidelity
 * check passes: offline figures match online figures over the same data.
 *
 * Backend reference: enviable-system/src/reports/customers-report.service.ts
 *
 * No cost gating. Outstanding balance is a sales/AR figure (NOT cost
 * data); it is visible to all report.customers holders, so this recompute
 * never reads Unit.landedCost.
 *
 * Per-customer aggregates:
 *   totalOrders        = count of SOs (any status) for the customer in window
 *   totalOrderValue    = sum of SO.total for orders with a ReleaseAuthorisation
 *                        (the "released" set, same as revenue report)
 *   lastOrderDate      = max SO.createdAt
 *   outstandingBalance = sum over SOs in AWAITING_PAYMENT or PAYMENT_RECEIVED of
 *                        max(SO.total - sum(CONFIRMED payment.amount), 0)
 *
 * Customers are listed regardless of in-range activity (the customer base
 * stays visible); the date range scopes the ORDER metrics, not the customer
 * set. The tier and status filters narrow the customer set.
 *
 * Sort: totalOrderValue desc. Pagination: { data, page, pageSize, total }.
 */
import type {
  CustomersReportResponse,
  CustomersReportRow,
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

type MirroredCustomer = {
  id: string;
  name: string;
  type: string;
  status: string;
  tierId: string | null;
  deletedAt: string | null;
};
type MirroredTier = { id: string; name: string };
type MirroredSalesOrder = {
  id: string;
  customerId: string;
  total: string;
  status: string;
  createdAt: string;
  deletedAt: string | null;
};
type MirroredReleaseAuthorisation = {
  id: string;
  salesOrderId: string;
};
type MirroredPayment = {
  id: string;
  salesOrderId: string;
  amount: string;
  status: string;
};

const OUTSTANDING_STATUSES = new Set(["AWAITING_PAYMENT", "PAYMENT_RECEIVED"]);

export type RecomputeCustomersOptions = {
  page?: number;
  pageSize?: number;
  tierId?: string;
  status?: string;
  from?: string;
  to?: string;
};

export async function recomputeCustomersFromMirror(
  opts: RecomputeCustomersOptions = {},
): Promise<CustomersReportResponse> {
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 50;

  const [customers, tiers, orders, releases, payments] = await Promise.all([
    listByType<MirroredCustomer>("customer"),
    listByType<MirroredTier>("customerTier"),
    listByType<MirroredSalesOrder>("salesOrder"),
    listByType<MirroredReleaseAuthorisation>("releaseAuthorisation"),
    listByType<MirroredPayment>("payment"),
  ]);

  const tierById = new Map(tiers.map((t) => [t.body.id, t.body]));
  const releaseSoIds = new Set(releases.map((r) => r.body.salesOrderId));
  const paymentsBySo = new Map<string, MirroredPayment[]>();
  for (const p of payments) {
    const so = p.body.salesOrderId;
    const list = paymentsBySo.get(so) ?? [];
    list.push(p.body);
    paymentsBySo.set(so, list);
  }

  const filteredCustomers = customers
    .map((c) => c.body)
    .filter((c) => c.deletedAt == null)
    .filter((c) => (opts.tierId ? c.tierId === opts.tierId : true))
    .filter((c) => (opts.status ? c.status === opts.status : true));
  const customerIdSet = new Set(filteredCustomers.map((c) => c.id));

  const inRangeOrders = orders
    .map((o) => o.body)
    .filter((o) => o.deletedAt == null)
    .filter((o) => customerIdSet.has(o.customerId))
    .filter((o) => (opts.from ? o.createdAt >= opts.from : true))
    .filter((o) => (opts.to ? o.createdAt < opts.to : true));

  type Agg = {
    totalOrders: number;
    totalOrderValueScaled: bigint;
    lastOrderDate: string | null;
    outstandingBalanceScaled: bigint;
  };
  const aggById = new Map<string, Agg>();
  for (const c of filteredCustomers) {
    aggById.set(c.id, {
      totalOrders: 0,
      totalOrderValueScaled: BigInt(0),
      lastOrderDate: null,
      outstandingBalanceScaled: BigInt(0),
    });
  }

  for (const o of inRangeOrders) {
    const a = aggById.get(o.customerId);
    if (!a) continue;
    a.totalOrders += 1;
    if (releaseSoIds.has(o.id)) {
      a.totalOrderValueScaled += decimalToScaled(o.total);
    }
    if (!a.lastOrderDate || o.createdAt > a.lastOrderDate) {
      a.lastOrderDate = o.createdAt;
    }
    if (OUTSTANDING_STATUSES.has(o.status)) {
      const soPayments = paymentsBySo.get(o.id) ?? [];
      let confirmedScaled = BigInt(0);
      for (const p of soPayments) {
        if (p.status === "CONFIRMED") {
          confirmedScaled += decimalToScaled(p.amount);
        }
      }
      const remainder = decimalToScaled(o.total) - confirmedScaled;
      if (remainder > BigInt(0)) {
        a.outstandingBalanceScaled += remainder;
      }
    }
  }

  const rows: CustomersReportRow[] = filteredCustomers
    .map((c) => {
      const a = aggById.get(c.id)!;
      const tier = c.tierId ? tierById.get(c.tierId) : null;
      return {
        customerId: c.id,
        name: c.name,
        type: c.type,
        status: c.status,
        tier: tier ? { id: tier.id, name: tier.name } : null,
        totalOrders: a.totalOrders,
        totalOrderValue: scaledToDecimal(a.totalOrderValueScaled),
        lastOrderDate: a.lastOrderDate,
        outstandingBalance: scaledToDecimal(a.outstandingBalanceScaled),
      };
    })
    .sort((x, y) => {
      const xs = decimalToScaled(x.totalOrderValue);
      const ys = decimalToScaled(y.totalOrderValue);
      return xs < ys ? 1 : xs > ys ? -1 : 0;
    });

  const total = rows.length;
  const start = (page - 1) * pageSize;
  const data = rows.slice(start, start + pageSize);

  return { data, page, pageSize, total };
}
