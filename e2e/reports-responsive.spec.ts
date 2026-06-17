import { expect, test, type Page } from "@playwright/test";

/**
 * Reports cluster responsive verification (Phase 3). Asserts no horizontal
 * overflow at 375/768/1280 across every Reports screen, that report/breakdown
 * tables fit at 375 without scrolling, that the KPI headline grid stacks and
 * stays readable on mobile, and a column-hiding check on the wide audit log.
 *
 * User: the IT Admin fixture holds report.revenue/customers/stocks +
 * costdata.view + audit.read, so a single login drives all four reports
 * (md-demo lacks audit.read, which is why the original audit could not capture
 * the audit-log table width). Activate with the sibling backend's set-password
 * (in-scope dev-DB verification action) if login 401s.
 *
 * Prereqs: backend :3000, dev :3100, fixtures seeded, itadmin password set.
 */
const EMAIL = process.env.E2E_REPORTS_EMAIL ?? "itadmin@enviable.example";
const PASSWORD = process.env.E2E_USER_PASSWORD ?? "E2ePass!234";

const SCREENS = [
  "/reports/revenue",
  "/reports/customers",
  "/reports/audit-log",
  "/reports/stocks",
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

test("no horizontal overflow across the Reports cluster", async ({ page }) => {
  test.setTimeout(300_000);
  await login(page);
  await page.goto("/reports/revenue");
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

test("report tables fit at 375 without table scroll", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await login(page);
  await page.goto("/reports/revenue");
  await waitForMirror(page, 450, 30);

  const scrolling: string[] = [];
  for (const path of SCREENS) {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1400);
    const bad = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".overflow-x-auto"))
        .filter((e) => e.scrollWidth > e.clientWidth + 1)
        .map((e) => `${e.scrollWidth}>${e.clientWidth}`),
    );
    if (bad.length) scrolling.push(`${path}: ${bad.join(",")}`);
  }
  expect(scrolling, `table scrolls at 375:\n${scrolling.join("\n")}`).toEqual([]);
});

test("revenue KPI grid stacks and stays readable at 375", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await login(page);
  await page.goto("/reports/revenue");
  await waitForMirror(page, 450, 30);
  await page.goto("/reports/revenue", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  // The KPI card is present and reachable at 375 (it stacks 1-up; no overflow
  // is asserted by the cluster overflow test). Its big-number value renders.
  const kpi = page.getByTestId("kpi-totalRevenue");
  await expect(kpi).toBeVisible();
  // The KPI card must not itself exceed the viewport at 375.
  const box = await kpi.boundingBox();
  expect(box, "kpi card has a box").not.toBeNull();
  expect(box!.width).toBeLessThanOrEqual(375);
});

test("audit-log hides Actor (Tier 2) on mobile, keeps When+Action", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await login(page);
  await page.goto("/reports/audit-log");
  await page.waitForTimeout(1800);
  // Tier 1 essentials visible at 375.
  await expect(page.getByRole("columnheader", { name: "When" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Action" })).toBeVisible();
  // Actor (Tier 2) hidden at 375, revealed at lg.
  await expect(page.getByRole("columnheader", { name: "Actor" })).toBeHidden();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.getByRole("columnheader", { name: "Actor" })).toBeVisible();
});
