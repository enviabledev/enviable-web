import { expect, test, type Page } from "@playwright/test";

/**
 * Responsive shell (Phase 1): the sidebar is a persistent rail at lg+ and an
 * off-canvas drawer below lg, so mobile/tablet reclaim the full content width.
 *
 * Prereqs: backend on :3000, dev on :3100, a user with broad read perms.
 * Env: E2E_USER_EMAIL / E2E_USER_PASSWORD (default md-demo fixture).
 */
const EMAIL = process.env.E2E_USER_EMAIL ?? "md-demo@enviable.example";
const PASSWORD = process.env.E2E_USER_PASSWORD ?? "E2ePass!234";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(EMAIL);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

const hamburger = (page: Page) =>
  page.getByRole("button", { name: /open navigation menu/i });
// Located by testid (not role): when closed the drawer's container is
// aria-hidden, so role-based lookup would miss it. testid finds it either way.
const drawer = (page: Page) => page.getByTestId("nav-drawer");
const mainWidth = (page: Page) =>
  page.evaluate(() => document.querySelector("main")?.getBoundingClientRect().width ?? 0);
const docOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

test.describe("desktop (1280): persistent rail, no hamburger", () => {
  test("rail present, hamburger hidden, nav reachable inline", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await login(page);
    await page.goto("/sales/sales-orders");
    await expect(hamburger(page)).toBeHidden();
    // Persistent 212px rail consumes width: main is ~1068, well under 1100.
    expect(await mainWidth(page)).toBeLessThan(1100);
    // A nav link is reachable without opening any drawer.
    await expect(
      page.getByRole("link", { name: "Sales Orders" }).first(),
    ).toBeVisible();
  });
});

for (const vp of [
  { name: "mobile-375", w: 375, h: 812, minMain: 340 },
  { name: "tablet-768", w: 768, h: 1024, minMain: 700 },
]) {
  test.describe(`${vp.name}: drawer nav`, () => {
    test("rail collapses, hamburger toggles drawer, nav closes drawer", async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await login(page);
      // Measure main on a content-light screen so a wide table's overflow does
      // not distort the box; the drawer toggle itself is page-agnostic.
      await page.goto("/admin/users");
      await page.waitForTimeout(800);

      // Sidebar collapsed: main reclaims (near) full width.
      expect(await mainWidth(page)).toBeGreaterThan(vp.minMain);

      // Hamburger present; drawer panel starts off-screen (x < 0).
      await expect(hamburger(page)).toBeVisible();
      const closedBox = await drawer(page).boundingBox();
      expect(closedBox && closedBox.x).toBeLessThan(0);

      // Open: drawer slides on-screen (x >= 0) and its nav is reachable.
      await hamburger(page).click();
      await expect
        .poll(async () => (await drawer(page).boundingBox())?.x ?? -999)
        .toBeGreaterThanOrEqual(0);
      await expect(drawer(page).getByRole("link", { name: "Customers" }).first()).toBeVisible();

      // Selecting a nav item navigates and closes the drawer.
      await drawer(page).getByRole("link", { name: "Proforma Invoices" }).click();
      await page.waitForURL(/\/procurement\/proforma-invoices/);
      await expect
        .poll(async () => (await drawer(page).boundingBox())?.x ?? -999)
        .toBeLessThan(0);
    });

    test("content-light screen has no shell-induced overflow", async ({ page }) => {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await login(page);
      // A placeholder card screen isolates the shell's contribution: pre-fix the
      // topbar forced ~960px wide regardless of content. Per-screen content
      // overflow (dashboard grids, tables) is handled in the cluster phase.
      await page.goto("/admin/users");
      await page.waitForTimeout(1000);
      expect(await docOverflow(page)).toBeLessThanOrEqual(1);
    });
  });
}
