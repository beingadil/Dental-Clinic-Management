import React, { useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { DentalCase, CaseStatus, PriorityLevel, CaseTemplate } from '../../types';
import { CaseDetailModal } from './CaseDetailModal';
import { formatDoctorName } from '../../utils/doctorName';
import { CaseDetailView } from './CaseDetailView';
import { CaseTemplateModal } from './CaseTemplateModal';
import { CaseJobSlipModal } from './CaseJobSlipModal';
import { BulkPrintModal } from './BulkPrintModal';
import { CaseProgressIndicator } from './CaseProgressIndicator';
import { PageHeader, EmptyState, Badge, CaseStatusBadge, PriorityBadge, usePagination } from '../common/ui';
import { 
  PlusCircle, 
  Search, 
  Filter, 
  ArrowDownAZ,
  ArrowUpZA,
  Bookmark, 
  AlertTriangle, 
  CheckCircle2, 
  Clock, 
  Eye, 
  Calendar,
  X,
  LayoutGrid,
  Table as TableIcon,
  GripVertical,
  ChevronRight,
  Move,
  Printer,
  CheckSquare,
  Receipt,
  Pencil,
  Archive,
  ArchiveRestore,
  Trash2
} from 'lucide-react';
import { DatePickerRange } from '../common/DatePickerRange';


const KANBAN_STAGES: { id: CaseStatus; title: string; color: string; badgeBg: string; headerBg: string }[] = [
  { id: 'received', title: 'Received', color: 'bg-slate-500', badgeBg: 'bg-slate-100 text-slate-700', headerBg: 'border-slate-200 bg-slate-50' },
  { id: 'in_progress', title: 'In Progress', color: 'bg-indigo-600', badgeBg: 'bg-indigo-100 text-indigo-700', headerBg: 'border-indigo-100 bg-indigo-50/50' },
  { id: 'qc', title: 'QC Quality', color: 'bg-purple-600', badgeBg: 'bg-purple-100 text-purple-700', headerBg: 'border-purple-100 bg-purple-50/50' },
  { id: 'ready', title: 'Ready', color: 'bg-cyan-600', badgeBg: 'bg-cyan-100 text-cyan-800', headerBg: 'border-cyan-100 bg-cyan-50/50' },
  { id: 'delivered', title: 'Delivered', color: 'bg-fill-success', badgeBg: 'bg-emerald-100 text-emerald-800', headerBg: 'border-emerald-100 bg-emerald-50/50' },
  { id: 'revision', title: 'Revision', color: 'bg-amber-600', badgeBg: 'bg-amber-100 text-amber-800', headerBg: 'border-amber-100 bg-amber-50/50' },
];

/** Columns the workstation list can be ordered by. */
type CaseSortKey =
  | 'created_at'
  | 'updated_at'
  | 'delivery_date'
  | 'received_date'
  | 'priority'
  | 'case_number'
  | 'patient_name'
  | 'lab_name'
  | 'case_type_name'
  | 'doctor_name'
  | 'final_price';

type SortOrder = 'asc' | 'desc';

/** Urgent ranks above high so `asc` reads "most urgent first". */
const PRIORITY_RANK: Record<PriorityLevel, number> = { urgent: 4, high: 3, normal: 2, low: 1 };

/**
 * Case-number comparison that is numeric, not lexicographic: DS-9 must sort
 * before DS-10. Both sides are normalised to the trailing digits, so
 * DS-0009 / DS-9 / DS-00009 land in the same place.
 */
const compareCaseNumbers = (a: string, b: string): number => {
  const na = parseInt(a.replace(/\D+/g, ''), 10);
  const nb = parseInt(b.replace(/\D+/g, ''), 10);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return a.localeCompare(b);
};

/** Optional date columns are blank on legacy rows; blanks sort last in either direction. */
const compareOptionalDate = (a?: string | null, b?: string | null): number => {
  const av = a || '';
  const bv = b || '';
  if (!av && !bv) return 0;
  if (!av) return 1;
  if (!bv) return -1;
  return av.localeCompare(bv);
};

/**
 * One comparison for every sort key, so a new key is one line here rather than
 * another branch in the memo. Always returns ascending order; the caller
 * applies the direction.
 */
const compareCases = (a: DentalCase, b: DentalCase, key: CaseSortKey): number => {
  switch (key) {
    case 'created_at':
      return compareOptionalDate(a.created_at, b.created_at);
    case 'updated_at':
      return compareOptionalDate(a.updated_at, b.updated_at);
    case 'delivery_date':
      return compareOptionalDate(a.delivery_date, b.delivery_date);
    case 'received_date':
      return compareOptionalDate(a.received_date, b.received_date);
    case 'priority':
      return PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority];
    case 'case_number':
      return compareCaseNumbers(a.case_number, b.case_number);
    case 'patient_name':
      return (a.patient_name || '').localeCompare(b.patient_name || '');
    case 'lab_name':
      return a.lab_name.localeCompare(b.lab_name);
    case 'case_type_name':
      return a.case_type_name.localeCompare(b.case_type_name);
    case 'doctor_name':
      return formatDoctorName(a.doctor_name, '').localeCompare(formatDoctorName(b.doctor_name, ''));
    case 'final_price':
      return (a.final_price || 0) - (b.final_price || 0);
    default:
      return 0;
  }
};

/** Dropdown labels. Grouped so the operator reads as a list, not an enum. */
const SORT_OPTIONS: { group: string; options: { value: CaseSortKey; label: string }[] }[] = [
  {
    group: 'Recently added',
    options: [
      { value: 'created_at', label: 'Newest first' },
      { value: 'updated_at', label: 'Last updated' },
    ],
  },
  {
    group: 'Delivery',
    options: [
      { value: 'delivery_date', label: 'Delivery date' },
      { value: 'received_date', label: 'Received date' },
      { value: 'priority', label: 'Priority' },
    ],
  },
  {
    group: 'Case',
    options: [
      { value: 'case_number', label: 'Case number' },
      { value: 'patient_name', label: 'Patient name' },
      { value: 'doctor_name', label: 'Doctor name' },
    ],
  },
  {
    group: 'Work',
    options: [
      { value: 'lab_name', label: 'Dental clinic' },
      { value: 'case_type_name', label: 'Material / type' },
      { value: 'final_price', label: 'Case value' },
    ],
  },
];

export const CaseListView: React.FC = () => {
  const { cases, labs, caseTypes, searchTerm, setSearchTerm, updateCase, brandingSettings, todayStr, archiveCase, restoreCase, deleteCasePermanently } = useApp();

  /* Workstation shows ACTIVE cases; the Archive tab shows completed cases
     (archived_at set). Archived rows never enter the kanban/table pipeline. */
  const [showArchive, setShowArchive] = useState(false);
  const [archiveFrom, setArchiveFrom] = useState('');
  const [archiveTo, setArchiveTo] = useState('');
  const [archiveClinic, setArchiveClinic] = useState('all');
  const [archiveSearch, setArchiveSearch] = useState('');
  const [confirmPermanentId, setConfirmPermanentId] = useState<string | null>(null);

  const activeCases = useMemo(() => cases.filter((c) => !c.archived_at), [cases]);
  const archivedCases = useMemo(() => cases.filter((c) => !!c.archived_at), [cases]);

  /* Rows mount one page at a time. This list used to grow an ever-larger
     "Show more" window instead: past ~300 rows the table render itself is the
     bottleneck (1000 rows ≈ 41k DOM nodes), and clicking through it kept every
     previously-mounted row alive instead of swapping them. */

  // State (Default to Table View)
  const [viewMode, setViewMode] = useState<'kanban' | 'table'>(() => {
    try {
      const saved = localStorage.getItem('dentlab_workstation_view_mode');
      if (saved === 'kanban' || saved === 'table') return saved;
    } catch {
      // ignore
    }
    return 'table';
  });

  const handleViewModeChange = (mode: 'kanban' | 'table') => {
    setViewMode(mode);
    try {
      localStorage.setItem('dentlab_workstation_view_mode', mode);
    } catch {
      // ignore
    }
  };
  const [selectedCase, setSelectedCase] = useState<DentalCase | null>(null);
  // Full-page viewer target — distinct from the edit-wizard target so a plain
  // click reads the case while the wizard stays one explicit click away.
  const [viewedCaseId, setViewedCaseId] = useState<string | null>(null);

  const [printSlipCase, setPrintSlipCase] = useState<DentalCase | null>(null);
  const [selectedCaseIds, setSelectedCaseIds] = useState<string[]>([]);
  const [bulkPrintModalOpen, setBulkPrintModalOpen] = useState(false);
  const [bulkPrintType, setBulkPrintType] = useState<'slips' | 'invoices'>('slips');
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const [appliedTemplate, setAppliedTemplate] = useState<CaseTemplate | null>(null);
  const [templateLibraryOpen, setTemplateLibraryOpen] = useState(false);

  // Drag & drop state
  const [draggedCaseId, setDraggedCaseId] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<CaseStatus | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [labFilter, setLabFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [dueSoonOnly, setDueSoonOnly] = useState(false);
  /* Default order is newest-registered first. The workstation is an intake
     queue: the row you want is the row you just typed, and with delivery_date
     ascending an operator had to scroll to the bottom of a long case list to
     confirm the case they had just created actually landed. */
  const [sortBy, setSortBy] = useState<CaseSortKey>('created_at');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

  // Helper for 24-Hour Visual Warning System
  const checkCaseWarning = (c: DentalCase) => {
    if (c.status === 'delivered' || c.status === 'cancelled') {
      return { isWarning: false, isOverdue: false, isDueSoon: false, hoursLeft: 999 };
    }

    const enabled = brandingSettings?.enable24hWarning !== false;
    if (!enabled) return { isWarning: false, isOverdue: false, isDueSoon: false, hoursLeft: 999 };

    const thresholdHours = brandingSettings?.warningThresholdHours ?? 24;
    const isOverdue = c.delivery_date < todayStr;
    const isDueSoon = c.delivery_date === todayStr;
    const isWarning = isOverdue || isDueSoon;

    return {
      isWarning,
      isOverdue,
      isDueSoon,
      hoursLeft: isOverdue ? 0 : (c.delivery_date === todayStr ? 8 : thresholdHours)
    };
  };

  const warningCasesCount = cases.filter((c) => checkCaseWarning(c).isWarning).length;

  // Drag Handlers
  const handleDragStart = (e: React.DragEvent, caseId: string) => {
    setDraggedCaseId(caseId);
    e.dataTransfer.setData('text/plain', caseId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, status: CaseStatus) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverColumn !== status) {
      setDragOverColumn(status);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent, targetStatus: CaseStatus) => {
    e.preventDefault();
    setDragOverColumn(null);
    const caseId = e.dataTransfer.getData('text/plain') || draggedCaseId;
    if (caseId) {
      const targetCase = cases.find(c => c.id === caseId);
      if (targetCase && targetStatus && targetCase.status !== targetStatus) {
        const formattedStatus = typeof targetStatus === 'string' ? targetStatus.replace('_', ' ') : String(targetStatus);
        updateCase(caseId, { status: targetStatus }, `Moved to ${formattedStatus} via Drag & Drop`);
      }
    }
    setDraggedCaseId(null);
  };

  // Filtered and Sorted cases (active only — archived ones live in the Archive tab)
  const filteredCases = useMemo(() => activeCases.filter((c) => {
    // Search
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      const matchNum = (c.case_number || '').toLowerCase().includes(term);
      const matchPatient = (c.patient_name || '').toLowerCase().includes(term);
      const matchLab = (c.lab_name || '').toLowerCase().includes(term);
      // Matched on the DISPLAY name so "Dr Ahmad" still finds the bare-stored row.
      const matchDoc = formatDoctorName(c.doctor_name, '').toLowerCase().includes(term);
      const matchType = (c.case_type_name || '').toLowerCase().includes(term);
      if (!matchNum && !matchPatient && !matchLab && !matchDoc && !matchType) return false;
    }

    // Status
    if (statusFilter !== 'all' && c.status !== statusFilter) return false;

    // Lab
    if (labFilter !== 'all' && c.lab_id !== labFilter) return false;

    // Priority
    if (priorityFilter !== 'all' && c.priority !== priorityFilter) return false;

    // Due Soon (<24h or threshold)
    if (dueSoonOnly) {
      const { isWarning } = checkCaseWarning(c);
      if (!isWarning) return false;
    }

    return true;
  }).sort((a, b) => {
    return compareCases(a, b, sortBy) * (sortOrder === 'asc' ? 1 : -1);
  }), [activeCases, searchTerm, statusFilter, labFilter, priorityFilter, dueSoonOnly, sortBy, sortOrder, todayStr]);

  /* Archive tab list: date range on delivery date, clinic dropdown, search —
     the same controls every other module uses (shared DatePickerRange). */
  const filteredArchivedCases = useMemo(() => archivedCases.filter((c) => {
    const day = (c.delivery_date || '').slice(0, 10);
    if (archiveFrom && (!day || day < archiveFrom)) return false;
    if (archiveTo && (!day || day > archiveTo)) return false;
    if (archiveClinic !== 'all' && c.lab_id !== archiveClinic) return false;
    if (archiveSearch.trim()) {
      const q = archiveSearch.toLowerCase();
      const hit =
        (c.case_number || '').toLowerCase().includes(q) ||
        (c.patient_name || '').toLowerCase().includes(q) ||
        (c.lab_name || '').toLowerCase().includes(q) ||
        formatDoctorName(c.doctor_name, '').toLowerCase().includes(q) ||
        (c.case_type_name || '').toLowerCase().includes(q);
      if (!hit) return false;
    }
    return true;
  }).sort((a, b) => (b.archived_at || '').localeCompare(a.archived_at || '')), [archivedCases, archiveFrom, archiveTo, archiveClinic, archiveSearch]);

  /* The resetKey mirrors exactly what used to reset the render cap: a narrower
     filter, or a re-sort, starts the reader from the top of the new order. */
  const {
    pageItems: visibleFilteredCases,
    pagination: casesPagination,
  } = usePagination(filteredCases, {
    initialPageSize: 50,
    resetKey: `${searchTerm}|${statusFilter}|${labFilter}|${priorityFilter}|${dueSoonOnly}|${sortBy}|${sortOrder}|${showArchive}`,
  });

  // Bulk selection helper functions
  const toggleSelectCase = (id: string) => {
    setSelectedCaseIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    if (filteredCases.length === 0) return;
    if (selectedCaseIds.length === filteredCases.length) {
      setSelectedCaseIds([]);
    } else {
      setSelectedCaseIds(filteredCases.map((c) => c.id));
    }
  };

  const clearSelection = () => setSelectedCaseIds([]);

  const isBoardView = !showArchive && viewMode === 'kanban';

  return (
    <div className={isBoardView ? 'flex flex-col space-y-6 h-[calc(100vh-110px)]' : 'space-y-6'}>
      {/* Modern Standardized Page Header */}
      <PageHeader
        title="Dental Cases Workstation"
        subtitle="Drag and drop cases across stages, track FDI tooth charts, and manage delivery schedules."
        breadcrumbs={[
          { label: 'Workstation' },
          { label: viewMode === 'table' ? 'Table View' : 'Kanban Board' }
        ]}
        actions={
          <div className="flex flex-wrap items-center gap-2.5">
            {/* View Toggle */}
            <div className="bg-slate-100 p-1 rounded-xl flex items-center gap-1 border border-slate-200">
              <button
                type="button"
                onClick={() => { setShowArchive(false); handleViewModeChange('table'); }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                  !showArchive && viewMode === 'table'
                    ? 'bg-white text-slate-900 shadow-xs border border-slate-200/80'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <TableIcon className="w-3.5 h-3.5" />
                <span>Table View</span>
              </button>
              <button
                type="button"
                onClick={() => { setShowArchive(false); handleViewModeChange('kanban'); }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                  !showArchive && viewMode === 'kanban'
                    ? 'bg-white text-slate-900 shadow-xs border border-slate-200/80'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                <span>Kanban Board</span>
              </button>
              <button
                type="button"
                onClick={() => setShowArchive(true)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                  showArchive
                    ? 'bg-white text-slate-900 shadow-xs border border-slate-200/80'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
                title="Completed cases moved out of the workstation — kept for records, searchable by date"
              >
                <Archive className="w-3.5 h-3.5" />
                <span>Archive ({archivedCases.length})</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => setTemplateLibraryOpen(true)}
              className="px-3.5 py-2 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-xs rounded-xl flex items-center gap-1.5 transition-colors border border-slate-200 shadow-2xs cursor-pointer"
            >
              <Bookmark className="w-4 h-4 text-slate-500" />
              <span className="hidden md:inline">Preset Templates</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setAppliedTemplate(null);
                setIsNewModalOpen(true);
              }}
              className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white font-semibold text-xs md:text-sm rounded-xl shadow-sm hover:shadow flex items-center gap-2 transition-all cursor-pointer"
            >
              <PlusCircle className="w-4 h-4 text-white" />
              <span>Create New Case</span>
            </button>
          </div>
        }
      />

      {/* 24-Hour Visual Warning Alert Banner */}
      {warningCasesCount > 0 && (
        <div className="bg-rose-50 border-2 border-rose-300 text-rose-950 rounded-2xl p-4 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-3 animate-in fade-in">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-rose-600 text-white rounded-xl shadow-xs shrink-0 animate-pulse">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h4 className="font-extrabold text-xs text-rose-950 uppercase tracking-wider flex items-center gap-2">
                <span>Workstation Alert: {warningCasesCount} Case{warningCasesCount > 1 ? 's' : ''} Due Within Next {brandingSettings?.warningThresholdHours || 24} Hours</span>
              </h4>
              <p className="text-[11px] text-rose-800 font-medium mt-0.5">
                Highlighted in red across workstation cards. Immediate laboratory fabrication or dispatch recommended.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 self-start md:self-auto shrink-0">
            <button
              onClick={() => setDueSoonOnly(!dueSoonOnly)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-xs ${
                dueSoonOnly 
                  ? 'bg-rose-900 text-white hover:bg-rose-950'
                  : 'bg-rose-600 hover:bg-rose-700 text-white'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>{dueSoonOnly ? 'Show All Workstation Cases' : `Filter ${warningCasesCount} High-Priority Cases`}</span>
            </button>
          </div>
        </div>
      )}

      {/* Filter and Control Toolbar */}
      <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {/* Search Field */}
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search Case #, Lab, Doctor..."
              className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
            />
          </div>

          {/* Status Filter */}
          <div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full p-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-500 font-medium text-slate-700"
            >
              <option value="all">All Statuses</option>
              <option value="received">Received</option>
              <option value="in_progress">In Progress</option>
              <option value="qc">QC Quality</option>
              <option value="ready">Ready</option>
              <option value="delivered">Delivered</option>
              <option value="revision">Revision</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>

          {/* Lab Filter */}
          <div>
            <select
              value={labFilter}
              onChange={(e) => setLabFilter(e.target.value)}
              className="w-full p-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-500 text-slate-700"
            >
              <option value="all">All Dental Clinics</option>
              {labs.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>

          {/* Priority Filter */}
          <div>
            <select
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value)}
              className="w-full p-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-500 text-slate-700"
            >
              <option value="all">All Priorities</option>
              <option value="urgent">Urgent Only</option>
              <option value="high">High Priority</option>
              <option value="normal">Normal</option>
              <option value="low">Low</option>
            </select>
          </div>

          {/* Sort By Controls */}
          <div className="flex items-center gap-2">
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as CaseSortKey)}
              aria-label="Sort cases by"
              className="w-full p-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none text-slate-700 font-medium"
            >
              {SORT_OPTIONS.map((group) => (
                <optgroup key={group.group} label={group.group}>
                  {group.options.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
              className="p-2 bg-slate-100 hover:bg-slate-200 rounded-xl text-slate-700 transition-colors cursor-pointer"
              aria-label={sortOrder === 'asc' ? 'Sorted ascending — switch to descending' : 'Sorted descending — switch to ascending'}
              title={sortOrder === 'asc'
                ? 'Ascending — oldest / smallest first. Click for descending.'
                : 'Descending — newest / largest first. Click for ascending.'}
            >
              {sortOrder === 'asc'
                ? <ArrowDownAZ className="w-4 h-4" />
                : <ArrowUpZA className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>

      {/* STICKY BULK ACTION BAR */}
      {selectedCaseIds.length > 0 && (
        <div className="sticky top-4 z-20 bg-slate-900 text-white rounded-2xl p-4 shadow-xl flex flex-col sm:flex-row items-center justify-between gap-4 border border-slate-800 animate-in fade-in slide-in-from-top-2">
          <div className="flex items-center gap-3">
            <div className="px-3 py-1.5 bg-indigo-600 text-white font-extrabold text-xs rounded-xl flex items-center gap-2 shadow-xs">
              <CheckSquare className="w-4 h-4" />
              <span>{selectedCaseIds.length} Cases Selected</span>
            </div>
            <span className="text-xs text-slate-300 hidden md:inline">
              Batch actions for workstation tray tickets or laboratory invoices
            </span>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap w-full sm:w-auto justify-end">
            <button
              type="button"
              onClick={() => {
                setBulkPrintType('slips');
                setBulkPrintModalOpen(true);
              }}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl flex items-center gap-2 shadow-md transition-all cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              <span>Print Job Slips ({selectedCaseIds.length})</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setBulkPrintType('invoices');
                setBulkPrintModalOpen(true);
              }}
              className="px-4 py-2 bg-fill-success hover:bg-fill-success text-white font-bold text-xs rounded-xl flex items-center gap-2 shadow-md transition-all cursor-pointer"
            >
              <Receipt className="w-4 h-4" />
              <span>Print Invoices ({selectedCaseIds.length})</span>
            </button>

            <button
              type="button"
              onClick={clearSelection}
              className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-semibold rounded-xl transition-colors cursor-pointer"
            >
              Deselect
            </button>
          </div>
        </div>
      )}

      {/* Main Content Area: Kanban Board vs Table View */}
      {showArchive ? (
        /* ---------------- ARCHIVE TAB: completed cases, searchable ---------------- */
        <div className="space-y-4">
          <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm">
            <div className="flex flex-col lg:flex-row lg:items-center gap-3">
              <div className="relative flex-1 min-w-[180px]">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
                <input
                  type="text"
                  value={archiveSearch}
                  onChange={(e) => setArchiveSearch(e.target.value)}
                  placeholder="Search by case ID, patient, clinic, doctor..."
                  className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-500"
                />
              </div>
              <DatePickerRange
                from={archiveFrom}
                to={archiveTo}
                onChange={(f, t) => { setArchiveFrom(f); setArchiveTo(t); }}
              />
              <select
                value={archiveClinic}
                onChange={(e) => setArchiveClinic(e.target.value)}
                className="w-full lg:w-64 p-2 text-xs bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-700 focus:outline-none focus:border-indigo-500 cursor-pointer"
              >
                <option value="all">All Clinics ({labs.length})</option>
                {labs.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
              {(archiveFrom || archiveTo || archiveSearch || archiveClinic !== 'all') && (
                <button
                  type="button"
                  onClick={() => { setArchiveFrom(''); setArchiveTo(''); setArchiveSearch(''); setArchiveClinic('all'); }}
                  className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-colors cursor-pointer whitespace-nowrap"
                >
                  Clear Filters
                </button>
              )}
            </div>
            <p className="mt-2 text-[11px] text-ink-muted">
              {filteredArchivedCases.length} archived case{filteredArchivedCases.length === 1 ? '' : 's'} — filter by delivery date range, clinic, or search by ID / patient / doctor.
            </p>
          </div>

          <div className="bg-white border border-slate-200/80 rounded-2xl shadow-2xs overflow-hidden">
            {filteredArchivedCases.length === 0 ? (
              <div className="p-10 text-center">
                <Archive className="w-8 h-8 text-slate-300 mx-auto mb-3" />
                <h3 className="font-bold text-slate-800 text-sm">No archived cases match</h3>
                <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                  Completed cases you archive from the workstation appear here. Nothing is deleted — restore any case back to the active board at any time.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto no-scrollbar">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50/80 border-b border-slate-200/80 font-bold uppercase text-[10px] text-slate-500 tracking-wider">
                      <th className="py-2 px-3">Case ID</th>
                      <th className="py-2 px-3">Patient</th>
                      <th className="py-2 px-3">Clinic</th>
                      <th className="py-2 px-3">Material</th>
                      <th className="py-2 px-3">Delivery</th>
                      <th className="py-2 px-3">Status</th>
                      <th className="py-2 px-3">Archived</th>
                      <th className="py-2 px-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium">
                    {filteredArchivedCases.map((c) => (
                      <tr key={c.id} className="hover:bg-slate-50/60 transition-colors">
                        <td className="py-2 px-3 font-bold text-slate-900">{c.case_number}</td>
                        <td className="py-2 px-3 text-slate-700">{c.patient_name || '—'}</td>
                        <td className="py-2 px-3 text-slate-700">{c.lab_name}</td>
                        <td className="py-2 px-3 text-slate-700">{c.case_type_name}</td>
                        <td className="py-2 px-3 text-slate-600">{c.delivery_date}</td>
                        <td className="py-2 px-3">
                          <CaseStatusBadge status={c.status} />
                        </td>
                        <td className="py-2 px-3 text-slate-500 text-[11px]">
                          {c.archived_at ? c.archived_at.slice(0, 10) : '—'}
                        </td>
                        <td className="py-2 px-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => restoreCase(c.id)}
                              className="p-1.5 hover:bg-indigo-50 text-indigo-600 rounded-lg transition-colors cursor-pointer"
                              title="Restore to the active workstation"
                            >
                              <ArchiveRestore className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmPermanentId(c.id)}
                              className="p-1.5 hover:bg-rose-50 text-ink-danger rounded-lg transition-colors cursor-pointer"
                              title="Permanently delete this case and its history"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : viewMode === 'kanban' ? (
        /* DRAG AND DROP KANBAN BOARD.
           The board paginates exactly like the table: cards come from
           `visibleFilteredCases` (the current page), not `filteredCases`.
           It used to render every filtered case in every column, so a large
           library built thousands of card DOM nodes in one pass and the
           desktop window stopped responding. Column counts stay whole-board
           totals — they describe the workflow, not the page. */
        <>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-4 items-start overflow-x-auto no-scrollbar flex-1 min-h-0">
          {KANBAN_STAGES.map((stage) => {
            const stageTotal = filteredCases.filter((c) => c.status === stage.id).length;
            const stageCases = visibleFilteredCases.filter((c) => c.status === stage.id);
            const isDragTarget = dragOverColumn === stage.id;

            return (
              <div
                key={stage.id}
                onDragOver={(e) => handleDragOver(e, stage.id)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, stage.id)}
                className={`flex flex-col rounded-3xl p-3 h-full min-h-0 transition-all border ${
                  isDragTarget
                    ? 'border-indigo-400 bg-indigo-50/40 ring-2 ring-indigo-400/30'
                    : 'border-slate-200/80 bg-slate-100/60'
                }`}
              >
                {/* Column Header */}
                <div className={`p-3 rounded-2xl border ${stage.headerBg} mb-3 flex items-center justify-between shadow-xs`}>
                  <div className="flex items-center gap-2">
                    <span className={`w-2.5 h-2.5 rounded-full ${stage.color}`} />
                    <h3 className="font-bold text-xs text-slate-800 tracking-tight">{stage.title}</h3>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${stage.badgeBg}`}>
                    {stageTotal}
                  </span>
                </div>

                {/* Cards Container */}
                <div className="flex-1 min-h-0 space-y-3 overflow-y-auto pr-0.5">
                  {stageCases.length === 0 ? (
                    stageTotal > 0 ? (
                      /* Not an empty column — this page simply has none of its
                         cases here. Saying "Drop cases here" would be a lie. */
                      <div className="h-28 rounded-2xl border border-dashed border-slate-200 flex flex-col items-center justify-center p-3 text-center text-ink-muted text-xs">
                        <span className="text-[11px] font-medium">
                          None on this page
                        </span>
                        <span className="text-[10px]">{stageTotal} in this stage</span>
                      </div>
                    ) : (
                      <div className="h-28 rounded-2xl border-2 border-dashed border-slate-200 flex flex-col items-center justify-center p-3 text-center text-ink-muted text-xs">
                        <Move className="w-4 h-4 opacity-40 mb-1" />
                        <span className="text-[11px] font-medium">Drop cases here</span>
                      </div>
                    )
                  ) : (
                    stageCases.map((c) => {
                      const { isWarning, isOverdue, isDueSoon, hoursLeft } = checkCaseWarning(c);
                      const isBeingDragged = draggedCaseId === c.id;
                      const isSelected = selectedCaseIds.includes(c.id);

                      const colorTheme = brandingSettings?.warningHighlightColor || 'rose';
                      const styleMode = brandingSettings?.warningHighlightStyle || 'border';

                      /*
                       * The operator's branding colours are LIGHT-theme values
                       * chosen against a white board. Painting them as an
                       * inline `backgroundColor` made them unreachable by the
                       * `.dark` token remap, so the card stayed #ffffff while
                       * `text-slate-900` resolved to #e9eff7 — light-on-white at
                       * a measured 1.16:1, i.e. an unreadable card.
                       *
                       * The inline style now sets a custom property rather than
                       * `backgroundColor` directly, because an inline custom
                       * property that the element ALSO consumes would beat the
                       * `.dark` value by specificity. Writing the light value
                       * into `--kanban-card-bg` and letting a
                       * `.dark .kanban-case-card` rule repaint
                       * `background-color` keeps one owner of the background
                       * per theme.
                       */
                      const warningTint = (
                        colorTheme === 'rose' ? '#fff1f2'
                        : colorTheme === 'amber' ? '#fffbeb'
                        : colorTheme === 'purple' ? '#f5f3ff'
                        : colorTheme === 'indigo' ? '#eef2ff'
                        : colorTheme === 'emerald' ? '#ecfdf5'
                        : '#fef2f2' // red
                      );
                      const fullWarn = isWarning && styleMode === 'full';

                      // Dynamic warning border & shadow
                      let warningClasses = '';
                      if (isWarning && !isSelected) {
                        if (colorTheme === 'rose') {
                          warningClasses = 'border-rose-500 ring-2 ring-rose-500/40 shadow-rose-100 shadow-md';
                        } else if (colorTheme === 'red') {
                          warningClasses = 'border-red-600 ring-2 ring-red-600/40 shadow-red-100 shadow-md';
                        } else if (colorTheme === 'amber') {
                          warningClasses = 'border-amber-500 ring-2 ring-amber-500/40 shadow-amber-100 shadow-md';
                        } else if (colorTheme === 'purple') {
                          warningClasses = 'border-purple-500 ring-2 ring-purple-500/40 shadow-purple-100 shadow-md';
                        } else if (colorTheme === 'indigo') {
                          warningClasses = 'border-indigo-500 ring-2 ring-indigo-500/40 shadow-indigo-100 shadow-md';
                        } else {
                          warningClasses = 'border-emerald-500 ring-2 ring-emerald-500/40 shadow-emerald-100 shadow-md';
                        }
                      }

                      return (
                        <div
                          key={c.id}
                          draggable={true}
                          onDragStart={(e) => handleDragStart(e, c.id)}
                          onClick={() => setViewedCaseId(c.id)}
                          style={{
                            '--kanban-card-bg': fullWarn
                              ? warningTint
                              : (brandingSettings?.cardBgColor || '#ffffff'),
                          } as React.CSSProperties}
                          data-warn={fullWarn ? 'full' : undefined}
                          data-selected={isSelected ? 'true' : undefined}
                          className={`kanban-case-card rounded-2xl p-4 border shadow-xs hover:shadow-md cursor-grab active:cursor-grabbing transition-all relative group ${
                            isSelected
                              ? 'border-indigo-500 ring-2 ring-indigo-500/30'
                              : isWarning
                              ? warningClasses
                              : 'border-slate-200'
                          } ${isBeingDragged ? 'opacity-40 scale-95 border-indigo-400' : ''}`}
                        >
                          {/* Optional Solid Top Banner */}
                          {isWarning && styleMode === 'solid' && (
                            <div className="bg-rose-600 text-white text-[10px] font-bold px-3 py-1 rounded-t-xl -mx-4 -mt-4 mb-2.5 flex items-center justify-between shadow-xs">
                              <span className="flex items-center gap-1 uppercase">
                                <AlertTriangle className="w-3 h-3 animate-bounce" />
                                DUE WITHIN {brandingSettings?.warningThresholdHours || 24}H
                              </span>
                              <span className="text-[9px] bg-white/20 px-1.5 py-0.2 rounded font-mono">
                                {isOverdue ? 'EXPIRED' : `${hoursLeft}H LEFT`}
                              </span>
                            </div>
                          )}

                          {/* Top Row: Checkbox, Case # & Priority */}
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-1.5">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  toggleSelectCase(c.id);
                                }}
                                onClick={(e) => e.stopPropagation()}
                                className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                                title="Select case for bulk printing"
                              />
                              <GripVertical className="w-3.5 h-3.5 text-slate-300 group-hover:text-ink-muted" />
                              <span className="font-extrabold text-xs text-slate-900 tracking-tight">{c.case_number}</span>
                              
                              {isWarning && (
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-rose-600 text-white uppercase tracking-wider animate-pulse flex items-center gap-1">
                                  <Clock className="w-2.5 h-2.5" />
                                  {isOverdue ? 'OVERDUE' : `<${brandingSettings?.warningThresholdHours || 24}H`}
                                </span>
                              )}
                            </div>
                            <div>
                              <PriorityBadge priority={c.priority} />
                            </div>
                          </div>

                          {/* Lab & Case Type */}
                          <div className="space-y-1 mb-3">
                            <div className="text-xs font-bold text-slate-800 truncate" title={c.lab_name}>
                              {c.lab_name}
                            </div>
                            <div className="text-[11px] text-indigo-600 font-semibold truncate">
                              {c.case_type_name} {c.shade && <span className="text-ink-muted font-normal">({c.shade})</span>}
                            </div>
                            <div className="text-[11px] text-slate-500 font-medium">
                              {formatDoctorName(c.doctor_name)}
                            </div>
                          </div>

                          {/* FDI Teeth Chips */}
                          <div className="flex flex-wrap gap-1 mb-3">
                            {c.selected_teeth.map((t) => (
                              <span key={t} className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px] font-mono font-bold">
                                #{t}
                              </span>
                            ))}
                          </div>

                          {/* Stage Visual Progress Indicator */}
                          <div className="mb-3 pt-2 border-t border-slate-100/80">
                            <CaseProgressIndicator
                              status={c.status}
                              onStatusChange={(newStatus) => updateCase(c.id, { status: newStatus }, `Stage updated to ${newStatus}`)}
                              variant="compact"
                              showLabels={true}
                            />
                          </div>

                          {/* Bottom Info & Quick Action */}
                          <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-1 text-[11px]">
                            <div className="flex items-center gap-1 text-slate-500">
                              <Calendar className="w-3 h-3 text-ink-muted" />
                              <span className={isOverdue ? 'text-amber-700 font-bold' : ''}>{c.delivery_date}</span>
                            </div>

                            <div className="flex items-center gap-2">
                              {/* Quick status dropdown fallback */}
                              <select
                                value={c.status}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  updateCase(c.id, { status: e.target.value as CaseStatus });
                                }}
                                title="Change stage"
                                className="text-[10px] bg-slate-50 border border-slate-200 rounded px-1.5 py-0.5 font-medium text-slate-700 focus:outline-none"
                              >
                                <option value="received">Recv</option>
                                <option value="in_progress">Prog</option>
                                <option value="qc">QC</option>
                                <option value="ready">Rdy</option>
                                <option value="delivered">Deliv</option>
                                <option value="revision">Rev</option>
                              </select>

                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setPrintSlipCase(c);
                                }}
                                className="p-1 hover:bg-indigo-50 text-indigo-600 rounded transition-colors"
                                title="Print Lab Job Slip / Tray Ticket"
                              >
                                <Printer className="w-3.5 h-3.5" />
                              </button>

                              {c.status === 'delivered' && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    archiveCase(c.id);
                                  }}
                                  className="p-1 hover:bg-slate-200 text-slate-600 rounded transition-colors"
                                  title="Case completed — move it to the Archive"
                                >
                                  <Archive className="w-3.5 h-3.5" />
                                </button>
                              )}

                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {/* The board's page bar, outside the `flex-1 min-h-0` grid so the
            columns keep their height instead of being squeezed by it. */}
        {casesPagination}
        </>
      ) : (
        /* TABLE VIEW */
        <div className="glass-panel border border-slate-200/80 rounded-2xl shadow-2xs overflow-hidden">
          {filteredCases.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={Filter}
                title="No cases match your active filters"
                description="Try clearing your search query, adjusting stage filters, or resetting date thresholds."
                actionLabel="Clear All Filters"
                onAction={() => {
                  setSearchTerm('');
                  setStatusFilter('all');
                  setLabFilter('all');
                  setPriorityFilter('all');
                  setDueSoonOnly(false);
                }}
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/80 border-b border-slate-200/80 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    <th className="py-2 px-3 w-10 text-center">
                      <input
                        type="checkbox"
                        checked={filteredCases.length > 0 && selectedCaseIds.length === filteredCases.length}
                        onChange={toggleSelectAll}
                        className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                        title="Select or deselect all filtered cases"
                      />
                    </th>
                    <th className="py-2 px-4 font-bold text-slate-700">Case #</th>
                    <th className="py-2 px-4 font-bold text-slate-700">Patient</th>
                    <th className="py-2 px-4 font-bold text-slate-700">Dental Clinic</th>
                    <th className="py-2 px-4 font-bold text-slate-700">Material / Type</th>
                    <th className="py-2 px-4 font-bold text-slate-700">Doctor</th>
                    <th className="py-2 px-4 font-bold text-slate-700">FDI Teeth</th>
                    <th className="py-2 px-4 font-bold text-slate-700">Delivery Date</th>
                    <th className="py-2 px-4 font-bold text-slate-700">Priority</th>
                    <th className="py-2 px-4 font-bold text-slate-700">Price (PKR)</th>
                    <th className="py-2 px-4 text-center font-bold text-slate-700">Status</th>
                    <th className="py-2 px-4 text-right font-bold text-slate-700">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {visibleFilteredCases.map((c) => {
                    const { isWarning, isOverdue } = checkCaseWarning(c);
                    const isSelected = selectedCaseIds.includes(c.id);
                    return (
                      <tr
                        key={c.id}
                        onClick={() => setViewedCaseId(c.id)}
                        className={`hover:bg-indigo-50/40 cursor-pointer transition-colors ${
                          isSelected 
                            ? 'bg-indigo-50/60' 
                            : isWarning 
                            ? 'bg-rose-50/70 border-l-4 border-l-rose-500 font-semibold' 
                            : ''
                        }`}
                      >
                        <td className="py-2 px-3 text-center" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelectCase(c.id)}
                            className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                          />
                        </td>

                        <td className="py-2 px-4 font-bold text-slate-900">
                          <div className="flex items-center gap-1.5">
                            <span className="tracking-tight">{c.case_number}</span>
                            {isWarning && (
                              <span className="px-1.5 py-0.5 bg-rose-600 text-white text-[9px] font-bold rounded-full uppercase tracking-wider animate-pulse">
                                {isOverdue ? 'OVERDUE' : `<${brandingSettings?.warningThresholdHours || 24}H`}
                              </span>
                            )}
                          </div>
                        </td>

                        <td className="py-2 px-4 font-medium text-slate-700">{c.patient_name || '—'}</td>

                        <td className="py-2 px-4 font-medium text-slate-800">{c.lab_name}</td>

                        <td className="py-2 px-4 text-slate-700">
                          <span className="font-semibold text-indigo-600">{c.case_type_name}</span>
                          {c.shade && <span className="ml-1 text-[11px] text-ink-muted font-normal">({c.shade})</span>}
                        </td>

                        <td className="py-2 px-4 text-slate-700 font-medium">{formatDoctorName(c.doctor_name)}</td>

                        <td className="py-2 px-4 text-slate-600">
                          <span className="font-mono font-bold text-slate-800">#{c.selected_teeth.join(', ')}</span>
                        </td>

                        <td className="py-2 px-4">
                          <div className={`font-semibold ${isOverdue ? 'text-amber-700 font-bold' : 'text-slate-700'}`}>
                            {c.delivery_date}
                          </div>
                        </td>

                        <td className="py-2 px-4">
                          <PriorityBadge priority={c.priority} />
                        </td>

                        <td className="py-2 px-4 font-bold text-slate-900">
                          PKR {(c.final_price || 0).toLocaleString()}
                        </td>

                        <td className="py-2 px-4 min-w-[160px]">
                          <div className="flex flex-col gap-1.5" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-between">
                              <CaseStatusBadge status={c.status} />
                            </div>
                            <CaseProgressIndicator
                              status={c.status}
                              onStatusChange={(newStatus) => updateCase(c.id, { status: newStatus }, `Stage updated to ${newStatus}`)}
                              variant="compact"
                              showLabels={false}
                            />
                          </div>
                        </td>

                        <td className="py-2 px-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setPrintSlipCase(c);
                              }}
                              className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-600 text-indigo-700 hover:text-white text-xs font-semibold rounded-lg transition-colors inline-flex items-center gap-1 cursor-pointer"
                              title="Print Case Job Slip / Tray Ticket"
                            >
                              <Printer className="w-3.5 h-3.5" /> Slip
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedCase(c);
                              }}
                              className="px-2.5 py-1 bg-slate-100 hover:bg-slate-900 hover:text-white text-slate-700 text-xs font-semibold rounded-lg transition-colors inline-flex items-center gap-1 cursor-pointer"
                              title="Open this case in the case form"
                            >
                              <Pencil className="w-3.5 h-3.5" /> Open
                            </button>
                            {c.status === 'delivered' && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  archiveCase(c.id);
                                }}
                                className="px-2.5 py-1 bg-slate-100 hover:bg-slate-700 hover:text-white text-slate-700 text-xs font-semibold rounded-lg transition-colors inline-flex items-center gap-1 cursor-pointer"
                                title="Case completed — move it to the Archive (kept, searchable, restorable)"
                              >
                                <Archive className="w-3.5 h-3.5" /> Archive
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {casesPagination}
            </div>
          )}
        </div>
      )}

      {/* Permanent-delete confirmation (archive only) */}
      {confirmPermanentId && (() => {
        const victim = cases.find((c) => c.id === confirmPermanentId);
        if (!victim) return null;
        return (
          <div className="fixed inset-0 z-[60] bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl max-w-md w-full p-5 border border-slate-200 shadow-2xl space-y-4">
              <div className="flex items-center gap-3 text-ink-danger">
                <Trash2 className="w-6 h-6 shrink-0" />
                <h3 className="font-bold text-base text-slate-900">Permanently delete {victim.case_number}?</h3>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                This removes the case, its tooth charting, notes, attachments and history from the
                database forever. The linked invoice and any payment records are kept so the money
                trail stays complete. This cannot be undone.
              </p>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setConfirmPermanentId(null)}
                  className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    deleteCasePermanently(victim.id);
                    setConfirmPermanentId(null);
                  }}
                  className="px-4 py-1.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold rounded-lg shadow-sm cursor-pointer"
                >
                  Delete Forever
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Case Detail / Create Modal */}
      {(selectedCase || isNewModalOpen) && (
        <CaseDetailModal
          initialCase={selectedCase}
          appliedTemplate={appliedTemplate}
          onClose={() => {
            setSelectedCase(null);
            setIsNewModalOpen(false);
            setAppliedTemplate(null);
          }}
        />
      )}

      {/* Full-page case viewer */}
      {viewedCaseId && (() => {
        const viewed = cases.find((c) => c.id === viewedCaseId);
        if (!viewed) return null;
        return (
          <CaseDetailView
            caseData={viewed}
            onClose={() => setViewedCaseId(null)}
            onEdit={(c) => {
              setViewedCaseId(null);
              setSelectedCase(c);
            }}
            onStatusChange={(id, updates, note) => updateCase(id, updates, note)}
          />
        );
      })()}

      {/* Template Preset Gallery Modal */}
      {templateLibraryOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-3xl w-full p-6 border border-slate-200 shadow-2xl relative">
            <button
              onClick={() => setTemplateLibraryOpen(false)}
              className="absolute top-4 right-4 text-ink-muted hover:text-slate-700 p-1"
            >
              <X className="w-5 h-5" />
            </button>
            <CaseTemplateModal
              onApplyTemplate={(tmpl) => {
                setAppliedTemplate(tmpl);
                setTemplateLibraryOpen(false);
                setIsNewModalOpen(true);
              }}
              onClose={() => setTemplateLibraryOpen(false)}
            />
          </div>
        </div>
      )}

      {/* Case Job Slip Printable Modal */}
      {printSlipCase && (
        <CaseJobSlipModal
          caseData={printSlipCase}
          onClose={() => setPrintSlipCase(null)}
        />
      )}

      {/* Batch / Bulk Print Modal */}
      {bulkPrintModalOpen && (
        <BulkPrintModal
          selectedCases={cases.filter((c) => selectedCaseIds.includes(c.id))}
          initialPrintType={bulkPrintType}
          onClose={() => setBulkPrintModalOpen(false)}
        />
      )}
    </div>
  );
};
