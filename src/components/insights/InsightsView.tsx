import React, { useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { buildInsightsSnapshot, type PeriodKind, type InsightsFilters } from '../../services/insightsDomain';
import { pkr } from './chartTheme';
import { InsightsCard } from './InsightsCard';
import { InvoicedMetric, CollectedMetric, OutstandingMetric } from './widgets/KpiCards';
import { MoneyFlowChart } from './widgets/MoneyFlowChart';
import { ProductMixDonut } from './widgets/ProductMixDonut';
import { ClinicStandings } from './widgets/ClinicStandings';
import { ThroughputBars } from './widgets/ThroughputBars';
import { PerformanceRings } from './widgets/PerformanceRings';
import { DayHeatStrip } from './widgets/DayHeatStrip';
import { DoctorWorkload } from './widgets/DoctorWorkload';
import { InvoiceStatementModal } from '../billing/InvoiceStatementModal';
import { CaseDetailModal } from '../cases/CaseDetailModal';
import { Filter, GitCompare, X } from 'lucide-react';
import type { Invoice, DentalCase } from '../../types';
import './insight.css';

const PERIODS: { id: PeriodKind; label: string }[] = [
  { id: 'thisMonth', label: 'This month' },
  { id: 'lastMonth', label: 'Last month' },
  { id: 'thisYear', label: 'This year' },
  { id: 'allTime', label: 'All time' },
];

/**
 * Insight — the reporting board.
 *
 * Ten live cards on one period and one filter set: three readouts across the
 * top, the money-flow hero, the dark throughput spotlight, then the secondary
 * grid. Every number comes from `buildInsightsSnapshot`; nothing here invents
 * data. The reference's decorative icon rails become the real controls above
 * the board instead of a second set of dead icons.
 */
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

  const inScopeInvoices = useMemo(
    () => invoices.filter((invoice) => metrics.inScopeInvoiceIds.includes(invoice.id)),
    [invoices, metrics.inScopeInvoiceIds],
  );
  const inScopeCases = useMemo(
    () => cases.filter((item) => metrics.inScopeCaseIds.includes(item.id)),
    [cases, metrics.inScopeCaseIds],
  );

  const doctors = useMemo(
    () => Array.from(new Set(cases.map((item) => item.doctor_name).filter(Boolean))),
    [cases],
  );

  const collectionRate =
    metrics.kpi.invoiced > 0 ? Math.round((metrics.kpi.collected / metrics.kpi.invoiced) * 100) : 0;

  const toggleFilter = (key: keyof InsightsFilters, value: string) => {
    setFilters((current) => {
      const list = current[key] as string[];
      return {
        ...current,
        [key]: list.includes(value) ? list.filter((item) => item !== value) : [...list, value],
      };
    });
  };

  const activeFilterCount =
    filters.clinicIds.length + filters.doctorNames.length + filters.caseTypeIds.length;

  return (
    <>
      <div className="insight-canvas">
        <div aria-hidden className="insight-orb insight-orb--a" />
        <div aria-hidden className="insight-orb insight-orb--b" />
        <div aria-hidden className="insight-orb insight-orb--c" />

        <div className="relative z-10 space-y-5">
          {/* ── Header + controls ───────────────────────────────────────── */}
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="h-1 w-8 rounded-full bg-gradient-to-r from-indigo-400 via-violet-400 to-cyan-300"
                />
                <p className="insight-eyebrow text-ink-muted">Insight · {metrics.period.label}</p>
              </div>
              <h2 className="mt-2 text-[clamp(1.9rem,3.2vw,2.8rem)] font-extrabold leading-[0.95] tracking-[-0.045em] text-ds-ink">
                Insight
              </h2>
              <p className="mt-2 text-[11.5px] font-semibold text-ink-muted">
                {metrics.kpi.cases} cases · {pkr(metrics.kpi.invoiced)} invoiced · {collectionRate}% collected · live
                from this machine
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div
                className="insight-seg no-scrollbar inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full p-1"
                role="group"
                aria-label="Reporting period"
              >
                {PERIODS.map((option) => {
                  const active = period === option.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setPeriod(option.id)}
                      aria-pressed={active}
                      className={`whitespace-nowrap rounded-full px-3 py-1.5 text-[10.5px] font-bold transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] ${
                        active
                          ? 'bg-brand-600 text-white shadow-[0_10px_22px_-12px_rgba(67,56,202,0.9)]'
                          : 'text-ink-muted hover:bg-ds-surface/55 hover:text-ds-ink'
                      }`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={() => setCompare((current) => !current)}
                aria-pressed={compare}
                title="Compare against the previous period"
                className={`insight-tool inline-flex h-9 items-center gap-2 rounded-full border px-3 text-[10.5px] font-bold ${
                  compare
                    ? 'border-brand-600 bg-brand-600 text-white'
                    : 'border-white/65 bg-ds-surface/55 text-ds-ink hover:bg-ds-surface/80 dark:border-white/15'
                }`}
              >
                <span className={`insight-tool-icon ${compare ? 'border-white/30 bg-white/15' : ''}`}>
                  <GitCompare className="h-3 w-3" strokeWidth={1.8} aria-hidden />
                </span>
                Compare
              </button>

              <button
                type="button"
                onClick={() => setShowFilters((current) => !current)}
                aria-expanded={showFilters}
                title="Filter every card on this board"
                className={`insight-tool inline-flex h-9 items-center gap-2 rounded-full border px-3 text-[10.5px] font-bold ${
                  showFilters
                    ? 'border-brand-600 bg-brand-600 text-white'
                    : activeFilterCount > 0
                      ? 'border-brand-600 bg-ds-surface/70 text-ink-brand'
                      : 'border-white/65 bg-ds-surface/55 text-ds-ink hover:bg-ds-surface/80 dark:border-white/15'
                }`}
              >
                <span className={`insight-tool-icon ${showFilters ? 'border-white/30 bg-white/15' : ''}`}>
                  <Filter className="h-3 w-3" strokeWidth={1.8} aria-hidden />
                </span>
                Filters
                {activeFilterCount > 0 && (
                  <span className="rounded-full bg-white/25 px-1.5 py-0.5 font-mono text-[9px] font-bold">
                    {activeFilterCount}
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* ── Filters ─────────────────────────────────────────────────── */}
          {showFilters && (
            <div
              className="relative z-10 rounded-[26px] border border-white/60 bg-ds-surface/65 p-4 backdrop-blur-xl dark:border-white/10"
              style={{ '--insight-i': 0 } as React.CSSProperties}
            >
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-ink-muted">
                  Filter every card on this board
                </p>
                {activeFilterCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setFilters({ clinicIds: [], doctorNames: [], caseTypeIds: [] })}
                    className="text-[10.5px] font-bold text-ink-brand hover:underline"
                  >
                    Clear all
                  </button>
                )}
              </div>
              <div className="space-y-3">
                <FilterGroup
                  label="Clinics"
                  items={labs.map((lab) => ({ id: lab.id, label: lab.name }))}
                  selected={filters.clinicIds}
                  onToggle={(value) => toggleFilter('clinicIds', value)}
                />
                <FilterGroup
                  label="Doctors"
                  items={doctors.map((doctor) => ({ id: doctor, label: doctor }))}
                  selected={filters.doctorNames}
                  onToggle={(value) => toggleFilter('doctorNames', value)}
                />
                <FilterGroup
                  label="Case types"
                  items={caseTypes.map((type) => ({ id: type.id, label: type.name }))}
                  selected={filters.caseTypeIds}
                  onToggle={(value) => toggleFilter('caseTypeIds', value)}
                />
              </div>
            </div>
          )}

          {/* ── Bento ───────────────────────────────────────────────────── */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-12 xl:gap-5">
            <InsightsCard
              className="min-h-[230px] xl:col-span-4"
              title="Invoiced"
              subtitle="Collected vs outstanding"
              accent="#6366f1"
              index={0}
              onDrill={() => setDrillInvoices(inScopeInvoices)}
              drillLabel="invoices"
            >
              <InvoicedMetric metrics={metrics.kpi} collectionRate={collectionRate} compare={compare} />
            </InsightsCard>

            <InsightsCard
              className="min-h-[230px] xl:col-span-4"
              title="Collected"
              subtitle="Cash against invoiced work"
              accent="#34d399"
              index={1}
              onDrill={() => setDrillInvoices(inScopeInvoices)}
              drillLabel="invoices"
            >
              <CollectedMetric metrics={metrics.kpi} flow={metrics.flow} compare={compare} />
            </InsightsCard>

            <InsightsCard
              className="min-h-[230px] xl:col-span-4"
              tone="spotlight"
              glow
              title="Outstanding"
              subtitle="Balance by clinic"
              accent="#8b5cf6"
              index={2}
              onDrill={() => setDrillInvoices(inScopeInvoices)}
              drillLabel="invoices"
            >
              <OutstandingMetric metrics={metrics.kpi} standings={metrics.clinicStandings} compare={compare} />
            </InsightsCard>

            <InsightsCard
              className="md:col-span-2 xl:col-span-8 xl:min-h-[440px]"
              glow
              title="Money flow"
              subtitle="Invoiced vs collected, with the cumulative line"
              accent="#6366f1"
              index={3}
              onDrill={() => setDrillInvoices(inScopeInvoices)}
              drillLabel="invoices"
            >
              <MoneyFlowChart series={metrics.flow} metrics={metrics.kpi} compare={compare} />
            </InsightsCard>

            <InsightsCard
              className="md:col-span-2 xl:col-span-4 xl:min-h-[440px]"
              tone="spotlight"
              glow
              title="Throughput"
              subtitle="Received vs delivered"
              accent="#22d3ee"
              index={4}
              onDrill={() => setDrillCases(inScopeCases)}
              drillLabel="cases"
            >
              <ThroughputBars series={metrics.throughput} />
            </InsightsCard>

            <InsightsCard
              className="min-h-[300px] xl:col-span-4"
              title="Performance"
              subtitle="Collection, delivery & revisions"
              accent="#a78bfa"
              index={5}
              onDrill={() => setDrillCases(inScopeCases)}
              drillLabel="cases"
            >
              <PerformanceRings metrics={metrics.rings} />
            </InsightsCard>

            <InsightsCard
              className="min-h-[300px] xl:col-span-4"
              title="Revenue mix"
              subtitle="Revenue by case type"
              accent="#34d399"
              index={6}
              onDrill={() => setDrillInvoices(inScopeInvoices)}
              drillLabel="invoices"
            >
              <ProductMixDonut mix={metrics.productMix} />
            </InsightsCard>

            <InsightsCard
              className="min-h-[300px] xl:col-span-4"
              title="Intake by day"
              subtitle="Cases received this period"
              accent="#22d3ee"
              index={7}
              onDrill={() => setDrillCases(inScopeCases)}
              drillLabel="cases"
            >
              <DayHeatStrip heat={metrics.dayHeat} />
            </InsightsCard>

            <InsightsCard
              className="md:col-span-2 xl:col-span-8 xl:min-h-[340px]"
              title="Clinic standings"
              subtitle="Revenue & open balance"
              accent="#818cf8"
              index={8}
              onDrill={() => setDrillInvoices(inScopeInvoices)}
              drillLabel="invoices"
            >
              <ClinicStandings data={metrics.clinicStandings} />
            </InsightsCard>

            <InsightsCard
              className="md:col-span-2 xl:col-span-4 xl:min-h-[340px]"
              title="Doctor workload"
              subtitle="Cases & value"
              accent="#c4b5fd"
              index={9}
              onDrill={() => setDrillCases(inScopeCases)}
              drillLabel="cases"
            >
              <DoctorWorkload data={metrics.doctorRadar} />
            </InsightsCard>
          </div>

          <p className="pb-1 text-center text-[10px] font-semibold text-ink-muted">
            Every card reads the same period and filters · the arrow opens the records behind it.
          </p>
        </div>
      </div>

      {/* ── Drill-in modals ─────────────────────────────────────────────── */}
      {drillInvoices && (
        <DrillModal
          title={`Invoices in scope · ${drillInvoices.length}`}
          onClose={() => setDrillInvoices(null)}
        >
          {drillInvoices.length === 0 ? (
            <Empty />
          ) : (
            <ul className="divide-y divide-ds-line/40">
              {drillInvoices.slice(0, 50).map((invoice) => (
                <li key={invoice.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedInvoice(invoice)}
                    className="flex w-full items-center justify-between gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-ds-surface/60"
                  >
                    <span className="font-mono text-xs font-bold text-ds-ink">{invoice.invoice_number}</span>
                    <span className="truncate text-[11px] text-ink-muted">{invoice.lab_name}</span>
                    <span className="font-mono text-xs font-bold text-ds-ink">{pkr(invoice.final_amount)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </DrillModal>
      )}

      {drillCases && (
        <DrillModal title={`Cases in scope · ${drillCases.length}`} onClose={() => setDrillCases(null)}>
          {drillCases.length === 0 ? (
            <Empty />
          ) : (
            <ul className="divide-y divide-ds-line/40">
              {drillCases.slice(0, 50).map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedCase(item)}
                    className="flex w-full items-center justify-between gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-ds-surface/60"
                  >
                    <span className="font-mono text-xs font-bold text-ds-ink">{item.case_number}</span>
                    <span className="truncate text-[11px] text-ink-muted">{item.case_type_name}</span>
                    <span className="text-[11px] font-bold text-ink-muted">{item.status}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </DrillModal>
      )}

      {selectedInvoice && (
        <InvoiceStatementModal
          invoice={selectedInvoice}
          caseData={cases.find(
            (item) => item.id === selectedInvoice.case_id || item.case_number === selectedInvoice.case_number,
          )}
          onClose={() => setSelectedInvoice(null)}
        />
      )}
      {selectedCase && <CaseDetailModal initialCase={selectedCase} onClose={() => setSelectedCase(null)} />}
    </>
  );
};

const FilterGroup: React.FC<{
  label: string;
  items: { id: string; label: string }[];
  selected: string[];
  onToggle: (value: string) => void;
}> = ({ label, items, selected, onToggle }) => (
  <div>
    <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-ink-muted">{label}</p>
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => {
        const on = selected.includes(item.id);
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onToggle(item.id)}
            aria-pressed={on}
            className={`rounded-full border px-2.5 py-1 text-[10.5px] font-semibold transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] ${
              on
                ? 'border-brand-600 bg-brand-600 text-white'
                : 'border-ds-line/60 bg-ds-surface/60 text-ink-muted hover:border-brand-600/40 hover:text-ds-ink'
            }`}
          >
            {item.label}
          </button>
        );
      })}
      {items.length === 0 && <span className="text-[10.5px] text-ink-muted">none</span>}
    </div>
  </div>
);

const DrillModal: React.FC<{ title: string; onClose: () => void; children: React.ReactNode }> = ({
  title,
  onClose,
  children,
}) => (
  <div
    className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-md"
    onClick={onClose}
  >
    <div
      className="ds-glass-pane flex max-h-[82vh] w-full max-w-2xl flex-col overflow-hidden rounded-[26px]"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="flex items-center justify-between gap-3 border-b border-ds-line/40 px-5 py-4">
        <h3 className="text-[13px] font-bold tracking-[-0.01em] text-ds-ink">{title}</h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="insight-drill text-ds-accent"
        >
          <X className="h-4 w-4" strokeWidth={1.8} aria-hidden />
        </button>
      </div>
      <div className="min-h-0 overflow-y-auto p-4">{children}</div>
    </div>
  </div>
);

const Empty: React.FC = () => (
  <p className="py-8 text-center text-[11px] font-semibold text-ink-muted">No records in this period.</p>
);
