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
  // NOT the greeting's WORDS. The dashboard greets by the hour - "Good
  // morning" before noon, "Good afternoon" until five, "Good evening" after
  // that, "Still up" after midnight - so a test that waits for one of those
  // strings passes in the evening and fails every other hour of the day.
  // The greeting element has a test hook, so wait for the element.
  await expect(page.locator('[data-purpose="dashboard-greeting"]')).toBeVisible({ timeout: 15000 });
}

/* Every Playwright test runs in a fresh browser context with an empty database,
   so there is never a pre-existing clinic to open. Each test registers its own
   clinic through the real form and then works with it. */
function uniqueClinicName(base: string) {
  return `${base} ${Date.now()}`;
}

async function navigateToClinics(page: any) {
  // Same first-mount caveat as clinic.spec: give the LabsView cold-compile room.
  await page.getByRole('button', { name: 'Dental Clinics' }).click();
  await expect(page.getByRole('heading', { name: 'Dental Clinics & Practices' })).toBeVisible({ timeout: 30_000 });
}

/**
 * Register a clinic through the real form. LabDetailModal auto-opens on success
 * (handleCreateSubmit calls setSelectedLab(newLab)); the caller decides whether
 * to keep it open or close it.
 */
async function registerClinic(page: any, baseName: string) {
  const clinicName = uniqueClinicName(baseName);

  await page.getByRole('button', { name: 'Register New Clinic' }).click();
  await expect(page.getByRole('heading', { name: 'Register New Dental Clinic' })).toBeVisible();

  await page.getByPlaceholder('e.g. Malik Dental Care & Clinic').fill(clinicName);
  await page.getByPlaceholder('Dr. Faisal Mahmood').fill('Dr. E2E');
  await page.getByPlaceholder('leave blank if the clinic starts at zero').fill('5000');

  await page.getByRole('button', { name: 'Register Clinic', exact: true }).click();

  // Wait until the auto-opened detail modal shows the clinic header.
  await expect(page.locator('h2', { hasText: clinicName })).toBeVisible({ timeout: 15_000 });
  return clinicName;
}

/**
 * E2E: Clinic detail modal and Account Ledger.
 */
test.describe('Clinic detail', () => {
  test.setTimeout(60_000);

  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page);
    await navigateToClinics(page);
  });

  test('opens clinic detail and shows Account Ledger tab', async ({ page }) => {
    const clinicName = await registerClinic(page, 'E2E Detail Clinic');

    // Close the auto-opened modal, then reopen the clinic from the list itself:
    // the whole card is the click target (the "View Cases" label is not a button).
    await page.locator('button[title="Close"]').click();

    // The freshly created clinic is the only card in this fresh session.
    await page.locator('h3', { hasText: clinicName }).click();

    // The detail modal header is an h2 with the clinic name; the first tab is
    // "Clinic Cases (N)".
    await expect(page.locator('h2', { hasText: clinicName })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: /Clinic Cases/ })).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: 'Account Ledger' }).click();

    // The ledger tab renders Receive Payment and Record Adjustment actions.
    await expect(page.getByRole('button', { name: 'Receive Payment' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Record Adjustment' })).toBeVisible({ timeout: 15_000 });
  });

  test('opens Record Adjustment modal with debit/credit options', async ({ page }) => {
    const clinicName = await registerClinic(page, 'E2E Adjustment Clinic');

    // Detail modal is already open from registration; go to the ledger tab.
    await page.getByRole('button', { name: 'Account Ledger' }).click();
    await page.getByRole('button', { name: 'Record Adjustment' }).click();

    // RecordAdjustmentModal carries its own heading (the ledger button of the
    // same name stays visible behind it, so target the heading element).
    await expect(page.locator('h3', { hasText: 'Record Adjustment' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Debit Adjustment' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Credit Note' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Refund' })).toBeVisible({ timeout: 15_000 });
  });
});
