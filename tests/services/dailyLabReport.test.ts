import { describe, it, expect } from 'vitest';
import {
  buildDailyLabReport,
  caseReceivedDate,
  invoiceIssuedDate,
  paymentDate,
} from '../../src/services/dailyLabReport';
import { buildDailyReportPdf } from '../../src/lib/pdf';
import type { DentalCase, Invoice } from '../../src/types';

const mkCase = (over: Partial<DentalCase> = {}): DentalCase =>
  ({
    id: 'c1',
    case_number: 'DS-0001',
    patient_name: 'Hadia',
    lab_id: 'lab-1',
    lab_name: 'Rahat Dental',
    case_type_id: 'ct-1',
    case_type_name: 'PFM Crown',
    doctor_name: 'Dr Haroon',
    selected_teeth: [26, 27],
    shade: 'A2',
    delivery_date: '2026-10-20',
    received_date: '2026-10-17',
    priority: 'normal',
    price: 30000,
    discount: 0,
    final_price: 28000,
    status: 'in_progress',
    created_at: '2026-10-17T09:00:00.000Z',
    updated_at: '2026-10-17T09:00:00.000Z',
    history: [],
    ...over,
  }) as DentalCase;

const mkInvoice = (over: Partial<Invoice> = {}): Invoice =>
  ({
    id: 'i1',
    invoice_number: 'INV-0001',
    case_id: 'c1',
    case_number: 'DS-0001',
    lab_id: 'lab-1',
    lab_name: 'Rahat Dental',
    case_type_name: 'PFM Crown',
    doctor_name: 'Dr Haroon',
    amount: 30000,
    discount: 2000,
    final_amount: 28000,
    amount_paid: 12000,
    payment_status: 'partial',
    issue_date: '2026-10-17',
    due_date: '2026-10-24',
    created_at: '2026-10-17T10:00:00.000Z',
    payments: [],
    ...over,
  }) as unknown as Invoice;

const mkPayment = (over: Record<string, unknown> = {}) =>
  ({
    id: 'p1',
    payment_number: 'PAY-0001',
    receipt_number: 'REC-0001',
    amount: 12000,
    payment_method: 'cash',
    payment_date: '2026-10-17',
    recorded_by: 'Tester',
    created_at: '2026-10-17T11:00:00.000Z',
    ...over,
  }) as any;

describe('the daily lab report counts the day', () => {
  it('lists the cases received in the window', () => {
    const report = buildDailyLabReport({
      cases: [
        mkCase({ id: 'c1', case_number: 'DS-0001', received_date: '2026-10-17' }),
        mkCase({ id: 'c2', case_number: 'DS-0002', received_date: '2026-10-16' }),
      ],
      invoices: [],
      advancePayments: [],
      from: '2026-10-17',
      to: '2026-10-17',
    });
    expect(report.received).toBe(1);
    expect(report.production).toHaveLength(1);
    expect(report.production[0].caseNumber).toBe('DS-0001');
  });

  it('carries the fields the operator reads the sheet for', () => {
    const report = buildDailyLabReport({
      cases: [mkCase()],
      invoices: [],
      advancePayments: [],
      from: '2026-10-17',
      to: '2026-10-17',
    });
    const row = report.production[0];
    expect(row.receivedDate).toBe('2026-10-17');
    expect(row.deliveryDate).toBe('2026-10-20');
    expect(row.caseType).toBe('PFM Crown');
    expect(row.doctor).toBe('Dr Haroon');
    expect(row.patient).toBe('Hadia');
    expect(row.clinic).toBe('Rahat Dental');
    expect(row.teeth).toBe('#26 #27');
  });

  it('falls back to created_at when no received date was recorded', () => {
    /* A case with no received date still arrived — it just was not recorded.
       Hiding it from the production sheet would understate the day's work. */
    const c = mkCase({ received_date: null, created_at: '2026-10-17T08:00:00.000Z' });
    expect(caseReceivedDate(c)).toBe('2026-10-17');
    const report = buildDailyLabReport({
      cases: [c],
      invoices: [],
      advancePayments: [],
      from: '2026-10-17',
      to: '2026-10-17',
    });
    expect(report.received).toBe(1);
  });

  it('excludes archived cases unless asked for them', () => {
    const archived = mkCase({ id: 'c9', case_number: 'DS-0009', archived_at: '2026-10-18T00:00:00.000Z' });
    const base = { invoices: [], advancePayments: [], from: '2026-10-17', to: '2026-10-17' };
    expect(buildDailyLabReport({ ...base, cases: [archived] }).received).toBe(0);
    expect(buildDailyLabReport({ ...base, cases: [archived], includeArchived: true }).received).toBe(1);
  });

  it('sorts newest first', () => {
    const report = buildDailyLabReport({
      cases: [
        mkCase({ id: 'c1', case_number: 'DS-0001', received_date: '2026-10-16' }),
        mkCase({ id: 'c2', case_number: 'DS-0002', received_date: '2026-10-18' }),
        mkCase({ id: 'c3', case_number: 'DS-0003', received_date: '2026-10-17' }),
      ],
      invoices: [],
      advancePayments: [],
      from: '2026-10-15',
      to: '2026-10-20',
    });
    expect(report.production.map((r) => r.caseNumber)).toEqual(['DS-0002', 'DS-0003', 'DS-0001']);
  });
});

describe('the daily lab report counts the money', () => {
  it('totals invoices raised in the window', () => {
    const report = buildDailyLabReport({
      cases: [],
      invoices: [
        mkInvoice({ id: 'i1', final_amount: 28000, issue_date: '2026-10-17' }),
        mkInvoice({ id: 'i2', final_amount: 5000, issue_date: '2026-10-10' }),
      ],
      advancePayments: [],
      from: '2026-10-17',
      to: '2026-10-17',
    });
    expect(report.invoicesRaised).toBe(1);
    expect(report.invoicedValue).toBe(28000);
  });

  it('totals payments received in the window', () => {
    const report = buildDailyLabReport({
      cases: [],
      invoices: [
        mkInvoice({ id: 'i1', payments: [mkPayment({ id: 'p1', amount: 12000, payment_date: '2026-10-17' })] }),
        mkInvoice({ id: 'i2', payments: [mkPayment({ id: 'p2', amount: 3000, payment_date: '2026-10-09' })] }),
      ],
      advancePayments: [],
      from: '2026-10-17',
      to: '2026-10-17',
    });
    expect(report.paymentsReceived).toBe(1);
    expect(report.paidValue).toBe(12000);
  });

  it('reports outstanding across the WHOLE lab, not just the window', () => {
    /* A day with no invoices does not mean the money stopped being owed. */
    const report = buildDailyLabReport({
      cases: [],
      invoices: [mkInvoice({ id: 'i1', final_amount: 28000, amount_paid: 12000, issue_date: '2026-10-01' })],
      advancePayments: [],
      from: '2026-10-17',
      to: '2026-10-17',
    });
    expect(report.invoicesRaised).toBe(0);
    expect(report.totalOutstanding).toBe(16000);
  });

  it('never reports a negative outstanding balance', () => {
    const report = buildDailyLabReport({
      cases: [],
      invoices: [mkInvoice({ id: 'i1', final_amount: 1000, amount_paid: 5000 })],
      advancePayments: [],
      from: '2026-10-17',
      to: '2026-10-17',
    });
    expect(report.totalOutstanding).toBe(0);
  });
});

describe('the daily lab report breaks down by clinic', () => {
  it('separates cases, invoices and payments per clinic', () => {
    const report = buildDailyLabReport({
      cases: [
        mkCase({ id: 'c1', lab_id: 'lab-1', lab_name: 'Rahat Dental', doctor_name: 'Dr Haroon' }),
        mkCase({ id: 'c2', lab_id: 'lab-2', lab_name: 'Asif Dental', doctor_name: 'Dr Asif' }),
      ],
      invoices: [
        mkInvoice({ id: 'i1', lab_id: 'lab-1', lab_name: 'Rahat Dental', final_amount: 28000 }),
        mkInvoice({ id: 'i2', lab_id: 'lab-2', lab_name: 'Asif Dental', final_amount: 5000, amount_paid: 0 }),
      ],
      advancePayments: [],
      from: '2026-10-17',
      to: '2026-10-17',
    });
    expect(report.clinics).toHaveLength(2);
    const rahat = report.clinics.find((c) => c.labName === 'Rahat Dental')!;
    const asif = report.clinics.find((c) => c.labName === 'Asif Dental')!;
    expect(rahat.casesReceived).toBe(1);
    expect(rahat.invoicedValue).toBe(28000);
    expect(rahat.doctor).toBe('Dr Haroon');
    expect(asif.casesReceived).toBe(1);
    expect(asif.outstanding).toBe(5000);
  });

  it('omits clinics with nothing in the window and no balance', () => {
    const report = buildDailyLabReport({
      cases: [mkCase({ id: 'c1', lab_id: 'lab-1', lab_name: 'Rahat Dental' })],
      invoices: [],
      advancePayments: [],
      from: '2026-10-17',
      to: '2026-10-17',
    });
    expect(report.clinics.map((c) => c.labName)).toEqual(['Rahat Dental']);
  });
});

describe('overdue is measured against the window, not against receipt', () => {
  it('flags a case whose delivery date has passed and is not delivered', () => {
    const report = buildDailyLabReport({
      cases: [mkCase({ received_date: '2026-10-10', delivery_date: '2026-10-15', status: 'in_progress' })],
      invoices: [],
      advancePayments: [],
      from: '2026-10-01',
      to: '2026-10-20',
    });
    // Five days of lead time were given, and the 15th has passed by the 20th.
    expect(report.production[0].daysToDelivery).toBe(5);
    expect(report.production[0].daysRemaining).toBe(-5);
    expect(report.production[0].isOverdue).toBe(true);
    expect(report.overdue).toBe(1);
  });

  it('does not flag a case that is still within its lead time', () => {
    /* Received on the 18th, due on the 20th, report run on the 18th: two days
       of lead time remain. It is NOT late on the day it arrived. */
    const report = buildDailyLabReport({
      cases: [mkCase({ received_date: '2026-10-18', delivery_date: '2026-10-20', status: 'in_progress' })],
      invoices: [],
      advancePayments: [],
      from: '2026-10-18',
      to: '2026-10-18',
    });
    expect(report.production[0].daysToDelivery).toBe(2);
    expect(report.production[0].daysRemaining).toBe(2);
    expect(report.production[0].isOverdue).toBe(false);
    expect(report.overdue).toBe(0);
  });

  it('does not flag a delivered case', () => {
    const report = buildDailyLabReport({
      cases: [mkCase({ received_date: '2026-10-10', delivery_date: '2026-10-15', status: 'delivered' })],
      invoices: [],
      advancePayments: [],
      from: '2026-10-01',
      to: '2026-10-20',
    });
    expect(report.production[0].isOverdue).toBe(false);
    expect(report.overdue).toBe(0);
  });
});

describe('the PDF export', () => {
  /** The report's rows, shaped the way the PDF builder wants them. */
  const pdfRows = () => [
    {
      caseNumber: 'DS-0001',
      receivedDate: '2026-10-17',
      caseType: 'PFM Crown',
      patient: 'Hadia',
      doctor: 'Dr Haroon',
      clinic: 'Rahat Dental',
      deliveryDate: '2026-10-20',
      daysLate: 0,
      fee: 28000,
    },
  ];

  const meta = {
    labName: 'Dental Lab',
    periodLabel: '2026-10-17 → 2026-10-17',
    generatedOn: '2026-10-20',
    invoicesRaised: 1,
    invoicedValue: 28000,
    paymentsReceived: 0,
    paidValue: 0,
    totalOutstanding: 28000,
  };

  it('writes a real PDF, not a picture of one', () => {
    const { pdf, pageCount } = buildDailyReportPdf(pdfRows(), [], meta);
    // A PDF starts with a header and ends with the trailer. A screenshot
    // would be neither.
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(pageCount).toBeGreaterThan(0);
  });

  it('carries the report as selectable text, not as pixels', () => {
    const { pdf } = buildDailyReportPdf(pdfRows(), [], meta);
    // The strings live in the content stream as literal text operators.
    expect(pdf).toContain('DAILY LAB REPORT');
    expect(pdf).toContain('PRODUCTION SHEET');
    expect(pdf).toContain('DS-0001');
    expect(pdf).toContain('PFM Crown');
    expect(pdf).toContain('PKR 28,000');
  });

  it('gives the clinic breakdown a page of its own', () => {
    const one = buildDailyReportPdf(pdfRows(), [], meta).pageCount;
    const two = buildDailyReportPdf(
      pdfRows(),
      [
        {
          clinicName: 'Rahat Dental',
          doctor: 'Dr Haroon',
          casesReceived: 1,
          casesDue: 1,
          invoicedValue: 28000,
          paidValue: 0,
          outstanding: 28000,
        },
      ],
      meta
    ).pageCount;
    expect(two).toBe(one + 1);
  });

  it('marks a case that went past its delivery date', () => {
    const { pdf } = buildDailyReportPdf(
      [{ ...pdfRows()[0], deliveryDate: '2026-10-14', daysLate: 3 }],
      [],
      meta
    );
    expect(pdf).toContain('3d late');
  });
});

describe('the date helpers', () => {
  it('reads the business date, not the record time', () => {
    expect(invoiceIssuedDate(mkInvoice({ issue_date: '2026-10-17' }))).toBe('2026-10-17');
    expect(paymentDate(mkPayment({ payment_date: '2026-10-17' }))).toBe('2026-10-17');
  });
});
