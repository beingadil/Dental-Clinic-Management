import React, { useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { DentalCase, CaseStatus } from '../../types';
import { PaymentModal } from '../billing/PaymentModal';
import { SHADE_COLORS, TOOTH_NAMES } from './Odontogram';
import { CaseAttachmentsPanel } from './CaseAttachmentsPanel';
import { CaseNotesPanel } from './CaseNotesPanel';
import { CaseProgressIndicator } from './CaseProgressIndicator';
import {
  X,
  Trash2,
  Pencil,
  Wallet,
  Printer,
  FileText,
  AlertTriangle,
  Calendar,
  User,
  Stethoscope,
  Building2,
  Hash,
  Receipt,
} from 'lucide-react';

const CASE_STATUS_LABELS: Record<CaseStatus, string> = {
  draft: 'Draft',
  received: 'Received',
  in_progress: 'In Progress',
  qc: 'QC Quality',
  ready: 'Ready',
  delivered: 'Delivered',
  revision: 'Revision',
  cancelled: 'Cancelled',
};

const CASE_STATUS_BADGE: Record<CaseStatus, string> = {
  draft: 'bg-slate-100 text-slate-600 border-slate-200',
  received: 'bg-sky-50 text-sky-700 border-sky-200',
  in_progress: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  qc: 'bg-purple-50 text-purple-700 border-purple-200',
  ready: 'bg-cyan-50 text-cyan-700 border-cyan-200',
  delivered: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  revision: 'bg-amber-50 text-amber-700 border-amber-200',
  cancelled: 'bg-rose-50 text-rose-700 border-rose-200',
};

interface CaseDetailPanelProps {
  caseData: DentalCase;
  onClose: () => void;
  onEdit: (c: DentalCase) => void;
  onDeleted: () => void;
  onPrint: (c: DentalCase) => void;
}

export const CaseDetailPanel: React.FC<CaseDetailPanelProps> = ({
  caseData,
  onClose,
  onEdit,
  onDeleted,
  onPrint,
}) => {
  const { invoices, deleteCase } = useApp();
  const [activeTab, setActiveTab] = useState<'overview' | 'teeth' | 'financials' | 'attachments' | 'notes'>('overview');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteText, setDeleteText] = useState('');
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);

  const caseInvoices = useMemo(
    () => invoices.filter((inv) => inv.case_id === caseData.id || inv.case_number === caseData.case_number),
    [invoices, caseData.id, caseData.case_number]
  );
  const totalPaid = caseInvoices.reduce((sum, inv) => sum + (inv.amount_paid || 0), 0);
  const billed = caseInvoices.reduce((sum, inv) => sum + (inv.final_amount || 0), 0);

  const toothDetails = (caseData.tooth_details || {}) as Record<number, any>;

  const daysLeft = useMemo(() => {
    if (!caseData.delivery_date) return null;
    return Math.ceil((new Date(caseData.delivery_date).getTime() - Date.now()) / 86400000);
  }, [caseData.delivery_date]);

  const handleDelete = () => {
    if (deleteText.trim().toUpperCase() !== 'DELETE') return;
    try {
      deleteCase(caseData.id);
    } finally {
      onDeleted();
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl max-w-3xl w-full max-h-[92vh] overflow-hidden flex flex-col border border-slate-200 shadow-2xl">
        {/* Header */}
        <div className="bg-slate-900 px-6 py-4 text-white flex items-start justify-between gap-4 shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono font-black tracking-tight">{caseData.case_number}</span>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${CASE_STATUS_BADGE[caseData.status] || 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                {CASE_STATUS_LABELS[caseData.status] || caseData.status}
              </span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold border bg-white/10 text-white border-white/20 capitalize">
                {caseData.priority}
              </span>
            </div>
            <h2 className="text-sm font-bold mt-1 truncate">
              {caseData.patient_name || 'Unnamed Patient'} · {caseData.case_type_name}
            </h2>
          </div>
          <button onClick={onClose} className="text-white/60 hover:text-white p-1 rounded-lg hover:bg-white/10 cursor-pointer shrink-0" title="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="bg-white border-b border-slate-200 px-6 pt-3 shrink-0">
          <div className="flex items-center gap-1 overflow-x-auto">
            {(['overview', 'teeth', 'financials', 'attachments', 'notes'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setActiveTab(t)}
                className={`px-3.5 py-2 rounded-t-lg text-xs font-bold capitalize transition-colors cursor-pointer ${
                  activeTab === t ? 'text-slate-900 border-b-2 border-slate-900' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                {t}
                {t === 'teeth' && <span className="ml-1 text-[10px] text-slate-400">({caseData.selected_teeth.length})</span>}
                {t === 'financials' && caseInvoices.length > 0 && <span className="ml-1 text-[10px] text-slate-400">({caseInvoices.length})</span>}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {activeTab === 'overview' && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <InfoTile icon={<User className="w-3.5 h-3.5 text-slate-400" />} label="Patient" value={caseData.patient_name || '—'} />
                <InfoTile icon={<Stethoscope className="w-3.5 h-3.5 text-slate-400" />} label="Doctor" value={`Dr. ${caseData.doctor_name}`} />
                <InfoTile icon={<Building2 className="w-3.5 h-3.5 text-slate-400" />} label="Clinic" value={caseData.lab_name} />
                <InfoTile icon={<Calendar className="w-3.5 h-3.5 text-slate-400" />} label="Delivery" value={caseData.delivery_date} sub={dueLabel(daysLeft)} />
              </div>

              <div className="bg-slate-50 rounded-2xl border border-slate-200 p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">Production Stage</h3>
                  <span className="text-[11px] text-slate-500 font-medium">{CASE_STATUS_LABELS[caseData.status]}</span>
                </div>
                <CaseProgressIndicator status={caseData.status} variant="detailed" showLabels={true} />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <InfoTile icon={<Hash className="w-3.5 h-3.5 text-slate-400" />} label="Units" value={String(caseData.selected_teeth.length)} />
                <InfoTile icon={<FileText className="w-3.5 h-3.5 text-slate-400" />} label="Shade / Material" value={[caseData.shade, caseData.material].filter(Boolean).join(' · ') || '—'} />
                <InfoTile icon={<Receipt className="w-3.5 h-3.5 text-slate-400" />} label="Case Value" value={`PKR ${(caseData.final_price || 0).toLocaleString()}`} />
              </div>

              {caseData.instructions && (
                <div className="bg-indigo-50/60 rounded-2xl border border-indigo-100 p-4">
                  <h3 className="text-[10px] font-bold uppercase tracking-wider text-indigo-700 mb-1">Doctor Instructions</h3>
                  <p className="text-xs text-slate-700 leading-relaxed whitespace-pre-wrap">{caseData.instructions}</p>
                </div>
              )}
            </>
          )}

          {activeTab === 'teeth' && (
            <div className="overflow-hidden rounded-2xl border border-slate-200">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">Tooth</th>
                    <th className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">Name</th>
                    <th className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">Prep Type</th>
                    <th className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">Material</th>
                    <th className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">Shade</th>
                    <th className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {caseData.selected_teeth.map((t) => {
                    const d = toothDetails[t] || {};
                    return (
                      <tr key={t} className="hover:bg-slate-50/60">
                        <td className="px-4 py-2.5 font-mono font-black text-slate-900">#{t}</td>
                        <td className="px-4 py-2.5 text-xs text-slate-600">{TOOTH_NAMES[t]?.split('(')[0] || '—'}</td>
                        <td className="px-4 py-2.5 text-xs font-semibold text-indigo-700 capitalize">{String(d.prep_type || 'crown').replace(/_/g, ' ')}</td>
                        <td className="px-4 py-2.5 text-xs text-slate-700">{d.material || caseData.material || '—'}</td>
                        <td className="px-4 py-2.5">
                          <span className="inline-flex items-center gap-1.5">
                            <span className="w-3 h-3 rounded-full border border-slate-300" style={{ background: SHADE_COLORS[d.shade || caseData.shade] || '#fff' }} />
                            <span className="font-mono text-xs font-bold text-slate-800">{d.shade || caseData.shade || '—'}</span>
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-slate-500 max-w-[180px] truncate">{d.notes || '—'}</td>
                      </tr>
                    );
                  })}
                  {caseData.selected_teeth.length === 0 && (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-xs text-slate-400">No teeth charted.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {activeTab === 'financials' && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <InfoTile label="Case Value" value={`PKR ${(caseData.final_price || 0).toLocaleString()}`} />
                <InfoTile label="Billed" value={`PKR ${billed.toLocaleString()}`} />
                <InfoTile label="Paid" value={`PKR ${totalPaid.toLocaleString()}`} />
              </div>

              {caseInvoices.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 p-8 text-center">
                  <Receipt className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                  <p className="text-xs font-bold text-slate-700">No invoice generated yet</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">An invoice is created automatically when the case is registered.</p>
                </div>
              ) : (
                <>
                  {caseInvoices.map((inv) => (
                    <div key={inv.id} className="rounded-2xl border border-slate-200 p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-mono font-bold text-xs text-slate-900">{inv.invoice_number}</span>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          inv.payment_status === 'paid' ? 'bg-emerald-50 text-emerald-700'
                          : inv.payment_status === 'partial' ? 'bg-amber-50 text-amber-700'
                          : 'bg-rose-50 text-rose-700'
                        }`}>{inv.payment_status}</span>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-center bg-slate-50 rounded-xl p-2.5">
                        <div><span className="text-[10px] text-slate-400 font-bold block uppercase">Amount</span><span className="text-xs font-bold text-slate-900">PKR {inv.final_amount.toLocaleString()}</span></div>
                        <div><span className="text-[10px] text-slate-400 font-bold block uppercase">Paid</span><span className="text-xs font-bold text-emerald-700">PKR {(inv.amount_paid || 0).toLocaleString()}</span></div>
                        <div><span className="text-[10px] text-slate-400 font-bold block uppercase">Balance</span><span className="text-xs font-bold text-rose-700">PKR {(inv.final_amount - (inv.amount_paid || 0)).toLocaleString()}</span></div>
                      </div>
                      {(inv.payments || []).length > 0 && (
                        <div className="mt-3 space-y-1.5">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Payment History</span>
                          {inv.payments.map((p) => (
                            <div key={p.id} className="flex items-center justify-between text-xs border-t border-slate-100 pt-1.5">
                              <span className="text-slate-600">{p.payment_date} · {p.payment_method}{p.reference_number ? ` · ${p.reference_number}` : ''}</span>
                              <span className="font-bold text-slate-900">PKR {p.amount.toLocaleString()}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                  <button
                    onClick={() => setPaymentModalOpen(true)}
                    className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer flex items-center justify-center gap-2"
                  >
                    <Wallet className="w-4 h-4" /> Record Payment for {caseData.case_number}
                  </button>
                </>
              )}
            </div>
          )}

          {activeTab === 'attachments' && (
            <div className="bg-slate-50 rounded-2xl border border-slate-200 p-4">
              <CaseAttachmentsPanel caseId={caseData.id} />
            </div>
          )}

          {activeTab === 'notes' && (
            <div className="bg-slate-50 rounded-2xl border border-slate-200 p-4">
              <CaseNotesPanel caseId={caseData.id} />
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="bg-white border-t border-slate-200 px-6 py-3.5 flex items-center justify-between gap-3 shrink-0">
          <button
            onClick={() => setConfirmingDelete(true)}
            className="px-4 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-xl text-xs font-bold transition-colors cursor-pointer inline-flex items-center gap-1.5"
          >
            <Trash2 className="w-3.5 h-3.5" /> Delete
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onPrint(caseData)}
              className="px-4 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-xl text-xs font-bold transition-colors cursor-pointer inline-flex items-center gap-1.5"
            >
              <Printer className="w-3.5 h-3.5" /> Print
            </button>
            <button
              onClick={() => onEdit(caseData)}
              className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer inline-flex items-center gap-1.5"
            >
              <Pencil className="w-3.5 h-3.5" /> Edit Case
            </button>
          </div>
        </div>
      </div>

      {/* Delete confirmation */}
      {confirmingDelete && (
        <div className="fixed inset-0 z-[60] bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 border border-slate-200 shadow-2xl space-y-3">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-rose-50 text-rose-600 rounded-xl"><AlertTriangle className="w-5 h-5" /></div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">Delete {caseData.case_number}?</h3>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                  This permanently removes the case{caseInvoices.length > 0 ? ', its invoice, and payment history' : ''}. This cannot be undone.
                </p>
              </div>
            </div>
            <input
              type="text"
              value={deleteText}
              onChange={(e) => setDeleteText(e.target.value)}
              placeholder="Type DELETE to confirm"
              className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:border-rose-400 font-mono"
            />
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => { setConfirmingDelete(false); setDeleteText(''); }} className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold cursor-pointer">Cancel</button>
              <button
                onClick={handleDelete}
                disabled={deleteText.trim().toUpperCase() !== 'DELETE'}
                className="px-4 py-1.5 bg-rose-600 hover:bg-rose-700 disabled:bg-slate-200 disabled:text-slate-400 text-white rounded-lg text-xs font-bold cursor-pointer disabled:cursor-not-allowed transition-colors"
              >
                Delete Case
              </button>
            </div>
            {caseInvoices.length > 0 && (
              <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                {caseInvoices.length} invoice(s) linked to this case will also be affected.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Payment modal */}
      {paymentModalOpen && (
        <PaymentModalHost
          caseData={caseData}
          onClose={() => setPaymentModalOpen(false)}
        />
      )}
    </div>
  );
};

const PaymentModalHost: React.FC<{ caseData: DentalCase; onClose: () => void }> = ({ caseData, onClose }) => {
  const { invoices } = useApp();
  const caseInvoice = invoices.find((inv) => inv.case_id === caseData.id || inv.case_number === caseData.case_number);
  return <PaymentModal invoice={caseInvoice || null} onClose={onClose} />;
};

function InfoTile({ icon, label, value, sub }: { icon?: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-3.5">
      <div className="flex items-center gap-1.5 mb-1">
        {icon}
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</span>
      </div>
      <p className="text-xs font-bold text-slate-900 truncate" title={value}>{value}</p>
      {sub && <p className="text-[10px] text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
}

function dueLabel(daysLeft: number | null): string {
  if (daysLeft === null) return '';
  if (daysLeft < 0) return `${Math.abs(daysLeft)}d overdue`;
  if (daysLeft === 0) return 'Due today';
  return `${daysLeft}d remaining`;
}
