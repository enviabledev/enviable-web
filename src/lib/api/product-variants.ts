import { apiFetch, buildQuery, type ApiResult } from "./client";
import type { ProductStatus } from "./products";
import type { AutoCreateSource } from "@/lib/products/variant-classification";

/**
 * Product-variant management (prompt 33-B). Create and edit only; there is
 * deliberately NO delete endpoint. A variant that has ever been used is
 * referenced by units, sales-order lines and price-list entries, so a
 * hard-delete would almost never succeed and a soft-delete is
 * indistinguishable from deactivation. Deactivation is therefore
 * PATCH status=DISCONTINUED: it stops new use (the variant pickers filter to
 * ACTIVE) while every existing reference keeps resolving.
 *
 * Permission gates (mirroring the backend):
 *  - read   : product.read (the catalogue read, shared with the PO/SO pickers)
 *  - manage : productvariant.manage (create + edit + status)
 *
 * The SKU (supplierSkuCode) is the catalogue-wide stable identifier and is
 * IMMUTABLE: a PATCH that carries supplierSkuCode (or its `sku` alias) is
 * rejected by the backend with 400 and an explanatory message. The detail
 * screen renders the SKU read-only and never sends it on edit.
 */

export type VariantAttributesMap = {
  model?: string;
  colour?: string;
  [k: string]: string | undefined;
};

/** Full variant as returned by GET /api/product-variants/:id (with product). */
export type ProductVariant = {
  id: string;
  productId: string;
  supplierSkuCode: string;
  variantAttributes: VariantAttributesMap;
  currentMarketPrice: string;
  status: ProductStatus;
  createdAt?: string;
  updatedAt?: string;
  product: { id: string; name: string };
};

export type CreateProductVariantBody = {
  productId: string;
  supplierSkuCode: string;
  variantAttributes: VariantAttributesMap;
  currentMarketPrice: string;
  status?: ProductStatus;
};

/**
 * PATCH body. supplierSkuCode is intentionally absent: the SKU is immutable
 * and the screen never offers to change it.
 *
 * productId IS mutable: it carries the reclassification path, lifting an
 * auto-created variant off the "Pending Classification" sentinel product onto
 * its real product. The backend validates the target product exists (400 if
 * not). Gated productvariant.manage like the rest of variant management.
 */
export type UpdateProductVariantBody = {
  variantAttributes?: VariantAttributesMap;
  currentMarketPrice?: string;
  status?: ProductStatus;
  productId?: string;
};

/**
 * The structured body of a 409 with kind `similar-variant`, thrown by any
 * single-item supply-side caller (PO line create) when an incoming SKU is
 * suspiciously close to an existing ACTIVE variant and the caller did not
 * override. Shape confirmed live 2026-06-22:
 *   { statusCode, error, kind: "similar-variant", message, incomingSku,
 *     match: { id, supplierSkuCode, distance, reason } }
 */
export type SimilarVariantMatch = {
  id: string;
  supplierSkuCode: string;
  distance: number;
  reason: "edit-distance" | "shared-prefix" | string;
};

export type SimilarVariantConflict = {
  incomingSku: string;
  match: SimilarVariantMatch;
  message: string;
};

/**
 * Narrow a conflict body to the similar-variant shape, or null if it is some
 * other 409 (state-machine violation, duplicate, etc.). Lets a caller branch
 * on "open the SimilarityWarningModal" vs "show a generic conflict banner".
 */
export function parseSimilarVariantConflict(
  body: Record<string, unknown> | undefined,
): SimilarVariantConflict | null {
  if (!body || body.kind !== "similar-variant") return null;
  const match = body.match as Partial<SimilarVariantMatch> | undefined;
  if (
    !match ||
    typeof match.id !== "string" ||
    typeof match.supplierSkuCode !== "string"
  ) {
    return null;
  }
  return {
    incomingSku: typeof body.incomingSku === "string" ? body.incomingSku : "",
    match: {
      id: match.id,
      supplierSkuCode: match.supplierSkuCode,
      distance: typeof match.distance === "number" ? match.distance : 0,
      reason: typeof match.reason === "string" ? match.reason : "edit-distance",
    },
    message: typeof body.message === "string" ? body.message : "Similar variant found.",
  };
}

export async function getProductVariant(
  id: string,
  signal?: AbortSignal,
): Promise<ApiResult<ProductVariant>> {
  return apiFetch<ProductVariant>(
    `/api/product-variants/${encodeURIComponent(id)}`,
    { signal },
  );
}

/** Create. 400 when the product is unknown; 409 when the SKU already exists. */
export async function createProductVariant(
  body: CreateProductVariantBody,
  signal?: AbortSignal,
): Promise<ApiResult<ProductVariant>> {
  return apiFetch<ProductVariant>("/api/product-variants", {
    method: "POST",
    body,
    signal,
  });
}

export async function updateProductVariant(
  id: string,
  body: UpdateProductVariantBody,
  signal?: AbortSignal,
): Promise<ApiResult<ProductVariant>> {
  return apiFetch<ProductVariant>(
    `/api/product-variants/${encodeURIComponent(id)}`,
    { method: "PATCH", body, signal },
  );
}

/**
 * The auto-create provenance of a variant, read from the audit log (NOT a
 * column on the variant row, which has no createdById). Returned by
 * loadVariantAutoCreate when the variant was auto-created; null otherwise.
 */
export type VariantAutoCreate = {
  /** Display name of the actor who triggered the auto-create. */
  actorName: string | null;
  /** Actor user id from the audit context's triggeredBy. */
  triggeredBy: string | null;
  /** Supply-side flow: historical-load / po-line-create / shipment-receive. */
  source: AutoCreateSource | string | null;
  /** The source entity id (shipment id, PO id, ...) where it originated. */
  sourceEntityId: string | null;
  /** Whether the similarity gate ran (false when override was used). */
  similarityChecked: boolean | null;
  /** When the auto-create happened (audit occurredAt, ISO string). */
  occurredAt: string | null;
};

type RawAuditEntry = {
  actor: { id: string; fullName: string } | null;
  occurredAt: string;
  context: unknown;
};

/**
 * Resolve a variant's auto-create provenance from the audit log. The only
 * source of "who created this auto-created variant" is the audit entry with
 * action `productvariant.autocreate` whose entityId is this variant id; the
 * variant row itself carries no creator. Returns null when no such entry
 * exists (the variant was created the normal way, or the audit is unreachable).
 *
 * audit.read gates this endpoint; a caller without it gets `forbidden` and
 * should fall back to the productId === sentinel signal for the callout.
 */
export async function loadVariantAutoCreate(
  variantId: string,
  signal?: AbortSignal,
): Promise<ApiResult<VariantAutoCreate | null>> {
  const qs = buildQuery({
    action: "productvariant.autocreate",
    entityId: variantId,
    pageSize: 25,
  });
  const r = await apiFetch<{ data: RawAuditEntry[] }>(
    `/api/reports/audit-log${qs}`,
    { signal },
  );
  if (r.kind !== "ok") return r;
  const entry = r.data.data[0];
  if (!entry) return { kind: "ok", data: null };
  const ctx = (entry.context ?? {}) as {
    source?: string;
    sourceEntityId?: string | null;
    triggeredBy?: string | null;
    similarityChecked?: boolean;
  };
  return {
    kind: "ok",
    data: {
      actorName: entry.actor?.fullName ?? null,
      triggeredBy: ctx.triggeredBy ?? entry.actor?.id ?? null,
      source: ctx.source ?? null,
      sourceEntityId: ctx.sourceEntityId ?? null,
      similarityChecked:
        typeof ctx.similarityChecked === "boolean" ? ctx.similarityChecked : null,
      occurredAt: entry.occurredAt ?? null,
    },
  };
}
