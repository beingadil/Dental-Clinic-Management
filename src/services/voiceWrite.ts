/**
 * Strict, allow-listed parser for the two write actions voice may issue:
 * record a payment and record an advance deposit. Anything else is not writable.
 */
export interface WriteCommand {
  kind: 'payment' | 'advance';
  amount: number;
  clinicHint: string;
  invoiceNumber?: string;
  method: 'cash' | 'bank' | 'cheque';
}

const AMOUNT = /(?:pkr|rs\.?|rupees?)?\s*(\d[\d,]{0,12})/i;

const extractAmount = (text: string): number | null => {
  const m = text.match(AMOUNT);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};

const extractMethod = (text: string): WriteCommand['method'] => {
  const t = text.toLowerCase();
  if (/cheque|chk/.test(t)) return 'cheque';
  if (/cash/.test(t)) return 'cash';
  return 'bank';
};

const extractInvoice = (text: string): string | undefined => {
  const m = text.match(/(?:invoice|inv)[#:\s-]*(INV[-\d]+|\d{3,})/i);
  if (!m) return undefined;
  const num = m[1].toUpperCase();
  return /^INV/i.test(num) ? num : `INV-${num.padStart(4, '0')}`;
};

/** Extract clinic hint: "for X", "to X", "from X", or a bare trailing clinic-ish name. */
const extractClinicHint = (text: string): string => {
  const m = text.match(/(?:for|to|from|of)\s+([A-Za-z0-9 ()&-]{2,60})/i);
  return (m?.[1] || '').trim();
};

const isPayment = (t: string): boolean =>
  /^(record|add|post)\s+(a\s+)?(payment|receipt|collection)\b/i.test(t.trim())
  || /^receive\s+(a\s+)?payment\b/i.test(t.trim());

const isAdvance = (t: string): boolean =>
  /^(record|add|post)\s+(an\s+)?(advance|deposit)\b/i.test(t.trim())
  || /^record\s+advance\s+deposit\b/i.test(t.trim());

export const parseWriteCommand = (text: string): WriteCommand | null => {
  const t = (text || '').trim();
  if (!t) return null;
  const amount = extractAmount(t);
  const clinicHint = extractClinicHint(t);
  if (isPayment(t)) {
    if (amount === null || !clinicHint) return null;
    return { kind: 'payment', amount, clinicHint, invoiceNumber: extractInvoice(t), method: extractMethod(t) };
  }
  if (isAdvance(t)) {
    if (amount === null || !clinicHint) return null;
    return { kind: 'advance', amount, clinicHint, method: extractMethod(t) };
  }
  return null;
};
