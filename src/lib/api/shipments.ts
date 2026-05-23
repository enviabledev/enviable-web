import { apiFetch, buildQuery, type ApiResult } from "./client";

/**
 * Types mirroring the Enviable backend's Shipment endpoints. Source of truth
 * is the running API. Money fields are Decimal strings; dates are ISO strings.
 *
 * State machine (linear, no skipping):
 *   IN_TRANSIT -> AT_PORT -> CLEARING -> CLEARED -> RECEIVED -> CLOSED
 *
 * RECEIVED and CLOSED transitions are only reachable through dedicated action
 * endpoints (completeReceipt, close); they cannot be set via PATCH. Earlier
 * states (AT_PORT/CLEARING/CLEARED) can be reached via PATCH but the create
 * + status-progression UI is out of scope for prompt 5.
 */

export const SHIPMENT_STATUS = [
  "IN_TRANSIT",
  "AT_PORT",
  "CLEARING",
  "CLEARED",
  "RECEIVED",
  "CLOSED",
] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUS)[number];

export type ShipmentCounterparty = {
  id: string;
  name: string;
  type: string;
};

export type ManifestLine = {
  id: string;
  shipmentId: string;
  productVariantId: string;
  quantityDeclared: number;
  quantityReceived: number;
  variance: number;
  varianceReason: string | null;
  varianceResolvedAt: string | null;
};

export type ShipmentUnit = {
  id: string;
  engineNumber: string;
  status: string;
  landedCost?: string;
};

export type ShipmentListRow = {
  id: string;
  purchaseOrderId: string;
  shipmentReference: string;
  billOfLadingNumber: string | null;
  vesselName: string | null;
  etd: string | null;
  eta: string | null;
  arrivalDate: string | null;
  clearingStartedAt: string | null;
  clearedAt: string | null;
  receivedAt: string | null;
  status: ShipmentStatus;
  freightForwarderId: string | null;
  clearingAgentId: string | null;
  insuranceCompanyId: string | null;
  isHistoricalImport: boolean;
  createdAt: string;
  updatedAt: string;
  manifestLines: ManifestLine[];
};

export type ShipmentDetail = ShipmentListRow & {
  freightForwarder: ShipmentCounterparty | null;
  clearingAgent: ShipmentCounterparty | null;
  insuranceCompany: ShipmentCounterparty | null;
  units: ShipmentUnit[];
};

export type ShipmentListQuery = {
  status?: ShipmentStatus;
  purchaseOrderId?: string;
};

export type ReceiveUnitPair = {
  engineNumber: string;
  chassisNumber: string;
};

export type ReceiveUnitsBody = {
  lines: { manifestLineId: string; units: ReceiveUnitPair[] }[];
};

export type ResolveVarianceBody = {
  lines: { manifestLineId: string; varianceReason: string }[];
};

export async function listShipments(
  query: ShipmentListQuery = {},
  signal?: AbortSignal,
): Promise<ApiResult<ShipmentListRow[]>> {
  const qs = buildQuery({ status: query.status, purchaseOrderId: query.purchaseOrderId });
  return apiFetch<ShipmentListRow[]>(`/api/shipments${qs}`, { signal });
}

export async function getShipment(
  id: string,
  signal?: AbortSignal,
): Promise<ApiResult<ShipmentDetail>> {
  return apiFetch<ShipmentDetail>(`/api/shipments/${encodeURIComponent(id)}`, { signal });
}

export async function receiveUnits(
  shipmentId: string,
  body: ReceiveUnitsBody,
  signal?: AbortSignal,
): Promise<ApiResult<ShipmentDetail>> {
  return apiFetch<ShipmentDetail>(
    `/api/shipments/${encodeURIComponent(shipmentId)}/receive-units`,
    { method: "POST", body, signal },
  );
}

export async function resolveVariance(
  shipmentId: string,
  body: ResolveVarianceBody,
  signal?: AbortSignal,
): Promise<ApiResult<ShipmentDetail>> {
  return apiFetch<ShipmentDetail>(
    `/api/shipments/${encodeURIComponent(shipmentId)}/resolve-variance`,
    { method: "POST", body, signal },
  );
}

export async function completeReceipt(
  shipmentId: string,
  signal?: AbortSignal,
): Promise<ApiResult<ShipmentDetail>> {
  return apiFetch<ShipmentDetail>(
    `/api/shipments/${encodeURIComponent(shipmentId)}/complete-receipt`,
    { method: "POST", body: {}, signal },
  );
}

export async function closeShipment(
  shipmentId: string,
  signal?: AbortSignal,
): Promise<ApiResult<ShipmentDetail>> {
  return apiFetch<ShipmentDetail>(
    `/api/shipments/${encodeURIComponent(shipmentId)}/close`,
    { method: "POST", body: {}, signal },
  );
}

export const SHIPMENT_LEGAL_TRANSITIONS: Readonly<Record<ShipmentStatus, readonly ShipmentStatus[]>> = {
  IN_TRANSIT: ["AT_PORT"],
  AT_PORT: ["CLEARING"],
  CLEARING: ["CLEARED"],
  CLEARED: ["RECEIVED"],
  RECEIVED: ["CLOSED"],
  CLOSED: [],
};

export function shipmentCanTransitionTo(from: ShipmentStatus, to: ShipmentStatus): boolean {
  return SHIPMENT_LEGAL_TRANSITIONS[from].includes(to);
}

export function shipmentHasUnresolvedVariance(lines: readonly ManifestLine[]): boolean {
  return lines.some((l) => l.variance !== 0 && l.varianceResolvedAt === null);
}
