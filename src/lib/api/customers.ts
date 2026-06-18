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

export async function getCustomer(
  id: string,
  signal?: AbortSignal,
): Promise<ApiResult<Customer>> {
  return apiFetch<Customer>(`/api/customers/${id}`, { signal });
}

/** Management (prompt 33-A); gated customer.manage server-side. */
export type CreateCustomerBody = {
  name: string;
  type: CustomerType;
  tierId?: string | null;
  phone?: string | null;
  email?: string | null;
  taxId?: string | null;
  address?: unknown;
};

export type UpdateCustomerBody = Partial<CreateCustomerBody> & {
  status?: CustomerStatus;
};

export async function createCustomer(
  body: CreateCustomerBody,
  signal?: AbortSignal,
): Promise<ApiResult<Customer>> {
  return apiFetch<Customer>("/api/customers", { method: "POST", body, signal });
}

export async function updateCustomer(
  id: string,
  body: UpdateCustomerBody,
  signal?: AbortSignal,
): Promise<ApiResult<Customer>> {
  return apiFetch<Customer>(`/api/customers/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body,
    signal,
  });
}

/**
 * Soft-delete. The backend rejects with 409 (conflict) when the customer has
 * active sales orders: { message: "Customer has N active sales order(s)..." }.
 * Callers surface that message and steer the user to Deactivate instead.
 */
export async function deleteCustomer(
  id: string,
  signal?: AbortSignal,
): Promise<ApiResult<Customer>> {
  return apiFetch<Customer>(`/api/customers/${encodeURIComponent(id)}`, {
    method: "DELETE",
    signal,
  });
}
