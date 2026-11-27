import React, { useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import {
  Person,
  PersonRateScope,
  loadPersons,
  savePersons,
  loadAssignments,
  saveAssignments,
  newPersonId,
} from '../../services/persons';
import { PlusCircle, Trash2, Pencil, Check, X } from 'lucide-react';

interface Props {
  // reserved for future use
}

export const PartnersTab: React.FC<Props> = () => {
  const { labs } = useApp();
  const [persons, setPersons] = useState<Person[]>(() => loadPersons());
  const [assignments, setAssignments] = useState<Record<string, { personId: string | null; rateOverride?: number | null }>>(
    () => loadAssignments()
  );
  const [editing, setEditing] = useState<Person | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Person>({
    id: '',
    name: '',
    contact: '',
    commissionRate: 0,
    rateScope: 'person',
    createdAt: '',
    updatedAt: '',
  });
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);

  const persistPersons = (next: Person[]) => {
    setPersons(next);
    savePersons(next);
  };
  const persistAssignments = (next: typeof assignments) => {
    setAssignments(next);
    saveAssignments(next);
  };

  // (billed totals are computed in the Commission tab, not here)

  const startCreate = () => {
    setDraft({
      id: newPersonId(),
      name: '',
      contact: '',
      commissionRate: 0,
      rateScope: 'person',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    setCreating(true);
    setEditing(null);
  };

  const startEdit = (p: Person) => {
    setDraft({ ...p, updatedAt: new Date().toISOString() });
    setEditing(p);
    setCreating(false);
  };

  const cancelEdit = () => {
    setCreating(false);
    setEditing(null);
  };

  const saveDraft = () => {
    if (!draft.name.trim()) return;
    const next = [...persons];
    const idx = next.findIndex((p) => p.id === draft.id);
    if (idx >= 0) next[idx] = { ...draft, name: draft.name.trim() };
    else next.push({ ...draft, name: draft.name.trim() });
    persistPersons(next);
    cancelEdit();
  };

  const deletePerson = (id: string) => {
    persistPersons(persons.filter((p) => p.id !== id));
    // Unassign clinics that pointed at this person.
    const next = { ...assignments };
    for (const k of Object.keys(next)) {
      if (next[k]?.personId === id) next[k] = { personId: null };
    }
    persistAssignments(next);
    if (selectedPersonId === id) setSelectedPersonId(null);
  };

  const toggleClinic = (labId: string, personId: string) => {
    const next = { ...assignments };
    const cur = next[labId];
    if (cur?.personId === personId) {
      next[labId] = { personId: null };
    } else {
      next[labId] = { personId, rateOverride: cur?.rateOverride ?? null };
    }
    persistAssignments(next);
  };

  const setRateOverride = (labId: string, value: string) => {
    const next = { ...assignments };
    const cur = next[labId] || { personId: null };
    next[labId] = { ...cur, rateOverride: value === '' ? null : Number(value) };
    persistAssignments(next);
  };

  // Summary per person.
  const personSummary = useMemo(() => {
    return persons.map((p) => {
      const assigned = labs.filter((l) => (assignments[l.id]?.personId ?? null) === p.id);
      return { person: p, assigned };
    });
  }, [persons, labs, assignments]);

  const unassigned = labs.filter((l) => !(assignments[l.id]?.personId));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-slate-900">Partners / Persons</h3>
          <p className="text-xs text-slate-500">
            Group clinics under a person and set their commission rate. A clinic belongs to at most one person.
          </p>
        </div>
        <button
          type="button"
          onClick={startCreate}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-700 cursor-pointer"
        >
          <PlusCircle className="w-3.5 h-3.5" /> New person
        </button>
      </div>

      {(creating || editing) && (
        <div className="border border-slate-200 rounded-xl p-4 space-y-3 bg-slate-50/60">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="text-xs font-semibold text-slate-700">
              Name
              <input
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            <label className="text-xs font-semibold text-slate-700">
              Contact
              <input
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
                value={draft.contact || ''}
                onChange={(e) => setDraft({ ...draft, contact: e.target.value })}
              />
            </label>
            {draft.rateScope === 'person' && (
              <label className="text-xs font-semibold text-slate-700">
                Commission rate (%)
                <input
                  type="number"
                  min={0}
                  max={100}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
                  value={draft.commissionRate}
                  onChange={(e) => setDraft({ ...draft, commissionRate: Number(e.target.value) })}
                />
              </label>
            )}
            {draft.rateScope === 'clinic' && (
              <div className="text-xs text-slate-500 flex items-end pb-1.5">
                Set the per-clinic rate after assigning clinics below.
              </div>
            )}
            <label className="text-xs font-semibold text-slate-700">
              Rate scope
              <select
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
                value={draft.rateScope}
                onChange={(e) => setDraft({ ...draft, rateScope: e.target.value as PersonRateScope })}
              >
                <option value="person">Per person (one rate for all clinics)</option>
                <option value="clinic">Per clinic (override per clinic)</option>
              </select>
            </label>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={saveDraft}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-700 cursor-pointer"
            >
              <Check className="w-3.5 h-3.5" /> Save
            </button>
            <button
              type="button"
              onClick={cancelEdit}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-200 text-slate-700 hover:bg-slate-300 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" /> Cancel
            </button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {personSummary.length === 0 && (
          <p className="text-sm text-slate-500">No persons yet. Create one to start grouping clinics.</p>
        )}
        {personSummary.map(({ person, assigned }) => (
          <div key={person.id} className="border border-slate-200 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-bold text-slate-900">{person.name}</div>
                <div className="text-xs text-slate-500">
                  {person.contact || 'no contact'} · rate {person.commissionRate}% ({person.rateScope})
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => startEdit(person)}
                  className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"
                  aria-label="Edit person"
                >
                  <Pencil className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => deletePerson(person.id)}
                  className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-50 cursor-pointer"
                  aria-label="Delete person"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2 text-xs">
              <div className="rounded-lg bg-slate-50 px-3 py-2">
                <div className="text-[10px] font-bold uppercase text-slate-500">Clinics assigned</div>
                <div className="text-lg font-bold text-slate-900">{assigned.length}</div>
              </div>
            </div>

            <div>
              <button
                type="button"
                onClick={() => setSelectedPersonId(selectedPersonId === person.id ? null : person.id)}
                className="text-xs font-bold text-indigo-600 hover:underline cursor-pointer"
              >
                {selectedPersonId === person.id ? 'Hide clinic assignment' : 'Assign clinics'}
              </button>
              {selectedPersonId === person.id && (
                <div className="mt-2 space-y-1.5 max-h-64 overflow-auto border border-slate-100 rounded-lg p-2">
                  <input
                    type="text"
                    placeholder="Search clinics..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full rounded border border-slate-200 px-2 py-1 text-xs mb-1.5"
                  />
                  {labs
                    .filter((l) => l.name.toLowerCase().includes(searchTerm.toLowerCase()))
                    .map((lab) => {
                    const isAssigned = (assignments[lab.id]?.personId ?? null) === person.id;
                    const otherOwner = !isAssigned && assignments[lab.id]?.personId;
                    return (
                      <div key={lab.id} className="flex items-center justify-between gap-2 py-1">
                        <label className="flex items-center gap-2 text-xs cursor-pointer flex-1">
                          <input
                            type="checkbox"
                            checked={isAssigned}
                            disabled={!!otherOwner}
                            onChange={() => toggleClinic(lab.id, person.id)}
                          />
                          <span className={otherOwner ? 'text-slate-400' : 'text-slate-700'}>
                            {lab.name}
                            {otherOwner && ' (assigned to another person)'}
                          </span>
                        </label>
                        {person.rateScope === 'clinic' && isAssigned && (
                          <input
                            type="number"
                            min={0}
                            max={100}
                            placeholder="rate %"
                            className="w-20 rounded border border-slate-200 px-2 py-1 text-xs"
                            value={assignments[lab.id]?.rateOverride ?? ''}
                            onChange={(e) => setRateOverride(lab.id, e.target.value)}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ))}

        {unassigned.length > 0 && (
          <div className="border border-dashed border-slate-200 rounded-xl p-4">
            <div className="text-xs font-bold text-slate-500 mb-1">Unassigned clinics ({unassigned.length})</div>
            <div className="text-xs text-slate-400">
              {unassigned.map((l) => l.name).join(', ')}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
