// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, fireEvent, screen, within } from '@testing-library/react';

/*
 * ONE INVOICE, THREE SURFACES, ONE LABEL.
 *
 * The General Ledger badge, the invoice register chip and the printed invoice
 * all answer "where does this invoice stand?". They used to answer it from
 * three different inputs — the stored `payment_status`, the paid total, and a
 * private arithmetic — AND with three vocabularies ("Full", "Part paid",
 * "Partial"), so the same invoice could read Paid on one screen and Unpaid on
 * the one beside it.
 *
 * These tests take ONE fixture per state, render all three surfaces from it,
 * and assert the labels are not merely equivalent but the SAME THREE WORDS:
 * Paid / Partial / Unpaid. Every fixture's stored `payment_status` is stale on
 * purpose, because the regression that started this was a ledger trusting it.
 */

const { LAB, CASE, TODAY } = vi.hoisted(() => {
  const now = new Date();
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const today = iso(now);

  return {
    TODAY: today,
    LAB: { id: 'lab-1', name: 'Cases Clinic', doctor_name: 'Dr. Tariq', phone: '0300' },
    CASE: {
      id: 'case-1',
      case_number: 'DS-2001',
      patient_name: 'Ali Raza',
      lab_id: 'lab-1',
      lab_name: 'Cases Clinic',
      case_type_name: 'Zirconia Crown',
      doctor_name: 'Dr. Tariq',
      selected_teeth: [21],
      units_count: 1,
      shade: 'A2',
      material: 'Zirconia',
      received_date: today,
      delivery_date: today,
      status: 'received' as const,
      history: [],
    },
  };
});

const store = vi.hoisted(() => ({
  invoices: [] as Record<string, unknown>[],
  entries: [] as Record<string, unknown>[],
}));

/** 30,000 billed. Received and credited vary per fixture. */
const mkInvoice = (over: { amount_paid?: number; credit_notes_total?: number } = {}) => {
  const paid = over.amount_paid ?? 0;
  return {
    id: 'inv-1',
    invoice_number: 'INV-0042',
    case_id: 'case-1',
    case_number: 'DS-2001',
    lab_id: 'lab-1',
    lab_name: 'Cases Clinic',
    case_type_name: 'Zirconia Crown',
    doctor_name: 'Dr. Tariq',
    patient_name: 'Ali Raza',
    amount: 30000,
    discount: 0,
    final_amount: 30000,
    amount_paid: paid,
    credit_notes_total: over.credit_notes_total ?? 0,
    // Deliberately stale: none of the three surfaces may read it.
    payment_status: 'unpaid' as const,
    status_v2: 'open' as const,
    issue_date: TODAY,
    due_date: TODAY,
    created_at: TODAY,
    payments: paid > 0 ? [{ id: 'pay-1', payment_date: TODAY, amount: paid }] : [],
  };
};

const mkEntry = () => ({
  id: 'led-1',
  date: TODAY,
  lab_id: 'lab-1',
  lab_name: 'Cases Clinic',
  entry_type: 'invoice' as const,
  reference_id: 'inv-1',
  reference_number: 'INV-0042',
  case_id: 'case-1',
  case_number: 'DS-2001',
  description: 'Invoice for Zirconia Crown',
  debit: 30000,
  credit: 0,
  running_balance: 30000,
});

vi.mock('../../src/services/pdf', () => ({
  buildLedgerPdf: () => ({ pdf: new Uint8Array([1, 2, 3]) }),
  downloadPdf: () => Promise.resolve({ status: 'saved', path: 'x.pdf', bytes: 3 }),
}));

vi.mock('../../src/services/printSettings', () => ({
  loadPrintSettings: () => ({
    paper: 'a4',
    margin: 'normal',
    fontSize: 'normal',
    showLogo: true,
    logoPosition: 'left',
    jobSlipStyle: 'full',
  }),
  loadDocumentSections: (_kind: string, fallback: string[]) => [...fallback],
  loadStatementSectionsAdoptingBank: (fallback: string[]) => [...fallback],
  saveDocumentSections: () => {},
  isStatementBankExcluded: () => false,
  setStatementBankExcluded: () => {},
}));

vi.mock('../../src/context/AppContext', () => ({
  useApp: () => ({
    labs: [LAB],
    cases: [CASE],
    invoices: store.invoices,
    payments: [],
    advancePayments: [],
    accountAdjustments: [],
    brandingSettings: {
      appName: 'DENTAL SOLUTIONS',
      lab_name: 'DENTAL SOLUTIONS',
      tagline: '',
      phone: '',
      email: '',
      address: '',
    },
    getLedgerEntries: () => store.entries,
    setSelectedCaseForModal: () => {},
    setCurrentView: () => {},
    updateBrandingSettings: () => {},
    saveVoucherToSystem: () => {},
    user: { id: 'u1', name: 'Tester', role: 'Super Admin' },
  }),
}));

import { GeneralLedgerView } from '../../src/components/billing/GeneralLedgerView';
import { PrintInvoicesView } from '../../src/components/billing/PrintInvoicesView';
import { PrintDocument, DEFAULT_ENABLED } from '../../src/components/print/printRenderer';
import type { DentalCase, Invoice } from '../../src/types';

// jsdom has no ResizeObserver; the print preview's fit hook only needs the shape.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const WORDS = ['Paid', 'Partial', 'Unpaid'];

/**
 * The ledger shows nothing until a clinic is chosen and Preview is opened.
 * The date popover is portalled onto the body, so it is queried through
 * `screen` rather than the render container.
 */
const renderLedger = () => {
  const r = render(<GeneralLedgerView />);
  fireEvent.click(screen.getByText(/select clinic/i));
  fireEvent.click(screen.getByText('Cases Clinic'));
  fireEvent.click(screen.getByRole('button', { name: /^today$/i }));
  fireEvent.click(screen.getByRole('button', { name: 'All Time' }));
  fireEvent.click(screen.getByRole('button', { name: /preview/i }));
  return r;
};

const renderRegister = () => render(<PrintInvoicesView />);

const renderPrintedInvoice = (invoice: ReturnType<typeof mkInvoice>) =>
  render(
    <PrintDocument
      kind="invoice"
      sections={DEFAULT_ENABLED.invoice}
      branding={{
        appName: 'DENTAL SOLUTIONS',
        tagline: '',
        phone: '',
        email: '',
        address: '',
      }}
      invoice={invoice as unknown as Invoice}
      caseData={CASE as unknown as DentalCase}
    />,
  );

/** The status word inside the register row for this invoice, if any. */
const registerWord = (container: HTMLElement) => {
  const row = Array.from(container.querySelectorAll('tr')).find(
    (tr) =>
      tr.textContent?.includes('INV-0042') &&
      Array.from(tr.querySelectorAll('span')).some((s) =>
        WORDS.includes((s.textContent || '').trim()),
      ),
  );
  expect(row).toBeTruthy();
  const chip = Array.from(row!.querySelectorAll('span')).find((s) =>
    WORDS.includes((s.textContent || '').trim()),
  );
  return { row: row!, chip: chip! };
};

/** The status word printed on the sheet, or null when the column is gone. */
const printedStatusWord = (container: HTMLElement): string | null => {
  const cells = Array.from(container.querySelectorAll('td'))
    .map((td) => (td.textContent || '').trim())
    .filter((text) => WORDS.includes(text));
  expect(cells.length).toBeLessThanOrEqual(1);
  return cells[0] ?? null;
};

describe('the ledger, the register and the paper agree on one label', () => {
  const fixtures = [
    {
      name: 'nothing received',
      over: {},
      label: 'Unpaid',
      ledgerTitle: 'Outstanding PKR 30,000',
      balance: 'PKR 30,000',
    },
    {
      name: 'partly received and partly credited',
      // 30,000 billed, 10,000 received, 4,000 credited => 16,000 owed.
      over: { amount_paid: 10000, credit_notes_total: 4000 },
      label: 'Partial',
      ledgerTitle: 'Outstanding PKR 16,000',
      balance: 'PKR 16,000',
    },
    {
      name: 'settled in full',
      over: { amount_paid: 30000 },
      label: 'Paid',
      ledgerTitle: 'Settled in full',
      balance: 'PKR 0',
    },
  ];

  it.each(fixtures)(
    'reads $label on all three surfaces when $name',
    ({ over, label, ledgerTitle, balance }) => {
      const invoice = mkInvoice(over);
      store.invoices = [invoice];
      store.entries = [mkEntry()];

      // 1. The General Ledger badge, identified by the settlement it reports.
      const ledger = renderLedger();
      const badge = within(ledger.container).getByTitle(ledgerTitle);
      const ledgerLabel = (badge.textContent || '').trim();

      // 2. The invoice register chip on the invoice's own row. The row carries
      //    the balance too, so the word and the number are checked together.
      const register = renderRegister();
      const { row, chip } = registerWord(register.container);
      const registerLabel = (chip.textContent || '').trim();
      expect(row.textContent).toContain(balance);

      // 3. The printed invoice's status column.
      const printed = renderPrintedInvoice(invoice);
      const printedLabel = printedStatusWord(printed.container);

      // THE PIN: all three surfaces produced the SAME word, and it is the
      // expected one. A surface that drifts to another state, prints a word of
      // its own ("Full", "Part paid"), or drops the status column entirely,
      // fails here.
      expect([ledgerLabel, registerLabel, printedLabel]).toEqual([label, label, label]);
    },
  );
});
