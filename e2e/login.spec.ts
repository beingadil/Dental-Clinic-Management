import { test, expect } from '@playwright/test';

/**
 * Helper to ensure we're logged in.
 */
async function ensureLoggedIn(page: any) {
  await page.goto('/');

  // Wait for the app to render either the first-run setup form or the sign-in
  // form. Under React StrictMode (dev server) the tree mounts twice, so we
  // settle briefly before inspecting which screen is showing.
  await page
    .locator('text=Create the administrator')
    .or(page.locator('text=Welcome back'))
    .waitFor({ timeout: 15000 })
    .catch(() => {});
  await page.waitForTimeout(1000);

  const setupVisible = await page.getByText('Create the administrator').isVisible().catch(() => false);
  if (setupVisible) {
    await page.fill('#setup-name', 'Test Admin');
    await page.fill('#setup-username', 'admin');
    await page.fill('#setup-password', 'password123');

    // Make sure the submit button is actually enabled before clicking.
    await expect(page.locator('button:has-text("Create administrator")')).toBeEnabled({ timeout: 5000 });
    await page.click('button:has-text("Create administrator")');

    // Wait for the transition to the sign-in screen to complete.
    await expect(page.getByText('Welcome back')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Create the administrator')).not.toBeVisible({ timeout: 10000 }).catch(() => {});
  }

  // Wait for the login form to be fully rendered and stable before filling.
  // React may detach/re-attach the input while the screen is transitioning,
  // so we wait for visibility, then give the DOM a moment to settle.
  await page.waitForSelector('#login-user', { state: 'visible', timeout: 15000 });
  await page.waitForTimeout(1000);
  await expect(page.locator('#login-user')).toBeEnabled({ timeout: 5000 });

  await page.fill('#login-user', 'admin');
  await page.fill('#login-password', 'password123');
  await page.click('button:has-text("Sign in")');
  await expect(page.getByText('Good evening')).toBeVisible({ timeout: 15000 });
}

/**
 * E2E: First-run setup and login.
 */
test.describe('First run and login', () => {
  test('creates an admin account on first visit or logs in if already set up', async ({ page }) => {
    await ensureLoggedIn(page);
    await expect(page.getByText('Good evening')).toBeVisible();
  });
});