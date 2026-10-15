import type { Invoice } from '../types';
import { formatDoctorName } from '../utils/doctorName';

/**
 * The invoice search: one haystack built from every field an operator might
 * type.
 *
 * The list used to match invoice #, case #, clinic, doctor and procedure only.
 * That left the two most common ways an operator actually looks for an invoice
 * with nowhere to put the query: the patient's name, and a receipt number read
 * off a bank slip or a cheque. So the haystack is now the whole invoice —
 * identity, people, clinic, procedure, money, dates, status, and every receipt
 * recorded against it.
 *
 * Matching is a plain case-insensitive substring, deliberately: no tokenising,
 * no ranking, no field syntax for the operator to learn. `ahmad`, `DS-0009`,
 * `75,000` and `TR-998234` all have to resolve to the same invoice, and the
 * operator should never have to know which column a value lives in.
 */

/** Money is searched both bare and as printed, so `75000` and `75,000` both hit. */
const money = (value: number | undefined | null): string => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  return `${value} ${value.toLocaleString()}`;
};

const invoiceHaystack = (inv: Invoice): string => {
  const parts: (string | number | undefined | null)[] = [
    inv.invoice_number,
    inv.case_number,
    inv.patient_name,
    inv.doctor_name,
    formatDoctorName(inv.doctor_name, ''),
    inv.lab_name,
    inv.case_type_name,
    inv.issue_date,
    inv.created_at,
    inv.due_date,
    inv.payment_status,
    inv.status_v2,
    money(inv.amount),
    money(inv.final_amount),
    money(inv.amount_paid),
    money(inv.credit_notes_total),
  ];

  for (const payment of inv.payments || []) {
    parts.push(
      payment.payment_number,
      payment.receipt_number,
      payment.reference_number,
      payment.payment_method,
      payment.recorded_by,
      payment.notes,
      money(payment.amount),
    );
  }

  return parts
    .filter((part) => part !== undefined && part !== null && part !== '')
    .map(String)
    .join(' ')
    .toLowerCase()
    .replace(/\./g, '');
};

/**
 * Periods are dropped from the query too, so the punctuation convention is not
 * something the operator has to know. The app prints `Dr. Ahmad` while people
 * type `Dr Ahmad`; both resolve to the same invoice instead of the search box
 * silently returning nothing.
 */
export const invoiceMatchesSearch = (inv: Invoice, query: string): boolean => {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return invoiceHaystack(inv).includes(q.replace(/\./g, ''));
};
