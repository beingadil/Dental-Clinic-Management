import { describe, it, expect } from 'vitest';
import { toCSV } from '../../src/services/csvExport';

describe('csvExport (B9 RFC-4180)', () => {
  it('joins rows with CRLF and commas', () => {
    const rows = [
      ['Invoice #', 'Amount'],
      ['INV-0001', '25,000'],
    ];
    expect(toCSV(rows)).toBe('Invoice #,Amount\r\nINV-0001,"25,000"\r\n');
  });

  it('quotes fields containing commas, quotes, newlines', () => {
    const rows = [['Acme, Inc.', 'He said "paid"'], ['line1\nline2', 'x']];
    const csv = toCSV(rows);
    expect(csv).toContain('"Acme, Inc."');
    expect(csv).toContain('"He said ""paid"""');
    expect(csv).toContain('"line1\nline2"');
  });

  it('does not quote plain fields', () => {
    expect(toCSV([['INV-0002', '101000', 'paid']])).toBe('INV-0002,101000,paid\r\n');
  });

  it('handles null/undefined as empty fields', () => {
    expect(toCSV([['a', null as unknown as string, 'c'], ['x', undefined as unknown as string, 'z']])).toBe('a,,c\r\nx,,z\r\n');
  });

  it('handles unicode clinic names', () => {
    expect(toCSV([['کلینک', 'PKR 5,000']])).toBe('کلینک,"PKR 5,000"\r\n');
  });

  it('returns empty string for no rows', () => {
    expect(toCSV([])).toBe('');
  });
});
