// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

/* The ledger used to cap at 400 rows to stay responsive, which silently hid
   the rest of a long statement from the preview while the PDF still contained
   every row. It now windows the real table: only the rows near the viewport
   mount, and scrolling brings later rows in without a load-more step. */
const store = vi.hoisted(() => {
  const entries = Array.from({ length: 1500 }, (_, i) => ({
    id: `led-${i}`,
    date: `2026-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
    entry_type: 'payment',
    reference_number: `PAY-${String(i).padStart(5, '0')}`,
    description: `Receipt ${i}`,
    lab_id: 'lab-1',
    lab_name: 'Cases Clinic',
    payment_method: 'bank',
    debit: 0,
    credit: 100,
    running_balance: 0,
  }));
  return { entries };
});

vi.mock('../src/context/AppContext', () => ({
  useApp: () => ({
    labs: [{ id: 'lab-1', name: 'Cases Clinic' }],
    cases: [],
    invoices: [],
    accountAdjustments: [],
    brandingSettings: { appName: 'DENTAL SOLUTIONS', lab_name: 'DENTAL SOLUTIONS' },
    getLedgerEntries: () => store.entries,
    user: { id: 'u1', name: 'Tester', role: 'Super Admin' },
  }),
}));

import { GeneralLedgerView } from '../src/components/billing/GeneralLedgerView';

afterEach(cleanup);

const renderLongLedger = () => {
  const view = render(<GeneralLedgerView />);
  fireEvent.click(screen.getByText(/select clinic/i));
  fireEvent.click(screen.getByText('Cases Clinic'));
  fireEvent.click(screen.getByRole('button', { name: /^today$/i }));
  fireEvent.click(screen.getByRole('button', { name: 'All Time' }));
  fireEvent.click(screen.getByRole('button', { name: /preview/i }));
  return view;
};

describe('General Ledger long-table windowing', () => {
  it('mounts only the visible window, not all 1,500 rows', () => {
    const { container } = renderLongLedger();
    const mounted = container.querySelectorAll('tbody tr[data-index]').length;
    expect(mounted).toBeGreaterThan(0);
    expect(mounted).toBeLessThan(50);
    expect(screen.getByText('1500 entries')).toBeTruthy();
  });

  it('brings a distant row in when the table scrolls', () => {
    const { container } = renderLongLedger();
    const scroller = container.querySelector('.overflow-auto') as HTMLDivElement;
    expect(scroller).toBeTruthy();

    fireEvent.scroll(scroller, { target: { scrollTop: 72000 } });

    expect(screen.getByText('PAY-00725')).toBeTruthy();
    expect(container.querySelectorAll('tbody tr[data-index]').length).toBeLessThan(50);
  });

  /* PAPER DOES NOT SCROLL. A windowed table mounts only the rows near the
     viewport, so Ctrl+P used to print exactly the rows that happened to be on
     screen — the rest of the statement was never in the document to print.
     beforeprint must therefore re-render the table in full before the browser
     takes its snapshot. */
  it('mounts every row for the printer when printing starts', () => {
    const { container } = renderLongLedger();
    const table = container.querySelector('table')!;
    expect(table.getAttribute('data-windowed')).toBe('true');
    expect(container.querySelectorAll('tbody tr').length).toBeLessThan(50);

    fireEvent(window, new Event('beforeprint'));

    expect(table.getAttribute('data-windowed')).toBe('false');
    // All 1,500 rows, plus the totals row — nothing left in the window only.
    expect(container.querySelectorAll('tbody tr').length).toBeGreaterThanOrEqual(1500);
    expect(screen.getByText('PAY-01499')).toBeTruthy();
    expect(screen.getByText('PAY-00000')).toBeTruthy();

    /* The scroller must also stop clipping: a max-height on paper cuts the
       statement off at one viewport, however many rows are mounted. */
    const scroller = container.querySelector('.overflow-auto') as HTMLDivElement | null;
    expect(scroller).toBeNull();

    fireEvent(window, new Event('afterprint'));

    expect(table.getAttribute('data-windowed')).toBe('true');
    expect(container.querySelectorAll('tbody tr').length).toBeLessThan(50);
  }, 20000);
});
