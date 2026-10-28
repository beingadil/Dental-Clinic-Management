import type { AccountAdjustment, Invoice } from '../types';

/**
 * Which adjustments belong on which invoice row.
 *
 * Payments already carry `invoice_id`; a clinic-level adjustment does not.
 * `recordAccountAdjustment` posts these documents to the ledger only — a
 * credit note does not settle an invoice — so a note recorded today is parked
 * on a row with `clinicLevel: true`, exactly like a surcharge or a refund.
 * That row is not a settlement claim: it is the one place the invoice module
 * can read, correct or delete the document instead of it vanishing into the
 * ledger.
 *
 * The replay below still matters for rows recorded by 2.30–2.31, which DID
 * apply credit notes FIFO across the clinic's open invoices. Those invoice
 * credits are real, so replaying them gives each old note a home on the rows
 * it paid down — no extra allocation table.
 */

export interface AttributedAdjustment {
  adjustment: AccountAdjustment;
  /** Portion of the document that lands on this invoice (display only). */
  amount: number;
  /** True when the invoice row is only the document's display home. */
  clinicLevel: boolean;
}

const oldestFirst = (a: Invoice, b: Invoice): number => {
  const da = a.issue_date || a.created_at || '';
  const db = b.issue_date || b.created_at || '';
  if (da !== db) return da < db ? -1 : 1;
  return (a.invoice_number || '').localeCompare(b.invoice_number || '');
};

const push = (
  map: Map<string, AttributedAdjustment[]>,
  invoiceId: string,
  entry: AttributedAdjustment,
): void => {
  const list = map.get(invoiceId);
  if (list) list.push(entry);
  else map.set(invoiceId, [entry]);
};

export const attributeAdjustmentsToInvoices = (
  invoices: Invoice[],
  adjustments: AccountAdjustment[],
): Map<string, AttributedAdjustment[]> => {
  const result = new Map<string, AttributedAdjustment[]>();

  const byClinic = new Map<string, Invoice[]>();
  for (const inv of invoices) {
    const list = byClinic.get(inv.lab_id);
    if (list) list.push(inv);
    else byClinic.set(inv.lab_id, [inv]);
  }
  for (const list of byClinic.values()) list.sort(oldestFirst);

  const creditsByClinic = new Map<string, AccountAdjustment[]>();
  for (const adj of adjustments) {
    const list = creditsByClinic.get(adj.lab_id);
    if (list) list.push(adj);
    else creditsByClinic.set(adj.lab_id, [adj]);
  }

  for (const [clinicId, clinicInvoices] of byClinic.entries()) {
    const clinicAdjustments = (creditsByClinic.get(clinicId) || []).slice().sort((a, b) => {
      const da = a.date || a.created_at || '';
      const db = b.date || b.created_at || '';
      if (da !== db) return da < db ? -1 : 1;
      return (a.adjustment_number || '').localeCompare(b.adjustment_number || '');
    });

    // Head-room before any credit note is replayed: what the clinic was billed
    // and has not settled in cash. Credit notes are then layered on oldest-first.
    const capacity = new Map<string, number>();
    for (const inv of clinicInvoices) {
      capacity.set(
        inv.id,
        inv.status_v2 === 'voided'
          ? 0
          : Math.max(0, (inv.final_amount || 0) - (inv.amount_paid || 0)),
      );
    }

    // How much credit actually landed on invoices. A note can be larger than
    // the open balance (nothing stops an operator typing 70,000 against a
    // 50,000 clinic), and deleted notes in older versions could leave the two
    // sides out of step. Replaying at most this much keeps the displayed
    // allocation honest; any surplus is shown as an unapplied clinic document.
    let creditPool = clinicInvoices.reduce(
      (sum, inv) =>
        sum +
        (inv.status_v2 === 'voided' ? 0 : Math.max(0, inv.credit_notes_total || 0)),
      0,
    );

    for (const adj of clinicAdjustments) {
      const isCredit = adj.type === 'credit_note' || adj.type === 'write_off';
      const namedInvoice = adj.invoice_id
        ? clinicInvoices.find((inv) => inv.id === adj.invoice_id)
        : undefined;

      if (!isCredit) {
        // Surcharges/refunds are clinic documents; keep the named invoice if
        // there is one, otherwise park the row on the oldest invoice so the
        // billing screen can still manage it.
        const home = namedInvoice || clinicInvoices[0];
        if (home) push(result, home.id, { adjustment: adj, amount: adj.amount, clinicLevel: !namedInvoice });
        continue;
      }

      const candidates = namedInvoice
        ? [namedInvoice, ...clinicInvoices.filter((inv) => inv.id !== namedInvoice.id)]
        : clinicInvoices;

      let remaining = adj.amount;
      for (const inv of candidates) {
        if (remaining <= 0 || creditPool <= 0) break;
        const room = Math.min(capacity.get(inv.id) || 0, creditPool);
        const take = Math.min(room, remaining);
        if (take > 0) {
          capacity.set(inv.id, (capacity.get(inv.id) || 0) - take);
          creditPool -= take;
          remaining -= take;
          push(result, inv.id, {
            adjustment: adj,
            amount: take,
            clinicLevel: false,
          });
        }
      }

      // More credit than open invoices (payments arrived later, or the note was
      // refunded manually). Keep the remainder visible on the named/newest row
      // rather than hiding a money document.
      if (remaining > 0) {
        const home = namedInvoice || clinicInvoices[clinicInvoices.length - 1];
        if (home) {
          push(result, home.id, {
            adjustment: adj,
            amount: remaining,
            clinicLevel: true,
          });
        }
      }
    }
  }

  return result;
};

/**
 * How much of one adjustment is currently reflected in invoice credits.
 *
 * Notes recorded by the current build are never applied, so this is 0 for
 * them. Notes recorded by 2.30–2.31 were applied FIFO, and deleting or
 * re-amounting one still has to unwind exactly the portion that landed — the
 * whole amount would strip an unrelated note's credit off the invoices.
 */
export const attributedCreditTotal = (
  adjustmentId: string,
  invoices: Invoice[],
  adjustments: AccountAdjustment[],
): number => {
  const adjustment = adjustments.find((a) => a.id === adjustmentId);
  if (!adjustment) return 0;
  if (adjustment.type !== 'credit_note' && adjustment.type !== 'write_off') return 0;

  const clinicInvoices = invoices.filter((inv) => inv.lab_id === adjustment.lab_id);
  const clinicAdjustments = adjustments.filter((a) => a.lab_id === adjustment.lab_id);

  let total = 0;
  for (const rows of attributeAdjustmentsToInvoices(clinicInvoices, clinicAdjustments).values()) {
    for (const row of rows) {
      // `clinicLevel` rows are the display home for a document that did not
      // land on an invoice — counting them would unwind the whole note.
      if (row.adjustment.id === adjustmentId && !row.clinicLevel) total += row.amount;
    }
  }
  return total;
};
