import React, { useState, useMemo } from 'react';
import { ACCOUNT_CODES, formatPKR, invoiceBalanceDue } from '../../services/financeDomain';
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
  Building2
} from 'lucide-react';
import { downloadPdf } from '../../lib/pdf';
import { buildLedgerReportPdf } from '../../lib/ledgerPdf';
import { attributeAdjustmentsToInvoices } from '../../services/adjustmentAttribution';
import { buildLedgerReport, type LedgerReportRow } from '../../services/ledgerReport';
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

  /* Render cap: totals are computed over the full set above (always correct),
     but the table only mounts the newest LEDGER_CAP_STEP rows — building+mounting
     ~1500 rows froze the view (audit §9). Expanded on demand like the other
     capped tables. */
  const LEDGER_CAP_STEP = 400;
  const [ledgerLimit, setLedgerLimit] = useState(LEDGER_CAP_STEP);
  const visibleLedgerItems = useMemo(
    () => reportRows.slice(0, ledgerLimit),
    [reportRows, ledgerLimit],
  );

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
  const settlementBadge = (entry: LedgerReportRow) => {
    if (entry.type !== 'invoice') return null;
    const inv = invoiceForRow(entry);
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

    const paidOn = balance <= 0
      ? (inv.payments || [])
          .map((payment) => (payment.payment_date || '').slice(0, 10))
          .filter(Boolean)
          .sort()
          .pop()
      : undefined;

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

  const buildStatement = () => {
    const clinicLabel = selectedClinic!.name;
    const periodLabel = startDate || endDate
      ? `${startDate || 'Beginning'} → ${endDate || 'Present'}`
      : 'All Time';
    const result = buildLedgerReportPdf(reportRows, summary, {
      labName: brandingSettings?.lab_name || brandingSettings?.appName || 'Dental Lab',
      clinicLabel,
      periodLabel,
      caseFilterLabel: caseFilter.trim() || undefined,
      accountName: ACCOUNT_CODES.ACCOUNTS_RECEIVABLE.name,
      accountCode: ACCOUNT_CODES.ACCOUNTS_RECEIVABLE.code,
      generatedOn: todayISO(),
    });
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

            {summary.openingBalanceReview?.length ? (
              <div
                role="note"
                className="flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-4 py-3 text-[11px] leading-5 text-amber-900"
              >
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <p className="min-w-0 break-words">
                  <span className="font-bold">Review opening-balance postings.</span>{' '}
                  {summary.openingBalanceReview.map((r) => `${r.voucherNumber} (${r.typeLabel}, ${formatPKR(r.amount)})`).join(', ')}{' '}
                  are posted transactions, not the statement&apos;s brought-forward figure. The opening balance before this period is{' '}
                  {formatPKR(summary.openingBalance)}. Check whether they belong in the clinic&apos;s opening-balance field;
                  the ledger will not move historical postings automatically.
                </p>
              </div>
            ) : null}

            {/* DataTable owns the <thead>, the ds-th header row and the scroll
                wrapper; the card above stays put. The <tfoot> totals row and
                the "show more" bar travel through `footer` — the tfoot keeps
                its own one-row table so its eight cells still line up with the
                columns above. */}
            <DataTable<LedgerReportRow>
              data={visibleLedgerItems}
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
              rowClassName={() => ''}
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
                <>
                  {reportRows.length > visibleLedgerItems.length && (
                    <div className="flex items-center justify-center gap-3 py-4 border-t border-slate-100 bg-slate-50/60">
                      <span className="text-xs text-slate-500">
                        Showing {visibleLedgerItems.length} of {reportRows.length} entries — totals cover the full period
                      </span>
                      <button
                        type="button"
                        onClick={() => setLedgerLimit((n) => n + LEDGER_CAP_STEP)}
                        className="px-4 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-bold rounded-lg transition-colors cursor-pointer"
                      >
                        Show {Math.min(LEDGER_CAP_STEP, reportRows.length - visibleLedgerItems.length)} More
                      </button>
                    </div>
                  )}
                </>
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
