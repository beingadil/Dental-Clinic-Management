// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react';

const downloadCSV = vi.fn();
vi.mock('../../src/services/csvExport', () => ({
  downloadCSV: (...args: unknown[]) => downloadCSV(...args),
}));

/* The Excel export is stubbed at the SAVE, not at the build: the workbook is
   part of what is under test, and a test has no disk to save to. */
const { saveFile } = vi.hoisted(() => ({
  saveFile: vi.fn(async (_name: string, _bytes: Uint8Array, _opts: unknown) => ({
    status: 'saved' as const,
    path: 'Monthly_Statement.xlsx',
    bytes: 2048,
    location: 'chosen' as const,
  })),
}));
vi.mock('../../src/lib/saveFile', () => ({ saveFile }));

/* `vi.hoisted` because the mock factory is hoisted above the file's own
   top-level declarations. */
const { downloadPdf } = vi.hoisted(() => ({
  downloadPdf: vi.fn(async (_name: string, _pdf: string, _title?: string) => ({
    status: 'saved' as const,
    path: 'Monthly_Statement.pdf',
    bytes: 1024,
    location: 'chosen' as const,
  })),
}));
/* The PDF BUILDER stays real — the document it produces is part of what is
   under test. Only the save is stubbed, because a test has no disk to save
   to and no reason to touch one. */
vi.mock('../../src/lib/pdf', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/pdf')>();
  return { ...actual, downloadPdf };
});

/* Same two-month fixture as the monthlyStatement service suite, so the numbers
   on screen are the numbers the domain proves: Feb bills 40,000 and banks a
   10,000 advance; Mar bills 25,000, collects 20,000 (15,000 cash + 5,000 from
   the wallet), spends 5,000 of advance credit and takes a 3,000 credit note. */
const { INVOICES, ADVANCES, ADJUSTMENTS } = vi.hoisted(() => {
  const invoices = [
    {
      id: 'inv-feb',
      invoice_number: 'INV-0001',
      case_id: 'case-feb',
      case_number: 'DS-3001',
      lab_id: 'lab-1',
      lab_name: 'Al-Noor Clinic',
      case_type_name: 'Zirconia Crown',
      doctor_name: 'Dr. Aslam',
      amount: 40000,
      discount: 0,
      final_amount: 40000,
      amount_paid: 15000,
      payment_status: 'partial',
      created_at: '2026-02-05 10:00',
      due_date: '2026-02-05',
      payments: [
        {
          id: 'p-bank',
          invoice_id: 'inv-feb',
          amount: 15000,
          payment_date: '2026-03-04',
          payment_method: 'bank',
          recorded_by: 'Tester',
        },
      ],
    },
    {
      id: 'inv-mar',
      invoice_number: 'INV-0002',
      case_id: 'case-mar',
      case_number: 'DS-3002',
      lab_id: 'lab-1',
      lab_name: 'Al-Noor Clinic',
      case_type_name: 'Emax Crown',
      doctor_name: 'Dr. Aslam',
      amount: 25000,
      discount: 0,
      final_amount: 25000,
      amount_paid: 5000,
      payment_status: 'partial',
      created_at: '2026-03-02 10:00',
      due_date: '2026-03-02',
      payments: [
        {
          id: 'p-adv',
          invoice_id: 'inv-mar',
          amount: 5000,
          payment_date: '2026-03-10',
          payment_method: 'advance',
          payment_type: 'advance_allocation',
          advance_payment_id: 'adv-1',
          recorded_by: 'Tester',
        },
      ],
    },
    {
      id: 'inv-beta',
      invoice_number: 'INV-0003',
      case_id: 'case-beta',
      case_number: 'DS-3003',
      lab_id: 'lab-2',
      lab_name: 'Beta Dental',
      case_type_name: 'Night Guard',
      doctor_name: 'Dr. Nadeem',
      amount: 12000,
      discount: 0,
      final_amount: 12000,
      amount_paid: 0,
      payment_status: 'unpaid',
      created_at: '2026-02-18 10:00',
      due_date: '2026-02-18',
      payments: [],
    },
  ];
  const advances = [
    {
      id: 'adv-1',
      payment_number: 'ADV-0001',
      lab_id: 'lab-1',
      lab_name: 'Al-Noor Clinic',
      amount: 10000,
      allocated_amount: 5000,
      remaining_amount: 5000,
      payment_method: 'bank',
      payment_date: '2026-02-20',
      recorded_by: 'Tester',
      created_at: '2026-02-20 14:00',
    },
  ];
  const adjustments = [
    {
      id: 'adj-1',
      adjustment_number: 'CR-0001',
      lab_id: 'lab-1',
      lab_name: 'Al-Noor Clinic',
      type: 'credit_note',
      amount: 3000,
      reason: 'Shade mismatch',
      date: '2026-03-15',
      recorded_by: 'Tester',
      created_at: '2026-03-15 16:00',
    },
  ];
  return { INVOICES: invoices, ADVANCES: advances, ADJUSTMENTS: adjustments };
});

vi.mock('../../src/context/AppContext', () => ({
  useApp: () => ({
    invoices: INVOICES,
    cases: [],
    savedVouchers: [],
    deleteSavedVoucher: () => {},
    advancePayments: ADVANCES,
    accountAdjustments: ADJUSTMENTS,
    labs: [],
    brandingSettings: { appName: 'Dental Solutions', lab_name: 'Dental Lab' },
    showToast: () => {},
  }),
}));

import { BillingReportsView } from '../../src/components/billing/BillingReportsView';

/** Newest month first, so tables[0] is March and tables[1] is February. */
const tables = () => screen.getAllByRole('table');
const clinicRow = (table: HTMLElement) =>
  within(table).getByText('Al-Noor Clinic').closest('tr') as HTMLElement;
const footerRow = (table: HTMLElement) =>
  within(table).getByText('Month Total').closest('tr') as HTMLElement;

/**
 * Read a figure by its column heading. Several money columns repeat the same
 * amount in one row (PKR 5,000 is both "Advance Used" and "Advance Credit"),
 * so positional lookup is the only way to assert which figure is which.
 */
const figure = (table: HTMLElement, row: HTMLElement, heading: string): string => {
  const headers = within(table).getAllByRole('columnheader').map((h) => h.textContent!.trim());
  const cells = within(row).getAllByRole('cell');
  return cells[headers.indexOf(heading)]?.textContent?.trim() ?? '';
};

const renderReports = () =>
  render(
    <BillingReportsView onPrintInvoice={() => {}} onViewCaseSlip={() => {}} />,
  );

afterEach(() => {
  cleanup();
  downloadCSV.mockClear();
  downloadPdf.mockClear();
  saveFile.mockClear();
});

describe('BillingReportsView monthly statement', () => {
  beforeEach(() => renderReports());

  it('shows one block per billing month, newest first', () => {
    expect(tables()).toHaveLength(2);
    expect(screen.getByText('March 2026')).toBeTruthy();
    expect(screen.getByText('February 2026')).toBeTruthy();
  });

  it('carries closing balance, advance credit and remaining as their own columns', () => {
    const [march] = tables();
    for (const heading of [
      'Billed (Dr)',
      'Collected (Cr)',
      'Advance In',
      'Advance Used',
      'Credit Notes',
      'Debit Adj.',
      'Opening (B/F)',
      'Closing (C/F)',
      'Advance Credit',
      'Remaining Due',
    ]) {
      expect(within(march).getByText(heading)).toBeTruthy();
    }
  });

  it('months the settlement by the month the cash landed', () => {
    const [march, february] = tables();
    // 15,000 bank + 5,000 from the advance wallet.
    expect(figure(march, clinicRow(march), 'Collected (Cr)')).toBe('PKR 20,000');
    // February's invoice was settled in March, so February collected nothing.
    expect(figure(february, clinicRow(february), 'Collected (Cr)')).toBe('PKR 0');
  });

  it('shows advance received and the unallocated wallet separately', () => {
    const [march, february] = tables();
    const febRow = clinicRow(february);
    expect(figure(february, febRow, 'Advance In')).toBe('PKR 10,000');
    expect(figure(february, febRow, 'Advance Used')).toBe('PKR 0');
    expect(figure(february, febRow, 'Advance Credit')).toBe('PKR 10,000');

    const marRow = clinicRow(march);
    // 5,000 spent against invoices, 5,000 still banked in the wallet.
    expect(figure(march, marRow, 'Advance Used')).toBe('PKR 5,000');
    expect(figure(march, marRow, 'Advance Credit')).toBe('PKR 5,000');
  });

  it('shows the balance brought forward, carried down and still owing', () => {
    const [march, february] = tables();
    const marRow = clinicRow(march);
    expect(figure(march, marRow, 'Opening (B/F)')).toBe('PKR 30,000'); // February's closing
    expect(figure(march, marRow, 'Closing (C/F)')).toBe('PKR 37,000');
    expect(figure(march, marRow, 'Remaining Due')).toBe('PKR 37,000');

    const febRow = clinicRow(february);
    expect(figure(february, febRow, 'Opening (B/F)')).toBe('PKR 0');
    expect(figure(february, febRow, 'Closing (C/F)')).toBe('PKR 30,000');
    expect(figure(february, febRow, 'Remaining Due')).toBe('PKR 30,000');
  });

  it('credits the credit note in the month it was issued', () => {
    expect(within(clinicRow(tables()[0])).getByText('PKR 3,000')).toBeTruthy();
    expect(within(clinicRow(tables()[1])).queryByText('PKR 3,000')).toBeNull();
  });

  it('totals each month in a footer', () => {
    const march = tables()[0];
    const footer = footerRow(march);
    expect(figure(march, footer, 'Cases Billed')).toBe('1');
    expect(figure(march, footer, 'Billed (Dr)')).toBe('PKR 25,000');
    expect(figure(march, footer, 'Closing (C/F)')).toBe('PKR 37,000');
    expect(figure(march, footer, 'Remaining Due')).toBe('PKR 37,000');
  });

  it('exports the same closing balance, advance credit and remaining due to Excel', async () => {
    fireEvent.click(screen.getByLabelText('Export the monthly statement as an Excel workbook'));
    await waitFor(() => expect(saveFile).toHaveBeenCalledTimes(1));

    const [fileName, bytes] = saveFile.mock.calls[0] as unknown as [string, Uint8Array];
    expect(fileName).toMatch(/\.xlsx$/);
    // A real workbook: a ZIP, with the parts inside it. The parts are STORED
    // rather than compressed, so the sheet XML can be read straight out.
    expect(bytes[0]).toBe(0x50); // 'P'
    expect(bytes[1]).toBe(0x4b); // 'K'
    const xml = new TextDecoder().decode(bytes);
    expect(xml).toContain('Monthly Statement');
    expect(xml).toContain('Al-Noor Clinic');
    // The figures are NUMBERS, not text — that is the whole point of a
    // workbook over a CSV.
    expect(xml).toContain('<v>37000</v>'); // March closing balance
    expect(xml).toContain('<v>5000</v>'); // March advance credit
  });
});

describe('choosing which clinics are in the statement', () => {
  beforeEach(() => renderReports());

  /** Open the clinic filter and untick the clinic with this name. */
  const excludeClinic = (name: string) => {
    fireEvent.click(screen.getByLabelText('Filter by dental clinic'));
    const option = screen
      .getAllByRole('option')
      .find((o) => (o.textContent || '').includes(name)) as HTMLElement;
    fireEvent.click(option);
  };

  it('takes a clinic out of every month at once', () => {
    // Newest month first, so February is the second table.
    expect(within(tables()[1]).getByText('Al-Noor Clinic')).toBeTruthy();
    expect(within(tables()[1]).getByText('Beta Dental')).toBeTruthy();

    excludeClinic('Beta Dental');

    // Beta Dental only ever traded in February, so that is the table that
    // has to lose it. March never had it.
    expect(within(tables()[1]).queryByText('Beta Dental')).toBeNull();
    expect(within(tables()[1]).getByText('Al-Noor Clinic')).toBeTruthy();
  });

  it('recomputes the month total from the clinics that are left', () => {
    /* The February month total covers both clinics: 40,000 + 12,000. Take
       one away and the total has to follow, or the footer is a lie. */
    const februaryTotal = () => figure(tables()[1], footerRow(tables()[1]), 'Billed (Dr)');
    expect(februaryTotal()).toBe('PKR 52,000');

    excludeClinic('Beta Dental');
    expect(februaryTotal()).toBe('PKR 40,000');
  });

  it('keeps a clinic that was filtered out of the running balance', () => {
    /* Al-Noor owes 30,000 at the end of February and that balance carries
       into March. Filtering February must not rewrite it. */
    excludeClinic('Beta Dental');
    const march = tables()[0];
    expect(figure(march, clinicRow(march), 'Opening (B/F)')).toBe('PKR 30,000');
    expect(figure(march, clinicRow(march), 'Closing (C/F)')).toBe('PKR 37,000');
  });

  it('exports the filtered statement, not the whole one', async () => {
    excludeClinic('Beta Dental');
    fireEvent.click(screen.getByLabelText('Export the monthly statement as an Excel workbook'));
    await waitFor(() => expect(saveFile).toHaveBeenCalledTimes(1));
    const [, bytes] = saveFile.mock.calls[0] as unknown as [string, Uint8Array];
    const xml = new TextDecoder().decode(bytes);
    expect(xml).not.toContain('Beta Dental');
    expect(xml).toContain('Al-Noor Clinic');
  });
});

describe('exporting the statement as a PDF', () => {
  beforeEach(() => renderReports());

  it('writes a real PDF document of the statement', async () => {
    fireEvent.click(screen.getByLabelText('Download the monthly statement as a PDF'));
    await waitFor(() => expect(downloadPdf).toHaveBeenCalledTimes(1));

    const [fileName, pdf] = downloadPdf.mock.calls[0] as unknown as [string, string];
    expect(fileName).toMatch(/^Monthly_Statement_.*\.pdf$/);
    // A real PDF, not a picture of one.
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf).toContain('MONTHLY STATEMENT');
    // The months in the document, in the order a statement reads.
    expect(pdf).toContain('MARCH 2026');
    expect(pdf).toContain('FEBRUARY 2026');
    expect(pdf).toContain('Al-Noor Clinic');
  });

  it('exports only the clinics that are in scope', async () => {
    fireEvent.click(screen.getByLabelText('Filter by dental clinic'));
    const option = screen
      .getAllByRole('option')
      .find((o) => (o.textContent || '').includes('Beta Dental')) as HTMLElement;
    fireEvent.click(option);

    fireEvent.click(screen.getByLabelText('Download the monthly statement as a PDF'));
    await waitFor(() => expect(downloadPdf).toHaveBeenCalledTimes(1));
    const [, pdf] = downloadPdf.mock.calls[0] as unknown as [string, string];
    expect(pdf).not.toContain('Beta Dental');
    expect(pdf).toContain('Al-Noor Clinic');
    // And the document says which scope it covers.
    expect(pdf).toContain('1 of 2 clinics');
  });
});