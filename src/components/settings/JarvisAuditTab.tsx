/**
 * JarvisAuditTab — read-only display of every AI action Jarvis performed.
 *
 * Each entry shows: timestamp, user, action kind, target, risk level,
 * confirmed status, and before/after values (when available).
 * Never mutates — this is an audit trail, not a control surface.
 */
import React, { useMemo } from 'react';
import { Activity, ShieldCheck, Search } from 'lucide-react';
import { useJarvisAuditLog } from '../../context/JarvisProvider';
import { formatDate } from '../../utils/dateUtils';

const RISK_META: Record<'read' | 'write' | 'destructive', { label: string; color: string; icon: React.ComponentType<{ className?: string }> }> = {
  read: { label: 'Read', color: 'text-blue-500 bg-blue-50 border-blue-200', icon: Activity },
  write: { label: 'Write', color: 'text-amber-500 bg-amber-50 border-amber-200', icon: Activity },
  destructive: { label: 'Destructive', color: 'text-rose-500 bg-rose-50 border-rose-200', icon: ShieldCheck },
};

/** Short label for an action + target, e.g. "payment · DS-0001" → "payment DS-0001". */
const actionLabel = (entry: ReturnType<typeof useJarvisAuditLog>[number]): string => {
  const action = entry.action || 'action';
  const target = entry.target || '';
  if (!target) return action;
  return `${action} ${target}`;
};

/** Compact before→after for numeric writes; empty string for others. */
const changesSummary = (entry: ReturnType<typeof useJarvisAuditLog>[number]): string => {
  const b = entry.before, a = entry.after;
  if (b === undefined || a === undefined) return '';
  const fmt = (v: unknown) => (typeof v === 'number' ? v.toLocaleString() : String(v).slice(0, 60));
  return `${fmt(b)} → ${fmt(a)}`;
};

export const JarvisAuditTab: React.FC = () => {
  const log = useJarvisAuditLog();

  const sorted = useMemo(
    () => [...log].sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime()),
    [log],
  );

  return (
    <div className="max-w-4xl space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-slate-100 border border-slate-200 text-ink-muted flex items-center justify-center">
          <Activity className="w-5 h-5" />
        </div>
        <div>
          <h3 className="font-bold text-slate-900 text-sm">Jarvis Audit Log</h3>
          <p className="text-xs text-slate-500">
            Every AI action — who, what, where, and whether it was confirmed. Read-only.
          </p>
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-slate-200 p-10 text-center">
          <Search className="mx-auto w-8 h-8 text-slate-300 mb-2" />
          <p className="text-sm font-bold text-slate-700">No AI actions logged yet.</p>
          <p className="text-xs text-slate-400 mt-1">
            Tell Jarvis to do something: “Open the general ledger”, “Record payment of PKR 1,000 for Mir Dental”.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <div className="grid grid-cols-[110px_90px_1fr_90px_70px_60px_80px] px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-400 bg-slate-50 border-b border-slate-200">
            <div>Time</div>
            <div>User</div>
            <div>Action</div>
            <div>Risk</div>
            <div>Confirmed</div>
            <div></div>
            <div>Changes</div>
          </div>
          <div className="divide-y divide-slate-100">
            {sorted.map((entry, i) => {
              const meta = RISK_META[entry.risk] || RISK_META.read;
              const label = actionLabel(entry);
              const changes = changesSummary(entry);
              return (
                <div
                  key={`${entry.ts}-${i}`}
                  className="grid grid-cols-[110px_90px_1fr_90px_70px_60px_80px] items-start px-4 py-3 hover:bg-slate-50 transition-colors"
                >
                  <div className="text-[11px] font-mono text-slate-500 pt-0.5">
                    {formatDate(entry.ts)}
                  </div>
                  <div className="text-[11px] font-mono font-semibold text-slate-700 whitespace-nowrap pt-0.5">
                    {entry.userId || '-'}
                  </div>
                  <div className="text-[11px] font-mono font-bold text-slate-900 pt-0.5 line-clamp-2" title={label}>
                    {label}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <meta.icon className={`w-3 h-3 ${meta.color.split(' ')[0]}`} />
                    <span className={`text-[9px] px-2 py-0.5 rounded border font-bold uppercase tracking-wider ${meta.color}`}>
                      {meta.label}
                    </span>
                  </div>
                  <div className="pt-0.5">
                    <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider border ${entry.confirmed ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-50 text-slate-400 border-slate-200'}`}>
                      {entry.confirmed ? 'Yes' : '—'}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-400 pt-0.5">#{sorted.length - i}</div>
                  <div className="text-[10px] font-mono text-slate-500 pt-0.5" title={changes || '—'}>
                    {changes || '—'}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex gap-2 border border-slate-200 rounded-lg p-2.5 bg-slate-50">
        <Search className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
        <p className="text-[11px] text-slate-500">
          The log is in-memory and rolls over at 100 entries. It fills as voice commands execute.
        </p>
      </div>
    </div>
  );
};
