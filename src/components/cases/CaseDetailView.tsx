import React from 'react';
import { getTodayStr } from '../../utils/dateUtils';
import {
  X,
  Pencil,
  Calendar,
  User,
  Building2,
  Hash,
  Palette,
  CircleDollarSign,
  History,
  ArrowLeft,
} from 'lucide-react';
import type { DentalCase, CaseStatus, PriorityLevel } from '../../types';
import { formatDoctorName } from '../../utils/doctorName';
import { CaseNotesPanel } from './CaseNotesPanel';
import { CaseAttachmentsPanel } from './CaseAttachmentsPanel';
import { CaseProgressIndicator } from './CaseProgressIndicator';

interface CaseDetailViewProps {
  caseData: DentalCase;
  onClose: () => void;
  onEdit: (c: DentalCase) => void;
  onStatusChange: (caseId: string, updates: Partial<DentalCase>, note?: string) => void;
}

const PRIORITY_STYLES: Record<PriorityLevel, string> = {
  urgent: 'bg-rose-100 text-rose-700 border-rose-200',
  high: 'bg-amber-100 text-amber-700 border-amber-200',
  normal: 'bg-slate-100 text-slate-600 border-slate-200',
  low: 'bg-sky-100 text-sky-700 border-sky-200',
};

const formatDate = (d?: string) => {
  if (!d) return '—';
  const parsed = new Date(d);
  return isNaN(parsed.getTime()) ? d : parsed.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

export const CaseDetailView: React.FC<CaseDetailViewProps> = ({ caseData, onClose, onEdit, onStatusChange }) => {
  const c = caseData;
  const isOverdue = c.delivery_date < getTodayStr() && c.status !== 'delivered' && c.status !== 'cancelled';

  return (
    /* `absolute`, not `fixed inset-0`. The shell is `flex` with the nav rail as
       one sibling and this content column as the other, so an absolutely
       positioned layer fills ONLY the content column. `fixed` resolved against
       the viewport instead and covered the rail — opening a case job appeared to
       minimise the navigation, and the case number, patient and history in its
       left column were unreachable. Confining it here also means the rail keeps
       working while a case is open, and it tracks the rail for free whether the
       rail is expanded (w-64) or collapsed (w-20). */
    <div className="absolute inset-0 z-40 bg-slate-100 overflow-y-auto">
      {/* Sticky header */}
      <div className="sticky top-0 z-10 bg-white/90 backdrop-blur border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={onClose}
              className="p-2 rounded-xl hover:bg-slate-100 text-slate-600 transition-colors"
              title="Back to board"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold text-slate-900 tracking-tight truncate">{c.case_number}</h1>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border ${PRIORITY_STYLES[c.priority]}`}>
                  {c.priority}
                </span>
                {isOverdue && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-rose-600 text-white">
                    Overdue
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 truncate">
                {c.patient_name ? `${c.patient_name} • ` : ''}{c.case_type_name} • {c.lab_name}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onEdit(c)}
              className="px-3.5 py-2 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-xs font-bold flex items-center gap-1.5 transition-colors"
            >
              <Pencil className="w-3.5 h-3.5" />
              Edit Case
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-xl hover:bg-slate-100 text-slate-600 transition-colors"
              title="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Stage stepper — change stage from the view itself */}
        <div className="max-w-6xl mx-auto px-4 pb-3">
          <CaseProgressIndicator
            status={c.status}
            onStatusChange={(s) => onStatusChange(c.id, { status: s }, `Stage set to ${s.replace('_', ' ')} from case view`)}
            variant="compact"
            showLabels={true}
          />
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* Case facts grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { icon: Building2, label: 'Clinic', value: c.lab_name, sub: c.lab_id },
            // Formatted, not raw: `doctor_name` is stored bare, so printing the
            // column verbatim here is the one surface that would drop the honorific.
            { icon: User, label: 'Doctor', value: formatDoctorName(c.doctor_name), sub: c.patient_name ? `Patient: ${c.patient_name}` : undefined },
            // Dropped entirely when the product is not per-tooth work: an empty-teeth tile
            // reading "—" would imply charting was forgotten rather than not applicable.
            ...(c.selected_teeth.length > 0
              ? [{ icon: Palette, label: 'Teeth & Shade', value: c.selected_teeth.map((t) => `#${t}`).join(' '), sub: c.shade ? `Shade ${c.shade}` : undefined }]
              : []),
            { icon: CircleDollarSign, label: 'Price', value: `PKR ${c.final_price.toLocaleString()}`, sub: c.discount > 0 ? `PKR ${c.price.toLocaleString()} − PKR ${c.discount.toLocaleString()} discount` : `List PKR ${c.price.toLocaleString()}` },
            { icon: Calendar, label: 'Delivery Due', value: formatDate(c.delivery_date), sub: isOverdue ? 'Past due' : 'On schedule' },
            { icon: Hash, label: 'Registered', value: formatDate(c.created_at), sub: `Updated ${formatDate(c.updated_at)}` },
          ].map(({ icon: Icon, label, value, sub }) => (
            <div key={label} className="bg-white rounded-2xl border border-slate-200 p-4">
              <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                <Icon className="w-3.5 h-3.5" />
                {label}
              </div>
              <div className="text-sm font-bold text-slate-900 truncate" title={value}>{value}</div>
              {sub && <div className="text-[11px] text-slate-500 truncate">{sub}</div>}
            </div>
          ))}
        </div>

        {/* Notes + Attachments side by side */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
          <div className="bg-white rounded-2xl border border-slate-200 p-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">Clinical Notes</h3>
            <CaseNotesPanel caseId={c.id} />
          </div>
          <div className="bg-white rounded-2xl border border-slate-200 p-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">Attachments</h3>
            <CaseAttachmentsPanel caseId={c.id} />
          </div>
        </div>

        {/* History timeline */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3 flex items-center gap-1.5">
            <History className="w-3.5 h-3.5" />
            Status History
          </h3>
          <ol className="space-y-2">
            {(c.history || []).length === 0 && (
              <li className="text-xs text-ink-muted">No history recorded.</li>
            )}
            {(c.history || []).slice().reverse().map((h) => (
              <li key={h.id} className="flex items-start gap-2 text-xs">
                <span className="mt-1 w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0" />
                <div className="min-w-0">
                  <span className="font-bold text-slate-800 capitalize">{h.status.replace('_', ' ')}</span>
                  {h.notes && <span className="text-slate-500"> — {h.notes}</span>}
                  <div className="text-[10px] text-ink-muted">
                    {h.timestamp} {h.updated_by ? `• ${h.updated_by}` : ''}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
};
