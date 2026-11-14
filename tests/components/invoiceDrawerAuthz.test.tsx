// @vitest-environment jsdom
/**
 * Authorization gates on the invoice drawer's destructive controls.
 *
 * The drawer is where a read-only role gets at money. These tests pin the two
 * properties that keep it safe: the control is genuinely disabled for a
 * non-privileged role (not merely styled slate), and it is enabled for one
 * holding the permission.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import type { Invoice } from '../../src/types';

vi.mock('../../src/context/AppContext', () => ({
  useApp: () => ({
    cases: [],
    accountAdjustments: [
      {
        id: 'adj-1',
        adjustment_number: 'CR-0001',
        lab_id: 'lab-1',
        lab_name: 'Cases Clinic',
        type: 'credit_note',
        amount: 5000,
        reason: 'Goodwill',
        date: '2026-10-02',
        recorded_by: 'Manager',
        created_at: '2026-10-02 09:00',
        invoice_id: 'inv-1',
        journal_id: null,
      },
    ],
    journalEntries: [],
    advancePayments: [],
    applyAdvanceCreditV2: () => true,
  }),
}));

import { InvoiceDetailDrawer } from '../../src/components/billing/InvoiceDetailDrawer';

afterEach(cleanup);

const INVOICE = {
  id: 'inv-1',
  invoice_number: 'INV-0042',
  case_id: 'case-1',
  case_number: 'DS-2001',
  lab_id: 'lab-1',
  lab_name: 'Cases Clinic',
  case_type_name: 'Zirconia Crown',
  doctor_name: 'Dr. Tariq Mahmood',
  patient_name: 'Ali Raza',
  amount: 30000,
  discount: 0,
  final_amount: 30000,
  amount_paid: 0,
  payment_status: 'unpaid',
  due_date: '2026-11-05',
  created_at: '2026-10-05 09:00',
  payments: [],
} as unknown as Invoice;

const noop = () => {};

const renderDrawer = (props: {
  canVoid?: boolean;
  canEditAdjustments?: boolean;
  canDeleteAdjustments?: boolean;
  onVoidInvoice?: () => void;
  onEditAdjustment?: () => void;
  onDeleteAdjustment?: () => void;
}) =>
  render(
    <InvoiceDetailDrawer
      isOpen
      onClose={noop}
      invoice={INVOICE}
      onOpenPaymentModal={noop}
      onOpenJournalModal={noop}
      onPrintInvoice={noop}
      onViewReceipt={noop}
      onDeletePayment={noop}
      onVoidInvoice={props.onVoidInvoice}
      onEditAdjustment={props.onEditAdjustment}
      onDeleteAdjustment={props.onDeleteAdjustment}
      canVoid={props.canVoid}
      canEditAdjustments={props.canEditAdjustments}
      canDeleteAdjustments={props.canDeleteAdjustments}
    />,
  );

describe('InvoiceDetailDrawer — write controls obey the permission matrix', () => {
  it('a non-privileged role cannot void the invoice; the button is disabled', () => {
    const onVoidInvoice = vi.fn();
    renderDrawer({ canVoid: false, onVoidInvoice });

    const btn = screen.getByRole('button', { name: /void invoice INV-0042/i });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(btn);
    expect(onVoidInvoice).not.toHaveBeenCalled();
  });

  it('an authorized role can void the invoice', () => {
    const onVoidInvoice = vi.fn();
    renderDrawer({ canVoid: true, onVoidInvoice });

    const btn = screen.getByRole('button', { name: /void invoice INV-0042/i });
    expect((btn as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(btn);
    expect(onVoidInvoice).toHaveBeenCalledTimes(1);
  });

  it('a non-privileged role cannot edit or delete the adjustment', () => {
    const onEditAdjustment = vi.fn();
    const onDeleteAdjustment = vi.fn();
    renderDrawer({ canEditAdjustments: false, canDeleteAdjustments: false, onEditAdjustment, onDeleteAdjustment });

    const edit = screen.getByRole('button', { name: 'Edit adjustment CR-0001' });
    const del = screen.getByRole('button', { name: 'Delete adjustment CR-0001' });
    expect((edit as HTMLButtonElement).disabled).toBe(true);
    expect((del as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(edit);
    fireEvent.click(del);
    expect(onEditAdjustment).not.toHaveBeenCalled();
    expect(onDeleteAdjustment).not.toHaveBeenCalled();
  });

  it('an authorized role can edit and delete the adjustment', () => {
    const onEditAdjustment = vi.fn();
    const onDeleteAdjustment = vi.fn();
    renderDrawer({ canEditAdjustments: true, canDeleteAdjustments: true, onEditAdjustment, onDeleteAdjustment });

    fireEvent.click(screen.getByRole('button', { name: 'Edit adjustment CR-0001' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete adjustment CR-0001' }));
    expect(onEditAdjustment).toHaveBeenCalledTimes(1);
    expect(onDeleteAdjustment).toHaveBeenCalledTimes(1);
  });
});
