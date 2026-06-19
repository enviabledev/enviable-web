import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Price-list entry-point affordances (prompt 34): the variant-detail
 * "Set price" / "Manage prices" action and the price-list "Add variant"
 * picker. Both gated on pricelist.manage; both route to the per-variant tier
 * editor (single source of truth for entry creation). DISCONTINUED variants
 * are unreachable through both entry points.
 *
 * itadmin holds product.read + pricelist.manage. salesofficer-test holds
 * pricelist.read but NOT pricelist.manage (the gating-negative user).
 */
const PASSWORD = process.env.E2E_USER_PASSWORD ?? "E2ePass!234";
const ADMIN = process.env.E2E_ADMIN_EMAIL ?? "itadmin@enviable.example";
const READONLY = "salesofficer-test@enviable.example";
const SEED_PRODUCT = "seed-prod-gsplus";
const PRICED_VARIANT = "seed-var-gs-ecogreen"; // has 2 priced tiers
const ACTIVE_SKU = "GSP-G-YELLOW"; // seed-var-gs-gyellow, ACTIVE

async function loginUi(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

async function adminApi(ctx: APIRequestContext) {
  const res = await ctx.post("http://localhost:3000/api/auth/login", {
    data: { email: ADMIN, password: PASSWORD },
  });
  expect(res.status(), "itadmin api login").toBe(200);
}

async function createVariant(
  ctx: APIRequestContext,
  sku: string,
  opts: { discontinued?: boolean } = {},
): Promise<string> {
  const r = await ctx.post("http://localhost:3000/api/product-variants", {
    data: {
      productId: SEED_PRODUCT,
      supplierSkuCode: sku,
      variantAttributes: { model: "GS+", colour: "PriceEntry" },
      currentMarketPrice: "1500000",
    },
  });
  expect(r.status(), "api create variant").toBe(201);
  const id = ((await r.json()) as { id: string }).id;
  if (opts.discontinued) {
    const p = await ctx.patch(`http://localhost:3000/api/product-variants/${id}`, {
      data: { status: "DISCONTINUED" },
    });
    expect(p.status()).toBe(200);
  }
  return id;
}

async function retireVariant(ctx: APIRequestContext, id: string) {
  await ctx
    .patch(`http://localhost:3000/api/product-variants/${id}`, { data: { status: "DISCONTINUED" } })
    .catch(() => {});
}

test("(a) variant with no price: 'Set price' routes to editor and sets the first price", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await adminApi(request);
  const id = await createVariant(request, `E2E-SETPRICE-${Date.now()}`);
  try {
    await loginUi(page, ADMIN);
    await page.goto(`/admin/variants/${id}`);
    const link = page.getByTestId("set-price-link");
    await expect(link).toBeVisible({ timeout: 20_000 });
    await expect(link).toHaveText(/Set price/);
    await link.click();
    await page.waitForURL(new RegExp(`/sales/price-lists/${id}\\?tier=`));
    await expect(page.getByTestId("set-price-heading")).toHaveText(/Set the first price/);
    await page.getByTestId("set-price-input").fill("1750000");
    await page.getByTestId("set-price-submit").click();
    await expect(page.getByTestId("set-price-success")).toBeVisible({ timeout: 15_000 });
  } finally {
    await retireVariant(request, id);
  }
});

test("(b) variant with prices: 'Manage prices (N tiers)' routes to editor", async ({ page }) => {
  test.setTimeout(90_000);
  await loginUi(page, ADMIN);
  await page.goto(`/admin/variants/${PRICED_VARIANT}`);
  const link = page.getByTestId("set-price-link");
  await expect(link).toBeVisible({ timeout: 20_000 });
  await expect(link).toHaveText(/Manage prices \(\d+ tiers?\)/);
  await link.click();
  await page.waitForURL(new RegExp(`/sales/price-lists/${PRICED_VARIANT}\\?tier=`));
  await expect(page.getByTestId("set-price-heading")).toHaveText(/Set a new price/);
});

test("(c) DISCONTINUED variant: no Set Price action, reactivation hint shown", async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  await adminApi(request);
  const id = await createVariant(request, `E2E-DISC-${Date.now()}`, { discontinued: true });
  await loginUi(page, ADMIN);
  await page.goto(`/admin/variants/${id}`);
  await expect(page.getByTestId("price-discontinued-hint")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("set-price-link")).toHaveCount(0);
});

test("(d) Set Price hidden for a user without pricelist.manage", async ({ page }) => {
  test.setTimeout(90_000);
  await loginUi(page, READONLY);
  await page.goto(`/admin/variants/${PRICED_VARIANT}`);
  await page.waitForTimeout(2000);
  await expect(page.getByTestId("set-price-link")).toHaveCount(0);
});

test("(e) picker lists ACTIVE variants and excludes DISCONTINUED ones", async ({ page, request }) => {
  test.setTimeout(90_000);
  await adminApi(request);
  const discSku = `E2E-PICKHIDE-${Date.now()}`;
  const id = await createVariant(request, discSku, { discontinued: true });
  try {
    await loginUi(page, ADMIN);
    await page.goto("/sales/price-lists");
    await page.getByTestId("add-variant-button").click();
    await expect(page.getByTestId("add-variant-modal")).toBeVisible();
    // An active variant is offered.
    await page.getByTestId("add-variant-search").fill(ACTIVE_SKU);
    await expect(page.getByTestId("add-variant-list").getByRole("button")).toHaveCount(1, {
      timeout: 15_000,
    });
    // The discontinued variant is NOT offered.
    await page.getByTestId("add-variant-search").fill(discSku);
    await expect(page.getByTestId("add-variant-list").getByRole("button")).toHaveCount(0);
  } finally {
    await retireVariant(request, id);
  }
});

test("(f) picker routes to the per-variant tier editor with the chosen tier", async ({ page }) => {
  test.setTimeout(90_000);
  await loginUi(page, ADMIN);
  await page.goto("/sales/price-lists");
  await page.getByTestId("add-variant-button").click();
  await expect(page.getByTestId("add-variant-modal")).toBeVisible();
  await page.getByTestId("add-variant-tier").selectOption({ label: "ResellerStandard" });
  await page.getByTestId("add-variant-search").fill(ACTIVE_SKU);
  await page.getByTestId("add-variant-list").getByRole("button").first().click();
  await page.getByTestId("add-variant-submit").click();
  await page.waitForURL(/\/sales\/price-lists\/[^/?]+\?tier=/);
  await expect(page.getByTestId("set-price-heading")).toBeVisible({ timeout: 15_000 });
});

test("(g) Add variant picker hidden for a user without pricelist.manage", async ({ page }) => {
  test.setTimeout(90_000);
  await loginUi(page, READONLY);
  await page.goto("/sales/price-lists");
  await page.waitForTimeout(2000);
  await expect(page.getByTestId("add-variant-button")).toHaveCount(0);
});

test("(h) post-create notification deep-links to the price editor", async ({ page, request }) => {
  test.setTimeout(120_000);
  await adminApi(request);
  const sku = `E2E-DEEPLINK-${Date.now()}`;
  let id: string | null = null;
  try {
    await loginUi(page, ADMIN);
    await page.goto("/admin/variants");
    await page.getByTestId("create-variant-button").click();
    await page.getByTestId("create-variant-product").selectOption(SEED_PRODUCT);
    await page.getByTestId("create-variant-sku").fill(sku);
    await page.getByTestId("create-variant-price").fill("1900000");
    await page.getByTestId("create-variant-submit").click();
    await expect(page.getByTestId("create-variant-notification")).toBeVisible({ timeout: 20_000 });
    const deep = page.getByTestId("create-variant-set-price-link");
    await expect(deep).toBeVisible({ timeout: 15_000 });
    await deep.click();
    await page.waitForURL(/\/sales\/price-lists\/[^/?]+\?tier=/);
    await expect(page.getByTestId("set-price-heading")).toBeVisible({ timeout: 30_000 });
  } finally {
    // Find + retire the created variant.
    const list = await request.get("http://localhost:3000/api/products");
    const products = (await list.json()) as Array<{ variants: Array<{ id: string; supplierSkuCode: string }> }>;
    id = products.flatMap((p) => p.variants).find((v) => v.supplierSkuCode === sku)?.id ?? null;
    if (id) await retireVariant(request, id);
  }
});

test("(i) responsive: variant detail action + price-list picker fit at 375/768/1280", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await loginUi(page, ADMIN);
  const over = async () =>
    page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  for (const w of [375, 768, 1280]) {
    await page.setViewportSize({ width: w, height: 900 });

    await page.goto(`/admin/variants/${PRICED_VARIANT}`);
    await expect(page.getByTestId("set-price-link")).toBeVisible({ timeout: 20_000 });
    expect(await over(), `variant detail overflow ${w}`).toBeLessThanOrEqual(1);

    await page.goto("/sales/price-lists");
    await page.getByTestId("add-variant-button").click();
    await expect(page.getByTestId("add-variant-modal")).toBeVisible();
    expect(await over(), `price-list picker overflow ${w}`).toBeLessThanOrEqual(1);
  }
});
