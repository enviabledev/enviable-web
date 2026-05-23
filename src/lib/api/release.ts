import { apiFetch, type ApiResult } from "./client";
import type { SalesOrderDetail } from "./sales-orders";

/**
 * Authorise release. The I-4 defence lives in this endpoint: inside the
 * release transaction the server re-aggregates SUM(payments WHERE
 * status=CONFIRMED) and compares against SO.total, REGARDLESS of the SO's
 * status flag. If the real confirmed sum is below the total, the server
 * throws a 409 with the exact message:
 *
 *   "Invariant I-4: confirmed payments (<sum>) do not cover the order
 *    total (<total>). Release refused."
 *
 * This protects against a status that's been desynced by another path
 * (e.g. a bad migration, a status patch from somewhere else). The status
 * is a hint; the payment sum is the truth.
 *
 * On success, every allocated unit on the SO transitions to SOLD_AS_CKD or
 * SOLD_AS_CBU via transitionUnit with a SALE StockMovement; soldAt is set;
 * the SO advances to RELEASE_AUTHORISED. The response is the updated SO
 * with units now in SOLD state.
 */
export async function authoriseRelease(
  salesOrderId: string,
  signal?: AbortSignal,
): Promise<ApiResult<SalesOrderDetail>> {
  return apiFetch<SalesOrderDetail>(
    `/api/sales-orders/${encodeURIComponent(salesOrderId)}/authorise-release`,
    { method: "POST", body: {}, signal },
  );
}

/**
 * Parse the I-4 conflict message into its two numbers. Returns null if the
 * shape doesn't match, letting the panel fall back to the raw message.
 *
 * Backend format (verbatim from sales-orders.service.ts):
 *   "Invariant I-4: confirmed payments (<sum>) do not cover the order total (<total>). Release refused."
 */
export function parseI4Conflict(
  msg: string,
): { confirmed: string; total: string } | null {
  const m = msg.match(
    /Invariant I-4: confirmed payments \((\S+?)\) do not cover the order total \((\S+?)\)\./,
  );
  if (!m) return null;
  return { confirmed: m[1]!, total: m[2]! };
}
