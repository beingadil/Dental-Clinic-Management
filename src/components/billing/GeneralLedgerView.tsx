import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { LedgerEntry, DentalLab } from '../../types';
import { 
  Search, 
  Calendar, 
  Eye, 
  Printer, 
  Download, 
  Building2, 
  RotateCcw, 
  CheckCircle2, 
  DollarSign, 
  ArrowUpRight, 
  ArrowDownLeft, 
  ChevronDown, 
  X, 
  BookOpen,
  FileText,
  CreditCard,
  Banknote,
  Receipt,
  FileSpreadsheet
} from 'lucide-react';

interface GeneralLedgerViewProps {
  onOpenJournalModal?: (referenceId: string) => void;
}

export const GeneralLedgerView: React.FC<GeneralLedgerViewProps> = ({ onOpenJournalModal }) => {
  const { labs, getLedgerEntries, brandingSettings } = useApp();

  // Selected clinic ID ('all' or specific lab.id)
  const [selectedClinicId, setSelectedClinicId] = useState<string>('all');
  const [clinicSearchText, setClinicSearchText] = useState<string>('');
  const [isClinicDropdownOpen, setIsClinicDropdownOpen] = useState<boolean>(false);
  const clinicDropdownRef = useRef<HTMLDivElement>(null);

  // Date filters
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [activeDatePreset, setActiveDatePreset] = useState<string>('all');

  // Preview state (controls whether preview is visible)
  const [isPreviewActive, setIsPreviewActive] = useState<boolean>(true);

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
      const todayStr = now.toISOString().slice(0, 10);
      setStartDate(todayStr);
      setEndDate(todayStr);
      return;
    }

    if (preset === 'this_week') {
      const dayOfWeek = now.getDay() || 7; // Sunday is 0, make it 7
      const monday = new Date(now);
      monday.setDate(now.getDate() - (dayOfWeek - 1));
      setStartDate(monday.toISOString().slice(0, 10));
      setEndDate(now.toISOString().slice(0, 10));
      return;
    }

    if (preset === 'this_month') {
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      setStartDate(firstDay.toISOString().slice(0, 10));
      setEndDate(lastDay.toISOString().slice(0, 10));
      return;
    }

    if (preset === 'last_month') {
      const firstDay = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastDay = new Date(now.getFullYear(), now.getMonth(), 0);
      setStartDate(firstDay.toISOString().slice(0, 10));
      setEndDate(lastDay.toISOString().slice(0, 10));
      return;
    }

    if (preset === 'this_year') {
      const firstDay = new Date(now.getFullYear(), 0, 1);
      const lastDay = new Date(now.getFullYear(), 11, 31);
      setStartDate(firstDay.toISOString().slice(0, 10));
      setEndDate(lastDay.toISOString().slice(0, 10));
      return;
    }
  };

  // Fetch all ledger records for the selected clinic or all clinics
  const rawLedgerEntries = useMemo(() => {
    try {
      if (!getLedgerEntries) return [];
      return getLedgerEntries(selectedClinicId === 'all' ? undefined : selectedClinicId) || [];
    } catch (err) {
      console.error('Error fetching ledger entries:', err);
      return [];
    }
  }, [getLedgerEntries, selectedClinicId]);

  // Compute opening balance before startDate and active entries within date range
  const { openingBalance, ledgerItems, totalDebits, totalCredits, closingBalance } = useMemo(() => {
    // Sort chronologically ascending
    const safeEntries = Array.isArray(rawLedgerEntries) ? rawLedgerEntries : [];
    const sorted = [...safeEntries].sort((a, b) => {
      const timeA = a?.date ? new Date(a.date).getTime() : 0;
      const timeB = b?.date ? new Date(b.date).getTime() : 0;
      const dateDiff = (isNaN(timeA) ? 0 : timeA) - (isNaN(timeB) ? 0 : timeB);
      if (dateDiff !== 0) return dateDiff;
      return String(a?.reference_number || '').localeCompare(String(b?.reference_number || ''));
    });

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

  // Helper to format narration and determine entry category
  const getNarrationDetails = (entry: LedgerEntry) => {
    if (!entry) {
      return {
        typeLabel: 'Entry',
        typeBadgeBg: 'bg-slate-50 text-slate-700 border-slate-200',
        icon: FileText,
        narration: 'Transaction',
        subText: undefined
      };
    }

    if (entry.entry_type === 'invoice') {
      return {
        typeLabel: 'Case Entry',
        typeBadgeBg: 'bg-blue-50 text-blue-700 border-blue-200',
        icon: FileText,
        narration: `Case Invoice #${entry.reference_number || ''}${entry.case_number ? ` (Case #${entry.case_number})` : ''} • ${entry.description || 'Restoration'}`,
        subText: entry.doctor_name ? `Doctor: ${entry.doctor_name}` : undefined
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
        subText: entry.doctor_name ? `Doctor: ${entry.doctor_name}` : undefined
      };
    }

    if (entry.entry_type === 'advance_payment') {
      const method = String(entry.payment_method || 'cash').toUpperCase();
      return {
        typeLabel: 'Advance Deposit',
        typeBadgeBg: 'bg-teal-50 text-teal-700 border-teal-200',
        icon: DollarSign,
        narration: `Advance Deposit Received (${method}) #${entry.reference_number || ''}${entry.notes ? ` • ${entry.notes}` : ''}`,
        subText: undefined
      };
    }

    if (entry.entry_type === 'advance_allocation') {
      return {
        typeLabel: 'Advance Credit Applied',
        typeBadgeBg: 'bg-sky-50 text-sky-700 border-sky-200',
        icon: Receipt,
        narration: `Advance Allocation to ${entry.reference_number || 'Invoice'}${entry.notes ? ` • ${entry.notes}` : ''}`,
        subText: undefined
      };
    }

    if (entry.entry_type === 'credit_note') {
      return {
        typeLabel: 'Credit Note',
        typeBadgeBg: 'bg-amber-50 text-amber-700 border-amber-200',
        icon: ArrowDownLeft,
        narration: `Credit Note #${entry.reference_number || ''} • ${entry.description || 'Adjustment / Discount'}`,
        subText: entry.notes
      };
    }

    if (entry.entry_type === 'debit_adjustment') {
      return {
        typeLabel: 'Debit Adjustment',
        typeBadgeBg: 'bg-orange-50 text-orange-700 border-orange-200',
        icon: ArrowUpRight,
        narration: `Debit Adjustment #${entry.reference_number || ''} • ${entry.description || 'Surcharge'}`,
        subText: entry.notes
      };
    }

    // Default refund / other
    return {
      typeLabel: 'Refund / Adjustment',
      typeBadgeBg: 'bg-rose-50 text-rose-700 border-rose-200',
      icon: RotateCcw,
      narration: `${entry.description || 'Adjustment'} #${entry.reference_number || ''}`,
      subText: entry.notes
    };
  };

  // CSV Export
  const handleExportCSV = () => {
    try {
      const clinicTitle = selectedClinic ? selectedClinic.name : 'All_Clinics';
      const filename = `Ledger_${clinicTitle.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`;

      const headers = ['Sr No.', 'Date', 'Clinic', 'Type', 'Narration', 'Debit (PKR)', 'Credit (PKR)', 'Closing Balance (PKR)'];
      const rows: string[][] = [];

      // Add opening balance if any
      if (openingBalance !== 0 || startDate) {
        rows.push(['0', startDate || '-', selectedClinic?.name || 'Consolidated', 'Opening Balance', 'Balance brought forward', '0', '0', openingBalance.toString()]);
      }

      ledgerItems.forEach((item, idx) => {
        const details = getNarrationDetails(item);
        rows.push([
          (idx + 1).toString(),
          String(item.date || '').slice(0, 10),
          `"${String(item.lab_name || '').replace(/"/g, '""')}"`,
          `"${String(details.typeLabel || '')}"`,
          `"${String(details.narration || '').replace(/"/g, '""')}"`,
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

  // Handle Print safely
  const handlePrint = () => {
    try {
      window.print();
    } catch (e) {
      console.warn('Print not supported in iframe environment:', e);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header Card */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center border border-blue-100">
            <BookOpen className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-base md:text-lg font-black text-slate-900 flex items-center gap-2">
              General Ledger
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                Clinic Statement
              </span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Select saved clinics and choose date range to generate a clean preview of case debits, cash/bank credits, and closing balance.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleExportCSV}
            disabled={ledgerItems.length === 0}
            className="px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold flex items-center gap-1.5 transition-colors disabled:opacity-40 cursor-pointer shadow-2xs"
            title="Download CSV file"
          >
            <Download className="w-4 h-4 text-slate-500" />
            <span>Export CSV</span>
          </button>
          <button
            type="button"
            onClick={handlePrint}
            disabled={ledgerItems.length === 0}
            className="px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold flex items-center gap-1.5 transition-colors disabled:opacity-40 cursor-pointer shadow-2xs"
            title="Print statement"
          >
            <Printer className="w-4 h-4 text-slate-500" />
            <span>Print</span>
          </button>
        </div>
      </div>

      {/* SEARCHBAR, DATEPICKER & PREVIEW CONTROLS CARD */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-2xs space-y-4">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-end">
          {/* Enhanced Searchbar for Saved Clinics (Col 6) */}
          <div className="lg:col-span-6 relative" ref={clinicDropdownRef}>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5 text-blue-600" />
                Select Saved Clinic
              </span>
              <span className="text-[11px] font-normal text-slate-500">
                {labs.length} clinics saved
              </span>
            </label>

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
                    <span className="text-xs font-bold text-slate-900">
                      All Saved Clinics (Consolidated)
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {selectedClinicId !== 'all' && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedClinicId('all');
                        setClinicSearchText('');
                      }}
                      className="p-1 text-slate-500 hover:text-slate-700 hover:bg-slate-200 rounded-md"
                      title="Clear clinic selection"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
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

                  {/* All Clinics option */}
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedClinicId('all');
                      setIsClinicDropdownOpen(false);
                      setClinicSearchText('');
                    }}
                    className={`w-full text-left p-2.5 rounded-lg text-xs font-semibold flex items-center justify-between transition-colors ${
                      selectedClinicId === 'all'
                        ? 'bg-blue-50 text-blue-900 font-bold'
                        : 'hover:bg-slate-50 text-slate-800'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-[10px]">
                        ALL
                      </div>
                      <div>
                        <div className="font-bold">All Saved Clinics</div>
                        <div className="text-[10px] text-slate-500 font-normal">Combined ledger entries</div>
                      </div>
                    </div>
                    {selectedClinicId === 'all' && (
                      <CheckCircle2 className="w-4 h-4 text-blue-600" />
                    )}
                  </button>

                  {/* Filtered Saved Clinics */}
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
                            <div className="text-[10px] text-slate-500 font-normal flex items-center gap-2 mt-0.5 truncate">
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

          {/* Enhanced Datepicker (Col 4) */}
          <div className="lg:col-span-4">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5 flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-blue-600" />
              Date Range
            </label>
            <div className="grid grid-cols-2 gap-2">
              <div className="relative">
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => {
                    setStartDate(e.target.value);
                    setActiveDatePreset('custom');
                  }}
                  className="w-full p-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-blue-500 font-medium text-slate-800"
                  title="From Date"
                />
              </div>
              <div className="relative">
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => {
                    setEndDate(e.target.value);
                    setActiveDatePreset('custom');
                  }}
                  className="w-full p-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-blue-500 font-medium text-slate-800"
                  title="To Date"
                />
              </div>
            </div>
          </div>

          {/* Preview Button (Col 2) */}
          <div className="lg:col-span-2">
            <button
              type="button"
              onClick={() => setIsPreviewActive(true)}
              className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-xs flex items-center justify-center gap-2 transition-all cursor-pointer"
            >
              <Eye className="w-4 h-4" />
              <span>Preview</span>
            </button>
          </div>
        </div>

        {/* Quick Date Range Preset Pills */}
        <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-100">
          <span className="text-[11px] font-bold text-slate-600 mr-1">Quick Dates:</span>
          {[
            { id: 'all', label: 'All Time' },
            { id: 'today', label: 'Today' },
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

      {/* PREVIEW CONTAINER */}
      {isPreviewActive && (
        <div className="space-y-4">
          {/* Summary Strip Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600 block">
                Opening Balance
              </span>
              <span className="text-sm md:text-base font-black text-slate-900 mt-1 block">
                PKR {openingBalance.toLocaleString()}
              </span>
              <span className="text-[10px] text-slate-500">
                {startDate ? `Before ${startDate}` : 'Initial state'}
              </span>
            </div>

            <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
              <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600 block">
                Total Debits (Cases)
              </span>
              <span className="text-sm md:text-base font-black text-blue-900 mt-1 block">
                PKR {totalDebits.toLocaleString()}
              </span>
              <span className="text-[10px] text-slate-500">
                {ledgerItems.filter((i) => i.debit > 0).length} debits billed
              </span>
            </div>

            <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 block">
                Total Credits (Cash/Bank)
              </span>
              <span className="text-sm md:text-base font-black text-emerald-900 mt-1 block">
                PKR {totalCredits.toLocaleString()}
              </span>
              <span className="text-[10px] text-slate-500">
                {ledgerItems.filter((i) => i.credit > 0).length} payments received
              </span>
            </div>

            <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600 block">
                Closing Balance
              </span>
              <span className={`text-sm md:text-base font-black mt-1 block ${
                closingBalance > 0 ? 'text-amber-700' : closingBalance < 0 ? 'text-blue-700' : 'text-emerald-700'
              }`}>
                PKR {closingBalance.toLocaleString()} {closingBalance > 0 ? 'Dr' : closingBalance < 0 ? 'Cr' : ''}
              </span>
              <span className="text-[10px] text-slate-500 font-semibold">
                {closingBalance > 0 ? 'Receivable from clinic' : closingBalance < 0 ? 'Advance clinic credit' : 'Fully settled'}
              </span>
            </div>
          </div>

          {/* Selected Clinic Banner if specific clinic chosen */}
          {selectedClinic && (
            <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-700 font-black flex items-center justify-center text-xs">
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
                <span className="text-[10px] font-bold text-slate-500 uppercase block">Statement Period</span>
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
                Sorted chronologically by transaction date
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                    <th className="py-3 px-3 w-14 text-center">Sr No.</th>
                    <th className="py-3 px-3 w-28">Date</th>
                    <th className="py-3 px-4 w-44">Clinic</th>
                    <th className="py-3 px-4">Narration (Case / Cash / Method)</th>
                    <th className="py-3 px-3 text-right w-28">Debit (PKR)</th>
                    <th className="py-3 px-3 text-right w-28">Credit (PKR)</th>
                    <th className="py-3 px-4 text-right w-36">Closing Balance</th>
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
                      <td className="py-2.5 px-4">
                        <span className="inline-block text-[10px] uppercase font-black px-2 py-0.5 rounded bg-amber-100 text-amber-800 mr-2 border border-amber-200">
                          Opening Balance
                        </span>
                        <span className="text-slate-600 not-italic">Balance brought forward</span>
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-500">-</td>
                      <td className="py-2.5 px-3 text-right text-slate-500">-</td>
                      <td className="py-2.5 px-4 text-right font-black font-mono text-slate-900 not-italic">
                        PKR {openingBalance.toLocaleString()}
                      </td>
                    </tr>
                  )}

                  {ledgerItems.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-slate-500">
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
                    ledgerItems.map((entry, idx) => {
                      const details = getNarrationDetails(entry);
                      const Icon = details.icon;

                      return (
                        <tr 
                          key={entry.id || idx}
                          className="hover:bg-slate-50/80 transition-colors"
                        >
                          {/* Sr No. */}
                          <td className="py-3 px-3 text-center font-mono text-[11px] text-slate-500 font-semibold">
                            {idx + 1}
                          </td>

                          {/* Date */}
                          <td className="py-3 px-3 text-slate-700 whitespace-nowrap font-medium text-[11px]">
                            {entry.date ? entry.date.slice(0, 10) : '-'}
                          </td>

                          {/* Clinic */}
                          <td className="py-3 px-4">
                            <span className="font-bold text-slate-900 block truncate max-w-[180px]" title={entry.lab_name}>
                              {entry.lab_name}
                            </span>
                          </td>

                          {/* Narration whether its a case entry or cash/payment */}
                          <td className="py-3 px-4">
                            <div className="space-y-1">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className={`inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded border ${details.typeBadgeBg}`}>
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
                            </div>
                          </td>

                          {/* Debit */}
                          <td className="py-3 px-3 text-right whitespace-nowrap">
                            {entry.debit > 0 ? (
                              <span className="font-bold text-blue-900 font-mono">
                                PKR {entry.debit.toLocaleString()}
                              </span>
                            ) : (
                              <span className="text-slate-400 font-mono">-</span>
                            )}
                          </td>

                          {/* Credit */}
                          <td className="py-3 px-3 text-right whitespace-nowrap">
                            {entry.credit > 0 ? (
                              <span className="font-bold text-emerald-700 font-mono">
                                PKR {entry.credit.toLocaleString()}
                              </span>
                            ) : (
                              <span className="text-slate-400 font-mono">-</span>
                            )}
                          </td>

                          {/* Closing Balance */}
                          <td className="py-3 px-4 text-right whitespace-nowrap font-mono font-black text-slate-900">
                            <span className={entry.closing_balance > 0 ? 'text-slate-900' : entry.closing_balance < 0 ? 'text-emerald-700' : 'text-slate-500'}>
                              PKR {entry.closing_balance.toLocaleString()}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>

                {/* Grand Total Footer Row */}
                {ledgerItems.length > 0 && (
                  <tfoot>
                    <tr className="bg-slate-100/90 border-t-2 border-slate-300 font-bold text-xs text-slate-900">
                      <td colSpan={4} className="py-3.5 px-4 text-right uppercase tracking-wider font-black">
                        Total Period Activity & Net Closing Balance:
                      </td>
                      <td className="py-3.5 px-3 text-right font-black font-mono text-blue-900 whitespace-nowrap">
                        PKR {totalDebits.toLocaleString()}
                      </td>
                      <td className="py-3.5 px-3 text-right font-black font-mono text-emerald-700 whitespace-nowrap">
                        PKR {totalCredits.toLocaleString()}
                      </td>
                      <td className="py-3.5 px-4 text-right font-black font-mono text-slate-950 whitespace-nowrap text-sm bg-slate-200/60">
                        PKR {closingBalance.toLocaleString()} {closingBalance > 0 ? 'Dr' : closingBalance < 0 ? 'Cr' : ''}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
