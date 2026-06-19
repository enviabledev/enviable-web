import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Record proforma invoice flow (prompt 35): the "Record proforma invoice"
 * action on the PO detail page and its create form (pre-seeded from PO lines).
 *
 * itadmin + procurement-test hold pi.review; auditor-test has po.read but NOT
 * pi.review (the gating-negative user). PO-2026-0004 is APPROVED with 3 lines
 * and no PIs (the read-only fixture); throwaway POs are built via the API for
 * the mutating tests (POs are never deleted, so they are left in place).
 */
const PASSWORD = process.env.E2E_USER_PASSWORD ?? "E2ePass!234";
const ADMIN = process.env.E2E_ADMIN_EMAIL ?? "itadmin@enviable.example";
const NO_PI_REVIEW = "auditor-test@enviable.example"; // has po.read, not pi.review
const SUPPLIER = "seed-cp-vsk";
const PO_APPROVED = "cmqkvbvec005p9ksjsigvhdku"; // PO-2026-0004, APPROVED, 3 lines, no PIs
const PO_CLOSED = "cmpygdnct00059k1aa806jipp"; // PO-2026-0001, CLOSED
const ACTIVE_VARIANT = "seed-var-gs-gyellow";

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

async function createApprovedPO(
  ctx: APIRequestContext,
  lines: Array<{ productVariantId: string; quantityOrdered: number; unitPrice: string }> = [
    { productVariantId: ACTIVE_VARIANT, quantityOrdered: 5, unitPrice: "2000000" },
  ],
): Promise<string> {
  const c = await ctx.post("http://localhost:3000/api/purchase-orders", {
    data: { supplierId: SUPPLIER, currency: "USD", lines },
  });
  expect(c.status(), "create PO").toBe(201);
  const id = ((await c.json()) as { id: string }).id;
  expect((await ctx.post(`http://localhost:3000/api/purchase-orders/${id}/submit`, { data: {} })).status()).toBe(200);
  expect((await ctx.post(`http://localhost:3000/api/purchase-orders/${id}/approve`, { data: {} })).status()).toBe(200);
  return id;
}

async function recordAndApprovePI(ctx: APIRequestContext, poId: string, piNumber: string): Promise<string> {
  const r = await ctx.post(`http://localhost:3000/api/purchase-orders/${poId}/proforma-invoices`, {
    data: { piNumber, lines: [{ productVariantId: ACTIVE_VARIANT, quantity: 5, unitPrice: "1900000" }] },
  });
  expect(r.status(), "record PI").toBe(201);
  const id = ((await r.json()) as { id: string }).id;
  expect((await ctx.post(`http://localhost:3000/api/proforma-invoices/${id}/approve`, { data: {} })).status()).toBe(200);
  return id;
}

async function createVariant(ctx: APIRequestContext, sku: string): Promise<string> {
  const r = await ctx.post("http://localhost:3000/api/product-variants", {
    data: {
      productId: "seed-prod-gsplus",
      supplierSkuCode: sku,
      variantAttributes: { model: "GS+", colour: "PI" },
      currentMarketPrice: "1000000",
    },
  });
  expect(r.status()).toBe(201);
  return ((await r.json()) as { id: string }).id;
}

test("(a) action visible for a pi.review user, non-revision copy", async ({ page }) => {
  test.setTimeout(90_000);
  await loginUi(page, ADMIN);
  await page.goto(`/procurement/purchase-orders/${PO_APPROVED}`);
  const btn = page.getByTestId("record-pi-button");
  await expect(btn).toBeVisible({ timeout: 20_000 });
  await expect(btn).toHaveText("Record proforma invoice");
});

test("(a2) action hidden for a user without pi.review", async ({ page }) => {
  test.setTimeout(90_000);
  await loginUi(page, NO_PI_REVIEW);
  await page.goto(`/procurement/purchase-orders/${PO_APPROVED}`);
  await page.waitForTimeout(2500);
  await expect(page.getByTestId("record-pi-button")).toHaveCount(0);
});

test("(b) action hidden on a non-recordable PO status (CLOSED)", async ({ page }) => {
  test.setTimeout(90_000);
  await loginUi(page, ADMIN);
  await page.goto(`/procurement/purchase-orders/${PO_CLOSED}`);
  await page.waitForTimeout(2500);
  await expect(page.getByTestId("record-pi-button")).toHaveCount(0);
});

test("(b2) revision copy when an ACTIVE PI already exists", async ({ page, request }) => {
  test.setTimeout(120_000);
  await adminApi(request);
  const poId = await createApprovedPO(request);
  await recordAndApprovePI(request, poId, `E2E-PI-ACT-${Date.now()}`);
  await loginUi(page, ADMIN);
  await page.goto(`/procurement/purchase-orders/${poId}`);
  await expect(page.getByTestId("record-pi-button")).toHaveText("Record proforma invoice (revision)", {
    timeout: 20_000,
  });
});

test("(c) form pre-seeds from the PO lines", async ({ page }) => {
  test.setTimeout(90_000);
  await loginUi(page, ADMIN);
  await page.goto(`/procurement/purchase-orders/${PO_APPROVED}`);
  await page.getByTestId("record-pi-button").click();
  await expect(page.getByTestId("record-pi-modal")).toBeVisible();
  await expect(page.getByTestId("record-pi-line")).toHaveCount(3);
  const qtys = await page
    .getByTestId("record-pi-lines")
    .locator('input[inputmode="numeric"]')
    .evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
  expect(qtys.sort()).toEqual(["10", "15", "20"]);
});

test("(d) DISCONTINUED variant: pre-seeded line keeps it with a tag; picker excludes it", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await adminApi(request);
  const sku = `E2E-PIDISC-${Date.now()}`;
  const variantId = await createVariant(request, sku);
  const poId = await createApprovedPO(request, [
    { productVariantId: variantId, quantityOrdered: 3, unitPrice: "1000000" },
  ]);
  // Discontinue the variant AFTER it is committed on the PO line.
  await request.patch(`http://localhost:3000/api/product-variants/${variantId}`, {
    data: { status: "DISCONTINUED" },
  });
  await loginUi(page, ADMIN);
  await page.goto(`/procurement/purchase-orders/${poId}`);
  await page.getByTestId("record-pi-button").click();
  await expect(page.getByTestId("record-pi-modal")).toBeVisible();
  // Pre-seeded line keeps the now-discontinued variant, flagged.
  await expect(page.getByTestId("record-pi-line-discontinued")).toBeVisible({ timeout: 15_000 });
  // A NEW line's picker excludes the discontinued variant.
  await page.getByTestId("record-pi-add-line").click();
  await expect(page.getByTestId("record-pi-line-variant-1")).toBeVisible();
  await expect(page.getByTestId("record-pi-line-variant-1").locator(`option[value="${variantId}"]`)).toHaveCount(0);
});

test("(e) add and remove lines; cannot remove the last line", async ({ page, request }) => {
  test.setTimeout(120_000);
  await adminApi(request);
  const poId = await createApprovedPO(request); // single line
  await loginUi(page, ADMIN);
  await page.goto(`/procurement/purchase-orders/${poId}`);
  await page.getByTestId("record-pi-button").click();
  await expect(page.getByTestId("record-pi-line")).toHaveCount(1);
  // Only line: remove is disabled.
  await expect(page.getByTestId("record-pi-remove-line-0")).toBeDisabled();
  await page.getByTestId("record-pi-add-line").click();
  await expect(page.getByTestId("record-pi-line")).toHaveCount(2);
  await page.getByTestId("record-pi-remove-line-1").click();
  await expect(page.getByTestId("record-pi-line")).toHaveCount(1);
});

test("(f) validation: blank piNumber and invalid quantity block submit", async ({ page }) => {
  test.setTimeout(90_000);
  await loginUi(page, ADMIN);
  await page.goto(`/procurement/purchase-orders/${PO_APPROVED}`);
  await page.getByTestId("record-pi-button").click();
  await expect(page.getByTestId("record-pi-modal")).toBeVisible();
  // Blank piNumber -> submit disabled.
  await expect(page.getByTestId("record-pi-submit")).toBeDisabled();
  await page.getByTestId("record-pi-number").fill("E2E-VALID-1");
  await expect(page.getByTestId("record-pi-submit")).toBeEnabled();
  // Invalid quantity -> submit disabled again.
  await page.getByTestId("record-pi-line-qty-0").fill("0");
  await expect(page.getByTestId("record-pi-submit")).toBeDisabled();
});

test("(g) successful create: notification + PI appears PENDING_REVIEW on the PO", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await adminApi(request);
  const poId = await createApprovedPO(request);
  const piNumber = `E2E-PI-${Date.now()}`;
  await loginUi(page, ADMIN);
  await page.goto(`/procurement/purchase-orders/${poId}`);
  await page.getByTestId("record-pi-button").click();
  await page.getByTestId("record-pi-number").fill(piNumber);
  await page.getByTestId("record-pi-submit").click();
  await expect(page.getByTestId("record-pi-notification")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("record-pi-notification")).toContainText(piNumber);
  const row = page.getByTestId("po-pi-row").filter({ hasText: piNumber });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row).toContainText(/Pending review/i);
});

test("(h) revision: new PI is PENDING_REVIEW; the existing ACTIVE PI stays ACTIVE", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await adminApi(request);
  const poId = await createApprovedPO(request);
  const activePi = `E2E-PI-ACTIVE-${Date.now()}`;
  await recordAndApprovePI(request, poId, activePi);
  const revPi = `E2E-PI-REV-${Date.now()}`;
  await loginUi(page, ADMIN);
  await page.goto(`/procurement/purchase-orders/${poId}`);
  await page.getByTestId("record-pi-button").click();
  await page.getByTestId("record-pi-number").fill(revPi);
  await page.getByTestId("record-pi-submit").click();
  await expect(page.getByTestId("record-pi-notification")).toBeVisible({ timeout: 20_000 });
  // The original PI stays ACTIVE; the new revision is PENDING_REVIEW.
  await expect(page.getByTestId("po-pi-row").filter({ hasText: activePi })).toContainText(/Active/i, {
    timeout: 15_000,
  });
  await expect(page.getByTestId("po-pi-row").filter({ hasText: revPi })).toContainText(/Pending review/i);
});

test("(i) end-to-end: create -> approve -> PO advances to PI_RECEIVED", async ({ page, request }) => {
  test.setTimeout(120_000);
  await adminApi(request);
  const poId = await createApprovedPO(request);
  const piNumber = `E2E-PI-E2E-${Date.now()}`;
  await loginUi(page, ADMIN);
  await page.goto(`/procurement/purchase-orders/${poId}`);
  await page.getByTestId("record-pi-button").click();
  await page.getByTestId("record-pi-number").fill(piNumber);
  await page.getByTestId("record-pi-submit").click();
  await expect(page.getByTestId("record-pi-notification")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("record-pi-review-link").click();
  await page.waitForURL(/\/procurement\/proforma-invoices\/[^/]+$/);
  // First hit to the PI-detail route may compile (Turbopack); wait for the
  // approve control before the timed assertions.
  await expect(page.getByTestId("approve-button")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("approve-button").click();
  await page.getByTestId("approve-confirm").click();
  // The PI pivots to ACTIVE (the Review section + its transient success banner
  // unmount on the re-read, so assert the durable status pill instead).
  await expect(page.locator('[title="Active"]').first()).toBeVisible({ timeout: 30_000 });
  // PO advanced to PI_RECEIVED (formatPoStatus renders "PiReceived").
  await page.goto(`/procurement/purchase-orders/${poId}`);
  await expect(page.getByText("PiReceived").first()).toBeVisible({ timeout: 30_000 });
});

test("(j) offline: the record action is disabled", async ({ page }) => {
  test.setTimeout(90_000);
  await loginUi(page, ADMIN);
  await page.goto(`/procurement/purchase-orders/${PO_APPROVED}`);
  await expect(page.getByTestId("record-pi-button")).toBeVisible({ timeout: 20_000 });
  await page.context().setOffline(true);
  await expect(page.getByTestId("record-pi-button")).toBeDisabled({ timeout: 10_000 });
  await page.context().setOffline(false);
});

test("(k) responsive: record form fits at 375/768/1280", async ({ page }) => {
  test.setTimeout(120_000);
  await loginUi(page, ADMIN);
  const over = async () =>
    page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  for (const w of [375, 768, 1280]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto(`/procurement/purchase-orders/${PO_APPROVED}`);
    await page.getByTestId("record-pi-button").click();
    await expect(page.getByTestId("record-pi-modal")).toBeVisible({ timeout: 15_000 });
    expect(await over(), `record form overflow ${w}`).toBeLessThanOrEqual(1);
    await page.keyboard.press("Escape");
  }
});
