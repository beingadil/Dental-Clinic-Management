import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { DentalLab, DentalCase, PaymentRecord, Invoice } from '../../types';
import { LabContactsManager } from './LabContactsManager';
import { LabPricingManager } from './LabPricingManager';
import { LabReviewsManager } from './LabReviewsManager';
import { CaseDetailModal } from '../cases/CaseDetailModal';
import { CaseJobSlipModal } from '../cases/CaseJobSlipModal';
import { PaymentModal } from '../billing/PaymentModal';
import { PaymentProofModal } from '../billing/PaymentProofModal';
import { PaymentReceiptModal } from '../billing/PaymentReceiptModal';
import { InvoiceStatementModal } from '../billing/InvoiceStatementModal';
import { 
  Building2, 
  X, 
  Trash2, 
  Edit2, 
  Check, 
  Phone, 
  Mail, 
  MapPin, 
  Star, 
  FolderOpen, 
  DollarSign, 
  ShieldAlert, 
  UserCheck, 
  Tag,
  PlusCircle,
  Printer,
  ChevronRight,
  Clock,
  Calendar,
  BookOpen,
  Receipt,
  Image as ImageIcon,
  ArrowUpRight,
  ArrowDownLeft,
  FileText,
  Maximize2,
  Minimize2
} from 'lucide-react';

interface LabDetailModalProps {
  lab: DentalLab;
  onClose: () => void;
  initialTab?: 'cases' | 'ledger' | 'info' | 'contacts' | 'pricing' | 'reviews';
}

export const LabDetailModal: React.FC<LabDetailModalProps> = ({ lab, onClose, initialTab = 'cases' }) => {
  const { cases, invoices, updateLab, deleteLab, getLabFinancialSummary, getLedgerEntries, allPayments } = useApp();

  const [activeTab, setActiveTab] = useState<'cases' | 'ledger' | 'info' | 'contacts' | 'pricing' | 'reviews'>(initialTab);
  const [isFullScreen, setIsFullScreen] = useState(true);
  const [selectedCaseForDetail, setSelectedCaseForDetail] = useState<DentalCase | null>(null);
  const [selectedCaseForSlip, setSelectedCaseForSlip] = useState<DentalCase | null>(null);
  const [isCreatingNewCase, setIsCreatingNewCase] = useState(false);

  // Financial modals state
  const [paymentModalInvoice, setPaymentModalInvoice] = useState<Invoice | null>(null);
  const [selectedProofPayment, setSelectedProofPayment] = useState<PaymentRecord | null>(null);
  const [selectedReceiptPayment, setSelectedReceiptPayment] = useState<{ payment: PaymentRecord; invoice?: Invoice } | null>(null);
  const [selectedInvoiceModal, setSelectedInvoiceModal] = useState<Invoice | null>(null);

  // Financial summary & ledger for this specific lab
  const labFinancials = useMemo(() => getLabFinancialSummary(lab.id), [getLabFinancialSummary, lab.id, invoices]);
  const labLedger = useMemo(() => getLedgerEntries(lab.id), [getLedgerEntries, lab.id, invoices]);

  // Edit State
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(lab.name);
  const [contactPerson, setContactPerson] = useState(lab.contact_person);
  const [phone, setPhone] = useState(lab.phone);
  const [email, setEmail] = useState(lab.email);
  const [address, setAddress] = useState(lab.address);
  const [notes, setNotes] = useState(lab.notes || '');
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Delete typed confirmation state
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [confirmInput, setConfirmInput] = useState('');

  // Filter cases for this lab and ALWAYS sort MOST RECENT FIRST
  const labCases = cases
    .filter((c) => c.lab_id === lab.id)
    .sort((a, b) => {
      const timeA = new Date(a.created_at || a.delivery_date).getTime();
      const timeB = new Date(b.created_at || b.delivery_date).getTime();
      return timeB - timeA; // Descending: Most recent first
    });

  const labInvoices = invoices.filter((inv) => inv.lab_id === lab.id);
  const totalBilled = labInvoices.reduce((sum, inv) => sum + inv.final_amount, 0);
  const totalPaid = labInvoices.reduce((sum, inv) => sum + inv.amount_paid, 0);
  const totalUnpaid = totalBilled - totalPaid;

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!name.trim() || name.trim().length < 2 || name.trim().length > 200) {
      errs.name = 'Clinic name must be between 2 and 200 characters';
    }
    if (!contactPerson.trim() || contactPerson.trim().length < 2 || contactPerson.trim().length > 100) {
      errs.contactPerson = 'Contact person name must be between 2 and 100 characters';
    }
    if (!phone.trim() || !/^[0-9+\s\-()]{7,25}$/.test(phone.trim())) {
      errs.phone = 'Valid phone number required (7-25 digits/symbols)';
    }
    if (!email.trim() || !/\S+@\S+\.\S+/.test(email.trim())) {
      errs.email = 'Valid email address required';
    }
    if (!address.trim() || address.trim().length < 5 || address.trim().length > 500) {
      errs.address = 'Address must be between 5 and 500 characters';
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSaveInfo = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    updateLab(lab.id, {
      name: name.trim(),
      contact_person: contactPerson.trim(),
      phone: phone.trim(),
      email: email.trim(),
      address: address.trim(),
      notes: notes.trim()
    });

    setIsEditing(false);
  };

  const handleDeleteConfirmed = () => {
    if (confirmInput.trim() !== 'DELETE') return;
    deleteLab(lab.id);
    setDeleteModalOpen(false);
    onClose();
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'delivered':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'ready':
        return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'in_lab':
      case 'waxing':
      case 'casting':
      case 'porcelain':
      case 'glazing':
        return 'bg-indigo-50 text-indigo-700 border-indigo-200';
      case 'quality_check':
        return 'bg-purple-50 text-purple-700 border-purple-200';
      case 'hold':
        return 'bg-rose-50 text-rose-700 border-rose-200';
      default:
        return 'bg-slate-100 text-slate-700 border-slate-200';
    }
  };

  return (
    <div className={`fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center ${isFullScreen ? 'p-0' : 'p-2 sm:p-4 md:p-6'} overflow-y-auto`}>
      <div className={`bg-white shadow-2xl border border-slate-200 overflow-hidden flex flex-col transition-all duration-150 ${
        isFullScreen 
          ? 'w-full h-full max-w-none max-h-screen rounded-none' 
          : 'w-full max-w-[98vw] xl:max-w-[1600px] 2xl:max-w-[1800px] max-h-[96vh] rounded-2xl my-auto'
      }`}>
        {/* Header */}
        <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between shrink-0 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-white font-bold text-lg shadow-sm">
              <Building2 className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-bold text-base md:text-lg text-white">{lab.name}</h2>
                <div className="flex items-center gap-1 bg-slate-800 text-slate-200 border border-slate-700 px-2.5 py-0.5 rounded-full text-xs font-semibold">
                  <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                  <span>{lab.rating} ({lab.reviews_count} reviews)</span>
                </div>
              </div>
              <p className="text-xs text-slate-300">Contact Person: {lab.contact_person} • Phone: {lab.phone}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsFullScreen(!isFullScreen)}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
              title={isFullScreen ? "Restore Window Size" : "Full Screen Mode"}
            >
              {isFullScreen ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
              title="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tab Navigation - Single Solid Color Architecture */}
        <div className="bg-slate-50 border-b border-slate-200 px-6 flex items-center gap-1 overflow-x-auto shrink-0 pt-1">
          {[
            { id: 'cases', label: `Clinic Cases (${labCases.length})`, icon: FolderOpen },
            { 
              id: 'ledger', 
              label: 'Account Ledger & Statements', 
              icon: BookOpen,
              badge: (labFinancials?.outstanding_balance || 0) > 0 
                ? `Due PKR ${(labFinancials?.outstanding_balance || 0).toLocaleString()}` 
                : undefined 
            },
            { id: 'info', label: 'General Info', icon: Building2 },
            { id: 'contacts', label: 'Contacts & Locations', icon: UserCheck },
            { id: 'pricing', label: 'Custom Pricing', icon: Tag },
            { id: 'reviews', label: 'Performance Reviews', icon: Star },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`py-3 px-4 text-xs font-bold border-b-2 flex items-center gap-2 transition-all whitespace-nowrap cursor-pointer ${
                  isActive
                    ? 'border-slate-900 text-slate-900 bg-white shadow-2xs'
                    : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-100/80'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{tab.label}</span>
                {tab.badge && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-200 text-slate-800">
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Modal Scrollable Content */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          
          {/* TAB 1: ALL CASES FOR THIS LAB (SORTED MOST RECENT FIRST) */}
          {activeTab === 'cases' && (
            <div className="space-y-4">
              {/* Header & Quick Add */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    All Cases for {lab.name}
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Showing all registered cases sorted with the most recent case first
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsCreatingNewCase(true)}
                  className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs rounded-xl shadow-xs flex items-center gap-1.5 self-start sm:self-auto cursor-pointer transition-all"
                >
                  <PlusCircle className="w-4 h-4" />
                  <span>New Case for this Lab</span>
                </button>
              </div>

              {/* Case Cards List */}
              {labCases.length === 0 ? (
                <div className="p-10 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200 space-y-3">
                  <p className="text-xs text-slate-500 font-medium">No dental cases currently recorded for this lab.</p>
                  <button
                    type="button"
                    onClick={() => setIsCreatingNewCase(true)}
                    className="px-4 py-2 bg-slate-900 text-white text-xs font-semibold rounded-xl hover:bg-slate-800 cursor-pointer inline-flex items-center gap-1.5"
                  >
                    <PlusCircle className="w-4 h-4" /> Create First Case
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {labCases.map((c, index) => {
                    const isLatest = index === 0;
                    const teethStr = c.selected_teeth?.length > 0 ? c.selected_teeth.map(t => `#${t}`).join(', ') : 'Full Arch';

                    return (
                      <div
                        key={c.id}
                        className={`p-4 rounded-xl border transition-all ${
                          isLatest 
                            ? 'bg-indigo-50/40 border-indigo-200 shadow-xs' 
                            : 'bg-white border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          {/* Case Info */}
                          <div className="space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-mono font-bold text-sm text-slate-900">
                                {c.case_number}
                              </span>
                              {isLatest && (
                                <span className="px-2 py-0.5 bg-indigo-600 text-white text-[10px] font-bold rounded-md">
                                  Most Recent
                                </span>
                              )}
                              <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border capitalize ${getStatusBadge(c.status)}`}>
                                {c.status.replace('_', ' ')}
                              </span>
                              {c.priority === 'urgent' && (
                                <span className="px-2 py-0.5 bg-rose-50 text-rose-700 border border-rose-200 text-[10px] font-bold rounded-md uppercase">
                                  Urgent
                                </span>
                              )}
                            </div>

                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600 pt-0.5">
                              <span><strong>Material:</strong> {c.case_type_name}</span>
                              <span><strong>Doctor:</strong> {c.doctor_name}</span>
                              <span><strong>Teeth:</strong> <span className="font-mono">{teethStr}</span></span>
                              {c.shade && <span><strong>Shade:</strong> <span className="font-mono font-semibold text-slate-900">{c.shade}</span></span>}
                              <span className="flex items-center gap-1 text-slate-500">
                                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                                Delivery: {c.delivery_date}
                              </span>
                            </div>
                          </div>

                          {/* Price & Actions */}
                          <div className="flex items-center justify-between sm:justify-end gap-3 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100">
                            <div className="text-left sm:text-right">
                              <div className="text-[10px] text-slate-400 font-bold uppercase">Case Fee</div>
                              <div className="text-sm font-bold text-slate-900 font-mono">
                                PKR {(c.final_price || 0).toLocaleString()}
                              </div>
                            </div>

                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => setSelectedCaseForSlip(c)}
                                className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg border border-slate-200 transition-colors cursor-pointer"
                                title="Print Job Card Slip"
                              >
                                <Printer className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setSelectedCaseForDetail(c)}
                                className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs rounded-lg transition-colors cursor-pointer flex items-center gap-1"
                              >
                                <span>Details</span>
                                <ChevronRight className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: FINANCIAL LEDGER & STATEMENTS */}
          {activeTab === 'ledger' && (
            <div className="space-y-6">
              
              {/* Financial KPI Summary Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Total Billed (Debits)</span>
                  <div className="text-lg font-black text-slate-900 mt-0.5">
                    PKR {(labFinancials?.total_invoiced || 0).toLocaleString()}
                  </div>
                  <span className="text-[10px] text-slate-500">Gross clinic charges</span>
                </div>

                <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl">
                  <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider block">Total Collected</span>
                  <div className="text-lg font-black text-emerald-700 mt-0.5">
                    PKR {(labFinancials?.total_paid || 0).toLocaleString()}
                  </div>
                  <span className="text-[10px] text-emerald-600">Credits settled</span>
                </div>

                <div className={`p-3.5 rounded-xl border ${(labFinancials?.outstanding_balance || 0) > 0 ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-200'}`}>
                  <span className={`text-[10px] font-bold uppercase tracking-wider block ${(labFinancials?.outstanding_balance || 0) > 0 ? 'text-amber-700' : 'text-slate-500'}`}>
                    Net Outstanding
                  </span>
                  <div className={`text-lg font-black mt-0.5 ${(labFinancials?.outstanding_balance || 0) > 0 ? 'text-amber-700' : 'text-slate-700'}`}>
                    PKR {(labFinancials?.outstanding_balance || 0).toLocaleString()}
                  </div>
                  <span className="text-[10px] text-slate-500">
                    {(labFinancials?.outstanding_balance || 0) > 0 ? 'Due for collection' : 'Zero balance'}
                  </span>
                </div>

                <div className="p-3.5 bg-indigo-50 border border-indigo-200 rounded-xl">
                  <span className="text-[10px] font-bold text-indigo-700 uppercase tracking-wider block">Invoices Status</span>
                  <div className="text-lg font-black text-indigo-700 mt-0.5">
                    {labFinancials?.unpaid_invoices_count || 0} <span className="text-xs font-semibold">Unpaid</span>
                  </div>
                  <span className="text-[10px] text-indigo-600">Of {labFinancials?.invoices_count || 0} total invoices</span>
                </div>
              </div>

              {/* Outstanding Invoices Quick Pay Section */}
              {labInvoices.filter(i => i.payment_status !== 'paid').length > 0 && (
                <div className="bg-amber-50/70 border border-amber-200 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-amber-900 uppercase tracking-wider flex items-center gap-1.5">
                      <Receipt className="w-4 h-4 text-amber-600" />
                      <span>Pending Unpaid Invoices ({labInvoices.filter(i => i.payment_status !== 'paid').length})</span>
                    </h4>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {labInvoices.filter(i => i.payment_status !== 'paid').map(inv => {
                      const rem = (inv.final_amount || 0) - (inv.amount_paid || 0);
                      return (
                        <div key={inv.id} className="p-3 bg-white rounded-lg border border-amber-200 shadow-2xs flex items-center justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-bold text-xs text-slate-900">{inv.invoice_number}</span>
                              <span className="text-[10px] px-1.5 py-0.2 bg-amber-100 text-amber-800 rounded font-bold uppercase">{inv.payment_status}</span>
                            </div>
                            <p className="text-[11px] text-slate-500 mt-0.5">Case {inv.case_number} • Dr. {inv.doctor_name}</p>
                            <p className="text-xs font-bold text-amber-700 mt-0.5">Due: PKR {(rem || 0).toLocaleString()}</p>
                          </div>
                          <button
                            onClick={() => setPaymentModalInvoice(inv)}
                            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-lg shadow-2xs transition-colors flex items-center gap-1 cursor-pointer shrink-0"
                          >
                            <DollarSign className="w-3.5 h-3.5" />
                            <span>Record Pay</span>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Lab Ledger Table */}
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-2xs">
                <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                  <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                    Full Account Transaction Ledger
                  </h4>
                  <span className="text-[11px] text-slate-500 font-medium">
                    {labLedger.length} total transaction events
                  </span>
                </div>

                {labLedger.length === 0 ? (
                  <div className="p-8 text-center text-xs text-slate-400">
                    No ledger transactions recorded for this clinic yet.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="bg-slate-50/50 border-b border-slate-200 font-bold text-slate-500 uppercase text-[10px] tracking-wider">
                          <th className="py-2.5 px-3">Date</th>
                          <th className="py-2.5 px-2.5">Type</th>
                          <th className="py-2.5 px-2.5">Ref #</th>
                          <th className="py-2.5 px-2.5">Case #</th>
                          <th className="py-2.5 px-2.5">Description</th>
                          <th className="py-2.5 px-2.5 text-right">Debit (PKR)</th>
                          <th className="py-2.5 px-2.5 text-right">Credit (PKR)</th>
                          <th className="py-2.5 px-3 text-right font-black">Balance (PKR)</th>
                          <th className="py-2.5 px-2 text-center">Proof</th>
                          <th className="py-2.5 px-2 text-center">Voucher</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-medium">
                        {labLedger.map((entry) => {
                          const isDebit = entry.entry_type === 'invoice';
                          const isCredit = entry.entry_type === 'payment';
                          const matchedPayment = isCredit ? allPayments.find(p => p.id === entry.reference_id || p.payment_number === entry.reference_number) : undefined;
                          const matchedInvoice = isDebit ? invoices.find(i => i.id === entry.reference_id || i.invoice_number === entry.reference_number) : undefined;

                          return (
                            <tr key={entry.id} className="hover:bg-slate-50/80 transition-colors">
                              <td className="py-2.5 px-3 text-slate-600 font-medium whitespace-nowrap">{entry.date}</td>
                              <td className="py-2.5 px-2.5 whitespace-nowrap">
                                {isDebit ? (
                                  <span className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                                    <ArrowUpRight className="w-2.5 h-2.5" /> Billed
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                    <ArrowDownLeft className="w-2.5 h-2.5" /> {entry.payment_method || 'Payment'}
                                  </span>
                                )}
                              </td>
                              <td className="py-2.5 px-2.5 font-mono font-bold text-slate-900 whitespace-nowrap">{entry.reference_number}</td>
                              <td className="py-2.5 px-2.5 font-mono text-indigo-600 whitespace-nowrap">{entry.case_number || '—'}</td>
                              <td className="py-2.5 px-2.5 text-slate-700 max-w-[200px] truncate">{entry.description}</td>
                              <td className="py-2.5 px-2.5 text-right font-bold text-indigo-600 whitespace-nowrap">{entry.debit > 0 ? `PKR ${(entry.debit || 0).toLocaleString()}` : '—'}</td>
                              <td className="py-2.5 px-2.5 text-right font-bold text-emerald-600 whitespace-nowrap">{entry.credit > 0 ? `PKR ${(entry.credit || 0).toLocaleString()}` : '—'}</td>
                              <td className={`py-2.5 px-3 text-right font-black whitespace-nowrap ${entry.running_balance > 0 ? 'text-slate-900' : 'text-emerald-600'}`}>
                                PKR {(entry.running_balance || 0).toLocaleString()}
                              </td>
                              <td className="py-2.5 px-2 text-center whitespace-nowrap">
                                {(entry.attachments && entry.attachments.length > 0) || (matchedPayment?.attachments && matchedPayment.attachments.length > 0) ? (
                                  <button
                                    onClick={() => {
                                      const payObj = matchedPayment || {
                                        id: entry.reference_id,
                                        payment_number: entry.reference_number,
                                        invoice_id: '',
                                        invoice_number: '',
                                        amount: entry.credit,
                                        payment_method: entry.payment_method || 'bank',
                                        payment_date: entry.date,
                                        recorded_by: entry.recorded_by || 'Staff',
                                        attachments: entry.attachments || []
                                      };
                                      setSelectedProofPayment(payObj);
                                    }}
                                    className="p-1 text-indigo-600 hover:bg-indigo-50 rounded"
                                    title="View Attached Proof"
                                  >
                                    <ImageIcon className="w-3.5 h-3.5" />
                                  </button>
                                ) : (
                                  <span className="text-slate-300 text-[10px]">—</span>
                                )}
                              </td>
                              <td className="py-2.5 px-2 text-center whitespace-nowrap">
                                {isDebit && matchedInvoice && (
                                  <button
                                    onClick={() => setSelectedInvoiceModal(matchedInvoice)}
                                    className="p-1 text-slate-400 hover:text-indigo-600 rounded"
                                    title="View Invoice"
                                  >
                                    <FileText className="w-3.5 h-3.5" />
                                  </button>
                                )}
                                {isCredit && (
                                  <button
                                    onClick={() => {
                                      const payObj = matchedPayment || {
                                        id: entry.reference_id,
                                        payment_number: entry.reference_number,
                                        invoice_id: '',
                                        invoice_number: '',
                                        lab_id: lab.id,
                                        lab_name: lab.name,
                                        amount: entry.credit,
                                        payment_method: entry.payment_method || 'cash',
                                        payment_date: entry.date,
                                        notes: entry.notes,
                                        recorded_by: entry.recorded_by || 'Staff',
                                        attachments: entry.attachments || []
                                      };
                                      setSelectedReceiptPayment({ payment: payObj, invoice: matchedInvoice });
                                    }}
                                    className="p-1 text-slate-400 hover:text-emerald-600 rounded"
                                    title="View Receipt Slip"
                                  >
                                    <Receipt className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

            </div>
          )}

          {/* TAB 3: GENERAL INFO */}
          {activeTab === 'info' && (
            <div className="space-y-6">
              {/* Financial Metrics */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl">
                  <div className="text-xs text-slate-500 font-semibold">Total Cases Handled</div>
                  <div className="text-xl font-bold text-slate-900 mt-1">{labCases.length}</div>
                </div>
                <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl">
                  <div className="text-xs text-emerald-700 font-semibold">Total Invoiced Revenue</div>
                  <div className="text-xl font-bold text-emerald-700 mt-1">PKR {(totalBilled || 0).toLocaleString()}</div>
                </div>
                <div className="p-4 bg-indigo-50 border border-indigo-200 rounded-xl">
                  <div className="text-xs text-indigo-700 font-semibold">Outstanding Balance</div>
                  <div className="text-xl font-bold text-indigo-700 mt-1">PKR {(totalUnpaid || 0).toLocaleString()}</div>
                </div>
              </div>

              {/* Clinic Info Form / View */}
              {isEditing ? (
                <form onSubmit={handleSaveInfo} className="space-y-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
                  <h4 className="text-xs font-bold text-slate-900 uppercase">Edit Dental Clinic Details</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Clinic Name *</label>
                      <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="w-full p-2 text-xs bg-white border border-slate-200 rounded-lg"
                      />
                      {errors.name && <p className="text-[10px] text-rose-500 mt-0.5">{errors.name}</p>}
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Contact Person *</label>
                      <input
                        type="text"
                        value={contactPerson}
                        onChange={(e) => setContactPerson(e.target.value)}
                        className="w-full p-2 text-xs bg-white border border-slate-200 rounded-lg"
                      />
                      {errors.contactPerson && <p className="text-[10px] text-rose-500 mt-0.5">{errors.contactPerson}</p>}
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Phone *</label>
                      <input
                        type="text"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        className="w-full p-2 text-xs bg-white border border-slate-200 rounded-lg"
                      />
                      {errors.phone && <p className="text-[10px] text-rose-500 mt-0.5">{errors.phone}</p>}
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Email *</label>
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full p-2 text-xs bg-white border border-slate-200 rounded-lg"
                      />
                      {errors.email && <p className="text-[10px] text-rose-500 mt-0.5">{errors.email}</p>}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Address *</label>
                    <textarea
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      rows={2}
                      className="w-full p-2 text-xs bg-white border border-slate-200 rounded-lg"
                    />
                    {errors.address && <p className="text-[10px] text-rose-500 mt-0.5">{errors.address}</p>}
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Special Clinic Notes</label>
                    <textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      rows={2}
                      className="w-full p-2 text-xs bg-white border border-slate-200 rounded-lg"
                    />
                  </div>

                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setIsEditing(false)}
                      className="px-3 py-1.5 bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg cursor-pointer transition-colors"
                    >
                      Save Info
                    </button>
                  </div>
                </form>
              ) : (
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Facility Information</h3>
                    <button
                      onClick={() => setIsEditing(true)}
                      className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg flex items-center gap-1 cursor-pointer"
                    >
                      <Edit2 className="w-3.5 h-3.5" /> Edit Information
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                    <div className="p-4 bg-white border border-slate-200 rounded-xl space-y-2">
                      <div className="flex items-center gap-2 text-slate-600 font-semibold">
                        <Phone className="w-4 h-4 text-indigo-600" /> Phone: {lab.phone}
                      </div>
                      <div className="flex items-center gap-2 text-slate-600 font-semibold">
                        <Mail className="w-4 h-4 text-indigo-600" /> Email: {lab.email}
                      </div>
                    </div>

                    <div className="p-4 bg-white border border-slate-200 rounded-xl space-y-1">
                      <div className="flex items-center gap-2 text-slate-600 font-semibold">
                        <MapPin className="w-4 h-4 text-emerald-600" /> Facility Address:
                      </div>
                      <p className="text-slate-700 pl-6">{lab.address}</p>
                    </div>
                  </div>

                  {lab.notes && (
                    <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-xs space-y-1">
                      <div className="font-semibold text-slate-800">Special Notes:</div>
                      <p className="text-slate-600">{lab.notes}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Delete Zone */}
              <div className="border-t border-slate-200 pt-4 flex justify-between items-center">
                <span className="text-xs text-rose-600 font-semibold">Danger Zone</span>
                <button
                  onClick={() => setDeleteModalOpen(true)}
                  className="px-3 py-1.5 bg-rose-50 text-rose-600 hover:bg-rose-100 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" /> Delete Clinic Record
                </button>
              </div>
            </div>
          )}

          {activeTab === 'contacts' && <LabContactsManager labId={lab.id} />}
          {activeTab === 'pricing' && <LabPricingManager labId={lab.id} />}
          {activeTab === 'reviews' && <LabReviewsManager labId={lab.id} />}
        </div>
      </div>

      {/* Case Details Modal */}
      {selectedCaseForDetail && (
        <CaseDetailModal
          initialCase={selectedCaseForDetail}
          onClose={() => setSelectedCaseForDetail(null)}
        />
      )}

      {/* Case Job Slip Modal */}
      {selectedCaseForSlip && (
        <CaseJobSlipModal
          caseData={selectedCaseForSlip}
          onClose={() => setSelectedCaseForSlip(null)}
        />
      )}

      {/* Create New Case with pre-selected lab */}
      {isCreatingNewCase && (
        <CaseDetailModal
          initialCase={{
            id: '',
            case_number: '',
            lab_id: lab.id,
            lab_name: lab.name,
            doctor_name: lab.contact_person,
            case_type_id: '',
            case_type_name: '',
            selected_teeth: [11, 21],
            tooth_details: {},
            shade: 'A2',
            delivery_date: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            priority: 'normal',
            price: 15000,
            discount: 0,
            final_price: 15000,
            instructions: '',
            status: 'received',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            history: []
          }}
          onClose={() => setIsCreatingNewCase(false)}
        />
      )}

      {/* Payment Recording Modal */}
      {paymentModalInvoice && (
        <PaymentModal
          invoice={paymentModalInvoice}
          onClose={() => setPaymentModalInvoice(null)}
          onPaymentRecorded={(pay) => {
            setSelectedReceiptPayment({ payment: pay, invoice: paymentModalInvoice });
          }}
        />
      )}

      {/* Payment Proof Viewer Modal */}
      {selectedProofPayment && (
        <PaymentProofModal
          payment={selectedProofPayment}
          onClose={() => setSelectedProofPayment(null)}
        />
      )}

      {/* Payment Receipt Voucher Modal */}
      {selectedReceiptPayment && (
        <PaymentReceiptModal
          payment={selectedReceiptPayment.payment}
          invoice={selectedReceiptPayment.invoice}
          onClose={() => setSelectedReceiptPayment(null)}
        />
      )}

      {/* Invoice Statement Modal */}
      {selectedInvoiceModal && (
        <InvoiceStatementModal
          invoice={selectedInvoiceModal}
          caseData={cases.find((c) => c.id === selectedInvoiceModal.case_id || c.case_number === selectedInvoiceModal.case_number)}
          onClose={() => setSelectedInvoiceModal(null)}
        />
      )}

      {/* Typed Confirmation DELETE Modal */}
      {deleteModalOpen && (
        <div className="fixed inset-0 z-60 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 border border-slate-200 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-rose-600">
              <ShieldAlert className="w-6 h-6 shrink-0" />
              <h3 className="font-bold text-base text-slate-900">Type DELETE to Confirm</h3>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              This action cannot be undone. All associated clinic contacts, custom pricing overrides, and ratings will be permanently removed.
            </p>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Type <span className="text-rose-600 font-mono">DELETE</span> below:
              </label>
              <input
                type="text"
                value={confirmInput}
                onChange={(e) => setConfirmInput(e.target.value)}
                placeholder="DELETE"
                className="w-full p-2.5 text-xs bg-slate-50 border border-slate-300 rounded-lg font-mono text-center font-bold"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDeleteModalOpen(false)}
                className="px-3 py-1.5 bg-slate-100 text-slate-700 text-xs font-semibold rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={confirmInput.trim() !== 'DELETE'}
                onClick={handleDeleteConfirmed}
                className="px-4 py-1.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg shadow-sm cursor-pointer"
              >
                Permanently Delete Lab
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
