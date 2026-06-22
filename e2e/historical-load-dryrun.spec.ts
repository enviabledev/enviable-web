import { expect, test, type Page } from "@playwright/test";
import * as path from "node:path";

/**
 * Historical-units dry-run, real-data validation (collapsed-plan round).
 *
 * Two things verified through the real browser flow, not just the API:
 *
 *  1. The shipment-id input trims on entry. We type a value with a LEADING
 *     SPACE (the exact production failure: a pasted id carrying whitespace
 *     became %20 in the request path and 404'd). After the fix the input
 *     strips it, so the dry-run request reaches the backend and returns a
 *     validation report instead of a 404. We assert both the trimmed input
 *     value AND that a report (not an error) rendered.
 *
 *  2. Real-data content-shape: the actual Enviable CSV (92 rows, all SKU
 *     "TVS KING GS+ DP CKD EXP10 G YELLOW") dry-runs to 92 unknown-SKU errors
 *     against the current seed, which ships placeholder SKUs only. This is the
 *     visible proof of the catalog disconnect (Option A). When the catalog is
 *     seeded with the real supplier SKU, this assertion is what flips to green.
 *
 * Prereqs: backend :3000, dev :3100, itadmin password set, a valid shipment
 * cuid in E2E_SHIPMENT_CUID (defaults to a known dev-DB shipment), and the
 * real CSV path in E2E_REAL_UNITS_CSV.
 */
const EMAIL = process.env.E2E_ADMIN_EMAIL ?? "itadmin@enviable.example";
const PASSWORD = process.env.E2E_USER_PASSWORD ?? "ChangeMe!2026";
const SHIPMENT_CUID = process.env.E2E_SHIPMENT_CUID ?? "cmqnuysgm00wl9ksjxhgc568w";
const REAL_CSV =
  process.env.E2E_REAL_UNITS_CSV ??
  "/Users/chinecheremkalu/Downloads/Historical Data Load - historical-units.csv";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(EMAIL);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

test("real CSV dry-run: input trims, report renders, 92 unknown-SKU errors", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await login(page);
  await page.goto("/admin/historical-load", { waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("heading", { name: "Historical data load" }),
  ).toBeVisible();

  // Type a LEADING SPACE before the valid cuid. Pre-fix this would survive
  // into the path as %20 and 404; the input now trims on entry.
  const idInput = page.getByTestId("hist-units-shipmentId");
  await idInput.fill(` ${SHIPMENT_CUID}`);
  await expect(idInput).toHaveValue(SHIPMENT_CUID); // trimmed, no leading space

  // Attach the real Enviable CSV.
  await page.getByTestId("hist-units-file").setInputFiles(path.resolve(REAL_CSV));

  // Run the dry-run.
  await page.getByTestId("hist-units-dry").click();

  // It reaches validation (not a 404/error state): the dry-errors panel renders.
  const panel = page.getByTestId("hist-units-result-dry-errors");
  await expect(panel).toBeVisible();

  // Content-shape: 0 valid of 92, all unknown-SKU. This is the catalog
  // disconnect made visible; it flips green once the real SKU is seeded.
  await expect(panel).toContainText("0 valid / 92 total");
  await expect(panel).toContainText("92 errors");
  await expect(page.getByTestId("hist-units-errors")).toContainText(
    "unknown productVariantSku: TVS KING GS+ DP CKD EXP10 G YELLOW",
  );

  // Commit must stay locked (no clean dry-run landed).
  await expect(page.getByTestId("hist-units-commit")).toBeDisabled();
});
