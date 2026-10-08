// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

/* Two bugs are guarded here.

   1. The header read `getLabFinancialSummary`'s camelCase aliases
      (netOutstanding / advanceCreditBalance). The engine publishes snake_case
      fields and the aliases are legacy optionals, so every statement printed
      "Closing Balance: PKR 0" on a PKR 37,000 balance.

   2. The header showed the PERIOD debits and credits next to the ALL-TIME
      closing balance, so a "This Month" statement could not be added up by
      hand. Opening (B/F) is now the running balance carried into the window and
      Closing (C/F) the balance inside it, read off the ledger's
      `running_balance` — which already nets advances, credit notes and debit
      adjustments. */
let summary: Record<string, number> = {};
let ledger: Record<string, unknown>[] = [];
/* The invoice and deposit books are OPTIONAL in this stub: left undefined they
   are not exposed at all, which is what drives the header onto the
   financial-summary fallback for the closing balance and the advance wallet. */
let advances: Record<string, unknown>[] | undefined;
let invoices: Record<string, unknown>[] | undefined;

const BASE = {
  net_balance: 37000,
  outstanding_balance: 37000,
  advance_balance: 5000,
};

vi.mock('../../src/context/AppContext', () => ({
  useApp: () => {
    const ctx: Record<string, unknown> = {
      labs: [{ id: 'lab-1', name: 'Al-Noor Clinic', contact_person: 'Dr. Aslam' }],
      cases: [],
      brandingSettings: { appName: 'DENTAL SOLUTIONS', tagline: '', phone: '', email: '', address: '' },
      getLabFinancialSummary: () => summary,
      getLedgerEntries: () => ledger,
    };
    if (invoices) ctx.invoices = invoices;
    if (advances) ctx.advancePayments = advances;
    return ctx;
  },
}));

import { ClinicStatementModal } from '../../src/components/billing/ClinicStatementModal';

/** The indigo summary card holding the period, closing and remaining figures. */
const summaryCard = (label: string) => {
  const el = screen.getByText(label);
  return el.parentElement!.parentElement!;
};

const renderModal = () =>
  render(<ClinicStatementModal isOpen onClose={() => {}} clinicId="lab-1" />);

/** Local `YYYY-MM-DD`, `monthsAgo` months back from today. */
const dayIn = (monthsAgo: number, day = 5): string => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - monthsAgo);
  d.setDate(day);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const today = dayIn(0, new Date().getDate());

/** One ledger row as `buildLedgerEntries` emits it: `entry_type`, newest first. */
const row = (
  id: string,
  date: string,
  entry_type: string,
  debit: number,
  credit: number,
  running_balance: number,
) => ({
  id,
  date,
  entry_type,
  reference_number: `${entry_type.toUpperCase()}-${id}`,
  description: `${entry_type} narrative`,
  debit,
  credit,
  running_balance,
});

afterEach(() => {
  cleanup();
  summary = {};
  ledger = [];
  advances = undefined;
  invoices = undefined;
});

describe('ClinicStatementModal closing figures', () => {
  it('prints the closing balance carried by the ledger summary', () => {
    summary = { ...BASE };
    renderModal();

    expect(summaryCard('Closing Balance (C/F):').textContent).toContain('PKR 37,000');
  });

  it('prints the unallocated advance wallet only when the clinic holds one', () => {
    summary = { ...BASE };
    renderModal();

    const card = summaryCard('Closing Balance (C/F):');
    expect(card.textContent).toContain('Advance Credit in Wallet:');
    expect(card.textContent).toContain('PKR 5,000');
  });

  it('prints what the clinic still owes', () => {
    summary = { ...BASE };
    renderModal();

    expect(summaryCard('Remaining Due:').textContent).toContain('PKR 37,000');
  });

  it('shows a zero remaining and no wallet line when the clinic is in credit', () => {
    summary = { net_balance: -5000, outstanding_balance: 0, advance_balance: 0 };
    renderModal();

    expect(summaryCard('Remaining Due:').textContent).toContain('PKR 0');
    expect(screen.queryByText('Advance Credit in Wallet:')).toBeNull();
  });

  it('falls back to the legacy camelCase aliases', () => {
    summary = { netOutstanding: 25000, advanceCreditBalance: 3000 };
    renderModal();

    expect(summaryCard('Closing Balance (C/F):').textContent).toContain('PKR 25,000');
    expect(summaryCard('Remaining Due:').textContent).toContain('PKR 25,000');
    expect(summaryCard('Advance Credit in Wallet:').textContent).toContain('PKR 3,000');
  });
});

describe('ClinicStatementModal period figures', () => {
  /* Invoices 30,000 last month, 10,000 paid last month, 5,000 paid today and
     an 8,000 deposit today: 30,000 − 10,000 = 20,000 brought forward, then
     − 5,000 − 8,000 = 7,000 closing. */
  beforeEach(() => {
    ledger = [
      row('l3', today, 'advance_payment', 0, 8000, 7000),
      row('l4', today, 'payment', 0, 5000, 15000),
      row('l2', dayIn(1, 20), 'payment', 0, 10000, 20000),
      row('l1', dayIn(1, 5), 'invoice', 30000, 0, 30000),
    ];
    advances = [
      { id: 'adv-1', lab_id: 'lab-1', lab_name: 'Al-Noor Clinic', amount: 8000, remaining_amount: 8000, payment_date: today },
    ];
    summary = { ...BASE };
  });

  it('carries the opening balance into the period and closes on the period ledger', () => {
    renderModal();
    fireEvent.click(screen.getByText('This Month'));

    expect(summaryCard('Opening Balance (B/F):').textContent).toContain('PKR 20,000');
    expect(summaryCard('Closing Balance (C/F):').textContent).toContain('PKR 7,000');
    expect(summaryCard('Remaining Due:').textContent).toContain('PKR 7,000');
    // Deposit received but unspent, so the wallet line appears for this period.
    expect(summaryCard('Advance Credit in Wallet:').textContent).toContain('PKR 8,000');
  });

  it('shows only the period rows, so debits and credits add up to the closing balance', () => {
    renderModal();
    fireEvent.click(screen.getByText('This Month'));

    const card = summaryCard('Closing Balance (C/F):');
    expect(card.textContent).toContain('PKR 0'); // no invoice raised this month
    expect(card.textContent).toContain('PKR 13,000'); // 5,000 paid + 8,000 deposit
  });

  it('keeps the whole account balance on All Time', () => {
    renderModal();

    expect(summaryCard('Opening Balance (B/F):').textContent).toContain('PKR 0');
    expect(summaryCard('Closing Balance (C/F):').textContent).toContain('PKR 7,000');
  });

  it('subtracts advance already spent against invoices from the wallet', () => {
    invoices = [
      {
        id: 'inv-1',
        lab_id: 'lab-1',
        created_at: dayIn(1, 5),
        payments: [
          { id: 'p-1', amount: 3000, payment_date: today, payment_method: 'advance', payment_type: 'advance_allocation' },
        ],
      },
    ];
    renderModal();
    fireEvent.click(screen.getByText('This Month'));

    expect(summaryCard('Advance Credit in Wallet:').textContent).toContain('PKR 5,000');
  });

  it('leaves the balance untouched for a month with no movements', () => {
    renderModal();
    fireEvent.click(screen.getByText('Last Month'));

    const card = summaryCard('Closing Balance (C/F):');
    expect(card.textContent).toContain('PKR 20,000');
    expect(summaryCard('Remaining Due:').textContent).toContain('PKR 20,000');
  });
});

describe('ClinicStatementModal ledger rows', () => {
  it('labels every row with the entry type the ledger actually publishes', () => {
    ledger = [
      row('l2', today, 'payment', 0, 5000, 25000),
      row('l1', dayIn(0, 2), 'invoice', 30000, 0, 30000),
    ];
    renderModal();

    // `entry_type`, not the never-populated legacy `type` alias.
    expect(screen.getByText('payment')).toBeTruthy();
    expect(screen.getByText('invoice')).toBeTruthy();
  });
});
