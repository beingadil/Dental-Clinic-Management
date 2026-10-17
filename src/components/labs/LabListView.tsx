import React, { useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { DentalCase, DentalLab } from '../../types';
import { LabDetailModal } from './LabDetailModal';
import { formatDoctorName } from '../../utils/doctorName';
import { usePagination } from '../common/ui/Pagination';
import { Modal } from '../common/ui/Modal';
import { DataTable } from '../common/ui';
import { formatPKR } from '../../services/financeDomain';
import { 
  Building2, 
  PlusCircle, 
  Search, 
  Phone, 
  Mail, 
  MapPin, 
  FolderOpen, 
  ArrowUpDown,
  ChevronRight,
  LayoutGrid,
  Table as TableIcon,
  DollarSign,
  AlertCircle
} from 'lucide-react';

export const LabListView: React.FC = () => {
  const { labs, cases, invoices, allPayments, addLab, getLabFinancialSummary } = useApp();

  const [selectedLab, setSelectedLab] = useState<DentalLab | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'cases'>('cases');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  /* Grid (cards) or table (dense directory) — same toggle contract as the
     workstation view: persisted per operator, defaulting to the card grid this
     module has always shown. */
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(() => {
    try {
      const saved = localStorage.getItem('dentlab_clinics_view_mode');
      if (saved === 'grid' || saved === 'list') return saved;
    } catch {
      // ignore (private mode / storage disabled)
    }
    return 'grid';
  });

  const handleViewModeChange = (mode: 'grid' | 'list') => {
    setViewMode(mode);
    try {
      localStorage.setItem('dentlab_clinics_view_mode', mode);
    } catch {
      // ignore
    }
  };

  // Create Form State
  const [name, setName] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [openingBalance, setOpeningBalance] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  /* Only the clinic name and the doctor name are mandatory. Phone, email and
     address are optional: they are format-checked only when actually filled. */
  const validate = () => {
    const errs: Record<string, string> = {};
    if (!name.trim() || name.trim().length < 2 || name.trim().length > 200) {
      errs.name = 'Clinic name must be between 2 and 200 characters';
    }
    if (!contactPerson.trim() || contactPerson.trim().length < 2 || contactPerson.trim().length > 100) {
      errs.contactPerson = 'Doctor name must be between 2 and 100 characters';
    }
    if (phone.trim() && !/^[0-9+\s\-()]{7,25}$/.test(phone.trim())) {
      errs.phone = 'Phone must be 7-25 digits/symbols — or leave it blank';
    }
    if (email.trim() && !/\S+@\S+\.\S+/.test(email.trim())) {
      errs.email = 'Enter a valid email address — or leave it blank';
    }
    if (address.trim() && (address.trim().length < 5 || address.trim().length > 500)) {
      errs.address = 'Address must be 5-500 characters — or leave it blank';
    }
    const ob = openingBalance.trim();
    if (ob !== '') {
      const n = Number(ob);
      if (!Number.isFinite(n) || n < 0 || n > 999999999) {
        errs.openingBalance = 'Opening balance must be a non-negative amount';
      }
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    const newLab = addLab({
      name: name.trim(),
      contact_person: contactPerson.trim(),
      phone: phone.trim(),
      email: email.trim(),
      address: address.trim(),
      notes: notes.trim(),
      opening_balance: openingBalance.trim() === '' ? 0 : Number(openingBalance.trim())
    });

    setName('');
    setContactPerson('');
    setPhone('');
    setEmail('');
    setAddress('');
    setNotes('');
    setOpeningBalance('');
    setShowCreateModal(false);
    setSelectedLab(newLab);
  };

  /* Cases indexed once by clinic id — the sort and the per-card "latest case"
     lookup used to scan the whole cases array per clinic, which visibly
     stalled the directory past a few hundred clinics. */
  const casesByLab = useMemo(() => {
    const byLab = new Map<string, DentalCase[]>();
    for (const c of cases) {
      const bucket = byLab.get(c.lab_id);
      if (bucket) bucket.push(c); else byLab.set(c.lab_id, [c]);
    }
    for (const bucket of byLab.values()) {
      bucket.sort((a, b) =>
        new Date(b.created_at || b.delivery_date).getTime() -
        new Date(a.created_at || a.delivery_date).getTime());
    }
    return byLab;
  }, [cases]);

  /* Outstanding balance per clinic, computed from the lab financial summary. */
  const outstandingByLab = useMemo(() => {
    const map = new Map<string, number>();
    for (const lab of labs) {
      const summary = getLabFinancialSummary(lab.id);
      map.set(lab.id, summary.outstanding_balance || 0);
    }
    return map;
  }, [labs, getLabFinancialSummary]);

  /* Last thing that HAPPENED with a clinic, as YYYY-MM-DD.
      /* Last thing that HAPPENED with a clinic, as YYYY-MM-DD.

     Two traps this avoids, both of which made the column useless:
       - `delivery_date` is a future promise, not activity. Counting it meant
         every clinic with an open case reported its next delivery date, so the
         "last activity" column could never show a dormant account.
       - stamps arrive in two shapes ('2026-03-04 10:00' and '2026-03-04'),
         which do not compare correctly as strings. Everything is trimmed to a
         date first, then compared. */
  const lastActivityByLab = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const lab of labs) {
      let latest: string | null = null;
      const consider = (stamp?: string | null) => {
        if (!stamp) return;
        const day = stamp.slice(0, 10);
        if (!latest || day > latest) latest = day;
      };
      for (const c of cases.filter((c) => c.lab_id === lab.id)) {
        consider(c.created_at);
        consider(c.updated_at);
      }
      for (const inv of invoices.filter((inv) => inv.lab_id === lab.id)) {
        consider(inv.created_at);
        consider(inv.issue_date);
      }
      for (const pay of allPayments.filter((p) => p.lab_id === lab.id)) {
        consider(pay.payment_date);
      }
      map.set(lab.id, latest);
    }
    return map;
  }, [labs, cases, invoices, allPayments]);

  /* What the clinic owes, in words the operator acts on. Deliberately NOT
     bucketed into amount bands: a fixed rupee threshold would paint a normal
     balance "clear" on one clinic and "overdue" on another for no operational
     reason. Either they owe nothing, or they owe something. */
  const balanceTone = (amount: number) =>
    amount === 0 ? 'text-ink-success' : 'text-ink-danger';

  const filteredLabs = useMemo(() => {
    return labs.filter((l) => {
      if (!searchTerm.trim()) return true;
      const term = searchTerm.toLowerCase();
      return (
        (l.name || '').toLowerCase().includes(term) ||
        (l.contact_person || '').toLowerCase().includes(term) ||
        (l.email || '').toLowerCase().includes(term) ||
        (l.address || '').toLowerCase().includes(term)
      );
    }).sort((a, b) => {
      let comparison = 0;
      if (sortBy === 'name') {
        comparison = a.name.localeCompare(b.name);
      } else if (sortBy === 'cases') {
        comparison = (casesByLab.get(b.id)?.length || 0) - (casesByLab.get(a.id)?.length || 0);
      }
      return sortOrder === 'asc' ? comparison : -comparison;
    });
  }, [labs, searchTerm, sortBy, sortOrder, casesByLab]);

  /* Paged, not incrementally grown. Each card renders case previews, so 1000
     cards meant ~45k DOM nodes (audit §9); the old "Show more" window kept every
     already-mounted card alive while growing. Paging swaps them instead. */
  const {
    pageItems: visibleLabs,
    pagination: labsPagination,
  } = usePagination(filteredLabs, {
    initialPageSize: 24,
    resetKey: `${searchTerm}|${sortBy}|${sortOrder}`,
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Dental Clinics & Practices</h1>
          <p className="text-xs text-slate-500 mt-1">
            Directory of referring dental clinics & practices. Click any clinic to view assigned cases, financial ledger, and credit balance.
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs rounded-xl shadow-xs flex items-center gap-2 transition-all cursor-pointer self-start sm:self-auto"
        >
          <PlusCircle className="w-4 h-4" />
          <span>Register New Clinic</span>
        </button>
      </div>

      {/* Toolbar */}
      <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:max-w-md">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-muted" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search clinic name, contact person, email, address..."
            className="w-full pl-10 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 focus:bg-white transition-all font-medium text-slate-900"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          {/* View Toggle */}
          <div className="bg-slate-100 p-1 rounded-xl flex items-center gap-1 border border-slate-200">
            <button
              type="button"
              onClick={() => handleViewModeChange('grid')}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                viewMode === 'grid'
                  ? 'bg-white text-slate-900 shadow-xs border border-slate-200/80'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
              title="Card grid — one card per clinic with its latest case"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span>Cards</span>
            </button>
            <button
              type="button"
              onClick={() => handleViewModeChange('list')}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                viewMode === 'list'
                  ? 'bg-white text-slate-900 shadow-xs border border-slate-200/80'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
              title="Table view — every clinic on one row with contacts and case counts"
            >
              <TableIcon className="w-3.5 h-3.5" />
              <span>List</span>
            </button>
          </div>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="p-2 text-xs bg-slate-50 border border-slate-200 rounded-xl font-semibold text-slate-700 focus:outline-none"
          >
            <option value="cases">Sort by Total Cases</option>
            <option value="name">Sort by Name</option>
          </select>
          <button
            onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
            className="p-2 bg-slate-100 hover:bg-slate-200 rounded-xl text-slate-700 transition-colors cursor-pointer"
            title={`Sort ${sortOrder === 'asc' ? 'Descending' : 'Ascending'}`}
          >
            <ArrowUpDown className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Lab Card Grid */}
      {viewMode === 'grid' && (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {filteredLabs.length === 0 ? (
          <div className="col-span-full py-12 text-center text-ink-muted text-xs bg-white rounded-2xl border border-dashed border-slate-200">
            No dental clinics found matching search.
          </div>
        ) : (
          visibleLabs.map((lab) => {
            // All cases for this lab, most recent first (pre-indexed above)
            const labCases = casesByLab.get(lab.id) || [];

            const recentCase = labCases[0];

            return (
              <div
                key={lab.id}
                onClick={() => setSelectedLab(lab)}
                className="p-5 bg-white rounded-2xl border border-slate-200 shadow-xs hover:border-indigo-300 hover:shadow-md cursor-pointer transition-all flex flex-col justify-between gap-4 group"
              >
                <div>
                  {/* Top Row: Icon, Name & Case Activity */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center font-bold text-sm shrink-0 border border-slate-200 group-hover:bg-slate-900 group-hover:text-white transition-colors">
                        <Building2 className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="font-bold text-sm text-slate-900 group-hover:text-indigo-600 transition-colors">
                          {lab.name}
                        </h3>
                        <p className="text-xs text-slate-500 font-medium">Doctor: {lab.contact_person || '—'}</p>
                      </div>
                    </div>
                  </div>

                  {/* Contact Info List */}
                  <div className="mt-3.5 text-xs space-y-1.5 text-slate-600 border-t border-slate-100 pt-3">
                    <div className="flex items-center gap-2">
                      <Phone className="w-3.5 h-3.5 text-ink-muted shrink-0" />
                      <span>{lab.phone || '—'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Mail className="w-3.5 h-3.5 text-ink-muted shrink-0" />
                      <span className="truncate">{lab.email || '—'}</span>
                    </div>
                    <div className="flex items-start gap-2 pt-0.5">
                      <MapPin className="w-3.5 h-3.5 text-ink-muted shrink-0 mt-0.5" />
                      <span className="text-slate-500 line-clamp-1">{lab.address || 'No address on file'}</span>
                    </div>
                    {/* Outstanding Balance */}
                    <div className={`flex items-center gap-2 pt-0.5 ${balanceTone(outstandingByLab.get(lab.id) || 0)}`}>
                      <DollarSign className="w-3.5 h-3.5 shrink-0" />
                      <span className="font-semibold">
                        {outstandingByLab.get(lab.id) === 0 ? 'Nothing outstanding' : formatPKR(outstandingByLab.get(lab.id) || 0)}
                      </span>
                    </div>
                    {/* Last Activity */}
                    <div className="flex items-center gap-2 pt-0.5 text-slate-500">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      <span className="font-mono text-[10px]">
                        {lastActivityByLab.get(lab.id) || 'No activity'}
                      </span>
                    </div>
                  </div>

                  {/* Most Recent Case Highlight (if any) */}
                  {recentCase ? (
                    <div className="mt-3 p-2.5 bg-slate-50 border border-slate-200/80 rounded-xl space-y-1 text-xs">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-bold text-slate-500 uppercase tracking-wider">Latest Case:</span>
                        <span className="font-mono font-bold text-indigo-700">{recentCase.case_number}</span>
                      </div>
                      <div className="text-slate-700 font-medium truncate">
                        {recentCase.case_type_name} • {formatDoctorName(recentCase.doctor_name)}
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-ink-muted pt-0.5">
                        <span className="capitalize font-semibold text-slate-600">Status: {recentCase.status.replace('_', ' ')}</span>
                        <span>Delivery: {recentCase.delivery_date}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 p-2.5 bg-slate-50/50 border border-dashed border-slate-200 rounded-xl text-[11px] text-ink-muted italic text-center">
                      No active cases logged
                    </div>
                  )}
                </div>

                {/* Footer: Cases Count & Action */}
                <div className="flex items-center justify-between pt-3 border-t border-slate-100 text-xs">
                  <span className="text-slate-600 flex items-center gap-1.5 font-medium">
                    <FolderOpen className="w-4 h-4 text-indigo-600" />
                    <strong>{labCases.length}</strong> {labCases.length === 1 ? 'case' : 'cases'}
                  </span>

                  <span className="text-slate-900 font-semibold group-hover:text-indigo-600 flex items-center gap-0.5">
                    View Cases <ChevronRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>
      )}

      {/* Dense clinic directory: one row per clinic, all contact fields at a
          glance. Shares the search, sort and render cap with the card grid. */}
      {viewMode === 'list' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          {/* DataTable owns the <tr>, so the "click a row to open the clinic"
              behaviour rides a delegated click on the wrapper instead of an
              onClick on the row itself. */}
          <div
            onClick={(e) => {
              const tr = (e.target as HTMLElement).closest('tr');
              if (!tr || tr.parentElement?.tagName !== 'TBODY') return;
              const lab = visibleLabs[Array.from(tr.parentElement.children).indexOf(tr)];
              if (lab) setSelectedLab(lab);
            }}
          >
            <DataTable<DentalLab>
              data={visibleLabs}
              rowKey={(lab) => lab.id}
              rowClassName={() => 'cursor-pointer'}
              emptyState={
                <div className="py-12 text-center text-ink-muted text-xs">
                  No dental clinics found matching search.
                </div>
              }
              columns={[
                {
                  header: 'Dental Clinic',
                  className: 'py-2.5 px-4 font-bold text-slate-900 whitespace-nowrap',
                  render: (lab: DentalLab) => (
                    <span className="flex items-center gap-1.5">
                      <Building2 className="w-3.5 h-3.5 text-ink-muted shrink-0" />
                      <span>{lab.name}</span>
                    </span>
                  ),
                },
                {
                  header: 'Doctor',
                  className: 'py-2.5 px-4 text-slate-700 whitespace-nowrap',
                  render: (lab: DentalLab) => lab.contact_person || '—',
                },
                {
                  header: 'Phone',
                  className: 'py-2.5 px-4 text-slate-600 whitespace-nowrap font-mono text-[11px]',
                  render: (lab: DentalLab) => lab.phone || '—',
                },
                {
                  header: 'Email',
                  className: 'py-2.5 px-4 text-slate-600 truncate max-w-[220px]',
                  render: (lab: DentalLab) => (
                    <span title={lab.email || ''}>{lab.email || '—'}</span>
                  ),
                },
                {
                  header: 'Address',
                  className: 'py-2.5 px-4 text-slate-500 truncate max-w-[280px]',
                  render: (lab: DentalLab) => (
                    <span title={lab.address || ''}>{lab.address || '—'}</span>
                  ),
                },
                {
                  header: 'Cases',
                  align: 'center',
                  className: 'py-2.5 px-4 font-bold text-indigo-700',
                  render: (lab: DentalLab) => (casesByLab.get(lab.id) || []).length,
                },
                {
                  header: 'Latest Case',
                  className: 'py-2.5 px-4 whitespace-nowrap',
                  render: (lab: DentalLab) => {
                    const recentCase = (casesByLab.get(lab.id) || [])[0];
                    return recentCase ? (
                      <span className="font-mono font-bold text-indigo-700">{recentCase.case_number}</span>
                    ) : (
                      <span className="text-slate-300 italic font-normal">No cases</span>
                    );
                  },
                },
                {
                  header: 'Outstanding Balance',
                  align: 'center',
                  className: 'py-2.5 px-4 font-bold whitespace-nowrap',
                  render: (lab: DentalLab) => {
                    const bal = outstandingByLab.get(lab.id) || 0;
                    return (
                      <span className={`font-mono font-semibold ${balanceTone(bal)}`}>
                        {bal === 0 ? 'Clear' : formatPKR(bal)}
                      </span>
                    );
                  },
                },
                {
                  header: 'Last Activity',
                  className: 'py-2.5 px-4 text-slate-500 font-mono text-[11px] whitespace-nowrap',
                  render: (lab: DentalLab) => lastActivityByLab.get(lab.id) || '—',
                },
                {
                  header: 'Action',
                  align: 'right',
                  className: 'py-2.5 px-4 whitespace-nowrap',
                  render: () => (
                    <span className="text-slate-900 font-semibold inline-flex items-center gap-0.5">
                      View <ChevronRight className="w-3.5 h-3.5" />
                    </span>
                  ),
                },
              ]}
            />
          </div>
        </div>
      )}

      {labsPagination}

      {/* Selected Lab Detail Modal */}
      {selectedLab && (
        <LabDetailModal lab={selectedLab} onClose={() => setSelectedLab(null)} />
      )}

      {/* Create New Lab Modal */}
      <Modal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        label="Register New Dental Clinic"
        maxWidth="max-w-lg"
        headerClassName="px-6 py-3"
        header={
          <h3 className="font-bold text-base text-slate-900 flex items-center gap-2">
            <Building2 className="w-5 h-5 text-indigo-600" /> Register New Dental Clinic
          </h3>
        }
      >
          <div className="space-y-4 p-6 pt-4">

            <p className="text-[11px] text-slate-500 -mt-1">
              Clinic name and doctor name are required — everything else can be filled in later.
            </p>

            <form onSubmit={handleCreateSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Dental Clinic / Practice Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Malik Dental Care & Clinic"
                  className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-indigo-600"
                />
                {errors.name && <p className="text-[11px] text-rose-500 mt-0.5">{errors.name}</p>}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Doctor Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={contactPerson}
                  onChange={(e) => setContactPerson(e.target.value)}
                  placeholder="Dr. Faisal Mahmood"
                    className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-indigo-600"
                  />
                  {errors.contactPerson && <p className="text-[11px] text-rose-500 mt-0.5">{errors.contactPerson}</p>}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Phone Number <span className="text-ink-muted">(optional)</span>
                </label>
                  <input
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+92 300 5551234"
                    className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-indigo-600"
                  />
                  {errors.phone && <p className="text-[11px] text-rose-500 mt-0.5">{errors.phone}</p>}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Email Address <span className="text-ink-muted">(optional)</span>
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="contact@malikdental.pk"
                  className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-indigo-600"
                />
                {errors.email && <p className="text-[11px] text-rose-500 mt-0.5">{errors.email}</p>}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Facility Address <span className="text-ink-muted">(optional)</span>
                </label>
                <textarea
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  rows={2}
                  placeholder="Suite 402, Medical Enclave, Blue Area, Islamabad"
                  className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl resize-none focus:outline-none focus:bg-white focus:border-indigo-600"
                />
                {errors.address && <p className="text-[11px] text-rose-500 mt-0.5">{errors.address}</p>}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Opening Balance (PKR) <span className="text-ink-muted">(optional)</span>
                </label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={openingBalance}
                  onChange={(e) => setOpeningBalance(e.target.value)}
                  placeholder="0 — leave blank if the clinic starts at zero"
                  className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-indigo-600"
                />
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Money the clinic already owed before it was entered into the system. Posts as a debit on the ledger.
                </p>
                {errors.openingBalance && <p className="text-[11px] text-rose-500 mt-0.5">{errors.openingBalance}</p>}
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 bg-slate-100 text-slate-700 font-semibold text-xs rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs rounded-xl shadow-xs cursor-pointer"
                >
                  Register Clinic
                </button>
              </div>
            </form>
          </div>
      </Modal>
    </div>
  );
};
