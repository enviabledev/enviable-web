import { expect, test, type Page } from "@playwright/test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * Variant auto-create UI verification (prompt 37-followup).
 *
 * Drives the real browser against the live backend to assert the VISIBLE
 * outcomes of the auto-create surfaces:
 *   - Variant list: pending-classification banner + filter + pill.
 *   - Variant detail: auto-create callout + "Not yet priced" + curation affordances.
 *   - Historical-load: newVariants preview, similarity warning, override toggle.
 *   - PO line SKU mode: a typo'd SKU opens the shared SimilarityWarningModal.
 *
 * Fixtures (seeded in the dev DB): several Pending-Classification variants exist,
 * and an ACTIVE real variant "TVS KING GS+ DP CKD EXP10 NF WINE RED" backs the
 * similarity (typo) cases. A valid shipment cuid parents the historical-load
 * dry-runs. All historical-load runs here are DRY (no commit), and the PO
 * similarity case aborts at the 409 (no PO persisted), so the spec is
 * non-destructive and re-runnable.
 *
 * Prereqs: backend :3000, dev :3100, itadmin password set (holds the
 * productvariant.manage / pricelist.manage / historicalload.run / purchaseorder
 * permissions via the IT Admin wildcard).
 */
const EMAIL = process.env.E2E_ADMIN_EMAIL ?? "itadmin@enviable.example";
const PASSWORD = process.env.E2E_USER_PASSWORD ?? "ChangeMe!2026";
const SHIPMENT_CUID = process.env.E2E_SHIPMENT_CUID ?? "cmqnuysgm00wl9ksjxhgc568w";
const REAL_ACTIVE_SKU =
  process.env.E2E_REAL_SKU ?? "TVS KING GS+ DP CKD EXP10 NF WINE RED";
// One-character typo of the real SKU: distance 1, flagged as similar.
const TYPO_SKU = REAL_ACTIVE_SKU.slice(0, -1) + "X";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(EMAIL);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

function writeCsv(name: string, rows: string[][]): string {
  const file = path.join(os.tmpdir(), name);
  const body = ["productVariantSku,engineNumber,chassisNumber"]
    .concat(rows.map((r) => r.join(",")))
    .join("\n");
  fs.writeFileSync(file, body + "\n");
  return file;
}

test("variant list: pending banner + filter + pill, and detail curation surface", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await login(page);
  await page.goto("/admin/variants", { waitUntil: "domcontentloaded" });

  // Rows paint (mirror or network). Wait for at least one variant row.
  await expect(page.locator('[data-testid^="variant-row-"]').first()).toBeVisible();

  // Pending-classification fixtures exist, so the banner surfaces.
  await expect(page.getByTestId("pending-classification-banner")).toBeVisible();

  // Filter to pending and assert every visible row is pending + shows the pill.
  await page.getByTestId("pending-filter-toggle").click();
  const rows = page.locator('[data-testid^="variant-row-"]');
  await expect(rows.first()).toBeVisible();
  const count = await rows.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    await expect(rows.nth(i)).toHaveAttribute("data-pending", "true");
  }
  await expect(page.getByTestId("pending-classification-pill").first()).toBeVisible();

  // Open the first pending variant's detail via its SKU link.
  await rows.first().getByRole("link").first().click();
  await page.waitForURL(/\/admin\/variants\/[^/]+$/);

  // The auto-create callout names the curation work.
  await expect(page.getByTestId("autocreate-callout")).toBeVisible();
  await expect(page.getByTestId("autocreate-callout")).toContainText(
    /auto-created and is pending classification/i,
  );
  // Pending fixtures are unpriced (currentMarketPrice 0).
  await expect(page.getByTestId("variant-price")).toContainText("Not yet priced");
  // Curation affordances present (pending variants are ACTIVE).
  await expect(page.getByTestId("change-product-button")).toBeVisible();
});

test("historical-load: newVariants preview, similarity warning, and override toggle", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await login(page);
  await page.goto("/admin/historical-load", { waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("heading", { name: "Historical data load" }),
  ).toBeVisible();

  const stamp = Date.now();
  await page.getByTestId("hist-units-shipmentId").fill(SHIPMENT_CUID);

  // A genuinely-new SKU previews in the "will create N new variants" surface.
  const newCsv = writeCsv("e2e-new.csv", [
    [`E2E AUTOCREATE NEW ${stamp}`, `ENA${stamp}`, `CHA${stamp}`],
  ]);
  await page.getByTestId("hist-units-file").setInputFiles(newCsv);
  await page.getByTestId("hist-units-dry").click();
  const newVariantsPanel = page.getByTestId("hist-units-newvariants");
  await expect(newVariantsPanel).toBeVisible();
  await expect(newVariantsPanel).toContainText(`E2E AUTOCREATE NEW ${stamp}`);

  // A typo of an existing SKU is flagged as similar (NOT auto-created).
  const simCsv = writeCsv("e2e-sim.csv", [[TYPO_SKU, `ENS${stamp}`, `CHS${stamp}`]]);
  await page.getByTestId("hist-units-file").setInputFiles(simCsv);
  await page.getByTestId("hist-units-dry").click();
  const similarityPanel = page.getByTestId("hist-units-similarity");
  await expect(similarityPanel).toBeVisible();
  await expect(similarityPanel).toContainText("is similar to existing variant");

  // Enabling the override moves the flagged SKU into newVariants on the next dry-run.
  await page.getByTestId("hist-units-override").check();
  await page.getByTestId("hist-units-dry").click();
  await expect(page.getByTestId("hist-units-newvariants")).toContainText(TYPO_SKU);
  await expect(page.getByTestId("hist-units-similarity")).toHaveCount(0);
});

test("PO line SKU mode: a typo'd SKU opens the shared similarity warning modal", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await login(page);
  await page.goto("/procurement/purchase-orders/new", {
    waitUntil: "domcontentloaded",
  });

  // Pick the supplier (the only ACTIVE one in the dev DB).
  const supplier = page.locator("select").first();
  await expect(supplier).toBeVisible();
  await supplier.selectOption({ index: 1 });

  // Switch the first line to SKU mode and enter a typo of an existing SKU.
  await page.getByTestId("po-line-use-sku").first().click();
  await page.getByTestId("po-line-sku-input").first().fill(TYPO_SKU);
  // Unit price (quantity defaults to 1); price input is the decimal field.
  await page.getByPlaceholder("0.00").first().fill("1000.00");

  await page.getByRole("button", { name: /create draft/i }).click();

  // The backend 409 (similar-variant) opens the shared modal with both SKUs
  // and the three choices; the existing-variant option is visually primary.
  const modal = page.getByTestId("similarity-warning-modal");
  await expect(modal).toBeVisible();
  await expect(page.getByTestId("similarity-incoming-sku")).toContainText(TYPO_SKU);
  await expect(page.getByTestId("similarity-match-sku")).toContainText(
    REAL_ACTIVE_SKU,
  );
  await expect(page.getByTestId("similarity-use-existing")).toBeVisible();
  await expect(page.getByTestId("similarity-create-new")).toBeVisible();
  await expect(page.getByTestId("similarity-cancel")).toBeVisible();

  // Cancel: nothing is persisted.
  await page.getByTestId("similarity-cancel").click();
  await expect(modal).toBeHidden();
});
