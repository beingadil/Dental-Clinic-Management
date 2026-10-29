import React, { useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { BulkPrintModal } from '../cases/BulkPrintModal';
import { PageHeader } from '../common/ui';
import { formatPKR } from '../../services/financeDomain';

/**
 * Batch Invoice Printing — a dedicated full-view surface (NOT the Dental
 * Workstation). Lists invoices with selection; "Print Selected" opens the
 * shared batch printer for the chosen invoices' cases.
 */
export const PrintInvoicesView: React.FC = () => {
  const { invoices, cases } = useApp();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(false);

  const sorted = useMemo(
    () => [...invoices].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))),
    [invoices]
  );

  const selectedCases = useMemo(() => {
    const ids = new Set(selected);
    const caseIds = new Set(sorted.filter((i) => ids.has(i.id)).map((i) => i.case_id));
    return cases.filter((c) => caseIds.has(c.id));
  }, [selected, sorted, cases]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === sorted.length) setSelected(new Set());
    else setSelected(new Set(sorted.map((i) => i.id)));
  };

  const selectedTotal = useMemo(
    () => sorted.filter((i) => selected.has(i.id)).reduce((s, i) => s + (i.final_amount || i.amount || 0), 0),
    [selected, sorted]
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Batch Print Invoices"
        subtitle="Select invoices below, then print them as a single batch. Job slips stay on the Dental Workstation."
      />

      <div className="ds-glass-card rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between gap-3 p-4 border-b border-ds-line">
          <span className="text-xs font-semibold text-ds-ink-soft">
            {selected.size} of {sorted.length} selected · {formatPKR(selectedTotal)}
          </span>
          <button
            type="button"
            disabled={selected.size === 0}
            onClick={() => setOpen(true)}
            className="px-4 py-2 ds-glass-pill font-bold text-xs flex items-center gap-2 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Print Selected Invoices
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-ds-line text-left text-[10px] font-bold uppercase tracking-wider text-ds-muted">
                <th className="px-3 py-2.5 w-8">
                  <input
                    type="checkbox"
                    aria-label="Select all invoices"
                    checked={sorted.length > 0 && selected.size === sorted.length}
                    onChange={toggleAll}
                    className="w-4 h-4 rounded border-ds-line"
                  />
                </th>
                <th className="px-3 py-2.5">Invoice #</th>
                <th className="px-3 py-2.5">Case #</th>
                <th className="px-3 py-2.5">Clinic</th>
                <th className="px-3 py-2.5">Date</th>
                <th className="px-3 py-2.5 text-right">Amount</th>
                <th className="px-3 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((inv) => (
                <tr key={inv.id} className="border-b border-ds-line hover:bg-ds-surface/40">
                  <td className="px-3 py-2.5">
                    <input
                      type="checkbox"
                      aria-label={`Select invoice ${inv.invoice_number}`}
                      checked={selected.has(inv.id)}
                      onChange={() => toggle(inv.id)}
                      className="w-4 h-4 rounded border-ds-line"
                    />
                  </td>
                  <td className="px-3 py-2.5 font-semibold text-ds-ink">{inv.invoice_number}</td>
                  <td className="px-3 py-2.5 text-ds-ink-soft">{inv.case_number}</td>
                  <td className="px-3 py-2.5 text-ds-ink-soft">{inv.lab_name}</td>
                  <td className="px-3 py-2.5 text-ds-ink-soft">{inv.issue_date || inv.created_at?.slice(0, 10)}</td>
                  <td className="px-3 py-2.5 text-right font-semibold text-ds-ink">{formatPKR(inv.final_amount || inv.amount)}</td>
                  <td className="px-3 py-2.5 text-ds-ink-soft">{inv.payment_status}</td>
                </tr>
              ))}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-ds-muted">No invoices yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {open && selectedCases.length > 0 && (
        <BulkPrintModal
          selectedCases={selectedCases}
          onClose={() => setOpen(false)}
          initialPrintType="invoices"
        />
      )}
    </div>
  );
};

export default PrintInvoicesView;
