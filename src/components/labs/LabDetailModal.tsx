import { formatPKR } from '../../services/financeDomain';
import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { canPost, deniedTooltip } from '../../services/permissions';
import { getDaysOffsetStr } from '../../utils/dateUtils';
import { formatDoctorName } from '../../utils/doctorName';
import { DentalLab, DentalCase, PaymentRecord, Invoice } from '../../types';
import { LabContactsManager } from './LabContactsManager';
import { LabPricingManager } from './LabPricingManager';
import { CaseDetailModal } from '../cases/CaseDetailModal';
import { CaseJobSlipModal } from '../cases/CaseJobSlipModal';
import { PaymentProofModal } from '../billing/PaymentProofModal';
import { PaymentReceiptModal } from '../billing/PaymentReceiptModal';
import { InvoiceStatementModal } from '../billing/InvoiceStatementModal';
import { GeneralLedgerView } from '../billing/GeneralLedgerView';
import { RecordAdjustmentModal } from '../billing/RecordAdjustmentModal';
import { RecordTransactionModal } from '../billing/RecordTransactionModal';
import {
  Building2,
  X,
  Trash2,
  Edit2,
  Phone,
  Mail,
  MapPin,
  FolderOpen,
  ShieldAlert,
  UserCheck,
  Tag,
  PlusCircle,
  Printer,
  ChevronDown,
  ChevronRight,
  Calendar,
  BookOpen,
  Search,
  Maximize2,
  Minimize2
} from 'lucide-react';

interface LabDetailModalProps {
  lab: DentalLab;
  onClose: () => void;
  initialTab?: 'cases' | 'ledger' | 'info' | 'contacts' | 'pricing';
}

export const LabDetailModal: React.FC<LabDetailModalProps> = ({ lab, onClose, initialTab = 'cases' }) => {
  const { cases, updateLab, deleteLab, labDeletionImpact, getLabFinancialSummary, user } = useApp();

  const [activeTab, setActiveTab] = useState<'cases' | 'ledger' | 'info' | 'contacts' | 'pricing'>(initialTab);
  const [isFullScreen, setIsFullScreen] = useState(true);
  const [selectedCaseForDetail, setSelectedCaseForDetail] = useState<DentalCase | null>(null);
  const [selectedCaseForSlip, setSelectedCaseForSlip] = useState<DentalCase | null>(null);
  const [isCreatingNewCase, setIsCreatingNewCase] = useState(false);

  // Financial modals state
  const [selectedProofPayment, setSelectedProofPayment] = useState<PaymentRecord | null>(null);
  const [selectedReceiptPayment, setSelectedReceiptPayment] = useState<{ payment: PaymentRecord; invoice?: Invoice } | null>(null);
  const [selectedInvoiceModal, setSelectedInvoiceModal] = useState<Invoice | null>(null);

  // Edit State
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(lab.name);
  const [contactPerson, setContactPerson] = useState(lab.contact_person);
  const [phone, setPhone] = useState(lab.phone);
  const [email, setEmail] = useState(lab.email);
  const [address, setAddress] = useState(lab.address);
  const [notes, setNotes] = useState(lab.notes || '');
  const [openingBalance, setOpeningBalance] = useState(String(lab.opening_balance || 0));
  const [openingBalanceType, setOpeningBalanceType] = useState<'debit' | 'credit'>(lab.opening_balance_type || 'debit');
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Delete typed confirmation state
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [confirmInput, setConfirmInput] = useState('');
  const [showAdjustmentModal, setShowAdjustmentModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);

  // Cases-tab search box.
  const [caseSearch, setCaseSearch] = useState('');

  /* What the delete will destroy. Read only while the dialog is open, so the
     counts are computed at the moment of the decision rather than whenever the
     modal happened to render. */
  const deletionImpact = useMemo(
    () => (deleteModalOpen ? labDeletionImpact(lab.id) : null),
    [deleteModalOpen, labDeletionImpact, lab.id]
  );

  /* Rows shown in the confirmation, in the order an operator would think about
     them: the work, then the money, then the supporting records. Zero-count
     rows are filtered at render — a list of seven zeroes is noise. */
  const impactRows = useMemo(() => {
    if (!deletionImpact) return [];
    return [
      { label: 'Case jobs', count: deletionImpact.cases, money: 0 },
      { label: 'Invoices', count: deletionImpact.invoices, money: deletionImpact.totalBilled },
      { label: 'Payments (vouchers)', count: deletionImpact.payments, money: deletionImpact.totalPaid },
      { label: 'Advance payments', count: deletionImpact.advances, money: 0 },
      { label: 'Adjustments & credit notes', count: deletionImpact.adjustments, money: deletionImpact.totalAdjustments },
      { label: 'Ledger entries', count: deletionImpact.journals, money: 0 },
      { label: 'Contacts', count: deletionImpact.contacts, money: 0 },
      { label: 'Addresses', count: deletionImpact.addresses, money: 0 },
      { label: 'Custom pricing rules', count: deletionImpact.pricingOverrides, money: 0 },
      { label: 'Reviews', count: deletionImpact.reviews, money: 0 },
    ];
  }, [deletionImpact]);

  /* The date a case was ENTERED at the clinic, as YYYY-MM-DD.

     This is `received_date` — the day the work actually arrived — not
     `created_at`. Every case in an imported or seeded set shares one
     `created_at` (the moment the rows were written), so sorting and grouping by
     it put the entire history in a single "today" month, in whatever order the
     rows happened to be read. `received_date` is the date the operator typed on
     the case, which is the date they think in. */
  const entryDate = (c: DentalCase): string =>
    (c.received_date || c.created_at || '').slice(0, 10);

  // All cases for this lab, most recently ENTERED first.
  const allLabCases = cases
    .filter((c) => c.lab_id === lab.id)
    .sort((a, b) => {
      const byEntry = entryDate(b).localeCompare(entryDate(a));
      if (byEntry !== 0) return byEntry;
      /* Same day: the higher case number is the later one, because numbers are
         minted in order. Without this a day's cases came back in read order. */
      return (b.case_number || '').localeCompare(a.case_number || '', undefined, { numeric: true });
    });

  /* Search across everything an operator might actually type.

     Two forms of each case are indexed: the text as written, and a
     punctuation-free copy. Every typed word must match at least one of them —
     that is what lets "ds0123" find "DS-0123" while "ds-0123" still matches
     directly. An earlier version tried the punctuation-free copy only for
     all-digit queries, which meant "ds0123" (letters AND digits, the common
     case) silently found nothing while "0123" worked. That is the single most
     common way a search box ends up looking broken to the person using it.

     Matching is AND across words: "ali pfm" narrows, rather than widening the
     result set every time another word is added. */
  const caseHaystack = useMemo(() => {
    const index = new Map<string, { plain: string; bare: string }>();
    for (const c of allLabCases) {
      const text = [
        c.case_number,
        c.patient_name,
        c.doctor_name,
        c.case_type_name,
        c.shade,
        c.status,
        c.priority,
        c.delivery_date,
        entryDate(c),
        (c.selected_teeth || []).map((t) => `#${t}`).join(' '),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      index.set(c.id, { plain: text, bare: text.replace(/[^a-z0-9]/g, '') });
    }
    return index;
  }, [allLabCases]);

  const caseQuery = caseSearch.trim().toLowerCase();
  const caseQueryTokens = caseQuery.split(/\s+/).filter(Boolean);

  const labCases = useMemo(() => {
    if (caseQueryTokens.length === 0) return allLabCases;
    return allLabCases.filter((c) => {
      const entry = caseHaystack.get(c.id);
      if (!entry) return false;
      return caseQueryTokens.every((token) => {
        if (entry.plain.includes(token)) return true;
        const bareToken = token.replace(/[^a-z0-9]/g, '');
        return bareToken.length > 0 && entry.bare.includes(bareToken);
      });
    });
  }, [allLabCases, caseHaystack, caseQuery]);

  /* Cases-tab month boxes: clicking a month reveals that month's entries.

     They always start CLOSED. Auto-opening the newest month meant every clinic
     visit dumped its full case list into the panel before the operator had read
     a thing — on a busy clinic that is sixty rows of scroll between them and the
     ledger. The month boxes ARE the summary; opening one is a deliberate act. */
  const [expandedMonthKeys, setExpandedMonthKeys] = useState<string[]>([]);

  const toggleMonth = (key: string) => {
    setExpandedMonthKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  /* All cases for this lab, grouped by the month they were ENTERED (newest
     month first). Each month is a box the operator clicks to reveal that
     month's case entries. */
  const casesByMonth = useMemo(() => {
    const groups = new Map<string, { key: string; label: string; cases: typeof labCases; latest: number }>();
    for (const c of labCases) {
      /* Parsed at local midnight: parsing a bare "YYYY-MM-DD" as UTC would
         push a 1st-of-the-month case into the previous month in +05:00. */
      const d = new Date(`${entryDate(c)}T00:00:00`);
      const ts = isNaN(d.getTime()) ? 0 : d.getTime();
      const key = ts === 0 ? 'undated' : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = ts === 0 ? 'Undated' : d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
      if (!groups.has(key)) groups.set(key, { key, label, cases: [], latest: 0 });
      const g = groups.get(key)!;
      g.cases.push(c);
      g.latest = Math.max(g.latest, ts);
    }
    return Array.from(groups.values()).sort((a, b) => b.latest - a.latest);
  }, [labCases]);

  /* Month boxes start CLOSED. An earlier version auto-opened the newest month,
     which meant every clinic visit immediately dumped sixty case rows into the
     panel and the operator had to collapse it before they could read anything.
     The boxes are the summary; what the operator expands is what they wanted to
     see. Only what they expanded is remembered (localStorage above). */

  /* These must agree with the General Ledger, which is derived from
     buildLabFinancialSummary (invoices + payments + advances + adjustments +
     opening balance). Computing them from invoices alone left the opening
     balance and any debit/credit adjustment out, so the two screens disagreed
     by exactly that amount. */
  const labFinancials = getLabFinancialSummary(lab.id);
  /* Total Invoiced Revenue = invoices only. Outstanding Balance = invoices +
     opening balance + debit adjustments - advances - credit notes, which is
     exactly what the General Ledger's closing balance shows. */
  const totalBilled = labFinancials.total_invoiced;
  const totalUnpaid = labFinancials.outstanding_balance;

  /* Same contract as the create form: only clinic name + doctor name are
     required, the rest are optional and format-checked only when filled. */
  const validate = () => {
    const errs: Record<string, string> = {};
    if (!name.trim() || name.trim().length < 2 || name.trim().length > 200) {
      errs.name = 'Clinic name must be between 2 and 200 characters';
    }
    if (!contactPerson.trim() || contactPerson.trim().length < 2 || contactPerson.trim().length > 100) {
      errs.contactPerson = 'Doctor name must be between 2 and 100 characters';
    }
    if (phone.trim() && !/^[0-9+\s\-()]{7,25}$/.test(phone.trim())) {
      errs.phone = 'Phone must be 7-25 digits/symbols — or leave it blank';
    }
    if (email.trim() && !/\S+@\S+\.\S+/.test(email.trim())) {
      errs.email = 'Enter a valid email address — or leave it blank';
    }
    if (address.trim() && (address.trim().length < 5 || address.trim().length > 500)) {
      errs.address = 'Address must be 5-500 characters — or leave it blank';
    }
    const ob = openingBalance.trim();
    if (ob !== '') {
      const n = Number(ob);
      if (!Number.isFinite(n) || n < 0 || n > 999999999) {
        errs.openingBalance = 'Opening balance must be a non-negative amount';
      }
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
      notes: notes.trim(),
      opening_balance: openingBalance.trim() === '' ? 0 : Number(openingBalance.trim()),
      opening_balance_type: openingBalance.trim() === '' ? 'debit' : openingBalanceType
    });

    setIsEditing(false);
  };

  const handleDeleteConfirmed = () => {
    if (confirmInput.trim() !== 'DELETE') return;
    // No re-assignment step any more: the clinic and everything under it are
    // destroyed together. What replaced it is the impact list in the dialog —
    // the operator sees every case, invoice and payment that is about to go,
    // with the money totalled, BEFORE typing DELETE.
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
        return 'bg-ds-sunken text-ds-body border-ds-line';
    }
  };

  return (
    <div className={`fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center ${isFullScreen ? 'p-0' : 'p-2 sm:p-4 md:p-6'} overflow-y-auto`}>
      <div className={`ds-glass-pane overflow-hidden flex flex-col transition-all duration-150 ${
        isFullScreen 
          ? 'w-full h-full max-w-none max-h-screen rounded-none' 
          : 'w-full max-w-[98vw] xl:max-w-[1600px] 2xl:max-w-[1800px] max-h-[96vh] rounded-2xl my-auto'
      }`}>
        {/* Header */}
        <div className="bg-transparent text-ds-ink px-6 py-4 flex items-center justify-between shrink-0 border-b border-ds-line">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-ds-sunken border border-ds-line flex items-center justify-center text-ds-ink font-bold text-lg">
              <Building2 className="w-5 h-5 text-ds-ink" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-bold text-base md:text-lg text-ds-ink">{lab.name}</h2>
              </div>
              <p className="text-xs text-ink-muted">Doctor: {lab.contact_person || '—'} • Phone: {lab.phone || '—'}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsFullScreen(!isFullScreen)}className="ds-glass-button p-2 text-ink-muted hover:text-ds-ink cursor-pointer"
                title={isFullScreen ? "Restore Window Size" : "Full Screen Mode"}
            >
              {isFullScreen ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
            </button>
            <button
              onClick={onClose}className="ds-glass-button p-2 text-ink-muted hover:text-ds-ink cursor-pointer"
                title="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tab Navigation - Single Solid Color Architecture */}
        <div className="bg-transparent border-b border-ds-line px-6 flex items-center gap-1 overflow-x-auto shrink-0 pt-1">
          {[
            { id: 'cases', label: `Clinic Cases (${caseQuery ? labCases.length : allLabCases.length})`, icon: FolderOpen },
            /* The SAME General Ledger the Analytics & Reports tab renders, not a
               second implementation of it. The tab it replaces was a bespoke
               ledger table with its own payment index and row matcher — two
               versions of the same numbers, free to disagree. One component, one
               set of figures, locked to this clinic. */
            { id: 'ledger', label: 'Account Ledger', icon: BookOpen },
            { id: 'info', label: 'General Info', icon: Building2 },
            { id: 'contacts', label: 'Contacts & Locations', icon: UserCheck },
            { id: 'pricing', label: 'Custom Pricing', icon: Tag },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`py-3 px-4 text-xs font-bold border-b-2 flex items-center gap-2 transition-all whitespace-nowrap cursor-pointer ${
                  isActive
                    ? 'border-brand-600 text-ds-ink bg-ds-surface/60'
                    : 'border-transparent text-ink-muted hover:text-ds-ink hover:bg-ds-surface/60'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{tab.label}</span>
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
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-ds-surface/40 p-4 rounded-xl ring-1 ring-ds-line">
                <div>
                  <h3 className="text-sm font-bold text-ds-ink">
                    All Cases for {lab.name}
                  </h3>
                  <p className="text-xs text-ink-muted mt-0.5">
                    Sorted with the most recent case first. Search by patient, case number, doctor,
                    material, shade or delivery date.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsCreatingNewCase(true)}
                  className="ds-glass-pill font-semibold text-xs flex items-center gap-1.5 self-start sm:self-auto cursor-pointer"
                >
                  <PlusCircle className="w-4 h-4" />
                  <span>New Case for this Lab</span>
                </button>
              </div>

              {/* Search. Matched against case number, patient, doctor, material,
                  shade, status, priority, teeth and delivery date at once, so the
                  operator does not have to know which column a value lives in. */}
              {allLabCases.length > 0 && (
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted pointer-events-none" />
                    <input
                      type="search"
                      value={caseSearch}
                      onChange={(e) => setCaseSearch(e.target.value)}
                      placeholder="Search cases — patient, case number, doctor, material, shade…"
                      aria-label="Search cases for this clinic"
                      className="w-full pl-9 pr-9 py-2.5 text-xs bg-ds-surface/70 border border-ds-line rounded-xl focus:border-brand-600 focus:ring-2 focus:ring-brand-600/20 outline-none"
                    />
                    {caseSearch && (
                      <button
                        type="button"
                        onClick={() => setCaseSearch('')}
                        aria-label="Clear search"
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded text-ink-muted hover:text-ds-ink hover:bg-ds-sunken cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  {caseQuery && (
                    <span className="text-xs font-semibold text-ink-body whitespace-nowrap tabular-nums">
                      {labCases.length} of {allLabCases.length}
                    </span>
                  )}
                </div>
              )}

              {/* Case Cards List */}
              {labCases.length === 0 ? (
                allLabCases.length === 0 ? (
                  <div className="p-10 text-center bg-ds-surface/40 rounded-xl border border-dashed border-ds-line space-y-3">
                    <p className="text-xs text-ink-muted font-medium">No dental cases currently recorded for this lab.</p>
                    <button
                      type="button"
                      onClick={() => setIsCreatingNewCase(true)}
                      className="ds-glass-pill text-xs font-semibold cursor-pointer inline-flex items-center gap-1.5"
                    >
                      <PlusCircle className="w-4 h-4" /> Create First Case
                    </button>
                  </div>
                ) : (
                  /* Empty because the search matched nothing — a different state
                     from "this clinic has no cases", and offering "Create First
                     Case" here would be wrong. */
                  <div className="p-10 text-center bg-ds-surface/40 rounded-xl border border-dashed border-ds-line space-y-3">
                    <p className="text-xs text-ink-body font-medium">
                      No case matches <span className="font-mono font-bold text-ds-ink">"{caseSearch.trim()}"</span>.
                    </p>
                    <button
                      type="button"
                      onClick={() => setCaseSearch('')}
                      className="ds-glass-pill ds-glass-pill-sm font-semibold cursor-pointer"
                    >
                      Clear search
                    </button>
                  </div>
                )
              ) : (
                <div className="space-y-4">
                  {casesByMonth.map((group) => {
                    const expanded = expandedMonthKeys.includes(group.key);
                    return (
                      <div key={group.key} className="border rounded-xl overflow-hidden shadow-xs">
                        <button
                          type="button"
                          onClick={() => toggleMonth(group.key)}
                          className="w-full flex items-center justify-between px-4 py-3 bg-ds-surface/40 border-b border-ds-line text-left cursor-pointer transition-colors hover:bg-ds-surface/60"
                        >
                          <div className="flex items-center gap-2">
                            {expanded ? (
                              <ChevronDown className="w-4 h-4 text-ink-body shrink-0" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-ink-body shrink-0" />
                            )}
                            <span className="font-semibold text-ds-ink">{group.label}</span>
                            <span className="text-xs text-ink-muted">{group.cases.length} {group.cases.length === 1 ? 'case' : 'cases'}</span>
                          </div>
                        </button>
                        {expanded && (
                          <div className="p-3 space-y-3">
                            {group.cases.map((c) => {
                              const teethStr = c.selected_teeth?.length > 0 ? c.selected_teeth.map(t => `#${t}`).join(', ') : 'Full Arch';
                              return (
                                <div key={c.id} className="p-4 rounded-xl border border-ds-line hover:border-ds-line/60 bg-ds-surface/40 transition-colors">
                                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                    <div className="space-y-1">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <span className="font-mono font-bold text-sm text-ds-ink">{c.case_number}</span>
                                        <span className="text-sm font-semibold text-ds-ink">{c.patient_name || <span className="text-ink-muted font-normal">No patient name</span>}</span>
                                        <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border capitalize ${getStatusBadge(c.status)}`}>{c.status.replace('_', ' ')}</span>
                                        {c.priority === 'urgent' && (
                                          <span className="px-2 py-0.5 bg-rose-50 text-rose-700 border border-rose-200 text-[10px] font-bold rounded-md uppercase">Urgent</span>
                                        )}
                                      </div>
                                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-body pt-0.5">
                                        <span><strong>Material:</strong> {c.case_type_name}</span>
                                        <span><strong>Doctor:</strong> {formatDoctorName(c.doctor_name)}</span>
                                        <span><strong>Teeth:</strong> <span className="font-mono">{teethStr}</span></span>
                                        {c.shade && <span><strong>Shade:</strong> <span className="font-mono font-semibold text-ds-ink">{c.shade}</span></span>}
                                        <span className="flex items-center gap-1 text-ink-muted"><Calendar className="w-3.5 h-3.5 text-ink-muted" />Entered: {entryDate(c) || '—'}</span>
                                        <span className="flex items-center gap-1 text-ink-muted"><Calendar className="w-3.5 h-3.5 text-ink-muted" />Delivery: {c.delivery_date}</span>
                                      </div>
                                    </div>
                                    <div className="flex items-center justify-between sm:justify-end gap-3 pt-2 sm:pt-0 border-t sm:border-t-0 border-ds-line">
                                      <div className="text-left sm:text-right">
                                        <div className="text-[10px] text-ink-muted font-bold uppercase">Case Fee</div>
                                        <div className="text-sm font-bold text-ds-ink font-mono">{formatPKR(c.final_price || 0)}</div>
                                      </div>
                                      <div className="flex items-center gap-1.5">
                                        <button type="button" onClick={() => setSelectedCaseForSlip(c)} className="ds-glass-button p-2 text-ink-body hover:text-ds-ink cursor-pointer" title="Print Job Card Slip"><Printer className="w-4 h-4" /></button>
                                        <button type="button" onClick={() => setSelectedCaseForDetail(c)} className="ds-glass-pill ds-glass-pill-sm font-semibold cursor-pointer flex items-center gap-1"><span>Details</span><ChevronRight className="w-3.5 h-3.5" /></button>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: GENERAL INFO */}
          {activeTab === 'info' && (
            <div className="space-y-6">
              {/* Financial Metrics */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="p-4 bg-ds-surface/40 ring-1 ring-ds-line rounded-xl">
                  <div className="text-xs text-ink-muted font-semibold">Total Cases Handled</div>
                  <div className="text-xl font-bold text-ds-ink mt-1">{labCases.length}</div>
                </div>
                <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl">
                  <div className="text-xs text-emerald-700 font-semibold">Total Invoiced Revenue</div>
                  <div className="text-xl font-bold text-emerald-700 mt-1">{formatPKR(totalBilled)}</div>
                </div>
                <div className="p-4 bg-indigo-50 border border-indigo-200 rounded-xl">
                  <div className="text-xs text-indigo-700 font-semibold">Outstanding Balance</div>
                  <div className="text-xl font-bold text-indigo-700 mt-1">{formatPKR(totalUnpaid)}</div>
                </div>
              </div>

              {/* Clinic Info Form / View */}
              {isEditing ? (
                <form onSubmit={handleSaveInfo} className="space-y-4 bg-ds-surface/40 p-4 rounded-xl ring-1 ring-ds-line">
                  <h4 className="text-xs font-bold text-ds-ink uppercase">Edit Dental Clinic Details</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-ds-body mb-1">Clinic Name *</label>
                      <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="w-full p-2 text-xs bg-ds-sunken border border-ds-line rounded-lg"
                      />
                      {errors.name && <p className="text-[10px] text-rose-500 mt-0.5">{errors.name}</p>}
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-ds-body mb-1">Doctor Name *</label>
                      <input
                        type="text"
                        value={contactPerson}
                        onChange={(e) => setContactPerson(e.target.value)}
                        className="w-full p-2 text-xs bg-ds-sunken border border-ds-line rounded-lg"
                      />
                      {errors.contactPerson && <p className="text-[10px] text-rose-500 mt-0.5">{errors.contactPerson}</p>}
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-ds-body mb-1">Phone <span className="font-normal text-ink-muted">(optional)</span></label>
                      <input
                        type="text"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        className="w-full p-2 text-xs bg-ds-sunken border border-ds-line rounded-lg"
                      />
                      {errors.phone && <p className="text-[10px] text-rose-500 mt-0.5">{errors.phone}</p>}
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-ds-body mb-1">Email <span className="font-normal text-ink-muted">(optional)</span></label>
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full p-2 text-xs bg-ds-sunken border border-ds-line rounded-lg"
                      />
                      {errors.email && <p className="text-[10px] text-rose-500 mt-0.5">{errors.email}</p>}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-ds-body mb-1">Address <span className="font-normal text-ink-muted">(optional)</span></label>
                    <textarea
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      rows={2}
                      className="w-full p-2 text-xs bg-ds-sunken border border-ds-line rounded-lg"
                    />
                    {errors.address && <p className="text-[10px] text-rose-500 mt-0.5">{errors.address}</p>}
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-ds-body mb-1">Special Clinic Notes</label>
                    <textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      rows={2}
                      className="w-full p-2 text-xs bg-ds-sunken border border-ds-line rounded-lg"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-ds-body mb-1">
                      Opening Balance (PKR) <span className="font-normal text-ink-muted">— money owed before the system</span>
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={openingBalance}
                        onChange={(e) => setOpeningBalance(e.target.value)}
                        className="flex-1 p-2 text-xs bg-ds-sunken border border-ds-line rounded-lg"
                      />
                      <div className="flex rounded-lg border border-ds-line overflow-hidden shrink-0">
                        <button
                          type="button"
                          onClick={() => setOpeningBalanceType('debit')}
                          className={`px-3 py-2 text-xs font-semibold transition-colors cursor-pointer ${
                            openingBalanceType === 'debit'
                              ? 'bg-rose-50 text-rose-700'
                              : 'bg-ds-sunken text-ink-muted hover:bg-ds-surface/70'
                          }`}
                        >
                          Debit
                        </button>
                        <button
                          type="button"
                          onClick={() => setOpeningBalanceType('credit')}
                          className={`px-3 py-2 text-xs font-semibold transition-colors cursor-pointer ${
                            openingBalanceType === 'credit'
                              ? 'bg-emerald-50 text-emerald-700'
                              : 'bg-ds-sunken text-ink-muted hover:bg-ds-surface/70'
                          }`}
                        >
                          Credit
                        </button>
                      </div>
                    </div>
                    <p className="text-[10px] text-ink-muted mt-0.5">
                      {openingBalanceType === 'debit'
                        ? 'The clinic owed you this amount. Posts as a debit on the ledger.'
                        : 'You owed the clinic this amount. Posts as a credit on the ledger.'}
                    </p>
                    {errors.openingBalance && <p className="text-[10px] text-rose-500 mt-0.5">{errors.openingBalance}</p>}
                  </div>

                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setIsEditing(false)}
                      className="px-3 py-1.5 bg-ds-line text-ds-body text-xs font-semibold rounded-lg cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="ds-glass-pill ds-glass-pill-sm font-semibold cursor-pointer"
                    >
                      Save Info
                    </button>
                  </div>
                </form>
              ) : (
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-ink-muted">Facility Information</h3>
                    <button
                      onClick={() => setIsEditing(true)}
                      className="px-3 py-1 bg-ds-sunken hover:bg-ds-line text-ds-body text-xs font-semibold rounded-lg flex items-center gap-1 cursor-pointer"
                    >
                      <Edit2 className="w-3.5 h-3.5" /> Edit Information
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                    <div className="p-4 bg-ds-surface/40 ring-1 ring-ds-line rounded-xl space-y-2">
                      <div className="flex items-center gap-2 text-ink-body font-semibold">
                        <Phone className="w-4 h-4 text-indigo-600" /> Phone: {lab.phone}
                      </div>
                      <div className="flex items-center gap-2 text-ink-body font-semibold">
                        <Mail className="w-4 h-4 text-indigo-600" /> Email: {lab.email}
                      </div>
                    </div>

                    <div className="p-4 bg-ds-surface/40 ring-1 ring-ds-line rounded-xl space-y-1">
                      <div className="flex items-center gap-2 text-ink-body font-semibold">
                        <MapPin className="w-4 h-4 text-ink-success" /> Facility Address:
                      </div>
                      <p className="text-ds-body pl-6">{lab.address}</p>
                    </div>
                  </div>

                  {lab.notes && (
                    <div className="p-4 bg-ds-surface/40 ring-1 ring-ds-line rounded-xl text-xs space-y-1">
                      <div className="font-semibold text-ds-ink">Special Notes:</div>
                      <p className="text-ink-body">{lab.notes}</p>
                    </div>
                  )}

                  <div className={`p-4 border rounded-xl text-xs space-y-1 ${
                    (lab.opening_balance || 0) > 0
                      ? (lab.opening_balance_type === 'credit' ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200')
                      : 'bg-ds-surface/60 border-ds-line'
                  }`}>
                    <div className={`font-semibold text-xs ${
                      (lab.opening_balance || 0) > 0
                        ? (lab.opening_balance_type === 'credit' ? 'text-emerald-800' : 'text-amber-800')
                        : 'text-ink-muted'
                    }`}>
                      Opening Balance (PKR) — {(lab.opening_balance || 0) > 0
                        ? (lab.opening_balance_type === 'credit' ? 'Credit' : 'Debit')
                        : 'None'}
                    </div>
                    <div className={`font-mono font-bold text-sm ${
                      (lab.opening_balance || 0) > 0
                        ? (lab.opening_balance_type === 'credit' ? 'text-emerald-900' : 'text-amber-900')
                        : 'text-ink-muted'
                    }`}>
                      {formatPKR(lab.opening_balance || 0)}
                    </div>
                    <p className={`text-[11px] ${
                      (lab.opening_balance || 0) > 0
                        ? (lab.opening_balance_type === 'credit' ? 'text-emerald-700' : 'text-amber-700')
                        : 'text-ink-muted'
                    }`}>
                      {(lab.opening_balance || 0) > 0
                        ? (lab.opening_balance_type === 'credit'
                          ? 'Money you already owed the clinic before the system. Posts as a credit on the ledger.'
                          : 'Money the clinic already owed you before the system. Posts as a debit on the ledger.')
                        : 'No opening balance — the clinic starts at zero.'}
                    </p>
                  </div>
                </div>
              )}

              {/* Delete Zone */}
              <div className="border-t border-ds-line pt-4 flex justify-between items-center">
                <span className="text-xs text-ink-danger font-semibold">Danger Zone</span>
                <button
                  onClick={() => { setDeleteModalOpen(true); setConfirmInput(""); }}
                  title="Delete this clinic and everything linked to it"
                  className="px-3 py-1.5 bg-rose-50 text-ink-danger hover:bg-rose-100 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" /> Delete Clinic Record
                </button>
              </div>
            </div>
          )}

          {activeTab === 'contacts' && <LabContactsManager labId={lab.id} />}

          {/* The clinic's own ledger: the shared General Ledger, pinned to this
              clinic so the figures cannot be read against a different one. */}
          {activeTab === 'ledger' && (
            <div className="space-y-3">
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowPaymentModal(true)}
                  disabled={!canPost(user, 'payment:record')}
                  title={!canPost(user, 'payment:record') ? deniedTooltip : undefined}
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-semibold rounded-xl shadow-xs flex items-center gap-1.5 cursor-pointer transition-all"
                >
                  <PlusCircle className="w-3.5 h-3.5" />
                  Receive Payment
                </button>
                <button
                  type="button"
                  onClick={() => setShowAdjustmentModal(true)}
                  disabled={!(canPost(user, 'credit:issue') || canPost(user, 'refund:issue') || canPost(user, 'debit:issue'))}
                  title={!(canPost(user, 'credit:issue') || canPost(user, 'refund:issue') || canPost(user, 'debit:issue')) ? deniedTooltip : undefined}
                  className="ds-glass-pill ds-glass-pill-sm disabled:opacity-50 font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  <PlusCircle className="w-3.5 h-3.5" />
                  Record Adjustment
                </button>
              </div>
              <GeneralLedgerView lockedClinicId={lab.id} />
            </div>
          )}

          {activeTab === 'pricing' && <LabPricingManager labId={lab.id} />}
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
            /* No pre-charted teeth — the operator picks them on the odontogram. This
               was [11, 21], which handed every new case two teeth nobody chose,
               and those teeth then reached the slip, the invoice and the unit
               count behind the auto-price. */
            selected_teeth: [],
            tooth_details: {},
            shade: 'A2',
            // Local calendar day, not toISOString(): at 01:30 PKT the UTC day
            // is already yesterday, so +5 days off a UTC base stamped a due
            // date one day early — the lab's own SLA clock started wrong.
            delivery_date: getDaysOffsetStr(5),
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

      {/* Record Adjustment Modal */}
      {showAdjustmentModal && (
        <RecordAdjustmentModal lab={lab} onClose={() => setShowAdjustmentModal(false)} />
      )}

      {/* Receive Payment Modal */}
      {showPaymentModal && (
        <RecordTransactionModal
          isOpen={showPaymentModal}
          onClose={() => setShowPaymentModal(false)}
          initialMode="payment"
          initialLabId={lab.id}
          initialClinicId={lab.id}
        />
      )}

      {/* Typed Confirmation DELETE Modal */}
      {deleteModalOpen && (
        <div className="fixed inset-0 z-[60] bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="ds-glass-pane rounded-2xl max-w-md w-full p-5 space-y-4">
            <div className="flex items-center gap-3 text-ink-danger">
              <ShieldAlert className="w-6 h-6 shrink-0" />
              <h3 className="font-bold text-base text-ds-ink">
                Delete {lab.name} and everything under it?
              </h3>
            </div>
            <p className="text-xs text-ink-body leading-relaxed">
              This permanently erases the clinic. Its case jobs, invoices and any recorded payments go
              with it. Nothing is kept in an archive and there is no undo.
            </p>

            {/* What is about to be destroyed, before it is. A count alone does
                not convey what is at stake, so the money is totalled here. */}
            {deletionImpact && (
              <div className="rounded-xl border border-rose-200 bg-rose-50/60 overflow-hidden">
                <div className="px-3 py-2 border-b border-rose-200 bg-rose-100/60">
                  <span className="text-[11px] font-bold text-rose-800 uppercase tracking-wider">
                    Will be permanently deleted
                  </span>
                </div>
                <dl className="divide-y divide-rose-100">
                  {impactRows.filter((r) => r.count > 0).map((row) => (
                    <div key={row.label} className="px-3 py-1.5 flex items-center justify-between gap-3">
                      <dt className="text-xs text-ds-body">{row.label}</dt>
                      <dd className="text-xs font-mono font-bold text-ds-ink tabular-nums">
                        {row.count}
                        {row.money ? ` · ${formatPKR(row.money)}` : ''}
                      </dd>
                    </div>
                  ))}
                  {impactRows.every((r) => r.count === 0) && (
                    <div className="px-3 py-2 text-xs text-ink-body">
                      Nothing else is linked to this clinic.
                    </div>
                  )}
                </dl>
                {deletionImpact.payments > 0 && (
                  <p className="px-3 py-2 border-t border-rose-200 text-[11px] text-rose-800 leading-relaxed">
                    {formatPKR(deletionImpact.totalPaid)} of recorded payments will be erased from the
                    ledger with no record left. Export a backup first if you may need them.
                  </p>
                )}
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-ds-body mb-1">
                Type <span className="text-ink-danger font-mono">DELETE</span> below:
              </label>
              <input
                type="text"
                value={confirmInput}
                onChange={(e) => setConfirmInput(e.target.value)}
                placeholder="DELETE"
                className="w-full p-2.5 text-xs bg-ds-surface/60 border border-ds-line rounded-lg font-mono text-center font-bold"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => { setDeleteModalOpen(false); setConfirmInput(''); }}
                className="ds-glass-pill ds-glass-pill-sm text-ds-body font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={confirmInput.trim() !== 'DELETE'}
                onClick={handleDeleteConfirmed}
                className="px-4 py-1.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg shadow-sm cursor-pointer"
              >
                Permanently Delete Clinic
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
