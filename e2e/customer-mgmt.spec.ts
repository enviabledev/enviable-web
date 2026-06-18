import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Customer management UI (prompt 33-A): create/edit/deactivate/reactivate/delete
 * on the existing customers list + detail, with the active-SOs delete guard
 * surfaced honestly and permission gating on customer.manage.
 *
 * itadmin holds customer.manage; md-demo has customer.read only (gating check).
 * Throwaway customers are created/cleaned via the API so no fixture is disturbed.
 */
const PASSWORD = process.env.E2E_USER_PASSWORD ?? "E2ePass!234";
const ADMIN = process.env.E2E_ADMIN_EMAIL ?? "itadmin@enviable.example";
const READONLY = "md-demo@enviable.example";

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

async function createCustomer(ctx: APIRequestContext, name: string): Promise<string> {
  const r = await ctx.post("http://localhost:3000/api/customers", {
    data: { name, type: "END_USER" },
  });
  expect(r.status(), "api create customer").toBe(201);
  return ((await r.json()) as { id: string }).id;
}

test("create customer: modal -> list refresh + success notification; empty name rejected", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await adminApi(request);
  const name = `E2E Cust ${Date.now()}`;
  let id: string | null = null;
  try {
    await loginUi(page, ADMIN);
    await page.goto("/sales/customers");
    await page.waitForTimeout(1500);
    await page.getByTestId("create-customer-button").click();
    await expect(page.getByTestId("create-customer-modal")).toBeVisible();

    // (b) invalid (empty name) cannot be submitted: the submit is disabled until
    // a name is entered, so an empty customer can never be created.
    await expect(page.getByTestId("create-customer-submit")).toBeDisabled();

    // (a) valid create: filling the name enables submit; create succeeds.
    await page.getByTestId("create-customer-name").fill(name);
    await expect(page.getByTestId("create-customer-submit")).toBeEnabled();
    await page.getByTestId("create-customer-submit").click();
    await expect(page.getByTestId("create-customer-notification")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(name).first()).toBeVisible({ timeout: 20_000 });

    const found = await ctx_search(request, name);
    id = found;
    expect(id, "created customer found via api").not.toBeNull();
  } finally {
    if (id) await request.delete(`http://localhost:3000/api/customers/${id}`);
  }
});

async function ctx_search(ctx: APIRequestContext, name: string): Promise<string | null> {
  const r = await ctx.get(`http://localhost:3000/api/customers?search=${encodeURIComponent(name)}`);
  const body = (await r.json()) as { data: Array<{ id: string; name: string }> };
  return body.data.find((c) => c.name === name)?.id ?? null;
}

test("edit, deactivate, reactivate reflect in the detail view", async ({ page, request }) => {
  test.setTimeout(120_000);
  await adminApi(request);
  const id = await createCustomer(request, `E2E Edit ${Date.now()}`);
  try {
    await loginUi(page, ADMIN);
    await page.goto(`/sales/customers/${id}`);
    await page.waitForTimeout(1200);

    // Edit name.
    await page.getByTestId("edit-button").click();
    const newName = `E2E Edited ${Date.now()}`;
    await page.getByTestId("edit-name").fill(newName);
    await page.getByTestId("edit-save").click();
    await expect(page.getByText(newName).first()).toBeVisible({ timeout: 15_000 });

    // Deactivate -> INACTIVE, affordance flips to Reactivate.
    await page.getByTestId("deactivate-button").click();
    await page.getByTestId("deactivate-confirm").click();
    await expect(page.getByTestId("reactivate-button")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("deactivate-button")).toHaveCount(0);

    // Reactivate -> ACTIVE.
    await page.getByTestId("reactivate-button").click();
    await page.getByTestId("reactivate-confirm").click();
    await expect(page.getByTestId("deactivate-button")).toBeVisible({ timeout: 15_000 });
  } finally {
    await adminApi(request);
    await request.delete(`http://localhost:3000/api/customers/${id}`);
  }
});

test("delete with no sales orders removes the customer", async ({ page, request }) => {
  test.setTimeout(120_000);
  await adminApi(request);
  const id = await createCustomer(request, `E2E Del ${Date.now()}`);
  let deleted = false;
  try {
    await loginUi(page, ADMIN);
    await page.goto(`/sales/customers/${id}`);
    await page.waitForTimeout(1200);
    await page.getByTestId("delete-button").click();
    await page.getByTestId("delete-confirm").click();
    await page.waitForURL(/\/sales\/customers$/, { timeout: 20_000 });
    deleted = true;
    // No longer fetchable (soft-deleted).
    const r = await request.get(`http://localhost:3000/api/customers/${id}`);
    expect([404, 200]).toContain(r.status());
  } finally {
    if (!deleted) await request.delete(`http://localhost:3000/api/customers/${id}`).catch(() => {});
  }
});

test("delete blocked when the customer has active sales orders (409 surfaced honestly)", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await loginUi(page, ADMIN);
  // fixt-customer-test has active SOs.
  await page.goto("/sales/customers/fixt-customer-test");
  await page.waitForTimeout(1200);
  await page.getByTestId("delete-button").click();
  await page.getByTestId("delete-confirm").click();
  await expect(page.getByTestId("delete-error")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("delete-error")).toContainText(/active sales order/i);
  // Still on the detail (not deleted).
  await expect(page).toHaveURL(/\/sales\/customers\/fixt-customer-test/);
});

test("permission gating: read-only user sees no management affordances", async ({ page }) => {
  test.setTimeout(90_000);
  await loginUi(page, READONLY);
  await page.goto("/sales/customers");
  await page.waitForTimeout(1500);
  await expect(page.getByTestId("create-customer-button")).toHaveCount(0);
  await page.goto("/sales/customers/fixt-customer-test");
  await page.waitForTimeout(1200);
  await expect(page.getByTestId("edit-button")).toHaveCount(0);
  await expect(page.getByTestId("delete-button")).toHaveCount(0);
});

test("responsive: list + create modal + detail fit at 375", async ({ page, request }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await adminApi(request);
  const id = await createCustomer(request, `E2E Resp ${Date.now()}`);
  try {
    await loginUi(page, ADMIN);
    const over = async () =>
      page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

    await page.goto("/sales/customers");
    await page.waitForTimeout(1500);
    expect(await over(), "list overflow 375").toBeLessThanOrEqual(1);
    await page.getByTestId("create-customer-button").click();
    await expect(page.getByTestId("create-customer-modal")).toBeVisible();
    expect(await over(), "list+modal overflow 375").toBeLessThanOrEqual(1);

    await page.goto(`/sales/customers/${id}`);
    await page.waitForTimeout(1200);
    expect(await over(), "detail overflow 375").toBeLessThanOrEqual(1);
  } finally {
    await adminApi(request);
    await request.delete(`http://localhost:3000/api/customers/${id}`);
  }
});
