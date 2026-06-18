import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

/**
 * User/role module functional verification (prompt 31). Visible-outcome
 * assertions for the forced-password-reset gate (the security flow), the
 * create-user flow (no password field + post-creation default-password
 * notification), permission gating, self-modification footguns, and the
 * read-only roles catalogue.
 *
 * Users: itadmin (user.manage + role.manage + all reads) drives the admin
 * surface; md-demo (user.read + role.read, NOT user.manage) verifies gating.
 * The default initial password is the dev value set on the backend env
 * (ChangeMe!2026). Activate fixture passwords with the sibling set-password if
 * a login 401s.
 *
 * Prereqs: backend :3000 (running the user/role module + DEFAULT_INITIAL_PASSWORD),
 * dev :3100, fixtures seeded.
 */
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "itadmin@enviable.example";
const READONLY_EMAIL = process.env.E2E_READONLY_EMAIL ?? "md-demo@enviable.example";
const PASSWORD = process.env.E2E_USER_PASSWORD ?? "E2ePass!234";
const DEFAULT_PW = process.env.E2E_DEFAULT_INITIAL_PASSWORD ?? "ChangeMe!2026";

async function loginUi(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
}

/**
 * Authenticate an isolated API context (the `request` fixture, separate from
 * the page's cookie jar) as itadmin, for test data setup/teardown. Using the
 * page's own request context would break here: a UI login as a created
 * must-reset user would clobber the itadmin session and the cleanup delete
 * would 403.
 */
async function adminApi(ctx: APIRequestContext): Promise<APIRequestContext> {
  const res = await ctx.post("http://localhost:3000/api/auth/login", {
    data: { email: ADMIN_EMAIL, password: PASSWORD },
  });
  expect(res.status(), "itadmin api login").toBe(200);
  return ctx;
}

async function firstRoleId(ctx: APIRequestContext): Promise<string> {
  const res = await ctx.get("http://localhost:3000/api/roles");
  const roles = (await res.json()) as Array<{ id: string; name: string }>;
  const so = roles.find((r) => r.name === "Sales Officer (Warehouse)") ?? roles[0];
  return so.id;
}

test("forced-reset gate: default-pw login is blocked until the password is reset", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const ctx = await adminApi(request);
  const roleId = await firstRoleId(ctx);
  const email = `e2e-reset-${Date.now()}@enviable.example`;
  const created = await ctx.post("http://localhost:3000/api/users", {
    data: { fullName: "E2E Reset User", email, roleIds: [roleId] },
  });
  expect(created.status(), "create must-reset user").toBe(201);
  const userId = ((await created.json()) as { id: string }).id;

  try {
    // Log in via the UI with the default password.
    await loginUi(page, email, DEFAULT_PW);
    // Gated straight to the reset screen, NOT the app.
    await page.waitForURL(/\/auth\/reset-password/, { timeout: 20_000 });
    await expect(page.getByRole("heading", { name: /set a new password/i })).toBeVisible();

    // Attempting a protected route bounces back to reset (cannot reach the app).
    await page.goto("/inventory/units");
    await page.waitForURL(/\/auth\/reset-password/, { timeout: 20_000 });

    // Complete the reset.
    await page.getByTestId("reset-current-password").fill(DEFAULT_PW);
    await page.getByTestId("reset-new-password").fill("FreshPass!2026");
    await page.getByTestId("reset-confirm-password").fill("FreshPass!2026");
    await page.getByTestId("reset-submit").click();

    // Lands in the app; the gate is cleared, protected routes now reachable.
    await page.waitForURL((u) => !u.pathname.startsWith("/auth/reset-password"), { timeout: 20_000 });
    await page.goto("/inventory/units");
    await page.waitForTimeout(1200);
    await expect(page).toHaveURL(/\/inventory\/units/);
  } finally {
    await ctx.delete(`http://localhost:3000/api/users/${userId}`);
  }
});

test("create-user flow: no password field, post-creation default-password notification", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const ctx = await adminApi(request);
  const email = `e2e-create-${Date.now()}@enviable.example`;
  let createdId: string | null = null;

  try {
    await loginUi(page, ADMIN_EMAIL, PASSWORD);
    await page.waitForURL((u) => !u.pathname.startsWith("/login"));
    await page.goto("/admin/users");
    await page.waitForTimeout(1500);

    await page.getByTestId("create-user-button").click();
    const modal = page.getByTestId("create-user-modal");
    await expect(modal).toBeVisible();
    // Password discipline: there is NO password input anywhere in the modal.
    await expect(modal.locator('input[type="password"]')).toHaveCount(0);

    await page.getByTestId("create-user-fullname").fill("E2E Created User");
    await page.getByTestId("create-user-email").fill(email);
    // Pick the first role checkbox/option in the modal.
    await modal.locator('[data-testid^="create-user-role-"]').first().click();
    await page.getByTestId("create-user-submit").click();

    // Post-creation notification names the default-password workflow without showing the value.
    const note = page.getByTestId("create-user-notification");
    await expect(note).toBeVisible({ timeout: 20_000 });
    await expect(note).toContainText(/default/i);
    await expect(note).toContainText(/first login/i);

    // The new user is now in the list.
    await expect(page.getByText(email)).toBeVisible({ timeout: 20_000 });

    const found = await ctx.get(
      `http://localhost:3000/api/users?search=${encodeURIComponent(email)}`,
    );
    const body = (await found.json()) as { data: Array<{ id: string; email: string }> };
    createdId = body.data.find((u) => u.email === email)?.id ?? null;
    expect(createdId, "created user found via api").not.toBeNull();
  } finally {
    if (createdId) await ctx.delete(`http://localhost:3000/api/users/${createdId}`);
  }
});

test("permission gating: read-only user sees the list but no management actions", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await loginUi(page, READONLY_EMAIL, PASSWORD);
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  await page.goto("/admin/users");
  await page.waitForTimeout(1500);
  // List renders (a known fixture user is visible) ...
  await expect(page.getByText(ADMIN_EMAIL)).toBeVisible({ timeout: 20_000 });
  // ... but the read-only user cannot create.
  await expect(page.getByTestId("create-user-button")).toHaveCount(0);
});

test("self-modification footguns hidden: admin viewing own record", async ({ page, request }) => {
  test.setTimeout(90_000);
  const ctx = await adminApi(request);
  const me = await (await ctx.get("http://localhost:3000/api/auth/me")).json();
  const meId = (me as { id: string }).id;

  await loginUi(page, ADMIN_EMAIL, PASSWORD);
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  await page.goto(`/admin/users/${meId}`);
  await page.waitForTimeout(1500);

  // Edit is allowed on one's own record; the lock-out actions are hidden.
  await expect(page.getByTestId("edit-button")).toBeVisible();
  await expect(page.getByTestId("deactivate-button")).toHaveCount(0);
  await expect(page.getByTestId("delete-button")).toHaveCount(0);
  await expect(page.getByTestId("reset-password-button")).toHaveCount(0);
});

test("roles read-only catalogue: list + category-grouped detail, no management affordances", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await loginUi(page, ADMIN_EMAIL, PASSWORD);
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  await page.goto("/admin/roles");
  await page.waitForTimeout(1500);

  await expect(page.getByTestId("roles-readonly-caption")).toBeVisible();
  const firstRole = page.getByTestId("role-row-link").first();
  await expect(firstRole).toBeVisible({ timeout: 20_000 });
  await firstRole.click();

  await page.waitForURL(/\/admin\/roles\/.+/, { timeout: 20_000 });
  await page.waitForTimeout(1500);
  // Permissions render (grouped once the network detail lands).
  await expect(page.getByTestId("role-permission-row").first()).toBeVisible({ timeout: 20_000 });
  // No management affordances anywhere on the read-only catalogue.
  await expect(page.getByRole("button", { name: /create role|new role|edit|delete/i })).toHaveCount(0);
});
