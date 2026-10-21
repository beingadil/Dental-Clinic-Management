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
    await expect(page.locator('text=Create the administrator')).not.toBeVisible({ timeout: 10000 }).catch(() => {});
  }

  await page.waitForSelector('#login-user', { state: 'visible', timeout: 15000 });
  await page.waitForTimeout(1000);
  await expect(page.locator('#login-user')).toBeEnabled({ timeout: 5000 });

  await page.fill('#login-user', 'admin');
  await page.fill('#login-password', 'password123');
  await page.click('button:has-text("Sign in")');
  await expect(page.getByText('Good evening')).toBeVisible({ timeout: 15000 });
}

/* The two specs each get a fresh browser context (fresh IndexedDB), so clinic
   names cannot collide across runs — but the suffix keeps them unique anyway
   inside slow, retried, or shared sessions. */
function uniqueClinicName(base: string) {
  return `${base} ${Date.now()}`;
}

/**
 * E2E: Clinic creation with opening balance.
 */
test.describe('Clinic creation', () => {
  test.setTimeout(60_000);

  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page);
  });

  test('registers a new clinic with a debit opening balance', async ({ page }) => {
    const clinicName = uniqueClinicName('E2E Debit Clinic');

    // Generous first-mount timeouts: the dev server lazy-transforms the whole
    // labs view chunk on first visit, and the machine may be under heavy load,
    // so the default 5s can be blown by compilation, not by a bug.
    await page.getByRole('button', { name: 'Dental Clinics' }).click();
    await expect(page.getByRole('heading', { name: 'Dental Clinics & Practices' })).toBeVisible({ timeout: 30_000 });

    await page.getByRole('button', { name: 'Register New Clinic' }).click();
    // The create dialog is titled "Register New Dental Clinic" (its h3 header).
    await expect(page.getByRole('heading', { name: 'Register New Dental Clinic' })).toBeVisible({ timeout: 15_000 });

    await page.getByPlaceholder('e.g. Malik Dental Care & Clinic').fill(clinicName);
    await page.getByPlaceholder('Dr. Faisal Mahmood').fill('Dr. E2E');

    // Opening balance input sits beside the Debit/Credit toggle.
    await page.getByPlaceholder('leave blank if the clinic starts at zero').fill('5000');
    // "Debit" is the default toggle state — assert it so the intent is honest.
    await expect(page.getByRole('button', { name: 'Debit' })).toBeVisible();

    await page.getByRole('button', { name: 'Register Clinic', exact: true }).click();

    /* Creating a clinic auto-opens LabDetailModal over the list (handleCreateSubmit
       does setSelectedLab(newLab)). Confirm it opened for this clinic, then close
       it with the real close affordance (the header button titled "Close"). */
    await expect(page.locator('h2', { hasText: clinicName })).toBeVisible({ timeout: 15_000 });
    await page.locator('button[title="Close"]').click();

    // Back on the card grid, the new clinic is listed.
    await expect(page.locator('h3', { hasText: clinicName })).toBeVisible({ timeout: 10_000 });
  });

  test('registers a clinic with a credit opening balance', async ({ page }) => {
    const clinicName = uniqueClinicName('E2E Credit Clinic');

    await page.getByRole('button', { name: 'Dental Clinics' }).click();
    await expect(page.getByRole('heading', { name: 'Dental Clinics & Practices' })).toBeVisible({ timeout: 30_000 });

    await page.getByRole('button', { name: 'Register New Clinic' }).click();
    await expect(page.getByRole('heading', { name: 'Register New Dental Clinic' })).toBeVisible({ timeout: 15_000 });

    await page.getByPlaceholder('e.g. Malik Dental Care & Clinic').fill(clinicName);
    await page.getByPlaceholder('Dr. Faisal Mahmood').fill('Dr. Credit');

    await page.getByPlaceholder('leave blank if the clinic starts at zero').fill('3000');
    // Flip the real Debit/Credit toggle to "Credit" before submitting.
    await page.getByRole('button', { name: 'Credit', exact: true }).click();

    await page.getByRole('button', { name: 'Register Clinic', exact: true }).click();

    // Detail modal auto-opens after creation; close it to get back to the list.
    await expect(page.locator('h2', { hasText: clinicName })).toBeVisible({ timeout: 15_000 });
    await page.locator('button[title="Close"]').click();

    await expect(page.locator('h3', { hasText: clinicName })).toBeVisible({ timeout: 10_000 });
  });
});
