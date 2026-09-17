import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { AuditEvent } from '../../types';
import { 
  ShieldCheck, 
  Search, 
  Filter, 
  Download, 
  Calendar, 
  User, 
  Activity, 
  AlertTriangle, 
  RotateCcw, 
  CheckCircle2, 
  FileText, 
  DollarSign, 
  Wallet, 
  CreditCard, 
  Eye, 
  X,
  Code,
  ArrowRight
} from 'lucide-react';

export const AuditLogView: React.FC = () => {
  const { auditEvents } = useApp();

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [actionFilter, setActionFilter] = useState<string>('all');
  const [actorFilter, setActorFilter] = useState<string>('all');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [selectedEventForDetail, setSelectedEventForDetail] = useState<AuditEvent | null>(null);

  // Distinct actors
  const distinctActors = useMemo(() => {
    const set = new Set<string>();
    (Array.isArray(auditEvents) ? auditEvents : []).forEach(e => {
      if (e && e.actor) set.add(e.actor);
    });
    return Array.from(set).sort();
  }, [auditEvents]);

  // Distinct actions
  const distinctActions = useMemo(() => {
    const set = new Set<string>();
    (Array.isArray(auditEvents) ? auditEvents : []).forEach(e => {
      if (e && e.action) set.add(e.action);
    });
    return Array.from(set).sort();
  }, [auditEvents]);

  // Filtered audit events
  const filteredEvents = useMemo(() => {
    const list = Array.isArray(auditEvents) ? auditEvents : [];
    return list.filter(e => {
      if (!e) return false;
      if (actionFilter !== 'all' && e.action !== actionFilter) return false;
      if (actorFilter !== 'all' && e.actor !== actorFilter) return false;

      const timeStr = String(e.timestamp || '');
      if (startDate && timeStr.slice(0, 10) < startDate) return false;
      if (endDate && timeStr.slice(0, 10) > endDate) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchRef = (e.entity_ref || '').toLowerCase().includes(q);
        const matchNotes = (e.notes || '').toLowerCase().includes(q);
        const matchReason = (e.reason || '').toLowerCase().includes(q);
        const matchActor = (e.actor || '').toLowerCase().includes(q);
        const matchAction = (e.action || '').toLowerCase().includes(q);
        const matchEntityId = (e.entity_id || '').toLowerCase().includes(q);
        if (!matchRef && !matchNotes && !matchReason && !matchActor && !matchAction && !matchEntityId) {
          return false;
        }
      }

      return true;
    }).sort((a, b) => {
      const timeA = a?.timestamp ? new Date(a.timestamp).getTime() : 0;
      const timeB = b?.timestamp ? new Date(b.timestamp).getTime() : 0;
      return (isNaN(timeB) ? 0 : timeB) - (isNaN(timeA) ? 0 : timeA);
    });
  }, [auditEvents, actionFilter, actorFilter, startDate, endDate, searchQuery]);

  // Metrics summary
  const metrics = useMemo(() => {
    let reversals = 0;
    let reconciliations = 0;
    let adjustments = 0;
    let payments = 0;

    const list = Array.isArray(auditEvents) ? auditEvents : [];
    list.forEach(e => {
      if (!e || !e.action) return;
      const act = String(e.action);
      if (act.includes('REVERS') || act.includes('VOID')) reversals++;
      else if (act.includes('RECONCIL')) reconciliations++;
      else if (act.includes('ADJUST') || act.includes('CREDIT_NOTE')) adjustments++;
      else if (act.includes('PAYMENT') || act.includes('ADVANCE')) payments++;
    });

    return {
      total: list.length,
      reversals,
      reconciliations,
      adjustments,
      payments
    };
  }, [auditEvents]);

  // Badge styler for action type
  const getActionBadge = (action: string) => {
    if (action.includes('REVERS') || action.includes('VOID')) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black bg-rose-100 text-rose-800 border border-rose-300">
          <RotateCcw className="w-3 h-3 text-rose-600" />
          <span>{action}</span>
        </span>
      );
    }
    if (action.includes('EXCEPTION')) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300">
          <AlertTriangle className="w-3 h-3 text-amber-700" />
          <span>{action}</span>
        </span>
      );
    }
    if (action.includes('RECONCIL')) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-900 border border-emerald-300">
          <CheckCircle2 className="w-3 h-3 text-emerald-700" />
          <span>{action}</span>
        </span>
      );
    }
    if (action.includes('CREDIT') || action.includes('ADJUST')) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-purple-900 border border-purple-300">
          <DollarSign className="w-3 h-3 text-purple-700" />
          <span>{action}</span>
        </span>
      );
    }
    if (action.includes('ADVANCE')) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-900 border border-indigo-300">
          <Wallet className="w-3 h-3 text-indigo-700" />
          <span>{action}</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-800 border border-slate-300">
        <Activity className="w-3 h-3 text-slate-600" />
        <span>{action}</span>
      </span>
    );
  };

  // Export CSV
  const handleExportCSV = () => {
    const headers = ['Timestamp', 'Actor', 'Action', 'Entity Type', 'Entity Reference', 'Reason', 'Notes'];
    const rows = filteredEvents.map(e => [
      e.timestamp,
      `"${(e.actor || '').replace(/"/g, '""')}"`,
      e.action,
      e.entity_type,
      e.entity_ref,
      `"${(e.reason || '').replace(/"/g, '""')}"`,
      `"${(e.notes || '').replace(/"/g, '""')}"`
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `financial_audit_trail_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      
      {/* Top Banner & Security Header */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-2xs">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-slate-900 text-white flex items-center justify-center shadow-xs">
              <ShieldCheck className="w-6 h-6 text-emerald-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-bold text-slate-900">Financial Security & Audit Trail</h3>
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Tamper-Resistant Ledger</span>
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Immutable event stream • Every invoice, payment, credit note, reversal and reconciliation is recorded
              </p>
            </div>
          </div>

          <button
            onClick={handleExportCSV}
            className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer self-start lg:self-auto"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export Audit Trail (CSV)</span>
          </button>
        </div>

        {/* 4 Summary Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5 pt-5 border-t border-slate-100">
          <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Total Logged Events</span>
            <span className="text-xl font-black text-slate-900 mt-1 block">{metrics.total}</span>
            <span className="text-[10px] text-slate-500">Forensic history</span>
          </div>

          <div className="p-3 bg-emerald-50/50 rounded-xl border border-emerald-200">
            <span className="text-[11px] font-bold text-emerald-700 uppercase tracking-wider block">Collections & Deposits</span>
            <span className="text-xl font-black text-emerald-950 mt-1 block">{metrics.payments}</span>
            <span className="text-[10px] text-emerald-700">Cash, Bank, Advance</span>
          </div>

          <div className="p-3 bg-rose-50/50 rounded-xl border border-rose-200">
            <span className="text-[11px] font-bold text-rose-700 uppercase tracking-wider block">Reversals & Voids</span>
            <span className="text-xl font-black text-rose-950 mt-1 block">{metrics.reversals}</span>
            <span className="text-[10px] text-rose-700">Strictly non-destructive</span>
          </div>

          <div className="p-3 bg-purple-50/50 rounded-xl border border-purple-200">
            <span className="text-[11px] font-bold text-purple-700 uppercase tracking-wider block">Adjustments & Reconciliations</span>
            <span className="text-xl font-black text-purple-950 mt-1 block">{metrics.adjustments + metrics.reconciliations}</span>
            <span className="text-[10px] text-purple-700">Bank verified & credit notes</span>
          </div>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-[280px]">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search reference, actor, reason, notes..."
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
            />
          </div>

          {/* Action Filter */}
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg font-medium text-slate-700 cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          >
            <option value="all">All Action Types</option>
            {distinctActions.map(action => (
              <option key={action} value={action}>{action}</option>
            ))}
          </select>

          {/* Actor Filter */}
          <select
            value={actorFilter}
            onChange={(e) => setActorFilter(e.target.value)}
            className="px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg font-medium text-slate-700 cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          >
            <option value="all">All Actors / Users</option>
            {distinctActors.map(actor => (
              <option key={actor} value={actor}>{actor}</option>
            ))}
          </select>
        </div>

        {/* Date Filter */}
        <div className="flex items-center gap-2 text-xs">
          <span className="text-slate-400 font-medium">Date:</span>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="px-2 py-1 bg-white border border-slate-200 rounded-lg text-xs"
          />
          <span className="text-slate-400">to</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="px-2 py-1 bg-white border border-slate-200 rounded-lg text-xs"
          />
          {(startDate || endDate || searchQuery || actionFilter !== 'all' || actorFilter !== 'all') && (
            <button
              onClick={() => {
                setStartDate('');
                setEndDate('');
                setSearchQuery('');
                setActionFilter('all');
                setActorFilter('all');
              }}
              className="text-xs text-indigo-600 hover:text-indigo-800 font-bold px-1 cursor-pointer"
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Audit Log Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
        <div className="overflow-x-auto no-scrollbar">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 text-[10px] uppercase font-bold border-b border-slate-200">
              <tr>
                <th className="py-3 px-4 w-44">Timestamp</th>
                <th className="py-3 px-4 w-32">Actor</th>
                <th className="py-3 px-4 w-52">Action Performed</th>
                <th className="py-3 px-4 w-36">Entity Reference</th>
                <th className="py-3 px-4">Reason / Notes</th>
                <th className="py-3 px-4 text-right w-24">Payload</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
              {filteredEvents.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400">
                    <ShieldCheck className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                    <p className="font-bold text-slate-600 text-sm">No Audit Events Found</p>
                    <p className="text-xs mt-1">No security log entries match the search filters.</p>
                  </td>
                </tr>
              ) : (
                filteredEvents.map(event => (
                  <tr key={event.id} className="hover:bg-slate-50/70 transition-colors">
                    
                    {/* Timestamp */}
                    <td className="py-3 px-4 whitespace-nowrap">
                      <div className="flex items-center gap-1.5 font-mono text-slate-600">
                        <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span>{event.timestamp}</span>
                      </div>
                    </td>

                    {/* Actor */}
                    <td className="py-3 px-4 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <div className="w-5 h-5 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center font-bold text-[10px]">
                          {(event.actor || 'U').charAt(0).toUpperCase()}
                        </div>
                        <span className="font-bold text-slate-900">{event.actor || 'System'}</span>
                      </div>
                    </td>

                    {/* Action */}
                    <td className="py-3 px-4 whitespace-nowrap">
                      {getActionBadge(event.action)}
                    </td>

                    {/* Entity Reference */}
                    <td className="py-3 px-4 font-mono font-bold text-slate-900 whitespace-nowrap">
                      <span className="px-2 py-0.5 bg-slate-100 rounded text-slate-800 border border-slate-200">
                        {event.entity_ref || event.entity_id}
                      </span>
                    </td>

                    {/* Reason & Notes */}
                    <td className="py-3 px-4">
                      {event.reason && (
                        <span className="font-bold text-slate-900 block">{event.reason}</span>
                      )}
                      <span className="text-slate-500 text-[11px] block">{event.notes || '—'}</span>
                    </td>

                    {/* Payload Inspection */}
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <button
                        onClick={() => setSelectedEventForDetail(event)}
                        className="px-2 py-1 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors inline-flex items-center gap-1 text-[11px] font-bold cursor-pointer"
                        title="View Full Audit Snapshot"
                      >
                        <Code className="w-3.5 h-3.5" />
                        <span>Inspect</span>
                      </button>
                    </td>

                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Snapshot / Detail Modal */}
      {selectedEventForDetail && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            
            <div className="p-4 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <ShieldCheck className="w-5 h-5 text-emerald-400" />
                <div>
                  <h4 className="font-bold text-sm">Audit Snapshot Inspection</h4>
                  <p className="text-[11px] text-slate-400">ID: {selectedEventForDetail.id}</p>
                </div>
              </div>
              <button
                onClick={() => setSelectedEventForDetail(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4 max-h-[80vh] overflow-y-auto">
              {/* Event Metadata Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Actor</span>
                  <span className="text-xs font-bold text-slate-900 mt-0.5 block">{selectedEventForDetail.actor}</span>
                </div>
                <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Timestamp</span>
                  <span className="text-xs font-mono font-bold text-slate-900 mt-0.5 block">{selectedEventForDetail.timestamp}</span>
                </div>
                <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Entity</span>
                  <span className="text-xs font-bold text-slate-900 mt-0.5 block">{selectedEventForDetail.entity_type}</span>
                </div>
                <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Reference</span>
                  <span className="text-xs font-mono font-bold text-slate-900 mt-0.5 block">{selectedEventForDetail.entity_ref}</span>
                </div>
              </div>

              {/* Action and Reason */}
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-500">Action:</span>
                  {getActionBadge(selectedEventForDetail.action)}
                </div>
                {selectedEventForDetail.reason && (
                  <p className="text-xs text-slate-800">
                    <span className="font-bold">Reason: </span>{selectedEventForDetail.reason}
                  </p>
                )}
                {selectedEventForDetail.notes && (
                  <p className="text-xs text-slate-600">
                    <span className="font-bold">Notes: </span>{selectedEventForDetail.notes}
                  </p>
                )}
              </div>

              {/* Old State vs New State */}
              {(selectedEventForDetail.old_state || selectedEventForDetail.new_state) ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <span className="text-[11px] font-bold text-slate-600 uppercase block mb-1">Previous State</span>
                    <pre className="p-3 bg-slate-900 text-slate-200 rounded-xl text-[11px] font-mono overflow-x-auto max-h-48">
                      {JSON.stringify(selectedEventForDetail.old_state, null, 2) || 'null'}
                    </pre>
                  </div>
                  <div>
                    <span className="text-[11px] font-bold text-emerald-700 uppercase block mb-1">Committed State</span>
                    <pre className="p-3 bg-slate-900 text-emerald-300 rounded-xl text-[11px] font-mono overflow-x-auto max-h-48">
                      {JSON.stringify(selectedEventForDetail.new_state, null, 2) || 'null'}
                    </pre>
                  </div>
                </div>
              ) : (
                <div>
                  <span className="text-[11px] font-bold text-slate-600 uppercase block mb-1">Event Raw Record</span>
                  <pre className="p-3 bg-slate-900 text-slate-200 rounded-xl text-[11px] font-mono overflow-x-auto max-h-60">
                    {JSON.stringify(selectedEventForDetail, null, 2)}
                  </pre>
                </div>
              )}
            </div>

            <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-end">
              <button
                onClick={() => setSelectedEventForDetail(null)}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl transition-colors cursor-pointer"
              >
                Close Inspector
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
};
