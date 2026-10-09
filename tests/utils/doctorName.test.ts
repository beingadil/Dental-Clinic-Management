import { describe, it, expect } from 'vitest';
import { formatDoctorName, stripDoctorHonorific } from '../../src/utils/doctorName';

describe('stripDoctorHonorific', () => {
  it('strips a dotted prefix', () => {
    expect(stripDoctorHonorific('Dr. Tariq Mahmood')).toBe('Tariq Mahmood');
    expect(stripDoctorHonorific('dr. ahmad')).toBe('ahmad');
  });

  it('strips an undotted prefix', () => {
    expect(stripDoctorHonorific('Dr Ahmad')).toBe('Ahmad');
    expect(stripDoctorHonorific('DR AHMAD')).toBe('AHMAD');
  });

  it('leaves a bare name untouched', () => {
    expect(stripDoctorHonorific('Tariq Mahmood')).toBe('Tariq Mahmood');
  });

  it('is idempotent', () => {
    const once = stripDoctorHonorific('Dr. Dr. Tariq Mahmood');
    expect(once).toBe('Tariq Mahmood');
    expect(stripDoctorHonorific(once)).toBe(once);
  });

  it('does not eat a name that merely starts with those letters', () => {
    // "Drake" starts with "dr" but is not an honorific.
    expect(stripDoctorHonorific('Drake Ahmad')).toBe('Drake Ahmad');
    expect(stripDoctorHonorific('Dr')).toBe('Dr');
    expect(stripDoctorHonorific('Professor X')).toBe('Professor X');
  });

  it('keeps a real academic title rather than downgrading it', () => {
    // A Professor is not a Doctor. Storage keeps the title so the distinction
    // survives; only the duplicated "Dr." is stripped.
    expect(stripDoctorHonorific('Prof. Ahmed Khan')).toBe('Prof. Ahmed Khan');
    expect(stripDoctorHonorific('Prof Ahmed')).toBe('Prof Ahmed');
  });

  it('returns an empty string for absent names', () => {
    expect(stripDoctorHonorific('')).toBe('');
    expect(stripDoctorHonorific('   ')).toBe('');
    expect(stripDoctorHonorific(null)).toBe('');
    expect(stripDoctorHonorific(undefined)).toBe('');
  });
});

describe('formatDoctorName', () => {
  it('adds the honorific to a bare stored name', () => {
    expect(formatDoctorName('Tariq Mahmood')).toBe('Dr. Tariq Mahmood');
  });

  it('is idempotent — the print path can call it on anything', () => {
    expect(formatDoctorName('Dr. Tariq Mahmood')).toBe('Dr. Tariq Mahmood');
    expect(formatDoctorName(formatDoctorName('Tariq Mahmood'))).toBe('Dr. Tariq Mahmood');
  });

  it('normalises the undotted form so the two inputs cannot diverge', () => {
    expect(formatDoctorName('Dr Ahmad')).toBe('Dr. Ahmad');
  });

  it('preserves an academic title instead of relabelling it', () => {
    expect(formatDoctorName('Prof. Ahmed Khan')).toBe('Prof. Ahmed Khan');
    expect(formatDoctorName('Prof Ahmed')).toBe('Prof. Ahmed');
  });

  it('falls back rather than printing "Dr."', () => {
    expect(formatDoctorName('')).toBe('—');
    expect(formatDoctorName('   ')).toBe('—');
    expect(formatDoctorName(null)).toBe('—');
    expect(formatDoctorName(undefined)).toBe('—');
    // A name that is only an honorific has nothing left to print.
    expect(formatDoctorName('Dr.')).toBe('—');
    expect(formatDoctorName('Dr. ', 'Not recorded')).toBe('Not recorded');
  });

  it('accepts a caller-supplied fallback', () => {
    expect(formatDoctorName('', 'Unknown')).toBe('Unknown');
    expect(formatDoctorName('Ahmad', 'Unknown')).toBe('Dr. Ahmad');
  });
});