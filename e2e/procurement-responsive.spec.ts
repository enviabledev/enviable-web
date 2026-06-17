import { expect, test, type Page } from "@playwright/test";

/**
 * Procurement cluster responsive verification (Phase 3, full cluster: the plan
 * undercounted at 4 screens, the route holds ~13). Asserts no horizontal
 * overflow at 375/768/1280 across every Procurement screen, that each list
 * table's Tier 1 fits at 375 without the table scrolling, and a column-hiding
 * visible-outcome check. proc-po-list was the original audit's worst overflow
 * (+786px); the headline fix is verified here.
 *
 * Prereqs: backend :3000, dev :3100, broad-read user (md-demo fixture) and the
 * dev fixtures seeded (scripts/dev-fixtures/setup-fixtures.sql).
 */
const EMAIL = process.env.E2E_USER_EMAIL ?? "md-demo@enviable.example";
const PASSWORD = process.env.E2E_USER_PASSWORD ?? "E2ePass!234";

// 12 URLs covering all 13 Procurement page files (PO edit shares PoForm with
// PO new, exercised via /new; fixt-po-test is FULLY_RECEIVED so not editable).
const SCREENS = [
  "/procurement/purchase-orders",
  "/procurement/purchase-orders/fixt-po-test",
  "/procurement/purchase-orders/new",
  "/procurement/shipments",
  "/procurement/shipments/fixt-ship-test",
  "/procurement/shipments/fixt-ship-receive-test/receive",
  "/procurement/proforma-invoices",
  "/procurement/proforma-invoices/fixt-pi-test-r1",
  "/procurement/proforma-invoices/fixt-pi-test-r1/document",
  "/procurement/counterparties",
  "/procurement/counterparties/fixt-cp-forwarder",
  "/procurement/counterparties/new",
];

const TABLE_SCREENS = [
  "/procurement/purchase-orders",
  "/procurement/shipments",
  "/procurement/proforma-invoices",
  "/procurement/counterparties",
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

async function waitForMirror(page: Page, target = 450, tries = 40) {
  for (let i = 0; i < tries; i++) {
    if ((await mirrorCount(page)) > target) break;
    await page.waitForTimeout(2000);
  }
}

test("no horizontal overflow across the Procurement cluster", async ({ page }) => {
  // Generous budget: 12 URLs x 3 viewports plus the mirror-fill wait, against a
  // dev server compiling routes on first hit. In the full e2e:responsive run
  // this spec follows others, so cold-compile latency accumulates.
  test.setTimeout(540_000);
  await login(page);
  await page.goto("/procurement/purchase-orders");
  await waitForMirror(page);

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

test("Tier 1 fits at 375 without table scroll", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await login(page);
  await page.goto("/procurement/purchase-orders");
  await waitForMirror(page, 450, 30);

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

test("PO list hides Tier-4 column on mobile, keeps identity+status+total", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await login(page);
  await page.goto("/procurement/purchase-orders");
  await page.waitForTimeout(1500);
  // Tier 1 visible at 375.
  await expect(page.getByRole("columnheader", { name: "PO Number" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Status", exact: true })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Total", exact: true })).toBeVisible();
  // Tier 4 (Currency) hidden at 375, revealed at lg.
  await expect(page.getByRole("columnheader", { name: "Currency" })).toBeHidden();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.getByRole("columnheader", { name: "Currency" })).toBeVisible();
});
