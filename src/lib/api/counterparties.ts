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

export async function listCounterparties(
  query: { type?: CounterpartyType; status?: CounterpartyStatus } = {},
  signal?: AbortSignal,
): Promise<ApiResult<Counterparty[]>> {
  const qs = buildQuery({ type: query.type, status: query.status });
  return apiFetch<Counterparty[]>(`/api/counterparties${qs}`, { signal });
}
