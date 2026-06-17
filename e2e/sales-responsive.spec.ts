import { expect, test, type Page } from "@playwright/test";

/**
 * Sales cluster responsive verification (Phase 3 reference cluster). Asserts
 * no horizontal overflow at 375/768/1280 across every Sales screen, and a few
 * visible-outcome checks for the column-tier and card-reflow patterns.
 *
 * Prereqs: backend :3000, dev :3100, broad-read user (md-demo fixture).
 */
const EMAIL = process.env.E2E_USER_EMAIL ?? "md-demo@enviable.example";
const PASSWORD = process.env.E2E_USER_PASSWORD ?? "E2ePass!234";

const SCREENS = [
  "/sales/sales-orders",
  "/sales/sales-orders/fixt-so-await-payment",
  "/sales/customers",
  "/sales/customers/fixt-customer-test",
  "/sales/invoices-payments",
  "/sales/invoices-payments?tab=payments",
  "/sales/deliveries",
  "/sales/price-lists",
  "/sales/price-lists/seed-var-gs-ecogreen?tier=cmpgwqqk600ez9ktp8vzo8hy3",
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

test("no horizontal overflow across the Sales cluster", async ({ page }) => {
  test.setTimeout(240_000);
  await login(page);
  await page.goto("/sales/sales-orders");
  for (let i = 0; i < 40; i++) {
    if ((await mirrorCount(page)) > 450) break;
    await page.waitForTimeout(2000);
  }

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

test("Tier 1 (incl primary metric) fits at 375 without table scroll", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await login(page);
  await page.goto("/sales/sales-orders");
  for (let i = 0; i < 30; i++) {
    if ((await mirrorCount(page)) > 450) break;
    await page.waitForTimeout(2000);
  }
  const TABLE_SCREENS = [
    "/sales/sales-orders",
    "/sales/customers",
    "/sales/deliveries",
    "/sales/price-lists",
  ];
  const scrolling: string[] = [];
  for (const path of TABLE_SCREENS) {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1400);
    const bad = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".overflow-x-auto"))
        .filter((e) => e.scrollWidth > e.clientWidth + 1)
        .map((e) => `${e.scrollWidth}>${e.clientWidth}`),
    );
    if (bad.length) scrolling.push(`${path}: ${bad.join(",")}`);
  }
  expect(scrolling, `table scrolls (Tier 1 doesn't fit):\n${scrolling.join("\n")}`).toEqual([]);
});

test("sales-orders table hides Tier-4 column on mobile, keeps identity+status", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await login(page);
  await page.goto("/sales/sales-orders");
  await page.waitForTimeout(1500);
  // Tier 1 visible at 375.
  await expect(page.getByRole("columnheader", { name: "SO Number" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Total" })).toBeVisible();
  // Tier 4 (Channel) hidden at 375, revealed at lg.
  await expect(page.getByRole("columnheader", { name: "Channel" })).toBeHidden();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.getByRole("columnheader", { name: "Channel" })).toBeVisible();
});

test("invoices reflow to cards on mobile, table on desktop", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await login(page);
  await page.goto("/sales/invoices-payments");
  // The invoices list paints from the mirror, which fills only after the
  // post-login sync download; wait for it (as the sibling tests do) before
  // asserting on a fixture invoice, or a cold context renders an empty list.
  for (let i = 0; i < 30; i++) {
    if ((await mirrorCount(page)) > 450) break;
    await page.waitForTimeout(2000);
  }
  await page.waitForTimeout(1000);
  // Card identity (invoice number link) visible; the table is hidden at 375.
  await expect(page.getByText("INV-FIXT-AWAIT").first()).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Invoice #" })).toBeHidden();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.getByRole("columnheader", { name: "Invoice #" })).toBeVisible();
});
