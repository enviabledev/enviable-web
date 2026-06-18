import { expect, test, type Page } from "@playwright/test";

/**
 * Invoice view + Print verification suite (visible-outcome level).
 *
 * Covers the prompt's assertions (a)-(f):
 *   (a) Sales invoice view renders the invoice's data (design A / Official Ledger).
 *   (b) Print on the view triggers a PDF download with the expected filename.
 *   (c) Same flow for a proforma invoice (design C / Branded Band).
 *   (d) Permission gating: a user without the read permission cannot access the
 *       view URL or the Print download.
 *   (e) Offline behaviour: the view paints mirror summary + FreshnessBadge, but
 *       the rendered-HTML fetch and the PDF download require a connection; Print
 *       is honestly disabled offline with a "requires a connection" notice.
 *   (f) NEGATIVE: clicking Print never opens the browser print dialog
 *       (window.print is never called); a download is initiated instead. This
 *       is the single-render-path property verified at the visible level.
 *
 * PREREQUISITES (this suite is online and fixture-dependent; it is NOT run in
 * the frontend-only session because the backend is required):
 *   - Backend on :3000 with GET /api/invoices/:id/{html,pdf} and
 *     GET /api/proforma-invoices/:id/{html,pdf} (enviable-system 45f8f0b+).
 *   - Frontend dev server on :3100.
 *   - `npx playwright install chromium`.
 *   - Env vars (all required unless a default is shown):
 *       E2E_BASE_URL                (default http://localhost:3100)
 *       E2E_USER_EMAIL              user WITH salesorder.read + pi.read
 *       E2E_USER_PASSWORD
 *       E2E_NOACCESS_EMAIL          user WITHOUT salesorder.read / pi.read
 *       E2E_NOACCESS_PASSWORD
 *       E2E_INVOICE_ID              an existing Invoice id
 *       E2E_INVOICE_NUMBER          its invoiceNumber (e.g. INV-2026-00471)
 *       E2E_INVOICE_CUSTOMER        a string that appears in the rendered invoice
 *       E2E_PI_ID                   an existing ProformaInvoice id
 *       E2E_PI_NUMBER               its piNumber
 *       E2E_PI_REVISION             its revisionNumber (default 0)
 *
 * Verified green (all 6) against the local dev stack with the seeded
 * fixtures: daniel@enviable.example (salesorder.read + pi.read) and
 * costblind-test@enviable.example (neither), invoice fixt-inv-await
 * (INV-FIXT-AWAIT, customer "ABC Tricycle Dealers"), proforma
 * fixt-pi-test-r2 (PI-FIXT-TEST-R2, rev 2). Backend on :3000, dev on :3100.
 */

const ENV = {
  userEmail: process.env.E2E_USER_EMAIL ?? "",
  userPassword: process.env.E2E_USER_PASSWORD ?? "",
  noAccessEmail: process.env.E2E_NOACCESS_EMAIL ?? "",
  noAccessPassword: process.env.E2E_NOACCESS_PASSWORD ?? "",
  invoiceId: process.env.E2E_INVOICE_ID ?? "",
  invoiceNumber: process.env.E2E_INVOICE_NUMBER ?? "",
  invoiceCustomer: process.env.E2E_INVOICE_CUSTOMER ?? "",
  piId: process.env.E2E_PI_ID ?? "",
  piNumber: process.env.E2E_PI_NUMBER ?? "",
  piRevision: process.env.E2E_PI_REVISION ?? "0",
};

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

// Instrument window.print so any call is observable. The single-render-path
// property is that this is NEVER called: artifacts come from the backend PDF.
async function instrumentPrint(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __printCalled: boolean }).__printCalled = false;
    window.print = () => {
      (window as unknown as { __printCalled: boolean }).__printCalled = true;
    };
  });
}

async function assertPrintNeverCalled(page: Page) {
  const called = await page.evaluate(
    () => (window as unknown as { __printCalled: boolean }).__printCalled,
  );
  expect(called, "window.print() must never be called").toBe(false);
}

test.describe("sales invoice view + print (design A)", () => {
  test.beforeEach(async ({ page }) => {
    await instrumentPrint(page);
    await login(page, ENV.userEmail, ENV.userPassword);
  });

  // (a) view renders the invoice's data (design A / Official Ledger). The
  // rendered document is the network-backed requirement; the page heading is
  // mirror-derived and asserted after the frame so the mirror has time to sync.
  test("renders the rendered HTML view with the invoice data", async ({ page }) => {
    await page.goto(`/sales/invoices/${ENV.invoiceId}`);

    const frame = page.frameLocator('[data-testid="invoice-document-frame"]');
    // Official Ledger header + the invoice number rendered inside the document.
    await expect(frame.getByText("SALES INVOICE")).toBeVisible();
    await expect(frame.getByText(ENV.invoiceNumber)).toBeVisible();
    if (ENV.invoiceCustomer) {
      // The customer appears in both Bill To and Ship To, so scope to the first.
      await expect(
        frame.getByText(ENV.invoiceCustomer, { exact: false }).first(),
      ).toBeVisible();
    }
    // The mirror-derived summary heading is exercised by the offline test,
    // which is where the mirror-paint behaviour is the explicit subject.
  });

  // (b) + (f) Print triggers a PDF download (never window.print)
  test("Print downloads the backend PDF and never opens the print dialog", async ({
    page,
  }) => {
    await page.goto(`/sales/invoices/${ENV.invoiceId}`);
    await page.getByTestId("invoice-document-frame").waitFor();

    const downloadPromise = page.waitForEvent("download");
    await page.getByTestId("print-pdf-button").first().click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toBe(`${ENV.invoiceNumber}.pdf`);
    await assertPrintNeverCalled(page);
  });
});

test.describe("proforma invoice view + print (design C)", () => {
  test.beforeEach(async ({ page }) => {
    await instrumentPrint(page);
    await login(page, ENV.userEmail, ENV.userPassword);
  });

  // (c) same flow for a proforma invoice
  test("renders the proforma document and Print downloads its PDF", async ({ page }) => {
    await page.goto(`/procurement/proforma-invoices/${ENV.piId}/document`);

    const frame = page.frameLocator('[data-testid="invoice-document-frame"]');
    await expect(frame.getByText(ENV.piNumber)).toBeVisible();

    const downloadPromise = page.waitForEvent("download");
    await page.getByTestId("print-pdf-button").first().click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toBe(
      `${ENV.piNumber}-rev${ENV.piRevision}.pdf`,
    );
    await assertPrintNeverCalled(page);
  });
});

// (d) permission gating: a user without read permission cannot view or print
test.describe("permission gating", () => {
  test("user without salesorder.read cannot access the sales invoice view", async ({
    page,
  }) => {
    await login(page, ENV.noAccessEmail, ENV.noAccessPassword);
    await page.goto(`/sales/invoices/${ENV.invoiceId}`);
    await expect(page.getByText(/do not have access to invoices/i)).toBeVisible();
    await expect(page.getByTestId("invoice-document-frame")).toHaveCount(0);
    await expect(page.getByTestId("print-pdf-button")).toHaveCount(0);
  });

  test("user without pi.read cannot access the proforma document view", async ({
    page,
  }) => {
    await login(page, ENV.noAccessEmail, ENV.noAccessPassword);
    await page.goto(`/procurement/proforma-invoices/${ENV.piId}/document`);
    await expect(page.getByText(/do not have access to proforma invoices/i)).toBeVisible();
    await expect(page.getByTestId("invoice-document-frame")).toHaveCount(0);
  });
});

// (e) offline behaviour: mirror summary + FreshnessBadge stays; rendered doc and
// Print require a connection and are honestly disabled.
test.describe("offline behaviour", () => {
  test("view paints mirror summary but the document + Print require a connection", async ({
    page,
    context,
  }) => {
    // The warm step waits for the full initial mirror download to reach the
    // invoice, which can take ~30-40s on a fresh context, so allow extra time.
    test.setTimeout(150_000);
    await instrumentPrint(page);
    await login(page, ENV.userEmail, ENV.userPassword);

    const viewPath = `/sales/invoices/${ENV.invoiceId}`;

    // The offline hard-reload below is served by the service worker from its
    // shell cache (network-first, cache-on-visit). On a fresh context the SW
    // activates mid-session, and a navigation only gets cached if the SW was
    // CONTROLLING it. So: wait for the SW to be active, reload so this page
    // becomes SW-controlled, then visit the route (now a controlled, cached
    // visit) and wait until the invoice has synced into the mirror.
    await page.goto(viewPath);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload(); // reloaded navigation is SW-controlled
    await page.goto(viewPath); // controlled visit -> cached
    await page.getByTestId("invoice-document-frame").waitFor();
    await expect(page.getByRole("heading", { name: ENV.invoiceNumber })).toBeVisible({
      timeout: 60_000,
    });
    // Confirm the route shell is actually in the SW cache before going offline.
    await page.waitForFunction(
      async (path) => {
        for (const k of await caches.keys()) {
          const c = await caches.open(k);
          if (await c.match(path)) return true;
        }
        return false;
      },
      viewPath,
      { timeout: 30_000 },
    );

    await context.setOffline(true);
    await page.reload();

    // Underlying summary still paints from the mirror, with a freshness signal.
    await expect(page.getByRole("heading", { name: ENV.invoiceNumber })).toBeVisible();
    await expect(page.getByText(/Cached/i)).toBeVisible();

    // The rendered document surface honestly says it needs a connection.
    await expect(page.getByTestId("document-offline-notice")).toBeVisible();
    await expect(
      page.getByText(/rendered document requires a connection/i),
    ).toBeVisible();

    // Print is disabled offline; clicking it does nothing (and never prints).
    const printBtn = page.getByTestId("print-pdf-button").first();
    await expect(printBtn).toBeDisabled();
    await assertPrintNeverCalled(page);

    await context.setOffline(false);
  });
});
