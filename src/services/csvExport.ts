/**
 * RFC-4180 CSV export (B9 regression): the two previous hand-rolled
 * exporters broke rows on commas (data-URL + encodeURI) and quoted only
 * double-quotes (naive replace). One exporter, one quoting rule:
 * a field is quoted iff it contains a comma, double-quote, newline, or
 * CR; embedded double-quotes are doubled. CRLF row terminators per spec.
 */
import { saveTextFile, type SaveFileResult } from '../lib/saveFile';
export function toCSV(rows: (string | number | null | undefined)[][]): string {
  if (!rows.length) return '';
  const quote = (field: string | number | null | undefined): string => {
    const s = field === null || field === undefined ? '' : String(field);
    if (/[",\n\r]/.test(s)) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  return rows.map((row) => row.map(quote).join(',')).join('\r\n') + '\r\n';
}

/**
 * Save `rows` as `<filename>.csv` (UTF-8 BOM so Excel opens unicode cleanly).
 *
 * Routed through saveTextFile so the installed desktop build actually writes a
 * file: a Blob URL plus a synthetic `<a download>` click is silently ignored by
 * the Tauri shell, which is why CSV export appeared to do nothing there. On web
 * this is still the browser download it always was.
 *
 * Fire-and-forget for the web path; callers that need the outcome (or an error
 * to show the operator) should await `saveCSV`.
 */
export function downloadCSV(filename: string, rows: (string | number | null | undefined)[][]): void {
  void saveCSV(filename, rows);
}

export function saveCSV(
  filename: string,
  rows: (string | number | null | undefined)[][],
): Promise<SaveFileResult> {
  return saveTextFile(filename, '\uFEFF' + toCSV(rows), {
    extension: '.csv',
    mimeType: 'text/csv;charset=utf-8;',
    dialogTitle: 'Export CSV',
  });
}
