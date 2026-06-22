import { expect, test, type Page } from "@playwright/test";

/**
 * Returns module (prompt 40). Drives the workflow end to end against the live
 * backend: initiate (from the SO) -> inspect -> resolve, the returns list,
 * the cross-context unit callout, and permission gating.
 *
 * The returns workflow is forward-only (a return is never un-done), so the full
 * workflow test CONSUMES one SOLD unit on the order each run. It picks whatever
 * SOLD unit the Initiate modal offers, so it keeps working until the order's
 * SOLD units are exhausted. The cross-context + gating + list tests are
 * read-only.
 *
 * Prereqs: backend :3000, dev :3100; itadmin (return.manage) and
 * salesofficer-test (salesorder.read, NOT return.manage) passwords set;
 * SO-2026-0002 with >=1 SOLD unit; FIXT-GS-0023 a returned unit.
 */
const ADMIN = process.env.E2E_ADMIN_EMAIL ?? "itadmin@enviable.example";
const READONLY = "salesofficer-test@enviable.example";
const PASSWORD = process.env.E2E_USER_PASSWORD ?? "ChangeMe!2026";
const SO_ID = process.env.E2E_SO_ID ?? "cmq6swkcr003r9k1ae2rvsu55"; // SO-2026-0002
const RETURNED_UNIT = process.env.E2E_RETURNED_UNIT ?? "FIXT-GS-0023";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

test("full workflow: initiate from SO -> inspect -> resolve (REPAIR)", async ({
  page,
}) => {
  test.setTimeout(150_000);
  await login(page, ADMIN);
  await page.goto(`/sales/sales-orders/${SO_ID}`, { waitUntil: "domcontentloaded" });

  // The workflow is forward-only: each run consumes one SOLD unit on the order.
  // Skip (don't fail) once the order's SOLD units are exhausted, so the suite
  // stays re-runnable.
  await expect(page.getByRole("heading", { name: /SO-/ })).toBeVisible();
  const hasReturnableUnit = (await page.getByTestId("initiate-return-button").count()) > 0;
  test.skip(!hasReturnableUnit, "No SOLD units left on the fixture order to return.");

  // Initiate from the order (SO-scoped workflow).
  await page.getByTestId("initiate-return-button").click();
  await expect(page.getByTestId("initiate-return-modal")).toBeVisible();
  await page.getByTestId("initiate-return-unit").selectOption({ index: 1 });
  await page.getByTestId("initiate-return-reason").fill(`E2E return ${Date.now()}`);
  await page.getByTestId("initiate-return-submit").click();
  await expect(page.getByTestId("initiate-return-modal")).toBeHidden();

  // The order's Returns card now lists it. The card may also hold older
  // (resolved) returns from prior runs, so open the row that is INITIATED (the
  // one we just created), waiting for the post-submit refetch to land it.
  const card = page.getByTestId("so-returns-card");
  await expect(card).toBeVisible();
  const newRow = card.locator("li").filter({ hasText: "Initiated" }).first();
  await expect(newRow).toBeVisible();
  await newRow.getByRole("link").first().click();
  await page.waitForURL(/\/sales\/returns\/[^/]+$/);
  await expect(page.getByTestId("return-status-pill")).toContainText("Initiated");

  // Inspect (no form; advances to INSPECTING).
  await page.getByTestId("begin-inspection-button").click();
  await expect(page.getByTestId("return-status-pill")).toContainText("Inspecting");

  // Resolve as REPAIR.
  await page.getByTestId("resolve-return-button").click();
  await expect(page.getByTestId("resolve-return-modal")).toBeVisible();
  await page.getByTestId("resolve-return-disposition").selectOption("REPAIR");
  await expect(page.getByTestId("resolve-return-consequence")).toContainText(/repair/i);
  await page.getByTestId("resolve-return-submit").click();
  await expect(page.getByTestId("resolve-return-modal")).toBeHidden();

  await expect(page.getByTestId("return-status-pill")).toContainText("Resolved");
  // Disposition is recorded on the detail.
  await expect(page.getByTestId("return-disposition")).toHaveText("Repair");
});

test("returns list shows returns and the status filter narrows", async ({ page }) => {
  test.setTimeout(90_000);
  await login(page, ADMIN);
  await page.goto("/sales/returns", { waitUntil: "domcontentloaded" });
  // At least one return row exists (seeded by the workflow test / probes).
  await expect(page.locator('[data-testid^="return-row-"]').first()).toBeVisible();
  // Filter to RESOLVED: every visible row's pill reads Resolved.
  await page.getByTestId("return-status-filter").selectOption("RESOLVED");
  const pills = page.locator('[data-testid^="return-row-"] [data-testid="return-status-pill"]');
  await expect(pills.first()).toBeVisible();
  const n = await pills.count();
  for (let i = 0; i < n; i++) {
    await expect(pills.nth(i)).toContainText("Resolved");
  }
});

test("cross-context: a returned unit links to its return", async ({ page }) => {
  test.setTimeout(90_000);
  await login(page, ADMIN);
  await page.goto(`/inventory/units/${RETURNED_UNIT}`, { waitUntil: "domcontentloaded" });
  const callout = page.getByTestId("unit-return-callout");
  await expect(callout).toBeVisible();
  await page.getByTestId("unit-return-link").click();
  await page.waitForURL(/\/sales\/returns\/[^/]+$/);
  await expect(page.getByTestId("return-status-pill")).toBeVisible();
});

test("permission gating: a salesorder.read user cannot initiate returns", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await login(page, READONLY);
  await page.goto(`/sales/sales-orders/${SO_ID}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /SO-/ })).toBeVisible();
  // The order has SOLD units, but a non-return.manage user sees no Initiate action.
  await expect(page.getByTestId("initiate-return-button")).toHaveCount(0);
  // And can still view the returns list (salesorder.read).
  await page.goto("/sales/returns", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Returns" })).toBeVisible();
});

test("responsive: returns list + detail fit at 375/768/1280", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, ADMIN);
  const overflow = () =>
    page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

  for (const w of [375, 768, 1280]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto("/sales/returns", { waitUntil: "domcontentloaded" });
    await expect(page.locator('[data-testid^="return-row-"]').first()).toBeVisible();
    await expect.poll(overflow, { message: `list overflow at ${w}px` }).toBeLessThanOrEqual(1);

    await page.locator('[data-testid^="return-row-"]').first().getByRole("link").first().click();
    await page.waitForURL(/\/sales\/returns\/[^/]+$/);
    await expect(page.getByTestId("return-status-pill")).toBeVisible();
    await expect.poll(overflow, { message: `detail overflow at ${w}px` }).toBeLessThanOrEqual(1);
  }
});
