import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Product-variant management UI (prompt 33-B): create + edit + deactivate /
 * reactivate on /admin/variants, the immutable-SKU guard, the status filter,
 * and the cross-context ACTIVE-only filtering of the sales-order variant
 * picker (defense-in-depth: deactivating a variant removes it from new use).
 *
 * itadmin holds productvariant.manage; salesofficer-test has product.read but
 * NOT productvariant.manage (the gating check). There is no DELETE endpoint for
 * variants, so test variants are left DISCONTINUED on teardown (the deactivated
 * state keeps them out of the ACTIVE pickers).
 */
const PASSWORD = process.env.E2E_USER_PASSWORD ?? "E2ePass!234";
const ADMIN = process.env.E2E_ADMIN_EMAIL ?? "itadmin@enviable.example";
const READONLY = "salesofficer-test@enviable.example";
const SEED_PRODUCT = "seed-prod-gsplus";
const SEED_ACTIVE_VARIANT = "seed-var-gs-gyellow"; // ACTIVE; SKU GSP-G-YELLOW

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
  opts: { price?: string; colour?: string; discontinued?: boolean } = {},
): Promise<string> {
  const r = await ctx.post("http://localhost:3000/api/product-variants", {
    data: {
      productId: SEED_PRODUCT,
      supplierSkuCode: sku,
      variantAttributes: { model: "GS+", colour: opts.colour ?? "Test" },
      currentMarketPrice: opts.price ?? "1000000",
    },
  });
  expect(r.status(), "api create variant").toBe(201);
  const id = ((await r.json()) as { id: string }).id;
  if (opts.discontinued) {
    const p = await ctx.patch(`http://localhost:3000/api/product-variants/${id}`, {
      data: { status: "DISCONTINUED" },
    });
    expect(p.status(), "api discontinue variant").toBe(200);
  }
  return id;
}

// Leave a test variant DISCONTINUED (no delete endpoint exists).
async function retire(ctx: APIRequestContext, id: string) {
  await ctx
    .patch(`http://localhost:3000/api/product-variants/${id}`, {
      data: { status: "DISCONTINUED" },
    })
    .catch(() => {});
}

test("create variant: modal -> list refresh + notification; invalid blocked", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await adminApi(request);
  const sku = `E2E-CREATE-${Date.now()}`;
  let id: string | null = null;
  try {
    await loginUi(page, ADMIN);
    await page.goto("/admin/variants");
    await page.waitForTimeout(1500);
    await page.getByTestId("create-variant-button").click();
    await expect(page.getByTestId("create-variant-modal")).toBeVisible();

    // Invalid: no product + no price -> submit disabled.
    await expect(page.getByTestId("create-variant-submit")).toBeDisabled();

    // Valid: choose product, SKU, price -> submit enabled -> create.
    await page.getByTestId("create-variant-product").selectOption(SEED_PRODUCT);
    await page.getByTestId("create-variant-sku").fill(sku);
    await page.getByTestId("create-variant-colour").fill("E2E Created");
    await page.getByTestId("create-variant-price").fill("2750000");
    await expect(page.getByTestId("create-variant-submit")).toBeEnabled();
    await page.getByTestId("create-variant-submit").click();

    await expect(page.getByTestId("create-variant-notification")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(sku).first()).toBeVisible({ timeout: 20_000 });

    const list = await request.get(`http://localhost:3000/api/products`);
    const products = (await list.json()) as Array<{ variants: Array<{ id: string; supplierSkuCode: string }> }>;
    id = products.flatMap((p) => p.variants).find((v) => v.supplierSkuCode === sku)?.id ?? null;
    expect(id, "created variant exists via api").not.toBeNull();
  } finally {
    if (id) await retire(request, id);
  }
});

test("create with an existing SKU is rejected (409 surfaced honestly)", async ({ page, request }) => {
  test.setTimeout(120_000);
  await adminApi(request);
  const sku = `E2E-DUP-${Date.now()}`;
  const id = await createVariant(request, sku);
  try {
    await loginUi(page, ADMIN);
    await page.goto("/admin/variants");
    await page.waitForTimeout(1500);
    await page.getByTestId("create-variant-button").click();
    await page.getByTestId("create-variant-product").selectOption(SEED_PRODUCT);
    await page.getByTestId("create-variant-sku").fill(sku);
    await page.getByTestId("create-variant-price").fill("123");
    await page.getByTestId("create-variant-submit").click();
    await expect(page.getByTestId("create-variant-error")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("create-variant-error")).toContainText(/already exists/i);
  } finally {
    await retire(request, id);
  }
});

test("edit attributes and price reflect in the detail view", async ({ page, request }) => {
  test.setTimeout(120_000);
  await adminApi(request);
  const id = await createVariant(request, `E2E-EDIT-${Date.now()}`, { colour: "Before" });
  try {
    await loginUi(page, ADMIN);
    await page.goto(`/admin/variants/${id}`);
    await page.waitForTimeout(1200);
    await page.getByTestId("edit-button").click();
    await page.getByTestId("edit-colour").fill("After Edit");
    await page.getByTestId("edit-price").fill("654321");
    await page.getByTestId("edit-save").click();
    await expect(page.getByText("After Edit").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("variant-price")).toContainText("654,321");
  } finally {
    await retire(request, id);
  }
});

test("deactivate -> Discontinued, reactivate -> Active", async ({ page, request }) => {
  test.setTimeout(120_000);
  await adminApi(request);
  const id = await createVariant(request, `E2E-STATUS-${Date.now()}`);
  try {
    await loginUi(page, ADMIN);
    await page.goto(`/admin/variants/${id}`);
    await page.waitForTimeout(1200);

    await page.getByTestId("deactivate-button").click();
    await page.getByTestId("deactivate-confirm").click();
    await expect(page.getByTestId("reactivate-button")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("deactivate-button")).toHaveCount(0);

    await page.getByTestId("reactivate-button").click();
    await page.getByTestId("reactivate-confirm").click();
    await expect(page.getByTestId("deactivate-button")).toBeVisible({ timeout: 15_000 });
  } finally {
    await retire(request, id);
  }
});

test("SKU is immutable: no edit field in the UI, and a SKU-change PATCH is rejected (400)", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await adminApi(request);
  const id = await createVariant(request, `E2E-IMMUT-${Date.now()}`);
  try {
    await loginUi(page, ADMIN);
    await page.goto(`/admin/variants/${id}`);
    await page.waitForTimeout(1200);
    await page.getByTestId("edit-button").click();
    // The edit form offers model / colour / price, but NO SKU field.
    await expect(page.getByTestId("edit-model")).toBeVisible();
    await expect(page.getByTestId("edit-sku")).toHaveCount(0);

    // And the backend rejects a SKU change outright.
    const r = await request.patch(`http://localhost:3000/api/product-variants/${id}`, {
      data: { supplierSkuCode: "E2E-RENAMED" },
    });
    expect(r.status(), "SKU-change PATCH rejected").toBe(400);
  } finally {
    await retire(request, id);
  }
});

test("list status filter narrows by ACTIVE / DISCONTINUED", async ({ page, request }) => {
  test.setTimeout(120_000);
  await adminApi(request);
  const sku = `E2E-FILTER-${Date.now()}`;
  const id = await createVariant(request, sku, { discontinued: true });
  try {
    await loginUi(page, ADMIN);
    await page.goto("/admin/variants");
    await page.waitForTimeout(1500);
    // Default ALL: the discontinued variant is present.
    await expect(page.getByText(sku).first()).toBeVisible({ timeout: 15_000 });
    // Filter to ACTIVE: it disappears.
    await page.getByTestId("variant-status-filter").selectOption("ACTIVE");
    await expect(page.getByText(sku)).toHaveCount(0);
    // Filter to DISCONTINUED: it returns.
    await page.getByTestId("variant-status-filter").selectOption("DISCONTINUED");
    await expect(page.getByText(sku).first()).toBeVisible({ timeout: 15_000 });
  } finally {
    await retire(request, id);
  }
});

test("cross-context: a discontinued variant is excluded from the sales-order variant picker", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await adminApi(request);
  const id = await createVariant(request, `E2E-XCTX-${Date.now()}`, { discontinued: true });
  try {
    await loginUi(page, ADMIN);
    await page.goto("/sales/sales-orders/new");
    // Wait for the catalogue to load into the line picker.
    await expect(page.locator(`option[value="${SEED_ACTIVE_VARIANT}"]`).first()).toHaveCount(1, {
      timeout: 20_000,
    });
    // The discontinued variant is filtered out of the picker (defense in depth).
    await expect(page.locator(`option[value="${id}"]`)).toHaveCount(0);
  } finally {
    await retire(request, id);
  }
});

test("permission gating: a user without productvariant.manage sees no management affordances", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await loginUi(page, READONLY);
  await page.goto("/admin/variants");
  await page.waitForTimeout(1500);
  await expect(page.getByTestId("create-variant-button")).toHaveCount(0);
  await page.goto(`/admin/variants/${SEED_ACTIVE_VARIANT}`);
  await page.waitForTimeout(1200);
  await expect(page.getByTestId("edit-button")).toHaveCount(0);
  await expect(page.getByTestId("deactivate-button")).toHaveCount(0);
});

test("responsive: list + create modal + detail fit at 375", async ({ page, request }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await adminApi(request);
  const id = await createVariant(request, `E2E-RESP-${Date.now()}`);
  try {
    await loginUi(page, ADMIN);
    const over = async () =>
      page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

    await page.goto("/admin/variants");
    await page.waitForTimeout(1500);
    expect(await over(), "list overflow 375").toBeLessThanOrEqual(1);
    await page.getByTestId("create-variant-button").click();
    await expect(page.getByTestId("create-variant-modal")).toBeVisible();
    expect(await over(), "list+modal overflow 375").toBeLessThanOrEqual(1);

    await page.goto(`/admin/variants/${id}`);
    await page.waitForTimeout(1200);
    expect(await over(), "detail overflow 375").toBeLessThanOrEqual(1);
  } finally {
    await retire(request, id);
  }
});
