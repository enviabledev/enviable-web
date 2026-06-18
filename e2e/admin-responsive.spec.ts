import { expect, test, type Page } from "@playwright/test";

/**
 * Admin cluster responsive verification (Phase 3, closes prompt 29). Asserts no
 * horizontal overflow at 375/768/1280 across the historical-load screen (the
 * substantive one: three stacked sections, CSV upload UIs, dry-run/commit
 * action bars, and a commit dialog through the shared responsive Modal
 * primitive) and the two NotYetBuiltCard placeholders (users, roles).
 *
 * User: the IT Admin fixture holds historicalload.run + user.read + role.read,
 * so a single login renders the real historical-load form (not the denial
 * card) and both placeholders. Activate with the sibling backend's
 * set-password (in-scope dev-DB verification action) if login 401s.
 *
 * Prereqs: backend :3000, dev :3100, fixtures seeded, itadmin password set.
 */
const EMAIL = process.env.E2E_ADMIN_EMAIL ?? "itadmin@enviable.example";
const PASSWORD = process.env.E2E_USER_PASSWORD ?? "E2ePass!234";

// /admin/users + /admin/roles are now the real management screens (prompt 31),
// not placeholders. fixt-user-md is a stable fixture user id for the detail.
const SCREENS = [
  "/admin/historical-load",
  "/admin/users",
  "/admin/users/fixt-user-md",
  "/admin/roles",
];

const VIEWPORTS = [
  { name: "375", w: 375, h: 812 },
  { name: "768", w: 768, h: 1024 },
  { name: "1280", w: 1280, h: 900 },
];

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(EMAIL);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

test("no horizontal overflow across the Admin cluster", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page);

  const violations: string[] = [];
  for (const path of SCREENS) {
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1200);
      const over = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      if (over > 1) violations.push(`${vp.name}px +${over}px  ${path}`);
    }
  }
  expect(violations, `overflow:\n${violations.join("\n")}`).toEqual([]);
});

test("historical-load renders the real form (not denial) and fits at 375", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await login(page);
  await page.goto("/admin/historical-load", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  // itadmin holds historicalload.run, so the form heading renders (the denial
  // card would say "Access denied" instead).
  await expect(page.getByRole("heading", { name: "Historical data load" })).toBeVisible();
  // Any CSV section table sits in an overflow-x-auto wrapper that fits at 375.
  const bad = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".overflow-x-auto"))
      .filter((e) => e.scrollWidth > e.clientWidth + 1)
      .map((e) => `${e.scrollWidth}>${e.clientWidth}`),
  );
  expect(bad, `historical-load tables scroll at 375:\n${bad.join(",")}`).toEqual([]);
});

test("create-user modal fits and is usable at 375", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await login(page);
  await page.goto("/admin/users", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await page.getByTestId("create-user-button").click();
  const modal = page.getByTestId("create-user-modal");
  await expect(modal).toBeVisible();
  // The modal fields and submit are reachable; the modal does not push the page wider.
  await expect(page.getByTestId("create-user-fullname")).toBeVisible();
  await expect(page.getByTestId("create-user-submit")).toBeVisible();
  const over = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(over, `overflow at 375 with create modal open: +${over}`).toBeLessThanOrEqual(1);
});

test("role detail fits at 375 (category-grouped permissions)", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await login(page);
  await page.goto("/admin/roles", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await page.getByTestId("role-row-link").first().click();
  await page.waitForURL(/\/admin\/roles\/.+/, { timeout: 20_000 });
  await page.waitForTimeout(1500);
  const over = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(over, `role detail overflow at 375: +${over}`).toBeLessThanOrEqual(1);
});
