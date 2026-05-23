import { apiFetch, type ApiResult } from "./client";

/**
 * GET /api/products. Catalogue of products with nested variants. The frontend
 * uses this for the PO and SO line-item variant selects.
 *
 * Note (known backend gap, surfaced during prompt-4 frontend build):
 * the endpoint is currently gated on pricelist.read. Procurement Officer
 * (the role that creates POs in production) lacks pricelist.read and
 * therefore gets 403 here. IT Admin works via the wildcard grant. The proper
 * fix is in the backend (introduce a product.read permission decoupled from
 * pricelist.read, grant it to the roles that need to reference the catalogue,
 * and re-gate /api/products on it). Until that lands, the PO create form is
 * usable only by principals that hold pricelist.read.
 */

export type ProductCategory = "PASSENGER" | "CARGO";
export type ProductStatus = "ACTIVE" | "DISCONTINUED";

export type ProductVariantSummary = {
  id: string;
  supplierSkuCode: string;
  variantAttributes: { model?: string; colour?: string; [k: string]: string | undefined };
  currentMarketPrice: string;
  status: ProductStatus;
};

export type ProductWithVariants = {
  id: string;
  name: string;
  category: ProductCategory;
  manufacturer: { id: string; name: string; type: string };
  variants: ProductVariantSummary[];
};

export async function listProducts(
  signal?: AbortSignal,
): Promise<ApiResult<ProductWithVariants[]>> {
  return apiFetch<ProductWithVariants[]>(`/api/products`, { signal });
}

/**
 * Convenience: flatten products+variants into a select-friendly list, with the
 * variant's full display string (e.g. "TVS King GS+ G Yellow [GSP-G-YELLOW]").
 */
export function flattenVariantOptions(
  products: readonly ProductWithVariants[],
): {
  productVariantId: string;
  label: string;
  productName: string;
  attributes: ProductVariantSummary["variantAttributes"];
  currentMarketPrice: string;
}[] {
  const out: {
    productVariantId: string;
    label: string;
    productName: string;
    attributes: ProductVariantSummary["variantAttributes"];
    currentMarketPrice: string;
  }[] = [];
  for (const p of products) {
    for (const v of p.variants) {
      if (v.status !== "ACTIVE") continue;
      const attrs = [v.variantAttributes.model, v.variantAttributes.colour]
        .filter((x): x is string => typeof x === "string" && x.length > 0)
        .join(" ");
      const label = `${p.name}${attrs ? ` ${attrs}` : ""} [${v.supplierSkuCode}]`;
      out.push({
        productVariantId: v.id,
        label,
        productName: p.name,
        attributes: v.variantAttributes,
        currentMarketPrice: v.currentMarketPrice,
      });
    }
  }
  return out;
}
