/**
 * Types mirroring the backend's API shapes. Source of truth is the running API
 * (per CLAUDE.md): if these drift from what /api/* returns, the API wins.
 *
 * Enum literals are pinned to the prisma schema's UnitStatus, MovementType,
 * and MovementReferenceType. landedCost is intentionally optional throughout:
 * the backend's CostVisibilityInterceptor strips the field for principals
 * lacking costdata.view, so callers without the permission simply do not see
 * the key. The frontend renders what it has and never infers.
 */

export const UNIT_STATUS = [
  "IN_TRANSIT",
  "IN_WAREHOUSE_CKD",
  "IN_ASSEMBLY",
  "IN_WAREHOUSE_CBU",
  "SOLD_AS_CKD",
  "SOLD_AS_CBU",
  "DAMAGED",
  "IN_REPAIR",
  "DEMO",
  "INTERNAL_USE",
  "TRANSFERRED",
  "RETURNED",
  "WRITTEN_OFF",
] as const;
export type UnitStatus = (typeof UNIT_STATUS)[number];

export const MOVEMENT_TYPE = [
  "RECEIPT",
  "ASSEMBLY_START",
  "ASSEMBLY_COMPLETE",
  "SALE",
  "RETURN",
  "DAMAGE",
  "WRITE_OFF",
  "DEMO",
  "INTERNAL_USE",
  "TRANSFER",
  "REPAIR_IN",
  "REPAIR_OUT",
  "RESTOCK_FROM_REPAIR",
  "ADJUSTMENT",
] as const;
export type MovementType = (typeof MOVEMENT_TYPE)[number];

export const MOVEMENT_REFERENCE_TYPE = [
  "SHIPMENT",
  "SALES_ORDER",
  "ASSEMBLY_JOB",
  "RETURN",
  "ADJUSTMENT",
  "TRANSFER",
] as const;
export type MovementReferenceType = (typeof MOVEMENT_REFERENCE_TYPE)[number];

export type VariantAttributes = {
  model?: string;
  colour?: string;
  [key: string]: string | undefined;
};

export type UnitListVariant = {
  id: string;
  supplierSkuCode: string;
  variantAttributes: VariantAttributes;
};

export type UnitListRow = {
  id: string;
  engineNumber: string;
  chassisNumber: string;
  status: UnitStatus;
  createdAt: string;
  currentWarehouseId: string | null;
  landedCost?: string;
  productVariant: UnitListVariant;
};

export type PaginatedResponse<T> = {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
};

export type UnitListResponse = PaginatedResponse<UnitListRow>;

export type UnitDetailVariant = UnitListVariant & {
  product: { id: string; name: string };
};

export type UnitDetailShipment = {
  id: string;
  shipmentReference: string;
  status: string;
  isHistoricalImport: boolean;
};

export type UnitDetailWarehouse = {
  id: string;
  name: string;
};

export type StockMovementActor = {
  id: string;
  fullName: string;
};

export type StockMovementEntry = {
  id: string;
  movementType: MovementType;
  // The schema stores these as String (not enum); values typically mirror
  // UnitStatus but the column type does not constrain them.
  fromState: string | null;
  toState: string | null;
  fromWarehouseId: string | null;
  toWarehouseId: string | null;
  referenceType: MovementReferenceType | null;
  referenceId: string | null;
  occurredAt: string;
  notes: string | null;
  actor: StockMovementActor;
};

export type UnitDetail = {
  id: string;
  engineNumber: string;
  chassisNumber: string;
  status: UnitStatus;
  createdAt: string;
  assembledAt: string | null;
  soldAt: string | null;
  currentWarehouseId: string | null;
  landedCost?: string;
  productVariant: UnitDetailVariant;
  shipment: UnitDetailShipment | null;
  currentWarehouse: UnitDetailWarehouse | null;
  movements: StockMovementEntry[];
};

export type UnitListQuery = {
  page?: number;
  pageSize?: 25 | 50 | 100 | 250;
  variantId?: readonly string[];
  status?: readonly UnitStatus[];
  warehouseId?: string;
  receivedFrom?: string;
  receivedTo?: string;
  search?: string;
};
