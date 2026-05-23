import { apiFetch, buildQuery, type ApiResult } from "./client";

export type CustomerType = "RESELLER" | "END_USER";
export type CustomerStatus = "ACTIVE" | "INACTIVE";

export type CustomerTierSummary = {
  id: string;
  name: string;
  status: string;
};

export type Customer = {
  id: string;
  name: string;
  type: CustomerType;
  tierId: string | null;
  phone: string | null;
  email: string | null;
  taxId: string | null;
  address: unknown;
  status: CustomerStatus;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  tier: CustomerTierSummary | null;
};

export type CustomerListResponse = {
  data: Customer[];
  page: number;
  pageSize: number;
  total: number;
};

export type CustomerListQuery = {
  page?: number;
  pageSize?: number;
  type?: CustomerType;
  status?: CustomerStatus;
  tierId?: string;
  search?: string;
};

export async function listCustomers(
  query: CustomerListQuery = {},
  signal?: AbortSignal,
): Promise<ApiResult<CustomerListResponse>> {
  const qs = buildQuery({
    page: query.page,
    pageSize: query.pageSize,
    type: query.type,
    status: query.status,
    tierId: query.tierId,
    search: query.search,
  });
  return apiFetch<CustomerListResponse>(`/api/customers${qs}`, { signal });
}
