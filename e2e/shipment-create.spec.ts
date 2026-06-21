import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Shipment create/edit against a PO (prompt 38). The backend create + update
 * endpoints already existed (gated shipment.manage); this verifies the frontend
 * wiring: a gated "Record shipment" action on the PO detail (pre-seeded from PO
 * lines, partial fulfilment, DISCONTINUED-preserved), routing to the new
 * shipment, and pre-receive Edit on the shipment detail.
 *
 * itadmin + procurement-test hold shipment.manage; auditor-test has po.read but
 * NOT shipment.manage (the gating-negative user). Shipments only enter editable
 * states freshly created, so the mutating tests build PI_RECEIVED POs via the
 * API and record throwaway shipments.
 */
const PASSWORD = process.env.E2E_USER_PASSWORD ?? "E2ePass!234";
const ADMIN = process.env.E2E_ADMIN_EMAIL ?? "itadmin@enviable.example";
const NO_MANAGE = "auditor-test@enviable.example"; // po.read, not shipment.manage
const SUPPLIER = "seed-cp-vsk";
const PO_APPROVED = "cmqkvbvec005p9ksjsigvhdku"; // APPROVED (not shipment-recordable)
const PO_CLOSED = "cmpygdnct00059k1aa806jipp"; // CLOSED
const SHIP_RECEIVED = "fixt-ship-test"; // RECEIVED shipment (edit hidden)
const GYELLOW = "seed-var-gs-gyellow";
const NEPBLUE = "seed-var-gs-nepblue";

const API = "http://localhost:3000/api";

async function loginUi(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

async function adminApi(ctx: APIRequestContext) {
  const res = await ctx.post(`${API}/auth/login`, { data: { email: ADMIN, password: PASSWORD } });
  expect(res.status(), "itadmin api login").toBe(200);
}

type PoLineSeed = { productVariantId: string; quantityOrdered: number; unitPrice: string };

async function createPiReceivedPO(
  ctx: APIRequestContext,
  lines: PoLineSeed[] = [
    { productVariantId: GYELLOW, quantityOrdered: 10, unitPrice: "2000000" },
    { productVariantId: NEPBLUE, quantityOrdered: 5, unitPrice: "2100000" },
  ],
): Promise<string> {
  const po = ((await (await ctx.post(`${API}/purchase-orders`, {
    data: { supplierId: SUPPLIER, currency: "USD", lines },
  })).json()) as { id: string }).id;
  await ctx.post(`${API}/purchase-orders/${po}/submit`, { data: {} });
  await ctx.post(`${API}/purchase-orders/${po}/approve`, { data: {} });
  const pi = ((await (await ctx.post(`${API}/purchase-orders/${po}/proforma-invoices`, {
    data: {
      piNumber: `PI-SHIP-${Date.now()}-${Math.round(performance.now())}`,
      lines: [{ productVariantId: lines[0].productVariantId, quantity: lines[0].quantityOrdered, unitPrice: lines[0].unitPrice }],
    },
  })).json()) as { id: string }).id;
  await ctx.post(`${API}/proforma-invoices/${pi}/approve`, { data: {} });
  return po;
}

async function createVariant(ctx: APIRequestContext, sku: string, discontinued = false): Promise<string> {
  const id = ((await (await ctx.post(`${API}/product-variants`, {
    data: { productId: "seed-prod-gsplus", supplierSkuCode: sku, variantAttributes: { model: "GS+", colour: "Ship" }, currentMarketPrice: "1000000" },
  })).json()) as { id: string }).id;
  if (discontinued) await ctx.patch(`${API}/product-variants/${id}`, { data: { status: "DISCONTINUED" } });
  return id;
}

// One reusable PI_RECEIVED PO (2 standard lines) for the tests that only need a
// recordable PO; shipments are 1:many with the PO so reuse is safe.
let cachedPo: string | null = null;
async function recordablePO(ctx: APIRequestContext): Promise<string> {
  if (!cachedPo) cachedPo = await createPiReceivedPO(ctx);
  return cachedPo;
}

// After a successful create the PO detail shows a notification with a "View
// shipment" link; the shipment id is the last path segment of its href.
async function recordedShipmentId(page: Page): Promise<string> {
  await expect(page.getByTestId("record-shipment-notification")).toBeVisible({ timeout: 20_000 });
  const href = await page.getByTestId("record-shipment-view-link").getAttribute("href");
  if (!href) throw new Error("no view-shipment link href");
  return href.split("/").pop() as string;
}

test("(a) record-shipment visibility by PO state", async ({ page, request }) => {
  test.setTimeout(120_000);
  await adminApi(request);
  const po = await recordablePO(request);
  await loginUi(page, ADMIN);
  await page.goto(`/procurement/purchase-orders/${po}`);
  await expect(page.getByTestId("record-shipment-button")).toBeVisible({ timeout: 20_000 });
  await page.goto(`/procurement/purchase-orders/${PO_APPROVED}`);
  await page.waitForTimeout(1500);
  await expect(page.getByTestId("record-shipment-button")).toHaveCount(0);
  await page.goto(`/procurement/purchase-orders/${PO_CLOSED}`);
  await page.waitForTimeout(1500);
  await expect(page.getByTestId("record-shipment-button")).toHaveCount(0);
});

test("(b) record-shipment hidden without shipment.manage", async ({ page, request }) => {
  test.setTimeout(120_000);
  await adminApi(request);
  const po = await recordablePO(request);
  await loginUi(page, NO_MANAGE);
  await page.goto(`/procurement/purchase-orders/${po}`);
  await page.waitForTimeout(2000);
  await expect(page.getByTestId("record-shipment-button")).toHaveCount(0);
});

test("(c) form pre-seeds manifest lines from the PO", async ({ page, request }) => {
  test.setTimeout(120_000);
  await adminApi(request);
  const po = await recordablePO(request);
  await loginUi(page, ADMIN);
  await page.goto(`/procurement/purchase-orders/${po}`);
  await page.getByTestId("record-shipment-button").click();
  await expect(page.getByTestId("shipment-form-modal")).toBeVisible();
  await expect(page.getByTestId("shipment-line")).toHaveCount(2);
  const qtys = await page
    .getByTestId("shipment-lines")
    .locator('input[inputmode="numeric"]')
    .evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
  expect(qtys.sort()).toEqual(["10", "5"]);
});

test("(d) partial quantity is recorded", async ({ page, request }) => {
  test.setTimeout(120_000);
  await adminApi(request);
  const po = await recordablePO(request);
  await loginUi(page, ADMIN);
  await page.goto(`/procurement/purchase-orders/${po}`);
  await page.getByTestId("record-shipment-button").click();
  await page.getByTestId("shipment-line-qty-0").fill("3");
  await page.getByTestId("shipment-bl").fill(`BL-PARTIAL-${Date.now()}`);
  await page.getByTestId("shipment-submit").click();
  const shipId = await recordedShipmentId(page);
  const ship = (await (await request.get(`${API}/shipments/${shipId}`)).json()) as {
    manifestLines: Array<{ quantityDeclared: number }>;
  };
  expect(ship.manifestLines.some((l) => l.quantityDeclared === 3), "partial qty recorded").toBe(true);
});

test("(e) a removed line is excluded from the shipment", async ({ page, request }) => {
  test.setTimeout(120_000);
  await adminApi(request);
  const po = await recordablePO(request);
  await loginUi(page, ADMIN);
  await page.goto(`/procurement/purchase-orders/${po}`);
  await page.getByTestId("record-shipment-button").click();
  await expect(page.getByTestId("shipment-line")).toHaveCount(2);
  await page.getByTestId("shipment-remove-line-1").click();
  await expect(page.getByTestId("shipment-line")).toHaveCount(1);
  await page.getByTestId("shipment-submit").click();
  const shipId = await recordedShipmentId(page);
  const ship = (await (await request.get(`${API}/shipments/${shipId}`)).json()) as {
    manifestLines: unknown[];
  };
  expect(ship.manifestLines.length).toBe(1);
});

test("(f) DISCONTINUED variant on a pre-seeded line is kept and shippable", async ({ page, request }) => {
  test.setTimeout(120_000);
  await adminApi(request);
  // Variant is ACTIVE when the PO is raised, then discontinued before shipping
  // (the real existing-commitment case; PO create requires the variant active).
  const variantId = await createVariant(request, `E2E-SHIPDISC-${Date.now()}`, false);
  const po = await createPiReceivedPO(request, [
    { productVariantId: variantId, quantityOrdered: 4, unitPrice: "1000000" },
  ]);
  await request.patch(`${API}/product-variants/${variantId}`, { data: { status: "DISCONTINUED" } });
  await loginUi(page, ADMIN);
  await page.goto(`/procurement/purchase-orders/${po}`);
  await page.getByTestId("record-shipment-button").click();
  await expect(page.getByTestId("shipment-form-modal")).toBeVisible();
  await expect(page.getByTestId("shipment-line-discontinued")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("shipment-submit").click();
  await recordedShipmentId(page); // create succeeded despite the discontinued line
});

test("(g) successful create surfaces the shipment (IN_TRANSIT) and links to it", async ({ page, request }) => {
  test.setTimeout(120_000);
  await adminApi(request);
  const po = await recordablePO(request);
  await loginUi(page, ADMIN);
  await page.goto(`/procurement/purchase-orders/${po}`);
  await page.getByTestId("record-shipment-button").click();
  await page.getByTestId("shipment-bl").fill(`BL-OK-${Date.now()}`);
  await page.getByTestId("shipment-submit").click();
  await expect(page.getByTestId("record-shipment-notification")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("record-shipment-view-link").click();
  await page.waitForURL(/\/procurement\/shipments\/[^/?]+$/, { timeout: 20_000 });
  await expect(page.locator('[title="InTransit"]').first()).toBeVisible({ timeout: 15_000 });
});

test("(h) edit a pre-receive shipment persists changes", async ({ page, request }) => {
  test.setTimeout(120_000);
  await adminApi(request);
  const po = await recordablePO(request);
  await loginUi(page, ADMIN);
  await page.goto(`/procurement/purchase-orders/${po}`);
  await page.getByTestId("record-shipment-button").click();
  await page.getByTestId("shipment-submit").click();
  const shipId = await recordedShipmentId(page);
  await page.getByTestId("record-shipment-view-link").click();
  await page.waitForURL(/\/procurement\/shipments\/[^/?]+$/, { timeout: 20_000 });
  await page.getByTestId("edit-shipment-button").click();
  await expect(page.getByTestId("shipment-form-modal")).toBeVisible();
  const newVessel = `MV E2E ${Date.now()}`;
  await page.getByTestId("shipment-vessel").fill(newVessel);
  await page.getByTestId("shipment-submit").click();
  await expect(page.getByTestId("shipment-form-modal")).toHaveCount(0, { timeout: 15_000 });
  const ship = (await (await request.get(`${API}/shipments/${shipId}`)).json()) as { vesselName: string | null };
  expect(ship.vesselName).toBe(newVessel);
});

test("(i) edit is hidden once the shipment is RECEIVED", async ({ page }) => {
  test.setTimeout(90_000);
  await loginUi(page, ADMIN);
  await page.goto(`/procurement/shipments/${SHIP_RECEIVED}`);
  await page.waitForTimeout(1500);
  await expect(page.getByTestId("edit-shipment-button")).toHaveCount(0);
});

test("(j) end-to-end: created shipment can be cleared and received into inventory", async ({ page, request }) => {
  test.setTimeout(150_000);
  await adminApi(request);
  const po = await recordablePO(request);
  await loginUi(page, ADMIN);
  await page.goto(`/procurement/purchase-orders/${po}`);
  await page.getByTestId("record-shipment-button").click();
  await page.getByTestId("shipment-submit").click();
  const shipId = await recordedShipmentId(page);

  // Advance to CLEARED and receive one unit (existing flow) via the API.
  for (const status of ["AT_PORT", "CLEARING", "CLEARED"]) {
    const r = await request.patch(`${API}/shipments/${shipId}`, { data: { status } });
    expect(r.status(), `patch ${status}`).toBe(200);
  }
  const ship = (await (await request.get(`${API}/shipments/${shipId}`)).json()) as {
    manifestLines: Array<{ id: string; productVariantId: string }>;
  };
  const line = ship.manifestLines[0];
  const stamp = `${Date.now()}`;
  const recv = await request.post(`${API}/shipments/${shipId}/receive-units`, {
    data: { lines: [{ manifestLineId: line.id, units: [{ engineNumber: `E2E-ENG-${stamp}`, chassisNumber: `E2E-CHS-${stamp}` }] }] },
  });
  expect([200, 201], `receive-units status ${recv.status()}`).toContain(recv.status());
  const after = (await (await request.get(`${API}/shipments/${shipId}`)).json()) as {
    manifestLines: Array<{ quantityReceived: number }>;
  };
  expect(after.manifestLines.some((l) => l.quantityReceived >= 1), "unit received into inventory").toBe(true);
});

test("(k) responsive: record action + form fit at 375/768/1280", async ({ page, request }) => {
  test.setTimeout(150_000);
  await adminApi(request);
  const po = await recordablePO(request);
  await loginUi(page, ADMIN);
  const over = async () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  for (const w of [375, 768, 1280]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto(`/procurement/purchase-orders/${po}`);
    await expect(page.getByTestId("record-shipment-button")).toBeVisible({ timeout: 20_000 });
    expect(await over(), `PO detail overflow ${w}`).toBeLessThanOrEqual(1);
    await page.getByTestId("record-shipment-button").click();
    await expect(page.getByTestId("shipment-form-modal")).toBeVisible();
    expect(await over(), `shipment form overflow ${w}`).toBeLessThanOrEqual(1);
    await page.keyboard.press("Escape");
  }
});
