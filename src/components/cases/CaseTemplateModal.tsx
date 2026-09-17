import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { CaseTemplate } from '../../types';
import { Bookmark, Plus, Trash2, Check, Search, ShieldAlert } from 'lucide-react';

interface CaseTemplateModalProps {
  onApplyTemplate?: (template: CaseTemplate) => void;
  onClose?: () => void;
}

export const CaseTemplateModal: React.FC<CaseTemplateModalProps> = ({ onApplyTemplate, onClose }) => {
  const { templates, caseTypes, deleteTemplate, saveAsTemplate } = useApp();
  const [searchTerm, setSearchTerm] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);

  // Form State for New Template
  const [templateName, setTemplateName] = useState('');
  const [caseTypeId, setCaseTypeId] = useState(caseTypes[0]?.id || '');
  const [description, setDescription] = useState('');
  const [shade, setShade] = useState('A2');
  const [instructions, setInstructions] = useState('');
  const [priority, setPriority] = useState<CaseTemplate['default_priority']>('normal');
  const [errors, setErrors] = useState<{ templateName?: string }>({});

  const filteredTemplates = templates.filter((t) =>
    t.template_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    t.case_type_name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleCreateTemplate = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: { templateName?: string } = {};
    if (!templateName.trim()) {
      errs.templateName = 'Template name is required';
    } else if (templateName.length < 3 || templateName.length > 100) {
      errs.templateName = 'Template name must be between 3 and 100 characters';
    } else if (templates.some((t) => t.template_name.toLowerCase() === templateName.toLowerCase().trim())) {
      errs.templateName = 'Template with this name already exists';
    }

    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }

    const selectedCT = caseTypes.find((ct) => ct.id === caseTypeId);

    saveAsTemplate(
      templateName.trim(),
      {
        id: '',
        case_number: '',
        lab_id: '',
        lab_name: '',
        case_type_id: caseTypeId,
        case_type_name: selectedCT ? selectedCT.name : 'Zirconia Crown',
        doctor_name: '',
        selected_teeth: [11, 21],
        shade,
        delivery_date: '',
        priority,
        price: selectedCT ? selectedCT.base_price : 15000,
        discount: 0,
        final_price: selectedCT ? selectedCT.base_price : 15000,
        instructions,
        status: 'received',
        created_at: '',
        updated_at: '',
        history: []
      },
      description
    );

    setTemplateName('');
    setDescription('');
    setShowCreateForm(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <Bookmark className="w-5 h-5 text-blue-600" />
            Case Template Library
          </h2>
          <p className="text-xs text-slate-500">
            Standard preset configurations for quick case registration
          </p>
        </div>
        <button
          onClick={() => setShowCreateForm(!showCreateForm)}
          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs rounded-lg shadow-xs flex items-center gap-1.5 transition-colors"
        >
          <Plus className="w-4 h-4" />
          <span>{showCreateForm ? 'Cancel' : 'New Preset Template'}</span>
        </button>
      </div>

      {/* Search Bar */}
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search templates by preset name or material type..."
          className="w-full pl-9 pr-4 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20"
        />
      </div>

      {/* New Template Form */}
      {showCreateForm && (
        <form onSubmit={handleCreateTemplate} className="p-4 bg-blue-50/50 border border-blue-200 rounded-xl space-y-3">
          <h4 className="text-xs font-bold text-blue-900 uppercase tracking-wider">Create Custom Template Preset</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Template Name <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                placeholder="e.g. Posterior Zirconia Bridge Standard"
                className="w-full p-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
              />
              {errors.templateName && (
                <p className="text-[11px] text-rose-500 mt-0.5 flex items-center gap-1">
                  <ShieldAlert className="w-3 h-3" /> {errors.templateName}
                </p>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Default Material / Case Type</label>
              <select
                value={caseTypeId}
                onChange={(e) => setCaseTypeId(e.target.value)}
                className="w-full p-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
              >
                {caseTypes.map((ct) => (
                  <option key={ct.id} value={ct.id}>
                    {ct.name} (PKR {ct.base_price.toLocaleString()})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Preset Shade</label>
              <input
                type="text"
                value={shade}
                onChange={(e) => setShade(e.target.value)}
                placeholder="A2, A3, BL2..."
                className="w-full p-2 text-xs bg-white border border-slate-200 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Default Priority</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as any)}
                className="w-full p-2 text-xs bg-white border border-slate-200 rounded-lg"
              >
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Preset Instructions</label>
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={2}
              placeholder="Default technician instructions..."
              className="w-full p-2 text-xs bg-white border border-slate-200 rounded-lg resize-none"
            />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="submit"
              className="px-4 py-1.5 bg-blue-600 text-white font-semibold text-xs rounded-lg shadow-xs hover:bg-blue-700"
            >
              Save Template Preset
            </button>
          </div>
        </form>
      )}

      {/* Template Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {filteredTemplates.length === 0 ? (
          <div className="col-span-2 text-center py-8 text-xs text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-200">
            No templates match your search criteria.
          </div>
        ) : (
          filteredTemplates.map((t) => (
            <div
              key={t.id}
              className="p-4 bg-white rounded-xl border border-slate-200 shadow-xs hover:border-blue-300 transition-all flex flex-col justify-between gap-3"
            >
              <div>
                <div className="flex items-center justify-between">
                  <span className="px-2 py-0.5 text-[10px] font-bold bg-blue-50 text-blue-700 rounded-full">
                    {t.case_type_name}
                  </span>
                  <button
                    onClick={() => {
                      if (confirm(`Delete template "${t.template_name}"?`)) deleteTemplate(t.id);
                    }}
                    className="text-slate-400 hover:text-rose-600 p-1 rounded"
                    title="Delete Template"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                <h3 className="font-bold text-sm text-slate-900 mt-2">{t.template_name}</h3>
                {t.description && <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{t.description}</p>}

                <div className="mt-3 text-[11px] text-slate-600 space-y-1 bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                  <div>
                    <span className="font-semibold">Preset Teeth:</span> FDI {t.selected_teeth.join(', ')}
                  </div>
                  <div>
                    <span className="font-semibold">Shade:</span> {t.shade || 'N/A'} • <span className="font-semibold">Priority:</span> {t.default_priority}
                  </div>
                  {t.instructions && (
                    <div className="line-clamp-1 italic text-slate-500 font-normal">"{t.instructions}"</div>
                  )}
                </div>
              </div>

              {onApplyTemplate && (
                <button
                  onClick={() => onApplyTemplate(t)}
                  className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs rounded-lg shadow-xs flex items-center justify-center gap-1.5 transition-colors"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Apply This Template to New Case</span>
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};
