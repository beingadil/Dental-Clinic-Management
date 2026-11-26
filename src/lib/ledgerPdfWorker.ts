import { buildLedgerReportPdf, type LedgerPdfMeta } from './ledgerPdf';
import type { LedgerReportRow, LedgerReportSummary } from '../services/ledgerReport';

interface LedgerPdfRequest {
  rows: LedgerReportRow[];
  summary: LedgerReportSummary;
  meta: LedgerPdfMeta;
}

/** Build the statement off the UI thread; only the finished bytes come back. */
self.onmessage = (event: MessageEvent<LedgerPdfRequest>) => {
  try {
    const result = buildLedgerReportPdf(event.data.rows, event.data.summary, event.data.meta);
    (self as unknown as { postMessage: (value: unknown) => void }).postMessage({ ok: true, result });
  } catch (error) {
    (self as unknown as { postMessage: (value: unknown) => void }).postMessage({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};