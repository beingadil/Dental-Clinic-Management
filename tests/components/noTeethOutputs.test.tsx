// @vitest-environment jsdom
/**
 * A catalog product that is not per-tooth work (retainer, healing post, a
 * denture try-in) is saved with `selected_teeth: []` and `shade: ''`. Every
 * OUTPUT surface keys off that emptiness — never off the catalog flag — so a
 * printed or stored artifact can never claim a tooth the case does not have.
 *
 * Before this, each surface invented its own placeholder when the case had no
 * teeth: the lab card said "Full Arch", the print renderer emitted an empty
 * "Shade: —", and the saved voucher note read "Teeth:  | Shade: N/A".
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

// Slips read branding; CaseDetailView pulls the notes/attachments panels too.
// Everything under test is prop-driven, so a stub context keeps this a pure
// render test rather than a booted AppContext.
vi.mock('../../src/context/AppContext', () => ({
  useApp: () => ({
    brandingSettings: { appName: 'DENTAL SOLUTIONS', tagline: '', phone: '', email: '', address: '' },
    caseNotes: {},
    addCaseNote: vi.fn(),
    editCaseNote: vi.fn(),
    deleteCaseNote: vi.fn(),
    caseAttachments: {},
    addCaseAttachment: vi.fn(),
    deleteCaseAttachment: vi.fn(),
    user: { id: 'u1', name: 'Tester', role: 'Technician' },
  }),
}));

import { JobSlipCard } from '../../src/components/print/JobSlipCard';
import { LabCardSlip } from '../../src/components/cases/LabCardSlip';
import { CaseDetailView } from '../../src/components/cases/CaseDetailView';
import { PrintDocument, DEFAULT_ENABLED } from '../../src/components/print/printRenderer';
import { SEP } from '../../src/components/print/printRenderer';
import { caseDetailLines } from '../../src/services/ledgerCaseDetail';
import type { BrandingSettings, DentalCase, Invoice } from '../../src/types';

afterEach(cleanup);

const baseCase: DentalCase = {
  id: 'c1',
  case_number: 'DS-2001',
  patient_name: 'Ali Raza',
  lab_id: 'lab-1',
  lab_name: 'Cases Clinic',
  case_type_id: 'ct-1',
  case_type_name: 'Retainer',
  doctor_name: 'Dr. Test',
  selected_teeth: [11, 12],
  shade: 'A2',
  material: 'Acrylic',
  delivery_date: '2026-12-20',
  received_date: '2026-10-03',
  priority: 'normal',
  price: 100,
  discount: 0,
  final_price: 100,
  instructions: '',
  status: 'received',
  created_at: '2026-10-01 09:00',
  updated_at: '2026-10-01 09:00',
  history: [],
};

/** The exact shape CaseDetailModal commits for a `needs_teeth: false` product. */
const toothlessCase: DentalCase = {
  ...baseCase,
  selected_teeth: [],
  shade: '',
  tooth_details: {},
};

const branding = { appName: 'DENTAL SOLUTIONS', lab_name: 'Dental Lab' } as BrandingSettings;

const invoice = {
  id: 'i1',
  invoice_number: 'INV-1',
  case_id: 'c1',
  case_number: 'DS-2001',
  lab_id: 'lab-1',
  lab_name: 'Cases Clinic',
  case_type_name: 'Retainer',
  doctor_name: 'Dr. Test',
  patient_name: 'Ali Raza',
  amount: 100,
  discount: 0,
  final_amount: 100,
  amount_paid: 0,
  payment_status: 'unpaid',
  status_v2: 'open',
  issue_date: '2026-10-01',
  payments: [],
  created_at: '2026-10-01',
} as unknown as Invoice;


describe('A case with no teeth (a product that is not per-tooth work)', () => {
  it('drops the teeth row on the 100×95 job tag', () => {
    render(<JobSlipCard caseData={toothlessCase} labName="DENTAL SOLUTIONS" />);
    // The tag already hid empty teeth — assert the row is genuinely absent,
    // not rendered with a blank or placeholder value.
    expect(screen.queryByText('Teeth')).toBeNull();
    // Still identifies the job.
    expect(screen.getByText('DS-2001')).toBeTruthy();
    expect(screen.getByText('Material')).toBeTruthy();
  });

  it('drops the Teeth No: and Shade: rows on the A4 lab card slip', () => {
    render(<LabCardSlip caseData={toothlessCase} />);
    expect(screen.queryByText('Teeth No:')).toBeNull();
    expect(screen.queryByText('Shade:')).toBeNull();
    // The old placeholder claimed a full arch that was never charted.
    expect(screen.queryByText('Full Arch')).toBeNull();
    // Material still prints.
    expect(screen.getByText('Retainer')).toBeTruthy();
  });

  it('drops the Teeth & Shade tile from the case detail view', () => {
    render(<CaseDetailView caseData={toothlessCase} onClose={vi.fn()} onEdit={vi.fn()} onStatusChange={vi.fn()} />);
    expect(screen.queryByText('Teeth & Shade')).toBeNull();
    // The rest of the facts grid is unaffected.
    expect(screen.getByText('Clinic')).toBeTruthy();
    expect(screen.getByText('Delivery Due')).toBeTruthy();
  });

  it('drops only the teeth row from the ledger / invoice case block', () => {
    const lines = caseDetailLines(toothlessCase);
    const labels = lines.map((l) => l.label);
    // Only TEETH is gated on charting: a retainer genuinely has no tooth list,
    // and a dash there would read as a charting failure. The two bench dates
    // are real — the operator dates every case that reaches the bench — so
    // hiding them with the tooth list dropped real data on exactly the rows a
    // clinic most needs. `shade` is empty on this fixture and drops itself
    // under the normal "omit a missing value" rule, not a charting gate.
    // CHANGED (compact invoice): `Units` joins the list. It is not charting-
    // gated, and for an uncharted product `billableUnits` floors at 1 — which
    // is exactly the number the printed invoice needs, so the retainer bills
    // as "1 unit" and never as "0 units" or a tooth list.
    expect(labels).toEqual(['Patient', 'Procedure', 'Units', 'Received Date', 'Delivery Date']);
    expect(lines.find((l) => l.label === 'Units')?.value).toBe('1 unit');
  });

  it('still prints a shade on an uncharted case when the operator recorded one', () => {
    // Shade and teeth are independent: a lab can shade-match a single piece
    // without charting an arch, and the value is real information.
    const lines = caseDetailLines({ ...toothlessCase, shade: 'A3' });
    expect(lines.find((l) => l.label === 'Shade')?.value).toBe('A3');
    expect(lines.map((l) => l.label)).not.toContain('Teeth');
  });

  it('prints who, what and how many on the batch statement row', () => {
    render(
      <PrintDocument
        kind="statement"
        sections={DEFAULT_ENABLED.statement}
        branding={branding}
        invoices={[invoice]}
        cases={[toothlessCase]}
        labName="Cases Clinic"
        period={{ from: '2026-10-01', to: '2026-10-31' }}
        page={{ page: 1, pageCount: 1 }}
        balanceInvoices={[invoice]}
        showBalance
      />
    );
    // CHANGED (compact invoice): the case block is no longer a bordered
    // two-column grid of labelled pairs. It is ONE inline line whose values are
    // joined with a middot, so the whole joined string is a single text node —
    // hence one exact lookup for the whole cell rather than one per label.
    // The facts are unchanged: who it is, what was made, and how much work.
    expect(screen.getByText(`Ali Raza${SEP}Retainer${SEP}1 unit`)).toBeTruthy();
    // ...carries no tooth list, because a retainer has none...
    expect(screen.queryByText('Teeth')).toBeNull();
    expect(screen.queryByText('Shade')).toBeNull();
    // ...and the promised day now comes off this row too: the compact invoice
    // drops Delivery Date (the bench date) from a billing row, not just the
    // charted tooth list. The received day lives in the leading `Date` column,
    // so it is neither repeated as a row nor printed twice.
    expect(screen.queryByText('Delivery Date')).toBeNull();
    expect(screen.queryByText('Dec 20, 2026')).toBeNull();
    expect(screen.queryByText('Received Date')).toBeNull();
    // This renders PrintDocument directly, so there is no `.print-doc-page`
    // wrapper to scope to — the statement IS the whole tree here.
    expect(screen.getByText('Date')).toBeTruthy();
    expect(screen.getByText('Oct 3, 2026')).toBeTruthy();
  });

  it('prints no teeth table, no odontogram and no shade label on the job slip', () => {
    render(
      <PrintDocument
        kind="job_slip"
        sections={DEFAULT_ENABLED.job_slip}
        branding={branding}
        caseData={toothlessCase}
      />
    );
    expect(screen.queryByText('Odontogram')).toBeNull();
    expect(screen.queryByText('Prep')).toBeNull();
    expect(screen.queryByText(/^Shade: $/)).toBeNull();
    expect(screen.queryByText(/Shade:/)).toBeNull();
    // Material keeps the shade section's slot rather than leaving it blank.
    expect(screen.getByText(/Material:/)).toBeTruthy();
    // The case still prints.
    expect(screen.getByText('DS-2001')).toBeTruthy();
  });

  it('omits teeth from the invoice line and case block, and states the unit count', () => {
    render(
      <PrintDocument
        kind="invoice"
        sections={DEFAULT_ENABLED.invoice}
        branding={branding}
        invoice={invoice}
        caseData={toothlessCase}
        // The "Case Details" block resolves its rows through `cases`, not
        // `caseData`, so the case list has to be supplied for it to render.
        cases={[toothlessCase]}
      />
    );
    expect(screen.queryByText(/^Teeth: /)).toBeNull();
    expect(screen.queryByText(/Shade A/)).toBeNull();
    // CHANGED (compact invoice): the line item used to be a cell holding the
    // product in its own <span> with "Teeth: ..." and "Material: ..." on
    // sub-lines. It is now ONE cell — "Ali Raza - Retainer, 1 unit" — so the
    // product name is a substring of that cell rather than a node of its own.
    // The assertion keeps its real intent: the product name and the unit count
    // both reach the printed sheet.
    expect(screen.getByText('Ali Raza - Retainer, 1 unit')).toBeTruthy();
    // The case block under it is one inline line too: same facts, labels and
    // box gone. The invoice case block omits Teeth and Delivery Date, so what
    // survives is who, what, how much work and when the job reached the bench.
    // `Received Date` is deliberately NOT in that line: it is printed once, in
    // its own "Date Received" field above the table, so the same day cannot
    // appear twice on one sheet.
expect(screen.getByText(`Ali Raza${SEP}Retainer${SEP}1 unit`)).toBeTruthy();
expect(screen.getByText(/Date Received:/)).toBeTruthy();
  });

  it('bills a toothless product as one unit, not zero', () => {
    render(
      <PrintDocument
        kind="job_slip"
        sections={DEFAULT_ENABLED.job_slip}
        branding={branding}
        caseData={toothlessCase}
      />
    );
    // A retainer is still one billable unit. `|| 1` guards the empty-teeth case
    // so the job slip never claims the lab produced zero pieces of work.
    // "Units" also heads the line-item table on the invoice, so match the Field
    // label specifically (the uppercase tracking style) and read its value.
    const label = screen
      .getAllByText('Units')
      .find((el) => el.className.includes('uppercase'));
    expect(label?.parentElement?.textContent).toBe('Units1');
  });
});

describe('A per-tooth case is unaffected', () => {
  it('still prints teeth and shade everywhere', () => {
    render(<JobSlipCard caseData={baseCase} labName="DENTAL SOLUTIONS" />);
    expect(screen.getByText('Teeth')).toBeTruthy();
    expect(screen.getByText('#11, #12')).toBeTruthy();
    expect(screen.getByText('Shade')).toBeTruthy();
    expect(screen.getByText('A2')).toBeTruthy();
    cleanup();

    render(<LabCardSlip caseData={baseCase} />);
    expect(screen.getByText('Teeth No:')).toBeTruthy();
    expect(screen.getByText('#11, #12')).toBeTruthy();
    expect(screen.getByText('Shade:')).toBeTruthy();
    cleanup();

    render(<CaseDetailView caseData={baseCase} onClose={vi.fn()} onEdit={vi.fn()} onStatusChange={vi.fn()} />);
    expect(screen.getByText('Teeth & Shade')).toBeTruthy();
    expect(screen.getByText('#11 #12')).toBeTruthy();
    cleanup();

    expect(caseDetailLines(baseCase).map((l) => l.label)).toEqual([
      'Patient',
      'Procedure',
      'Teeth',
      // CHANGED (compact invoice): the new unit row, straight after `Teeth`.
      // A per-tooth case is exactly the one that must read "2 units" rather
      // than a tooth list on a printed invoice.
      'Units',
      'Shade',
      'Received Date',
      'Delivery Date',
    ]);
  });

  it('still prints the teeth table and odontogram on the job slip', () => {
    render(
      <PrintDocument
        kind="job_slip"
        sections={DEFAULT_ENABLED.job_slip}
        branding={branding}
        caseData={baseCase}
      />
    );
    expect(screen.getByText('Odontogram')).toBeTruthy();
    expect(screen.getByText('#11')).toBeTruthy();
    expect(screen.getByText(/Shade:/)).toBeTruthy();
    // A2 appears twice — in the per-tooth table and in the shade summary.
    expect(screen.getAllByText('A2').length).toBeGreaterThan(0);
  });
});