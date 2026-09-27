import type { SavedVoucher, CaseNote } from '../types';

/**
 * Voucher domain — voucher + workslip logging rules extracted from AppContext
 * (audit finding F2). Pure helpers: they build the records and the case-note
 * trail; persistence and state updates stay with the caller.
 */

const nowStamp = (): string => new Date().toISOString().replace('T', ' ').substring(0, 16);

/** Complete a voucher skeleton with identity + provenance fields. */
export const assembleVoucher = (
  voucherData: Omit<SavedVoucher, 'id' | 'created_at' | 'saved_by'>,
  identity: { id: string; savedBy: string; at?: string },
): SavedVoucher => ({
  ...voucherData,
  id: identity.id,
  created_at: identity.at ?? nowStamp(),
  saved_by: identity.savedBy,
});

/**
 * The standard case-note trail a logged voucher leaves on its case
 * (`[VOUCHER LOGGED] …`). Returns null for temp/new cases, which carry no
 * persistent case record yet.
 */
export const buildVoucherCaseNote = (
  voucher: SavedVoucher,
  author: string,
  at?: string,
): CaseNote | null => {
  if (!voucher.case_id || voucher.case_id === 'temp-new') return null;
  const isInv = voucher.voucher_type === 'invoice';
  return {
    id: `note-${Date.now()}`,
    case_id: voucher.case_id,
    note_text: `[VOUCHER LOGGED] Official ${isInv ? 'Invoice Voucher' : 'Workstation Job Slip'} (${voucher.voucher_number}) saved to system database.`,
    author,
    created_at: at ?? nowStamp(),
  };
};
