// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, fireEvent, within } from '@testing-library/react';

/* An invoice belongs to the period it was ENTERED in, not the period its
   delivery date happens to fall in.

   `updateCase` used to copy the case's delivery date over `issue_date` on
   every re-price. A batch entered on 31 October therefore carried a November
   "issue date", and Print Invoices — which filtered on `issue_date` — listed
   it under November while the statement's balance block (which posts at
   `created_at`) counted it in October. The operator set "This Month", saw
   October's work in the preview, and could not tell which figure to trust.

   These tests pin the rule the ledger already follows: the booking day
   (`created_at`) is the invoice's accounting date. `issue_date` is a printed
   property and may have been rewritten to a delivery date. */

const { LAB, TODAY, ENTERED } = vi.hoisted(() => {
  const now = new Date();
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return {
    TODAY: iso(now),
    // Last day of the previous month: always a different period, whatever
    // day the suite runs on.
    ENTERED: iso(new Date(now.getFullYear(), now.getMonth(), 0)),
    LAB: { id: 'lab-1', name: 'Mir Dental', doctor_name: 'Dr. Bilal Mir' },
  };
});

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

const store = vi.hoisted(() => ({
  invoices: [] as unknown[],
  cases: [] as unknown[],
  advances: [] as unknown[],
}));

vi.mock('../../src/context/AppContext', () => ({
  useApp: () => ({
    labs: [LAB],
    invoices: store.invoices,
    cases: store.cases,
    advancePayments: store.advances,
    accountAdjustments: [],
    brandingSettings: {
      appName: 'DENTAL SOLUTIONS',
      tagline: '',
      phone: '',
      email: '',
      address: '',
    },
    saveVoucherToSystem: () => {},
    setCurrentView: () => {},
    updateBrandingSettings: () => {},
  }),
}));

import { PrintInvoicesView } from '../../src/components/billing/PrintInvoicesView';

// jsdom has no ResizeObserver; the preview's fit hook only needs the shape.
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

const mkCase = () => ({
  id: 'case-1',
  case_number: 'DS-0393',
  patient_name: 'Nabeel Ashraf',
  lab_id: 'lab-1',
  lab_name: 'Mir Dental',
  case_type_name: 'PFM',
  doctor_name: 'Dr. Bilal Mir',
  selected_teeth: [26],
  shade: 'A2',
  material: 'PFM',
  received_date: ENTERED,
  delivery_date: TODAY,
  status: 'received',
  history: [],
});

const mkInvoice = () => ({
  id: 'inv-1',
  invoice_number: 'INV-0801',
  case_id: 'case-1',
  case_number: 'DS-0393',
  lab_id: 'lab-1',
  lab_name: 'Mir Dental',
  case_type_name: 'PFM',
  doctor_name: 'Dr. Bilal Mir',
  patient_name: 'Nabeel Ashraf',
  amount: 2000,
  discount: 0,
  final_amount: 2000,
  amount_paid: 0,
  payment_status: 'unpaid',
  // The delivery date, copied onto issue_date by the old re-price bug.
  issue_date: TODAY,
  due_date: TODAY,
  created_at: ENTERED,
  payments: [],
});

/** The on-screen choose-list is the first table on the page. */
const pickerTable = (container: HTMLElement) => container.querySelector('table') as HTMLTableElement;

const renderView = () => {
  store.invoices = [mkInvoice()];
  store.cases = [mkCase()];
  store.advances = [];
  return render(<PrintInvoicesView />);
};

const openPreset = (label: string) => {
  const trigger = Array.from(document.querySelectorAll('button[aria-haspopup="dialog"]')).find(
    (b) => (b.textContent || '').trim() === label,
  );
  fireEvent.click(trigger as HTMLElement);
  const preset = Array.from(document.querySelectorAll('[role="dialog"] button')).find(
    (b) => (b.textContent || '').trim() === 'All Time',
  );
  fireEvent.click(preset as HTMLElement);
};

describe('Print Invoices period follows the booking day', () => {
  it('does not file an invoice under a delivery date that leaked into issue_date', () => {
    const { container } = renderView();

    // The invoice was entered last month. Its issue_date says today, but that
    // is the delivery date, not a reason to pull it into today's batch.
    expect(container.textContent).not.toContain('INV-0801');
    expect(container.textContent).toContain('No invoices in this period');
  });

  it('lists it under All Time with the day it was entered, not the delivery date', () => {
    const { container } = renderView();
    openPreset('Today');

    const table = pickerTable(container);
    const row = within(table).getByText('INV-0801').closest('tr') as HTMLElement;
    expect(within(row).getByText(ENTERED)).toBeTruthy();
    expect(within(row).queryByText(TODAY)).toBeNull();
  });

  it('warns on screen when an unallocated advance is held', () => {
    const { container } = renderView();
    store.advances = [
      {
        id: 'adv-1',
        lab_id: 'lab-1',
        amount: 5000,
        allocated_amount: 0,
        remaining_amount: 5000,
        payment_date: ENTERED,
        created_at: ENTERED,
      },
    ];
    openPreset('Today');

    expect(container.textContent).toContain(
      'is held on account and is not applied to these invoices',
    );
  });
});
