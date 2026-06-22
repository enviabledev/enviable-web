import { expect, test, type Page } from "@playwright/test";

/**
 * Unit lifecycle adjustments (prompt 39).
 *
 * The adjust endpoint is uniform: { toStatus, reason }, with valid targets driven
 * by the backend adjustment map (mirrored client-side). This spec drives the new
 * surface end to end against the live backend:
 *   - the Adjust modal applies a transition; the status pill and movement
 *     timeline update; the reverse transition returns the unit to stock;
 *   - reason is required (submit gated);
 *   - the action is permission-gated (unit.adjust) and hidden without it;
 *   - the detail + modal are responsive.
 *
 * Round-trips restore each unit's status, so the spec is re-runnable. The status
 * pill, list status-filter and movement timeline are pre-existing (they already
 * cover all 13 statuses / all movement types); this spec exercises the adjust
 * action that feeds them, not those surfaces in isolation.
 *
 * Prereqs: backend :3000, dev :3100; itadmin (holds unit.adjust) and
 * salesofficer-test (holds unit.read, NOT unit.adjust) passwords set; CKD
 * fixture units FIXT-GS-0005..0007 present.
 */
const ADMIN = process.env.E2E_ADMIN_EMAIL ?? "itadmin@enviable.example";
const READONLY = "salesofficer-test@enviable.example";
const PASSWORD = process.env.E2E_USER_PASSWORD ?? "ChangeMe!2026";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

test("adjust + reverse: CKD -> Demo -> CKD, status pill and timeline update", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await login(page, ADMIN);
  await page.goto("/inventory/units/FIXT-GS-0005", { waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("heading", { name: "FIXT-GS-0005" }),
  ).toBeVisible();

  // Forward: move to demo.
  await page.getByTestId("adjust-unit-button").click();
  const modal = page.getByTestId("adjust-unit-modal");
  await expect(modal).toBeVisible();
  await page.getByTestId("adjust-unit-status").selectOption("DEMO");
  // Consequence copy appears for the chosen target.
  await expect(page.getByTestId("adjust-unit-consequence")).toContainText(
    /unavailable for sale/i,
  );
  const fwdReason = `E2E demo ${Date.now()}`;
  await page.getByTestId("adjust-unit-reason").fill(fwdReason);
  await page.getByTestId("adjust-unit-submit").click();
  await expect(modal).toBeHidden();

  // Status now reads Demo, and the movement timeline carries the reason.
  await expect(page.getByTestId("unit-current-status")).toHaveText("Demo");
  await expect(page.getByText(fwdReason)).toBeVisible();

  // Reverse: return to warehouse (CKD).
  await page.getByTestId("adjust-unit-button").click();
  await expect(modal).toBeVisible();
  await page.getByTestId("adjust-unit-status").selectOption("IN_WAREHOUSE_CKD");
  await expect(page.getByTestId("adjust-unit-consequence")).toContainText(
    /sellable warehouse stock/i,
  );
  const revReason = `E2E return ${Date.now()}`;
  await page.getByTestId("adjust-unit-reason").fill(revReason);
  await page.getByTestId("adjust-unit-submit").click();
  await expect(modal).toBeHidden();

  // formatUnitStatus is the handoff's compact label (no spaces): "InWarehouseCKD".
  await expect(page.getByTestId("unit-current-status")).toHaveText("InWarehouseCKD");
  await expect(page.getByText(revReason)).toBeVisible();
});

test("reason is required: submit stays disabled until a reason is entered", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await login(page, ADMIN);
  await page.goto("/inventory/units/FIXT-GS-0006", { waitUntil: "domcontentloaded" });
  await page.getByTestId("adjust-unit-button").click();
  await expect(page.getByTestId("adjust-unit-modal")).toBeVisible();

  await page.getByTestId("adjust-unit-status").selectOption("DAMAGED");
  // No reason yet -> submit disabled.
  await expect(page.getByTestId("adjust-unit-submit")).toBeDisabled();
  // Whitespace-only does not count.
  await page.getByTestId("adjust-unit-reason").fill("   ");
  await expect(page.getByTestId("adjust-unit-submit")).toBeDisabled();
  // A real reason enables it.
  await page.getByTestId("adjust-unit-reason").fill("Cracked casing on inspection");
  await expect(page.getByTestId("adjust-unit-submit")).toBeEnabled();
});

test("permission gating: a user without unit.adjust sees the unit but no Adjust action", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await login(page, READONLY);
  await page.goto("/inventory/units/FIXT-GS-0007", { waitUntil: "domcontentloaded" });
  // The detail renders (salesofficer holds unit.read)...
  await expect(
    page.getByRole("heading", { name: "FIXT-GS-0007" }),
  ).toBeVisible();
  // ...but the adjust affordance is absent.
  await expect(page.getByTestId("adjust-unit-button")).toHaveCount(0);
});

test("responsive: unit detail + adjust modal fit at 375/768/1280", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await login(page, ADMIN);
  const overflow = () =>
    page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );

  for (const w of [375, 768, 1280]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto("/inventory/units/FIXT-GS-0005", {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByTestId("adjust-unit-button")).toBeVisible();
    // Poll, not a single read: the mirror paints the variant's productId (a long
    // cuid) as a placeholder name until the getUnit response refines it, which
    // momentarily widens a column. The steady state fits; poll until it settles.
    await expect
      .poll(overflow, { message: `page overflow at ${w}px` })
      .toBeLessThanOrEqual(1);

    // Open the modal and confirm it fits too.
    await page.getByTestId("adjust-unit-button").click();
    await expect(page.getByTestId("adjust-unit-modal")).toBeVisible();
    await expect
      .poll(overflow, { message: `modal overflow at ${w}px` })
      .toBeLessThanOrEqual(1);
  }
});
