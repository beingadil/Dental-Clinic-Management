import React, { useState, useMemo, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { Invoice, PaymentAttachment } from '../../types';
import { formatPKR } from '../../services/financeDomain';
import { 
  X, 
  DollarSign, 
  Wallet, 
  FileText, 
  ArrowDownLeft, 
  CheckCircle2, 
  AlertCircle, 
  Upload, 
  Scale, 
  Calendar, 
  Building2, 
  Split, 
  ShieldCheck,
  Percent,
  Plus
} from 'lucide-react';

interface RecordTransactionModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialMode?: 'payment' | 'advance' | 'credit_note' | 'advance_deposit' | 'refund';
  initialClinicId?: string;
  initialLabId?: string;
  initialInvoiceId?: string;
  onSuccess?: (result: { receiptNumber?: string }) => void;
}

export const RecordTransactionModal: React.FC<RecordTransactionModalProps> = ({
  isOpen,
  onClose,
  initialMode = 'payment',
  initialClinicId,
  initialLabId,
  initialInvoiceId,
  onSuccess
}) => {
  const effectiveClinicId = initialClinicId || initialLabId;
  const { 
    labs, 
    invoices, 
    advancePayments, 
    recordTransactionV2, 
    recordAdvanceDepositV2, 
    issueCreditNoteV2,
    recordAccountAdjustment,
    user
  } = useApp();

  const [mode, setMode] = useState<'payment' | 'advance' | 'credit_note' | 'refund'>(
    initialMode === 'advance_deposit' ? 'advance' : initialMode
  );
  const [clinicId, setClinicId] = useState<string>(effectiveClinicId || (labs[0]?.id || ''));
  const [amount, setAmount] = useState<number>(0);
  const [method, setMethod] = useState<'cash' | 'bank' | 'cheque' | 'advance'>('cash');
  const [date, setDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [referenceNumber, setReferenceNumber] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [saveRemainingAsAdvance, setSaveRemainingAsAdvance] = useState<boolean>(true);
  const [proofUrl, setProofUrl] = useState<string>('');
  const [proofName, setProofName] = useState<string>('');
  const [proofSize, setProofSize] = useState<string>('');
  const [proofType, setProofType] = useState<string>('');
  const [isVerified, setIsVerified] = useState<boolean>(true);

  // Credit Note specific
  const [creditReasonCode, setCreditReasonCode] = useState<string>('remake');
  const [creditReasonText, setCreditReasonText] = useState<string>('');
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string>(initialInvoiceId || '');

  // Split allocations for multi-invoice payment
  const [allocations, setAllocations] = useState<{ [invoiceId: string]: number }>({});

  // Reset when opening
  useEffect(() => {
    if (isOpen) {
      setMode(initialMode === 'advance_deposit' ? 'advance' : initialMode);
      if (initialClinicId) setClinicId(initialClinicId);
      if (initialInvoiceId) setSelectedInvoiceId(initialInvoiceId);
    }
  }, [isOpen, initialMode, initialClinicId, initialInvoiceId]);

  // Outstanding invoices for the selected clinic
  const clinicInvoices = useMemo(() => {
    return invoices.filter((inv) => {
      if (inv.lab_id !== clinicId) return false;
      const due = inv.final_amount - (inv.amount_paid || 0) - (inv.credit_notes_total || 0);
      return due > 0;
    });
  }, [invoices, clinicId]);

  // Selected clinic available advance wallet balance
  const clinicAdvanceWallet = useMemo(() => {
    return advancePayments
      .filter((a) => a.lab_id === clinicId && a.remaining_amount > 0 && !a.is_reversed)
      .reduce((sum, a) => sum + a.remaining_amount, 0);
  }, [advancePayments, clinicId]);

  // Total outstanding receivables for the clinic
  const clinicTotalDue = useMemo(() => {
    return clinicInvoices.reduce((sum, inv) => {
      const due = inv.final_amount - (inv.amount_paid || 0) - (inv.credit_notes_total || 0);
      return sum + Math.max(0, due);
    }, 0);
  }, [clinicInvoices]);

  // Initialize or adjust allocations whenever amount or clinic changes
  useEffect(() => {
    if (mode === 'payment') {
      if (selectedInvoiceId && clinicInvoices.some((i) => i.id === selectedInvoiceId)) {
        const target = clinicInvoices.find((i) => i.id === selectedInvoiceId);
        if (target) {
          const due = target.final_amount - (target.amount_paid || 0) - (target.credit_notes_total || 0);
          if (amount === 0) {
            setAmount(due);
            setAllocations({ [target.id]: due });
          } else {
            setAllocations({ [target.id]: Math.min(amount, due) });
          }
        }
      } else if (clinicInvoices.length > 0 && amount > 0) {
        // Auto-allocate FIFO
        let remaining = amount;
        const newAlloc: { [id: string]: number } = {};
        for (const inv of clinicInvoices) {
          if (remaining <= 0) break;
          const due = Math.max(0, inv.final_amount - (inv.amount_paid || 0) - (inv.credit_notes_total || 0));
          const take = Math.min(due, remaining);
          if (take > 0) {
            newAlloc[inv.id] = take;
            remaining -= take;
          }
        }
        setAllocations(newAlloc);
      }
    }
  }, [clinicId, selectedInvoiceId]);

  const totalAllocated = useMemo(() => {
    return Object.values(allocations).reduce((sum: number, v: number) => sum + (v || 0), 0);
  }, [allocations]);

  const unappliedRemainder = Math.max(0, amount - totalAllocated);

  if (!isOpen) return null;

  const handleAutoAllocate = () => {
    let remaining = amount;
    const newAlloc: { [id: string]: number } = {};
    for (const inv of clinicInvoices) {
      if (remaining <= 0) break;
      const due = Math.max(0, inv.final_amount - (inv.amount_paid || 0) - (inv.credit_notes_total || 0));
      const take = Math.min(due, remaining);
      if (take > 0) {
        newAlloc[inv.id] = take;
        remaining -= take;
      }
    }
    setAllocations(newAlloc);
  };

  const handleAllocationChange = (invId: string, val: number) => {
    setAllocations((prev) => ({
      ...prev,
      [invId]: Math.max(0, val || 0)
    }));
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setProofName(file.name);
      const reader = new FileReader();
      reader.onloadend = () => {
        setProofUrl(reader.result as string);
      };
      reader.readAsDataURL(file);
      // Honest metadata: record the real size and type, not placeholders.
      const sizeKb = file.size / 1024;
      setProofSize(sizeKb >= 1024 ? `${(sizeKb / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(sizeKb))} KB`);
      setProofType(file.type);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (amount <= 0 && mode !== 'credit_note') {
      alert('Please enter a valid amount greater than 0.');
      return;
    }

    const attachments: PaymentAttachment[] = proofUrl ? [{
      id: `att-${Date.now()}`,
      payment_id: '',
      file_name: proofName || 'payment_proof.png',
      file_url: proofUrl,
      file_type: proofType || 'image/png',
      file_size: proofSize || '—',
      uploaded_at: new Date().toISOString().replace('T', ' ').substring(0, 16),
      uploaded_by: user?.name || 'Staff'
    }] : [];

    if (mode === 'payment') {
      const allocationList = Object.entries(allocations)
        .filter(([_, amt]) => (amt as number) > 0)
        .map(([invoiceId, amt]) => ({ invoiceId, amount: amt as number }));

      const result = recordTransactionV2({
        clinicId,
        amount,
        method,
        date,
        referenceNumber,
        notes,
        attachments,
        allocations: allocationList,
        saveRemainingAsAdvance,
        isVerified
      });

      onClose();
      if (onSuccess) onSuccess({ receiptNumber: result.receiptNumber });
    } else if (mode === 'advance') {
      const result = recordAdvanceDepositV2({
        clinicId,
        amount,
        method: method === 'advance' ? 'bank' : method,
        date,
        referenceNumber,
        notes,
        attachments,
        isVerified
      });

      onClose();
      if (onSuccess) onSuccess({ receiptNumber: result.receiptNumber });
    } else if (mode === 'credit_note') {
      if (!selectedInvoiceId) {
        alert('Please select a target invoice for this credit note.');
        return;
      }
      issueCreditNoteV2({
        clinicId,
        invoiceId: selectedInvoiceId,
        amount,
        reasonCode: creditReasonCode,
        reasonText: creditReasonText || `Adjustment for ${creditReasonCode}`
      });

      onClose();
      if (onSuccess) onSuccess({});
    } else if (mode === 'refund') {
      recordAccountAdjustment(
        clinicId,
        'refund',
        amount,
        notes || 'Client advance refund',
        referenceNumber,
        attachments
      );
      onClose();
      if (onSuccess) onSuccess({});
    }
  };

  const selectedClinic = labs.find((l) => l.id === clinicId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 md:p-6 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-[96vw] xl:max-w-6xl 2xl:max-w-7xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 my-auto max-h-[94vh] flex flex-col">
        {/* Top Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/70">
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              Record Financial Transaction
            </h3>
            <p className="text-xs text-slate-500">
              Unified double-entry transaction manager & automated allocation engine
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mode Selector Tabs */}
        <div className="px-6 border-b border-slate-200 bg-white flex items-center gap-1 pt-2">
          <button
            type="button"
            onClick={() => setMode('payment')}
            className={`px-4 py-2.5 text-xs font-bold border-b-2 flex items-center gap-2 transition-colors cursor-pointer ${
              mode === 'payment'
                ? 'border-slate-900 text-slate-900 bg-slate-50/60'
                : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            <ArrowDownLeft className="w-4 h-4" />
            Collect Payment
          </button>
          <button
            type="button"
            onClick={() => setMode('advance')}
            className={`px-4 py-2.5 text-xs font-bold border-b-2 flex items-center gap-2 transition-colors cursor-pointer ${
              mode === 'advance'
                ? 'border-slate-900 text-slate-900 bg-slate-50/60'
                : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            <Wallet className="w-4 h-4" />
            Advance Deposit
          </button>
          <button
            type="button"
            onClick={() => setMode('credit_note')}
            className={`px-4 py-2.5 text-xs font-bold border-b-2 flex items-center gap-2 transition-colors cursor-pointer ${
              mode === 'credit_note'
                ? 'border-slate-900 text-slate-900 bg-slate-50/60'
                : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            <Percent className="w-4 h-4" />
            Credit Note / Write-Off
          </button>
          <button
            type="button"
            onClick={() => setMode('refund')}
            className={`px-4 py-2.5 text-xs font-bold border-b-2 flex items-center gap-2 transition-colors cursor-pointer ${
              mode === 'refund'
                ? 'border-slate-900 text-slate-900 bg-slate-50/60'
                : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            <DollarSign className="w-4 h-4" />
            Refund
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5 overflow-y-auto flex-1">
          {/* Clinic Selector & Quick Health Strip */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Dental Clinic / Doctor Account *
              </label>
              <div className="relative">
                <select
                  value={clinicId}
                  onChange={(e) => {
                    setClinicId(e.target.value);
                    setSelectedInvoiceId('');
                  }}
                  className="w-full text-xs px-3 py-2.5 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-slate-800 font-medium"
                >
                  {labs.map((lab) => (
                    <option key={lab.id} value={lab.id}>
                      {lab.name} ({lab.city || 'Clinic'})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Account Quick Health Box */}
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs flex flex-col justify-center">
              <div className="flex items-center justify-between text-slate-500 mb-1">
                <span>Net Outstanding:</span>
                <span className="font-bold text-slate-900 font-mono">{formatPKR(clinicTotalDue)}</span>
              </div>
              <div className="flex items-center justify-between text-slate-500">
                <span>Advance Credit:</span>
                <span className="font-semibold text-emerald-700 font-mono">{formatPKR(clinicAdvanceWallet)}</span>
              </div>
            </div>
          </div>

          {/* Amount & Date & Method */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Amount (PKR) *
              </label>
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-xs text-slate-400 font-semibold">PKR</span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={amount || ''}
                  onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
                  placeholder="0"
                  className="w-full text-sm font-semibold pl-12 pr-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-slate-900 font-mono"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Transaction Date *
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-800"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Payment Channel *
              </label>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value as any)}
                className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-800"
              >
                <option value="cash">Cash in Hand</option>
                <option value="bank">Bank Transfer / Online / IBFT</option>
                <option value="cheque">Cheque / Demand Draft</option>
                {mode === 'payment' && (
                  <option value="advance" disabled={clinicAdvanceWallet <= 0}>
                    Clinic Credit Wallet ({formatPKR(clinicAdvanceWallet)})
                  </option>
                )}
              </select>
            </div>
          </div>

          {/* Reference & Verification */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Reference / Cheque # / Deposit Slip ID
              </label>
              <input
                type="text"
                value={referenceNumber}
                onChange={(e) => setReferenceNumber(e.target.value)}
                placeholder="e.g. TR-998234 or CHQ-0021"
                className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-800"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Bank Statement Reconciliation Status
              </label>
              <div className="flex items-center gap-3 pt-1">
                <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isVerified}
                    onChange={(e) => setIsVerified(e.target.checked)}
                    className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500"
                  />
                  <span>Mark as verified / settled immediately</span>
                </label>
              </div>
            </div>
          </div>

          {/* Mode-Specific Body */}
          {mode === 'payment' && (
            <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Split className="w-4 h-4 text-indigo-600" />
                  <span className="text-xs font-bold text-slate-800">
                    Invoice Allocations ({clinicInvoices.length} Open Invoices)
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-slate-500">Allocated: <strong className="text-indigo-700 font-mono">{formatPKR(totalAllocated)}</strong></span>
                  {unappliedRemainder > 0 && (
                    <span className="text-amber-700 font-medium bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                      Unapplied Remainder: <strong className="font-mono">{formatPKR(unappliedRemainder)}</strong>
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={handleAutoAllocate}
                    className="text-indigo-600 hover:text-indigo-800 font-semibold underline"
                  >
                    Auto-Fill Oldest First
                  </button>
                </div>
              </div>

              {clinicInvoices.length === 0 ? (
                <div className="p-4 text-center text-xs text-slate-500 bg-white rounded-md border border-slate-200">
                  This clinic has <strong>0 open unpaid invoices</strong>. Any collected payment will be credited to their advance wallet as unapplied deposit.
                </div>
              ) : (
                <div className="max-h-48 overflow-y-auto space-y-2 pr-1">
                  {clinicInvoices.map((inv) => {
                    const due = Math.max(0, inv.final_amount - (inv.amount_paid || 0) - (inv.credit_notes_total || 0));
                    const currentAlloc = allocations[inv.id] || 0;
                    return (
                      <div
                        key={inv.id}
                        className={`p-2.5 rounded-lg border text-xs flex items-center justify-between transition-colors ${
                          currentAlloc > 0 ? 'bg-indigo-50/70 border-indigo-200' : 'bg-white border-slate-200'
                        }`}
                      >
                        <div className="flex-1 min-w-0 pr-3">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-slate-900">{inv.invoice_number}</span>
                            <span className="text-slate-500">• Due: {inv.due_date}</span>
                            {inv.patient_name && (
                              <span className="text-slate-600 truncate">• Pt: {inv.patient_name}</span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-500 mt-0.5">
                            Total: {formatPKR(inv.final_amount)} | Balance Due: <strong className="text-slate-800 font-mono">{formatPKR(due)}</strong>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleAllocationChange(inv.id, due)}
                            className="px-2 py-1 text-[10px] font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded transition-colors"
                          >
                            Pay Full
                          </button>
                          <div className="relative w-28">
                            <input
                              type="number"
                              min="0"
                              max={due}
                              value={currentAlloc || ''}
                              onChange={(e) => handleAllocationChange(inv.id, parseFloat(e.target.value) || 0)}
                              placeholder="0"
                              className="w-full text-xs font-mono font-semibold px-2 py-1 text-right border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white"
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {unappliedRemainder > 0 && (
                <div className="p-3 bg-indigo-50/50 rounded-lg border border-indigo-100 text-xs flex items-center justify-between">
                  <span className="text-slate-700">
                    Save unallocated amount (<strong>{formatPKR(unappliedRemainder)}</strong>) as advance deposit in clinic wallet?
                  </span>
                  <label className="flex items-center gap-2 cursor-pointer font-medium text-indigo-700">
                    <input
                      type="checkbox"
                      checked={saveRemainingAsAdvance}
                      onChange={(e) => setSaveRemainingAsAdvance(e.target.checked)}
                      className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500"
                    />
                    <span>Yes, Save to Wallet</span>
                  </label>
                </div>
              )}
            </div>
          )}

          {mode === 'credit_note' && (
            <div className="p-4 rounded-lg bg-amber-50/60 border border-amber-200 space-y-3">
              <div className="flex items-center gap-2 text-xs font-bold text-amber-900">
                <Percent className="w-4 h-4 text-amber-600" />
                <span>Credit Note & Write-off Details</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Target Invoice *
                  </label>
                  <select
                    value={selectedInvoiceId}
                    onChange={(e) => setSelectedInvoiceId(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 text-slate-800"
                    required
                  >
                    <option value="">Select Invoice to Credit...</option>
                    {clinicInvoices.map((inv) => (
                      <option key={inv.id} value={inv.id}>
                        {inv.invoice_number} - {inv.patient_name || 'Case'} (Due: {formatPKR(inv.final_amount - (inv.amount_paid || 0))})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Standard Reason Code *
                  </label>
                  <select
                    value={creditReasonCode}
                    onChange={(e) => setCreditReasonCode(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 text-slate-800"
                  >
                    <option value="remake">Lab Remake / Clinical Fit Warranty (100% Free)</option>
                    <option value="shade_redo">Shade Discrepancy Correction</option>
                    <option value="volume_discount">Monthly Volume Retainer Discount</option>
                    <option value="damage">Transit Damage / Breakage Allowance</option>
                    <option value="bad_debt">Bad Debt Write-Off (Authorized)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Justification / Clinical Defect Description
                </label>
                <input
                  type="text"
                  value={creditReasonText}
                  onChange={(e) => setCreditReasonText(e.target.value)}
                  placeholder="e.g. Doctor reported margin opening on tooth #21; full remake authorized by Lab Manager."
                  className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 text-slate-800"
                />
              </div>
            </div>
          )}

          {/* Payment Proof Uploader */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Deposit Slip / Cheque Image Attachment
            </label>
            <div className="flex items-center gap-3">
              <label className="px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg cursor-pointer flex items-center gap-2 transition-colors">
                <Upload className="w-3.5 h-3.5 text-slate-500" />
                <span>{proofName ? 'Change Slip' : 'Upload Transfer Slip'}</span>
                <input
                  type="file"
                  accept="image/*,.pdf"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>
              {proofName && (
                <span className="text-xs text-emerald-600 font-medium flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {proofName}
                </span>
              )}
            </div>
          </div>

          {/* Notes / Internal Comments */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Transaction Notes / Narration
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add optional notes for the clinic statement or accountant..."
              className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-800"
            />
          </div>

          {/* Live Double-Entry Ledger Preview */}
          <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs flex items-center justify-between text-slate-600">
            <div className="flex items-center gap-2">
              <Scale className="w-4 h-4 text-indigo-600" />
              <span>Double-entry ledger impact:</span>
              <strong className="text-slate-800">
                {mode === 'payment'
                  ? `Debit Cash/Bank (${formatPKR(amount)}) • Credit A/R (${formatPKR(totalAllocated)})`
                  : mode === 'advance'
                  ? `Debit Cash/Bank (${formatPKR(amount)}) • Credit Advance Liability (${formatPKR(amount)})`
                  : `Debit Sales Returns / Write-offs (${formatPKR(amount)}) • Credit A/R (${formatPKR(amount)})`}
              </strong>
            </div>
            <span className="text-emerald-600 font-semibold flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5" /> Balanced
            </span>
          </div>

          {/* Footer Buttons */}
          <div className="pt-2 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg shadow-xs transition-colors flex items-center gap-2 cursor-pointer"
            >
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              Post Transaction & Issue Receipt
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
