import React, { useState, useMemo } from 'react';
import { ACCOUNT_CODES, formatPKR, invoiceBalanceDue } from '../../services/financeDomain';
import { useApp } from '../../context/AppContext';
import { can } from '../../services/permissions';
import { LedgerEntry } from '../../types';
import { DatePickerRange, todayISO } from '../common/DatePickerRange';
import { formatDoctorName } from '../../utils/doctorName';
import { ClinicPicker } from '../common/ui/ClinicPicker';
import { 
  Eye, 
  RotateCcw, 
  DollarSign,
  AlertCircle,
  X,
  ArrowUpRight,
  ArrowDownLeft,
  FileDown,
  FileText,
  CreditCard,
  Banknote,
  Receipt,
  FileSpreadsheet,
  Building2
} from 'lucide-react';
import { buildLedgerPdf, downloadPdf } from '../../lib/pdf';
import { caseDetailLines, ledgerPrintDescription, findCaseForEntry } from '../../services/ledgerCaseDetail';
;
import { CaseDetailModal } from '../cases/CaseDetailModal';
import { DataTable } from '../common/ui';
import { DentalCase } from '../../types';

interface GeneralLedgerViewProps {
  /**
   * Pin the ledger to ONE clinic and hide the picker.
   *
   * Set when the ledger is embedded in the clinic detail modal, where the clinic
   * is already the subject — offering a picker there would let the operator read
   * a different clinic's statement inside one clinic's page, which is the kind
   * of confusion that turns into a wrong statement being sent to a clinic.
   *
   * Omitted on the Analytics & Reports tab, where picking a clinic is the job.
   */
  lockedClinicId?: string;
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

/* What went wrong, when something did. There is deliberately NO 'saved' state:
   the file chooser is its own confirmation — the operator picked the location,
   so telling them afterwards that it saved is noise sitting on top of the thing
   they just acknowledged. Errors and the missing-clinic prompt stay, because
   those are the cases where the operator would otherwise be left guessing. */
type ExportNotice = { kind: 'error' | 'warn'; text: string };

/* One wording for both buttons, so "nothing happened" is never ambiguous. */
const NEEDS_CLINIC: ExportNotice = {
  kind: 'warn',
  text: 'Choose a clinic first — the ledger statement is prepared per clinic.',
};

export const GeneralLedgerView: React.FC<GeneralLedgerViewProps> = ({ lockedClinicId }) => {
  const { labs, getLedgerEntries, brandingSettings, cases, invoices, user } = useApp();

  // Case drill-down state: which case's record is open from a ledger row.
  const [selectedCaseForModal, setSelectedCaseForModalLocal] = useState<DentalCase | null>(null);

  // Clinic selection: starts empty - the user must actively pick a clinic;
  // there is no consolidated "all clinics" mode. When embedded in the clinic
  // detail modal the clinic is already known, so it starts locked to that one.
  const [pickedClinicId, setPickedClinicId] = useState<string>('');
  const selectedClinicId = lockedClinicId ?? pickedClinicId;

  // Case/Job filter — searches case numbers, invoice numbers, patient names.
  const [caseFilter] = useState<string>('');

  // Date filters
  // Ledger window defaults to TODAY (like the other billing tabs): older
  // entries are reached with the date picker or the 'All Time' preset.
  const [startDate, setStartDate] = useState<string>(() => todayISO());
  const [endDate, setEndDate] = useState<string>(() => todayISO());

  // Preview state: hidden until the user clicks Preview.
  const [isPreviewActive, setIsPreviewActive] = useState<boolean>(false);

  /* Outcome of the last Export/Print press, shown on the page. */
  const [exportNotice, setExportNotice] = useState<ExportNotice | null>(null);

// Selected clinic object
  const selectedClinic = useMemo(() => {
    if (selectedClinicId === 'all') return null;
    return labs.find((l) => l.id === selectedClinicId) || null;
  }, [labs, selectedClinicId]);

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
  const { openingBalance, ledgerItems } = useMemo(() => {
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
      formatDoctorName(e.doctor_name, '').toLowerCase().includes(q)
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

  /* The "Balance brought forward" line is a statement row, not a transaction.
     DataTable has no slot above the first data row, so it travels as a
     synthetic first row and each column branches on `kind`. It is only added
     when there are entries to show: DataTable's empty state replaces the
     whole table, so a lone opening line would suppress the "No ledger
     entries found" message — and that message is the whole point of the
     empty case. The closing-balance bar below the table still carries the
     balance for it. */
  type LedgerRow =
    | { kind: 'opening' }
    | { kind: 'entry'; idx: number; entry: (typeof caseScope.items)[number] };

  const ledgerRows: LedgerRow[] = useMemo(() => {
    const rows: LedgerRow[] = visibleLedgerItems.map((entry, idx) => ({ kind: 'entry', entry, idx }));
    if (visibleLedgerItems.length > 0 && (openingBalance !== 0 || startDate)) {
      rows.unshift({ kind: 'opening' });
    }
    return rows;
  }, [visibleLedgerItems, openingBalance, startDate]);

  // Helper to format narration and determine entry category
  /**
   * A Paid / Partial / Unpaid badge for an invoice ledger row, or null for
   * every other entry type.
   *
   * Derived from `invoiceBalanceDue`, the same number the invoice table and the
   * printed invoice use, so the three surfaces cannot disagree - including after
   * a credit note, where the stored `payment_status` is the one that drifts.
   *
   * Nothing renders for payment rows: a payment IS the act of settling, so
   * labelling it "Paid" would be circular.
   */
  const settlementBadge = (entry: LedgerEntry) => {
    if (entry.entry_type !== 'invoice') return null;
    // `reference_id` carries the source document's id (the invoice id for an
    // invoice row); `reference_number` is its human reference (INV-0056).
    const inv = invoices.find(
      (i) => i.id === entry.reference_id || i.invoice_number === entry.reference_number,
    );
    // An invoice row whose invoice is no longer in the store cannot be judged.
    // Saying "Unpaid" would be a guess dressed as a fact.
    if (!inv) return null;

    const balance = invoiceBalanceDue(inv);
    const partlyPaid = (inv.amount_paid || 0) > 0;
    const label = balance <= 0 ? 'Paid' : partlyPaid ? 'Partial' : 'Unpaid';
    const tone =
      balance <= 0
        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
        : partlyPaid
          ? 'bg-amber-50 text-amber-700 border-amber-200'
          : 'bg-rose-50 text-rose-700 border-rose-200';
    const title =
      balance <= 0
        ? `Settled in full${(inv.credit_notes_total || 0) > 0 ? ' (net of credit notes)' : ''}`
        : `Outstanding ${formatPKR(balance)}`;

    return (
      <span
        className={`inline-flex items-center text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${tone}`}
        title={title}
      >
        {label}
      </span>
    );
  };

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
        subText: detail.length ? undefined : (entry.doctor_name ? `Doctor: ${formatDoctorName(entry.doctor_name)}` : undefined),
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
        subText: entry.doctor_name ? `Doctor: ${formatDoctorName(entry.doctor_name)}` : undefined,
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
        typeLabel: 'Credit',
        typeBadgeBg: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        icon: ArrowDownLeft,
        narration: `Credit #${entry.reference_number || ''} • ${entry.description || 'Adjustment / Discount'}`,
        subText: entry.notes,
        caseDetail: []
      };
    }

    if (entry.entry_type === 'debit_adjustment') {
      return {
        typeLabel: 'Debit',
        typeBadgeBg: 'bg-rose-50 text-rose-700 border-rose-200',
        icon: ArrowUpRight,
        narration: `Debit #${entry.reference_number || ''} • ${entry.description || 'Surcharge'}`,
        subText: entry.notes,
        caseDetail: []
      };
    }

    if (entry.entry_type === 'refund') {
      return {
        typeLabel: 'Refund',
        typeBadgeBg: 'bg-amber-50 text-amber-700 border-amber-200',
        icon: RotateCcw,
        narration: `Refund #${entry.reference_number || ''} • ${entry.description || 'Refund to clinic'}`,
        subText: entry.notes,
        caseDetail: []
      };
    }

    if (entry.entry_type === 'write_off') {
      return {
        typeLabel: 'Write Off',
        typeBadgeBg: 'bg-slate-100 text-slate-600 border-slate-200',
        icon: RotateCcw,
        narration: `Write Off #${entry.reference_number || ''} • ${entry.description || 'Written off'}`,
        subText: entry.notes,
        caseDetail: []
      };
    }

    if (entry.entry_type === 'opening_balance') {
      const isCredit = (entry.credit || 0) > 0 && (entry.debit || 0) === 0;
      return {
        typeLabel: isCredit ? 'Opening Credit' : 'Opening Balance',
        typeBadgeBg: isCredit ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200',
        icon: isCredit ? ArrowDownLeft : ArrowUpRight,
        narration: `${entry.description || 'Opening balance'} #${entry.reference_number || ''}`,
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

/* Builds the statement document. BOTH output buttons go through here, so
     "Print" and "Export PDF" cannot produce two different documents. They used
     to: one ran the PDF generator, the other printed the on-screen HTML through
     the browser's dialog, so "Print" was never the file the operator had been
     exporting. Same rows, same totals, same page breaks, same bytes. */
  const buildStatement = () => {
    const clinicLabel = selectedClinic!.name;
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
          /* The compact ledger-print line. It replaces the old
             `${typeLabel} - ${ref} ${description} - ${caseDetailText(c)}`,
             which repeated the Date column, the CASE/JOB column and the
             product name three times over and wrapped to four lines. */
          narration: ledgerPrintDescription(c, details.narration),
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
      },
    );
    const fileName = `Ledger_${clinicLabel.replace(/\s+/g, '_')}${caseFilter.trim() ? `_${caseFilter.trim().replace(/\s+/g, '_')}` : ''}_${todayISO()}.pdf`;
    return { fileName, pdf: result.pdf };
  };

  /* Renders the statement and puts it wherever the operator chooses.
     `label` only shapes the file-type description in the chooser, so the
     window reads correctly. */
  const saveStatement = async (label: string) => {
    /* Used to be a bare `return`. With the button also `disabled`, pressing
       Export PDF with no clinic chosen produced no file, no message and no
       visible change at all — indistinguishable from a broken export. */
    if (!selectedClinic) {
      setExportNotice(NEEDS_CLINIC);
      return;
    }
    setExportNotice(null);
    try {
      const { fileName, pdf } = buildStatement();
      const outcome = await downloadPdf(fileName, pdf, label);

      /* Only the unhappy paths are announced. A successful save is confirmed by
         the chooser the operator just dismissed — a banner repeating it was
         clutter the operator asked to lose. Cancelling says nothing, which is
         right: they chose that. */
      if (outcome.status === 'error') {
        setExportNotice({
          kind: 'error',
          text: `Could not save the PDF: ${outcome.message}`,
        });
      }
    } catch (e) {
      console.error('Error building the ledger PDF:', e);
      setExportNotice({
        kind: 'error',
        text: `Could not export the ledger: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  };

  const handleExportPDF = () => saveStatement('PDF document');

  if (!can(user, 'ledger:view')) {
    return (
      <div className="p-6 text-center text-slate-500 text-sm">
        <p className="font-semibold text-slate-700 mb-1">Insufficient permission</p>
        <p className="text-xs">The general ledger is available to Super Admin and Audit Checker roles only.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 print-page">
      {/* SEARCH-FIRST FILTER ROW: clinic picker → date picker → preview */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-2xs space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center gap-3">
{/* Clinic picker — the shared searchable dropdown. It replaced a local copy
              that had drifted from the batch print dialog's; one component now
              serves both, so the two cannot disagree on how a clinic is found.
              Hidden when the ledger is embedded in a clinic's own page. */}
          {!lockedClinicId && (
            <ClinicPicker
              clinics={labs}
              value={selectedClinicId || null}
              onChange={setPickedClinicId}
              tone="blue"
              compact
              className="flex-1 min-w-[220px]"
            />
          )}

          {/* The Case / Job / Invoice # box is gone.

              It was a second, narrower search sitting beside the date picker,
              and it had become the thing an operator reached for expecting the
              main search bar — which is the wide one above, already covering
              case number, invoice number, doctor, patient, clinic, amounts and
              receipts. Two search boxes with different reach on one screen is a
              coin toss every time.

              `caseFilter` remains in state and still scopes the query; with no
              input it is simply always empty, i.e. the ledger shows every case
              for the chosen clinic and period. Left wired rather than ripped
              out because it participates in the export's `caseFilterLabel`. */}

          {/* Shared date picker */}
          <div className="shrink-0">
            <DatePickerRange
              from={startDate}
              to={endDate}
              onChange={(f, t) => {
                setStartDate(f);
                setEndDate(t);
              }}
            />
          </div>

          {/* PDF Export Button — real vector document, not a screenshot

              NOT disabled without a clinic. It was, and a disabled control
              cannot be clicked and cannot explain itself: the operator pressed
              Export PDF, nothing happened, and the only clue was a tooltip they
              have to already be hovering to see. It now always responds, and
              says what it needs. */}
          <button
            type="button"
            onClick={handleExportPDF}
            title="Download ledger statement as PDF (selectable text, real pages)"
            aria-label="Download ledger statement as PDF"
            className="shrink-0 py-2.5 px-4 ds-glass-pill font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer"
          >
            <FileDown className="w-4 h-4" />
            <span>Export PDF</span>
          </button>

          {/* The Print button was removed here at the operator's request. The
              preview opened below is the document, and the browser's own print
              (Ctrl+P) prints it; a second button that opened the same dialog was
              one more way to reach the same place. */}

          {/* Failures only.

              There was a green "saved" banner naming the file. It was added
              because, before the chooser existed, a save happened invisibly and
              the operator had no way to know where it went. Now the OS chooser
              IS that confirmation — they pick the location and dismiss the
              window. Repeating it on the page afterwards is noise on top of the
              thing they just acknowledged, and it was removed on request.
              Errors and the missing-clinic prompt stay: those are the cases
              where the operator would otherwise be left guessing. */}
          {exportNotice && (
            <div
              role="status"
              className={`lg:col-span-12 flex items-start gap-2 rounded-xl border px-3 py-2 text-xs ${
                exportNotice.kind === 'error'
                  ? 'bg-rose-50 border-rose-200 text-ink-danger'
                  : 'bg-amber-50 border-amber-200 text-amber-800'
              }`}
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span className="min-w-0 break-words">{exportNotice.text}</span>
              <button
                type="button"
                onClick={() => setExportNotice(null)}
                className="ml-auto shrink-0 opacity-60 hover:opacity-100 cursor-pointer"
                aria-label="Dismiss export message"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Preview Button */}
          <button
            type="button"
            onClick={() => setIsPreviewActive(true)}
            className="shrink-0 py-2.5 px-4 ds-glass-pill font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer"
          >
            <Eye className="w-4 h-4" />
            <span>Preview</span>
          </button>
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
              <p className="text-xs text-ink-muted mt-1">Pick a clinic above to load its transactions.</p>
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
                    {selectedClinic.doctor_name && <span>Doctor: {formatDoctorName(selectedClinic.doctor_name)}</span>}
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

            {/* DataTable owns the <thead>, the ds-th header row and the scroll
                wrapper; the card above stays put. The <tfoot> totals row and
                the "show more" bar travel through `footer` — the tfoot keeps
                its own one-row table so its eight cells still line up with the
                columns above. */}
            <DataTable<LedgerRow>
              data={ledgerRows}
              rowKey={(row) => (row.kind === 'opening' ? '__opening' : row.entry.id || `row-${row.idx}`)}
              rowClassName={(row) => (row.kind === 'opening' ? 'bg-amber-50/40 text-slate-700 font-semibold italic' : '')}
              emptyState={
                <div className="py-12 text-center text-slate-500">
                  <div className="w-12 h-12 mx-auto rounded-full bg-slate-100 text-ink-body flex items-center justify-center mb-3">
                    <FileSpreadsheet className="w-6 h-6" />
                  </div>
                  <p className="text-sm font-bold text-slate-800">No ledger entries found</p>
                  <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                    There are no recorded case invoices or payments for the selected clinic and date filter. Try selecting 'All Time' or choosing another clinic.
                  </p>
                </div>
              }
              tfoot={
                /* Period activity totals only — the closing balance is the
                    final line of the statement, below everything else.

                    This was passed through `footer` wrapped in its own
                    one-row `<table>`, because `footer` renders AFTER `</table>`
                    and a bare `<tfoot>` out there is invalid markup. That
                    second table laid its columns out independently of the
                    columns above, so the totals drifted out of alignment. The
                    `tfoot` prop puts it back inside the real table. */
                caseScope.items.length > 0 ? (
                  <tr className="bg-slate-100/90 border-t-2 border-slate-300 font-bold text-xs text-slate-900">
                    <td colSpan={5} className="py-3.5 px-4 text-right uppercase tracking-wider font-bold">
                      Total Period Activity:
                    </td>
                    <td className="py-3.5 px-3 text-right font-bold font-mono text-blue-900 whitespace-nowrap">
                      {formatPKR(caseScope.debitsSum)}
                    </td>
                    <td className="py-3.5 px-3 text-right font-bold font-mono text-emerald-700 whitespace-nowrap">
                      {formatPKR(caseScope.creditsSum)}
                    </td>
                    <td className="py-3.5 px-4 text-right text-ink-muted whitespace-nowrap">—</td>
                  </tr>
                ) : null
              }
              footer={
                <>
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
                </>
              }
              columns={[
                {
                  header: 'Sr No.',
                  align: 'center',
                  className: 'w-14 py-2 px-3 font-mono text-[11px] text-slate-500 font-semibold',
                  render: (row) => (row.kind === 'opening' ? <span>-</span> : row.idx + 1),
                },
                {
                  header: 'Date',
                  className: 'w-28 py-2.5 px-3 font-mono text-[11px]',
                  render: (row) =>
                    row.kind === 'opening' ? (
                      <span className="text-slate-600">{startDate || '-'}</span>
                    ) : (
                      <span className="text-slate-700 whitespace-nowrap font-medium">
                        {row.entry.date ? row.entry.date.slice(0, 10) : '-'}
                      </span>
                    ),
                },
                {
                  header: 'Clinic',
                  className: 'w-40 py-2.5 px-3 font-bold',
                  render: (row) =>
                    row.kind === 'opening' ? (
                      <span className="text-slate-800">
                        {selectedClinic ? selectedClinic.name : 'Consolidated Clinics'}
                      </span>
                    ) : (
                      <span className="font-bold text-slate-900 block truncate max-w-[160px]" title={row.entry.lab_name}>
                        {row.entry.lab_name}
                      </span>
                    ),
                },
                {
                  header: 'Case / Job',
                  className: 'w-32',
                  render: (row) => {
                    if (row.kind === 'opening') return <span className="text-ink-muted">—</span>;
                    const entry = row.entry;
                    return entry.case_number ? (
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
                    );
                  },
                },
                {
                  header: 'Narration (Type / Reference)',
                  render: (row) => {
                    if (row.kind === 'opening') {
                      return (
                        <>
                          <span className="inline-block text-[11px] uppercase font-bold px-2 py-0.5 rounded bg-amber-100 text-amber-800 mr-2 border border-amber-200">
                            Opening Balance
                          </span>
                          <span className="text-slate-600 not-italic">Balance brought forward</span>
                        </>
                      );
                    }
                    const details = getNarrationDetails(row.entry);
                    const Icon = details.icon;

                    return (
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className={`inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${details.typeBadgeBg}`}>
                            <Icon className="w-3 h-3" />
                            {details.typeLabel}
                          </span>
                          {/* Settlement of the INVOICE this row bills.
                              A ledger row says what was DEBITED, never whether it
                              was later settled, so an operator reconciling a
                              clinic could not tell from this pane whether the
                              invoice they were looking at was still owed. The
                              badge is derived from the balance, not from
                              `payment_status`, which disagrees after a credit
                              note. Nothing renders for payment rows - a payment
                              is the act of settling, so labelling it "paid"
                              would be circular. */}
                          {settlementBadge(row.entry)}
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
                                <dt className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-ink-muted">
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
                    );
                  },
                },
                {
                  header: 'Debit (PKR)',
                  align: 'right',
                  className: 'w-28',
                  render: (row) =>
                    row.kind === 'opening' ? (
                      <span>-</span>
                    ) : (
                      row.entry.debit > 0 ? (
                        <span className="font-bold text-blue-900 font-mono">
                          {formatPKR(row.entry.debit)}
                        </span>
                      ) : (
                        <span className="text-ink-muted font-mono">-</span>
                      )
                    ),
                },
                {
                  header: 'Credit (PKR)',
                  align: 'right',
                  className: 'w-28',
                  render: (row) =>
                    row.kind === 'opening' ? (
                      <span>-</span>
                    ) : (
                      row.entry.credit > 0 ? (
                        <span className="font-bold text-emerald-700 font-mono">
                          {formatPKR(row.entry.credit)}
                        </span>
                      ) : (
                        <span className="text-ink-muted font-mono">-</span>
                      )
                    ),
                },
                {
                  header: 'Closing Balance',
                  align: 'right',
                  className: 'w-36 py-2.5 px-3 whitespace-nowrap font-mono font-bold text-slate-900',
                  render: (row) =>
                    row.kind === 'opening' ? (
                      <span className="not-italic">{formatPKR(openingBalance)}</span>
                    ) : (
                      <span className={row.entry.closing_balance > 0 ? 'text-slate-900' : row.entry.closing_balance < 0 ? 'text-emerald-700' : 'text-slate-500'}>
                        {formatPKR(row.entry.closing_balance)}
                      </span>
                    ),
                },
              ]}
            />

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
                {formatPKR(caseScope.closing)} {caseScope.closing > 0 ? 'Dr' : caseScope.closing < 0 ? 'Cr' : ''}
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
