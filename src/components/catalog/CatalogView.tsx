import { useTransientFlag } from '../common/useTransient';
import { formatPKR } from '../../services/financeDomain';
import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { CaseType, PriorityLevel, CatalogCategory } from '../../types';
import {
  categoryRepo,
  type CategoryDeleteResult,
} from '../../db/repos';
import { 
  BookOpen, 
  Plus, 
  Trash2, 
  Edit2, 
  Search, 
  Printer, 
  Clock,
  Award,
  Layers,
  Tags,
  AlertTriangle,
} from 'lucide-react';
import { Modal } from '../common/ui';
import { GlassSelect } from '../common/ui/GlassSelect';
import { SavePdfButton } from '../print/SavePdfButton';
import { getTodayStr } from '../../utils/dateUtils';
import { catalogNeedsTeeth } from '../../utils/catalogToothRequirement';
import { printCurrentDocument } from '../../utils/printDocument';
import {
  loadSlaSettings,
  saveSlaSettings,
  DEFAULT_SLA_DAYS,
  PRIORITY_LABELS,
  PRIORITY_ORDER,
  prioritySlaLabel,
} from '../../services/prioritySla';

/**
 * The unit basis a product is priced by, as a fixed list.
 *
 * It was a free-text box, which meant 'per unit', 'Per-Unit', 'per  Unit' and
 * 'per unit ' were four different stored strings for one concept — and nothing
 * downstream could rely on it. These values are the ones the seeded catalog
 * already uses, so no row changes meaning when the input becomes a dropdown.
 */
const UNIT_BASIS_OPTIONS = [
  { value: 'per unit', label: 'Per unit — bill per charted tooth' },
  { value: 'per 3-unit span', label: 'Per 3-unit span' },
  { value: 'per arch (complete set = 2x base price)', label: 'Per arch (complete set)' },
  { value: 'per implant restoration', label: 'Per implant restoration' },
] as const;

/**
 * Read the saved categories, tolerating a database that predates migration 023.
 *
 * A read must never be the thing that crashes a screen: if the table is somehow
 * absent (an old snapshot restored over a newer build, a partial migration),
 * `categoryRepo.all()` throws. Falling back to the historical hardcoded five
 * keeps the catalog usable and the operator able to see WHY, rather than
 * white-screening the whole page.
 */
function readCategories(): CatalogCategory[] {
  try {
    return categoryRepo.all();
  } catch {
    return ['crown_bridge', 'implant', 'denture', 'orthodontic', 'veneers'].map((id, i) => ({
      id,
      name: id,
      sort_order: (i + 1) * 10,
    }));
  }
}

export const CatalogView: React.FC = () => {
  const { caseTypes, addCaseType, updateCaseType, deleteCaseType, brandingSettings } = useApp();

  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingItem, setEditingItem] = useState<CaseType | null>(null);

  /* Catalog / SLA / Categories tabs. SLA is global (it sets the turnaround
     promise for every case) and Categories is a managed reference list, so
     neither belongs on a per-product form. */
  const [tab, setTab] = useState<'catalog' | 'sla' | 'categories'>('catalog');

  /* Categories are read straight from the repo rather than lifted into
     AppContext: migration 023 made them operator-managed, and this is the only
     surface that consumes them (the filter pills and the material form's
     dropdown). A local list re-read after each mutation keeps AppContext —
     which owns the autosave contract for cases, invoices and the ledger —
     free of a second, unrelated consistency surface. */
  const [categories, setCategories] = useState<CatalogCategory[]>(() => readCategories());
  const refreshCategories = () => setCategories(readCategories());

  /* Category CRUD editor state. `editingCategoryId` names the row being
     renamed; `pendingDelete` holds the blocked-delete report so the operator
     can see WHICH products are in the way before choosing a remedy. */
  const [newCategoryName, setNewCategoryName] = useState('');
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState('');
  const [pendingDelete, setPendingDelete] = useState<CategoryDeleteResult | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  /* Destructive cascade needs the operator to retype the category name — the
     single cheapest guard against deleting a live catalog by muscle memory. */
  const [cascadeConfirmText, setCascadeConfirmText] = useState('');
  const [reassignTarget, setReassignTarget] = useState('');

  /* SLA editor state, seeded from storage and seeded with the shipped defaults
     so the form is never blank. `reloadSlaSettings()` inside `save` refreshes the
     module-level copy every other surface reads. */
  const [slaDays, setSlaDays] = useState<Record<PriorityLevel, number>>(() => loadSlaSettings());
  const [slaSaved, flashSlaSaved] = useTransientFlag(3000);

  // Form State
  const [name, setName] = useState('');
  /* Defaults to the first SAVED category rather than the literal 'crown_bridge',
     so the form is usable on a database whose categories were renamed. */
  const [category, setCategory] = useState<string>(() => readCategories()[0]?.id ?? '');
  const [basePrice, setBasePrice] = useState<number>(15000);
  const [leadDays, setLeadDays] = useState<number>(3);
  const [warrantyMonths, setWarrantyMonths] = useState<number>(60);
  const [description, setDescription] = useState('');
  const [unitBasis, setUnitBasis] = useState<string>(UNIT_BASIS_OPTIONS[0].value);
  // Default true: most products are per-tooth work, and a product saved before
  // migration 021 must keep meaning what it meant. Only opt out deliberately.
  const [needsTeeth, setNeedsTeeth] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = 'Material name is required';
    if (basePrice <= 0) errs.basePrice = 'Base price must be greater than 0';
    if (leadDays <= 0) errs.leadDays = 'Lead time must be at least 1 day';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleCreateOrUpdate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    const payload = {
      name: name.trim(),
      category,
      base_price: Number(basePrice),
      lead_time_days: Number(leadDays),
      warranty_months: Number(warrantyMonths),
      description: description.trim(),
      unit_basis: unitBasis,
      // The checkbox state is already a boolean, so this is an identity today.
      // It stays routed through the resolver because the contract that matters is
      // "never undefined": an omitted flag would be stored as 1 by the autosave,
      // so a product the operator turned off would silently come back on.
      needs_teeth: catalogNeedsTeeth({ needs_teeth: needsTeeth }),
      // material_system / shade_guide / indications / contraindications are
      // DELIBERATELY ABSENT, not blanked. `caseTypesRepo.update` only writes keys
      // present in the payload, so sending them as '' would erase whatever a
      // seeded or previously-edited product had on file the moment anyone
      // touched its name. They are no longer editable in the UI; the columns stay
      // for existing data and the price list.
    };

    if (editingItem) {
      updateCaseType(editingItem.id, payload);
    } else {
      addCaseType(payload);
    }

    resetForm();
  };

  const startEdit = (item: CaseType) => {
    setEditingItem(item);
    setName(item.name);
    /* Fall back to the first SAVED category, not the literal 'crown_bridge'. A
       product whose category has since been deleted would otherwise be forced
       into whichever category happened to hold that id. */
    setCategory(categories.some((c) => c.id === item.category) ? item.category! : (categories[0]?.id ?? ''));
    setBasePrice(item.base_price);
    setLeadDays(item.lead_time_days || 3);
    setWarrantyMonths(item.warranty_months || 60);
    setDescription(item.description || '');
    setUnitBasis(item.unit_basis || UNIT_BASIS_OPTIONS[0].value);
    setNeedsTeeth(catalogNeedsTeeth(item));
    setShowAddModal(true);
  };

  const resetForm = () => {
    setName('');
    setCategory(categories[0]?.id ?? '');
    setBasePrice(15000);
    setLeadDays(3);
    setWarrantyMonths(60);
    setDescription('');
    setUnitBasis(UNIT_BASIS_OPTIONS[0].value);
    setNeedsTeeth(true);
    setErrors({});
    setEditingItem(null);
    setShowAddModal(false);
  };

  // Filtered List
  const filteredCatalog = caseTypes.filter((ct) => {
    const matchesSearch = 
      ct.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (ct.description || '').toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = categoryFilter === 'all' || ct.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  /* Filter pills. 'all' is synthetic; the rest are the operator-managed rows,
     which is what makes a category added in the Categories tab appear here
     without a code change. */
  const categoryPills = [
    { id: 'all', label: 'All Catalog Options' },
    ...categories.map((c) => ({ id: c.id, label: c.name })),
  ];

  /* The label a product prints with. Falling back to the raw id is deliberate:
     it must never render as an empty badge. */
  const categoryNameFor = (id?: string) => categories.find((c) => c.id === id)?.name ?? id ?? 'Uncategorised';

  const handlePrintCatalog = () => {
    void printCurrentDocument();
  };

  /* ── Category CRUD ──────────────────────────────────────────────────────
     Every handler re-reads the saved list rather than patching local state, so
     what the screen shows is always exactly what is in the database — including
     the disambiguated slug the repo may have chosen (two names can reduce to
     one id). Patching optimistically would let the two drift. */

  const handleAddCategory = () => {
    const name = newCategoryName.trim();
    if (!name) {
      setCategoryError('Give the category a name.');
      return;
    }
    try {
      categoryRepo.create(name);
      refreshCategories();
      setNewCategoryName('');
      setCategoryError(null);
    } catch (err) {
      setCategoryError(err instanceof Error ? err.message : 'Could not add that category.');
    }
  };

  const startEditCategory = (c: CatalogCategory) => {
    setEditingCategoryId(c.id);
    setEditingCategoryName(c.name);
    setCategoryError(null);
  };

  const handleSaveCategoryRename = () => {
    if (!editingCategoryId) return;
    try {
      categoryRepo.update(editingCategoryId, editingCategoryName);
      refreshCategories();
      setEditingCategoryId(null);
      setCategoryError(null);
    } catch (err) {
      setCategoryError(err instanceof Error ? err.message : 'Could not rename that category.');
    }
  };

  /* Try the safe delete first. It refuses while products hold the category and
     returns WHICH ones, so the operator is shown the actual blockers rather
     than a generic "cannot delete". */
  const handleRequestDeleteCategory = (id: string) => {
    setCategoryError(null);
    setDeleteTargetId(id);
    setCascadeConfirmText('');
    setReassignTarget(categories.find((c) => c.id !== id)?.id ?? '');
    const res = categoryRepo.delete(id);
    if (res.ok) {
      refreshCategories();
      setDeleteTargetId(null);
      return;
    }
    setPendingDelete(res);
  };

  /* Move the named products to another category, then delete it.

     BOTH stores must move together. `syncCollectionsToDb` rebuilds the whole
     `case_types` table from React state on every autosave (AppContext), so a
     repo-only move is undone seconds later — the products would snap back into
     the category that no longer exists. Updating SQLite alone is not enough;
     the UI mirror has to be updated in the same turn. */
  const handleReassignThenDelete = () => {
    if (!deleteTargetId || !reassignTarget) return;
    const moving = pendingDelete?.blockingProducts ?? [];
    try {
      categoryRepo.deleteWithReassign(deleteTargetId, reassignTarget);
      moving.forEach((p) => updateCaseType(p.id, { category: reassignTarget }));
      refreshCategories();
      setPendingDelete(null);
      setDeleteTargetId(null);
    } catch (err) {
      setCategoryError(err instanceof Error ? err.message : 'Could not move those materials.');
    }
  };

  /* Cascade is the only path that destroys materials, so it is reachable only
     after the operator retypes the exact category name. */
  const handleCascadeDelete = () => {
    if (!deleteTargetId) return;
    const target = categories.find((c) => c.id === deleteTargetId);
    if (!target || cascadeConfirmText.trim() !== target.name) return;
    const doomed = pendingDelete?.blockingProducts ?? [];
    categoryRepo.deleteWithCascade(deleteTargetId);
    // Same reason as above: leaving these in state would have autosave re-create
    // every deleted material on the next sync.
    doomed.forEach((p) => deleteCaseType(p.id));
    refreshCategories();
    setPendingDelete(null);
    setDeleteTargetId(null);
    setCascadeConfirmText('');
  };

  const handleDismissDelete = () => {
    setPendingDelete(null);
    setDeleteTargetId(null);
    setCascadeConfirmText('');
  };

  /* Persist the turnaround map. `saveSlaSettings` re-resolves the module-level
     copy, so every other reader — the case wizard's priority cards, the delivery
     date it auto-computes, the analytics turnaround report — picks the change up
     on its next render. Saving one level must not disturb the other three, so
     the whole map is written, not just the edited field. */
  const handleSaveSla = () => {
    saveSlaSettings(slaDays);
    setSlaDays(loadSlaSettings());
    flashSlaSaved();
  };

  const handleResetSla = () => {
    setSlaDays({ ...DEFAULT_SLA_DAYS });
  };

  return (
    <div className="space-y-6 print-page">
      {/* Header Banner */}
      <div className="ds-glass-card rounded-xl p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="p-1 bg-slate-100 rounded text-slate-600">
              <BookOpen className="w-4 h-4" />
            </span>
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              {brandingSettings.appName || 'Dental Solutions'} • Material & Service Catalog
            </span>
          </div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">
            Restorative Materials & Official Price List
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Standard unit pricing, technical turnarounds (SLA), and warranty specifications for dental clinics.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <SavePdfButton suggestedName="Material-Service-Catalog.pdf" />
          <button
            onClick={handlePrintCatalog}
            className="px-3.5 py-2 ds-glass-pill text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Print Price List</span>
          </button>
          <button
            onClick={() => {
              resetForm();
              setShowAddModal(true);
            }}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold transition-colors shadow-2xs flex items-center gap-1.5 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add New Material</span>
          </button>
        </div>
      </div>

      {/* Print-only Letterhead */}
      <div className="hidden print:block print-flow pb-4 mb-2 border-b-2 border-slate-900 text-slate-900">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-xl font-black">{brandingSettings.appName || 'DENTAL SOLUTIONS'}</h1>
            <p className="text-xs text-slate-600">{brandingSettings.tagline}</p>
            <p className="text-[11px] text-slate-500">{brandingSettings.address} • Ph: {brandingSettings.phone}</p>
          </div>
          <div className="text-right">
            <h2 className="text-base font-black">MATERIAL &amp; SERVICE CATALOG</h2>
            <p className="text-xs text-slate-600">Official Price List</p>
            <p className="text-xs text-slate-500">Generated: {getTodayStr()}</p>
          </div>
        </div>
      </div>

      {/* Module tabs. SLA is global — it sets the turnaround promise for every
          case, so it cannot live on a per-product form. */}
      <div className="flex items-center gap-1.5 border-b border-slate-200 no-print">
        {([
          { id: 'catalog' as const, label: 'Materials & Pricing', icon: Layers },
          { id: 'sla' as const, label: 'SLA & Priority', icon: Clock },
          { id: 'categories' as const, label: 'Categories', icon: Tags },
        ]).map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-current={active ? 'page' : undefined}
              className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold border-b-2 -mb-px transition-colors cursor-pointer ${
                active
                  ? 'border-brand-600 text-slate-900'
                  : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'categories' ? (
        /* ── Categories ────────────────────────────────────────────────────── */
        <div className="space-y-4">
          <div className="ds-glass-card rounded-xl p-5">
            <h2 className="text-sm font-bold text-slate-900">Material categories</h2>
            <p className="text-xs text-slate-600 mt-0.5 max-w-2xl">
              The saved list that feeds the category filter and the material form.
              A category with materials in it cannot be deleted until they are
              moved — see the remedies below.
            </p>

            {/* Add */}
            <div className="flex flex-wrap items-center gap-2 mt-4">
              <input
                type="text"
                value={newCategoryName}
                onChange={(e) => {
                  setNewCategoryName(e.target.value);
                  if (categoryError) setCategoryError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddCategory();
                  }
                }}
                placeholder="e.g. Sleep Apnea Splints"
                aria-label="New category name"
                className="flex-1 min-w-[200px] px-2.5 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:border-slate-400 text-slate-800"
              />
              <button
                type="button"
                onClick={handleAddCategory}
                className="px-4 py-2 ds-glass-pill text-xs font-bold transition-colors cursor-pointer inline-flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                Add category
              </button>
            </div>
            {categoryError && (
              <p role="alert" className="mt-2 text-[11px] font-medium text-rose-600">
                {categoryError}
              </p>
            )}
          </div>

          {/* Saved list */}
          <div className="ds-glass-card rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100">
              <span className="text-xs font-bold text-slate-800">
                {categories.length} categor{categories.length === 1 ? 'y' : 'ies'}
              </span>
            </div>
            <ul className="divide-y divide-slate-100">
              {categories.map((c) => {
                const count = caseTypes.filter((ct) => ct.category === c.id).length;
                const isEditing = editingCategoryId === c.id;
                return (
                  <li key={c.id} className="px-5 py-3 flex flex-wrap items-center gap-3">
                    {isEditing ? (
                      <>
                        <input
                          autoFocus
                          type="text"
                          value={editingCategoryName}
                          onChange={(e) => setEditingCategoryName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveCategoryRename();
                            if (e.key === 'Escape') setEditingCategoryId(null);
                          }}
                          aria-label={`Rename ${c.name}`}
                          className="flex-1 min-w-[180px] px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:border-slate-400 text-slate-800"
                        />
                        <button
                          type="button"
                          onClick={handleSaveCategoryRename}
                          className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingCategoryId(null)}
                          className="px-3 py-1.5 text-slate-600 hover:text-slate-900 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <div className="flex-1 min-w-[160px]">
                          <div className="text-xs font-bold text-slate-800">{c.name}</div>
                          <div className="font-mono text-[10px] text-ink-muted mt-0.5">{c.id}</div>
                        </div>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide border ${
                            count === 0
                              ? 'bg-slate-50 text-slate-500 border-slate-200'
                              : 'bg-brand-50 text-brand-700 border-brand-200'
                          }`}
                        >
                          {count} material{count === 1 ? '' : 's'}
                        </span>
                        <button
                          type="button"
                          onClick={() => startEditCategory(c)}
                          aria-label={`Rename ${c.name}`}
                          className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRequestDeleteCategory(c.id)}
                          aria-label={`Delete ${c.name}`}
                          className="p-1.5 text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Blocked-delete report: name the blockers, offer both remedies. */}
          {pendingDelete && deleteTargetId && pendingDelete.reason === 'in_use' && (
            <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-5">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-700 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <h3 className="text-xs font-bold text-amber-900">
                    &ldquo;{categoryNameFor(deleteTargetId)}&rdquo; still holds{' '}
                    {pendingDelete.blockingProducts.length} material
                    {pendingDelete.blockingProducts.length === 1 ? '' : 's'}
                  </h3>
                  <p className="text-[11px] text-amber-800 mt-1">
                    Deleting it would take those materials out of every filter and print.
                    Move them somewhere else first, or remove them deliberately.
                  </p>
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {pendingDelete.blockingProducts.map((p) => (
                      <li
                        key={p.id}
                        className="px-2 py-0.5 rounded-md bg-white border border-amber-200 text-[11px] font-medium text-amber-900"
                      >
                        {p.name}
                      </li>
                    ))}
                  </ul>

                  <div className="mt-4 space-y-3">
                    {/* Remedy 1 — reassign (non-destructive). */}
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] font-bold uppercase tracking-wide text-amber-900">
                        Move to
                      </span>
                      <GlassSelect
                        value={reassignTarget}
                        onChange={setReassignTarget}
                        ariaLabel="Move materials to"
                        className="px-2.5 py-1.5 text-xs"
                        options={categories
                          .filter((c) => c.id !== deleteTargetId)
                          .map((c) => ({ value: c.id, label: c.name }))}
                      />
                      <button
                        type="button"
                        onClick={handleReassignThenDelete}
                        className="px-3 py-1.5 bg-amber-800 hover:bg-amber-900 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer"
                      >
                        Move {pendingDelete.blockingProducts.length} and delete category
                      </button>
                    </div>

                    {/* Remedy 2 — cascade. Type-to-confirm. */}
                    <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-amber-200">
                      <span className="text-[11px] font-bold uppercase tracking-wide text-rose-700">
                        Or delete the materials too
                      </span>
                      <input
                        type="text"
                        value={cascadeConfirmText}
                        onChange={(e) => setCascadeConfirmText(e.target.value)}
                        placeholder={`Type "${categoryNameFor(deleteTargetId)}" to confirm`}
                        aria-label="Type the category name to confirm deletion"
                        className="flex-1 min-w-[190px] px-2.5 py-1.5 text-xs bg-white border border-rose-300 rounded-lg focus:outline-none focus:border-rose-500 text-slate-800"
                      />
                      <button
                        type="button"
                        onClick={handleCascadeDelete}
                        disabled={cascadeConfirmText.trim() !== categoryNameFor(deleteTargetId)}
                        className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Delete everything
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={handleDismissDelete}
                      className="px-3 py-1.5 text-amber-900 hover:bg-amber-100 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* The last category is undeletable — say so rather than failing silently. */}
          {pendingDelete?.reason === 'last_category' && (
            <div
              role="alert"
              className="rounded-xl border-2 border-amber-300 bg-amber-50 p-4 flex items-start gap-2.5"
            >
              <AlertTriangle className="w-4 h-4 text-amber-700 mt-0.5 shrink-0" />
              <div>
                <h3 className="text-xs font-bold text-amber-900">
                  This is the last remaining category
                </h3>
                <p className="text-[11px] text-amber-800 mt-1">
                  The material form needs one category to select. Add another before removing this one.
                </p>
                <button
                  type="button"
                  onClick={handleDismissDelete}
                  className="mt-3 px-3 py-1.5 text-amber-900 hover:bg-amber-100 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          )}
        </div>
      ) : tab === 'sla' ? (
        /* ── SLA & Priority ────────────────────────────────────────────────── */
        <div className="space-y-4 print-page">
          <div className="ds-glass-card rounded-xl p-5">
            <div className="flex flex-wrap items-start justify-between gap-3 mb-1">
              <div>
                <h2 className="text-sm font-bold text-slate-900">Turnaround by priority</h2>
                <p className="text-xs text-slate-600 mt-0.5 max-w-2xl">
                  The delivery commitment for each priority. This applies to
                  <span className="font-semibold"> every case in the system</span>: the new-case
                  wizard auto-sets its target delivery date from it, the priority cards on every
                  case show it, and the Analytics turnaround report grades on-time delivery
                  against it.
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {slaSaved && (
                  <span className="px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[11px] font-bold uppercase border border-emerald-200">
                    Saved
                  </span>
                )}
                <button
                  type="button"
                  onClick={handleResetSla}
                  className="px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-lg border border-slate-200 transition-colors cursor-pointer"
                >
                  Reset to defaults
                </button>
                <button
                  type="button"
                  onClick={handleSaveSla}
                  className="px-4 py-1.5 ds-glass-pill text-xs font-bold transition-colors cursor-pointer"
                >
                  Save SLA
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
              {PRIORITY_ORDER.map((p) => (
                <div key={p} className="rounded-xl border border-slate-200 bg-slate-50 p-3.5">
                  <label
                    htmlFor={`sla-${p}`}
                    className="flex items-center justify-between gap-2 text-xs font-bold text-slate-800 mb-2"
                  >
                    <span>{PRIORITY_LABELS[p]}</span>
                    <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
                      {prioritySlaLabel(p)}
                    </span>
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      id={`sla-${p}`}
                      type="number"
                      min={0}
                      max={365}
                      step={1}
                      value={slaDays[p]}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        setSlaDays((prev) => ({
                          ...prev,
                          // An empty box yields '' -> keep the previous value rather
                          // than writing NaN into the map, which would coerce to a
                          // broken turnaround for this priority only.
                          [p]: Number.isFinite(n) && n >= 0 && n <= 365 ? Math.round(n) : prev[p],
                        }));
                      }}
                      className="w-24 px-2.5 py-2 text-sm font-bold font-mono tabular-nums bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-brand-600"
                    />
                    <span className="text-xs text-slate-500 font-medium">
                      {slaDays[p] === 1 ? 'day' : 'days'} turnaround
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <p className="mt-4 text-[11px] text-slate-500 leading-relaxed">
              Cases already saved keep the delivery date they were given — changing the promise
              here does not rewrite dates a clinic has already been quoted or has already met.
              It governs every case going forward.
            </p>
          </div>

          {/* Print-only summary, so the printed price list carries the promise. */}
          <div className="hidden print:block border-t-2 border-slate-900 pt-3">
            <div className="text-xs font-black uppercase tracking-wider mb-1.5">Turnaround Commitment</div>
            <div className="grid grid-cols-4 gap-3">
              {PRIORITY_ORDER.map((p) => (
                <div key={p}>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-600">
                    {PRIORITY_LABELS[p]}
                  </div>
                  <div className="text-base font-black">{slaDays[p]}D</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <>
      {/* Filter and Search Bar */}
      <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs flex flex-col md:flex-row items-center justify-between gap-3 no-print">
        {/* Category Pills */}
        <div className="flex flex-wrap gap-1.5 overflow-x-auto w-full">
          {categoryPills.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setCategoryFilter(cat.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                categoryFilter === cat.id
                  ? 'bg-slate-900 text-white shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative w-full md:w-72">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted pointer-events-none" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search material catalog..."
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder:text-ink-muted focus:outline-none focus:border-slate-400 focus:bg-white transition-colors"
          />
        </div>
      </div>

      {/* Catalog Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 print-flow max-h-[calc(100vh-360px)] overflow-y-auto no-scrollbar pr-0.5 print:max-h-none print:overflow-visible">
        {filteredCatalog.map((item) => (
          <div 
            key={item.id}
            className="bg-ds-surface/55 rounded-xl border border-ds-line shadow-2xs hover:border-slate-400 hover:shadow-xs transition-all p-3.5 flex flex-col justify-between space-y-3 group"
          >
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-700 border border-slate-200">
                  {categoryNameFor(item.category)}
                </span>

                {!catalogNeedsTeeth(item) && (
                  <span
                    className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-amber-50 text-amber-800 border border-amber-200"
                    title="Not per-tooth work: cases skip tooth selection and shade"
                  >
                    No teeth
                  </span>
                )}

                <div className="flex items-center gap-1 no-print">
                  <button
                    onClick={() => startEdit(item)}
                    className="p-1 text-ink-muted hover:text-slate-700 hover:bg-slate-100 rounded transition-colors cursor-pointer"
                    title="Edit Item"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(`Remove ${item.name} from price catalog?`)) {
                        deleteCaseType(item.id);
                      }
                    }}
                    className="p-1 text-ink-muted hover:text-ink-danger hover:bg-rose-50 rounded transition-colors cursor-pointer"
                    title="Delete Item"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <h3 className="font-bold text-slate-900 text-sm group-hover:text-slate-800 transition-colors">
                {item.name}
              </h3>

              {item.material_system && (
                <p className="text-[11px] text-slate-600 font-semibold flex items-start gap-1.5">
                  <Layers className="w-3 h-3 text-ink-muted shrink-0 mt-0.5" />
                  <span>{item.material_system}</span>
                </p>
              )}

              {item.description && (
                <p className="text-xs text-slate-500 line-clamp-2 leading-relaxed">
                  {item.description}
                </p>
              )}

              {(item.indications || item.contraindications || item.shade_guide || item.unit_basis) && (
                <div className="space-y-1.5 pt-1 print-flow">
                  {item.indications && (
                    <p className="text-[10.5px] leading-snug text-slate-600">
                      <span className="font-bold text-emerald-700 uppercase tracking-wide">Indications: </span>
                      {item.indications}
                    </p>
                  )}
                  {item.contraindications && (
                    <p className="text-[10.5px] leading-snug text-slate-600">
                      <span className="font-bold text-rose-700 uppercase tracking-wide">Contraindications: </span>
                      {item.contraindications}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {item.unit_basis && (
                      <span className="px-1.5 py-0.5 rounded bg-slate-50 border border-slate-200 text-[9.5px] font-semibold text-slate-600">
                        {item.unit_basis}
                      </span>
                    )}
                    {item.shade_guide && (
                      <span className="px-1.5 py-0.5 rounded bg-slate-50 border border-slate-200 text-[9.5px] font-semibold text-slate-600">
                        Shades: {item.shade_guide}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-slate-100 grid grid-cols-3 gap-2 text-center bg-slate-50 p-2.5 rounded-lg">
              <div>
                <span className="text-[10px] text-ink-muted font-bold block uppercase tracking-wider">Base Price</span>
                <span className="font-bold text-slate-900 text-xs">{formatPKR(item.base_price)}</span>
              </div>
              <div>
                <span className="text-[10px] text-ink-muted font-bold block uppercase tracking-wider">Turnaround</span>
                <span className="font-medium text-slate-700 text-xs flex items-center justify-center gap-1 mt-0.5">
                  <Clock className="w-3 h-3 text-ink-muted" /> {item.lead_time_days || 3}d SLA
                </span>
              </div>
              <div>
                <span className="text-[10px] text-ink-muted font-bold block uppercase tracking-wider">Warranty</span>
                <span className="font-medium text-emerald-700 text-xs flex items-center justify-center gap-1 mt-0.5">
                  <Award className="w-3 h-3 text-ink-success" /> {item.warranty_months ? `${item.warranty_months / 12}y` : 'N/A'}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {filteredCatalog.length === 0 && (
        <div className="bg-ds-surface/40 rounded-xl border border-dashed border-ds-line p-12 text-center space-y-3">
          <div className="w-10 h-10 bg-slate-100 text-ink-muted rounded-lg flex items-center justify-center mx-auto">
            <BookOpen className="w-5 h-5" />
          </div>
          <h3 className="font-bold text-slate-800 text-sm">No Catalog Items Found</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            No dental materials match your search filter "{searchTerm}". Try adding a new material option or clearing filters.
          </p>
        </div>
      )}

      {/* Add / Edit Material Modal */}
      {/* Add / Edit Material Modal — on `ui/Modal`: this overlay had no Escape
          handling, no focus trap and no `role="dialog"`. Bespoke header kept. */}
      <Modal
        open={showAddModal}
        onClose={resetForm}
        label={editingItem ? 'Edit Restorative Material' : 'Add New Restorative Option'}
        maxWidth="max-w-lg"
        headerClassName="px-5 py-3"
        header={
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-slate-100 text-slate-700 rounded-lg">
              <BookOpen className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-sm">
                {editingItem ? 'Edit Restorative Material' : 'Add New Restorative Option'}
              </h3>
              <p className="text-xs text-ink-muted">Configure technical specifications &amp; standard clinic rate</p>
            </div>
          </div>
        }
      >
          <div className="space-y-4 p-5 pt-4">
            <form onSubmit={handleCreateOrUpdate} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Material / Option Name *</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Zirconia Monolithic Ultra Translucent"
                  className="w-full p-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:border-slate-400 text-slate-900"
                />
                {errors.name && <p className="text-[10px] text-rose-500 mt-1">{errors.name}</p>}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Category</label>
                  <GlassSelect
                    value={category}
                    onChange={setCategory}
                    ariaLabel="Category"
                    className="w-full p-2 text-xs font-bold"
                    options={categories.map((c) => ({ value: c.id, label: c.name }))}
                  />
                  {/* The dropdown offered different labels from the filter pills
                      ('Implant Abutment' vs 'Implant Prosthetics'), so one category
                      had two names depending on where the operator looked. Both
                      now read the single saved row. */}
                  <p className="text-[10px] text-ink-muted mt-1">
                    Managed in the Categories tab.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Base Price (PKR) *</label>
                  <input
                    type="number"
                    value={basePrice}
                    onChange={(e) => setBasePrice(Number(e.target.value))}
                    className="w-full p-2 text-xs bg-slate-50 border border-slate-200 rounded-lg font-bold text-slate-900 focus:bg-white focus:outline-none focus:border-slate-400"
                  />
                  {errors.basePrice && <p className="text-[10px] text-rose-500 mt-1">{errors.basePrice}</p>}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">SLA Turnaround (Days)</label>
                  <input
                    type="number"
                    min={1}
                    value={leadDays}
                    onChange={(e) => setLeadDays(Number(e.target.value))}
                    aria-invalid={!!errors.leadDays}
                    className={`w-full p-2 text-xs bg-slate-50 border rounded-lg focus:bg-white focus:outline-none text-slate-900 ${
                      errors.leadDays ? 'border-rose-400' : 'border-slate-200 focus:border-slate-400'
                    }`}
                  />
                  {/* `validate()` has always set this message — it was just never
                      rendered. So a material with a 0 or negative SLA hit Save,
                      the submit silently did nothing, no field was marked and no
                      reason was given: the form looked broken rather than
                      invalid. The other two validated fields render theirs. */}
                  {errors.leadDays && <p className="text-[10px] text-rose-500 mt-1">{errors.leadDays}</p>}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Warranty Period (Months)</label>
                  <input
                    type="number"
                    value={warrantyMonths}
                    onChange={(e) => setWarrantyMonths(Number(e.target.value))}
                    className="w-full p-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:border-slate-400 text-slate-900"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Description / Indications</label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Indicated for anterior aesthetic crowns, veneers, high strength posterior bridges..."
                  className="w-full p-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:border-slate-400 text-slate-900"
                />
              </div>

              <div className="pt-1 border-t border-slate-100">
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Unit Basis</label>
                    <GlassSelect
                      value={unitBasis}
                      onChange={setUnitBasis}
                      ariaLabel="Unit basis"
                      className="w-full p-2 text-xs font-bold"
                      options={[
                        ...UNIT_BASIS_OPTIONS.map((opt) => ({ value: opt.value, label: opt.label })),
                        ...(unitBasis && !UNIT_BASIS_OPTIONS.some((o) => o.value === unitBasis)
                          ? [{ value: unitBasis, label: `${unitBasis} (legacy)` }]
                          : []),
                      ]}
                    />
                    <p className="text-[10px] text-ink-muted mt-1">
                      Per-tooth work bills the base price once per charted unit.
                    </p>
                  </div>

                  <label className="flex items-start gap-2.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={needsTeeth}
                      onChange={(e) => setNeedsTeeth(e.target.checked)}
                      className="w-4 h-4 mt-0.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                    />
                    <span className="text-xs text-slate-600 leading-relaxed">
                      <span className="font-semibold text-slate-800">Requires tooth selection.</span>{' '}
                      Turn this off for products that are not per-tooth work (retainers, healing
                      posts, a denture try-in) — teeth and shade are then skipped when creating a
                      case and left off the job slip and invoice.
                    </span>
                  </label>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={resetForm}
                  className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
                >
                  {editingItem ? 'Update Material' : 'Add to Catalog'}
                </button>
              </div>
            </form>
          </div>
      </Modal>
        </>
      )}
    </div>
  );
};
