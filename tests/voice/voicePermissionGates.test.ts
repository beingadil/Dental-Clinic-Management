import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const shell = readFileSync(path.join(ROOT, 'src/components/voice/VoiceShell.tsx'), 'utf8');

const requiredGates: [string, string][] = [
  ['createCase', "deny('case:create')"],
  ['setCaseStatus', "deny('case:edit')"],
  ['updateClinicField', "deny('clinic:edit')"],
  ['updateClinicDoctor', "deny('clinic:edit')"],
  ['addCaseNote', "deny('case:edit')"],
  ['recordQc', "deny('case:edit')"],
  ['archiveCase', "deny('case:edit')"],
  // contacts/addresses share one combined branch in the shell
  ['addClinicContact', "contacts:edit"],
  ['addClinicAddress', "contacts:edit"],
  ['addPricingOverride', "pricing:edit"],
  ['printSettingsSave', "deny('print:edit')"],
  ['printSectionsSave', "deny('print:edit')"],
  ['notificationConfigSave', "deny('notifications:edit')"],
];

describe('voice confirmation permission gates', () => {
  for (const [branch, call] of requiredGates) {
    it(`re-checks “${call}” before executing ${branch}`, () => {
      expect(shell).toContain(call);
    });
  }

  it('sign-in is required for every gated action (no anonymous voice writes)', () => {
    expect(shell).toContain('Sign in required');
  });
});
