/**
 * Shared responsive class strings so the table column-tier rule, the filter
 * stacking, and the detail-grid collapse are identical on every screen rather
 * than re-derived per page. See RESPONSIVE.md for the standard.
 *
 * Column tiers (apply the SAME class to a column's paired <th> and <td>):
 *   Tier 1 (identity + status + primary metric): no class, always visible.
 *   Tier 2 (most useful secondary reference): COL.sm  -> reveal at sm (640).
 *   Tier 3 (dates, codes, secondary references): COL.md -> reveal at md (768).
 *   Tier 4 (tertiary metadata):                  COL.lg -> reveal at lg (1024).
 * Hidden columns are never dropped silently: the row links to its detail page,
 * which carries every field.
 */
export const COL = {
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
} as const;

/**
 * Filter form: vertical stack with full-width controls below sm, inline row at
 * sm+. Apply to the <form> wrapper; child controls get FILTER_CONTROL.
 */
export const FILTER_FORM =
  "flex flex-col sm:flex-row sm:items-end gap-3 sm:flex-wrap";
export const FILTER_CONTROL = "w-full sm:w-auto";

/**
 * Detail label/value grid: single column below sm, the existing two-column
 * label+value grid at sm+.
 */
export const DETAIL_GRID = "grid grid-cols-1 sm:grid-cols-[160px_1fr]";
