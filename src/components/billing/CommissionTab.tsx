import React, { useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import {
  Person,
  loadPersons,
  loadAssignments,
  commissionFor,
} from '../../services/persons';
import { formatPKR } from '../../services/financeDomain';
import { buildXlsx, XL, type XlsxCell, type XlsxSheet } from '../../lib/xlsx';
import { saveFile } from '../../lib/saveFile';
import { CalendarDays } from 'lucide-react';

const CUTOFF_KEY = 'ds.commissionCutoffDay';

const loadCutoff = (): number => {
  try {
    const v = Number(localStorage.getItem(CUTOFF_KEY));
    if (Number.isFinite(v) && v >= 1 && v <= 28) return v;
  } catch {
    // ignore
  }
  return 5;
};

const saveCutoff = (v: number): void => {
  try {
    localStorage.setItem(CUTOFF_KEY, String(v));
  } catch {
    // ignore
  }
};

interface Period {
  key: string;
  label: string;
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
}

const pad = (n: number) => String(n).padStart(2, '0');

const periodEnd = (year: number, month: number, day: number): Date => {
  const lastDay = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(day, lastDay));
};

const buildPeriods = (cutoff: number, count: number): Period[] => {
  const today = new Date();
  // Current period end: this month's cutoff if today >= cutoff, else last month's.
  let endMonth = today.getMonth();
  let endYear = today.getFullYear();
  if (today.getDate() < cutoff) {
    endMonth -= 1;
    if (endMonth < 0) {
      endMonth = 11;
      endYear -= 1;
    }
  }
  const out: Period[] = [];
  for (let i = 0; i < count; i++) {
    const m = endMonth - i;
    const y = endYear + Math.floor(m / 12);
    const mm = ((m % 12) + 12) % 12;
    const e = periodEnd(y, mm, cutoff);
    // start = previous period end + 1 day
    const prevM = mm - 1;
    const prevY = y + Math.floor(prevM / 12);
    const prevMM = ((prevM % 12) + 12) % 12;
    const prevE = periodEnd(prevY, prevMM, cutoff);
    const s = new Date(prevE);
    s.setDate(s.getDate() + 1);
    const startStr = `${s.getFullYear()}-${pad(s.getMonth() + 1)}-${pad(s.getDate())}`;
    const endStr = `${e.getFullYear()}-${pad(e.getMonth() + 1)}-${pad(e.getDate())}`;
    out.push({
      key: `${e.getFullYear()}-${pad(e.getMonth() + 1)}`,
      label: `${e.toLocaleString('default', { month: 'short' })} ${e.getFullYear()} (ends ${pad(cutoff)})`,
      start: startStr,
      end: endStr,
    });
  }
  return out.reverse(); // oldest first
};

interface ClinicPeriodStat {
  lab_id: string;
  lab_name: string;
  cases: number;
  billed: number;
}

export const CommissionTab: React.FC = () => {
  const { invoices, labs } = useApp();
  const [persons] = useState<Person[]>(() => loadPersons());
  const [assignments] = useState(() => loadAssignments());
  const [cutoff, setCutoff] = useState<number>(() => loadCutoff());
  const [personFilter, setPersonFilter] = useState<string>('all');
  const [periodCount, setPeriodCount] = useState<number>(6);

  const periods = useMemo(() => buildPeriods(cutoff, periodCount), [cutoff, periodCount]);

  const handleCutoff = (v: number) => {
    setCutoff(v);
    saveCutoff(v);
  };

  // Billed per clinic per period.
  const periodStats = useMemo(() => {
    return periods.map((period) => {
      const byLab = new Map<string, ClinicPeriodStat>();
      for (const inv of invoices) {
        const day = (inv.issue_date || inv.created_at || '').slice(0, 10);
        if (!day || day < period.start || day > period.end) continue;
        const lab = labs.find((l) => l.id === inv.lab_id);
        const name = lab?.name || inv.lab_name || 'Unknown';
        const cur = byLab.get(inv.lab_id) || { lab_id: inv.lab_id, lab_name: name, cases: 0, billed: 0 };
        cur.cases += 1;
        cur.billed += inv.final_amount || 0;
        byLab.set(inv.lab_id, cur);
      }
      // attach person
      const rows = Array.from(byLab.values()).map((r) => {
        const person = personForLabSafe(r.lab_id, persons, assignments);
        const rate = effectiveRateSafe(r.lab_id, persons, assignments);
        return {
          ...r,
          person,
          rate,
          commission: commissionFor(r.billed, rate),
        };
      });
      // filter by person
      const filtered = personFilter === 'all' ? rows : rows.filter((r) => r.person?.id === personFilter);
      // group totals
      const personTotals = new Map<string, { name: string; billed: number; commission: number; cases: number }>();
      for (const r of filtered) {
        const key = r.person?.id || '__unassigned__';
        const name = r.person?.name || 'Unassigned';
        const cur = personTotals.get(key) || { name, billed: 0, commission: 0, cases: 0 };
        cur.billed += r.billed;
        cur.commission += r.commission;
        cur.cases += r.cases;
        personTotals.set(key, cur);
      }
      const grandBilled = filtered.reduce((s, r) => s + r.billed, 0);
      const grandCommission = filtered.reduce((s, r) => s + r.commission, 0);
      const grandCases = filtered.reduce((s, r) => s + r.cases, 0);
      return { period, rows: filtered, personTotals: Array.from(personTotals.values()), grandBilled, grandCommission, grandCases };
    });
  }, [invoices, labs, periods, persons, assignments, personFilter]);

  const grandTotalBilled = periodStats.reduce((s, p) => s + p.grandBilled, 0);
  const grandTotalCommission = periodStats.reduce((s, p) => s + p.grandCommission, 0);

  const handleExportExcel = async () => {
    const titleRows: XlsxCell[][] = [
      [{ value: 'Commission Statement', style: XL.totalLabel }],
      [{ value: `Month ends on: ${cutoff}` }],
      [{ value: `Periods: ${periods.length}` }],
      [{ value: 'All amounts in PKR' }],
      [{ value: '' }],
    ];
    const header = ['Period', 'Person', 'Clinic', 'Cases', 'Billed', 'Rate', 'Commission'];
    const sheets: XlsxSheet[] = [
      {
        name: 'Commission',
        rows: [
          ...titleRows,
          header.map((h) => ({ value: h, style: XL.header })),
          ...periodStats.flatMap((ps) =>
            ps.rows.map((r) => [
              { value: ps.period.label },
              { value: r.person?.name || 'Unassigned' },
              { value: r.lab_name },
              { value: r.cases, style: XL.count },
              { value: r.billed, style: XL.money },
              { value: `${r.rate}%` },
              { value: r.commission, style: XL.money },
            ])
          ),
          [
            { value: 'TOTAL', style: XL.totalLabel },
            { value: '' },
            { value: '' },
            { value: periodStats.reduce((s, p) => s + p.grandCases, 0), style: XL.totalCount },
            { value: grandTotalBilled, style: XL.totalMoney },
            { value: '' },
            { value: grandTotalCommission, style: XL.totalMoney },
          ],
        ],
        widths: [26, 18, 24, 8, 14, 8, 14],
        freezeRows: titleRows.length + 1,
      },
    ];
    const bytes = buildXlsx(sheets);
    await saveFile('commission-statement.xlsx', bytes, {
      extension: 'xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      dialogTitle: 'Save commission statement',
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:flex-wrap justify-between gap-3 bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
        <div className="flex items-center gap-2">
          <CalendarDays className="w-4 h-4 text-indigo-600" />
          <span className="text-sm font-bold text-slate-900">Commission statement</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs font-semibold text-slate-600">
            Month ends on
            <select
              value={cutoff}
              onChange={(e) => handleCutoff(Number(e.target.value))}
              className="ml-2 rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700 bg-white cursor-pointer"
            >
              {[3, 4, 5, 6, 7, 8].map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-600">
            Periods
            <select
              value={periodCount}
              onChange={(e) => setPeriodCount(Number(e.target.value))}
              className="ml-2 rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700 bg-white cursor-pointer"
            >
              {[3, 6, 12].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
          <select
            value={personFilter}
            onChange={(e) => setPersonFilter(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white cursor-pointer"
            aria-label="Filter by person"
          >
            <option value="all">All persons</option>
            {persons.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleExportExcel}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-700 cursor-pointer"
          >
            Export to Excel
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <div className="text-[10px] font-bold uppercase text-slate-500">Periods</div>
          <div className="text-lg font-bold text-slate-900">{periods.length}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <div className="text-[10px] font-bold uppercase text-slate-500">Billed</div>
          <div className="text-lg font-bold text-slate-900">{formatPKR(grandTotalBilled)}</div>
        </div>
        <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 px-4 py-3">
          <div className="text-[10px] font-bold uppercase text-indigo-600">Commission</div>
          <div className="text-lg font-bold text-indigo-700">{formatPKR(grandTotalCommission)}</div>
        </div>
      </div>

      {periodStats.map(({ period, rows, personTotals, grandBilled, grandCommission, grandCases }) => (
        <div key={period.key} className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-2xs">
          <div className="flex items-baseline gap-2 px-5 pt-4 pb-1">
            <h3 className="text-sm font-bold text-slate-900">{period.label}</h3>
            <span className="text-xs text-slate-500">
              {period.start} → {period.end}
            </span>
          </div>
          {rows.length === 0 ? (
            <div className="px-5 py-6 text-sm text-slate-500">No billed work in this period.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="ds-th">
                    <th className="py-2 px-3 text-left">Person</th>
                    <th className="py-2 px-3 text-left">Clinic</th>
                    <th className="py-2 px-3 text-right">Cases</th>
                    <th className="py-2 px-3 text-right">Billed</th>
                    <th className="py-2 px-3 text-right">Rate</th>
                    <th className="py-2 px-3 text-right">Commission</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((r, i) => (
                    <tr key={i} className="hover:bg-slate-50/80">
                      <td className="py-2 px-3 font-semibold text-slate-700">{r.person?.name || 'Unassigned'}</td>
                      <td className="py-2 px-3 text-slate-900">{r.lab_name}</td>
                      <td className="py-2 px-3 text-right tabular-nums">{r.cases}</td>
                      <td className="py-2 px-3 text-right tabular-nums">{formatPKR(r.billed)}</td>
                      <td className="py-2 px-3 text-right tabular-nums">{r.rate}%</td>
                      <td className="py-2 px-3 text-right tabular-nums font-bold text-indigo-700">{formatPKR(r.commission)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  {personTotals.map((pt) => (
                    <tr key={pt.name} className="bg-slate-50/60 font-semibold">
                      <td className="py-2 px-3 text-slate-700" colSpan={2}>{pt.name} subtotal</td>
                      <td className="py-2 px-3 text-right tabular-nums">{pt.cases}</td>
                      <td className="py-2 px-3 text-right tabular-nums">{formatPKR(pt.billed)}</td>
                      <td className="py-2 px-3 text-right tabular-nums">—</td>
                      <td className="py-2 px-3 text-right tabular-nums text-indigo-700">{formatPKR(pt.commission)}</td>
                    </tr>
                  ))}
                  <tr className="bg-indigo-50/60 font-bold">
                    <td className="py-2 px-3 text-indigo-700" colSpan={2}>Period total</td>
                    <td className="py-2 px-3 text-right tabular-nums text-indigo-700">{grandCases}</td>
                    <td className="py-2 px-3 text-right tabular-nums text-indigo-700">{formatPKR(grandBilled)}</td>
                    <td className="py-2 px-3 text-right tabular-nums text-indigo-700">—</td>
                    <td className="py-2 px-3 text-right tabular-nums text-indigo-700">{formatPKR(grandCommission)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      ))}

      {periodStats.every((p) => p.rows.length === 0) && (
        <div className="text-sm text-slate-500 text-center py-6">No billed work in any period.</div>
      )}
    </div>
  );
};

// ---- helpers (kept local to avoid touching persons service exports) ----
function personForLabSafe(
  labId: string,
  persons: Person[],
  assignments: Record<string, { personId: string | null; rateOverride?: number | null }>
): Person | null {
  const a = assignments[labId];
  if (!a || !a.personId) return null;
  return persons.find((p) => p.id === a.personId) ?? null;
}

function effectiveRateSafe(
  labId: string,
  persons: Person[],
  assignments: Record<string, { personId: string | null; rateOverride?: number | null }>
): number {
  const a = assignments[labId];
  if (!a || !a.personId) return 0;
  const person = persons.find((p) => p.id === a.personId);
  if (!person) return 0;
  if (person.rateScope === 'clinic' && a.rateOverride != null) return a.rateOverride;
  return person.commissionRate;
}