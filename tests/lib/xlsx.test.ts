import { describe, it, expect } from 'vitest';
import { buildXlsx, XL } from '../../src/lib/xlsx';

/**
 * The XLSX writer's own contract.
 *
 * An XLSX is a ZIP of XML parts, and both halves have to be exactly right:
 * a ZIP that Excel cannot open is a corrupt file, and a sheet whose numbers
 * are TEXT is a spreadsheet that cannot be summed. The ZIP is written STORED,
 * so the parts can be read back out of the bytes and checked.
 */

interface ZipEntry {
  name: string;
  data: string;
}

/** Read a STORED zip back apart, the way a reader would. */
function unzip(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The end-of-central-directory record is the last 22 bytes (no comment).
  const eocd = bytes.length - 22;
  expect(view.getUint32(eocd, true)).toBe(0x06054b50);

  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const entries: ZipEntry[] = [];

  for (let i = 0; i < count; i++) {
    expect(view.getUint32(p, true)).toBe(0x02014b50);
    const method = view.getUint16(p + 10, true);
    expect(method).toBe(0); // stored
    const size = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));

    // The local header must agree with the central directory, and its data
    // must be exactly where the central directory says it is.
    expect(view.getUint32(localOffset, true)).toBe(0x04034b50);
    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const data = new TextDecoder().decode(bytes.subarray(dataStart, dataStart + size));
    entries.push({ name, data });

    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

describe('the XLSX writer', () => {
  const bytes = buildXlsx([
    {
      name: 'Summary',
      freezeRows: 1,
      widths: [30, 16],
      rows: [
        [
          { value: 'Clinic', style: XL.header },
          { value: 'Billed (PKR)', style: XL.header },
        ],
        [
          { value: 'Al-Noor Clinic' },
          { value: 25000, style: XL.money },
        ],
      ],
    },
  ]);

  const entries = unzip(bytes);
  const part = (name: string) => entries.find((e) => e.name === name)?.data ?? '';

  it('writes a ZIP a reader can take apart', () => {
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.map((e) => e.name)).toContain('[Content_Types].xml');
    expect(entries.map((e) => e.name)).toContain('xl/workbook.xml');
    expect(entries.map((e) => e.name)).toContain('xl/styles.xml');
    expect(entries.map((e) => e.name)).toContain('xl/worksheets/sheet1.xml');
  });

  it('declares every part it contains', () => {
    const types = part('[Content_Types].xml');
    expect(types).toContain('PartName="/xl/workbook.xml"');
    expect(types).toContain('PartName="/xl/worksheets/sheet1.xml"');
    expect(types).toContain('PartName="/xl/styles.xml"');
  });

  it('writes numbers as numbers and text as text', () => {
    const sheet = part('xl/worksheets/sheet1.xml');
    // A number is a value in a numeric cell, so Excel can sum it.
    expect(sheet).toContain('<c r="B2" s="2"><v>25000</v></c>');
    // A name is an inline string, so it stays a name.
    expect(sheet).toContain('t="inlineStr"');
    expect(sheet).toContain('Al-Noor Clinic');
  });

  it('carries the widths and the frozen header', () => {
    const sheet = part('xl/worksheets/sheet1.xml');
    expect(sheet).toContain('<col min="1" max="1" width="30" customWidth="1"/>');
    expect(sheet).toContain('ySplit="1"');
    expect(sheet).toContain('state="frozen"');
  });

  it('gives the money cells a number format', () => {
    const styles = part('xl/styles.xml');
    expect(styles).toContain('formatCode="#,##0"');
  });

  it('escapes the characters that would break the XML', () => {
    const out = buildXlsx([
      { name: 'Odd & <names>', rows: [[{ value: 'A & B <tag> "quoted"' }]] },
    ]);
    const sheet = unzip(out).find((e) => e.name === 'xl/worksheets/sheet1.xml')?.data ?? '';
    expect(sheet).toContain('A &amp; B &lt;tag&gt;');
    expect(sheet).not.toContain('<tag>');
  });

  it('makes a tab name Excel will accept', () => {
    const out = buildXlsx([{ name: 'March 2026', rows: [[{ value: 'x' }]] }]);
    const workbook = unzip(out).find((e) => e.name === 'xl/workbook.xml')?.data ?? '';
    expect(workbook).toContain('name="March 2026"');
  });
});
