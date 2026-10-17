import type {
  AccountAdjustment,
  AdvancePayment,
  CaseAttachment,
  CaseNote,
  DentalCase,
  DentalLab,
  Invoice,
  JournalEntry,
  LabAddress,
  LabContact,
  LabPricingOverride,
  LabReview,
  AppNotification,
  ReconciliationItem,
  SavedVoucher,
  DoctorPreferredLab,
  QcInspection,
} from '../types';

/**
 * Deleting a clinic, as a pure function of the collections it touches.
 *
 * WHY THIS IS NOT IN THE CONTEXT. The cascade is destructive and unrecoverable,
 * and `syncCore.syncNow` rebuilds every SQLite table wholesale from React state
 * on each save — so a row left behind in state simply comes back. That makes the
 * cascade's correctness load-bearing rather than cosmetic: miss one collection
 * and the data is resurrected, or the rebuild aborts on a foreign key. A pure
 * function over plain collections can be tested directly; the same logic wired
 * through a dozen `useState` setters cannot be exercised meaningfully.
 *
 * The contract for a caller is therefore: read `buildLabDeletionImpact` to warn,
 * then apply `applyLabDeletion` to the state, and let the normal sync write it.
 */

/** Everything the cascade can reach. Mirrors the slices AppContext holds. */
export interface LabDeletionCollections {
  labs: DentalLab[];
  cases: DentalCase[];
  invoices: Invoice[];
  advancePayments: AdvancePayment[];
  accountAdjustments: AccountAdjustment[];
  journalEntries: JournalEntry[];
  labContacts: LabContact[];
  labAddresses: LabAddress[];
  pricingOverrides: LabPricingOverride[];
  labReviews: LabReview[];
  doctorPreferences: DoctorPreferredLab[];
  qcInspections: QcInspection[];
  caseNotes: Record<string, CaseNote[]>;
  caseAttachments: Record<string, CaseAttachment[]>;
  notifications: AppNotification[];
  savedVouchers: SavedVoucher[];
  reconciliationItems: ReconciliationItem[];
}

/**
 * Exactly what a clinic delete would take with it.
 *
 * Money rows are counted AND totalled. "3 payments" does not tell anyone that
 * PKR 96,000 of recorded money is about to be erased — the total is the part
 * that makes the warning mean something.
 */
export interface LabDeletionImpact {
  labName: string;
  cases: number;
  invoices: number;
  payments: number;
  advances: number;
  adjustments: number;
  journals: number;
  contacts: number;
  addresses: number;
  pricingOverrides: number;
  reviews: number;
  /** Sum of `final_amount` across the invoices that will be destroyed. */
  totalBilled: number;
  /** Sum of the voucher amounts that will be destroyed. */
  totalPaid: number;
  /** Advances + adjustments, which are money in their own right. */
  totalAdjustments: number;
}

/** The ids a cascade will destroy, resolved once and reused by both functions. */
interface LabDeletionScope {
  caseIds: Set<string>;
  invoiceIds: Set<string>;
  paymentIds: Set<string>;
  advanceIds: Set<string>;
  adjustmentIds: Set<string>;
  /** Every document id the clinic owns, for journal matching. */
  documentIds: Set<string>;
  labCases: DentalCase[];
  labInvoices: Invoice[];
  labAdvances: AdvancePayment[];
  labAdjustments: AccountAdjustment[];
}

const scopeOf = (c: LabDeletionCollections, labId: string): LabDeletionScope => {
  const labCases = c.cases.filter((x) => x.lab_id === labId);
  const labInvoices = c.invoices.filter((x) => x.lab_id === labId);
  const labAdvances = c.advancePayments.filter((x) => x.lab_id === labId);
  const labAdjustments = c.accountAdjustments.filter((x) => x.lab_id === labId);

  const caseIds = new Set(labCases.map((x) => x.id));
  const invoiceIds = new Set(labInvoices.map((x) => x.id));
  const advanceIds = new Set(labAdvances.map((x) => x.id));
  const adjustmentIds = new Set(labAdjustments.map((x) => x.id));
  // Payments hang off their invoice rather than the clinic, so they are reached
  // through the invoices.
  const paymentIds = new Set(
    labInvoices.flatMap((inv) => (inv.payments || []).map((p) => p.id))
  );

  return {
    caseIds,
    invoiceIds,
    paymentIds,
    advanceIds,
    adjustmentIds,
    documentIds: new Set([...caseIds, ...invoiceIds, ...paymentIds, ...advanceIds, ...adjustmentIds]),
    labCases,
    labInvoices,
    labAdvances,
    labAdjustments,
  };
};

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

/**
 * Count and total what would be destroyed, without destroying anything.
 *
 * Reads exactly the collections `applyLabDeletion` reads, so the warning the
 * operator sees cannot drift from what actually happens.
 */
export const buildLabDeletionImpact = (
  c: LabDeletionCollections,
  labId: string
): LabDeletionImpact => {
  const s = scopeOf(c, labId);

  return {
    labName: c.labs.find((l) => l.id === labId)?.name ?? 'This clinic',
    cases: s.caseIds.size,
    invoices: s.invoiceIds.size,
    payments: s.paymentIds.size,
    advances: s.advanceIds.size,
    adjustments: s.adjustmentIds.size,
    // A journal belongs to this clinic if it names the clinic, or if it
    // describes one of the documents being destroyed. Either way it goes.
    journals: c.journalEntries.filter(
      (j) =>
        j.lab_id === labId ||
        (j.case_id != null && s.caseIds.has(j.case_id)) ||
        (j.reference_id != null && s.documentIds.has(j.reference_id))
    ).length,
    contacts: c.labContacts.filter((x) => x.lab_id === labId).length,
    addresses: c.labAddresses.filter((x) => x.lab_id === labId).length,
    pricingOverrides: c.pricingOverrides.filter((x) => x.lab_id === labId).length,
    reviews: c.labReviews.filter((x) => x.lab_id === labId).length,
    totalBilled:
      (c.labs.find((l) => l.id === labId)?.opening_balance || 0) +
      sum(s.labInvoices.map((inv) => inv.final_amount || 0)),
    totalPaid: sum(
      s.labInvoices.flatMap((inv) => (inv.payments || []).map((p) => p.amount || 0))
    ),
    totalAdjustments:
      sum(s.labAdvances.map((a) => a.amount || 0)) +
      sum(s.labAdjustments.map((a) => a.amount || 0)),
  };
};

/**
 * Remove a clinic and everything under it.
 *
 * Returns a new collections object; nothing is mutated. Collections the clinic
 * never touched are returned by identity, so the caller can skip re-rendering a
 * list that did not change — the reason this takes the whole object rather than
 * a set of setters.
 *
 * Audit events are deliberately NOT filtered. Deleting the documents must not
 * delete the record that they were deleted; the audit trail is the one thing
 * that has to outlive the data it describes.
 */
export const applyLabDeletion = <C extends LabDeletionCollections>(
  c: C,
  labId: string
): C => {
  const s = scopeOf(c, labId);

  const withoutKeys = <T>(record: Record<string, T[]>): Record<string, T[]> =>
    Object.fromEntries(Object.entries(record).filter(([k]) => !s.caseIds.has(k)));

  return {
    ...c,
    // The clinic itself, then its own records.
    labs: c.labs.filter((l) => l.id !== labId),
    labContacts: c.labContacts.filter((x) => x.lab_id !== labId),
    labAddresses: c.labAddresses.filter((x) => x.lab_id !== labId),
    pricingOverrides: c.pricingOverrides.filter((x) => x.lab_id !== labId),
    labReviews: c.labReviews.filter((x) => x.lab_id !== labId),
    doctorPreferences: c.doctorPreferences.filter((x) => x.lab_id !== labId),

    // Case jobs, invoices and the money rows that hang off them.
    cases: c.cases.filter((x) => x.lab_id !== labId),
    invoices: c.invoices.filter((x) => x.lab_id !== labId),
    advancePayments: c.advancePayments.filter((x) => x.lab_id !== labId),
    accountAdjustments: c.accountAdjustments.filter((x) => x.lab_id !== labId),

    // Case-scoped children hang off the case id, so filtering by lab would miss
    // them entirely — and the rebuild would re-insert them and abort the sync.
    qcInspections: c.qcInspections.filter((x) => !s.caseIds.has(x.case_id)),
    caseNotes: withoutKeys(c.caseNotes),
    caseAttachments: withoutKeys(c.caseAttachments),

    // Notifications, saved vouchers and reconciliation rows name the clinic, the
    // case or the invoice — all three are being destroyed.
    notifications: c.notifications.filter(
      (n) =>
        n.lab_id !== labId &&
        !(n.case_id != null && s.caseIds.has(n.case_id)) &&
        !(n.invoice_id != null && s.invoiceIds.has(n.invoice_id))
    ),
    savedVouchers: c.savedVouchers.filter((v) => !(v.case_id != null && s.caseIds.has(v.case_id))),
    reconciliationItems: c.reconciliationItems.filter(
      (r) =>
        r.lab_id !== labId &&
        !(r.invoice_id != null && s.invoiceIds.has(r.invoice_id)) &&
        !(r.payment_id != null && s.paymentIds.has(r.payment_id))
    ),

    // Journals are the ledger. Leaving them behind is exactly how the reversal era
    // filled the books with entries that described nothing.
    journalEntries: c.journalEntries.filter(
      (j) =>
        j.lab_id !== labId &&
        !(j.case_id != null && s.caseIds.has(j.case_id)) &&
        !(j.reference_id != null && s.documentIds.has(j.reference_id))
    ),
  };
};