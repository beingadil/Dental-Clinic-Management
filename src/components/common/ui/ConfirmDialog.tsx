import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal } from './Modal';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** What will happen, as concrete facts the user can verify. */
  consequences: string[];
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** Require typing this exact phrase to enable the confirm button. */
  typedPhrase?: string;
  tone?: 'rose' | 'indigo';
  children?: React.ReactNode;
}

/**
 * Shared destructive-action confirmation (B4/B10): replaces native
 * confirm() with a dialog that can explain consequences, and — for
 * ledger-reversing actions like invoice void — requires a typed phrase.
 *
 * Built on the shared `Modal` (V-19), so it inherits the focus trap, focus
 * restore and dialog-stack arbitration instead of hand-rolling them.
 */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open, title, consequences, confirmLabel, onConfirm, onCancel, typedPhrase, tone = 'rose', children,
}) => {
  const [phrase, setPhrase] = useState('');
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) setPhrase('');
  }, [open]);

  const phraseOk = !typedPhrase || phrase.trim().toUpperCase() === typedPhrase.toUpperCase();

  return (
    <Modal
      open={open}
      onClose={onCancel}
      label={title}
      maxWidth="max-w-md"
      tone={tone === 'rose' ? 'rose' : 'indigo'}
      zIndex="z-[60]"
      cardClassName="rounded-2xl border-slate-200"
      bodyClassName="px-5 py-4 space-y-3"
      initialFocusRef={cancelRef}
      header={
        <div className="flex items-center gap-2.5">
          <AlertTriangle className={`w-5 h-5 ${tone === 'rose' ? 'text-ink-danger' : 'text-brand-600'}`} />
          <h3 className="text-sm font-bold text-slate-900">{title}</h3>
        </div>
      }
      footer={
        <>
          <button
            ref={cancelRef}
            onClick={onCancel}
            className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={() => { if (phraseOk) onConfirm(); }}
            disabled={!phraseOk}
            className={`px-4 py-2 text-xs font-semibold text-white rounded-lg transition-colors ${
              phraseOk
                ? (tone === 'rose' ? 'bg-rose-600 hover:bg-rose-700' : 'bg-brand-600 hover:bg-brand-700')
                : 'bg-slate-300 cursor-not-allowed'
            } cursor-pointer`}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <ul className="text-xs text-slate-600 space-y-1.5 list-disc pl-4">
        {consequences.map((c, i) => <li key={i}>{c}</li>)}
      </ul>
      {children}
      {typedPhrase && (
        <div>
          <label htmlFor="typed-phrase" className="block text-xs font-semibold text-slate-700 mb-1">
            Type <span className="font-mono font-bold text-rose-700">{typedPhrase}</span> to confirm
          </label>
          <input
            id="typed-phrase"
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            autoComplete="off"
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-rose-500 focus:ring-offset-1 focus:border-rose-500 outline-none"
          />
        </div>
      )}
    </Modal>
  );
};
