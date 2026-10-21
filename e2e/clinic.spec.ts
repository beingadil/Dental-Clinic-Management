import { test, expect } from '@playwright/test';

/**
 * Helper to ensure we're logged in.
 */
async function ensureLoggedIn(page: any) {
  await page.goto('/');

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

    await expect(page.locator('button:has-text("Create administrator")')).toBeEnabled({ timeout: 5000 });
    await page.click('button:has-text("Create administrator")');

    await expect(page.getByText('Welcome back')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Create the administrator')).not.toBeVisible({ timeout: 10000 }).catch(() => {});
  }

  await page.waitForSelector('#login-user', { state: 'visible', timeout: 15000 });
  await page.waitForTimeout(1000);
  await expect(page.locator('#login-user')).toBeEnabled({ timeout: 5000 });

  await page.fill('#login-user', 'admin');
  await page.fill('#login-password', 'password123');
  await page.click('button:has-text("Sign in")');
  await expect(page.getByText('Good evening')).toBeVisible({ timeout: 15000 });
}

/**
 * E2E: Clinic creation with opening balance.
 */
test.describe('Clinic creation', () => {
  test('registers a new clinic with a debit opening balance', async ({ page }) => {
    await ensureLoggedIn(page);

    await page.click('button:has-text("Dental Clinics")');
    await expect(page.getByText('Dental Clinics & Practices')).toBeVisible();

    await page.click('button:has-text("Register New Clinic")');
    await expect(page.getByText('Register New Dental Clinic')).toBeVisible();

    await page.fill('input[placeholder="e.g. Malik Dental Care & Clinic"]', 'E2E Debit Clinic');
    await page.fill('input[placeholder="Dr. Faisal Mahmood"]', 'Dr. E2E');

    const obInput = page.locator('input[type="number"][min="0"]');
    await obInput.fill('5000');

    await page.click('button:has-text("Register Clinic")');

    await expect(page.getByText('E2E Debit Clinic')).toBeVisible({ timeout: 5000 });
  });

  test('registers a clinic with a credit opening balance', async ({ page }) => {
    await ensureLoggedIn(page);

    await page.click('button:has-text("Dental Clinics")');
    await expect(page.getByText('Dental Clinics & Practices')).toBeVisible();

    await page.click('button:has-text("Register New Clinic")');
    await expect(page.getByText('Register New Dental Clinic')).toBeVisible();

    await page.fill('input[placeholder="e.g. Malik Dental Care & Clinic"]', 'E2E Credit Clinic');
    await page.fill('input[placeholder="Dr. Faisal Mahmood"]', 'Dr. Credit');

    const obInput = page.locator('input[type="number"][min="0"]');
    await obInput.fill('3000');

    await page.click('button:has-text("Credit")');
    await page.click('button:has-text("Register Clinic")');

    await expect(page.getByText('E2E Credit Clinic')).toBeVisible({ timeout: 5000 });
  });
});