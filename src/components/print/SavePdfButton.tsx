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
  const [done, setDone] = useState(false);

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
    const result = await saveAsPdf(suggestedName);
    setBusy(false);
    if (result.status === 'saved') {
      setDone(true);
      setTimeout(() => setDone(false), 4000);
    } else if (result.status === 'error') {
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
        <Check className="w-4 h-4 text-emerald-600" />
      ) : (
        <Download className="w-4 h-4" />
      )}
      <span>{busy ? 'Saving…' : done ? 'Saved' : 'Save PDF'}</span>
    </button>
  );
}
