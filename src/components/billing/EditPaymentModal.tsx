import React, { useEffect, useState } from 'react';
import { Trash2, CheckCircle2 } from 'lucide-react';
import { Modal } from '../common/ui';
import { GlassSelect } from '../common/ui/GlassSelect';
import { DatePickerSingle } from '../common/DatePickerSingle';
import { formatPKR, invoiceBalanceDue } from '../../services/financeDomain';
import type { PaymentRecord, PaymentMethod, Invoice } from '../../types';
import type { PaymentPatch } from '../../context/hooks/useTransactionCommands';

/**
 * Correct a payment that has already been recorded.
 *
 * A voucher is a correction of one document, not a new one, so this edits the
 * same row in place and the ledger is rebuilt from it. Amount, method, date and
 * reference are all editable because all four are things an operator mistypes:
 * the wrong cash figure, cash recorded for a bank transfer, today's date for
 * last week's cheque, a reference read off the wrong slip.
 */

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'cash', label: 'Cash in Hand' },
  { value: 'bank', label: 'Bank Transfer / Online / IBFT' },
  { value: 'cheque', label: 'Cheque / Demand Draft' },
  { value: 'advance', label: 'Clinic Credit Wallet' },
];

export interface EditPaymentModalProps {
  isOpen: boolean;
  payment: PaymentRecord | null;
  /** Open invoices for the clinic — used to show/edit the allocation trail. */
  invoices?: Invoice[];
  /** The clinic the payment belongs to. */
  labId?: string;
  /** False when the caller refuses the change (e.g. it would overpay). */
  onSave: (paymentId: string, patch: PaymentPatch) => boolean;
  onDelete: (payment: PaymentRecord) => void;
  onClose: () => void;
}

export const EditPaymentModal: React.FC<EditPaymentModalProps> = ({
  isOpen,
  payment,
  invoices = [],
  onSave,
  onDelete,
  onClose,
}) => {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [date, setDate] = useState('');
  const [reference, setReference] = useState('');
  const [error, setError] = useState('');
  const [allocations, setAllocations] = useState<{ invoiceId: string; amount: string }[]>([]);

  /* Re-seed from the voucher each time it opens. Reading into state on open
     rather than mutating the record means Cancel genuinely cancels, and two
     vouchers in a row do not bleed into each other's form. */
  useEffect(() => {
    if (!isOpen || !payment) return;
    setAmount(String(payment.amount ?? ''));
    setMethod((payment.payment_method as PaymentMethod) || 'cash');
    setDate(payment.payment_date || '');
    setReference(payment.reference_number || '');
    setError('');
    // Seed the allocation trail (the invoices this payment was adjusted
    // against). The payment carries its own allocations; fall back to the
    // single invoice_id when the trail is missing.
    const seed = (payment.allocations || []).map((a) => ({
      invoiceId: a.invoice_id,
      amount: String(a.amount ?? ''),
    }));
    if (seed.length === 0 && payment.invoice_id) {
      seed.push({ invoiceId: payment.invoice_id, amount: String(payment.amount ?? '') });
    }
    setAllocations(seed);
  }, [isOpen, payment]);

  if (!isOpen || !payment) return null;

  const save = () => {
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError('Enter an amount greater than zero.');
      return;
    }
    if (!date.trim()) {
      setError('Enter the date this payment was received.');
      return;
    }
    const parsedAllocs = allocations
      .map((a) => ({ invoiceId: a.invoiceId, amount: Number(a.amount) }))
      .filter((a) => a.amount > 0);
    const totalAllocated = parsedAllocs.reduce((s, a) => s + a.amount, 0);
    if (totalAllocated > parsed + 0.001) {
      setError(
        `Allocated ${formatPKR(totalAllocated)} is more than the ${formatPKR(parsed)} received. Reduce the allocations first.`,
      );
      return;
    }
    const ok = onSave(payment.id, {
      amount: parsed,
      payment_method: method,
      payment_date: date.trim(),
      reference_number: reference.trim(),
      allocations: parsedAllocs.length > 0 ? parsedAllocs : undefined,
    });
    if (!ok) {
      // The command refuses an amount that would take the invoice past settled.
      setError('That amount cannot be applied to this invoice. Reduce it, or record the excess as an advance deposit.');
      return;
    }
    onClose();
  };

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      label="Edit Payment Voucher"
      header={<span className="font-bold text-base">Edit Payment Voucher</span>}
      footer={
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => {
              onDelete(payment);
              onClose();
            }}
            className="px-3 py-2 bg-rose-50 hover:bg-rose-100 text-ink-danger text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer"
            title="Delete this voucher. The invoice stays and becomes unpaid again."
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete Voucher
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              className="px-4 py-2 ds-glass-pill text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              Save Changes
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-xs text-slate-600 leading-relaxed">
          {payment.payment_number || 'This payment'} for{' '}
          <strong>{formatPKR(payment.amount || 0)}</strong> against{' '}
          <strong>{payment.invoice_number || 'the clinic account'}</strong>. Saving
          rewrites the ledger entry to match, so the register, the general ledger
          and the printed invoice stay in agreement.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="edit-pay-amount" className="block text-xs font-semibold text-slate-700 mb-1">
              Amount (PKR) *
            </label>
            <input
              id="edit-pay-amount"
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full text-sm px-3 py-2 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label htmlFor="edit-pay-date" className="block text-xs font-semibold text-slate-700 mb-1">
              Payment Date *
            </label>
            <DatePickerSingle
              label="Payment Date"
              value={date}
              onChange={setDate}
              className="w-full"
            />
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="edit-pay-method" className="block text-xs font-semibold text-slate-700 mb-1">
              Payment Channel *
            </label>
            <GlassSelect
              value={method}
              onChange={(v) => setMethod(v as PaymentMethod)}
              ariaLabel="Payment channel"
              className="w-full px-3 py-2 text-sm"
              options={METHODS.map((m) => ({ value: m.value, label: m.label }))}
            />
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="edit-pay-ref" className="block text-xs font-semibold text-slate-700 mb-1">
              Reference / Cheque # / Slip ID
            </label>
            <input
              id="edit-pay-ref"
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="e.g. TR-998234 or CHQ-0021"
              className="w-full text-sm px-3 py-2 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </div>

        {allocations.length > 0 && (
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-slate-700">
                Adjusted Invoices (allocations)
              </label>
              <div className="space-y-1.5">
                {allocations.map((a, idx) => {
                  const inv = (invoices || []).find((i) => i.id === a.invoiceId);
                  return (
                    <div key={a.invoiceId} className="flex items-center gap-2 text-xs">
                      <span className="font-mono font-bold text-slate-800 w-24 truncate">
                        {inv?.invoice_number || a.invoiceId}
                      </span>
                      <span className="text-slate-500 flex-1">
                        {inv ? `balance ${formatPKR(invoiceBalanceDue(inv))}` : ''}
                      </span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={a.amount}
                        onChange={(e) =>
                          setAllocations((prev) =>
                            prev.map((x, i) => (i === idx ? { ...x, amount: e.target.value } : x)),
                          )
                        }
                        className="w-28 text-sm px-2 py-1 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 tabular-nums"
                      />
                    </div>
                  );
                })}
              </div>
              <p className="text-[11px] text-slate-500">
                Allocated: {formatPKR(allocations.reduce((s, a) => s + (Number(a.amount) || 0), 0))}
              </p>
            </div>
          )}

        {error && (
          <p role="alert" className="text-xs text-ink-danger bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
};

export default EditPaymentModal;