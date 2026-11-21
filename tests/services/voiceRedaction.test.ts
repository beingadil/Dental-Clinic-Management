import { describe, it, expect } from 'vitest';
import { containsClinicalDetail, redactVoiceText } from '../../src/services/voiceRedaction';

describe('voice redaction', () => {
  it('strips phone numbers and emails', () => {
    const out = redactVoiceText('Call me at 0300-1234567 or mail me at dr@example.com');
    expect(out.text).not.toContain('0300-1234567');
    expect(out.text).not.toContain('dr@example.com');
    expect(out.findings.some((f) => f.kind === 'contact')).toBe(true);
  });

  it('strips CNIC-like identifiers', () => {
    const out = redactVoiceText('CNIC 35202-1234567-1 ok');
    expect(out.text).not.toContain('35202-1234567-1');
    expect(out.findings.some((f) => f.kind === 'identifier')).toBe(true);
  });

  it('blocks clinical detail by default and allows it when opted in', () => {
    const clinical = redactVoiceText('Shade A2 crown on tooth 14');
    expect(clinical.blocked).toBe(true);
    const allowed = redactVoiceText('Shade A2 crown on tooth 14', { allowClinicalDetail: true });
    expect(allowed.text).toContain('Shade');
  });

  it('passes PKR amounts through', () => {
    const out = redactVoiceText('Mir Dental owes PKR 99,500 as of October');
    expect(out.text).toContain('PKR 99,500');
  });

  it('containsClinicalDetail detects terms', () => {
    expect(containsClinicalDetail('root canal done')).toBe(true);
    expect(containsClinicalDetail('balance is settled')).toBe(false);
  });
});
