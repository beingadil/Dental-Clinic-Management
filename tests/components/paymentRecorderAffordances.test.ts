import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The payment recorder is the screen an operator uses when a patient hands over
 * cash, so it has to be short. Two things came off it:
 *
 *   - AUTO-FILL OLDEST FIRST. One click marked every open invoice oldest-first,
 *     which is almost never the split intended and left no chance to see what it
 *     had done before saving. An allocation is now one click per invoice, and
 *     that is the whole allocation.
 *
 *   - The clinic `<select>`. Replaced with the shared searchable ClinicPicker,
 *     which also removed a third copy of that dropdown.
 *
 * The allocation list is also folded away by default: a clinic with a long tail
 * of open invoices pushed the save button off the screen.
 *
 * Read from the source rather than rendered — the component needs the whole
 * AppContext, so a rendered test would mostly assert on the mock. What matters
 * here is which affordances exist and which do not, and those are plain text.
 */
const source = readFileSync(
  resolve(process.cwd(), 'src/components/billing/RecordTransactionModal.tsx'),
  'utf8',
);

describe('payment recorder', () => {
  it('has no auto-fill, and no leftover handler for one', () => {
    expect(source).not.toMatch(/Auto-Fill/);
    // Not just the button — the allocating logic itself must be gone, or it is
    // dead code waiting to be wired back up by a later change.
    expect(source).not.toMatch(/handleAutoAllocate/);
  });

  it('picks the clinic with the shared searchable component', () => {
    expect(source).toMatch(/from '\.\.\/common\/ui\/ClinicPicker'/);
    expect(source).toMatch(/<ClinicPicker/);
    // No `<select>` may be bound to the clinic any more. (The Payment Channel
    // `<select>` stays — four fixed methods, nothing to search.)
    expect(source).not.toMatch(/<select[^>]*value=\{clinicId\}/);
    expect(source).toMatch(/value=\{clinicId \|\| null\}/);
  });

  it('folds the allocation list away until it is asked for', () => {
    expect(source).toMatch(/const \[showAllocations, setShowAllocations\] = useState\(false\)/);
    expect(source).toMatch(/aria-expanded=\{showAllocations\}/);
  });

  it('still reports the allocation state on the collapsed header', () => {
    // Collapsing must not hide the numbers the operator needs at a glance, or
    // folding the list just moves the problem.
    expect(source).toMatch(/Allocated:/);
    expect(source).toMatch(/Unapplied Remainder:/);
    expect(source).toMatch(/Invoice Allocations \(\{clinicInvoices\.length\} Open Invoices\)/);
  });

  it('tells the operator when a deposit is unapplied and the list is closed', () => {
    expect(source).toMatch(/not applied to any invoice yet/);
  });

  it('keeps the per-invoice allocation path', () => {
    // Removing auto-fill must not remove the capability to settle a specific
    // invoice; that is what the register and the drawer are for.
    expect(source).toMatch(/handleAllocationChange/);
    expect(source).toMatch(/clinicInvoices\.map/);
  });

  it('shares one ClinicPicker rather than three copies of the dropdown', () => {
    // The other two surfaces must consume the same component, or the copies
    // drift apart again and the operator meets two different pickers.
    for (const file of [
      'src/components/billing/GeneralLedgerView.tsx',
      'src/components/billing/BatchInvoicePrintModal.tsx',
    ]) {
      const text = readFileSync(resolve(process.cwd(), file), 'utf8');
      expect(text, `${file} should import ClinicPicker`).toMatch(/ClinicPicker/);
      // And must not carry its own open/close/query state for a clinic list.
      expect(text, `${file} should not keep a private clinic dropdown`).not.toMatch(
        /isClinicDropdownOpen/,
      );
      expect(text, `${file} should not keep a private clinic filter`).not.toMatch(
        /clinicSearchText/,
      );
    }
  });
});