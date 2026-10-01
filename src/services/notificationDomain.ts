import type { AppNotification, DentalCase, Invoice } from '../types';

/**
 * Notification domain — the single home for notification-building rules that
 * used to live inline in AppContext call sites (audit finding F2). Pure
 * functions only: no React, no state, no DB. Callers receive complete
 * `AppNotification` records and prepend them to state; ids and timestamps are
 * taken as parameters so production and tests share one clock strategy.
 */

const nowStamp = (): string => new Date().toISOString().replace('T', ' ').substring(0, 16);

interface BaseInput {
  /** Notification id — pass the same generator used across the app. */
  id: string;
  /** `YYYY-MM-DD HH:mm` local stamp, or omitted for "now". */
  at?: string;
}

/** Case status reached the workstation-visible states. */
export const buildStatusChangeNotification = (
  input: BaseInput & { case: DentalCase; status: DentalCase['status'] },
): AppNotification => ({
  id: input.id,
  type: 'status_change',
  title: `Case ${input.case.case_number} ${input.status.toUpperCase()}`,
  message: `Case ${input.case.case_number} for ${input.case.lab_name} status updated to ${input.status}.`,
  case_id: input.case.id,
  case_number: input.case.case_number,
  is_read: false,
  is_archived: false,
  created_at: input.at ?? nowStamp(),
});

/** A QC inspection failed and the case went back to rework. */
export const buildQcFailedNotification = (
  input: BaseInput & { case: DentalCase; inspectionNo: number; reasonLabel: string },
): AppNotification => ({
  id: input.id,
  type: 'escalation',
  title: `QC failed — ${input.case.case_number}`,
  message: `${input.case.case_number} (${input.case.lab_name}) failed quality inspection #${input.inspectionNo}: ${input.reasonLabel}. Returned for rework.`,
  case_id: input.case.id,
  case_number: input.case.case_number,
  lab_id: input.case.lab_id,
  is_read: false,
  is_archived: false,
  priority: 'high',
  created_at: input.at ?? nowStamp(),
});

/** Deterministic overdue alert, one per case per day (id is case-keyed). */
/**
 * D1 — the reminder cadence lives in `notification_config` (Settings →
 * Notifications). These two helpers turn the stored frequency ids into the day
 * offsets they describe and decide whether a sweep should speak up today.
 */

/** '1_day_before' → -1, 'on_due_date' → 0, '3_days_after' → 3. */
export const cadenceOffsets = (frequency?: string[] | null): number[] =>
  (frequency || [])
    .map((f) => {
      const m = /^(\d+)_days?_(before|after)$/.exec(f);
      if (m) return m[2] === 'before' ? -Number(m[1]) : Number(m[1]);
      return f === 'on_due_date' ? 0 : null;
    })
    .filter((n): n is number => n !== null)
    .sort((a, b) => a - b);

/**
 * Should a due/overdue item be reminded about today?
 *
 * - no cadence configured → `true` (legacy behaviour: every sweep, every item)
 * - the day offset is one the user ticked → `true`
 * - the item is older than the last ticked offset → `true`
 *
 * That last rule is deliberate: once a receivable or an overdue case has run
 * past the final reminder we keep reminding rather than silently dropping it.
 */
export const shouldRemind = (frequency: string[] | null | undefined, dueDate: string, today: string): boolean => {
  if (!frequency || frequency.length === 0) return true;
  const offsets = cadenceOffsets(frequency);
  if (offsets.length === 0) return true;
  const days = Math.round((Date.parse(today) - Date.parse(dueDate)) / 86_400_000);
  if (Number.isNaN(days)) return true;
  return days >= offsets[offsets.length - 1] || offsets.includes(days);
};

export const buildOverdueAlerts = (
  cases: DentalCase[],
  today: string,
  idOf: (c: DentalCase) => string,
  /** Optional stored cadence; omit for the legacy "every overdue case" sweep. */
  cadence?: string[] | null,
): AppNotification[] =>
  (cases || [])
    .filter((c) => {
      if (!c || c.status === 'delivered' || c.status === 'cancelled') return false;
      // With a cadence configured the cadence owns the window (it can start a
      // day early); without one we keep the legacy "strictly past due" sweep.
      if (cadence === undefined) return (c.delivery_date || '') < today;
      return Boolean(c.delivery_date) && shouldRemind(cadence, c.delivery_date, today);
    })
    .map((c) => ({
      id: idOf(c),
      type: 'overdue_case' as const,
      title: `Case ${c.case_number} Overdue Notice`,
      message: `Case ${c.case_number} (${c.patient_name} - ${c.doctor_name}) missed scheduled delivery on ${c.delivery_date}. Priority triage required.`,
      case_id: c.id,
      case_number: c.case_number,
      lab_id: c.lab_id,
      is_read: false,
      read: false,
      created_at: new Date().toISOString(),
    }));

/** Deterministic unpaid-invoice reminders, one per invoice past its due date. */
export const buildUnpaidInvoiceAlerts = (
  invoices: Invoice[],
  today: string,
  idOf: (inv: Invoice) => string,
  /** Optional stored cadence; omit for the legacy "every due invoice" sweep. */
  cadence?: string[] | null,
): AppNotification[] =>
  (invoices || [])
    .filter((inv) => {
      if (!inv || inv.payment_status === 'paid' || inv.status_v2 === 'voided' || !inv.due_date) return false;
      return cadence === undefined ? inv.due_date <= today : shouldRemind(cadence, inv.due_date, today);
    })
    .map((inv) => ({
      id: idOf(inv),
      type: 'unpaid_invoice' as const,
      title: `Payment Due — Invoice ${inv.invoice_number}`,
      message: `${inv.final_amount.toLocaleString()} PKR outstanding for ${inv.patient_name || inv.lab_name}. Due ${inv.due_date}.`,
      invoice_id: inv.id,
      case_number: inv.case_number,
      lab_id: inv.lab_id,
      is_read: false,
      read: false,
      created_at: new Date().toISOString(),
    }));

/**
 * Append-only prepending helper shared by every caller: keeps the existing
 * dedupe-inside-the-updater discipline (a duplicate id aborts the whole SQLite
 * sync transaction) while collapsing the repeated `setNotifications` shapes.
 */
export const prependUniqueNotifications = (
  prev: AppNotification[],
  fresh: AppNotification[],
): AppNotification[] => {
  const existing = new Set((prev || []).map((n) => n.id));
  const adding = fresh.filter((a) => !existing.has(a.id));
  return adding.length > 0 ? [...adding, ...(prev || [])] : prev || [];
};

/** Wraps the generic `addNotification` path used by arbitrary UI callers. */
export const buildGenericNotification = (
  n: Omit<AppNotification, 'id' | 'created_at' | 'is_read' | 'read' | 'is_archived'>,
  id: string,
): AppNotification => ({
  ...n,
  id,
  created_at: new Date().toISOString().replace('T', ' ').substring(0, 16),
  is_read: false,
  read: false,
  is_archived: false,
});

/** Advance deposit recorded against a clinic credit wallet. */
export const buildAdvanceDepositNotification = (
  input: BaseInput & { labId: string; labName: string; amount: number; method: string; advNum: string },
): AppNotification => ({
  id: input.id,
  type: 'system',
  title: `Advance Deposit Received: ${input.advNum}`,
  message: `Advance deposit of PKR ${(input.amount || 0).toLocaleString()} received from ${input.labName} via ${input.method.toUpperCase()}. Added to clinic credit balance.`,
  lab_id: input.labId,
  is_read: false,
  is_archived: false,
  created_at: input.at ?? nowStamp(),
});

/** Advance credit fully settled an invoice. */
export const buildAdvanceSettledInvoiceNotification = (
  input: BaseInput & { invoice: Invoice; amount: number },
): AppNotification => ({
  id: input.id,
  type: 'system',
  title: `Invoice ${input.invoice.invoice_number} Settled via Advance`,
  message: `Advance credit of PKR ${(input.amount || 0).toLocaleString()} applied to ${input.invoice.invoice_number} for ${input.invoice.lab_name}. Invoice is fully settled.`,
  invoice_id: input.invoice.id,
  lab_id: input.invoice.lab_id,
  is_read: false,
  is_archived: false,
  created_at: input.at ?? nowStamp(),
});

/** Credit note / debit adjustment / refund posted. */
export const buildAdjustmentNotification = (
  input: BaseInput & {
    kind: 'credit_note' | 'debit_adjustment' | 'refund';
    adjNum: string;
    labId: string;
    labName: string;
    amount: number;
    reason: string;
  },
): AppNotification => {
  const title =
    input.kind === 'credit_note'
      ? `Credit Note Issued: ${input.adjNum}`
      : input.kind === 'debit_adjustment'
        ? `Debit Surcharge: ${input.adjNum}`
        : `Refund Issued: ${input.adjNum}`;
  return {
    id: input.id,
    type: 'system',
    title,
    message: `${title} for ${input.labName}. Amount: PKR ${(input.amount || 0).toLocaleString()}. Reason: ${input.reason}`,
    lab_id: input.labId,
    is_read: false,
    is_archived: false,
    created_at: input.at ?? nowStamp(),
  };
};

/** Advance deposit recorded through the V2 cashier command flow (title keyed on the ADV number, message on the receipt). */
export const buildAdvanceDepositV2Notification = (
  input: BaseInput & { labId: string; labName: string; amount: number; advNum: string; receiptNum: string; formatAmount: (n: number) => string },
): AppNotification => ({
  id: input.id,
  type: 'system',
  title: `Advance Deposit Received: ${input.advNum}`,
  message: `Deposit of ${input.formatAmount(input.amount)} added to ${input.labName} credit wallet. Receipt ${input.receiptNum}.`,
  lab_id: input.labId,
  is_read: false,
  is_archived: false,
  created_at: input.at ?? nowStamp(),
});

/** Payment received against one or more invoices. */
export const buildPaymentReceivedNotification = (
  input: BaseInput & { labId: string; labName: string; amount: number; method: string; receiptNum: string; formatAmount: (n: number) => string },
): AppNotification => ({
  id: input.id,
  type: 'system',
  title: `Payment Received: ${input.receiptNum}`,
  message: `Received ${input.formatAmount(input.amount)} from ${input.labName} via ${input.method.toUpperCase()}. Receipt ${input.receiptNum} issued.`,
  lab_id: input.labId,
  is_read: false,
  is_archived: false,
  created_at: input.at ?? nowStamp(),
});
