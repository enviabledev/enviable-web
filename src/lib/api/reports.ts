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
