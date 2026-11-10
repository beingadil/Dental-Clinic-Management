import React, { useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Modal } from '../common/ui';
import { canPost } from '../../services/permissions';
import {
  clinicMonthSnapshots,
  closedMonthFor,
  closeMonth,
  reopenMonth,
  listMonthCloses,
  diffClosedMonths,
} from '../../services/monthClose';
import { buildMonthlyStatementPdf, downloadPdf } from '../../lib/pdf';
import { formatMonthLabel, statementColumns, type MonthlyClinicRow } from '../../services/monthlyStatement';
import { formatPKR } from '../../services/financeDomain';
import { getTodayStr } from '../../utils/dateUtils';
import { GlassSelect } from '../common/ui/GlassSelect';
import {
  CalendarCheck,
  FileDown,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';

/**
 * Month-end closing — one clinic, one calendar month, one snapshot.
 *
 * Closing is an accounting decision recorded, never a lock taken: nothing here
 * stops anyone editing a document in the month they closed. What it stores is
 * the statement of record for the clinic-month, the same figures the Monthly
 * tab computes, frozen in `month_closes` so the next reprint can never read
 * differently. If the books move after a close, the drift banner says so and
 * the answer is Re-close — never a silent re-save.
 */

const FIELD_LABELS: Record<string, string> = {
  cases_billed: 'Cases',
  billed: 'Billed',
  collected: 'Collected',
  advance_received: 'Advance received',
  advance_applied: 'Advance used',
  credit_notes: 'Credit notes',
  debit_adjustments: 'Debit adjustments',
  opening_balance: 'Opening',
  closing_balance: 'Closing',
  advance_credit: 'Advance credit',
};

const drCr = (v: number) => (v > 0 ? ' Dr' : v < 0 ? ' Cr' : '');
const isMoneyField = (f: string) => f !== 'cases_billed';

/**
 * The body mounts only while open: its hooks walk the statement engine and the
 * month_closes table, and neither belongs in a render path for a closed dialog
 * (the Billing and Monthly Statement screens keep this component mounted).
 */
export const MonthEndCloseModal: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  if (!open) return null;
  return <MonthEndCloseBody onClose={onClose} />;
};

const MonthEndCloseBody: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { labs, invoices, advancePayments, accountAdjustments, brandingSettings, user, showToast } = useApp();
  const mayClose = canPost(user, 'payment:record');

  const [month, setMonth] = useState<string>(() => getTodayStr().slice(0, 7));
  const [closedVersion, setClosedVersion] = useState(0);
  const [reasonFor, setReasonFor] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const blocks = useMemo(
    () => clinicMonthSnapshots({ invoices, advancePayments, accountAdjustments, labs }, month),
    [invoices, advancePayments, accountAdjustments, labs, month],
  );
  const closedMap = useMemo(() => closedMonthFor(month), [month, closedVersion]);
  const drift = useMemo(
    () => diffClosedMonths({ invoices, advancePayments, accountAdjustments, labs }),
    [invoices, advancePayments, accountAdjustments, labs, closedVersion],
  );

  // Every month the books or a close know about, newest first, plus the last
  // 36 — the picker never asks the operator to type a date to reach one.
  const monthOptions = useMemo(() => {
    const seen = new Set<string>();
    const mk = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const now = new Date();
    for (let i = 0; i < 36; i++) {
      seen.add(mk(new Date(now.getFullYear(), now.getMonth() - i, 1)));
    }
    listMonthCloses().forEach((row) => seen.add(row.month));
    return [...seen].sort().reverse().map((m) => ({ value: m, label: formatMonthLabel(m) }));
  }, [closedVersion]);

  const refresh = () => setClosedVersion((v) => v + 1);

  const handleClose = (row: MonthlyClinicRow) => {
    setBusyKey(row.lab_id);
    try {
      closeMonth({
        invoices,
        advancePayments,
        accountAdjustments,
        labs,
        month,
        labId: row.lab_id,
        labName: row.lab_name,
        actor: user?.name || 'System',
      });
      showToast(`${row.lab_name} — ${formatMonthLabel(month)} closed.`, 'success');
      refresh();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Could not close the month.', 'error');
    } finally {
      setBusyKey(null);
    }
  };

  const handleReopen = (labId: string, labName: string) => {
    if (!reason.trim()) {
      showToast('A reason is required to reopen a closed clinic-month.', 'error');
      return;
    }
    setBusyKey(labId);
    try {
      reopenMonth({
        invoices,
        advancePayments,
        accountAdjustments,
        labs,
        month,
        labId,
        labName,
        actor: user?.name || 'System',
        reason,
      });
      showToast(`${labName} — ${formatMonthLabel(month)} reopened.`, 'info');
      setReasonFor(null);
      setReason('');
      refresh();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Could not reopen the month.', 'error');
    } finally {
      setBusyKey(null);
    }
  };

  const handlePrint = async (row: MonthlyClinicRow) => {
    const columns = statementColumns(false);
    const figureFor = (c: (typeof columns)[number], r: MonthlyClinicRow): string =>
      c.key === 'cases'
        ? String(c.value(r))
        : c.key === 'closing'
          ? `${formatPKR(c.value(r))}${drCr(c.value(r))}`
          : formatPKR(c.value(r));
    const labName = brandingSettings?.lab_name || brandingSettings?.appName || 'Dental Lab';
    const result = buildMonthlyStatementPdf(
      [
        {
          month,
          label: formatMonthLabel(month),
          rows: [[row.lab_name, ...columns.slice(1).map((c) => figureFor(c, row))]],
          totals: [row.lab_name, ...columns.slice(1).map((c) => figureFor(c, row))],
          headline: [
            { label: 'Billed', value: formatPKR(row.billed) },
            { label: 'Collected', value: formatPKR(row.collected) },
            { label: 'Closing', value: `${formatPKR(row.closing_balance)}${drCr(row.closing_balance)}` },
          ],
        },
      ],
      {
        labName,
        periodLabel: formatMonthLabel(month),
        generatedOn: getTodayStr(),
        scopeLabel: row.lab_name,
        summary: [
          { label: 'Billed', value: formatPKR(row.billed), note: formatMonthLabel(month) },
          { label: 'Collected', value: formatPKR(row.collected), note: 'Payments, advances and notes' },
          { label: 'Closing balance', value: `${formatPKR(row.closing_balance)}${drCr(row.closing_balance)}`, note: 'As at close' },
        ],
      },
      columns.map((c) => ({
        key: c.key,
        label: c.label,
        w: c.width,
        align: c.align,
        strong: c.strong,
      })),
    );
    try {
      await downloadPdf(`Monthly_closing_${row.lab_name.replace(/\s+/g, '_')}_${month}.pdf`, result.pdf, 'Save final statement');
    } catch {
      showToast('Could not save the PDF.', 'error');
    }
  };


  const rows = blocks.map((live) => {
    const stored = closedMap.get(live.lab_id);
    const shown: MonthlyClinicRow = stored
      ? { ...live, ...stored, lab_name: live.lab_name }
      : live;
    return { live, stored, shown };
  });

  return (
    <Modal
      open={true}
      onClose={onClose}
      label="Month-end closing"
      maxWidth="max-w-4xl"
      tone="slate"
      header={(
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-slate-900 p-2 text-white">
            <CalendarCheck className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">Month-end closing</h2>
            <p className="text-xs text-slate-500">Per clinic · snapshot of the statement figures · nothing locks — corrections re-close</p>
          </div>
        </div>
      )}
    >
      <div className="space-y-4 p-6">
        {/* Month picker */}
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="close-month" className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
            Month
          </label>
          <GlassSelect
            value={month}
            onChange={(v: string) => setMonth(v)}
            ariaLabel="Month to close"
            className="min-w-48 p-2.5 text-xs font-bold"
            options={monthOptions.map((o) => ({ value: o.value, label: o.label }))}
          />
          <span className="text-[11px] font-semibold text-slate-400">
            {rows.length} clinic{rows.length === 1 ? '' : 's'} · {rows.filter((r) => r.stored).length} closed
          </span>
        </div>

        {/* Drift banner: books moved after a close */}
        {drift.length > 0 && (
          <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4">
            <p className="flex items-start gap-2 text-[11px] font-bold text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              Figures moved after a close — {drift.length} clinic-month{drift.length === 1 ? '' : 's'} differ from their stored snapshot.
            </p>
            <ul className="mt-2 space-y-1.5">
              {drift.slice(0, 4).map((d) => (
                <li
                  key={`${d.month}:${d.labId}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-white px-3 py-1.5 text-[11px]"
                >
                  <span className="min-w-0">
                    <span className="font-bold text-slate-800">{d.labName} · {formatMonthLabel(d.month)}</span>
                    <span className="block text-slate-500">
                      {d.moved.slice(0, 3).map((m) =>
                        `${FIELD_LABELS[m.field] || m.field}: ${isMoneyField(m.field) ? formatPKR(m.stored) : m.stored} → ${isMoneyField(m.field) ? formatPKR(m.live) : m.live}`
                      ).join(' · ')}
                      {d.moved.length > 3 ? ` · +${d.moved.length - 3} more` : ''}
                    </span>
                  </span>
                  {mayClose && (
                    <button
                      type="button"
                      disabled={busyKey === d.labId}
                      onClick={() => {
                        setBusyKey(d.labId);
                        try {
                          closeMonth({
                            invoices, advancePayments, accountAdjustments, labs,
                            month: d.month, labId: d.labId, labName: d.labName, actor: user?.name || 'System',
                          });
                          showToast(`${d.labName} — ${formatMonthLabel(d.month)} re-closed.`, 'success');
                          refresh();
                        } catch (err: unknown) {
                          showToast(err instanceof Error ? err.message : 'Could not re-close the month.', 'error');
                        } finally {
                          setBusyKey(null);
                        }
                      }}
                      className="cursor-pointer rounded-lg border border-amber-300 bg-amber-100 px-2.5 py-1 text-[10px] font-bold text-amber-900 transition-colors hover:bg-amber-200 disabled:opacity-50"
                    >
                      Re-close
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {drift.length > 4 && <p className="mt-1.5 text-[10px] font-semibold text-amber-800">+{drift.length - 4} more drifted clinic-months</p>}
          </div>
        )}

        {/* The per-clinic table */}
        <div className="overflow-hidden rounded-2xl border border-slate-200">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="ds-th">
                <th scope="col" className="py-2 px-3 text-left">Clinic</th>
                <th scope="col" className="py-2 px-3 text-left">Status</th>
                <th scope="col" className="py-2 px-3 text-right">Billed</th>
                <th scope="col" className="py-2 px-3 text-right">Collected</th>
                <th scope="col" className="py-2 px-3 text-right">Closing</th>
                <th scope="col" className="py-2 px-3 text-right">Close</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium">
              {rows.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">No clinics to close.</td></tr>
              ) : rows.map(({ live, stored, shown }) => (
                <tr key={live.lab_id} className="hover:bg-slate-50/80">
                  <td className="px-3 py-2.5 font-semibold text-slate-800">{shown.lab_name}</td>
                  <td className="px-3 py-2.5">
                    {stored ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700" title={`Closed ${new Date(stored.closed_at).toLocaleString()} by ${stored.closed_by}`}>
                        <ShieldCheck className="h-3 w-3" /> Closed {new Date(stored.closed_at).toLocaleDateString()}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-500">Open</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums">{formatPKR(shown.billed)}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums text-ink-success">{formatPKR(shown.collected)}</td>
                  <td className={`whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums font-bold ${shown.closing_balance > 0 ? 'text-slate-900' : shown.closing_balance < 0 ? 'text-ink-success' : 'text-slate-400'}`}>
                    {formatPKR(Math.abs(shown.closing_balance))}
                    {shown.closing_balance > 0 ? ' Dr' : shown.closing_balance < 0 ? ' Cr' : ''}
                  </td>
                  <td className="px-3 py-2.5">
                    {reasonFor === live.lab_id ? (
                      <div className="flex items-center justify-end gap-1.5">
                        <input
                          autoFocus
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                          placeholder="Reason (required)"
                          aria-label="Reason for reopening"
                          className="w-36 rounded-lg border border-slate-200 px-2 py-1 text-[11px] focus:outline-none focus:ring-2 focus:ring-indigo-100"
                          onKeyDown={(e) => { if (e.key === 'Enter') handleReopen(live.lab_id, shown.lab_name); }}
                        />
                        <button type="button" disabled={busyKey === live.lab_id} onClick={() => handleReopen(live.lab_id, shown.lab_name)} className="cursor-pointer rounded-lg bg-slate-900 px-2 py-1 text-[10px] font-bold text-white disabled:opacity-50">Reopen</button>
                        <button type="button" onClick={() => { setReasonFor(null); setReason(''); }} className="cursor-pointer rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-600">Cancel</button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-end gap-1.5">
                        {stored ? (
                          <>
                            <button type="button" onClick={() => handlePrint(shown)} className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-600 transition-colors hover:bg-slate-50" title="Print the final statement (PDF)">
                              <FileDown className="h-3.5 w-3.5" /> PDF
                            </button>
                            {mayClose && (
                              <button type="button" onClick={() => setReasonFor(live.lab_id)} className="cursor-pointer rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-700 transition-colors hover:bg-slate-50">Reopen</button>
                            )}
                          </>
                        ) : mayClose ? (
                          <button
                            type="button"
                            disabled={busyKey === live.lab_id}
                            onClick={() => handleClose(live)}
                            className="inline-flex cursor-pointer items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1 text-[10px] font-bold text-white transition-colors hover:bg-slate-800 disabled:opacity-50"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" /> Close
                          </button>
                        ) : (
                          <span className="text-[10px] font-semibold text-slate-400">—</span>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-[10px] leading-relaxed text-slate-400">
          Closing stores a snapshot of the month’s figures (billed, collected, advances, notes and the closing balance). No document is locked or changed; a payment posted into a closed month is kept, and the banner above will offer Re-close to refresh the stored figures. Every close and reopen is written to the audit log.
        </p>
      </div>
    </Modal>
  );
};

export default MonthEndCloseModal;
