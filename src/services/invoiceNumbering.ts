/**
 * Invoice-number reservation (B2 regression). The old minter read the
 * `invoices` render-state array; two `addCase` calls inside one render
 * window both saw the same list and minted the same INV-n — the sync then
 * aborted with UNIQUE constraint failed: invoices.invoice_number.
 *
 * This service sits ABOVE render state: every mint raises a high-water
 * mark, so two mints can never return the same number. The caller seeds
 * the floor from render state + retired (voided) numbers on each mount /
 * after each state change; the seed is monotonic (a lower seed never
 * lowers the mark). The syncCore UNIQUE healer remains the last line of
 * defence for rows that arrive already duplicated.
 */
let highestIssued = 0;

const parseSeq = (number: string): number => {
  const m = /INV-(\d+)/.exec(number || '');
  return m ? parseInt(m[1], 10) : 0;
};

/** Raise the high-water mark. `reset` re-seeds (dev/tests only). */
export function reserveInvoiceNumber(seenNumber: string | number, reset = false): number {
  if (reset) highestIssued = 0;
  const seq = typeof seenNumber === 'number' ? seenNumber : parseSeq(seenNumber);
  if (seq > highestIssued) highestIssued = seq;
  return highestIssued;
}

/**
 * Mint the next number. `floor()` must return what the CURRENT state
 * considers the highest live-or-retired sequence (the byte-identical
 * legacy generator output feeds it). Returns INV-%04d guaranteed unique
 * within this session.
 */
export function nextReservedInvoiceNumber(floor: () => string): string {
  reserveInvoiceNumber(floor());
  highestIssued += 1;
  return `INV-${String(highestIssued).padStart(4, '0')}`;
}
