import React, { useMemo, useState } from 'react';
import { Search, ChevronRight } from 'lucide-react';
import { DentalCase, DentalLab, Invoice } from '../../types';
import { EmptyState, PageHeader, Badge } from '../common/ui';
import { formatDoctorName } from '../../utils/doctorName';

interface ClinicAccountsTableProps {
  labs: DentalLab[];
  invoices: Invoice[];
  cases: DentalCase[];
  /** Local-day YYYY-MM-DD. Overdue is judged against this, never `Date.now()`,
      or PKT's small hours would mark a whole day of invoices overdue early. */
  todayStr: string;
  onCollect: (clinicId: string) => void;
  onStatement: (clinicId: string) => void;
  onOpenClinics: () => void;
}

/**
 * Clinic accounts ledger — the per-clinic balances view.
 *
 * Lived on the dashboard, where it was the widest element on screen and had to
 * be capped at 12 rows because rendering every clinic made the home screen
 * crawl. Money belongs in the finance workspace, so it moved here where it gets
 * the full width, a search box, and an uncapped (but paged) list.
 *
 * Indexed by id rather than by name matching: name lookups were O(clinics ×
 * cases) and stalled the dashboard at a few hundred clinics.
 */
export const ClinicAccountsTable: React.FC<ClinicAccountsTableProps> = ({
  labs,
  invoices,
  cases,
  todayStr,
  onCollect,
  onStatement,
  onOpenClinics,
}) => {
  const [search, setSearch] = useState('');
  const [showSettled, setShowSettled] = useState(false);

  const accounts = useMemo(() => {
    const invoicesByLab = new Map<string, Invoice[]>();
    for (const inv of invoices) {
      const bucket = invoicesByLab.get(inv.lab_id);
      if (bucket) bucket.push(inv);
      else invoicesByLab.set(inv.lab_id, [inv]);
    }
    const casesByLab = new Map<string, DentalCase[]>();
    for (const c of cases) {
      if (c.status === 'delivered' || c.status === 'cancelled') continue;
      const bucket = casesByLab.get(c.lab_id);
      if (bucket) bucket.push(c);
      else casesByLab.set(c.lab_id, [c]);
    }

    const today = todayStr || '1970-01-01';
    return labs
      .map((lab) => {
        const labInvoices = invoicesByLab.get(lab.id) || [];
        const labCases = casesByLab.get(lab.id) || [];
        const billed = labInvoices.reduce((sum, i) => sum + i.final_amount, 0);
        const paid = labInvoices.reduce((sum, i) => sum + i.amount_paid, 0);
        const balance = billed - paid;
        const overdueInvoices = labInvoices.filter(
          (i) => i.payment_status !== 'paid' && i.due_date && i.due_date < today
        );
        return {
          lab,
          name: lab.name,
          // Only the doctor_name branch is a doctor, so only it takes the honorific —
// a clinic's contact person is a person, not a title we get to invent.
          doctor: lab.doctor_name
            ? formatDoctorName(lab.doctor_name)
            : lab.contact_person || 'Lead Doctor',
          phone: lab.phone || '—',
          activeCaseCount: labCases.length,
          billed,
          paid,
          balance,
          overdueCount: overdueInvoices.length,
          status: balance <= 0 ? 'Settled' : overdueInvoices.length > 0 ? 'Overdue' : 'Partial',
        };
      })
      .sort((a, b) => b.balance - a.balance);
  }, [labs, invoices, cases, todayStr]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return accounts.filter((a) => {
      if (!showSettled && a.status === 'Settled') return false;
      if (!term) return true;
      return (
        a.name.toLowerCase().includes(term) ||
        a.doctor.toLowerCase().includes(term) ||
        a.phone.toLowerCase().includes(term)
      );
    });
  }, [accounts, search, showSettled]);

  const totals = useMemo(
    () => ({
      outstanding: accounts.reduce((s, a) => s + Math.max(0, a.balance), 0),
      overdue: accounts.filter((a) => a.status === 'Overdue').length,
      settled: accounts.filter((a) => a.status === 'Settled').length,
    }),
    [accounts]
  );

  if (accounts.length === 0) {
    return (
      <EmptyState
        icon={Search}
        title="No dental clinics yet"
        description="Add a clinic to start tracking its account balance."
      />
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Clinic Accounts"
        subtitle="Per-clinic balances, collections and outstanding statements"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showSettled}
                onChange={(e) => setShowSettled(e.target.checked)}
                className="accent-slate-900"
              />
              <span className="whitespace-nowrap">Include settled</span>
            </label>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-ink-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search clinic, doctor, phone…"
                className="w-56 pl-8 pr-3 py-1.5 rounded-xl border border-slate-200 text-xs focus:border-blue-400 focus:outline-none"
              />
            </div>
          </div>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-white rounded-2xl border border-slate-200/80 px-4 py-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">Outstanding</div>
          <div className="text-xl font-extrabold text-slate-900 tabular-nums whitespace-nowrap">
            PKR {Math.round(totals.outstanding).toLocaleString()}
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200/80 px-4 py-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">Clinics overdue</div>
          <div className="text-xl font-extrabold text-slate-900 tabular-nums">
            {totals.overdue}
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200/80 px-4 py-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">Settled clinics</div>
          <div className="text-xl font-extrabold text-slate-900 tabular-nums">
            {totals.settled}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200/80 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-600">
            <thead className="bg-slate-50/80 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              <tr>
                <th className="py-3 px-4">Clinic</th>
                <th className="py-3 px-3 text-right">Billed</th>
                <th className="py-3 px-3 text-right">Collected</th>
                <th className="py-3 px-3 text-right">Outstanding</th>
                <th className="py-3 px-3">Active Cases</th>
                <th className="py-3 px-3">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((a) => (
                <tr key={a.lab.id} className="hover:bg-slate-50/60 transition">
                  <td className="py-3 px-4 font-semibold text-slate-900">
                    <span className="block max-w-[220px] truncate" title={a.name}>{a.name}</span>
                    <span className="block text-[11px] font-normal text-ink-muted max-w-[220px] truncate">
                      {a.doctor} • {a.phone}
                    </span>
                  </td>
                  <td className="py-3 px-3 text-right tabular-nums whitespace-nowrap">
                    {Math.round(a.billed).toLocaleString()}
                  </td>
                  <td className="py-3 px-3 text-right tabular-nums whitespace-nowrap text-emerald-700">
                    {Math.round(a.paid).toLocaleString()}
                  </td>
                  <td className="py-3 px-3 text-right tabular-nums whitespace-nowrap font-bold text-slate-900">
                    {Math.max(0, Math.round(a.balance)).toLocaleString()}
                  </td>
                  <td className="py-3 px-3 tabular-nums whitespace-nowrap">
                    {a.activeCaseCount}
                  </td>
                  <td className="py-3 px-3">
                    <Badge variant={a.status === 'Overdue' ? 'danger' : a.status === 'Settled' ? 'success' : 'warning'}>
                      {a.status}
                      {a.status === 'Overdue' ? ` (${a.overdueCount})` : ''}
                    </Badge>
                  </td>
                  <td className="py-3 px-4 text-right whitespace-nowrap">
                    <div className="flex items-center justify-end gap-3">
                      <button
                        onClick={() => onCollect(a.lab.id)}
                        className="text-xs font-semibold text-ink-success hover:text-emerald-800 cursor-pointer whitespace-nowrap"
                      >
                        Collect
                      </button>
                      <button
                        onClick={() => onStatement(a.lab.id)}
                        className="text-xs font-semibold text-ink-info hover:text-blue-800 cursor-pointer whitespace-nowrap"
                      >
                        Statement
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {filtered.length === 0 && (
          <p className="px-4 py-8 text-center text-xs text-ink-muted">
            No clinic matches “{search}”.
          </p>
        )}

        {accounts.length > filtered.length && (
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-t border-slate-100 text-xs text-slate-500">
            <span>
              Showing {filtered.length} of {accounts.length} clinics — ordered by outstanding balance
            </span>
            <button
              onClick={onOpenClinics}
              className="font-semibold text-indigo-600 hover:text-indigo-800 cursor-pointer flex items-center gap-1 whitespace-nowrap"
            >
              Open Dental Clinics
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};