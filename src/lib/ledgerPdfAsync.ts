import { buildLedgerReportPdf, type LedgerPdfMeta } from './ledgerPdf';
import type { PdfBuildResult } from './pdf';
import type { LedgerReportRow, LedgerReportSummary } from '../services/ledgerReport';

interface WorkerReply {
  ok: boolean;
  result?: PdfBuildResult;
  error?: string;
}

/**
 * Build the PDF in a module worker so a long ledger never blocks typing,
 * scrolling or the export's own progress state. Browsers without workers
 * (and test environments) use the same builder synchronously.
 */
export async function buildLedgerReportPdfAsync(
  rows: LedgerReportRow[],
  summary: LedgerReportSummary,
  meta: LedgerPdfMeta,
): Promise<PdfBuildResult> {
  if (typeof Worker === 'undefined') return buildLedgerReportPdf(rows, summary, meta);

  let worker: Worker | undefined;
  try {
    worker = new Worker(new URL('./ledgerPdfWorker.ts', import.meta.url), { type: 'module' });
    return await new Promise<PdfBuildResult>((resolve, reject) => {
      worker!.onmessage = (event: MessageEvent<WorkerReply>) => {
        if (event.data.ok && event.data.result) resolve(event.data.result);
        else reject(new Error(event.data.error || 'The PDF worker returned no document.'));
      };
      worker!.onerror = (event) => reject(new Error(event.message || 'The PDF worker failed.'));
      worker!.postMessage({ rows, summary, meta });
    });
  } catch (error) {
    /* A worker can fail to start (CSP, a stale chunk after an update). The
       export still has to produce a document, so fall back rather than leave
       the operator with a dead button. */
    if (worker) worker.terminate();
    console.warn('Falling back to main-thread PDF generation:', error);
    return buildLedgerReportPdf(rows, summary, meta);
  } finally {
    worker?.terminate();
  }
}