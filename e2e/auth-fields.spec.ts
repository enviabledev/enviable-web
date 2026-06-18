import { expect, test } from "@playwright/test";

/**
 * Login/auth field behaviour: the password reveal (show/hide) toggle and that
 * copy/paste into the email + password fields is NOT blocked (the fields are
 * plain controlled inputs with no onPaste/user-select interference).
 */
const EMAIL = "md-demo@enviable.example";
const PASSWORD = process.env.E2E_USER_PASSWORD ?? "E2ePass!234";

// Clipboard read/write so the paste test can use a real Ctrl/Cmd+V.
test.use({ permissions: ["clipboard-read", "clipboard-write"] });

test("password reveal toggle flips between hidden and visible", async ({ page }) => {
  await page.goto("/login");
  const pw = page.getByTestId("login-password");
  await pw.fill("SecretValue1");
  // Hidden by default.
  await expect(pw).toHaveAttribute("type", "password");
  // Reveal -> text.
  await page.getByTestId("login-password-reveal").click();
  await expect(pw).toHaveAttribute("type", "text");
  await expect(pw).toHaveValue("SecretValue1");
  // Hide again -> password.
  await page.getByTestId("login-password-reveal").click();
  await expect(pw).toHaveAttribute("type", "password");
});

test("email and password fields accept paste", async ({ page }) => {
  await page.goto("/login");

  // Paste into email.
  await page.evaluate(() => navigator.clipboard.writeText("pasted@enviable.example"));
  const email = page.getByLabel(/email/i);
  await email.click();
  await page.keyboard.press("ControlOrMeta+KeyV");
  await expect(email).toHaveValue("pasted@enviable.example");

  // Paste into password (reveal first so the assertion reads the value).
  await page.getByTestId("login-password-reveal").click();
  await page.evaluate(() => navigator.clipboard.writeText("Pasted!Password9"));
  const pw = page.getByTestId("login-password");
  await pw.click();
  await page.keyboard.press("ControlOrMeta+KeyV");
  await expect(pw).toHaveValue("Pasted!Password9");
});

test("login still works with the password reveal field", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(EMAIL);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20_000 });
  await expect(page).not.toHaveURL(/\/login/);
});
