import type { Invoice } from '../types';

/**
 * Entry order for invoice lists: the sequence the invoices were recorded in,
 * oldest first.
 *
 * The key is the day the invoice was booked (`created_at`, written once when
 * the invoice is minted). `issue_date` is NOT that day: editing a case's
 * delivery date rewrites it to the new delivery date (see `updateCase` in
 * AppContext), so an invoice booked in September can carry a November issue
 * date and jump the queue in a list sorted by it.
 *
 * Invoices booked on the same day are ordered by invoice number: the number is
 * minted in booking order by the reservation service, so it is the sequence the
 * operator entered them in. The id cannot break that tie — it is a random UUID.
 */
export const invoiceEntryDate = (
  invoice: Pick<Invoice, 'created_at' | 'issue_date'>,
): string => (invoice.created_at || invoice.issue_date || '').slice(0, 10);

/** Number-aware so INV-0099 sorts before INV-0100. */
const compareInvoiceNumbers = (a?: string, b?: string): number =>
  (a || '').localeCompare(b || '', undefined, { numeric: true });

/** Sort comparator for `Array.prototype.sort` — oldest recorded first. */
export const compareInvoiceEntryOrder = (a: Invoice, b: Invoice): number => {
  const dayA = invoiceEntryDate(a);
  const dayB = invoiceEntryDate(b);
  if (dayA !== dayB) return dayA < dayB ? -1 : 1;
  return compareInvoiceNumbers(a.invoice_number, b.invoice_number);
};
