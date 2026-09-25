import React, { useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { DentalCase, DentalLab } from '../../types';
import { LabDetailModal } from './LabDetailModal';
import { 
  Building2, 
  PlusCircle, 
  Search, 
  Phone, 
  Mail, 
  MapPin, 
  FolderOpen, 
  ArrowUpDown, 
  X, 
  ChevronRight
} from 'lucide-react';

export const LabListView: React.FC = () => {
  const { labs, cases, addLab } = useApp();

  const [selectedLab, setSelectedLab] = useState<DentalLab | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'cases'>('cases');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  // Create Form State
  const [name, setName] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
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
      notes: notes.trim()
    });

    setName('');
    setContactPerson('');
    setPhone('');
    setEmail('');
    setAddress('');
    setNotes('');
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
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search clinic name, contact person, email, address..."
            className="w-full pl-10 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 focus:bg-white transition-all font-medium text-slate-900"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
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
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {filteredLabs.length === 0 ? (
          <div className="col-span-full py-12 text-center text-slate-400 text-xs bg-white rounded-2xl border border-dashed border-slate-200">
            No dental clinics found matching search.
          </div>
        ) : (
          filteredLabs.map((lab) => {
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
                      <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span>{lab.phone || '—'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="truncate">{lab.email || '—'}</span>
                    </div>
                    <div className="flex items-start gap-2 pt-0.5">
                      <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                      <span className="text-slate-500 line-clamp-1">{lab.address || 'No address on file'}</span>
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
                        {recentCase.case_type_name} • Dr. {recentCase.doctor_name}
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-slate-400 pt-0.5">
                        <span className="capitalize font-semibold text-slate-600">Status: {recentCase.status.replace('_', ' ')}</span>
                        <span>Delivery: {recentCase.delivery_date}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 p-2.5 bg-slate-50/50 border border-dashed border-slate-200 rounded-xl text-[11px] text-slate-400 italic text-center">
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

      {/* Selected Lab Detail Modal */}
      {selectedLab && (
        <LabDetailModal lab={selectedLab} onClose={() => setSelectedLab(null)} />
      )}

      {/* Create New Lab Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 border border-slate-200 shadow-2xl relative space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-base text-slate-900 flex items-center gap-2">
                <Building2 className="w-5 h-5 text-indigo-600" /> Register New Dental Clinic
              </h3>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-slate-700 p-1 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

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
                  Phone Number <span className="text-slate-400">(optional)</span>
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
                  Email Address <span className="text-slate-400">(optional)</span>
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
                  Facility Address <span className="text-slate-400">(optional)</span>
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
        </div>
      )}
    </div>
  );
};
