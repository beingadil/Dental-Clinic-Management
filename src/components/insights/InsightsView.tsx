import React, { useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { buildInsightsSnapshot, type PeriodKind, type InsightsFilters } from '../../services/insightsDomain';
import { InsightsCard } from './InsightsCard';
import { KpiTiles } from './widgets/KpiTiles';
import { MoneyFlowChart } from './widgets/MoneyFlowChart';
import { ProductMixDonut } from './widgets/ProductMixDonut';
import { ClinicStandings } from './widgets/ClinicStandings';
import { ThroughputBars } from './widgets/ThroughputBars';
import { PerformanceRings } from './widgets/PerformanceRings';
import { DayHeatStrip } from './widgets/DayHeatStrip';
import { DoctorRadar } from './widgets/DoctorRadar';
import { InvoiceStatementModal } from '../billing/InvoiceStatementModal';
import { CaseDetailModal } from '../cases/CaseDetailModal';
import { Filter, GitCompare, X } from 'lucide-react';
import type { Invoice, DentalCase } from '../../types';

const PERIODS: { id: PeriodKind; label: string }[] = [
  { id: 'thisMonth', label: 'This month' },
  { id: 'lastMonth', label: 'Last month' },
  { id: 'thisYear', label: 'This year' },
  { id: 'allTime', label: 'All time' },
];

export const InsightsView: React.FC = () => {
  const { cases, invoices, labs, caseTypes } = useApp();
  const [period, setPeriod] = useState<PeriodKind>('thisMonth');
  const [compare, setCompare] = useState(true);
  const [filters, setFilters] = useState<InsightsFilters>({ clinicIds: [], doctorNames: [], caseTypeIds: [] });
  const [showFilters, setShowFilters] = useState(false);
  const [drillInvoices, setDrillInvoices] = useState<Invoice[] | null>(null);
  const [drillCases, setDrillCases] = useState<DentalCase[] | null>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [selectedCase, setSelectedCase] = useState<DentalCase | null>(null);

  const metrics = useMemo(
    () => buildInsightsSnapshot({ cases, invoices, labs, caseTypes }, { kind: period }, filters),
    [cases, invoices, labs, caseTypes, period, filters],
  );

  const inScopeInvoices = useMemo(() => invoices.filter((i) => metrics.inScopeInvoiceIds.includes(i.id)), [invoices, metrics.inScopeInvoiceIds]);
  const inScopeCases = useMemo(() => cases.filter((c) => metrics.inScopeCaseIds.includes(c.id)), [cases, metrics.inScopeCaseIds]);
  const clinics = labs;
  const types = caseTypes;
  const doctors = Array.from(new Set(cases.map((c) => c.doctor_name).filter(Boolean)));

  const toggleFilter = (key: keyof InsightsFilters, value: string) => {
    setFilters((f) => {
      const arr = f[key] as string[];
      return { ...f, [key]: arr.includes(value) ? arr.filter((x) => x !== value) : [...arr, value] };
    });
  };

  const activeFilterCount = filters.clinicIds.length + filters.doctorNames.length + filters.caseTypeIds.length;

  return (
    <div className="space-y-5">
      {/* Header / controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold text-ds-ink tracking-tight">Insights</h2>
          <p className="text-xs font-semibold text-ink-muted mt-0.5">
            {metrics.period.label} · live from your data · {metrics.kpi.cases} cases · {metrics.kpi.invoiced > 0 ? 'PKR ' + new Intl.NumberFormat('en-PK').format(Math.round(metrics.kpi.invoiced)) : 'no revenue yet'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-xl border border-ds-line/60 bg-ds-surface/60 p-1">
            {PERIODS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPeriod(p.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${period === p.id ? 'bg-ds-accent text-white shadow-sm' : 'text-ink-muted hover:text-ds-ink'}`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setCompare((c) => !c)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold transition-all ${compare ? 'border-ds-accent bg-ds-accent text-white' : 'border-ds-line/60 bg-ds-surface/60 text-ink-muted'}`}
          >
            <GitCompare className="w-3.5 h-3.5" /> Compare
          </button>
          <button
            type="button"
            onClick={() => setShowFilters((s) => !s)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold transition-all ${activeFilterCount > 0 ? 'border-ds-accent bg-ds-accent text-white' : 'border-ds-line/60 bg-ds-surface/60 text-ink-muted'}`}
          >
            <Filter className="w-3.5 h-3.5" /> Filters{activeFilterCount > 0 ? ` · ${activeFilterCount}` : ''}
          </button>
        </div>
      </div>

      {showFilters && (
        <div className="rounded-2xl border border-ds-line/60 bg-ds-surface/70 backdrop-blur p-4 space-y-3">
          <FilterGroup label="Clinics" items={clinics.map((l) => ({ id: l.id, label: l.name }))} selected={filters.clinicIds} onToggle={(v) => toggleFilter('clinicIds', v)} />
          <FilterGroup label="Doctors" items={doctors.map((d) => ({ id: d, label: d }))} selected={filters.doctorNames} onToggle={(v) => toggleFilter('doctorNames', v)} />
          <FilterGroup label="Case types" items={types.map((t) => ({ id: t.id, label: t.name }))} selected={filters.caseTypeIds} onToggle={(v) => toggleFilter('caseTypeIds', v)} />
          {activeFilterCount > 0 && (
            <button type="button" onClick={() => setFilters({ clinicIds: [], doctorNames: [], caseTypeIds: [] })} className="text-xs font-bold text-rose-600 hover:underline">Clear all filters</button>
          )}
        </div>
      )}

      {/* Bento grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 auto-rows-min">
        <div className="xl:col-span-4 min-h-[120px]">
          <InsightsCard title="Key metrics" subtitle={compare ? 'vs previous period' : 'current period'} accent={CHART_COLORS_PRIMARY} onDrill={() => setDrillInvoices(inScopeInvoices)} drillLabel="Invoices">
            <KpiTiles metrics={metrics.kpi} />
          </InsightsCard>
        </div>
        <div className="xl:col-span-2 md:col-span-2 min-h-[370px]">
          <InsightsCard title="Money flow" subtitle="Invoiced vs collected" accent="#6366f1" onDrill={() => setDrillInvoices(inScopeInvoices)} drillLabel="Invoices">
            <MoneyFlowChart series={metrics.flow} />
          </InsightsCard>
        </div>
        <div className="xl:col-span-2 md:col-span-2 min-h-[370px]">
          <InsightsCard title="Revenue mix" subtitle="By product type" accent="#10b981" onDrill={() => setDrillInvoices(inScopeInvoices)} drillLabel="Invoices">
            <ProductMixDonut mix={metrics.productMix} />
          </InsightsCard>
        </div>
        <div className="xl:col-span-2 md:col-span-2 min-h-[250px]">
          <InsightsCard title="Performance" subtitle="Rates" accent="#f59e0b" onDrill={() => setDrillCases(inScopeCases)} drillLabel="Cases">
            <PerformanceRings metrics={metrics.rings} />
          </InsightsCard>
        </div>
        <div className="xl:col-span-2 md:col-span-2 min-h-[250px]">
          <InsightsCard title="Clinic standings" subtitle="Revenue & balance" accent="#8b5cf6" onDrill={() => setDrillInvoices(inScopeInvoices)} drillLabel="Invoices">
            <ClinicStandings data={metrics.clinicStandings} />
          </InsightsCard>
        </div>
        <div className="xl:col-span-2 md:col-span-2 min-h-[300px]">
          <InsightsCard title="Throughput" subtitle="Received vs delivered" accent="#06b6d4" onDrill={() => setDrillCases(inScopeCases)} drillLabel="Cases">
            <ThroughputBars series={metrics.throughput} />
          </InsightsCard>
        </div>
        <div className="xl:col-span-2 md:col-span-2 min-h-[230px]">
          <InsightsCard title="Intake by day" subtitle="Day of week" accent="#ec4899" onDrill={() => setDrillCases(inScopeCases)} drillLabel="Cases">
            <DayHeatStrip heat={metrics.dayHeat} />
          </InsightsCard>
        </div>
        <div className="xl:col-span-2 md:col-span-2 min-h-[300px]">
          <InsightsCard title="Doctor workload" subtitle="Cases & revenue" accent="#6366f1" onDrill={() => setDrillCases(inScopeCases)} drillLabel="Cases">
            <DoctorRadar data={metrics.doctorRadar} />
          </InsightsCard>
        </div>
      </div>

      {/* Drill-in footer hint */}
      <p className="text-[11px] font-semibold text-ink-muted text-center">
        Click any card title to drill into the underlying records. Period & filters apply to every widget.
      </p>

      {drillInvoices && (
        <DrillModal title="Invoices in scope" onClose={() => setDrillInvoices(null)}>
          {drillInvoices.length === 0 ? <Empty /> : (
            <ul className="divide-y divide-ds-line/40">
              {drillInvoices.slice(0, 50).map((inv) => (
                <li key={inv.id}>
                  <button type="button" onClick={() => setSelectedInvoice(inv)} className="w-full flex items-center justify-between gap-3 px-2 py-2 text-left hover:bg-ds-surface/60 rounded-lg">
                    <span className="font-mono font-bold text-ds-ink text-xs">{inv.invoice_number}</span>
                    <span className="text-[11px] text-ink-muted truncate">{inv.lab_name}</span>
                    <span className="font-mono font-bold text-ds-ink text-xs">PKR {new Intl.NumberFormat('en-PK').format(Math.round(inv.final_amount))}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </DrillModal>
      )}

      {drillCases && (
        <DrillModal title="Cases in scope" onClose={() => setDrillCases(null)}>
          {drillCases.length === 0 ? <Empty /> : (
            <ul className="divide-y divide-ds-line/40">
              {drillCases.slice(0, 50).map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => setSelectedCase(c)} className="w-full flex items-center justify-between gap-3 px-2 py-2 text-left hover:bg-ds-surface/60 rounded-lg">
                    <span className="font-mono font-bold text-ds-ink text-xs">{c.case_number}</span>
                    <span className="text-[11px] text-ink-muted truncate">{c.case_type_name}</span>
                    <span className="text-[11px] font-bold text-ink-muted">{c.status}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </DrillModal>
      )}

      {selectedInvoice && (
        <InvoiceStatementModal invoice={selectedInvoice} caseData={cases.find((c) => c.id === selectedInvoice.case_id || c.case_number === selectedInvoice.case_number)} onClose={() => setSelectedInvoice(null)} />
      )}
      {selectedCase && (
        <CaseDetailModal initialCase={selectedCase} onClose={() => setSelectedCase(null)} />
      )}
    </div>
  );
};

const CHART_COLORS_PRIMARY = '#6366f1';

const FilterGroup: React.FC<{ label: string; items: { id: string; label: string }[]; selected: string[]; onToggle: (v: string) => void }> = ({ label, items, selected, onToggle }) => (
  <div>
    <p className="text-[11px] font-bold uppercase tracking-wider text-ink-muted mb-1.5">{label}</p>
    <div className="flex flex-wrap gap-1.5">
      {items.map((it) => {
        const on = selected.includes(it.id);
        return (
          <button
            key={it.id}
            type="button"
            onClick={() => onToggle(it.id)}
            className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-all ${on ? 'bg-ds-accent text-white border-ds-accent' : 'bg-ds-surface text-ink-muted border-ds-line/60 hover:border-ds-accent/50'}`}
          >
            {it.label}
          </button>
        );
      })}
      {items.length === 0 && <span className="text-xs text-ink-muted">none</span>}
    </div>
  </div>
);

const DrillModal: React.FC<{ title: string; onClose: () => void; children: React.ReactNode }> = ({ title, onClose, children }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
    <div className="w-full max-w-2xl max-h-[80vh] overflow-auto rounded-2xl border border-ds-line/60 bg-ds-surface shadow-2xl" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between px-5 py-4 border-b border-ds-line/40">
        <h3 className="text-sm font-bold text-ds-ink">{title}</h3>
        <button type="button" onClick={onClose} className="text-ink-muted hover:text-ds-ink"><X className="w-4 h-4" /></button>
      </div>
      <div className="p-4">{children}</div>
    </div>
  </div>
);

const Empty: React.FC = () => <p className="text-xs font-semibold text-ink-muted py-6 text-center">No records in this period.</p>;
