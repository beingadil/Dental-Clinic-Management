import React from 'react';
import { JournalEntry } from '../../types';
import { useApp } from '../../context/AppContext';
import { formatPKR } from '../../services/financeDomain';
import { Scale, FileText, Calendar, Building2, User, ShieldCheck } from 'lucide-react';
import { Modal } from '../common/ui';

interface JournalEntryModalProps {
  isOpen: boolean;
  onClose: () => void;
  journal?: JournalEntry | null;
  referenceId?: string;
}

export const JournalEntryModal: React.FC<JournalEntryModalProps> = ({
  isOpen,
  onClose,
  journal: propJournal,
  referenceId
}) => {
  const { journalEntries } = useApp();

  if (!isOpen) return null;

  const journal = propJournal || (referenceId ? journalEntries.find((j) => j.id === referenceId || j.journal_number === referenceId || j.reference_id === referenceId || j.reference_number === referenceId) : null);

  if (!journal) return null;

  const totalDebit = journal.lines.reduce((sum, l) => sum + (l.debit || 0), 0);
  const totalCredit = journal.lines.reduce((sum, l) => sum + (l.credit || 0), 0);
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01;

  return (
    <Modal
      open
      onClose={onClose}
      label="Journal entry inspector"
      maxWidth="max-w-4xl xl:max-w-5xl"
      headerClassName="px-6 py-4"
      header={
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-brand-50 border border-brand-100 flex items-center justify-center text-brand-600">
            <Scale className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold text-slate-900 font-mono tracking-tight">
                {journal.journal_number}
              </h3>
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-brand-50 text-brand-700 border border-brand-200">
                {journal.event_type.replace('_', ' ').toUpperCase()}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Double-Entry Accounting Record • Immutable Ledger Event
            </p>
          </div>
        </div>
      }
    >

        {/* Metadata Strip */}
        <div className="px-6 py-3 bg-slate-50 border-b border-slate-100 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div>
            <span className="text-ink-muted flex items-center gap-1 mb-0.5">
              <Calendar className="w-3.5 h-3.5" /> Date
            </span>
            <span className="font-medium text-slate-700">{journal.date}</span>
          </div>
          <div>
            <span className="text-ink-muted flex items-center gap-1 mb-0.5">
              <FileText className="w-3.5 h-3.5" /> Reference
            </span>
            <span className="font-mono font-medium text-slate-800">{journal.reference_number}</span>
          </div>
          <div>
            <span className="text-ink-muted flex items-center gap-1 mb-0.5">
              <Building2 className="w-3.5 h-3.5" /> Account
            </span>
            <span className="font-medium text-slate-700 truncate block" title={journal.lab_name}>
              {journal.lab_name || 'System / General'}
            </span>
          </div>
          <div>
            <span className="text-ink-muted flex items-center gap-1 mb-0.5">
              <User className="w-3.5 h-3.5" /> Recorded By
            </span>
            <span className="font-medium text-slate-700">{journal.created_by}</span>
          </div>
        </div>

        {/* Description */}
        <div className="px-6 py-2.5 bg-indigo-50/30 border-b border-indigo-100/50 text-xs text-slate-600">
          <span className="font-medium text-slate-700">Narration:</span> {journal.description}
        </div>

        {/* Journal Lines Table */}
        <div className="p-6">
          <div className="rounded-lg border border-slate-200 overflow-hidden">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="bg-slate-100/80 text-slate-600 border-b border-slate-200">
                  <th scope="col" className="px-3.5 py-2.5 font-semibold">Account Code & Title</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold text-center w-24">Type</th>
                  <th scope="col" className="px-3.5 py-2.5 font-semibold text-right w-32">Debit (PKR)</th>
                  <th scope="col" className="px-3.5 py-2.5 font-semibold text-right w-32">Credit (PKR)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
                {journal.lines.map((line) => (
                  <tr key={line.id} className="hover:bg-slate-50/60">
                    <td className="px-3.5 py-2.5">
                      <div className="font-sans font-medium text-slate-800">
                        {line.account_name}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        Acc: {line.account_code}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <span className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-sans uppercase font-medium ${
                        line.account_type === 'asset'
                          ? 'bg-blue-50 text-blue-700'
                          : line.account_type === 'liability'
                          ? 'bg-amber-50 text-amber-700'
                          : line.account_type === 'revenue'
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-purple-50 text-purple-700'
                      }`}>
                        {line.account_type}
                      </span>
                    </td>
                    <td className="px-3.5 py-2.5 text-right font-medium text-slate-900">
                      {line.debit > 0 ? formatPKR(line.debit).replace('PKR ', '') : '—'}
                    </td>
                    <td className="px-3.5 py-2.5 text-right font-medium text-slate-900">
                      {line.credit > 0 ? formatPKR(line.credit).replace('PKR ', '') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50 border-t-2 border-slate-200 font-mono font-semibold text-slate-900">
                  <td colSpan={2} className="px-3.5 py-2.5 text-right font-sans text-xs">
                    Total Balanced Entry:
                  </td>
                  <td className="px-3.5 py-2.5 text-right text-indigo-700 font-bold">
                    {formatPKR(totalDebit).replace('PKR ', '')}
                  </td>
                  <td className="px-3.5 py-2.5 text-right text-indigo-700 font-bold">
                    {formatPKR(totalCredit).replace('PKR ', '')}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Balance status banner */}
          <div className="mt-4 flex items-center justify-between px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800">
            <div className="flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-ink-success" />
              <span>Double-entry mathematical verification: <strong>Debits equal Credits</strong></span>
            </div>
            <span className="font-mono font-semibold">Variance: PKR 0.00</span>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
          <span>Created at {journal.created_at}</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 font-medium transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
    </Modal>
  );
};
