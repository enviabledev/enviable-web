import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Sales-order cancel flow (prompt 37). The backend endpoint already existed
 * (POST /api/sales-orders/:id/cancel, gated salesorder.create, reason required,
 * frees the soft unit reservation by nulling line unitIds); this verifies the
 * frontend wiring: a gated Cancel action on the SO detail, a reason-capture
 * modal, the CANCELLED state surfaced (reason/by/at), and the unit release.
 *
 * itadmin + salesofficer-test hold salesorder.create; auditor-test has
 * salesorder.read but NOT salesorder.create (the gating-negative user).
 * Cancel is irreversible, so the mutating tests create throwaway DRAFT SOs;
 * read-only assertions reuse the seed DRAFT (SO-2026-0001) and CLOSED
 * (SO-2026-0002).
 */
const PASSWORD = process.env.E2E_USER_PASSWORD ?? "E2ePass!234";
const ADMIN = process.env.E2E_ADMIN_EMAIL ?? "itadmin@enviable.example";
const NO_CREATE = "auditor-test@enviable.example"; // salesorder.read, not .create
const SO_DRAFT = "cmpl8uc7g00018oyrzumq2b6z"; // SO-2026-0001, DRAFT
const SO_CLOSED = "cmq6swkcr003r9k1ae2rvsu55"; // SO-2026-0002, CLOSED
const CUSTOMER = "fixt-customer-test";

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

// Create a throwaway DRAFT SO by discovering a free IN_WAREHOUSE_CKD unit (one
// not already soft-reserved by another active SO line) and pricing it for the
// fixture customer's tier.
async function createCancellableSO(
  ctx: APIRequestContext,
): Promise<{ soId: string; soNumber: string; unitId: string }> {
  const list = await ctx.get("http://localhost:3000/api/units?status=IN_WAREHOUSE_CKD&pageSize=250");
  const units = ((await list.json()) as { data: Array<{ id: string }> }).data;
  for (const u of units) {
    const det = (await (await ctx.get(`http://localhost:3000/api/units/${u.id}`)).json()) as {
      productVariant?: { id?: string };
    };
    const variantId = det.productVariant?.id;
    if (!variantId) continue;
    const r = await ctx.post("http://localhost:3000/api/sales-orders", {
      data: { customerId: CUSTOMER, lines: [{ productVariantId: variantId, saleForm: "CKD", unitId: u.id }] },
    });
    if (r.status() === 201) {
      const so = (await r.json()) as { id: string; soNumber: string };
      return { soId: so.id, soNumber: so.soNumber, unitId: u.id };
    }
  }
  throw new Error("no free CKD unit available to build a cancellable SO");
}

test("(a) cancel action visibility by SO state", async ({ page }) => {
  test.setTimeout(90_000);
  await loginUi(page, ADMIN);
  await page.goto(`/sales/sales-orders/${SO_DRAFT}`);
  await expect(page.getByTestId("cancel-so-button")).toBeVisible({ timeout: 20_000 });
  await page.goto(`/sales/sales-orders/${SO_CLOSED}`);
  await page.waitForTimeout(1500);
  await expect(page.getByTestId("cancel-so-button")).toHaveCount(0);
});

test("(b) cancel action visibility by permission", async ({ page }) => {
  test.setTimeout(90_000);
  await loginUi(page, NO_CREATE);
  await page.goto(`/sales/sales-orders/${SO_DRAFT}`);
  await page.waitForTimeout(2000);
  await expect(page.getByTestId("cancel-so-button")).toHaveCount(0);
});

test("(c+d) successful cancellation sets CANCELLED and shows the reason", async ({ page, request }) => {
  test.setTimeout(120_000);
  await adminApi(request);
  const { soId } = await createCancellableSO(request);
  await loginUi(page, ADMIN);
  await page.goto(`/sales/sales-orders/${soId}`);
  await page.getByTestId("cancel-so-button").click();
  await expect(page.getByTestId("cancel-so-modal")).toBeVisible();
  await page.getByTestId("cancel-so-reason").selectOption("Customer changed mind");
  await page.getByTestId("cancel-so-submit").click();
  // CANCELLED state + the reason are shown on the detail (the cancellation rows
  // only render for a CANCELLED order).
  await expect(page.getByTestId("so-cancellation-reason")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("so-cancellation-reason")).toContainText("Customer changed mind");
  await expect(page.locator('[title="Cancelled"]').first()).toBeVisible();
});

test("(e) cancelling releases the reserved unit", async ({ page, request }) => {
  test.setTimeout(120_000);
  await adminApi(request);
  const { soId, unitId } = await createCancellableSO(request);
  // Confirm the unit is reserved by this SO's line before cancelling.
  const before = (await (await request.get(`http://localhost:3000/api/sales-orders/${soId}`)).json()) as {
    lines: Array<{ unitId: string | null }>;
  };
  expect(before.lines.some((l) => l.unitId === unitId), "unit reserved pre-cancel").toBe(true);

  await loginUi(page, ADMIN);
  await page.goto(`/sales/sales-orders/${soId}`);
  await page.getByTestId("cancel-so-button").click();
  await page.getByTestId("cancel-so-reason").selectOption("Data entry error");
  await page.getByTestId("cancel-so-submit").click();
  await expect(page.getByTestId("so-cancellation-reason")).toBeVisible({ timeout: 20_000 });

  // The soft reservation is freed: the line no longer holds the unit (unit
  // status itself is unchanged because allocation never moved it).
  const after = (await (await request.get(`http://localhost:3000/api/sales-orders/${soId}`)).json()) as {
    lines: Array<{ unitId: string | null }>;
  };
  expect(after.lines.every((l) => l.unitId == null), "unit released post-cancel").toBe(true);
});

test("(f) reason is required to submit", async ({ page }) => {
  test.setTimeout(90_000);
  await loginUi(page, ADMIN);
  await page.goto(`/sales/sales-orders/${SO_DRAFT}`);
  await page.getByTestId("cancel-so-button").click();
  await expect(page.getByTestId("cancel-so-modal")).toBeVisible();
  // No reason chosen -> submit disabled.
  await expect(page.getByTestId("cancel-so-submit")).toBeDisabled();
  // "Other" without elaboration stays disabled.
  await page.getByTestId("cancel-so-reason").selectOption("Other");
  await expect(page.getByTestId("cancel-so-submit")).toBeDisabled();
  // A concrete reason enables it.
  await page.getByTestId("cancel-so-reason").selectOption("Duplicate order");
  await expect(page.getByTestId("cancel-so-submit")).toBeEnabled();
});

test("(g) backing out of the modal does not cancel the order", async ({ page }) => {
  test.setTimeout(90_000);
  await loginUi(page, ADMIN);
  await page.goto(`/sales/sales-orders/${SO_DRAFT}`);
  await page.getByTestId("cancel-so-button").click();
  await expect(page.getByTestId("cancel-so-modal")).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByTestId("cancel-so-modal")).toHaveCount(0);
  // The order is still DRAFT (not cancelled): the cancel action is still there.
  await expect(page.getByTestId("cancel-so-button")).toBeVisible();
  await expect(page.getByTestId("so-cancellation-reason")).toHaveCount(0);
});

test("(h) responsive: cancel action + modal fit at 375/768/1280", async ({ page }) => {
  test.setTimeout(120_000);
  await loginUi(page, ADMIN);
  const over = async () =>
    page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  for (const w of [375, 768, 1280]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto(`/sales/sales-orders/${SO_DRAFT}`);
    await expect(page.getByTestId("cancel-so-button")).toBeVisible({ timeout: 20_000 });
    expect(await over(), `SO detail overflow ${w}`).toBeLessThanOrEqual(1);
    await page.getByTestId("cancel-so-button").click();
    await expect(page.getByTestId("cancel-so-modal")).toBeVisible();
    expect(await over(), `cancel modal overflow ${w}`).toBeLessThanOrEqual(1);
    await page.keyboard.press("Escape");
  }
});
