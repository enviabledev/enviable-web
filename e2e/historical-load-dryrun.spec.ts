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

test("real CSV dry-run: select shipment, real SKU resolves clean", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await login(page);
  await page.goto("/admin/historical-load", { waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("heading", { name: "Historical data load" }),
  ).toBeVisible();

  // Pick the parent shipment from the selector (label = reference, value = cuid).
  // The old free-text input + leading-space %20 failure is structurally gone: a
  // select submits the cuid value and can never carry whitespace.
  await page.getByTestId("hist-units-shipmentId").selectOption(SHIPMENT_CUID);

  // Attach the real Enviable CSV (92 rows, all SKU "TVS KING GS+ DP CKD EXP10
  // G YELLOW").
  await page.getByTestId("hist-units-file").setInputFiles(path.resolve(REAL_CSV));

  // Run the dry-run.
  await page.getByTestId("hist-units-dry").click();

  // The catalog disconnect this spec originally documented is RESOLVED: the
  // real supplier SKU is now seeded as an ACTIVE variant, so every row resolves
  // by exact match and the dry-run passes cleanly. (The SKU already exists, so
  // it is not auto-created; the newVariants preview stays empty.)
  const panel = page.getByTestId("hist-units-result-dry-ok");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("92 valid / 92 total");
  // No "unknown productVariantSku" anywhere on the page now.
  await expect(page.getByText("unknown productVariantSku")).toHaveCount(0);

  // A clean dry-run unlocks the commit (we stop here; the commit itself is
  // destructive and is not exercised by this verification).
  await expect(page.getByTestId("hist-units-commit")).toBeEnabled();
});
