// Pure node tests — no DOM (vitest default = node).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { toCSV } from '../../src/services/csvExport';

const root = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

/**
 * Desktop file-export contract.
 *
 * Every "download" in the app used to be a Blob URL plus a synthetic
 * `<a download>` click. That is ignored by the Tauri shell, which routes the
 * WebView2 download event to a Rust-side save dialog — and the app registered
 * no handler, so the job slip, every CSV, the PDF and the backup each produced
 * no file AND no error on the installed build.
 *
 * These pin that none of those call sites can drift back to a blob download.
 */
describe('desktop file export', () => {
  it('registers a Rust command that writes the bytes', () => {
    const lib = read('src-tauri/src/lib.rs');
    expect(lib).toContain('pub mod file_export;');
    expect(lib).toContain('file_export::save_file_bytes');
  });

  it('uses the native save dialog, which dialog:default already permits', () => {
    // No capability change is needed: dialog:default grants allow-save.
    const caps = read('src-tauri/capabilities/default.json');
    expect(caps).toContain('dialog:default');
  });

  it('routes every export surface through saveFile', () => {
    const sites: Array<[string, string]> = [
      ['src/components/print/printPipeline.ts', 'downloadStandaloneHtml'],
      ['src/services/csvExport.ts', 'saveTextFile'],
      ['src/lib/pdf.ts', 'saveFile'],
      ['src/services/sqliteStorage.ts', 'saveFile'],
      ['src/components/settings/BackupTab.tsx', 'saveFile'],
    ];
    for (const [file, helper] of sites) {
      expect(read(file), `${file} must export via ${helper}`).toContain(helper);
    }
  });

  it('leaves no blob-download export behind', () => {
    // A regression here is invisible on web, where the blob path still works.
    const offenders: string[] = [];
    for (const f of [
      'src/components/print/printPipeline.ts',
      'src/services/csvExport.ts',
      'src/lib/pdf.ts',
      'src/services/sqliteStorage.ts',
      'src/components/settings/BackupTab.tsx',
    ]) {
      const src = read(f);
      if (/createObjectURL[\s\S]{0,400}\.download\s*=/.test(src)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });

  it('encodes in chunks so a large export cannot overflow the stack', () => {
    // String.fromCharCode(...bytes) throws RangeError on big payloads; the
    // helper slices at 0x8000 for that reason.
    const saveFileSrc = read('src/lib/saveFile.ts');
    expect(saveFileSrc).toContain('String.fromCharCode(...bytes.subarray');
  });

  it('keeps the CSV exporter byte-identical to before', () => {
    // The BOM and RFC-4180 quoting are unchanged by the transport fix.
    expect(toCSV([['a', 'b,c'], ['d"e', 'f']])).toBe('a,"b,c"\r\n"d""e",f\r\n');
  });
});
