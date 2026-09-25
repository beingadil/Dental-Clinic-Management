import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { CaseType } from '../../types';
import { 
  BookOpen, 
  Plus, 
  Trash2, 
  Edit2, 
  Search, 
  Printer, 
  ShieldAlert, 
  Sparkles,
  Clock,
  Award,
  CheckCircle2,
  DollarSign,
  Layers,
  X
} from 'lucide-react';

export const CatalogView: React.FC = () => {
  const { caseTypes, addCaseType, updateCaseType, deleteCaseType, brandingSettings } = useApp();

  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingItem, setEditingItem] = useState<CaseType | null>(null);

  // Form State
  const [name, setName] = useState('');
  const [category, setCategory] = useState<CaseType['category']>('crown_bridge');
  const [basePrice, setBasePrice] = useState<number>(15000);
  const [leadDays, setLeadDays] = useState<number>(3);
  const [warrantyMonths, setWarrantyMonths] = useState<number>(60);
  const [description, setDescription] = useState('');
  const [materialSystem, setMaterialSystem] = useState('');
  const [unitBasis, setUnitBasis] = useState('');
  const [shadeGuide, setShadeGuide] = useState('');
  const [indications, setIndications] = useState('');
  const [contraindications, setContraindications] = useState('');
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
      material_system: materialSystem.trim(),
      unit_basis: unitBasis.trim(),
      shade_guide: shadeGuide.trim(),
      indications: indications.trim(),
      contraindications: contraindications.trim(),
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
    setCategory(item.category || 'crown_bridge');
    setBasePrice(item.base_price);
    setLeadDays(item.lead_time_days || 3);
    setWarrantyMonths(item.warranty_months || 60);
    setDescription(item.description || '');
    setMaterialSystem(item.material_system || '');
    setUnitBasis(item.unit_basis || '');
    setShadeGuide(item.shade_guide || '');
    setIndications(item.indications || '');
    setContraindications(item.contraindications || '');
    setShowAddModal(true);
  };

  const resetForm = () => {
    setName('');
    setCategory('crown_bridge');
    setBasePrice(15000);
    setLeadDays(3);
    setWarrantyMonths(60);
    setDescription('');
    setMaterialSystem('');
    setUnitBasis('');
    setShadeGuide('');
    setIndications('');
    setContraindications('');
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

  const categories = [
    { id: 'all', label: 'All Catalog Options' },
    { id: 'crown_bridge', label: 'Crown & Bridge' },
    { id: 'implant', label: 'Implant Prosthetics' },
    { id: 'denture', label: 'Dentures & Removables' },
    { id: 'orthodontic', label: 'Orthodontic & Aligners' },
    { id: 'veneers', label: 'Veneers & Aesthetics' },
  ];

  const handlePrintCatalog = () => {
    window.print();
  };

  return (
    <div className="space-y-6 print-page">
      {/* Header Banner */}
      <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-2xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
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
          <button
            onClick={handlePrintCatalog}
            className="px-3.5 py-2 bg-white hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-semibold transition-colors border border-slate-300 shadow-2xs flex items-center gap-1.5 cursor-pointer"
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
            <p className="text-xs text-slate-500">Generated: {new Date().toISOString().replace('T', ' ').substring(0, 10)}</p>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs flex flex-col md:flex-row items-center justify-between gap-3 no-print">
        {/* Category Pills */}
        <div className="flex flex-wrap gap-1.5 overflow-x-auto w-full">
          {categories.map((cat) => (
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
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search material catalog..."
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-slate-400 focus:bg-white transition-colors"
          />
        </div>
      </div>

      {/* Catalog Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 print-flow">
        {filteredCatalog.map((item) => (
          <div 
            key={item.id}
            className="bg-white rounded-xl border border-slate-200 shadow-2xs hover:border-slate-300 hover:shadow-xs transition-all p-4 flex flex-col justify-between space-y-4 group"
          >
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-700 border border-slate-200">
                  {item.category ? item.category.replace('_', ' ') : 'General'}
                </span>

                <div className="flex items-center gap-1 no-print">
                  <button
                    onClick={() => startEdit(item)}
                    className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded transition-colors cursor-pointer"
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
                    className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors cursor-pointer"
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
                  <Layers className="w-3 h-3 text-slate-400 shrink-0 mt-0.5" />
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
                <span className="text-[10px] text-slate-400 font-bold block uppercase tracking-wider">Base Price</span>
                <span className="font-bold text-slate-900 text-xs">PKR {item.base_price.toLocaleString()}</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 font-bold block uppercase tracking-wider">Turnaround</span>
                <span className="font-medium text-slate-700 text-xs flex items-center justify-center gap-1 mt-0.5">
                  <Clock className="w-3 h-3 text-slate-400" /> {item.lead_time_days || 3}d SLA
                </span>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 font-bold block uppercase tracking-wider">Warranty</span>
                <span className="font-medium text-emerald-700 text-xs flex items-center justify-center gap-1 mt-0.5">
                  <Award className="w-3 h-3 text-emerald-600" /> {item.warranty_months ? `${item.warranty_months / 12}y` : 'N/A'}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {filteredCatalog.length === 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center space-y-3">
          <div className="w-10 h-10 bg-slate-100 text-slate-400 rounded-lg flex items-center justify-center mx-auto">
            <BookOpen className="w-5 h-5" />
          </div>
          <h3 className="font-bold text-slate-800 text-sm">No Catalog Items Found</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            No dental materials match your search filter "{searchTerm}". Try adding a new material option or clearing filters.
          </p>
        </div>
      )}

      {/* Add / Edit Material Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-lg w-full p-5 border border-slate-200 shadow-xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-slate-100 text-slate-700 rounded-lg">
                  <BookOpen className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-sm">
                    {editingItem ? 'Edit Restorative Material' : 'Add New Restorative Option'}
                  </h3>
                  <p className="text-xs text-slate-400">Configure technical specifications & standard clinic rate</p>
                </div>
              </div>
              <button
                onClick={resetForm}
                className="text-slate-400 hover:text-slate-800 p-1 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

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
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as any)}
                    className="w-full p-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:border-slate-400 text-slate-800"
                  >
                    <option value="crown_bridge">Crown & Bridge</option>
                    <option value="implant">Implant Abutment</option>
                    <option value="denture">Denture / Prosthetics</option>
                    <option value="orthodontic">Orthodontic & Aligners</option>
                    <option value="veneers">Veneers & Aesthetics</option>
                  </select>
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
                    value={leadDays}
                    onChange={(e) => setLeadDays(Number(e.target.value))}
                    className="w-full p-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:border-slate-400 text-slate-900"
                  />
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
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">
                  Technical Specification <span className="normal-case font-medium text-slate-400">(optional — printed on the price list)</span>
                </p>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Material System</label>
                      <input
                        type="text"
                        value={materialSystem}
                        onChange={(e) => setMaterialSystem(e.target.value)}
                        placeholder="e.g. 3Y-TZP zirconia, lithium disilicate"
                        className="w-full p-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:border-slate-400 text-slate-900"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Unit Basis</label>
                      <input
                        type="text"
                        value={unitBasis}
                        onChange={(e) => setUnitBasis(e.target.value)}
                        placeholder="e.g. per unit, per arch"
                        className="w-full p-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:border-slate-400 text-slate-900"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Default Shade Guide</label>
                    <input
                      type="text"
                      value={shadeGuide}
                      onChange={(e) => setShadeGuide(e.target.value)}
                      placeholder="e.g. VITA Classical A1–D4"
                      className="w-full p-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:border-slate-400 text-slate-900"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Indications</label>
                    <textarea
                      rows={2}
                      value={indications}
                      onChange={(e) => setIndications(e.target.value)}
                      placeholder="When to prescribe this restoration..."
                      className="w-full p-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:border-slate-400 text-slate-900"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Contraindications</label>
                    <textarea
                      rows={2}
                      value={contraindications}
                      onChange={(e) => setContraindications(e.target.value)}
                      placeholder="When this material should not be used..."
                      className="w-full p-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:border-slate-400 text-slate-900"
                    />
                  </div>
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
        </div>
      )}
    </div>
  );
};
