import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { LedgerEntry, DentalLab } from '../../types';
import { DatePickerRange, todayISO } from '../common/DatePickerRange';
import { getDateStr, getTodayStr } from '../../utils/dateUtils';
import { 
  Search, 
  Eye, 
  RotateCcw, 
  CheckCircle2,
  DollarSign,
  ArrowUpRight,
  ArrowDownLeft,
  ChevronDown,
  FileDown,
  X, 
  FileText,
  CreditCard,
  Banknote,
  Receipt,
  FileSpreadsheet,
  Building2
} from 'lucide-react';
import { buildLedgerPdf, downloadPdf } from '../../lib/pdf';
import { caseDetailLines, caseDetailText, findCaseForEntry } from '../../services/ledgerCaseDetail';
import { ACCOUNT_CODES } from '../../services/financeDomain';
import { CaseDetailModal } from '../cases/CaseDetailModal';
import { DentalCase } from '../../types';

interface GeneralLedgerViewProps {
  onOpenJournalModal?: (referenceId: string) => void;
}

/** One row of the narration cell: the type badge, the headline and the
    full case block the invoice belongs to. */
interface NarrationDetails {
  typeLabel: string;
  typeBadgeBg: string;
  icon: React.ComponentType<{ className?: string }>;
  narration: string;
  subText?: string;
  caseDetail: { label: string; value: string }[];
}

export const GeneralLedgerView: React.FC<GeneralLedgerViewProps> = ({ onOpenJournalModal }) => {
  const { labs, getLedgerEntries, brandingSettings, cases, setSelectedCaseForModal } = useApp();

  // Case drill-down state: which case's record is open from a ledger row.
  const [selectedCaseForModal, setSelectedCaseForModalLocal] = useState<DentalCase | null>(null);

  // Clinic selection: starts empty — the user must actively pick a clinic;
  // there is no consolidated "all clinics" mode.
  const [selectedClinicId, setSelectedClinicId] = useState<string>('');
  const [clinicSearchText, setClinicSearchText] = useState<string>('');
  const [isClinicDropdownOpen, setIsClinicDropdownOpen] = useState<boolean>(false);
  const clinicDropdownRef = useRef<HTMLDivElement>(null);

  // Case/Job filter — searches case numbers, invoice numbers, patient names.
  const [caseFilter, setCaseFilter] = useState<string>('');

  // Date filters
  // Ledger window defaults to TODAY (like the other billing tabs): older
  // entries are reached with the date picker or the 'All Time' preset.
  const [startDate, setStartDate] = useState<string>(() => todayISO());
  const [endDate, setEndDate] = useState<string>(() => todayISO());
  const [activeDatePreset, setActiveDatePreset] = useState<string>('today');

  // Preview state: hidden until the user clicks Preview.
  const [isPreviewActive, setIsPreviewActive] = useState<boolean>(false);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (clinicDropdownRef.current && !clinicDropdownRef.current.contains(e.target as Node)) {
        setIsClinicDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Selected clinic object
  const selectedClinic = useMemo(() => {
    if (selectedClinicId === 'all') return null;
    return labs.find((l) => l.id === selectedClinicId) || null;
  }, [labs, selectedClinicId]);

  // Filtered clinics for the enhanced searchbar
  const filteredClinics = useMemo(() => {
    if (!clinicSearchText.trim()) return labs;
    const q = clinicSearchText.toLowerCase();
    return labs.filter(
      (lab) =>
        lab.name.toLowerCase().includes(q) ||
        (lab.doctor_name && lab.doctor_name.toLowerCase().includes(q)) ||
        (lab.phone && lab.phone.toLowerCase().includes(q)) ||
        (lab.city && lab.city.toLowerCase().includes(q)) ||
        (lab.code && lab.code.toLowerCase().includes(q))
    );
  }, [labs, clinicSearchText]);

  /* Quick-range helpers for the shared DatePickerRange. Every one of these
     builds a LOCAL Date and must therefore read the local day back out —
     toISOString() would roll a 00:00–05:00 PKT preset back to yesterday. */
  const mondayThisWeek = () => {
    const now = new Date();
    const dow = now.getDay() || 7;
    const mon = new Date(now);
    mon.setDate(now.getDate() - (dow - 1));
    return getDateStr(mon);
  };
  const firstOfMonth = () => {
    const n = new Date();
    return getDateStr(new Date(n.getFullYear(), n.getMonth(), 1));
  };
  const endOfMonth = () => {
    const n = new Date();
    return getDateStr(new Date(n.getFullYear(), n.getMonth() + 1, 0));
  };
  const firstOfLastMonth = () => {
    const n = new Date();
    return getDateStr(new Date(n.getFullYear(), n.getMonth() - 1, 1));
  };
  const endOfLastMonth = () => {
    const n = new Date();
    return getDateStr(new Date(n.getFullYear(), n.getMonth(), 0));
  };
  const firstOfYear = () => {
    const n = new Date();
    return getDateStr(new Date(n.getFullYear(), 0, 1));
  };
  const endOfYear = () => {
    const n = new Date();
    return getDateStr(new Date(n.getFullYear(), 11, 31));
  };

  // Quick date presets
  const applyDatePreset = (preset: 'all' | 'today' | 'this_week' | 'this_month' | 'last_month' | 'this_year') => {
    setActiveDatePreset(preset);
    const now = new Date();

    if (preset === 'all') {
      setStartDate('');
      setEndDate('');
      return;
    }

    if (preset === 'today') {
      // Local calendar day, matching the shared picker (toISOString would roll
      // back a day for PKT/any +offset zone before 05:00 local time).
      const todayStr = todayISO();
      setStartDate(todayStr);
      setEndDate(todayStr);
      return;
    }

    if (preset === 'this_week') {
      const dayOfWeek = now.getDay() || 7; // Sunday is 0, make it 7
      const monday = new Date(now);
      monday.setDate(now.getDate() - (dayOfWeek - 1));
      setStartDate(getDateStr(monday));
      setEndDate(getDateStr(now));
      return;
    }

    if (preset === 'this_month') {
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      setStartDate(getDateStr(firstDay));
      setEndDate(getDateStr(lastDay));
      return;
    }

    if (preset === 'last_month') {
      const firstDay = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastDay = new Date(now.getFullYear(), now.getMonth(), 0);
      setStartDate(getDateStr(firstDay));
      setEndDate(getDateStr(lastDay));
      return;
    }

    if (preset === 'this_year') {
      const firstDay = new Date(now.getFullYear(), 0, 1);
      const lastDay = new Date(now.getFullYear(), 11, 31);
      setStartDate(getDateStr(firstDay));
      setEndDate(getDateStr(lastDay));
      return;
    }
  };

  // Fetch all ledger records for the selected clinic or all clinics
  const rawLedgerEntries = useMemo(() => {
    try {
      if (!getLedgerEntries || !selectedClinicId) return [];
      return getLedgerEntries(selectedClinicId) || [];
    } catch (err) {
      console.error('Error fetching ledger entries:', err);
      return [];
    }
  }, [getLedgerEntries, selectedClinicId]);

  // Compute opening balance before startDate and active entries within date range
  const { openingBalance, ledgerItems, totalDebits, totalCredits, closingBalance } = useMemo(() => {
    /* Order strictly by POSTING TIME (the engine's exact sequence), never by
       document number: sorting by reference string interleaved same-day rows
       and made the running balance jump up and down. The source array arrives
       newest-first, so equal timestamps fall back to reversed engine order. */
    const safeEntries = Array.isArray(rawLedgerEntries) ? rawLedgerEntries : [];
    const indexed = safeEntries.map((entry, index) => ({ entry, index }));
    const sorted = indexed
      .sort((a, b) => {
        const ta = Date.parse(a.entry?.posted_at || '');
        const tb = Date.parse(b.entry?.posted_at || '');
        if (!isNaN(ta) && !isNaN(tb) && ta !== tb) return ta - tb;
        const da = String(a.entry?.date || '').slice(0, 10);
        const db = String(b.entry?.date || '').slice(0, 10);
        if (da !== db) return da.localeCompare(db);
        return b.index - a.index;
      })
      .map((x) => x.entry);

    let openBal = 0;
    const activeEntries: LedgerEntry[] = [];

    sorted.forEach((entry) => {
      const entryDate = String(entry?.date || '').slice(0, 10);
      if (startDate && entryDate && entryDate < startDate) {
        openBal += (entry.debit || 0) - (entry.credit || 0);
      } else if (endDate && entryDate && entryDate > endDate) {
        // Excluded after endDate
      } else {
        activeEntries.push(entry);
      }
    });

    let running = openBal;
    let debitsSum = 0;
    let creditsSum = 0;

    const items = activeEntries.map((entry) => {
      debitsSum += entry.debit || 0;
      creditsSum += entry.credit || 0;
      running += (entry.debit || 0) - (entry.credit || 0);

      return {
        ...entry,
        closing_balance: running
      };
    });

    return {
      openingBalance: openBal,
      ledgerItems: items,
      totalDebits: debitsSum,
      totalCredits: creditsSum,
      closingBalance: running
    };
  }, [rawLedgerEntries, startDate, endDate]);

  /* Case/Job filter — relational field only (case_number on the entry), plus
     invoice-number and patient-name search over rows already fetched. A case
     hit shows that case's complete financial history (invoice + its payments). */
  const caseFilteredItems = useMemo(() => {
    const q = caseFilter.trim().toLowerCase();
    if (!q) return ledgerItems;
    return ledgerItems.filter((e) =>
      (e.case_number || '').toLowerCase().includes(q) ||
      (e.reference_number || '').toLowerCase().includes(q) ||
      (e.doctor_name || '').toLowerCase().includes(q)
    );
  }, [ledgerItems, caseFilter]);

  // Recompute running balance + totals over the case-filtered set so the
  // statement stays self-consistent when narrowed to one case.
  const caseScope = useMemo(() => {
    let running = openingBalance;
    let debitsSum = 0;
    let creditsSum = 0;
    const items = caseFilteredItems.map((entry) => {
      debitsSum += entry.debit || 0;
      creditsSum += entry.credit || 0;
      running += (entry.debit || 0) - (entry.credit || 0);
      return { ...entry, closing_balance: running };
    });
    return { items, debitsSum, creditsSum, closing: running };
  }, [caseFilteredItems, openingBalance]);

  /* Render cap: computing totals over the full set stays correct (above memo),
     but the table only mounts the newest LEDGER_CAP_STEP rows — building+mounting
     ~1500 rows froze the view (audit §9). Expanded on demand like the other
     capped tables. */
  const LEDGER_CAP_STEP = 400;
  const [ledgerLimit, setLedgerLimit] = useState(LEDGER_CAP_STEP);
  const visibleLedgerItems = useMemo(
    () => caseScope.items.slice(0, ledgerLimit),
    [caseScope, ledgerLimit],
  );

  // Helper to format narration and determine entry category
  const getNarrationDetails = (entry: LedgerEntry): NarrationDetails => {
    if (!entry) {
      return {
        typeLabel: 'Entry',
        typeBadgeBg: 'bg-slate-50 text-slate-700 border-slate-200',
        icon: FileText,
        narration: 'Transaction',
        subText: undefined,
        caseDetail: [] as { label: string; value: string }[]
      };
    }

    if (entry.entry_type === 'invoice') {
      const c = findCaseForEntry(entry, cases);
      const detail = c ? caseDetailLines(c) : [];
      return {
        typeLabel: 'Case Invoice',
        typeBadgeBg: 'bg-blue-50 text-blue-700 border-blue-200',
        icon: FileText,
        narration: `${entry.reference_number || ''} • ${entry.description || 'Restoration'}`,
        subText: detail.length ? undefined : (entry.doctor_name ? `Doctor: ${entry.doctor_name}` : undefined),
        caseDetail: detail
      };
    }

    if (entry.entry_type === 'payment') {
      const isCash = entry.payment_method === 'cash';
      const isBank = entry.payment_method === 'bank';
      const isCheque = entry.payment_method === 'cheque';

      const typeLabel = isCash
        ? 'Cash Payment'
        : isBank
        ? 'Bank Transfer'
        : isCheque
        ? 'Cheque'
        : 'Payment Received';

      const typeBadgeBg = isCash
        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
        : isBank
        ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
        : 'bg-purple-50 text-purple-700 border-purple-200';

      const icon = isCash ? Banknote : isBank ? CreditCard : Receipt;

      return {
        typeLabel,
        typeBadgeBg,
        icon,
        narration: `${typeLabel} #${entry.reference_number || ''}${entry.notes ? ` • ${entry.notes}` : ''}`,
        subText: entry.doctor_name ? `Doctor: ${entry.doctor_name}` : undefined,
        caseDetail: []
      };
    }

    if (entry.entry_type === 'advance_payment') {
      const method = String(entry.payment_method || 'cash').toUpperCase();
      return {
        typeLabel: 'Advance Deposit',
        typeBadgeBg: 'bg-teal-50 text-teal-700 border-teal-200',
        icon: DollarSign,
        narration: `Advance Deposit Received (${method}) #${entry.reference_number || ''}${entry.notes ? ` • ${entry.notes}` : ''}`,
        subText: undefined,
        caseDetail: []
      };
    }

    if (entry.entry_type === 'advance_allocation') {
      return {
        typeLabel: 'Advance Credit Applied',
        typeBadgeBg: 'bg-sky-50 text-sky-700 border-sky-200',
        icon: Receipt,
        narration: `Advance Allocation to ${entry.reference_number || 'Invoice'}${entry.notes ? ` • ${entry.notes}` : ''}`,
        subText: undefined,
        caseDetail: []
      };
    }

    if (entry.entry_type === 'credit_note') {
      return {
        typeLabel: 'Credit Note',
        typeBadgeBg: 'bg-amber-50 text-amber-700 border-amber-200',
        icon: ArrowDownLeft,
        narration: `Credit Note #${entry.reference_number || ''} • ${entry.description || 'Adjustment / Discount'}`,
        subText: entry.notes,
        caseDetail: []
      };
    }

    if (entry.entry_type === 'debit_adjustment') {
      return {
        typeLabel: 'Debit Adjustment',
        typeBadgeBg: 'bg-orange-50 text-orange-700 border-orange-200',
        icon: ArrowUpRight,
        narration: `Debit Adjustment #${entry.reference_number || ''} • ${entry.description || 'Surcharge'}`,
        subText: entry.notes,
        caseDetail: []
      };
    }

    // Default refund / other
    return {
      typeLabel: 'Refund / Adjustment',
      typeBadgeBg: 'bg-rose-50 text-rose-700 border-rose-200',
      icon: RotateCcw,
      narration: `${entry.description || 'Adjustment'} #${entry.reference_number || ''}`,
      subText: entry.notes,
      caseDetail: []
    };
  };

  // CSV Export — needs a specific clinic (no consolidated mode exists)
  const handleExportCSV = () => {
    if (!selectedClinic) return;
    try {
      const clinicTitle = selectedClinic.name;
      const filename = `Ledger_${clinicTitle.replace(/\s+/g, '_')}_${getTodayStr()}.csv`;

      const headers = ['Sr No.', 'Date', 'Clinic', 'Type', 'Narration', 'Debit (PKR)', 'Credit (PKR)', 'Closing Balance (PKR)'];
      const rows: string[][] = [];

      // Add opening balance if any
      if (openingBalance !== 0 || startDate) {
        rows.push(['0', startDate || '-', selectedClinic?.name || 'Consolidated', 'Opening Balance', 'Balance brought forward', '0', '0', openingBalance.toString()]);
      }

      ledgerItems.forEach((item, idx) => {
        const details = getNarrationDetails(item);
        const c = findCaseForEntry(item, cases);
        const narration = [details.narration, c ? caseDetailText(c) : ''].filter(Boolean).join(' • ');
        rows.push([
          (idx + 1).toString(),
          String(item.date || '').slice(0, 10),
          `"${String(item.lab_name || '').replace(/"/g, '""')}"`,
          `"${String(details.typeLabel || '')}"`,
          `"${String(narration).replace(/"/g, '""')}"`,
          (item.debit || 0).toString(),
          (item.credit || 0).toString(),
          (item.closing_balance || 0).toString()
        ]);
      });

      const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement('a');
      link.setAttribute('href', encodedUri);
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (e) {
      console.error('Error exporting CSV:', e);
    }
  };

  /* PDF export — a real vector document (text, table, page breaks), not a
     screenshot. Reuses the exact rows/totals the on-screen preview shows. */
  const handleExportPDF = () => {
    if (!selectedClinic) return;
    try {
      const clinicLabel = selectedClinic.name;
      const periodLabel = startDate || endDate
        ? `${startDate || 'Beginning'} → ${endDate || 'Present'}`
        : 'All Time';
      const result = buildLedgerPdf(
        caseScope.items.map((item) => {
          const details = getNarrationDetails(item);
          const c = findCaseForEntry(item, cases);
          return {
            date: String(item.date || '').slice(0, 10),
            clinic: item.lab_name || '',
            caseNumber: item.case_number || '',
            typeLabel: details.typeLabel,
            narration: [details.narration, c ? caseDetailText(c) : ''].filter(Boolean).join(' • '),
            debit: item.debit || 0,
            credit: item.credit || 0,
            closing: item.closing_balance || 0,
          };
        }),
        {
          labName: brandingSettings?.lab_name || brandingSettings?.appName || 'Dental Lab',
          clinicLabel,
          periodLabel,
          caseFilterLabel: caseFilter.trim() || undefined,
          accountName: ACCOUNT_CODES.ACCOUNTS_RECEIVABLE.name,
          accountCode: ACCOUNT_CODES.ACCOUNTS_RECEIVABLE.code,
          openingBalance,
          totalDebits: caseScope.debitsSum,
          totalCredits: caseScope.creditsSum,
          closingBalance: caseScope.closing,
          transactionCount: caseScope.items.length,
          generatedOn: todayISO(),
        }
      );
      downloadPdf(
        `Ledger_${clinicLabel.replace(/\s+/g, '_')}${caseFilter.trim() ? `_${caseFilter.trim().replace(/\s+/g, '_')}` : ''}_${todayISO()}.pdf`,
        result.pdf
      );
    } catch (e) {
      console.error('Error exporting PDF:', e);
    }
  };

  // Handle Print safely. The printable block only exists while the preview
  // is active, so activate it first — otherwise the printout would be blank.
  const handlePrint = () => {
    setIsPreviewActive(true);
    try {
      setTimeout(() => window.print(), 50);
    } catch (e) {
      console.warn('Print not supported in iframe environment:', e);
    }
  };

  return (
    <div className="space-y-6 print-page">
      {/* SEARCH-FIRST FILTER ROW: clinic picker → date picker → preview */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-2xs space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center gap-3">
          {/* Clinic picker (searchable dropdown) */}
          <div className="relative flex-1 min-w-[220px]" ref={clinicDropdownRef}>

            <div className="relative">
              <div
                onClick={() => setIsClinicDropdownOpen(true)}
                className={`w-full p-2.5 bg-slate-50 hover:bg-slate-100/80 border rounded-xl flex items-center justify-between cursor-pointer transition-all ${
                  isClinicDropdownOpen ? 'border-blue-500 ring-2 ring-blue-100 bg-white' : 'border-slate-200'
                }`}
              >
                <div className="flex items-center gap-2.5 overflow-hidden">
                  <Search className="w-4 h-4 text-slate-500 shrink-0" />
                  {selectedClinic ? (
                    <div className="truncate">
                      <span className="text-xs font-bold text-slate-900">{selectedClinic.name}</span>
                      {selectedClinic.doctor_name && (
                        <span className="text-[11px] text-slate-500 ml-1.5">({selectedClinic.doctor_name})</span>
                      )}
                    </div>
                  ) : (
                    <span className="text-xs font-bold text-slate-400">
                      Select clinic…
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <ChevronDown className={`w-4 h-4 text-slate-500 transition-transform ${isClinicDropdownOpen ? 'rotate-180' : ''}`} />
                </div>
              </div>

              {/* Enhanced Dropdown List showing saved clinics */}
              {isClinicDropdownOpen && (
                <div className="absolute top-full left-0 right-0 mt-1.5 bg-white border border-slate-200 rounded-xl shadow-xl z-50 max-h-72 overflow-y-auto p-2 space-y-1">
                  {/* Search input inside dropdown */}
                  <div className="p-1.5 sticky top-0 bg-white border-b border-slate-100 mb-1">
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
                      <input
                        type="text"
                        value={clinicSearchText}
                        onChange={(e) => setClinicSearchText(e.target.value)}
                        placeholder="Type to filter saved clinics..."
                        autoFocus
                        className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
                      />
                    </div>
                  </div>

                  {/* Saved Clinics */}
                  {filteredClinics.length === 0 ? (
                    <div className="p-4 text-center text-xs text-slate-500">
                      No saved clinic matching "{clinicSearchText}"
                    </div>
                  ) : (
                    filteredClinics.map((clinic) => {
                      const isSelected = selectedClinicId === clinic.id;
                      return (
                        <button
                          key={clinic.id}
                          type="button"
                          onClick={() => {
                            setSelectedClinicId(clinic.id);
                            setIsClinicDropdownOpen(false);
                            setClinicSearchText('');
                          }}
                          className={`w-full text-left p-2.5 rounded-lg text-xs flex items-center justify-between transition-colors ${
                            isSelected
                              ? 'bg-blue-50 text-blue-900 font-bold'
                              : 'hover:bg-slate-50 text-slate-800'
                          }`}
                        >
                          <div className="min-w-0 pr-2">
                            <div className="font-bold text-slate-900 truncate">{clinic.name}</div>
                            <div className="text-[11px] text-slate-500 font-normal flex items-center gap-2 mt-0.5 truncate">
                              {clinic.doctor_name && <span>Dr. {clinic.doctor_name}</span>}
                              {clinic.city && <span>• {clinic.city}</span>}
                              {clinic.phone && <span>• {clinic.phone}</span>}
                            </div>
                          </div>
                          {isSelected && (
                            <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0" />
                          )}
                        </button>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Case/Job search — case number, invoice number, or clinic-side name */}
          <div className="relative shrink-0">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={caseFilter}
              onChange={(e) => { setCaseFilter(e.target.value); setLedgerLimit(LEDGER_CAP_STEP); }}
              placeholder="Case / Job / Invoice #"
              className="w-44 pl-9 pr-8 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-blue-500"
            />
            {caseFilter && (
              <button
                type="button"
                onClick={() => { setCaseFilter(''); setLedgerLimit(LEDGER_CAP_STEP); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700"
                title="Clear case filter" aria-label="Clear case filter"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Shared date picker */}
          <div className="shrink-0">
            <DatePickerRange
              from={startDate}
              to={endDate}
              quickRanges={[
                { label: 'Today', from: todayISO(), to: todayISO() },
                { label: 'All Time', from: '', to: '' },
                { label: 'This Week', from: mondayThisWeek(), to: todayISO() },
                { label: 'This Month', from: firstOfMonth(), to: endOfMonth() },
                { label: 'Last Month', from: firstOfLastMonth(), to: endOfLastMonth() },
                { label: 'This Year', from: firstOfYear(), to: endOfYear() },
              ]}
              onChange={(f, t) => {
                setStartDate(f);
                setEndDate(t);
                setActiveDatePreset('custom');
              }}
            />
          </div>

          {/* PDF Export Button — real vector document, not a screenshot */}
          <button
            type="button"
            onClick={handleExportPDF}
            title="Download ledger statement as PDF (selectable text, real pages)" aria-label="Download ledger statement as PDF"
            className="shrink-0 py-2.5 px-4 bg-brand-600 hover:bg-brand-700 text-white font-bold text-xs rounded-xl shadow-xs flex items-center justify-center gap-2 transition-all cursor-pointer"
          >
            <FileDown className="w-4 h-4" />
            <span>Export PDF</span>
          </button>

          {/* Preview Button */}
          <button
            type="button"
            onClick={() => setIsPreviewActive(true)}
            className="shrink-0 py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-xs flex items-center justify-center gap-2 transition-all cursor-pointer"
          >
            <Eye className="w-4 h-4" />
            <span>Preview</span>
          </button>
        </div>

        {/* Quick Date Range Preset Pills */}
        <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-100">
          <span className="text-[11px] font-bold text-slate-600 mr-1">Quick Dates:</span>
          {[
            { id: 'today', label: 'Today' },
            { id: 'all', label: 'All Time' },
            { id: 'this_week', label: 'This Week' },
            { id: 'this_month', label: 'This Month' },
            { id: 'last_month', label: 'Last Month' },
            { id: 'this_year', label: 'This Year' },
          ].map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => applyDatePreset(p.id as any)}
              className={`px-2.5 py-1 text-[11px] font-semibold rounded-lg transition-colors cursor-pointer ${
                activeDatePreset === p.id
                  ? 'bg-blue-600 text-white shadow-2xs'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
              }`}
            >
              {p.label}
            </button>
          ))}

          {(startDate || endDate) && (
            <button
              type="button"
              onClick={() => {
                setStartDate('');
                setEndDate('');
                setActiveDatePreset('all');
              }}
              className="ml-auto text-[11px] text-rose-600 hover:underline flex items-center gap-1 font-semibold"
            >
              <X className="w-3 h-3" /> Clear Dates
            </button>
          )}
        </div>
      </div>

      {/* PREVIEW CONTAINER — hidden until Preview clicked; shows an
          empty-state until a clinic is picked (no consolidated mode). */}
      {isPreviewActive && (
        <div className="space-y-4 print-flow">
          {!selectedClinic ? (
            <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-12 text-center">
              <Building2 className="mx-auto mb-2 w-8 h-8 text-slate-300" />
              <p className="text-sm font-bold text-slate-600">Select a clinic to view its ledger</p>
              <p className="text-xs text-slate-400 mt-1">Pick a clinic above to load its transactions.</p>
            </div>
          ) : (
        <>
          {/* Selected Clinic Banner if specific clinic chosen */}
          {/* Selected Clinic Banner if specific clinic chosen */}
          {selectedClinic && (
            <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-700 font-bold flex items-center justify-center text-xs">
                  {String(selectedClinic.name || 'CL').slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <span className="font-bold text-slate-900 text-sm">{selectedClinic.name}</span>
                  <div className="text-[11px] text-slate-500 flex items-center gap-2">
                    {selectedClinic.doctor_name && <span>Doctor: {selectedClinic.doctor_name}</span>}
                    {selectedClinic.phone && <span>• Tel: {selectedClinic.phone}</span>}
                    {selectedClinic.address && <span>• {selectedClinic.address}</span>}
                  </div>
                </div>
              </div>
              <div className="text-right">
                <span className="text-[11px] font-bold text-slate-500 uppercase block">Statement Period</span>
                <span className="font-semibold text-slate-800">
                  {startDate || 'Beginning'} &rarr; {endDate || 'Present'}
                </span>
              </div>
            </div>
          )}

          {/* THE GENERAL LEDGER PREVIEW TABLE */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                  Ledger Transactions Preview
                </h3>
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-200 text-slate-700">
                  {ledgerItems.length} entries
                </span>
              </div>
              <div className="text-[11px] text-slate-500">
                Oldest first · ordered by posting time, closing balance on the last line
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                    <th scope="col" className="py-2 px-3 w-14 text-center">Sr No.</th>
                    <th scope="col" className="py-2 px-3 w-28">Date</th>
                    <th scope="col" className="py-2 px-3 w-40">Clinic</th>
                    <th scope="col" className="py-2 px-3 w-32">Case / Job</th>
                    <th scope="col" className="py-2 px-3">Narration (Type / Reference)</th>
                    <th scope="col" className="py-2 px-3 text-right w-28">Debit (PKR)</th>
                    <th scope="col" className="py-2 px-3 text-right w-28">Credit (PKR)</th>
                    <th scope="col" className="py-2 px-3 text-right w-36">Closing Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {/* Opening Balance Row if date filtered or non-zero */}
                  {(openingBalance !== 0 || startDate) && (
                    <tr className="bg-amber-50/40 text-slate-700 font-semibold italic">
                      <td className="py-2.5 px-3 text-center text-slate-500 font-mono text-[11px]">-</td>
                      <td className="py-2.5 px-3 text-slate-600 font-mono text-[11px]">{startDate || '-'}</td>
                      <td className="py-2.5 px-4 font-bold text-slate-800">
                        {selectedClinic ? selectedClinic.name : 'Consolidated Clinics'}
                      </td>
                      <td className="py-2.5 px-3 text-slate-400">—</td>
                      <td className="py-2.5 px-4">
                        <span className="inline-block text-[11px] uppercase font-bold px-2 py-0.5 rounded bg-amber-100 text-amber-800 mr-2 border border-amber-200">
                          Opening Balance
                        </span>
                        <span className="text-slate-600 not-italic">Balance brought forward</span>
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-500">-</td>
                      <td className="py-2.5 px-3 text-right text-slate-500">-</td>
                      <td className="py-2.5 px-4 text-right font-bold font-mono text-slate-900 not-italic">
                        PKR {openingBalance.toLocaleString()}
                      </td>
                    </tr>
                  )}

                  {ledgerItems.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-12 text-center text-slate-500">
                        <div className="w-12 h-12 mx-auto rounded-full bg-slate-100 text-slate-500 flex items-center justify-center mb-3">
                          <FileSpreadsheet className="w-6 h-6" />
                        </div>
                        <p className="text-sm font-bold text-slate-800">No ledger entries found</p>
                        <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                          There are no recorded case invoices or payments for the selected clinic and date filter. Try selecting 'All Time' or choosing another clinic.
                        </p>
                      </td>
                    </tr>
                  ) : (
                    visibleLedgerItems.map((entry, idx) => {
                      const details = getNarrationDetails(entry);
                      const Icon = details.icon;

                      return (
                        <tr 
                          key={entry.id || idx}
                          className="hover:bg-slate-50/80 transition-colors"
                        >
                          {/* Sr No. */}
                          <td className="py-2 px-3 text-center font-mono text-[11px] text-slate-500 font-semibold">
                            {idx + 1}
                          </td>

                          {/* Date */}
                          <td className="py-2 px-3 text-slate-700 whitespace-nowrap font-medium text-[11px]">
                            {entry.date ? entry.date.slice(0, 10) : '-'}
                          </td>

                          {/* Clinic */}
                          <td className="py-2 px-3">
                            <span className="font-bold text-slate-900 block truncate max-w-[160px]" title={entry.lab_name}>
                              {entry.lab_name}
                            </span>
                          </td>

                          {/* Case/Job — first-class relational reference; opens the real case record */}
                          <td className="py-2 px-3">
                            {entry.case_number ? (
                              <button
                                type="button"
                                onClick={() => {
                                  const c = cases.find((x) => x.id === entry.case_id)
                                    || cases.find((x) => x.case_number === entry.case_number);
                                  if (c) setSelectedCaseForModalLocal(c);
                                }}
                                disabled={!entry.case_id && !cases.some((x) => x.case_number === entry.case_number)}
                                title={entry.case_id ? 'Open case' : 'Case record not found'}
                                className="inline-block font-mono text-[11px] font-bold text-indigo-800 bg-indigo-50 border border-indigo-200 rounded px-1.5 py-0.5 whitespace-nowrap hover:bg-indigo-100 transition-colors cursor-pointer disabled:cursor-default disabled:hover:bg-indigo-50"
                              >
                                {entry.case_number}
                              </button>
                            ) : (
                              <span className="text-slate-300 text-xs">—</span>
                            )}
                          </td>

                          {/* Narration whether its a case entry or cash/payment */}
                          <td className="py-2 px-3">
                            <div className="space-y-1">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className={`inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${details.typeBadgeBg}`}>
                                  <Icon className="w-3 h-3" />
                                  {details.typeLabel}
                                </span>
                                <span className="font-semibold text-slate-800 text-xs">
                                  {details.narration}
                                </span>
                              </div>
                              {details.subText && (
                                <p className="text-[11px] text-slate-500 font-normal pl-0.5">
                                  {details.subText}
                                </p>
                              )}
                              {details.caseDetail.length > 0 && (
                                /* The case the money is booked against —
                                   patient, procedure, teeth, shade. */
                                <dl className="mt-1 grid grid-cols-1 gap-x-4 gap-y-0.5 rounded-lg border border-slate-200 bg-slate-50/80 px-2.5 py-2 sm:grid-cols-2">
                                  {details.caseDetail.map((d) => (
                                    <div key={d.label} className="flex items-baseline gap-1.5 min-w-0">
                                      <dt className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                        {d.label}
                                      </dt>
                                      <dd className="truncate text-[11px] text-slate-700" title={d.value}>
                                        {d.value}
                                      </dd>
                                    </div>
                                  ))}
                                </dl>
                              )}
                            </div>
                          </td>

                          {/* Debit */}
                          <td className="py-2 px-3 text-right whitespace-nowrap">
                            {entry.debit > 0 ? (
                              <span className="font-bold text-blue-900 font-mono">
                                PKR {entry.debit.toLocaleString()}
                              </span>
                            ) : (
                              <span className="text-slate-400 font-mono">-</span>
                            )}
                          </td>

                          {/* Credit */}
                          <td className="py-2 px-3 text-right whitespace-nowrap">
                            {entry.credit > 0 ? (
                              <span className="font-bold text-emerald-700 font-mono">
                                PKR {entry.credit.toLocaleString()}
                              </span>
                            ) : (
                              <span className="text-slate-400 font-mono">-</span>
                            )}
                          </td>

                          {/* Closing Balance */}
                          <td className="py-2 px-3 text-right whitespace-nowrap font-mono font-bold text-slate-900">
                            <span className={entry.closing_balance > 0 ? 'text-slate-900' : entry.closing_balance < 0 ? 'text-emerald-700' : 'text-slate-500'}>
                              PKR {entry.closing_balance.toLocaleString()}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>

                {/* Period activity totals only — the closing balance is the
                    final line of the statement, below everything else. */}
                {caseScope.items.length > 0 && (
                  <tfoot>
                    <tr className="bg-slate-100/90 border-t-2 border-slate-300 font-bold text-xs text-slate-900">
                      <td colSpan={5} className="py-3.5 px-4 text-right uppercase tracking-wider font-bold">
                        Total Period Activity:
                      </td>
                      <td className="py-3.5 px-3 text-right font-bold font-mono text-blue-900 whitespace-nowrap">
                        PKR {caseScope.debitsSum.toLocaleString()}
                      </td>
                      <td className="py-3.5 px-3 text-right font-bold font-mono text-emerald-700 whitespace-nowrap">
                        PKR {caseScope.creditsSum.toLocaleString()}
                      </td>
                      <td className="py-3.5 px-4 text-right text-slate-400 whitespace-nowrap">—</td>
                    </tr>
                  </tfoot>
                )}
              </table>
              {caseScope.items.length > visibleLedgerItems.length && (
                <div className="flex items-center justify-center gap-3 py-4 border-t border-slate-100 bg-slate-50/60">
                  <span className="text-xs text-slate-500">
                    Showing {visibleLedgerItems.length} of {caseScope.items.length} entries — totals cover the full period
                  </span>
                  <button
                    type="button"
                    onClick={() => setLedgerLimit((n) => n + LEDGER_CAP_STEP)}
                    className="px-4 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-bold rounded-lg transition-colors cursor-pointer"
                  >
                    Show {Math.min(LEDGER_CAP_STEP, caseScope.items.length - visibleLedgerItems.length)} More
                  </button>
                </div>
              )}
            </div>

            {/* Final line of the statement: the closing balance, after the last
                chronologically ordered entry. */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t-2 border-slate-300 bg-slate-50 px-4 py-3.5">
              <div>
                <span className="block text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">
                  Closing Balance{startDate || endDate ? ` · ${startDate || 'Beginning'} → ${endDate || 'Present'}` : ''}
                </span>
                <span className="text-[11px] text-slate-500">
                  {caseScope.closing > 0
                    ? 'Receivable from clinic'
                    : caseScope.closing < 0
                    ? 'Advance credit held for clinic'
                    : 'Fully settled'}
                </span>
              </div>
              <span className="font-mono text-lg font-bold tracking-tight text-slate-900">
                PKR {caseScope.closing.toLocaleString()} {caseScope.closing > 0 ? 'Dr' : caseScope.closing < 0 ? 'Cr' : ''}
              </span>
            </div>
          </div>
        </>
          )}
        </div>
      )}

      {/* Case drill-down: ledger badge → real case record (same pattern as LabDetailModal) */}
      {selectedCaseForModal && (
        <CaseDetailModal
          initialCase={selectedCaseForModal}
          onClose={() => setSelectedCaseForModalLocal(null)}
        />
      )}
    </div>
  );
};
