/**
 * RFC-4180 CSV export (B9 regression): the two previous hand-rolled
 * exporters broke rows on commas (data-URL + encodeURI) and quoted only
 * double-quotes (naive replace). One exporter, one quoting rule:
 * a field is quoted iff it contains a comma, double-quote, newline, or
 * CR; embedded double-quotes are doubled. CRLF row terminators per spec.
 */
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

/** Trigger a client-side download of `rows` as `<filename>.csv` (UTF-8 BOM so Excel opens unicode cleanly). */
export function downloadCSV(filename: string, rows: (string | number | null | undefined)[][]): void {
  const blob = new Blob(['\uFEFF' + toCSV(rows)], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 0);
}
