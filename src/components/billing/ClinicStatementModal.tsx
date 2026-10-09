import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { formatPKR, roundMoney } from '../../services/financeDomain';
import { downloadCSV } from '../../services/csvExport';
import { X, Printer, Download, Calendar, Building2, FileText, CheckCircle2 } from 'lucide-react';
import { SavePdfButton } from '../print/SavePdfButton';
import { Modal } from '../common/ui';
import { getTodayStr } from '../../utils/dateUtils';
import { caseDetailLines, caseDetailText, findCaseForEntry } from '../../services/ledgerCaseDetail';
import { isAdvanceAppliedPayment } from '../../services/monthlyStatement';

interface ClinicStatementModalProps {
  isOpen: boolean;
  onClose: () => void;
  clinicId: string;
}

export const ClinicStatementModal: React.FC<ClinicStatementModalProps> = ({
  isOpen,
  onClose,
  clinicId
}) => {
  const {
    labs,
    getLabFinancialSummary,
    getLedgerEntries,
    brandingSettings,
    cases,
    invoices,
    advancePayments,
  } = useApp();

  const [dateRange, setDateRange] = useState<'all' | 'this_month' | 'last_month' | 'custom'>('all');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  const clinic = useMemo(() => {
    return labs.find((l) => l.id === clinicId) || labs[0];
  }, [labs, clinicId]);

  const financialSummary = useMemo(() => {
    if (!clinic) return null;
    return getLabFinancialSummary(clinic.id);
  }, [clinic, getLabFinancialSummary]);

  const rawLedger = useMemo(() => {
    if (!clinic) return [];
    return getLedgerEntries(clinic.id);
  }, [clinic, getLedgerEntries]);

  /* The selected Period as an inclusive [start, end] window, or null for
     "All Time". The end is pushed to 23:59 so a payment booked earlier today
     is never dropped by a filter whose end is `new Date()`. */
  const period = useMemo<{ start: Date; end: Date } | null>(() => {
    if (dateRange === 'all') return null;

    const today = new Date();
    const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

    if (dateRange === 'this_month') {
      return { start: new Date(today.getFullYear(), today.getMonth(), 1), end: endOfDay(today) };
    }
    if (dateRange === 'last_month') {
      return {
        start: new Date(today.getFullYear(), today.getMonth() - 1, 1),
        end: endOfDay(new Date(today.getFullYear(), today.getMonth(), 0)),
      };
    }
    // A custom range without a start date shows everything rather than a
    // blank statement.
    if (!startDate) return null;
    return {
      start: new Date(startDate),
      end: endDate ? endOfDay(new Date(endDate)) : endOfDay(today),
    };
  }, [dateRange, startDate, endDate]);

  // Filter ledger by the selected period
  const filteredLedger = useMemo(() => {
    if (!period) return rawLedger;
    const from = period.start.getTime();
    const to = period.end.getTime();
    return rawLedger.filter((entry) => {
      const t = new Date(entry.date).getTime();
      return !isNaN(t) && t >= from && t <= to;
    });
  }, [rawLedger, period]);

  const totalDebits = useMemo(() => {
    return filteredLedger.reduce((sum, e) => sum + (e.debit || 0), 0);
  }, [filteredLedger]);

  const totalCredits = useMemo(() => {
    return filteredLedger.reduce((sum, e) => sum + (e.credit || 0), 0);
  }, [filteredLedger]);

  /* ── Statement figures ────────────────────────────────────────────────────
     The card has to agree with the rows under it. `running_balance` on a
     ledger row is a true all-time running total (it already nets advances,
     credit notes and debit adjustments), so the period's own balance is read
     off the ledger: the balance carried into the period is the running
     balance of the newest row dated BEFORE it, and the closing balance is the
     running balance of the newest row inside it. Without that, a "This Month"
     statement printed this month's debits next to the all-time closing
     balance and the two figures could not be reconciled by hand. */
  const openingBalance = useMemo(() => {
    if (!period) return 0;
    const from = period.start.getTime();
    // rawLedger is newest-first, so the first row older than the window wins.
    for (const entry of rawLedger) {
      const t = new Date(entry.date).getTime();
      if (!isNaN(t) && t < from) return roundMoney(entry.running_balance || 0);
    }
    return 0;
  }, [rawLedger, period]);

  const closingBalance = useMemo(() => {
    const fromLedger = (() => {
      if (!rawLedger.length) return null;
      // `running_balance` grows with posting order, so the NEWEST row in scope
      // carries where the account stands at the end of the period.
      const newest = filteredLedger[0];
      if (!newest) return openingBalance;
      return roundMoney(newest.running_balance || 0);
    })();
    if (fromLedger !== null) return fromLedger;
    /* No ledger at all to read a balance from: fall back to the clinic's
       financial summary. `buildLabFinancialSummary` publishes snake_case
       fields; the camelCase aliases are legacy optional fields on the type,
       so they stay as a fallback. Reading only the alias is what made this
       card print PKR 0 on a PKR 25,000 balance. */
    return roundMoney(financialSummary?.net_balance ?? financialSummary?.netOutstanding ?? 0);
  }, [rawLedger, filteredLedger, openingBalance, financialSummary]);

  /* Unallocated advance wallet as at the end of the period: deposits banked
     up to then, less the credit already spent against invoices. */
  const advanceCredit = useMemo(() => {
    if (!clinic || !Array.isArray(advancePayments)) {
      return roundMoney(
        financialSummary?.advance_balance ?? financialSummary?.advanceCreditBalance ?? 0
      );
    }
    const to = period ? period.end.getTime() : Infinity;
    let deposited = 0;
    advancePayments
      .filter((a) => a.lab_id === clinic.id)
      .forEach((a) => {
        const t = new Date(a.payment_date || a.created_at || '').getTime();
        if (!isNaN(t) && t <= to) deposited += a.amount || 0;
      });
    let spent = 0;
    (Array.isArray(invoices) ? invoices : [])
      .filter((inv) => inv.lab_id === clinic.id)
      .forEach((inv) =>
        (inv.payments || []).forEach((p) => {
          if (!isAdvanceAppliedPayment(p)) return;
          const t = new Date(p.payment_date || inv.created_at || '').getTime();
          if (!isNaN(t) && t <= to) spent += p.amount || 0;
        })
      );
    return roundMoney(Math.max(0, deposited - spent));
  }, [clinic, advancePayments, invoices, period, financialSummary]);

  const remainingDue = Math.max(0, closingBalance);

  if (!isOpen || !clinic) return null;

  const handlePrint = () => {
    window.print();
  };

  const handleExportCSV = () => {
    const headers = ['Date', 'Type', 'Reference', 'Case/Job', 'Description', 'Debit (PKR)', 'Credit (PKR)', 'Running Balance (PKR)'];
    const rows = filteredLedger.map((e) => {
      const c = findCaseForEntry(e, cases);
      return [
        e.date,
        // The ledger engine publishes `entry_type`; `type` is a legacy
        // optional alias that is never populated, so reading it alone left
        // the Type column of every statement and CSV blank.
        e.entry_type || e.type || '',
        e.reference_number,
        c ? c.case_number : '',
        [e.description, c ? caseDetailText(c) : ''].filter(Boolean).join(' • '),
        e.debit || 0,
        e.credit || 0,
        e.running_balance
      ];
    });
    downloadCSV(`Statement_${clinic.name.replace(/\s+/g, '_')}_${getTodayStr()}`, [headers, ...rows]);
  };

  return (
    <Modal
      open
      onClose={onClose}
      label="Statement of account"
      hideClose
      maxWidth="max-w-5xl xl:max-w-6xl"
      backdropClassName="bg-slate-900/60 print:p-0 print:bg-white"
      cardClassName="print-area relative print:shadow-none print:border-none print:m-0 print:max-w-none"
      headerClassName="px-6 py-3.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between print:hidden"
      header={
        <>
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-indigo-600" />
            <h3 className="text-sm font-bold text-slate-900">
              Official Statement of Account • {clinic.name}
            </h3>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleExportCSV}
              className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg flex items-center gap-1.5 transition-colors"
            >
              <Download className="w-3.5 h-3.5 text-slate-500" />
              Export CSV
            </button>
            <SavePdfButton suggestedName={`Statement_${clinic?.name?.replace(/\s+/g, '_') || 'Clinic'}_${getTodayStr()}.pdf`} />
            <button
              onClick={handlePrint}
              className="px-3.5 py-1.5 text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 rounded-lg flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              Print Statement
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-ink-muted hover:text-slate-600 hover:bg-slate-200/60"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </>
      }
    >

        {/* Filters Bar (Hidden in Print) */}
        <div className="px-6 py-3 bg-white border-b border-slate-200 flex items-center gap-3 text-xs print:hidden">
          <span className="font-semibold text-slate-600">Period:</span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setDateRange('all')}
              className={`px-2.5 py-1 rounded-md font-semibold ${
                dateRange === 'all' ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              All Time
            </button>
            <button
              onClick={() => setDateRange('this_month')}
              className={`px-2.5 py-1 rounded-md font-semibold ${
                dateRange === 'this_month' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              This Month
            </button>
            <button
              onClick={() => setDateRange('last_month')}
              className={`px-2.5 py-1 rounded-md font-semibold ${
                dateRange === 'last_month' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              Last Month
            </button>
          </div>
        </div>

        {/* Printable Statement Document */}
        <div className="p-8 space-y-6 print:p-8" id="printable-statement">
          {/* Statement Header */}
          <div className="flex items-start justify-between border-b border-slate-200 pb-6">
            <div>
              <h1 className="text-xl font-bold text-slate-900 tracking-tight uppercase">
                {brandingSettings.appName || brandingSettings.lab_name || 'DENTAL SOLUTIONS LAB'}
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                {brandingSettings.tagline || 'Precision Dental Prosthetics & Digital Milling Center'}
              </p>
              <div className="text-xs text-slate-600 mt-2 space-y-0.5">
                {brandingSettings.address && <div>{brandingSettings.address}</div>}
                <div>
                  {[brandingSettings.phone && `Phone: ${brandingSettings.phone}`, brandingSettings.email].filter(Boolean).join(' • ')}
                </div>
              </div>
            </div>

            <div className="text-right">
              <div className="text-lg font-bold text-indigo-700 uppercase tracking-wide">
                STATEMENT OF ACCOUNT
              </div>
              <div className="text-xs text-slate-500 mt-1">Date: {getTodayStr()}</div>
              <div className="text-xs text-slate-500">Account ID: <strong className="font-mono text-slate-900">{clinic.id}</strong></div>
            </div>
          </div>

          {/* Statement To & Summary Cards */}
          <div className="grid grid-cols-2 gap-6 text-xs">
            <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 space-y-1">
              <span className="font-bold text-slate-500 uppercase tracking-wider block mb-1">
                Statement Issued To:
              </span>
              <div className="font-bold text-slate-900 text-sm">{clinic.name}</div>
              {clinic.contact_person && <div className="text-slate-600">Attn: {clinic.contact_person}</div>}
              {clinic.address && <div className="text-slate-600">{clinic.address}</div>}
              {clinic.phone && <div className="text-slate-600">Tel: {clinic.phone}</div>}
            </div>

            <div className="p-4 rounded-lg bg-indigo-50/50 border border-indigo-200 text-right space-y-1.5 flex flex-col justify-center">
              <div className="flex justify-between text-slate-600">
                <span>Opening Balance (B/F):</span>
                <span className="font-mono font-semibold text-slate-900">{formatPKR(openingBalance)}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Period Debits (Invoiced):</span>
                <span className="font-mono font-semibold text-slate-900">{formatPKR(totalDebits)}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Period Credits (Settled):</span>
                <span className="font-mono font-semibold text-emerald-700">{formatPKR(totalCredits)}</span>
              </div>
              <div className="border-t border-indigo-200 pt-1.5 flex justify-between text-slate-700 font-semibold text-[11px]">
                <span>Closing Balance (C/F):</span>
                <span className={`font-mono font-bold ${closingBalance < 0 ? 'text-emerald-700' : 'text-indigo-700'}`}>
                  {formatPKR(closingBalance)}
                </span>
              </div>
              {advanceCredit > 0 && (
                <div className="flex justify-between text-sky-700 font-medium text-[11px]">
                  <span>Advance Credit in Wallet:</span>
                  <span className="font-mono font-bold">{formatPKR(advanceCredit)}</span>
                </div>
              )}
              <div className="border-t border-indigo-200 pt-1.5 flex justify-between font-bold text-slate-900 text-sm">
                <span>Remaining Due:</span>
                <span className={`font-mono ${remainingDue > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
                  {formatPKR(remainingDue)}
                </span>
              </div>
            </div>
          </div>

          {/* Ledger Table */}
          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-200 text-slate-700 font-semibold">
                  <th scope="col" className="px-3.5 py-2.5">Date</th>
                  <th scope="col" className="px-3.5 py-2.5">Type</th>
                  <th scope="col" className="px-3.5 py-2.5">Reference #</th>
                  <th scope="col" className="px-3.5 py-2.5">Case/Job</th>
                  <th scope="col" className="px-3.5 py-2.5">Description</th>
                  <th scope="col" className="px-3.5 py-2.5 text-right">Debit (PKR)</th>
                  <th scope="col" className="px-3.5 py-2.5 text-right">Credit (PKR)</th>
                  <th scope="col" className="px-3.5 py-2.5 text-right">Balance (PKR)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
                {filteredLedger.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-slate-500 font-sans">
                      No statement movements in selected period.
                    </td>
                  </tr>
                ) : (
                  filteredLedger.map((entry) => {
                    const c = findCaseForEntry(entry, cases);
                    const detail = c ? caseDetailLines(c) : [];
                    return (
                    <tr key={entry.id}>
                      <td className="px-3.5 py-2 text-slate-600 font-sans">{entry.date}</td>
                      <td className="px-3.5 py-2 font-sans capitalize">{entry.entry_type || entry.type || '—'}</td>
                      <td className="px-3.5 py-2 font-bold text-slate-800">{entry.reference_number}</td>
                      <td className="px-3.5 py-2 font-sans text-indigo-800 font-bold">{c ? c.case_number : '—'}</td>
                      <td className="px-3.5 py-2 font-sans text-slate-700">
                        {entry.description}
                        {/* The case the money is booked against, so the
                            printed statement identifies the job, not just
                            the invoice number. */}
                        {detail.length > 0 && (
                          <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 rounded border border-slate-200 bg-slate-50 px-2 py-1.5">
                            {detail.map((d) => (
                              <div key={d.label} className="flex items-baseline gap-1 min-w-0">
                                <dt className="shrink-0 text-[9px] font-bold uppercase tracking-wider text-ink-muted">
                                  {d.label}
                                </dt>
                                <dd className="truncate text-[10px] text-slate-600" title={d.value}>
                                  {d.value}
                                </dd>
                              </div>
                            ))}
                          </dl>
                        )}
                      </td>
                      <td className="px-3.5 py-2 text-right font-semibold text-slate-900">
                        {entry.debit > 0 ? formatPKR(entry.debit).replace('PKR ', '') : '—'}
                      </td>
                      <td className="px-3.5 py-2 text-right font-semibold text-emerald-700">
                        {entry.credit > 0 ? formatPKR(entry.credit).replace('PKR ', '') : '—'}
                      </td>
                      <td className="px-3.5 py-2 text-right font-bold text-slate-900">
                        {formatPKR(entry.running_balance).replace('PKR ', '')}
                      </td>
                    </tr>
                    );
                  })
                )}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50 border-t-2 border-slate-300 font-bold font-mono">
                  <td colSpan={5} className="px-3.5 py-2.5 text-right font-sans text-slate-700">
                    Statement Totals — Closing {formatPKR(closingBalance).replace('PKR ', '')}
                  </td>
                  <td className="px-3.5 py-2.5 text-right text-slate-900">
                    {formatPKR(totalDebits).replace('PKR ', '')}
                  </td>
                  <td className="px-3.5 py-2.5 text-right text-emerald-700">
                    {formatPKR(totalCredits).replace('PKR ', '')}
                  </td>
                  <td className="px-3.5 py-2.5 text-right text-amber-700">
                    {formatPKR(remainingDue).replace('PKR ', '')}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Payment Terms & Bank Remittance Instructions */}
          <div className="border-t border-slate-200 pt-4 grid grid-cols-2 gap-4 text-xs text-slate-600">
            <div>
              <span className="font-bold text-slate-800 block mb-1">Bank Remittance Details:</span>
              <div>Bank: {brandingSettings.bankName || '—'}</div>
              <div>Account Title: {brandingSettings.bankAccountTitle || brandingSettings.appName || '—'}</div>
              {brandingSettings.bankIban && <div>IBAN: {brandingSettings.bankIban}</div>}
              {brandingSettings.email && <div>Please email deposit slip to {brandingSettings.email} with your clinic name.</div>}
            </div>

            <div className="text-right">
              <span className="font-bold text-slate-800 block mb-1">Remittance Instructions:</span>
              <div>Please settle outstanding balance within 15 days of statement date.</div>
              <div>For discrepancies or inquiries, call (051) 289-4400.</div>
              <div className="mt-4 text-ink-muted italic">This is an authorized computer-generated statement.</div>
            </div>
          </div>
        </div>
    </Modal>
  );
};
