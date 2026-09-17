import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { Invoice, PaymentRecord, AdvancePayment, AccountAdjustment, LedgerEntry } from '../../types';
import { formatPKR } from '../../services/financeDomain';
import { 
  Building2, 
  Search, 
  Wallet, 
  FileText, 
  ArrowDownLeft, 
  CheckCircle2, 
  Clock, 
  AlertCircle, 
  Scale, 
  Printer, 
  Plus, 
  ChevronRight, 
  Phone, 
  MapPin, 
  Receipt, 
  Calendar,
  History,
  ShieldCheck,
  TrendingUp,
  Percent,
  Split
} from 'lucide-react';

interface AccountsFinancialHomeProps {
  initialClinicId?: string;
  onOpenPaymentModal: (clinicId: string, invoiceId?: string) => void;
  onOpenAdvanceModal: (clinicId: string) => void;
  onOpenStatementModal: (clinicId: string) => void;
  onOpenInvoiceDrawer: (invoice: Invoice) => void;
  onOpenJournalModal: (referenceId: string) => void;
  onViewReceipt: (payment: PaymentRecord) => void;
}

export const AccountsFinancialHome: React.FC<AccountsFinancialHomeProps> = ({
  initialClinicId,
  onOpenPaymentModal,
  onOpenAdvanceModal,
  onOpenStatementModal,
  onOpenInvoiceDrawer,
  onOpenJournalModal,
  onViewReceipt
}) => {
  const { 
    labs, 
    invoices, 
    advancePayments, 
    accountAdjustments, 
    allPayments, 
    auditEvents, 
    getLabFinancialSummary,
    getLedgerEntries,
    applyAdvanceCreditV2
  } = useApp();

  const [selectedClinicId, setSelectedClinicId] = useState<string>(
    initialClinicId || (labs[0]?.id || '')
  );
  const [clinicSearch, setClinicSearch] = useState<string>('');
  const [activeSubTab, setActiveSubTab] = useState<'overview' | 'invoices' | 'wallet' | 'ledger' | 'activity'>('overview');

  // Quick Apply Advance modal state
  const [applyAdvanceTarget, setApplyAdvanceTarget] = useState<{ invoiceId: string; due: number } | null>(null);
  const [applyAdvanceAmount, setApplyAdvanceAmount] = useState<number>(0);

  const selectedClinic = useMemo(() => {
    return labs.find((l) => l.id === selectedClinicId) || labs[0];
  }, [labs, selectedClinicId]);

  const clinicSummary = useMemo(() => {
    if (!selectedClinic) return null;
    return getLabFinancialSummary(selectedClinic.id);
  }, [selectedClinic, getLabFinancialSummary]);

  // Clinic invoices
  const clinicInvoices = useMemo(() => {
    if (!selectedClinic) return [];
    return invoices.filter((i) => i.lab_id === selectedClinic.id);
  }, [invoices, selectedClinic]);

  // Clinic advance deposits
  const clinicAdvances = useMemo(() => {
    if (!selectedClinic) return [];
    return advancePayments.filter((a) => a.lab_id === selectedClinic.id && !a.is_reversed);
  }, [advancePayments, selectedClinic]);

  // Clinic payments
  const clinicPayments = useMemo(() => {
    if (!selectedClinic) return [];
    return allPayments.filter((p) => p.lab_id === selectedClinic.id);
  }, [allPayments, selectedClinic]);

  // Running balance ledger
  const clinicLedger = useMemo(() => {
    if (!selectedClinic) return [];
    return getLedgerEntries(selectedClinic.id);
  }, [selectedClinic, getLedgerEntries]);

  // Filtered clinic list for directory sidebar
  const filteredClinics = useMemo(() => {
    if (!clinicSearch.trim()) return labs;
    const q = clinicSearch.toLowerCase();
    return labs.filter((l) => l.name.toLowerCase().includes(q) || l.city?.toLowerCase().includes(q));
  }, [labs, clinicSearch]);

  // Aging Analysis for Selected Clinic
  const aging = useMemo(() => {
    let current = 0;
    let days1_30 = 0;
    let days31_60 = 0;
    let days61_90 = 0;
    let days90Plus = 0;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    clinicInvoices.forEach((inv) => {
      const remaining = Math.max(0, inv.final_amount - (inv.amount_paid || 0) - (inv.credit_notes_total || 0));
      if (remaining <= 0) return;

      if (!inv.due_date) {
        current += remaining;
        return;
      }

      const due = new Date(inv.due_date);
      due.setHours(0, 0, 0, 0);
      const diffDays = Math.ceil((today.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));

      if (diffDays <= 0) {
        current += remaining;
      } else if (diffDays <= 30) {
        days1_30 += remaining;
      } else if (diffDays <= 60) {
        days31_60 += remaining;
      } else if (diffDays <= 90) {
        days61_90 += remaining;
      } else {
        days90Plus += remaining;
      }
    });

    return { current, days1_30, days31_60, days61_90, days90Plus };
  }, [clinicInvoices]);

  const handleApplyAdvanceSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!applyAdvanceTarget || applyAdvanceAmount <= 0) return;
    applyAdvanceCreditV2({
      clinicId: selectedClinic.id,
      invoiceId: applyAdvanceTarget.invoiceId,
      amount: applyAdvanceAmount,
      notes: 'Applied from clinic credit wallet'
    });
    setApplyAdvanceTarget(null);
    setApplyAdvanceAmount(0);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
      {/* Left Column: Clinic Directory Picker */}
      <div className="lg:col-span-1 bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden flex flex-col h-[760px]">
        <div className="p-3.5 border-b border-slate-200 bg-slate-50">
          <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-2">
            Dental Clinics Directory
          </h3>
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
            <input
              type="text"
              value={clinicSearch}
              onChange={(e) => setClinicSearch(e.target.value)}
              placeholder="Search clinic..."
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
          {filteredClinics.map((clinic) => {
            const summary = getLabFinancialSummary(clinic.id);
            const isSelected = selectedClinic?.id === clinic.id;
            return (
              <button
                key={clinic.id}
                onClick={() => {
                  setSelectedClinicId(clinic.id);
                  setActiveSubTab('overview');
                }}
                className={`w-full text-left p-3.5 transition-colors flex items-start justify-between ${
                  isSelected
                    ? 'bg-indigo-50/80 border-l-4 border-indigo-600'
                    : 'hover:bg-slate-50'
                }`}
              >
                <div className="min-w-0 pr-2">
                  <div className="font-semibold text-xs text-slate-900 truncate">
                    {clinic.name}
                  </div>
                  <div className="text-[11px] text-slate-500 flex items-center gap-1 mt-0.5">
                    <MapPin className="w-3 h-3 text-slate-400" />
                    <span>{clinic.city || 'Pakistan'}</span>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <div className="font-mono text-xs font-bold text-slate-900">
                    {formatPKR(summary.netOutstanding ?? 0)}
                  </div>
                  {(summary.advanceCreditBalance ?? 0) > 0 && (
                    <div className="text-[10px] text-emerald-700 font-semibold mt-0.5">
                      +{formatPKR(summary.advanceCreditBalance ?? 0)} credit
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Right Column: Complete Clinic Financial Profile */}
      <div className="lg:col-span-3 space-y-6">
        {selectedClinic && (
          <>
            {/* Clinic Master Header & Quick Actions */}
            <div className="p-5 bg-white rounded-xl border border-slate-200 shadow-2xs">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-start gap-3.5">
                  <div className="w-12 h-12 rounded-xl bg-indigo-600 text-white flex items-center justify-center font-bold text-lg shadow-xs">
                    {selectedClinic.name.charAt(0)}
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">{selectedClinic.name}</h2>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 mt-1">
                      {selectedClinic.phone && (
                        <span className="flex items-center gap-1">
                          <Phone className="w-3.5 h-3.5 text-slate-400" /> {selectedClinic.phone}
                        </span>
                      )}
                      {selectedClinic.address && (
                        <span className="flex items-center gap-1">
                          <MapPin className="w-3.5 h-3.5 text-slate-400" /> {selectedClinic.address}
                        </span>
                      )}
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-700 uppercase">
                        Account ID: {selectedClinic.id}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Header Action Buttons */}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => onOpenPaymentModal(selectedClinic.id)}
                    className="px-3.5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-xs flex items-center gap-1.5 transition-colors"
                  >
                    <ArrowDownLeft className="w-3.5 h-3.5" />
                    Collect Payment
                  </button>
                  <button
                    onClick={() => onOpenAdvanceModal(selectedClinic.id)}
                    className="px-3.5 py-2 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg flex items-center gap-1.5 transition-colors"
                  >
                    <Wallet className="w-3.5 h-3.5" />
                    Record Advance
                  </button>
                  <button
                    onClick={() => onOpenStatementModal(selectedClinic.id)}
                    className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg flex items-center gap-1.5 transition-colors"
                  >
                    <Printer className="w-3.5 h-3.5 text-slate-500" />
                    Statement of Account
                  </button>
                </div>
              </div>

              {/* Sub-Navigation Tabs */}
              <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 mt-5 -mb-5 pt-1 no-scrollbar">
                <button
                  onClick={() => setActiveSubTab('overview')}
                  className={`pb-3 text-xs font-semibold border-b-2 px-3 transition-colors ${
                    activeSubTab === 'overview'
                      ? 'border-indigo-600 text-indigo-600'
                      : 'border-transparent text-slate-500 hover:text-slate-700'
                  }`}
                >
                  Account Overview
                </button>
                <button
                  onClick={() => setActiveSubTab('invoices')}
                  className={`pb-3 text-xs font-semibold border-b-2 px-3 transition-colors ${
                    activeSubTab === 'invoices'
                      ? 'border-indigo-600 text-indigo-600'
                      : 'border-transparent text-slate-500 hover:text-slate-700'
                  }`}
                >
                  Invoices ({clinicInvoices.length})
                </button>
                <button
                  onClick={() => setActiveSubTab('wallet')}
                  className={`pb-3 text-xs font-semibold border-b-2 px-3 transition-colors ${
                    activeSubTab === 'wallet'
                      ? 'border-indigo-600 text-indigo-600'
                      : 'border-transparent text-slate-500 hover:text-slate-700'
                  }`}
                >
                  Credit Wallet ({formatPKR(clinicSummary?.advanceCreditBalance || 0)})
                </button>
                <button
                  onClick={() => setActiveSubTab('ledger')}
                  className={`pb-3 text-xs font-semibold border-b-2 px-3 transition-colors ${
                    activeSubTab === 'ledger'
                      ? 'border-indigo-600 text-indigo-600'
                      : 'border-transparent text-slate-500 hover:text-slate-700'
                  }`}
                >
                  Statement Ledger
                </button>
                <button
                  onClick={() => setActiveSubTab('activity')}
                  className={`pb-3 text-xs font-semibold border-b-2 px-3 transition-colors ${
                    activeSubTab === 'activity'
                      ? 'border-indigo-600 text-indigo-600'
                      : 'border-transparent text-slate-500 hover:text-slate-700'
                  }`}
                >
                  Audit Activity
                </button>
              </div>
            </div>

            {/* TAB 1: OVERVIEW */}
            {activeSubTab === 'overview' && (
              <div className="space-y-6">
                {/* 4 Financial Health Metrics */}
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                  <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-2xs">
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Net Outstanding Due</span>
                    <div className="text-xl font-bold font-mono text-slate-900 mt-2">
                      {formatPKR(clinicSummary?.netOutstanding || 0)}
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">Pending balance across all open invoices</p>
                  </div>

                  <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-2xs">
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Available Advance Wallet</span>
                    <div className="text-xl font-bold font-mono text-emerald-700 mt-2">
                      {formatPKR(clinicSummary?.advanceCreditBalance || 0)}
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">Unallocated customer deposit ready to apply</p>
                  </div>

                  <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-2xs">
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Billed to Date</span>
                    <div className="text-xl font-bold font-mono text-slate-900 mt-2">
                      {formatPKR(clinicSummary?.totalInvoiced || 0)}
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">{clinicInvoices.length} historical invoices issued</p>
                  </div>

                  <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-2xs">
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Settlement Recovery Rate</span>
                    <div className="text-xl font-bold font-mono text-indigo-700 mt-2">
                      {clinicSummary?.totalInvoiced && clinicSummary.totalInvoiced > 0
                        ? `${Math.round(((clinicSummary.totalInvoiced - (clinicSummary.netOutstanding ?? 0)) / clinicSummary.totalInvoiced) * 100)}%`
                        : '100%'}
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">Total revenue collected on time</p>
                  </div>
                </div>

                {/* Aging Breakdown Matrix */}
                <div className="p-5 bg-white rounded-xl border border-slate-200 shadow-2xs space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                      <Clock className="w-4 h-4 text-slate-500" />
                      Receivables Aging Analysis
                    </h3>
                    <span className="text-xs text-slate-500 font-mono">
                      Total: <strong>{formatPKR(clinicSummary?.netOutstanding || 0)}</strong>
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
                    <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                      <span className="text-slate-500 block mb-1">Current (Not Due)</span>
                      <span className="font-mono font-bold text-slate-900 text-sm">{formatPKR(aging.current)}</span>
                    </div>
                    <div className="p-3 rounded-lg bg-amber-50/70 border border-amber-200">
                      <span className="text-amber-800 block mb-1">1 - 30 Days Past Due</span>
                      <span className="font-mono font-bold text-amber-900 text-sm">{formatPKR(aging.days1_30)}</span>
                    </div>
                    <div className="p-3 rounded-lg bg-orange-50/70 border border-orange-200">
                      <span className="text-orange-800 block mb-1">31 - 60 Days Past Due</span>
                      <span className="font-mono font-bold text-orange-900 text-sm">{formatPKR(aging.days31_60)}</span>
                    </div>
                    <div className="p-3 rounded-lg bg-rose-50/70 border border-rose-200">
                      <span className="text-rose-800 block mb-1">61 - 90 Days Past Due</span>
                      <span className="font-mono font-bold text-rose-900 text-sm">{formatPKR(aging.days61_90)}</span>
                    </div>
                    <div className="p-3 rounded-lg bg-red-100/60 border border-red-300">
                      <span className="text-red-800 block mb-1">90+ Days Critical</span>
                      <span className="font-mono font-bold text-red-900 text-sm">{formatPKR(aging.days90Plus)}</span>
                    </div>
                  </div>
                </div>

                {/* Open Invoices Quick Table */}
                <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
                  <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
                    <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                      Active Invoices Requiring Payment
                    </h3>
                    <button
                      onClick={() => setActiveSubTab('invoices')}
                      className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold"
                    >
                      View All Invoices ({clinicInvoices.length})
                    </button>
                  </div>

                  <div className="divide-y divide-slate-100">
                    {clinicInvoices
                      .filter((i) => i.final_amount - (i.amount_paid || 0) - (i.credit_notes_total || 0) > 0)
                      .slice(0, 5)
                      .map((inv) => {
                        const due = inv.final_amount - (inv.amount_paid || 0) - (inv.credit_notes_total || 0);
                        return (
                          <div key={inv.id} className="p-4 flex items-center justify-between hover:bg-slate-50 transition-colors text-xs">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-mono font-bold text-slate-900">{inv.invoice_number}</span>
                                {inv.patient_name && <span className="text-slate-600">• Pt: {inv.patient_name}</span>}
                                <span className="text-slate-400">• Due: {inv.due_date}</span>
                              </div>
                              <div className="text-[11px] text-slate-500 mt-0.5">
                                Total Billed: {formatPKR(inv.final_amount)} • Paid: {formatPKR(inv.amount_paid || 0)}
                              </div>
                            </div>

                            <div className="flex items-center gap-3">
                              <span className="font-mono font-bold text-sm text-slate-900">{formatPKR(due)}</span>
                              <button
                                onClick={() => onOpenInvoiceDrawer(inv)}
                                className="px-2.5 py-1 text-xs text-indigo-600 hover:bg-indigo-50 rounded-md font-semibold border border-indigo-200"
                              >
                                Details
                              </button>
                              {clinicSummary && (clinicSummary.advanceCreditBalance ?? 0) > 0 && (
                                <button
                                  onClick={() => {
                                    setApplyAdvanceTarget({ invoiceId: inv.id, due });
                                    setApplyAdvanceAmount(Math.min(due, clinicSummary.advanceCreditBalance ?? 0));
                                  }}
                                  className="px-2.5 py-1 text-xs text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-md font-semibold border border-emerald-200"
                                >
                                  Apply Credit
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: ALL INVOICES */}
            {activeSubTab === 'invoices' && (
              <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
                <table className="w-full text-xs text-left">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                      <th className="px-4 py-3">Invoice #</th>
                      <th className="px-4 py-3">Issue Date</th>
                      <th className="px-4 py-3">Patient / Case</th>
                      <th className="px-4 py-3 text-right">Total</th>
                      <th className="px-4 py-3 text-right">Paid</th>
                      <th className="px-4 py-3 text-right">Balance Due</th>
                      <th className="px-4 py-3 text-center">Status</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {clinicInvoices.map((inv) => {
                      const due = Math.max(0, inv.final_amount - (inv.amount_paid || 0) - (inv.credit_notes_total || 0));
                      return (
                        <tr key={inv.id} className="hover:bg-slate-50/70 transition-colors">
                          <td className="px-4 py-3 font-mono font-bold text-slate-900">{inv.invoice_number}</td>
                          <td className="px-4 py-3 text-slate-600">{inv.issue_date}</td>
                          <td className="px-4 py-3 text-slate-800">{inv.patient_name || 'Case Work'}</td>
                          <td className="px-4 py-3 text-right font-mono font-medium text-slate-700">{formatPKR(inv.final_amount)}</td>
                          <td className="px-4 py-3 text-right font-mono font-medium text-emerald-700">{formatPKR(inv.amount_paid || 0)}</td>
                          <td className="px-4 py-3 text-right font-mono font-bold text-slate-900">{formatPKR(due)}</td>
                          <td className="px-4 py-3 text-center">
                            <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                              due <= 0
                                ? 'bg-emerald-50 text-emerald-700'
                                : (inv.amount_paid || 0) > 0
                                ? 'bg-amber-50 text-amber-700'
                                : 'bg-red-50 text-red-700'
                            }`}>
                              {due <= 0 ? 'PAID' : (inv.amount_paid || 0) > 0 ? 'PARTIAL' : 'UNPAID'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              onClick={() => onOpenInvoiceDrawer(inv)}
                              className="px-2.5 py-1 text-xs text-indigo-600 hover:bg-indigo-50 rounded font-semibold transition-colors"
                            >
                              Inspect
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* TAB 3: CREDIT WALLET */}
            {activeSubTab === 'wallet' && (
              <div className="space-y-4">
                <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between">
                  <div>
                    <span className="text-xs font-semibold text-emerald-800 uppercase tracking-wider block mb-1">
                      Available Advance Credit Wallet
                    </span>
                    <span className="text-2xl font-bold font-mono text-emerald-900">
                      {formatPKR(clinicSummary?.advanceCreditBalance || 0)}
                    </span>
                    <p className="text-xs text-emerald-700 mt-1">
                      These funds were paid upfront and can be applied against current or future invoices at any time.
                    </p>
                  </div>
                  <button
                    onClick={() => onOpenAdvanceModal(selectedClinic.id)}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg text-xs shadow-xs flex items-center gap-1.5"
                  >
                    <Plus className="w-4 h-4" />
                    Record New Deposit
                  </button>
                </div>

                <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
                  <div className="px-5 py-3.5 border-b border-slate-200">
                    <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                      Advance Deposits Ledger ({clinicAdvances.length})
                    </h3>
                  </div>

                  <div className="divide-y divide-slate-100 text-xs">
                    {clinicAdvances.length === 0 ? (
                      <div className="p-6 text-center text-slate-500">No advance deposits on record.</div>
                    ) : (
                      clinicAdvances.map((adv) => (
                        <div key={adv.id} className="p-4 flex items-center justify-between hover:bg-slate-50 transition-colors">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-bold text-slate-900">{adv.payment_number}</span>
                              <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-700 uppercase">
                                {adv.payment_method}
                              </span>
                              <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                                adv.remaining_amount > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'
                              }`}>
                                {(adv.status ?? 'confirmed').replace('_', ' ')}
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-500 mt-1">
                              Date: {adv.payment_date} {adv.reference_number && `• Ref: ${adv.reference_number}`} • {adv.notes || 'Advance deposit'}
                            </div>
                          </div>

                          <div className="text-right space-y-0.5">
                            <div className="font-mono font-bold text-sm text-slate-900">
                              Initial: {formatPKR(adv.amount)}
                            </div>
                            <div className="text-[11px] font-mono text-emerald-700 font-semibold">
                              Remaining: {formatPKR(adv.remaining_amount)}
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* TAB 4: STATEMENT LEDGER */}
            {activeSubTab === 'ledger' && (
              <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
                <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
                  <div>
                    <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                      Authoritative Running Balance Ledger
                    </h3>
                    <p className="text-[11px] text-slate-500">Chronological transaction debits, credits, and running balance</p>
                  </div>
                  <button
                    onClick={() => onOpenStatementModal(selectedClinic.id)}
                    className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg text-xs flex items-center gap-1.5"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    Print Statement
                  </button>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                        <th className="px-4 py-3">Date</th>
                        <th className="px-4 py-3">Type</th>
                        <th className="px-4 py-3">Reference / Narration</th>
                        <th className="px-4 py-3 text-right">Debit (Billed)</th>
                        <th className="px-4 py-3 text-right">Credit (Paid)</th>
                        <th className="px-4 py-3 text-right">Running Balance</th>
                        <th className="px-4 py-3 text-center">Journal</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-mono">
                      {clinicLedger.map((entry) => (
                        <tr key={entry.id} className="hover:bg-slate-50/70 transition-colors">
                          <td className="px-4 py-3 font-sans text-slate-700">{entry.date}</td>
                          <td className="px-4 py-3 font-sans">
                            <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${
                              entry.type === 'invoice'
                                ? 'bg-blue-50 text-blue-700'
                                : entry.type === 'payment'
                                ? 'bg-emerald-50 text-emerald-700'
                                : 'bg-amber-50 text-amber-700'
                            }`}>
                              {entry.type}
                            </span>
                          </td>
                          <td className="px-4 py-3 font-sans text-slate-800">
                            <strong>{entry.reference_number}</strong> - {entry.description}
                          </td>
                          <td className="px-4 py-3 text-right text-slate-900 font-semibold">
                            {entry.debit > 0 ? formatPKR(entry.debit).replace('PKR ', '') : '—'}
                          </td>
                          <td className="px-4 py-3 text-right text-emerald-700 font-semibold">
                            {entry.credit > 0 ? formatPKR(entry.credit).replace('PKR ', '') : '—'}
                          </td>
                          <td className="px-4 py-3 text-right font-bold text-slate-900">
                            {formatPKR(entry.running_balance)}
                          </td>
                          <td className="px-4 py-3 text-center font-sans">
                            <button
                              onClick={() => onOpenJournalModal(entry.reference_number)}
                              className="p-1 text-slate-400 hover:text-indigo-600"
                              title="Inspect journal entry"
                            >
                              <Scale className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* TAB 5: AUDIT ACTIVITY */}
            {activeSubTab === 'activity' && (
              <div className="bg-white rounded-xl border border-slate-200 shadow-2xs p-5">
                <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-4">
                  Clinic Financial Activity & Audit Trail
                </h3>
                <div className="space-y-3">
                  {auditEvents
                    .filter((a) => (a.notes ?? '').includes(selectedClinic.name) || a.entity_id === selectedClinic.id)
                    .map((aud) => (
                      <div key={aud.id} className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs flex items-start justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-slate-900">{aud.action.replace('_', ' ')}</span>
                            <span className="font-mono text-slate-500">• {aud.entity_ref}</span>
                          </div>
                          <p className="text-slate-600 mt-0.5">{aud.notes}</p>
                        </div>
                        <span className="text-slate-400 text-[11px] whitespace-nowrap">{aud.timestamp}</span>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Quick Apply Advance Modal */}
      {applyAdvanceTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 max-w-md w-full p-6">
            <h3 className="text-base font-bold text-slate-900 mb-1">Apply Advance Credit to Invoice</h3>
            <p className="text-xs text-slate-500 mb-4">Deduct from clinic's prepaid wallet to settle open balance.</p>

            <form onSubmit={handleApplyAdvanceSubmit} className="space-y-4 text-xs">
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-1">
                <div className="flex justify-between text-slate-600">
                  <span>Available Credit:</span>
                  <span className="font-mono font-bold text-emerald-700">{formatPKR(clinicSummary?.advanceCreditBalance || 0)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Invoice Balance Due:</span>
                  <span className="font-mono font-bold text-slate-900">{formatPKR(applyAdvanceTarget.due)}</span>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Amount to Apply (PKR)</label>
                <input
                  type="number"
                  min="1"
                  max={Math.min(applyAdvanceTarget.due, clinicSummary?.advanceCreditBalance || 0)}
                  value={applyAdvanceAmount}
                  onChange={(e) => setApplyAdvanceAmount(parseFloat(e.target.value) || 0)}
                  className="w-full text-sm font-semibold font-mono px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900"
                  required
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setApplyAdvanceTarget(null)}
                  className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold shadow-xs"
                >
                  Confirm & Deduct Wallet
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
