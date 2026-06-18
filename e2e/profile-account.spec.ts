import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Self-service account page (/profile) + the login forgot-password affordance.
 * Profile view + change-own-password (existing POST /api/auth/reset-password),
 * wrong-current rejection, unauthenticated redirect, the forgot-password
 * informational page, and responsive layout.
 *
 * Change-password is exercised with a THROWAWAY user (created + reset to a known
 * password, deleted at the end) so no shared fixture account's password is
 * disturbed.
 */
const PASSWORD = process.env.E2E_USER_PASSWORD ?? "E2ePass!234";
const ADMIN = process.env.E2E_ADMIN_EMAIL ?? "itadmin@enviable.example";
const READONLY = "md-demo@enviable.example";
const DEFAULT_PW = process.env.E2E_DEFAULT_INITIAL_PASSWORD ?? "ChangeMe!2026";

async function loginUi(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
}

async function adminApi(ctx: APIRequestContext): Promise<string> {
  const res = await ctx.post("http://localhost:3000/api/auth/login", {
    data: { email: ADMIN, password: PASSWORD },
  });
  expect(res.status(), "itadmin api login").toBe(200);
  const roles = (await (await ctx.get("http://localhost:3000/api/roles")).json()) as Array<{
    id: string;
    name: string;
  }>;
  return (roles.find((r) => r.name === "Sales Officer (Warehouse)") ?? roles[0]).id;
}

test("profile shows own identity and fits at 375", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await loginUi(page, READONLY, PASSWORD);
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  await page.goto("/profile");
  await page.waitForTimeout(800);
  await expect(page.getByText("md-demo@enviable.example").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Change password" })).toBeVisible();
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over, `profile overflow at 375: +${over}`).toBeLessThanOrEqual(1);
});

test("forgot-password link leads to the informational page", async ({ page }) => {
  await page.goto("/login");
  await page.getByTestId("forgot-password-link").click();
  await page.waitForURL(/\/auth\/forgot-password/);
  await expect(page.getByRole("heading", { name: /forgot your password/i })).toBeVisible();
  await expect(page.getByText(/contact your administrator/i)).toBeVisible();
  await page.getByTestId("forgot-back-to-login").click();
  await page.waitForURL(/\/login/);
});

test("unauthenticated /profile redirects to login", async ({ page }) => {
  await page.goto("/profile");
  await page.waitForURL(/\/login/, { timeout: 20_000 });
});

test("change own password: success, then login with the new password works; wrong current rejected", async ({
  page,
  request,
}) => {
  test.setTimeout(150_000);
  const roleId = await adminApi(request);
  const email = `e2e-profile-${Date.now()}@enviable.example`;
  const created = await request.post("http://localhost:3000/api/users", {
    data: { fullName: "E2E Profile User", email, roleIds: [roleId] },
  });
  expect(created.status()).toBe(201);
  const userId = ((await created.json()) as { user: { id: string } }).user.id;
  const P1 = "FirstChosen!1";
  const P2 = "SecondChosen!2";

  try {
    // First login with the default -> forced reset -> set P1 (now a normal user).
    await loginUi(page, email, DEFAULT_PW);
    await page.waitForURL(/\/auth\/reset-password/, { timeout: 20_000 });
    await page.getByTestId("reset-current-password").fill(DEFAULT_PW);
    await page.getByTestId("reset-new-password").fill(P1);
    await page.getByTestId("reset-confirm-password").fill(P1);
    await page.getByTestId("reset-submit").click();
    await page.waitForURL((u) => !u.pathname.startsWith("/auth/reset-password"), { timeout: 20_000 });

    // Wrong current password is rejected.
    await page.goto("/profile");
    await page.getByTestId("profile-current-password").fill("WrongCurrent!9");
    await page.getByTestId("profile-new-password").fill(P2);
    await page.getByTestId("profile-confirm-password").fill(P2);
    await page.getByTestId("profile-password-submit").click();
    await expect(page.getByTestId("profile-password-error")).toBeVisible({ timeout: 15_000 });

    // Correct current password succeeds.
    await page.getByTestId("profile-current-password").fill(P1);
    await page.getByTestId("profile-new-password").fill(P2);
    await page.getByTestId("profile-confirm-password").fill(P2);
    await page.getByTestId("profile-password-submit").click();
    await expect(page.getByTestId("profile-password-success")).toBeVisible({ timeout: 15_000 });

    // The new password works on a fresh login; the old one does not.
    await page.context().clearCookies();
    const okNew = await request.post("http://localhost:3000/api/auth/login", {
      data: { email, password: P2 },
    });
    expect(okNew.status(), "login with new password").toBe(200);
    const oldFails = await request.post("http://localhost:3000/api/auth/login", {
      data: { email, password: P1 },
    });
    expect(oldFails.status(), "old password no longer works").toBe(401);
  } finally {
    // Re-auth as admin (the request context's cookie may have changed) and delete.
    await request.post("http://localhost:3000/api/auth/login", {
      data: { email: ADMIN, password: PASSWORD },
    });
    await request.delete(`http://localhost:3000/api/users/${userId}`);
  }
});
