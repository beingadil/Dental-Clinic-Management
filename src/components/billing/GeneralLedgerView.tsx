import React, { useState, useMemo } from 'react';
import { ACCOUNT_CODES, formatPKR } from '../../services/financeDomain';
import { useApp } from '../../context/AppContext';
import { can, canPost } from '../../services/permissions';
import { DatePickerRange, todayISO } from '../common/DatePickerRange';
import { formatDoctorName } from '../../utils/doctorName';
import { formatDate } from '../../utils/dateUtils';
import { ClinicPicker } from '../common/ui/ClinicPicker';
import { 
  Eye, 
  AlertCircle,
  X,
  FileDown,
  FileSpreadsheet,
  Building2,
  ChevronDown,
  ChevronUp,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { downloadPdf } from '../../lib/pdf';
import { buildLedgerReportPdfAsync } from '../../lib/ledgerPdfAsync';
import { attributeAdjustmentsToInvoices } from '../../services/adjustmentAttribution';
import { buildLedgerReport, type LedgerReportRow } from '../../services/ledgerReport';
import { findLedgerIssues } from '../../services/ledgerQuality';
import { buildLedgerCsvRows } from '../../services/ledgerCsv';
import { saveCSV } from '../../services/csvExport';
import { buildLedgerXlsx, saveLedgerXlsx } from '../../services/ledgerXlsx';
import { settlementAsOf } from '../../services/ledgerSettlement';
import { CaseDetailModal } from '../cases/CaseDetailModal';
import { InvoiceDetailDrawer } from './InvoiceDetailDrawer';
import { receiptNumberOf } from '../../services/ledgerDomain';
import { InvoiceStatementModal } from './InvoiceStatementModal';
import { EditAdjustmentModal } from './EditAdjustmentModal';
import { RecordTransactionModal } from './RecordTransactionModal';
import EditPaymentModal from './EditPaymentModal';
import { PaymentReceiptModal } from './PaymentReceiptModal';
import { ConfirmDialog, DataTable } from '../common/ui';
import { DentalCase, PaymentRecord, Invoice, AccountAdjustment } from '../../types';

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
  const { labs, getLedgerEntries, brandingSettings, cases, invoices, user, accountAdjustments, updatePaymentV2, deletePaymentV2, deleteInvoice, updateAccountAdjustment, deleteAccountAdjustment } = useApp();

  // Case drill-down state: which case's record is open from a ledger row.
  const [selectedCaseForModal, setSelectedCaseForModalLocal] = useState<DentalCase | null>(null);
  /* The voucher this row carries, when it is one. Every payment in the books
     is reachable from its row: an operator reconciling a clinic can read,
     correct or delete the payment in place instead of going hunting for the
     invoice it was posted against. */
  const [voucherToEdit, setVoucherToEdit] = useState<{ payment: PaymentRecord; invoice?: Invoice } | null>(null);
  const [voucherToDelete, setVoucherToDelete] = useState<PaymentRecord | null>(null);
  /* Clicking a payment row opens its receipt — the adjusted invoices behind the
     one voucher, same as the billing register. The voucher chip stays the
     edit affordance, so reading and correcting stay separate intents. */
  const [receiptPayment, setReceiptPayment] = useState<PaymentRecord | null>(null);

  /* Invoice drill-down from a ledger row: opening the invoice document lets
     the operator void it (delete) or correct its payments/adjustments. */
  const [selectedDrawerInvoice, setSelectedDrawerInvoice] = useState<Invoice | null>(null);
  const [printModalInvoice, setPrintModalInvoice] = useState<Invoice | null>(null);
  const [voidTarget, setVoidTarget] = useState<Invoice | null>(null);
  const [adjustmentToEdit, setAdjustmentToEdit] = useState<AccountAdjustment | null>(null);
  const [adjustmentToDelete, setAdjustmentToDelete] = useState<AccountAdjustment | null>(null);
  const [isUnifiedRecordModalOpen, setIsUnifiedRecordModalOpen] = useState<boolean>(false);
  const [unifiedModalInvoiceId, setUnifiedModalInvoiceId] = useState<string | undefined>(undefined);
  const [unifiedModalLabId, setUnifiedModalLabId] = useState<string | undefined>(undefined);

  /* The row's payment voucher, when the row is one. Regular payments and the
     0/0 memos that apply advance credit are both editable vouchers; the
     reference_id on the ledger entry is the embedded payment's id. */
  const findVoucher = (entry: LedgerReportRow): { payment: PaymentRecord; invoice?: Invoice } | null => {
    if (entry.type !== 'payment' && entry.type !== 'advance_allocation') return null;
    for (const inv of invoices || []) {
      const hit = (inv.payments || []).find(
        (p) => p.id === entry.referenceId || p.payment_number === entry.voucherNumber,
      );
      if (hit) return { payment: hit, invoice: inv };
    }
    return null;
  };

  /* The voucher a row carries — one row per posting now, so a payment row maps
     straight to its payment record (Edit / Delete act on the whole voucher). */
  const voucherForRow = (entry: LedgerReportRow): { payment: PaymentRecord; invoice?: Invoice } | null =>
    findVoucher(entry);

  /** The invoice a posting belongs to: the row itself for an invoice, or the
      invoice a receipt/adjustment relates to. */
  const invoiceForRow = (entry: LedgerReportRow): Invoice | undefined => {
    const byNumber = entry.relatedInvoiceNumber || (entry.type === 'invoice' ? entry.voucherNumber : '');
    return (invoices || []).find(
      (i) => i.id === entry.referenceId || (!!byNumber && i.invoice_number === byNumber),
    );
  };

  /** Debit adjustments, credit notes and refunds are their own vouchers and
      open the adjustment editor from the ledger, exactly like an invoice or a
      receipt opens its own document. */
  const adjustmentForRow = (entry: LedgerReportRow): AccountAdjustment | undefined => {
    if (!['credit_note', 'debit_adjustment', 'refund'].includes(entry.type)) return undefined;
    return (accountAdjustments || []).find(
      (a) => a.id === entry.referenceId || a.adjustment_number === entry.voucherNumber,
    );
  };

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
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isExportingCsv, setIsExportingCsv] = useState(false);
  const [isExportingXlsx, setIsExportingXlsx] = useState(false);
  const [qualityOpen, setQualityOpen] = useState(true);
  const [onlyIssues, setOnlyIssues] = useState(false);

  /* Outcome of the last Export/Print press, shown on the page. */
  const [exportNotice, setExportNotice] = useState<ExportNotice | null>(null);

/* Adjustments attributed to invoices, so the invoice drawer can show them. */
  const adjustmentsByInvoice = useMemo(
    () => (typeof attributeAdjustmentsToInvoices === 'function' ? attributeAdjustmentsToInvoices(invoices || [], accountAdjustments || []) : new Map()),
    [invoices, accountAdjustments],
  );

// Selected clinic object
  const selectedClinic = useMemo(() => {
    if (selectedClinicId === 'all') return null;
    return labs.find((l) => l.id === selectedClinicId) || null;
  }, [labs, selectedClinicId]);

  /* Payment voucher → its per-invoice allocations, so one receipt covering
     several cases shows each case with only its allocated amount (never the
     full voucher duplicated). Built from the invoices' own allocation records. */
  const paymentAllocations = useMemo(() => {
    const map = new Map<string, { invoiceNumber?: string; caseNumber?: string; amount: number }[]>();
    (invoices || []).forEach((inv) => {
      (inv.payments || []).forEach((p) => {
        if (!(p.allocations || []).length) return;
        const base = receiptNumberOf(p.payment_number || '');
        const cur = map.get(base) || [];
        for (const a of p.allocations || []) {
          const target = (invoices || []).find((i) => i.id === a.invoice_id || i.invoice_number === a.invoice_number);
          const key = `${a.invoice_number || ''}|${a.amount}`;
          if (cur.some((x) => `${x.invoiceNumber || ''}|${x.amount}` === key)) continue;
          cur.push({ invoiceNumber: a.invoice_number, caseNumber: target?.case_number, amount: a.amount });
        }
        map.set(base, cur);
      });
    });
    return map;
  }, [invoices]);

  const caseLookup = useMemo(() =>
    (cases || []).map((c) => ({
      case_number: c.case_number,
      case_id: c.id,
      patient_name: c.patient_name,
      doctor_name: c.doctor_name,
      case_type_name: c.case_type_name,
      selected_teeth: (c.selected_teeth || []).map(String),
      shade: c.shade,
      quantity: c.units_count,
      created_at: c.created_at,
      received_at: c.received_date ?? undefined,
      delivery_date: c.delivery_date,
    })), [cases]);

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

  /* Single source of truth for preview AND PDF: the normalized report engine.
     Opening balance = Σ(debit − credit) before the period; running balance =
     previous + debit − credit; closing = opening + debits − credits. All from
     actual postings — nothing re-derived from invoice totals. */
  const { rows: reportRows, summary } = useMemo(() => {
    if (!rawLedgerEntries.length) {
      return {
        rows: [] as LedgerReportRow[],
        summary: { openingBalance: 0, totalDebits: 0, totalCredits: 0, closingBalance: 0, transactionCount: 0 },
      };
    }
    return buildLedgerReport({
      entries: rawLedgerEntries,
      cases: caseLookup,
      invoices: (invoices || []).map((i) => ({
        id: i.id,
        invoice_number: i.invoice_number,
        case_number: i.case_number,
        case_id: i.case_id,
        patient_name: i.patient_name,
        case_type_name: i.case_type_name,
      })),
      paymentAllocations,
      periodStart: startDate || undefined,
      periodEnd: endDate || undefined,
      clinicId: selectedClinicId || undefined,
      caseNumber: caseFilter.trim() || undefined,
    });
  }, [rawLedgerEntries, caseLookup, invoices, paymentAllocations, startDate, endDate, selectedClinicId, caseFilter]);

  /* Data-quality exceptions are derived from the same rows the statement
     prints, so an issue cannot exist on screen but disappear from the PDF. */
  const qualityIssues = useMemo(
    () => findLedgerIssues(
      reportRows,
      invoices || [],
      summary.openingBalanceReview || [],
    ),
    [reportRows, invoices, summary.openingBalanceReview],
  );
  const issueRowIds = useMemo(
    () => new Set(qualityIssues.flatMap((issue) => (issue.rowId ? [issue.rowId] : []))),
    [qualityIssues],
  );

  /* Long ledgers stay fully available (so totals and exports never truncate),
     while `ledger-row-virtual` lets the browser skip layout/paint for rows
     outside the viewport. This is the browser-native form of row virtualization
     and keeps the real <table> semantics screen readers rely on. */
  const visibleLedgerItems = useMemo(
    () => (onlyIssues ? reportRows.filter((row) => issueRowIds.has(row.id)) : reportRows),
    [reportRows, onlyIssues, issueRowIds],
  );

  // Helper to format narration and determine entry category
  /**
   * A Paid / Partial / Unpaid badge for an invoice ledger row, or null for
   * every other entry type.
   *
   * The badge is as-of the row's business date, not today: a receipt posted in
   * November cannot make an October row claim the invoice was already settled.
   * Payments and attributed credit notes are replayed up to the row date; the
   * stored status is ignored because it drifts after adjustments.
   *
   * Nothing renders for payment rows: a payment IS the act of settling, so
   * labelling it "Paid" would be circular.
   */
  const settlementBadge = (entry: LedgerReportRow) => {
    if (entry.type !== 'invoice') return null;
    const inv = invoiceForRow(entry);
    if (!inv) return null;

    const settlement = settlementAsOf(inv, entry.date, adjustmentsByInvoice.get(inv.id) || []);
    const balance = settlement.balance;
    const label = settlement.status === 'paid' ? 'Paid' : settlement.status === 'partial' ? 'Partial' : 'Unpaid';
    const tone =
      balance <= 0
        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
        : settlement.status === 'partial'
          ? 'bg-amber-50 text-amber-700 border-amber-200'
          : 'bg-rose-50 text-rose-700 border-rose-200';
    const title =
      balance <= 0
        ? `Settled in full as of ${formatDate(entry.date)}${settlement.credited > 0 ? ' (net of credit notes)' : ''}`
        : `As of ${formatDate(entry.date)}: outstanding ${formatPKR(balance)}`;

    const paidOn = balance <= 0 ? settlement.paidOn : undefined;

    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <span
          className={`inline-flex items-center text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${tone}`}
          title={title}
        >
          {label}
        </span>
        {paidOn && (
          <span className="text-[10px] font-semibold text-emerald-700 whitespace-nowrap">
            Paid on {formatDate(paidOn)}
          </span>
        )}
      </span>
    );
  };

  /** Case facts shown in the compact detail box under an invoice row. */
  const caseDetailsFor = (entry: LedgerReportRow): { label: string; value: string }[] => {
    if (entry.type !== 'invoice') return [];
    const teeth = entry.teeth ? entry.teeth.split(',').map((t) => t.trim()).filter(Boolean) : [];
    const units = teeth.length || entry.units;
    return [
      entry.patientName ? { label: 'Patient', value: entry.patientName } : null,
      entry.procedure ? { label: 'Procedure', value: entry.procedure } : null,
      entry.teeth ? { label: 'Teeth', value: entry.teeth } : null,
      entry.shade ? { label: 'Shade', value: entry.shade } : null,
      entry.receivedDate ? { label: 'Received', value: formatDate(entry.receivedDate) } : null,
      entry.deliveryDate ? { label: 'Delivery', value: formatDate(entry.deliveryDate) } : null,
      units ? { label: 'Units', value: `${units} unit${units === 1 ? '' : 's'}` } : null,
    ].filter((v): v is { label: string; value: string } => !!v);
  };

  const statementMeta = () => {
    const clinicLabel = selectedClinic!.name;
    const periodLabel = startDate || endDate
      ? `${startDate || 'Beginning'} → ${endDate || 'Present'}`
      : 'All Time';
    return {
      clinicLabel,
      periodLabel,
      labName: brandingSettings?.lab_name || brandingSettings?.appName || 'Dental Lab',
      caseFilterLabel: caseFilter.trim() || undefined,
      accountName: ACCOUNT_CODES.ACCOUNTS_RECEIVABLE.name,
      accountCode: ACCOUNT_CODES.ACCOUNTS_RECEIVABLE.code,
      generatedOn: todayISO(),
    };
  };

  const ledgerFileBase = (clinicLabel: string) =>
    `Ledger_${clinicLabel.replace(/\s+/g, '_')}${caseFilter.trim() ? `_${caseFilter.trim().replace(/\s+/g, '_')}` : ''}_${todayISO()}`;

  const buildStatement = async () => {
    const meta = statementMeta();
    const result = await buildLedgerReportPdfAsync(reportRows, summary, meta);
    return { fileName: `${ledgerFileBase(meta.clinicLabel)}.pdf`, pdf: result.pdf };
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
    if (isExportingPdf) return;
    setExportNotice(null);
    setIsExportingPdf(true);
    try {
      const { fileName, pdf } = await buildStatement();
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
    } finally {
      setIsExportingPdf(false);
    }
  };

  const handleExportPDF = () => saveStatement('PDF document');

  const settlementLabels = () => {
    const settlementByRow: Record<string, string> = {};
    for (const row of reportRows) {
      if (row.type !== 'invoice') continue;
      const inv = invoiceForRow(row);
      if (!inv) continue;
      const settlement = settlementAsOf(inv, row.date, adjustmentsByInvoice.get(inv.id) || []);
      settlementByRow[row.id] = settlement.status === 'paid'
        ? `Paid${settlement.paidOn ? ` on ${settlement.paidOn}` : ''}`
        : settlement.status === 'partial'
          ? `Partial - ${formatPKR(settlement.balance)} outstanding`
          : `Unpaid - ${formatPKR(settlement.balance)} outstanding`;
    }
    return settlementByRow;
  };

  const exportMeta = () => {
    const meta = statementMeta();
    return {
      clinicLabel: meta.clinicLabel,
      periodLabel: meta.periodLabel,
      accountLabel: `${meta.accountCode} · ${meta.accountName}`,
      generatedOn: meta.generatedOn,
    };
  };

  const handleExportCSV = async () => {
    if (!selectedClinic) {
      setExportNotice(NEEDS_CLINIC);
      return;
    }
    if (isExportingCsv) return;
    setExportNotice(null);
    setIsExportingCsv(true);
    try {
      const meta = exportMeta();
      const rows = buildLedgerCsvRows(reportRows, summary, { ...meta, settlementByRow: settlementLabels() });
      const outcome = await saveCSV(`${ledgerFileBase(meta.clinicLabel)}.csv`, rows);
      if (outcome.status === 'error') {
        setExportNotice({ kind: 'error', text: `Could not save the CSV: ${outcome.message}` });
      }
    } catch (e) {
      console.error('Error building the ledger CSV:', e);
      setExportNotice({
        kind: 'error',
        text: `Could not export the ledger CSV: ${e instanceof Error ? e.message : String(e)}`,
      });
    } finally {
      setIsExportingCsv(false);
    }
  };

  const handleExportXlsx = async () => {
    if (!selectedClinic) {
      setExportNotice(NEEDS_CLINIC);
      return;
    }
    if (isExportingXlsx) return;
    setExportNotice(null);
    setIsExportingXlsx(true);
    try {
      const meta = exportMeta();
      const bytes = buildLedgerXlsx(reportRows, summary, { ...meta, settlementByRow: settlementLabels() });
      const outcome = await saveLedgerXlsx(`${ledgerFileBase(meta.clinicLabel)}.xlsx`, bytes);
      if (outcome.status === 'error') {
        setExportNotice({ kind: 'error', text: `Could not save the Excel workbook: ${outcome.message}` });
      }
    } catch (e) {
      console.error('Error building the ledger workbook:', e);
      setExportNotice({
        kind: 'error',
        text: `Could not export the ledger workbook: ${e instanceof Error ? e.message : String(e)}`,
      });
    } finally {
      setIsExportingXlsx(false);
    }
  };

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
            aria-busy={isExportingPdf}
            className="shrink-0 py-2.5 px-4 ds-glass-pill font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer"
          >
            <FileDown className="w-4 h-4" />
            <span>{isExportingPdf ? 'Building PDF…' : 'Export PDF'}</span>
          </button>

          <button
            type="button"
            onClick={handleExportCSV}
            title="Download the same ledger rows as an Excel-ready CSV"
            aria-label="Download ledger as CSV for Excel"
            aria-busy={isExportingCsv}
            className="shrink-0 py-2.5 px-4 ds-glass-pill font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>{isExportingCsv ? 'Building CSV…' : 'Export CSV'}</span>
          </button>

          <button
            type="button"
            onClick={handleExportXlsx}
            title="Download a formatted Excel workbook with Ledger and Summary sheets"
            aria-label="Download ledger as an Excel workbook"
            aria-busy={isExportingXlsx}
            className="shrink-0 py-2.5 px-4 ds-glass-pill font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>{isExportingXlsx ? 'Building Excel…' : 'Export Excel'}</span>
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
            <div className="ds-glass-card p-3.5 rounded-xl flex flex-wrap items-center justify-between gap-3 text-xs">
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
                  {reportRows.length} entries
                </span>
              </div>
              <div className="text-[11px] text-slate-500">
                Oldest first · ordered by posting time, closing balance on the last line
              </div>
            </div>

            <div className="border-b border-slate-200">
              <button
                type="button"
                onClick={() => setQualityOpen((open) => !open)}
                aria-expanded={qualityOpen}
                className="flex w-full items-center gap-2 bg-slate-50/70 px-4 py-3 text-left hover:bg-slate-100/70 transition-colors cursor-pointer"
              >
                {qualityIssues.length > 0 ? (
                  <ShieldAlert className="h-4 w-4 shrink-0 text-amber-600" />
                ) : (
                  <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600" />
                )}
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-700">Data quality</span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${qualityIssues.length ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
                  {qualityIssues.length ? `${qualityIssues.length} exception${qualityIssues.length === 1 ? '' : 's'}` : 'No exceptions'}
                </span>
                {qualityOpen ? <ChevronUp className="ml-auto h-4 w-4 text-slate-500" /> : <ChevronDown className="ml-auto h-4 w-4 text-slate-500" />}
              </button>
              {qualityOpen && qualityIssues.length > 0 && (
                <div className="border-t border-slate-100 bg-white px-4 py-3">
                  <ul className="space-y-2">
                    {qualityIssues.slice(0, 8).map((issue) => (
                      <li key={issue.id} className="flex items-start gap-2 text-[11px] leading-5">
                        <span className={`mt-0.5 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${issue.severity === 'error' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-800'}`}>
                          {issue.severity === 'error' ? 'Error' : 'Check'}
                        </span>
                        <span className="min-w-0">
                          <span className="font-bold text-slate-800">{issue.title}</span>
                          <span className="text-slate-500"> · {issue.voucherNumber}{issue.date ? ` · ${issue.date}` : ''}</span>
                          <span className="block text-slate-600">{issue.detail}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                  {qualityIssues.length > 8 && (
                    <p className="mt-2 text-[10px] text-slate-500">+ {qualityIssues.length - 8} more exceptions — the CSV export lists every row.</p>
                  )}
                  <button
                    type="button"
                    onClick={() => setOnlyIssues((on) => !on)}
                    className="mt-3 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-[10px] font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
                  >
                    {onlyIssues ? 'Show every entry' : 'Show only exception rows'}
                  </button>
                </div>
              )}
            </div>

            {/* DataTable owns the <thead>, the ds-th header row and the scroll
                wrapper; the card above stays put. The <tfoot> totals stay inside
                the real table so their cells line up with the columns above. */}
            <DataTable<LedgerReportRow>
              data={visibleLedgerItems}
              virtualize={{ rowHeight: 96, overscan: 6, maxHeight: '70vh' }}
              rowKey={(row) => row.id}
              onRowClick={(row) => {
                const adjustment = adjustmentForRow(row);
                if (adjustment) {
                  setAdjustmentToEdit(adjustment);
                  return;
                }
                /* One voucher row → its receipt, listing every invoice it
                   adjusted. Chips inside the row stop propagation, so reading
                   and editing stay separate clicks. */
                const voucher = voucherForRow(row);
                if (voucher) setReceiptPayment(voucher.payment);
              }}
              emptyState={
                <div className="py-12 text-center text-slate-500">
                  <div className="w-12 h-12 mx-auto rounded-full bg-slate-100 text-ink-body flex items-center justify-center mb-3">
                    <FileSpreadsheet className="w-6 h-6" />
                  </div>
                  <p className="text-sm font-bold text-slate-800">{onlyIssues ? 'No row-level exceptions' : 'No ledger entries found'}</p>
                  <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                    {onlyIssues
                      ? 'The remaining exceptions are statement-level; clear the exception filter to see every entry.'
                      : "There are no recorded case invoices or payments for the selected clinic and date filter. Try selecting 'All Time' or choosing another clinic."}
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
                reportRows.length > 0 ? (
                  <tr className="bg-slate-100/90 border-t-2 border-slate-300 font-bold text-xs text-slate-900">
                    <td colSpan={3} className="py-3.5 px-4 text-right uppercase tracking-wider font-bold">
                      Total Period Activity:
                    </td>
                    <td className="py-3.5 px-3 text-right font-bold font-mono text-blue-900 whitespace-nowrap">
                      {formatPKR(summary.totalDebits)}
                    </td>
                    <td className="py-3.5 px-3 text-right font-bold font-mono text-emerald-700 whitespace-nowrap">
                      {formatPKR(summary.totalCredits)}
                    </td>
                    <td className="py-3.5 px-4 text-right text-ink-muted whitespace-nowrap">—</td>
                  </tr>
                ) : null
              }
              footer={
                onlyIssues ? (
                  <div className="border-t border-slate-100 bg-amber-50/60 px-4 py-3 text-center text-xs text-amber-900">
                    Showing {visibleLedgerItems.length} exception row{visibleLedgerItems.length === 1 ? '' : 's'} of {reportRows.length} — totals still cover the full period.
                  </div>
                ) : null
              }
              columns={[
                {
                  header: 'Date',
                  className: 'w-[82px] py-2.5 px-2 align-top font-mono text-[10.5px] text-slate-700 whitespace-nowrap font-medium',
                  render: (row) => <span>{row.dateLabel || row.date || '-'}</span>,
                },
                {
                  header: 'Voucher / Case',
                  className: 'w-[150px] py-2.5 px-2 align-top',
                  render: (row) => {
                    const voucher = voucherForRow(row);
                    const inv = invoiceForRow(row);
                    const adj = adjustmentForRow(row);
                    const c = row.caseNumber
                      ? cases.find((x) => x.id === row.caseId) || cases.find((x) => x.case_number === row.caseNumber)
                      : undefined;
                    let voucherEl: React.ReactNode;
                    if (voucher) {
                      voucherEl = (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setVoucherToEdit(voucher); }}
                          title="Open this payment voucher — amount, method, date, reference — edit or delete it"
                          aria-label={'Open ' + (voucher.payment.payment_number || 'payment') + ' voucher'}
                          className="inline-block max-w-full font-mono text-[10px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5 whitespace-nowrap hover:bg-emerald-100 transition-colors cursor-pointer"
                        >
                          {voucher.payment.payment_number || row.voucherNumber}
                        </button>
                      );
                    } else if (adj) {
                      voucherEl = (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setAdjustmentToEdit(adj); }}
                          title="Open this adjustment — reason, amount, date — edit or delete it"
                          aria-label={'Open adjustment ' + (adj.adjustment_number || row.voucherNumber)}
                          className="inline-block max-w-full font-mono text-[10px] font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 whitespace-nowrap hover:bg-amber-100 transition-colors cursor-pointer"
                        >
                          {adj.adjustment_number || row.voucherNumber}
                        </button>
                      );
                    } else if (inv) {
                      voucherEl = (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setSelectedDrawerInvoice(inv); }}
                          title="Open invoice — view, edit payments/adjustments, or void it"
                          aria-label={'Open invoice ' + inv.invoice_number}
                          className="inline-block max-w-full font-mono text-[10px] font-bold text-indigo-800 bg-indigo-50 border border-indigo-200 rounded px-1.5 py-0.5 whitespace-nowrap hover:bg-indigo-100 transition-colors cursor-pointer"
                        >
                          {inv.invoice_number}
                        </button>
                      );
                    } else {
                      voucherEl = <span className="font-mono text-[10px] font-bold text-slate-700 break-words">{row.voucherNumber || '—'}</span>;
                    }
                    return (
                      <div className="flex flex-col items-start gap-1">
                        {voucherEl}
                        {row.caseNumber ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (c) setSelectedCaseForModalLocal(c);
                            }}
                            disabled={!c}
                            title={c ? 'Open case' : 'Case record not found'}
                            className="inline-block font-mono text-[10px] font-bold text-slate-700 bg-slate-100 border border-slate-200 rounded px-1.5 py-0.5 whitespace-nowrap hover:bg-slate-200 transition-colors cursor-pointer disabled:cursor-default disabled:hover:bg-slate-100"
                          >
                            {row.caseNumber}
                          </button>
                        ) : (
                          <span className="text-ink-muted">—</span>
                        )}
                      </div>
                    );
                  },
                },
                {
                  header: 'Narration',
                  className: 'w-[230px] py-2.5 px-2 align-top',
                  render: (row) => {
                    const details = caseDetailsFor(row);
                    return (
                    <div className="space-y-1.5">
                      {row.type !== 'invoice' && (
                        <p className="whitespace-normal break-words text-[11.5px] leading-5 text-slate-700">
                          {row.bodyNarration || row.narration || row.notes || '—'}
                        </p>
                      )}
                      {details.length > 0 && (
                        <dl className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 rounded-md border border-slate-200 bg-slate-50/70 px-2 py-1 text-[10.5px] leading-4">
                          {details.map((d) => (
                            <div key={d.label} className="flex items-baseline gap-1 min-w-0">
                              <dt className="shrink-0 text-[9.5px] font-bold uppercase tracking-wide text-ink-muted after:content-[':']">
                                {d.label}
                              </dt>
                              <dd className="min-w-0 break-words text-[10.5px] text-slate-700">
                                {d.value}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      )}
                      <div className="flex flex-wrap items-center gap-1.5">
                        {row.clinicalMismatch && (
                          <span
                            className="inline-flex items-center rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-800"
                            title={'Invoice says ' + row.procedure + '; case record says ' + row.caseProcedure}
                          >
                            Check procedure
                          </span>
                        )}
                        {settlementBadge(row)}
                        {row.paymentMethod && (
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                            {row.paymentMethod}
                          </span>
                        )}
                      </div>
                    </div>
                    );
                  },
                },
                {
                  header: 'Debit (PKR)',
                  align: 'right',
                  className: 'w-[94px] py-2.5 px-2 align-top',
                  render: (row) =>
                    row.debit > 0 ? (
                      <span className="font-bold text-blue-900 font-mono whitespace-nowrap">{formatPKR(row.debit)}</span>
                    ) : (
                      <span className="text-ink-muted font-mono">-</span>
                    ),
                },
                {
                  header: 'Credit (PKR)',
                  align: 'right',
                  className: 'w-[94px] py-2.5 px-2 align-top',
                  render: (row) =>
                    row.credit > 0 ? (
                      <span className="font-bold text-emerald-700 font-mono whitespace-nowrap">{formatPKR(row.credit)}</span>
                    ) : (
                      <span className="text-ink-muted font-mono">-</span>
                    ),
                },
                {
                  header: 'Balance (PKR)',
                  align: 'right',
                  className: 'w-[108px] py-2.5 px-2 align-top whitespace-nowrap font-mono font-bold',
                  render: (row) => (
                    <span className={row.balance > 0 ? 'text-slate-900' : row.balance < 0 ? 'text-emerald-700' : 'text-slate-500'}>
                      {formatPKR(row.balance)}
                    </span>
                  ),
                },
              ]}            />

            {/* Final line of the statement: the closing balance, after the last
                chronologically ordered entry. */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t-2 border-slate-300 bg-slate-50 px-4 py-3.5">
              <div>
                <span className="block text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">
                  Closing Balance{startDate || endDate ? ` · ${startDate || 'Beginning'} → ${endDate || 'Present'}` : ''}
                </span>
                <span className="text-[11px] text-slate-500">
                  {summary.closingBalance > 0
                    ? 'Receivable from clinic'
                    : summary.closingBalance < 0
                    ? 'Advance credit held for clinic'
                    : 'Fully settled'}
                  {' · '}Opening {formatPKR(summary.openingBalance)} · Debits {formatPKR(summary.totalDebits)} · Credits {formatPKR(summary.totalCredits)}
                </span>
              </div>
              <span className="font-mono text-lg font-bold tracking-tight text-slate-900">
                {formatPKR(summary.closingBalance)} {summary.closingBalance > 0 ? 'Dr' : summary.closingBalance < 0 ? 'Cr' : ''}
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

      {/* Reading a voucher is a click on its row; this is that receipt. It
          lists every invoice the one payment adjusted. */}
      {receiptPayment && (
        <PaymentReceiptModal
          payment={receiptPayment}
          onClose={() => setReceiptPayment(null)}
        />
      )}

      {/* The voucher a payment row carries: read, correct or delete it in place.
          Saving rebuilds the receipt's journal so the register, the general
          ledger and the printed invoice all move together. */}
      {voucherToEdit && (
        <EditPaymentModal
          isOpen={!!voucherToEdit}
          payment={voucherToEdit.payment}
          invoices={invoices}
          labId={voucherToEdit.payment.lab_id}
          onSave={(id, patch) => updatePaymentV2(id, patch)}
          onDelete={(payment) => setVoucherToDelete(payment)}
          onClose={() => setVoucherToEdit(null)}
        />
      )}

      {/* Delete a payment entry. Never the invoice: voiding one stays on the
          invoice table, where its issuance journal and retired number are the
          things being explained. */}
      <ConfirmDialog
        open={!!voucherToDelete}
        title={`Delete payment ${voucherToDelete?.payment_number || ''}`}
        consequences={[
          `${voucherToDelete?.lab_name || 'The clinic'}'s balance goes back up by ${(voucherToDelete?.amount || 0).toLocaleString()} PKR on the invoice it paid.`,
          'The receipt, its journal entry and any bank reconciliation item raised for it are removed.',
          'A PAYMENT_DELETED audit entry records who deleted it.',
        ]}
        confirmLabel="Delete Payment"
        onCancel={() => setVoucherToDelete(null)}
        onConfirm={() => {
          if (voucherToDelete) deletePaymentV2(voucherToDelete.id);
          setVoucherToDelete(null);
        }}
      />

      {/* Invoice drill-down: view, void, or correct its payments/adjustments. */}
      <InvoiceDetailDrawer
        isOpen={!!selectedDrawerInvoice}
        onClose={() => setSelectedDrawerInvoice(null)}
        invoice={selectedDrawerInvoice}
        attributedAdjustments={
          selectedDrawerInvoice
            ? adjustmentsByInvoice.get(selectedDrawerInvoice.id)
            : undefined
        }
        onOpenPaymentModal={(inv) => {
          setSelectedDrawerInvoice(null);
          setUnifiedModalLabId(inv.lab_id);
          setUnifiedModalInvoiceId(inv.id);
          setIsUnifiedRecordModalOpen(true);
        }}
        onOpenJournalModal={() => {}}
        onPrintInvoice={(inv) => setPrintModalInvoice(inv)}
        onViewReceipt={() => {}}
        onDeletePayment={(pay) => setVoucherToDelete(pay)}
        onEditAdjustment={(adj) => setAdjustmentToEdit(adj)}
        onDeleteAdjustment={(adj) => setAdjustmentToDelete(adj)}
        onVoidInvoice={(inv) => setVoidTarget(inv)}
        canVoid={canPost(user, 'invoice:void')}
        canEditAdjustments={canPost(user, 'credit:issue') || canPost(user, 'debit:issue') || canPost(user, 'refund:issue')}
        canDeleteAdjustments={canPost(user, 'payment:edit')}
      />

      {printModalInvoice && (
        <InvoiceStatementModal
          invoice={printModalInvoice}
          caseData={cases.find((c) => c.id === printModalInvoice.case_id) || null}
          cases={cases}
          onClose={() => setPrintModalInvoice(null)}
        />
      )}

      {isUnifiedRecordModalOpen && (
        <RecordTransactionModal
          isOpen={isUnifiedRecordModalOpen}
          onClose={() => {
            setIsUnifiedRecordModalOpen(false);
            setUnifiedModalLabId(undefined);
            setUnifiedModalInvoiceId(undefined);
          }}
          initialMode="payment"
          initialLabId={unifiedModalLabId}
          initialInvoiceId={unifiedModalInvoiceId}
        />
      )}

      {adjustmentToEdit && (
        <EditAdjustmentModal
          adjustment={adjustmentToEdit}
          onSave={(id, patch) => updateAccountAdjustment(id, patch)}
          onClose={() => setAdjustmentToEdit(null)}
        />
      )}

      <ConfirmDialog
        open={!!voidTarget}
        title={`Void invoice ${voidTarget?.invoice_number || ''}`}
        consequences={[
          `${voidTarget?.lab_name || 'The clinic'} will owe ${voidTarget ? (voidTarget.final_amount - (voidTarget.amount_paid || 0) - (voidTarget.credit_notes_total || 0)) : 0} PKR again.`,
          `Invoice ${voidTarget?.invoice_number || ''} leaves the register; its number is retired.`,
        ]}
        confirmLabel="Void Invoice"
        typedPhrase="VOID"
        onCancel={() => setVoidTarget(null)}
        onConfirm={() => {
          if (voidTarget) deleteInvoice(voidTarget.id);
          setVoidTarget(null);
          setSelectedDrawerInvoice(null);
        }}
      />

      <ConfirmDialog
        open={!!adjustmentToDelete}
        title={`Delete adjustment ${adjustmentToDelete?.adjustment_number || ''}`}
        consequences={['The adjustment is removed and its invoice effect reversed.']}
        confirmLabel="Delete Adjustment"
        onCancel={() => setAdjustmentToDelete(null)}
        onConfirm={() => {
          if (adjustmentToDelete) deleteAccountAdjustment(adjustmentToDelete.id);
          setAdjustmentToDelete(null);
        }}
      />
    </div>
  );
};
