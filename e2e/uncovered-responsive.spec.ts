import { expect, test, type Page } from "@playwright/test";

/**
 * Responsive verification for screens that fell OUTSIDE the prompt-29 cluster
 * pass (dashboard home, the rendered-invoice A4 document frame, the SO
 * create/edit form, the sync-conflicts utility). Surfaced by the post-build
 * visual walkthrough. Asserts no horizontal overflow at 375/768/1280 and that
 * the fixed-width A4 invoice document scales to fit the mobile viewport.
 *
 * Prereqs: backend :3000 (renders invoice HTML on demand), dev :3100, fixtures.
 */
const PASSWORD = process.env.E2E_USER_PASSWORD ?? "E2ePass!234";
const ADMIN = process.env.E2E_ADMIN_EMAIL ?? "itadmin@enviable.example";
const SALES = "salesofficer-test@enviable.example";

const VIEWPORTS = [
  { name: "375", w: 375, h: 812 },
  { name: "768", w: 768, h: 1024 },
  { name: "1280", w: 1280, h: 900 },
];

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

async function mirrorCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((res) => {
        const rq = indexedDB.open("enviable-sync");
        rq.onsuccess = () => {
          const db = rq.result;
          if (!db.objectStoreNames.contains("mirror_records")) return res(0);
          const tx = db.transaction("mirror_records", "readonly");
          const c = tx.objectStore("mirror_records").count();
          c.onsuccess = () => res(c.result);
          c.onerror = () => res(0);
        };
        rq.onerror = () => res(0);
      }),
  );
}

async function overflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

test("no overflow on the uncovered screens (dashboard, invoice doc, conflicts)", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, ADMIN);
  await page.goto("/");
  for (let i = 0; i < 30; i++) {
    if ((await mirrorCount(page)) > 450) break;
    await page.waitForTimeout(2000);
  }
  const screens = ["/", "/sales/invoices/fixt-inv-await", "/sync/conflicts"];
  const violations: string[] = [];
  for (const path of screens) {
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1500);
      const over = await overflow(page);
      if (over > 1) violations.push(`${vp.name}px +${over}px  ${path}`);
    }
  }
  expect(violations, `overflow:\n${violations.join("\n")}`).toEqual([]);
});

test("dashboard KPI cards do not overflow their grid at 375", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await login(page, ADMIN);
  await page.goto("/");
  await page.waitForTimeout(2500);
  // The market-value card was the visible offender (compact number clipped by
  // the card border). No element should push the page past the viewport.
  expect(await overflow(page)).toBeLessThanOrEqual(1);
});

test("rendered invoice A4 document scales to fit at 375", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await login(page, ADMIN);
  await page.goto("/sales/invoices/fixt-inv-await", { waitUntil: "domcontentloaded" });
  // The frame fetches the rendered HTML from the backend; wait for the iframe.
  const frame = page.getByTestId("invoice-document-frame");
  await expect(frame).toBeVisible({ timeout: 30_000 });
  // The fixed 794px A4 page must be scaled down so it fits the 375 viewport.
  const box = await frame.boundingBox();
  expect(box, "iframe has a box").not.toBeNull();
  expect(box!.width, `scaled iframe width ${box!.width} should fit 375`).toBeLessThanOrEqual(360);
  expect(await overflow(page)).toBeLessThanOrEqual(1);
});

test("SO create form fits at 375", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await login(page, SALES);
  await page.goto("/sales/sales-orders/new", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1800);
  expect(await overflow(page)).toBeLessThanOrEqual(1);
});
