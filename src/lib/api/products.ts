import { apiFetch, type ApiResult } from "./client";

/**
 * GET /api/products. Catalogue of products with nested variants. The frontend
 * uses this for the PO and SO line-item variant selects.
 *
 * Permission gate: `product.read`. The catalogue read is deliberately
 * decoupled from pricing read; do not collapse these back into one
 * permission.
 *
 * History (the reasoning behind the decomposition, recorded so it isn't
 * later "simplified" away):
 *
 * The catalogue read was originally gated on `pricelist.read`, which the
 * Procurement Officer role (the role that creates POs in production)
 * does not hold. That caused Procurement Officers to get 403 on this
 * endpoint and therefore be unable to populate the variant select on the
 * PO create form, the very screen their job revolves around. IT Admin
 * passed only because of the `*` wildcard grant; no production role
 * could.
 *
 * That was a permission-model defect, not a frontend workaround
 * opportunity: catalogue identity (which products exist) is not the
 * same kind of data as pricing (what those products cost), and gating
 * both behind a single permission conflated them. The backend was
 * changed to introduce a dedicated `product.read` permission, granted
 * to every role that legitimately needs to reference the catalogue
 * (Procurement Officer, the Sales and Warehouse roles, etc.), and the
 * guard on this endpoint was switched to `product.read`. `pricelist.read`
 * continues to gate the actual price-list endpoints, which carry the
 * sensitive pricing data. Catalogue identity and pricing sensitivity
 * are different concerns; the permissions reflect that.
 *
 * If a future change considers merging `product.read` and
 * `pricelist.read` back into one permission for simplicity, the merge
 * is a regression. The Procurement Officer must keep catalogue read
 * without gaining pricing read.
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
