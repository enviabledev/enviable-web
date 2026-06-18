/**
 * Read-mirror types. Aligned exactly with enviable-system/src/sync/sync-pull.service.ts
 * so the response shape passes through without translation. Keep ENTITY_TYPES
 * in step with the backend's ALL_TYPES (the scope= filter accepts these names).
 */

export const ENTITY_TYPES = [
  // Reference data (small, full per window)
  "product",
  "productVariant",
  "customerTier",
  "priceListEntry",
  "counterparty",
  "paymentMethod",
  "warehouse",
  "customer",
  "sparePart",
  // Minimal user directory (id + fullName), for offline staff attribution
  // (e.g. assembly-job supervisor names). The backend emits a non-sensitive
  // subset only; no auth artifact, see principal-cache for the credential rule.
  "user",
  // Role catalogue (id, name, description, isSystemRole + permission keys via
  // rolePermissions[].permission.key). Note the mirror shape carries permission
  // KEYS only; the API GET /api/roles carries the full {id,key,description,
  // category} for category-grouped rendering. Mirror-first paint shows the
  // role + its keys; the network revalidate fills in descriptions/categories.
  "role",
  // Procurement
  "purchaseOrder",
  "purchaseOrderLine",
  "letterOfCredit",
  "proformaInvoice",
  "proformaInvoiceLine",
  "shipment",
  "manifestLine",
  "landedCost",
  "forwarderInvoice",
  // Sales
  "salesOrder",
  "salesOrderLine",
  "invoice",
  "payment",
  "releaseAuthorisation",
  // Movements + audit (report inputs, the prompt-12 additions)
  "stockMovement",
  "sparePartMovement",
  "auditLogEntry",
  // Inventory workflow (prompt-13 addition). NOTE: the backend sync-pull's
  // ALL_TYPES does not yet emit assemblyJob, so this bucket is empty until
  // that backend change ships. The downloader tolerates the missing
  // referenceData key (ref[refKey] ?? []); once the backend includes it,
  // assembly-job offline reads light up with zero further frontend change.
  "assemblyJob",
  // Large set, paged
  "unit",
] as const;

export type EntityType = (typeof ENTITY_TYPES)[number];

/**
 * The 21 reference-data buckets the server returns under `referenceData`.
 * Each key is the plural-camelCase, each value is an array of full entity
 * rows. The shape mirrors the backend's `referenceDelta` return exactly so
 * the client never has to remap. Cost-bearing entities (Unit, etc.) have
 * `landedCost` stripped server-side by the global cost interceptor (I-8),
 * so a non-cost user's mirror simply has no cost data; this is the
 * absence-not-stripping pattern.
 */
export type ReferenceData = {
  products: unknown[];
  productVariants: unknown[];
  customerTiers: unknown[];
  priceListEntries: unknown[];
  counterparties: unknown[];
  paymentMethods: unknown[];
  warehouses: unknown[];
  customers: unknown[];
  spareParts: unknown[];
  users: unknown[];
  roles: unknown[];
  purchaseOrders: unknown[];
  purchaseOrderLines: unknown[];
  lettersOfCredit: unknown[];
  proformaInvoices: unknown[];
  proformaInvoiceLines: unknown[];
  shipments: unknown[];
  manifestLines: unknown[];
  landedCosts: unknown[];
  forwarderInvoices: unknown[];
  salesOrders: unknown[];
  salesOrderLines: unknown[];
  invoices: unknown[];
  payments: unknown[];
  releaseAuthorisations: unknown[];
  stockMovements: unknown[];
  sparePartMovements: unknown[];
  auditLogEntries: unknown[];
  assemblyJobs: unknown[];
};

/** Map from reference-data plural key to its singular EntityType. */
export const REF_KEY_TO_ENTITY: Record<keyof ReferenceData, EntityType> = {
  products: "product",
  productVariants: "productVariant",
  customerTiers: "customerTier",
  priceListEntries: "priceListEntry",
  counterparties: "counterparty",
  paymentMethods: "paymentMethod",
  warehouses: "warehouse",
  customers: "customer",
  spareParts: "sparePart",
  users: "user",
  roles: "role",
  purchaseOrders: "purchaseOrder",
  purchaseOrderLines: "purchaseOrderLine",
  lettersOfCredit: "letterOfCredit",
  proformaInvoices: "proformaInvoice",
  proformaInvoiceLines: "proformaInvoiceLine",
  shipments: "shipment",
  manifestLines: "manifestLine",
  landedCosts: "landedCost",
  forwarderInvoices: "forwarderInvoice",
  salesOrders: "salesOrder",
  salesOrderLines: "salesOrderLine",
  invoices: "invoice",
  payments: "payment",
  releaseAuthorisations: "releaseAuthorisation",
  stockMovements: "stockMovement",
  sparePartMovements: "sparePartMovement",
  auditLogEntries: "auditLogEntry",
  assemblyJobs: "assemblyJob",
};

export type PullMode = "since" | "windowed";

export type PullResponse = {
  mode: PullMode;
  window: { from: string; to: string };
  since: string;
  serverTime: string;
  nextSince: string;
  truncated: boolean;
  cursor: string | null;
  referenceData: ReferenceData;
  units: Array<{
    id: string;
    updatedAt: string;
    [k: string]: unknown;
  }>;
};

/**
 * One row in the mirror_records IDB store. Compound key [entityType, id]
 * means each (type, id) is one row; upsert by put. body holds the entity
 * verbatim as the server sent it (post-I-8 strip if applicable).
 *
 * mirroredAt is the wall-clock time the row was written into the mirror,
 * used by the freshness UI to disclose "cached as of N min ago." Distinct
 * from updatedAt (the server-side modification time keyed by the mirror
 * spine).
 */
export type MirrorRecord = {
  entityType: EntityType;
  id: string;
  updatedAt: string;
  mirroredAt: string;
  body: Record<string, unknown>;
};

/**
 * Watermark + freshness state, stored as a single meta row at key
 * MIRROR_WATERMARK_KEY. The download walks 7-day windows oldest-to-newest:
 *   nextWindowFrom    The `from` for the NEXT window to download. Advances
 *                     to current `window.to` after each successful atomic
 *                     commit. When it crosses `historyTargetTo`, history is
 *                     complete and the reconciler takes over.
 *   historyTargetTo   The exclusive upper bound of the historical pull
 *                     range (typically the time the history download
 *                     started). Reconciler picks up from here as the
 *                     initial `since`.
 *   reconcilerSince   Anchor for the ongoing since-delta. Initialized to
 *                     historyTargetTo, then advanced to nextSince from each
 *                     successful reconcile.
 *   lastSyncAt        Wall-clock time of the most recent successful pull
 *                     (download or reconcile). Drives the freshness badge.
 *   historyComplete   Cached flag: true once nextWindowFrom >= historyTargetTo.
 */
export type MirrorWatermark = {
  nextWindowFrom: string;
  historyTargetTo: string;
  reconcilerSince: string;
  lastSyncAt: string | null;
  historyComplete: boolean;
};
