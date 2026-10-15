import { useTransientFlag } from '../common/useTransient';
/**
 * "Save PDF" button for print modals — desktop (Tauri) builds only.
 *
 * Renders nothing on the web build. On desktop it opens the native save
 * dialog and renders the current document (the open print modal, with the
 * shared `@media print` CSS applied) into the chosen file — no browser
 * print dialog round-trip.
 */
import { useEffect, useState } from 'react';
import { Check, Download, Loader2 } from 'lucide-react';
import { canSaveAsPdf, saveAsPdf } from '../../lib/saveAsPdf';

interface SavePdfButtonProps {
  /** Destination file name suggestion, e.g. "Invoice_INV-0001.pdf". */
  suggestedName: string;
  disabled?: boolean;
  className?: string;
}

export function SavePdfButton({ suggestedName, disabled = false, className = '' }: SavePdfButtonProps) {
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, flashDone] = useTransientFlag(4000);

  useEffect(() => {
    let mounted = true;
    canSaveAsPdf().then((v) => {
      if (mounted) setAvailable(v);
    });
    return () => {
      mounted = false;
    };
  }, []);

  if (!available) return null;

  const handleClick = async () => {
    if (busy) return;
    setBusy(true);

    /* Belt and braces with the Rust-side timeout.
     *
     * The button used to set `busy` and then simply await the command. If that
     * promise never settled — the UI thread deadlock described in
     * pdf_save.rs, where the capture could not be scheduled — `busy` stayed
     * true for good and the button spun forever with no way back. The operator
     * saw "Saving." for the full 30s and then a dead control, with no message.
     *
     * Racing the command against a local timer means the control ALWAYS returns
     * to its resting state, and every outcome that is not a success says so.
     * The Rust timeout is 30s; this one is longer so the Rust error wins when
     * there is one to report.
     */
    const LOCAL_TIMEOUT_MS = 45_000;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
    }, LOCAL_TIMEOUT_MS);

    let result: Awaited<ReturnType<typeof saveAsPdf>>;
    try {
      result = await saveAsPdf(suggestedName);
    } catch (err) {
      result = { status: 'error', message: err instanceof Error ? err.message : String(err) };
    } finally {
      clearTimeout(timer);
    }

    setBusy(false);

    if (timedOut) {
      alert(
        'Saving the PDF did not finish in time and was stopped.\n\n' +
          'Close any open print dialog and try again.'
      );
      return;
    }
    if (result.status === 'saved') {
      flashDone();
    } else if (result.status === 'cancelled') {
      // The operator closed the save dialog. Not an error, and saying so would
      // train them to ignore the dialog.
      return;
    } else if (result.status === 'unsupported') {
      alert('Saving as PDF is only available in the desktop app. Use Print instead.');
    } else {
      alert(`Could not save PDF: ${result.message}`);
    }
  };

  const base =
    className ||
    'px-3.5 py-1.5 rounded-lg bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-semibold text-xs rounded-lg transition-colors flex items-center gap-1.5 shadow-xs cursor-pointer disabled:cursor-not-allowed disabled:opacity-50';

  return (
    <button type="button" onClick={handleClick} disabled={disabled || busy} className={base}
      title="Save this document as a PDF file">
      {busy ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : done ? (
        <Check className="w-4 h-4 text-ink-success" />
      ) : (
        <Download className="w-4 h-4" />
      )}
      <span>{busy ? 'Saving…' : done ? 'Saved' : 'Save PDF'}</span>
    </button>
  );
}
