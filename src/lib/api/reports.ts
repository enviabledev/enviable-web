import { apiFetch, buildQuery, type ApiResult } from "./client";

/**
 * Types for the stocks report. Mirrors the response from
 * GET /api/reports/stocks exactly. Cost fields (landedCostPerUnit,
 * landedCostValue, totalLandedCostValue) are intentionally optional: the
 * CostVisibilityInterceptor strips them for callers without costdata.view,
 * so the keys are absent in cost-blind responses and the UI renders only
 * what it has (never computes or infers cost).
 *
 * Market-side fields (currentMarketPrice, marketValue, totalMarketValue) are
 * NOT cost data and are present for all report.stocks holders.
 */

export type StocksBucketCounts = {
  ckd: number;
  inAssembly: number;
  cbu: number;
  sold: number;
  other: number;
  total: number;
};

export type StocksVariantRow = {
  productVariantId: string;
  sku: string;
  attributes: { model?: string; colour?: string; [k: string]: string | undefined };
  currentMarketPrice: string;
  counts: StocksBucketCounts;
  inStockCount: number;
  marketValue: string;
};

export type StocksSparePartItem = {
  id: string;
  sku: string;
  name: string;
  quantityOnHand: number;
  landedCostPerUnit?: string;
  landedCostValue?: string;
};

export type StocksSparePartsSection = {
  items: StocksSparePartItem[];
  totalLandedCostValue?: string;
};

export type StocksReport = {
  asOf: string;
  warehouseId: string | null;
  kpis: {
    totalUnits: number;
    totalVariants: number;
    totalMarketValue: string;
  };
  variants: StocksVariantRow[];
  spareParts: StocksSparePartsSection;
};

export type StocksReportQuery = {
  warehouseId?: string;
};

export async function getStocksReport(
  query: StocksReportQuery = {},
  signal?: AbortSignal,
): Promise<ApiResult<StocksReport>> {
  const qs = buildQuery({ warehouseId: query.warehouseId });
  return apiFetch<StocksReport>(`/api/reports/stocks${qs}`, { signal });
}

/**
 * Revenue report. The backend's recognition basis is
 * ReleaseAuthorisation.issuedAt (not SO.createdAt / dispatchedAt /
 * deliveredAt). All SOs that have ever been release-authorised in the
 * window are included, regardless of current status (PICKING through
 * CLOSED, including REFUNDED). Margin / landedCost / totalLandedCost
 * are absent (not null) on the response for users without costdata.view.
 */
export type RevenueReportVariantRow = {
  productVariantId: string;
  sku: string;
  unitsSold: number;
  revenue: string;
  landedCost?: string;
  margin?: string;
};

export type RevenueReportCustomerRow = {
  customerId: string;
  name: string;
  orders: number;
  revenue: string;
};

export type RevenueReportTrendPoint = {
  date: string;
  revenue: string;
  unitsSold: number;
};

export type RevenueReport = {
  from: string;
  to: string;
  recognitionBasis: string;
  totalRevenue: string;
  vatCollected: string;
  unitsSold: { total: number; ckd: number; cbu: number };
  revenueByVariant: RevenueReportVariantRow[];
  revenueByCustomer: RevenueReportCustomerRow[];
  trend: RevenueReportTrendPoint[];
  // Absent for users without costdata.view.
  margin?: {
    netRevenue: string;
    totalLandedCost: string;
    margin: string;
  };
};

export type RevenueReportQuery = {
  from?: string;
  to?: string;
  topN?: number;
};

export async function getRevenueReport(
  query: RevenueReportQuery = {},
  signal?: AbortSignal,
): Promise<ApiResult<RevenueReport>> {
  const qs = buildQuery({ from: query.from, to: query.to, topN: query.topN });
  return apiFetch<RevenueReport>(`/api/reports/revenue${qs}`, { signal });
}
