import { apiFetch, type ApiResult } from "./client";
import type { ProductStatus } from "./products";

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
 */
export type UpdateProductVariantBody = {
  variantAttributes?: VariantAttributesMap;
  currentMarketPrice?: string;
  status?: ProductStatus;
};

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
