import type { SavedVoucher, CaseNote } from '../../types';
import { vouchersRepo } from '../../db/repos';
import { isDatabaseReady } from '../../db/core';
import { mirrorSet } from './domainState';
import { assembleVoucher, buildVoucherCaseNote } from '../../services/voucherDomain';

/**
 * Voucher logging (audit finding F2) — the single `saveVoucherToSystem`
 * implementation extracted from AppContext: state prepend, SQLite
 * write-through with mirror refresh, the `[VOUCHER LOGGED]` case-note trail,
 * and the workflow trigger hook. Same surface and behavior as before.
 */
export function useVoucherLogging(options: {
  savedVouchers: SavedVoucher[];
  setSavedVouchers: React.Dispatch<React.SetStateAction<SavedVoucher[]>>;
  setCaseNotes: React.Dispatch<React.SetStateAction<Record<string, CaseNote[]>>>;
  actorName: string;
  onWorkflowTrigger: (event: string, payload: unknown) => void;
}) {
  const { savedVouchers, setSavedVouchers, setCaseNotes, actorName, onWorkflowTrigger } = options;

  const dbWrite = (fn: () => void): void => {
    if (!isDatabaseReady()) return;
    try {
      fn();
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.error('[cutover] DB write failed:', e?.message || e);
    }
  };

  // Same id shape as AppContext's genId: uuid when available, else ts+random.
  const genVoucherId = (): string => {
    const uuid = globalThis.crypto?.randomUUID?.();
    return uuid ? `vouch-${uuid}` : `vouch-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  };

  const saveVoucherToSystem = (voucherData: Omit<SavedVoucher, 'id' | 'created_at' | 'saved_by'>): SavedVoucher => {
    const newVoucher = assembleVoucher(voucherData, { id: genVoucherId(), savedBy: actorName });
    // Batch re-prints must not log the same voucher twice (audit C10): the
    // voucher number + case identify one print run. The updater gate below
    // also covers same-tick batches where the state prop is stale.
    if (savedVouchers.some((v) => v.voucher_number === newVoucher.voucher_number && v.case_id === newVoucher.case_id)) {
      return newVoucher;
    }
    setSavedVouchers((prev) =>
      prev.some((v) => v.voucher_number === newVoucher.voucher_number && v.case_id === newVoucher.case_id)
        ? prev
        : [newVoucher, ...prev]
    );

    // Persist to SQLite (mirror-keyed effect does not cover this collection)
    dbWrite(() => {
      vouchersRepo.insert(newVoucher);
      mirrorSet('savedVouchers', vouchersRepo.all());
    });

    const note: CaseNote | null = buildVoucherCaseNote(newVoucher, actorName);
    if (note) {
      setCaseNotes((prev) => {
        const list = prev[note.case_id] || [];
        if (list.some((n) => n.id === note.id)) return prev;
        return {
          ...prev,
          [note.case_id]: [note, ...list],
        };
      });
    }

    onWorkflowTrigger('VOUCHER_SAVED', newVoucher);
    return newVoucher;
  };

  return { saveVoucherToSystem };
}
