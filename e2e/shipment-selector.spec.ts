import { expect, test, type Page } from "@playwright/test";

/**
 * Historical-load shipment selector (prompt 38).
 *
 * Replaces the old free-text shipment-id input (broken by design: the backend
 * keys on the cuid, but users only see the human-readable reference, so a manual
 * paste of "SH-YYYY-NNNN" 404'd). Verifies the visible outcomes:
 *   - the dropdown lists shipments with reference labels;
 *   - selecting one submits the cuid in the request path (never the reference);
 *   - the section-1 auto-flow pre-selects the just-created shipment;
 *   - the page has no horizontal overflow at 375/768/1280.
 *
 * Not driven live here (noted in BACKLOG): the empty-state branch, which needs a
 * DB with zero shipments AND an empty mirror; the dev DB always has shipments,
 * so the branch is covered by construction + typecheck, not by a live assertion.
 *
 * Prereqs: backend :3000, dev :3100, itadmin password set, an ACTIVE supplier
 * and at least one shipment seeded (both true in the dev DB).
 */
const EMAIL = process.env.E2E_ADMIN_EMAIL ?? "itadmin@enviable.example";
const PASSWORD = process.env.E2E_USER_PASSWORD ?? "ChangeMe!2026";
const SHIPMENT_CUID = process.env.E2E_SHIPMENT_CUID ?? "cmqnuysgm00wl9ksjxhgc568w";
const REF_RE = /SH-\d{4}-\d+/;

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(EMAIL);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

test("dropdown lists shipments by reference, and selection submits the cuid", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await login(page);
  await page.goto("/admin/historical-load", { waitUntil: "domcontentloaded" });

  const select = page.getByTestId("hist-units-shipmentId");
  await expect(select).toBeVisible();

  // (a) Options are labelled with the human-readable reference (SH-YYYY-NNNN).
  const refOptions = select.locator("option").filter({ hasText: REF_RE });
  await expect(refOptions.first()).toBeAttached();

  // (b) Selecting a shipment submits its cuid in the request path, not the
  // reference. Capture the dry-run request and assert the URL.
  await select.selectOption(SHIPMENT_CUID);
  // A genuinely-new SKU keeps the dry-run clean (no commit fired).
  const stamp = Date.now();
  const csv = `productVariantSku,engineNumber,chassisNumber\nE2E SELECTOR ${stamp},ENSEL${stamp},CHSEL${stamp}\n`;
  await page.getByTestId("hist-units-file").setInputFiles({
    name: "selector.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });

  const reqPromise = page.waitForRequest(
    (r) => r.url().includes("/api/historical-load/units/") && r.method() === "POST",
  );
  await page.getByTestId("hist-units-dry").click();
  const req = await reqPromise;
  expect(req.url()).toContain(SHIPMENT_CUID); // cuid in the path
  expect(req.url()).not.toMatch(REF_RE); // never the reference

  // (e) The dry-run completes against the selected shipment (no 404): a result
  // panel renders rather than an error.
  await expect(page.getByTestId("hist-units-newvariants")).toBeVisible();
});

test("auto-flow: creating a shipment in section 1 pre-selects it in the units selector", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await login(page);
  await page.goto("/admin/historical-load", { waitUntil: "domcontentloaded" });

  // Fill section 1 (supplier + PI number; currency defaults to USD) and create.
  await page.getByTestId("hist-shipment-supplierId").selectOption({ index: 1 });
  const pi = `PI-E2E-SEL-${Date.now()}`;
  await page.getByTestId("hist-shipment-piNumber").fill(pi);
  await page.getByTestId("hist-shipment-commit").click();
  await page.getByTestId("confirm-dialog-go").click();

  // Success message names the created shipment's reference + id.
  const success = page.getByTestId("hist-shipment-success");
  await expect(success).toBeVisible();
  const successText = (await success.textContent()) ?? "";
  const ref = successText.match(REF_RE)?.[0];
  expect(ref, "success message should carry a shipment reference").toBeTruthy();

  // The units selector is now populated AND the just-created shipment is the
  // selected value (injected ahead of the mirror sync).
  const select = page.getByTestId("hist-units-shipmentId");
  const selectedValue = await select.inputValue();
  expect(selectedValue).not.toBe("");
  const selectedLabel = await select
    .locator(`option[value="${selectedValue}"]`)
    .textContent();
  expect(selectedLabel).toContain(ref!);
});

test("responsive: historical-load with the selector has no overflow at 375/768/1280", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await login(page);
  for (const w of [375, 768, 1280]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto("/admin/historical-load", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("hist-units-shipmentId")).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow, `horizontal overflow at ${w}px`).toBeLessThanOrEqual(1);
  }
});
