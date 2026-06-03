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

/**
 * Customers report. Per-customer aggregations over the optional date window
 * (from/to scope SO.createdAt, gte/lt). Customers are listed regardless of
 * in-range activity (the customer base stays visible); the tier and status
 * filters narrow the customer SET, while the date range narrows the order
 * metrics within each visible row.
 *
 * Outstanding balance is a sales/AR figure (NOT cost data) and is visible to
 * all report.customers holders. There is no cost gating on this report.
 *
 * totalOrderValue counts ONLY orders that have a ReleaseAuthorisation row
 * (the same "released" set the revenue report uses); orders in earlier
 * statuses contribute to totalOrders and lastOrderDate but not totalOrderValue.
 */
export type CustomersReportTierSummary = { id: string; name: string };

export type CustomersReportRow = {
  customerId: string;
  name: string;
  type: string;
  status: string;
  tier: CustomersReportTierSummary | null;
  totalOrders: number;
  totalOrderValue: string;
  lastOrderDate: string | null;
  outstandingBalance: string;
};

export type CustomersReportResponse = {
  data: CustomersReportRow[];
  page: number;
  pageSize: number;
  total: number;
};

export type CustomersReportQuery = {
  page?: number;
  pageSize?: number;
  tierId?: string;
  status?: string;
  from?: string;
  to?: string;
};

export async function getCustomersReport(
  query: CustomersReportQuery = {},
  signal?: AbortSignal,
): Promise<ApiResult<CustomersReportResponse>> {
  const qs = buildQuery({
    page: query.page,
    pageSize: query.pageSize,
    tierId: query.tierId,
    status: query.status,
    from: query.from,
    to: query.to,
  });
  return apiFetch<CustomersReportResponse>(`/api/reports/customers${qs}`, { signal });
}

/**
 * Audit log. The system of record (Invariant I-10: rows immutable, append-
 * only). @SkipCostStrip on the controller: the audit log returns COMPLETE
 * records (including cost data in afterState) to every audit.read holder.
 * Privacy comes from gating audit.read narrowly, not from sanitising rows.
 * Reads of the audit log are themselves NOT audited (no recursion).
 *
 * occurredFrom / occurredTo are inclusive bounds on occurredAt (not gte/lt
 * like the other reports). beforeState / afterState are full JSON snapshots
 * of the entity at the moment of the action, or null for create/delete
 * polarity. context carries the HTTP method, path, query, and route params
 * (the request envelope at audit time).
 */
export type AuditLogActor = { id: string; fullName: string };

export type AuditLogEntry = {
  id: string;
  actor: AuditLogActor | null;
  action: string;
  entityType: string;
  entityId: string | null;
  occurredAt: string;
  context: unknown;
  beforeState: unknown;
  afterState: unknown;
};

export type AuditLogResponse = {
  data: AuditLogEntry[];
  page: number;
  pageSize: number;
  total: number;
};

export type AuditLogStats = {
  totalCount: number;
  distinctActors: number;
  actions: { action: string; count: number }[];
};

export type AuditLogQuery = {
  page?: number;
  pageSize?: number;
  actorUserId?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  occurredFrom?: string;
  occurredTo?: string;
};

export async function getAuditLog(
  query: AuditLogQuery = {},
  signal?: AbortSignal,
): Promise<ApiResult<AuditLogResponse>> {
  const qs = buildQuery({
    page: query.page,
    pageSize: query.pageSize,
    actorUserId: query.actorUserId,
    action: query.action,
    entityType: query.entityType,
    entityId: query.entityId,
    occurredFrom: query.occurredFrom,
    occurredTo: query.occurredTo,
  });
  return apiFetch<AuditLogResponse>(`/api/reports/audit-log${qs}`, { signal });
}

export async function getAuditLogStats(
  query: AuditLogQuery = {},
  signal?: AbortSignal,
): Promise<ApiResult<AuditLogStats>> {
  const qs = buildQuery({
    actorUserId: query.actorUserId,
    action: query.action,
    entityType: query.entityType,
    entityId: query.entityId,
    occurredFrom: query.occurredFrom,
    occurredTo: query.occurredTo,
  });
  return apiFetch<AuditLogStats>(`/api/reports/audit-log/stats${qs}`, { signal });
}
