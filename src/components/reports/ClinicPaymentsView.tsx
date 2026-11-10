import React, { useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { collectAllPayments } from '../../services/ledgerDomain';
import { DatePickerRange } from '../common/DatePickerRange';
import { ClinicPicker } from '../common/ui/ClinicPicker';
import { formatPKR } from '../../services/financeDomain';
import { formatDate } from '../../utils/dateUtils';
import { DataTable, type DataTableColumn } from '../common/ui/DataTable';
import {
  Banknote,
  ArrowUpRight,
  ArrowDownLeft,
  Search,
  X,
  HandCoins,
  Receipt,
  Building2,
} from 'lucide-react';

/**
 * CLINIC PAYMENTS — the one place every payment the lab has received or paid
 * out is listed, whatever kind it is.
 *
 * The point of this tab is completeness, not aggregation: cash, bank transfer
 * and cheque payments against invoices, advance deposits sitting with us,
 * advance credit applied to invoices (a 0/0 memo, NOT new money) and refunds
 * we paid out. Per-payment detail — voucher number, method, reference number,
 * who recorded it, notes — is printed on the row instead of hidden behind a
 * drill-down, because "proper details" is what the operator asked for.
 *
 * Invoices themselves are not payments and are deliberately absent; credit
 * notes and debit adjustments are adjustments, not money, and also absent.
 */

type PaymentKind = 'direct' | 'advance_deposit' | 'advance_applied' | 'refund';

interface PaymentRow {
  id: string;
  /** ISO date, used for filtering, sorting and printing. */
  date: string;
  typeLabel: string;
  kind: PaymentKind;
  voucher: string;
  clinicId: string;
  clinicName: string;
  /** The clinic's job reference, when one exists. */
  caseNumber: string;
  invoiceNumber: string;
  method: string;
  reference: string;
  amount: number;
  direction: 'in' | 'out' | 'memo';
  recordedBy: string;
  notes: string;
}

const METHOD_LABEL: Record<string, string> = {
  cash: 'Cash',
  bank: 'Bank transfer',
  cheque: 'Cheque',
  advance: 'Advance',
};

const KIND_META: Record<PaymentKind, { label: string; chip: string }> = {
  direct: { label: 'Payment', chip: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  advance_deposit: { label: 'Advance deposit', chip: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  advance_applied: { label: 'Advance applied', chip: 'bg-slate-100 text-slate-600 border-slate-200' },
  refund: { label: 'Refund', chip: 'bg-rose-50 text-rose-700 border-rose-200' },
};

const isAdvanceAllocation = (payment: { payment_method?: string; payment_type?: string }): boolean =>
  payment.payment_method === 'advance' || payment.payment_type === 'advance_allocation';

/** Day clamp: '' dates sort last instead of crashing the comparator. */
const dayOf = (value?: string): string => String(value || '').slice(0, 10);

export const ClinicPaymentsView: React.FC = () => {
  const { labs, invoices, advancePayments, accountAdjustments, cases } = useApp();

  const [clinicId, setClinicId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<'all' | PaymentKind>('all');
  const [sortDesc, setSortDesc] = useState(true);

  const caseById = useMemo(() => {
    const map = new Map<string, string>();
    (cases || []).forEach((c) => map.set(c.id, c.case_number));
    return map;
  }, [cases]);

  const rows = useMemo<PaymentRow[]>(() => {
    const out: PaymentRow[] = [];

    /* Invoice-linked payments: direct cash/bank/cheque receipts and the 0/0
       memos that apply advance credit instead of new money. Only receipts from
       the clinic count as payments; an advance allocation posts nothing. */
    (collectAllPayments(invoices || [])).forEach((p) => {
      const applied = isAdvanceAllocation(p);
      const invoice = (invoices || []).find((inv) => inv.id === p.invoice_id);
      out.push({
        id: `pay-${p.id}`,
        date: dayOf(p.payment_date),
        typeLabel: applied ? KIND_META.advance_applied.label : KIND_META.direct.label,
        kind: applied ? 'advance_applied' : 'direct',
        voucher: p.payment_number || p.receipt_number || '—',
        clinicId: p.lab_id || invoice?.lab_id || '',
        clinicName: p.lab_name || invoice?.lab_name || 'Clinic',
        caseNumber: p.case_number || (invoice ? invoice.case_number : '') || caseById.get(invoice?.case_id || '') || '',
        invoiceNumber: p.invoice_number || invoice?.invoice_number || '',
        method: METHOD_LABEL[String(p.payment_method || 'bank')] || String(p.payment_method || 'bank'),
        reference: p.reference_number || '',
        amount: p.amount || 0,
        direction: applied ? 'memo' : 'in',
        recordedBy: p.recorded_by || '',
        notes: p.notes || '',
      });
    });

    /* Advance deposits: money in, held as credit until applied. */
    (advancePayments || []).forEach((adv) => {
      out.push({
        id: `adv-${adv.id}`,
        date: dayOf(adv.payment_date || adv.created_at),
        typeLabel: KIND_META.advance_deposit.label,
        kind: 'advance_deposit',
        voucher: adv.payment_number || adv.receipt_number || '—',
        clinicId: adv.lab_id,
        clinicName: adv.lab_name || 'Clinic',
        caseNumber: '',
        invoiceNumber: '',
        method: METHOD_LABEL[String(adv.payment_method || 'cash')] || String(adv.payment_method || 'cash'),
        reference: adv.reference_number || '',
        amount: adv.amount || 0,
        direction: 'in',
        recordedBy: adv.recorded_by || '',
        notes: adv.notes || '',
      });
    });

    /* Refunds: money paid back to the clinic by the lab. Debit adjustments and
       credit notes are accounting entries, not payments, so they stay out. */
    (accountAdjustments || []).forEach((adj) => {
      if (adj.type !== 'refund') return;
      out.push({
        id: `ref-${adj.id}`,
        date: dayOf(adj.date || adj.created_at),
        typeLabel: KIND_META.refund.label,
        kind: 'refund',
        voucher: adj.adjustment_number || '—',
        clinicId: adj.lab_id,
        clinicName: adj.lab_name || 'Clinic',
        caseNumber: adj.case_number || '',
        invoiceNumber: adj.invoice_number || '',
        method: 'Refund',
        reference: adj.reference_number || '',
        amount: adj.amount || 0,
        direction: 'out',
        recordedBy: adj.recorded_by || '',
        notes: adj.reason || adj.notes || '',
      });
    });

    return out;
  }, [invoices, advancePayments, accountAdjustments, caseById]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = rows.filter((row) => {
      if (clinicId && row.clinicId !== clinicId) return false;
      if (from && row.date < from) return false;
      if (to && row.date > to) return false;
      if (kind !== 'all' && row.kind !== kind) return false;
      if (q) {
        const haystack = [
          row.clinicName, row.voucher, row.invoiceNumber, row.caseNumber,
          row.reference, row.notes, row.recordedBy, row.method, row.typeLabel,
        ].join(' ').toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
    return sortDesc ? list.sort((a, b) => (a.date === b.date ? 0 : a.date > b.date ? -1 : 1)) : list.sort((a, b) => (a.date === b.date ? 0 : a.date > b.date ? 1 : -1));
  }, [rows, clinicId, from, to, kind, query, sortDesc]);

  const totals = useMemo(() => {
    let received = 0;
    let refunds = 0;
    let advanceApplied = 0;
    let deposits = 0;
    filtered.forEach((row) => {
      if (row.direction === 'in') {
        received += row.amount;
        if (row.kind === 'advance_deposit') deposits += row.amount;
      } else if (row.direction === 'out') {
        refunds += row.amount;
      } else {
        advanceApplied += row.amount;
      }
    });
    return { received, refunds, advanceApplied, deposits, net: received - refunds };
  }, [filtered]);

  const KIND_FILTERS: { id: 'all' | PaymentKind; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'direct', label: 'Payments' },
    { id: 'advance_deposit', label: 'Advance deposits' },
    { id: 'advance_applied', label: 'Advance applied' },
    { id: 'refund', label: 'Refunds' },
  ];

  const columns: DataTableColumn<PaymentRow>[] = [
    {
      header: (
        <button type="button" onClick={() => setSortDesc((v) => !v)} className="cursor-pointer hover:text-slate-800">
          Date {sortDesc ? '↓' : '↑'}
        </button>
      ),
      render: (row) => <span className="whitespace-nowrap tabular-nums">{formatDate(row.date) || '—'}</span>,
    },
    {
      header: 'Type',
      render: (row) => (
        <span className={`inline-flex items-center rounded-full border px-1.5 py-px text-[10px] font-bold whitespace-nowrap ${KIND_META[row.kind].chip}`}>
          {row.typeLabel}
        </span>
      ),
    },
    {
      header: 'Voucher',
      render: (row) => (
        <div className="leading-tight">
          <span className="whitespace-nowrap font-mono font-bold text-slate-800">{row.voucher}</span>
          {row.invoiceNumber && <span className="block whitespace-nowrap text-[10px] text-slate-500">for {row.invoiceNumber}</span>}
        </div>
      ),
    },
    {
      header: 'Clinic',
      render: (row) => <span className="font-semibold text-slate-800">{row.clinicName}</span>,
    },
    {
      header: 'Job',
      render: (row) => <span className="font-mono text-slate-700">{row.caseNumber || '—'}</span>,
    },
    {
      header: 'Method',
      render: (row) => <span className="whitespace-nowrap text-slate-700">{row.method}</span>,
    },
    {
      header: 'Reference',
      render: (row) => <span className="font-mono text-[11px] text-slate-600">{row.reference || '—'}</span>,
    },
    {
      header: 'Amount',
      align: 'right',
      render: (row) => (
        <span className={`font-mono font-bold tabular-nums whitespace-nowrap ${
          row.direction === 'out' ? 'text-ink-danger' : row.direction === 'memo' ? 'text-slate-500' : 'text-ink-success'
        }`}>
          {row.direction === 'out' ? '−' : ''}{formatPKR(row.amount)}
        </span>
      ),
    },
    {
      header: 'Recorded by',
      render: (row) => <span className="whitespace-nowrap text-slate-600">{row.recordedBy || '—'}</span>,
    },
    {
      header: 'Notes',
      render: (row) => <span className="block max-w-64 truncate text-slate-600" title={row.notes}>{row.notes || '—'}</span>,
    },
  ];

  const emptyState = rows.length === 0 ? (
    <div className="rounded-2xl border border-dashed border-slate-200 px-6 py-12 text-center">
      <HandCoins className="mx-auto mb-2 h-6 w-6 text-slate-300" />
      <p className="text-xs font-bold text-slate-700">No payments recorded yet</p>
      <p className="mx-auto mt-1 max-w-sm text-[11px] leading-relaxed text-slate-500">
        Cash, bank and cheque receipts, advance deposits and refunds all appear here once they are recorded in the system.
      </p>
    </div>
  ) : (
    <div className="rounded-2xl border border-dashed border-slate-200 px-6 py-12 text-center">
      <Search className="mx-auto mb-2 h-6 w-6 text-slate-300" />
      <p className="text-xs font-bold text-slate-700">No payment matches this filter</p>
      <p className="mx-auto mt-1 max-w-sm text-[11px] leading-relaxed text-slate-500">
        {rows.length} payment{rows.length === 1 ? ' is' : 's are'} on record; the clinic, date range, type or search is hiding them.
      </p>
      <button
        type="button"
        onClick={() => { setClinicId(''); setFrom(''); setTo(''); setKind('all'); setQuery(''); }}
        className="mt-3 cursor-pointer rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-700 transition-colors hover:bg-slate-50"
      >
        Clear filters
      </button>
    </div>
  );

  return (
    <section className="space-y-4">
      {/* Search & filter bar */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
        <div className="flex flex-wrap items-center gap-2">
          <Building2 className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
          <div className="min-w-48 flex-1">
            <ClinicPicker
              clinics={labs}
              value={clinicId || null}
              onChange={(id) => setClinicId(id)}
              placeholder="Search any clinic…"
              emptyLabel={(q) => `No saved clinic matching "${q}"`}
              compact
              className="w-full"
            />
          </div>
          {clinicId && (
            <button
              type="button"
              onClick={() => setClinicId('')}
              className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-semibold text-slate-600 transition-colors hover:bg-slate-50"
              title="Show every clinic"
            >
              <X className="h-3.5 w-3.5" /> All clinics
            </button>
          )}
          <DatePickerRange from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} fullWidth={false} className="shrink-0" />
          <div className="relative flex-1 min-w-48">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Voucher, invoice, case, reference, notes…"
              aria-label="Search payments"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-8 pr-8 text-xs font-medium text-slate-900 focus:border-indigo-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-100"
            />
            {query && (
              <button type="button" onClick={() => setQuery('')} className="absolute right-2 top-2 cursor-pointer text-slate-400 hover:text-slate-700" aria-label="Clear search">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {/* Type filter + totals strip */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Payment type">
            {KIND_FILTERS.map((f) => {
              const active = kind === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setKind(f.id)}
                  aria-pressed={active}
                  className={`cursor-pointer rounded-full border px-2.5 py-1 text-[10px] font-bold transition-colors ${
                    active
                      ? 'border-indigo-200 bg-indigo-50 text-indigo-800'
                      : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-800'
                  }`}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-semibold text-slate-600">
            <span className="inline-flex items-center gap-1.5"><ArrowDownLeft className="h-3.5 w-3.5 text-ink-success" />Received <strong className="font-mono text-slate-900">{formatPKR(totals.received)}</strong></span>
            <span className="inline-flex items-center gap-1.5"><HandCoins className="h-3.5 w-3.5 text-indigo-500" />Deposits <strong className="font-mono text-slate-900">{formatPKR(totals.deposits)}</strong></span>
            <span className="inline-flex items-center gap-1.5"><ArrowUpRight className="h-3.5 w-3.5 text-ink-danger" />Refunds <strong className="font-mono text-slate-900">{formatPKR(totals.refunds)}</strong></span>
            <span className="inline-flex items-center gap-1.5"><Banknote className="h-3.5 w-3.5 text-slate-500" />Net <strong className="font-mono text-slate-900">{formatPKR(totals.net)}</strong></span>
            <span className="text-slate-400">· {filtered.length} row{filtered.length === 1 ? '' : 's'}</span>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
          <h3 className="flex items-center gap-2 text-xs font-bold text-slate-700">
            <Receipt className="h-4 w-4 text-slate-400" />
            {clinicId ? 'Payments for this clinic' : 'All clinic payments'}
            <span className="font-mono text-[11px] font-semibold text-slate-400">{filtered.length}</span>
          </h3>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Read-only</span>
        </div>
        <DataTable<PaymentRow>
          columns={columns}
          data={filtered}
          rowKey={(row) => row.id}
          stickyFirstColumn
          emptyState={emptyState}
          tfoot={(
            <tr className="border-t-2 border-slate-900 bg-slate-50 text-xs font-bold text-slate-800">
              <td className="ds-sticky-col bg-slate-50 px-3 py-2 whitespace-nowrap">Totals ({filtered.length})</td>
              <td className="px-3 py-2" colSpan={6}>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Received {formatPKR(totals.received)} · Refunds {formatPKR(totals.refunds)}</span>
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">{formatPKR(totals.net)}</td>
              <td className="px-3 py-2" colSpan={2} />
            </tr>
          )}
        />
      </div>
    </section>
  );
};

export default ClinicPaymentsView;
