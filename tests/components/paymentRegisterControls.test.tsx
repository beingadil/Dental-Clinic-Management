// @vitest-environment jsdom
/**
 * The payment register's correction controls.
 *
 * The register no longer reads the store or filters its own rows — it renders
 * whatever the page hands it (see services/transactionRegister). So this file
 * feeds it rows from the REAL builder and asserts the wiring the commands
 * cannot see: that a payment's amount is editable in place and commits exactly
 * once with a real number, that Delete appears on a payment entry and nowhere a
 * delete would be wrong, and that the audit-compliant Reversal control is gone
 * rather than merely unwired — a dead button left in the Actions column is what
 * a removed feature looks like when it is half-removed.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import type { Invoice, PaymentRecord } from '../../src/types';
import { buildUnifiedTransactions } from '../../src/services/transactionRegister';
import { TransactionRegister } from '../../src/components/billing/TransactionRegister';

const PAYMENT: PaymentRecord = {
  id: 'pay-slice-1-inv-1',
  payment_number: 'PAY-2026-0001',
  receipt_number: 'REC-2026-0001',
  invoice_id: 'inv-1',
  invoice_number: 'INV-0042',
  lab_id: 'lab-1',
  lab_name: 'Cases Clinic',
  amount: 10000,
  payment_method: 'bank',
  payment_date: '2026-10-05',
  recorded_by: 'Cashier',
  journal_id: 'jrn-1',
};

const INVOICE = {
  id: 'inv-1',
  invoice_number: 'INV-0042',
  case_number: 'DS-2001',
  patient_name: 'Ali Raza',
  lab_id: 'lab-1',
  lab_name: 'Cases Clinic',
  final_amount: 30000,
  amount_paid: 10000,
  payment_status: 'partial',
  due_date: '2026-11-05',
  payments: [PAYMENT],
} as unknown as Invoice;

const ADVANCE = {
  id: 'adv-1',
  payment_number: 'ADV-2026-0001',
  lab_id: 'lab-1',
  lab_name: 'Cases Clinic',
  amount: 5000,
  allocated_amount: 0,
  remaining_amount: 5000,
  payment_method: 'cash',
  payment_date: '2026-10-06',
  recorded_by: 'Cashier',
};

const ROWS = buildUnifiedTransactions({
  allPayments: [PAYMENT],
  advancePayments: [ADVANCE as never],
  accountAdjustments: [],
  invoices: [INVOICE],
});

afterEach(() => cleanup());

const noop = () => {};

const renderRegister = (over: Partial<React.ComponentProps<typeof TransactionRegister>> = {}) =>
  render(
    <TransactionRegister
      transactions={ROWS}
      onViewProof={noop}
      onPrintReceipt={noop}
      onDeletePayment={noop}
      onEditPaymentAmount={() => true}
      {...over}
    />,
  );

const amountInput = () => screen.getByLabelText(/^Amount of payment/);

describe('payment register correction controls', () => {
  it('offers the amount as an editable field on a payment entry', () => {
    renderRegister();

    const input = amountInput() as HTMLInputElement;
    expect(input.value).toBe('10000');
    expect(input.type).toBe('number');
  });

  it('commits a new amount once, on blur, with the number typed', () => {
    const onEditPaymentAmount = vi.fn((_payment: PaymentRecord, _amount: number) => true);
    renderRegister({ onEditPaymentAmount });

    const input = amountInput();
    fireEvent.change(input, { target: { value: '12500' } });
    // Still uncommitted: a half-typed figure must never reach the ledger.
    expect(onEditPaymentAmount).not.toHaveBeenCalled();

    fireEvent.blur(input);
    expect(onEditPaymentAmount).toHaveBeenCalledTimes(1);
    expect(onEditPaymentAmount.mock.calls[0][1]).toBe(12500);
    expect((onEditPaymentAmount.mock.calls[0][0] as PaymentRecord).id).toBe(PAYMENT.id);
  });

  it('commits on Enter as well, and snaps back when the command refuses', () => {
    const onEditPaymentAmount = vi.fn((_payment: PaymentRecord, _amount: number) => false);
    renderRegister({ onEditPaymentAmount });

    const input = amountInput() as HTMLInputElement;
    input.focus();
    fireEvent.change(input, { target: { value: '45000' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onEditPaymentAmount).toHaveBeenCalledTimes(1);
    expect(onEditPaymentAmount.mock.calls[0][1]).toBe(45000);
    // Refused (it would overpay the invoice): the row is the source of truth.
    expect(input.value).toBe('10000');
  });

  it('does not commit an unchanged or nonsensical amount', () => {
    const onEditPaymentAmount = vi.fn((_payment: PaymentRecord, _amount: number) => true);
    renderRegister({ onEditPaymentAmount });

    const input = amountInput();
    fireEvent.blur(input);
    fireEvent.change(input, { target: { value: '0' } });
    fireEvent.blur(input);
    fireEvent.change(input, { target: { value: '-5' } });
    fireEvent.blur(input);

    expect(onEditPaymentAmount).not.toHaveBeenCalled();
  });

  it('offers Delete on the payment entry', () => {
    const onDeletePayment = vi.fn();
    renderRegister({ onDeletePayment });

    fireEvent.click(screen.getByRole('button', { name: `Delete payment ${PAYMENT.payment_number}` }));
    expect(onDeletePayment).toHaveBeenCalledTimes(1);
    expect(onDeletePayment.mock.calls[0][0].id).toBe(PAYMENT.id);
  });

  it('hands the whole row to the receipt printer, so the page resolves the invoice', () => {
    const onPrintReceipt = vi.fn();
    renderRegister({ onPrintReceipt });

    fireEvent.click(screen.getByRole('button', { name: 'Print official payment slip' }));
    expect(onPrintReceipt).toHaveBeenCalledTimes(1);
    expect((onPrintReceipt.mock.calls[0][0] as { id: string }).id).toBe(PAYMENT.id);
  });

  it('has no reversal control left anywhere', () => {
    renderRegister();

    expect(screen.queryByLabelText(/reverse/i)).toBeNull();
    expect(screen.queryByTitle(/reverse/i)).toBeNull();
  });

  it('renders no filter bar of its own', () => {
    // The page owns the search, the date range and the clinic picker; a second
    // copy here is the thing this change removed.
    renderRegister();

    expect(screen.queryByPlaceholderText(/search/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /All Transactions/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Invoice Payments/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Export transactions CSV/ })).toBeNull();
  });

  it('shows no correction controls when the page supplies none', () => {
    // The register is also used read-only; a control that renders without a
    // handler behind it is the dead button this feature was meant to remove.
    renderRegister({ onDeletePayment: undefined, onEditPaymentAmount: undefined });

    expect(screen.queryByLabelText(/^Amount of payment/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Delete payment/ })).toBeNull();
    // The amount is still readable, just not editable.
    expect(screen.getByText('10,000')).toBeTruthy();
  });

  it('leaves an advance deposit without a delete path of its own', () => {
    // Deleting is scoped to payment entries: the register must not offer to
    // delete a money row it has no command for.
    renderRegister({ onDeletePayment: vi.fn() });

    expect(screen.queryByRole('button', { name: `Delete payment ${ADVANCE.payment_number}` })).toBeNull();
  });

  it('points an empty register at the page filters rather than a date picker of its own', () => {
    renderRegister({ transactions: [] });

    expect(screen.getByText(/No payments, advances or adjustments match the filters above/)).toBeTruthy();
  });
});
