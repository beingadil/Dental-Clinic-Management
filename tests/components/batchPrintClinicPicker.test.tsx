// @vitest-environment jsdom
/**
 * The searchable clinic picker on the batch print dialog.
 *
 * It replaced a plain <select> that listed every clinic as an <option>. That
 * is fine at five clinics and unusable at fifty: the operator had to scroll a
 * native list to find the one they wanted, and could not type to narrow it.
 *
 * These tests pin the three things the <select> gave for free and the
 * hand-rolled dropdown has to earn: it opens, typing filters it, and choosing
 * an option actually re-scopes the invoice list.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

const { LABS, TODAY } = vi.hoisted(() => {
  const now = new Date();
  const TODAY = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`;
  return {
    TODAY,
    LABS: [
      { id: 'lab-1', name: 'Cedar Point Dental Care', doctor_name: 'Ayesha Siddiqui', city: 'Lahore' },
      { id: 'lab-2', name: 'Riverside Smile Centre', doctor_name: 'Imran Qureshi', city: 'Karachi' },
      { id: 'lab-3', name: 'Whitefield Dental Studio', doctor_name: 'Nadia Rehman', city: 'Islamabad' },
    ],
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
}));

/* One unpaid invoice per clinic, all dated today so they clear the modal's
   default Today period. The picker is only meaningful if choosing a clinic
   changes which invoices are listed. */
vi.mock('../../src/context/AppContext', () => ({
  useApp: () => ({
    labs: LABS,
    invoices: LABS.map((lab, i) => ({
      id: `inv-${i + 1}`,
      invoice_number: `INV-900${i + 1}`,
      case_id: `case-${i + 1}`,
      case_number: `DS-700${i + 1}`,
      lab_id: lab.id,
      lab_name: lab.name,
      case_type_name: 'Zirconia Crown',
      doctor_name: lab.doctor_name,
      patient_name: `Patient ${i + 1}`,
      amount: 30000,
      discount: 0,
      final_amount: 30000,
      amount_paid: 0,
      payment_status: 'pending',
      issue_date: TODAY,
      due_date: '',
      created_at: TODAY,
      payments: [],
    })),
    cases: [],
    brandingSettings: { appName: 'DENTAL SOLUTIONS', tagline: '', phone: '', email: '', address: '' },
    saveVoucherToSystem: () => {},
  }),
}));

import { BatchInvoicePrintModal } from '../../src/components/billing/BatchInvoicePrintModal';

afterEach(cleanup);

const trigger = () => document.querySelector('[role="combobox"]') as HTMLElement;
const options = () => Array.from(document.querySelectorAll('[role="option"]'));
const filterBox = () =>
  document.querySelector('input[placeholder="Type to filter clinics…"]') as HTMLInputElement;

/* The invoice number is rendered TWICE — once in the selection table and once
   on the print-preview sheet below it. Scope to the selection table, which is
   the one carrying a "Balance Due" column, so an assertion is about what the
   operator can select rather than about what the preview happens to print. */
/* The selection table is the FIRST table in the modal; the print preview sheet
   follows it. Selected structurally by position rather than by a column caption
   — matching on "Balance Due" coupled this test to a heading the invoice layout
   legitimately renamed to "Balance". A mis-target is not silent: every caller
   asserts on invoice numbers, which only this table carries. */
const selectionTable = () =>
  document.querySelector('table') as HTMLElement | null;

const listedInvoices = () =>
  Array.from(selectionTable()!.querySelectorAll('tbody tr')).map((tr) => tr.textContent || '');

const renderModal = () => render(<BatchInvoicePrintModal onClose={() => {}} />);

describe('BatchInvoicePrintModal clinic picker', () => {
  it('opens empty and lists every clinic', () => {
    renderModal();
    expect(trigger()).toBeTruthy();
    expect(options()).toHaveLength(0);

    fireEvent.click(trigger());
    // Each row carries the clinic name plus its doctor and city, so assert the
    // names are present rather than comparing whole-row text.
    const text = options().map((o) => o.textContent || '');
    expect(text).toHaveLength(3);
    for (const name of ['Cedar Point Dental Care', 'Riverside Smile Centre', 'Whitefield Dental Studio']) {
      expect(text.some((t) => t.includes(name))).toBe(true);
    }
  });

  it('filters on name, doctor and city as you type', () => {
    renderModal();
    fireEvent.click(trigger());

    fireEvent.change(filterBox(), { target: { value: 'riverside' } });
    expect(options()).toHaveLength(1);
    expect(options()[0].textContent).toContain('Riverside Smile Centre');

    // The doctor and the city are searchable too, not just the clinic name.
    fireEvent.change(filterBox(), { target: { value: 'nadia' } });
    expect(options()[0].textContent).toContain('Whitefield Dental Studio');

    fireEvent.change(filterBox(), { target: { value: 'karachi' } });
    expect(options()[0].textContent).toContain('Riverside Smile Centre');
  });

  it('says so when nothing matches, instead of showing an empty panel', () => {
    renderModal();
    fireEvent.click(trigger());
    fireEvent.change(filterBox(), { target: { value: 'zzzz' } });
    expect(screen.getByText('No clinic matches "zzzz"')).toBeTruthy();
    expect(options()).toHaveLength(0);
  });

  it('choosing a clinic re-scopes the list and closes the panel', () => {
    renderModal();
    // Defaults to the first clinic, whose invoice is the only one listed.
    expect(listedInvoices().some((t) => t.includes('INV-9001'))).toBe(true);
    expect(listedInvoices().some((t) => t.includes('INV-9002'))).toBe(false);

    fireEvent.click(trigger());
    const riverside = options().find((o) => o.textContent?.includes('Riverside'))!;
    fireEvent.click(riverside);

    // Panel closed, trigger now names the pick, and the list followed it.
    expect(options()).toHaveLength(0);
    expect(trigger().textContent).toContain('Riverside Smile Centre');
    expect(listedInvoices().some((t) => t.includes('INV-9002'))).toBe(true);
    expect(listedInvoices().some((t) => t.includes('INV-9001'))).toBe(false);
  });

  it('closes on an outside click rather than pinning itself open', () => {
    renderModal();
    fireEvent.click(trigger());
    expect(options().length).toBeGreaterThan(0);

    fireEvent.mouseDown(document.body);
    expect(options()).toHaveLength(0);
  });
});