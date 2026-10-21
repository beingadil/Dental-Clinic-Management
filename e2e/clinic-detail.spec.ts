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
 * E2E: Clinic detail modal and Account Ledger.
 */
test.describe('Clinic detail', () => {
  test('opens clinic detail and shows Account Ledger tab', async ({ page }) => {
    await ensureLoggedIn(page);

    await page.click('button:has-text("Dental Clinics")');
    await expect(page.getByText('Dental Clinics & Practices')).toBeVisible();

    await page.click('button:has-text("List")');

    const viewBtn = page.locator('table tbody tr').first().locator('button:has-text("View")');
    await viewBtn.click();

    await expect(page.getByText('Clinic Cases')).toBeVisible({ timeout: 5000 });

    await page.click('button:has-text("Account Ledger")');

    await expect(page.getByText('Receive Payment')).toBeVisible();
    await expect(page.getByText('Record Adjustment')).toBeVisible();
  });

  test('opens Record Adjustment modal with debit/credit options', async ({ page }) => {
    await ensureLoggedIn(page);

    await page.click('button:has-text("Dental Clinics")');
    await page.click('button:has-text("List")');
    const viewBtn = page.locator('table tbody tr').first().locator('button:has-text("View")');
    await viewBtn.click();
    await page.click('button:has-text("Account Ledger")');
    await page.click('button:has-text("Record Adjustment")');

    await expect(page.getByText('Record Adjustment')).toBeVisible();
    await expect(page.getByText('Debit Adjustment')).toBeVisible();
    await expect(page.getByText('Credit Note')).toBeVisible();
    await expect(page.getByText('Refund')).toBeVisible();
  });
});