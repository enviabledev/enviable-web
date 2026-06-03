import { apiFetch, buildQuery, type ApiResult } from "./client";

export type CounterpartyType =
  | "MANUFACTURER"
  | "SUPPLIER"
  | "CLEARING_AGENT"
  | "FREIGHT_FORWARDER"
  | "INSURANCE_COMPANY"
  | "BANK";

export type CounterpartyStatus = "ACTIVE" | "INACTIVE";

export type Counterparty = {
  id: string;
  name: string;
  type: CounterpartyType;
  contact: unknown;
  bankDetails: unknown;
  status: CounterpartyStatus;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export const COUNTERPARTY_TYPE = [
  "MANUFACTURER",
  "SUPPLIER",
  "CLEARING_AGENT",
  "FREIGHT_FORWARDER",
  "INSURANCE_COMPANY",
  "BANK",
] as const;

export const COUNTERPARTY_STATUS = ["ACTIVE", "INACTIVE"] as const;

export type CreateCounterpartyBody = {
  name: string;
  type: CounterpartyType;
  status?: CounterpartyStatus;
  contact?: Record<string, unknown>;
  bankDetails?: Record<string, unknown>;
};

export type UpdateCounterpartyBody = Partial<CreateCounterpartyBody>;

export async function listCounterparties(
  query: { type?: CounterpartyType; status?: CounterpartyStatus } = {},
  signal?: AbortSignal,
): Promise<ApiResult<Counterparty[]>> {
  const qs = buildQuery({ type: query.type, status: query.status });
  return apiFetch<Counterparty[]>(`/api/counterparties${qs}`, { signal });
}

export async function getCounterparty(
  id: string,
  signal?: AbortSignal,
): Promise<ApiResult<Counterparty>> {
  return apiFetch<Counterparty>(`/api/counterparties/${encodeURIComponent(id)}`, { signal });
}

export async function createCounterparty(
  body: CreateCounterpartyBody,
  signal?: AbortSignal,
): Promise<ApiResult<Counterparty>> {
  return apiFetch<Counterparty>("/api/counterparties", {
    method: "POST",
    body,
    signal,
  });
}

export async function updateCounterparty(
  id: string,
  body: UpdateCounterpartyBody,
  signal?: AbortSignal,
): Promise<ApiResult<Counterparty>> {
  return apiFetch<Counterparty>(`/api/counterparties/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body,
    signal,
  });
}

export async function deleteCounterparty(
  id: string,
  signal?: AbortSignal,
): Promise<ApiResult<Counterparty>> {
  return apiFetch<Counterparty>(`/api/counterparties/${encodeURIComponent(id)}`, {
    method: "DELETE",
    signal,
  });
}
