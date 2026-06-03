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

/**
 * Movements list row. Same shape as StockMovementEntry, plus the unit summary
 * needed to render the cross-unit list (engine number). Backed by
 * GET /api/stock-movements which selects unit { id, engineNumber } and
 * actor { id, fullName } on every row.
 */
export type StockMovementListRow = {
  id: string;
  unitId: string;
  movementType: MovementType;
  fromState: string | null;
  toState: string | null;
  fromWarehouseId: string | null;
  toWarehouseId: string | null;
  referenceType: MovementReferenceType | null;
  referenceId: string | null;
  occurredAt: string;
  notes: string | null;
  actor: StockMovementActor;
  unit: { id: string; engineNumber: string };
};

export type StockMovementListResponse = PaginatedResponse<StockMovementListRow>;

export type StockMovementListQuery = {
  page?: number;
  pageSize?: 10 | 25 | 50 | 100;
  unitId?: string;
  movementType?: MovementType;
  actorId?: string;
  occurredFrom?: string;
  occurredTo?: string;
};

/**
 * Spare-part movement, embedded inside the spare-part detail (no standalone
 * list endpoint on the backend, but the sparePartMovement bucket lands in the
 * mirror via /api/sync/pull, so we render the movements tab from the mirror).
 */
export const SPARE_PART_MOVEMENT_TYPE = ["RECEIPT", "ADJUSTMENT"] as const;
export type SparePartMovementType = (typeof SPARE_PART_MOVEMENT_TYPE)[number];

export type SparePartMovementListRow = {
  id: string;
  sparePartId: string;
  movementType: SparePartMovementType;
  quantity: number;
  referenceType: MovementReferenceType | null;
  referenceId: string | null;
  occurredAt: string;
  notes: string | null;
  actorId: string | null;
};

/**
 * Spare-part catalogue. The backend's SparePart model has a STORED
 * quantityOnHand field that the historical-load service updates in the
 * same transaction as the SparePartMovement write, so this is not
 * computed-from-movements: the frontend renders the stored value
 * directly from the mirror.
 *
 * landedCostPerUnit is cost-gated by the backend's CostVisibilityInterceptor;
 * the property is absent on the response (and on the mirror row) for users
 * without costdata.view. Render with optional-chain access; never read with
 * a non-null assertion.
 */
export const SPARE_PART_STATUS = ["ACTIVE", "DISCONTINUED"] as const;
export type SparePartStatus = (typeof SPARE_PART_STATUS)[number];

export type SparePartListRow = {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  quantityOnHand: number;
  landedCostPerUnit?: string;
  status: SparePartStatus;
};

export type SparePartListResponse = PaginatedResponse<SparePartListRow>;

export type SparePartListQuery = {
  page?: number;
  pageSize?: 25 | 50 | 100 | 250;
  status?: SparePartStatus;
  search?: string;
};

export type SparePartMovementEntry = {
  id: string;
  movementType: SparePartMovementType;
  quantity: number;
  referenceType: MovementReferenceType | null;
  referenceId: string | null;
  occurredAt: string;
  notes: string | null;
  actor: { id: string; fullName: string } | null;
};

export type SparePartDetail = SparePartListRow & {
  movements: SparePartMovementEntry[];
};

/**
 * Price-list entry. The backend models prices as tier-bound and temporal:
 *   - One row per (productVariantId, customerTierId, effectiveWindow).
 *   - effectiveTo IS NULL identifies the currently-active price for that
 *     (variant, tier) tuple; rows with effectiveTo set are history.
 *   - The I-5 invariant ("one active price per variant+tier") is enforced
 *     by a partial unique index plus a transactional close+open in
 *     pricing.service.ts setPrice(); a concurrent supersede returns
 *     HTTP 409 with the canonical message.
 *
 * The price field is the SELLING price, not cost data, so it is visible to
 * all users with pricelist.read; no costdata.view gating here.
 */
export type PriceListVariantSummary = {
  id: string;
  supplierSkuCode: string;
};

export type PriceListTierSummary = {
  id: string;
  name: string;
};

export type PriceListEntry = {
  id: string;
  productVariantId: string;
  customerTierId: string;
  price: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  setById: string | null;
  updatedAt: string;
  productVariant: PriceListVariantSummary;
  customerTier: PriceListTierSummary;
};

export type PriceListQuery = {
  variantId?: string;
  tierId?: string;
  includeClosed?: boolean;
};

export type SetPriceBody = {
  productVariantId: string;
  customerTierId: string;
  price: string;
};

/**
 * Proforma invoices. Each PI is bound to exactly one PO via purchaseOrderId;
 * a PO can have multiple PIs across revisions (revisionNumber) but the I-5
 * invariant forbids more than one ACTIVE PI per PO (partial unique index
 * `one_active_pi_per_po`). Approving a PI atomically supersedes any prior
 * ACTIVE PI on the same PO. Permissions: pi.read for view, pi.review for
 * create/approve/reject.
 */
export const PROFORMA_INVOICE_STATUS = [
  "PENDING_REVIEW",
  "ACTIVE",
  "SUPERSEDED",
  "REJECTED",
] as const;
export type ProformaInvoiceStatus = (typeof PROFORMA_INVOICE_STATUS)[number];

export type ProformaInvoiceLine = {
  id: string;
  proformaInvoiceId: string;
  productVariantId: string;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
  updatedAt: string;
};

export type ProformaInvoicePoSummary = {
  id: string;
  poNumber: string;
  status: string;
  supplierId: string;
};

export type ProformaInvoice = {
  id: string;
  piNumber: string;
  purchaseOrderId: string;
  revisionNumber: number;
  status: ProformaInvoiceStatus;
  approvedById: string | null;
  approvedAt: string | null;
  totalValue: string;
  freightAmount: string;
  insuranceAmount: string;
  issueDate: string | null;
  validityUntil: string | null;
  paymentTerms: string | null;
  portOfLoading: string | null;
  portOfDischarge: string | null;
  rawDocumentId: string | null;
  createdAt: string;
  updatedAt: string;
  lines: ProformaInvoiceLine[];
  purchaseOrder: ProformaInvoicePoSummary;
};

export type CreateProformaInvoiceLine = {
  productVariantId: string;
  quantity: number;
  unitPrice: string;
};

export type CreateProformaInvoiceBody = {
  piNumber: string;
  issueDate?: string;
  validityUntil?: string;
  freightAmount?: string;
  insuranceAmount?: string;
  paymentTerms?: string;
  portOfLoading?: string;
  portOfDischarge?: string;
  lines: CreateProformaInvoiceLine[];
};
