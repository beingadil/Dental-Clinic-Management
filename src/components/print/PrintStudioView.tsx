import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { DentalCase, Invoice } from '../../types';
import { printTemplatesRepo } from '../../db/repos';
import {
  DocumentKind,
  PRINT_SECTIONS,
  DEFAULT_ENABLED,
  PrintDocument,
} from './printRenderer';
import './printStyles.css';
import { loadPrintSettings, PrintSettings } from '../../services/printSettings';
import {
  Printer,
  Save,
  RotateCcw,
  FileText,
  Receipt,
  Banknote,
  ScrollText,
  X,
} from 'lucide-react';

const KIND_META: { id: DocumentKind; label: string; icon: React.ReactNode }[] = [
  { id: 'job_slip', label: 'Job Slip', icon: <FileText className="w-3.5 h-3.5" /> },
  { id: 'invoice', label: 'Invoice', icon: <Receipt className="w-3.5 h-3.5" /> },
  { id: 'receipt', label: 'Receipt', icon: <Banknote className="w-3.5 h-3.5" /> },
  { id: 'statement', label: 'Statement', icon: <ScrollText className="w-3.5 h-3.5" /> },
];

type TemplateMap = Partial<Record<DocumentKind, { name: string; sections: string[] }[]>>;

/** Legacy localStorage key — imported into SQLite once, then removed. */
const LEGACY_STORE_KEY = 'dentlab_print_templates_v1';

function repoToMap(): TemplateMap {
  try {
    const map: TemplateMap = {};
    for (const t of printTemplatesRepo.all()) {
      const kind = t.kind as DocumentKind;
      (map[kind] ||= []).push({ name: t.name, sections: t.sections });
    }
    return map;
  } catch {
    return {};
  }
}

function importLegacyTemplates(): TemplateMap | null {
  try {
    const legacy = localStorage.getItem(LEGACY_STORE_KEY);
    if (!legacy) return null;
    const map = JSON.parse(legacy) as TemplateMap;
    const existing = new Set(printTemplatesRepo.all().map((t) => `${t.kind}::${t.name}`));
    let imported = 0;
    for (const [kind, list] of Object.entries(map)) {
      for (const t of list || []) {
        if (existing.has(`${kind}::${t.name}`)) continue;
        try {
          printTemplatesRepo.insert({ kind, name: t.name, sections: t.sections });
          imported++;
        } catch { /* skip unusable rows */ }
      }
    }
    localStorage.removeItem(LEGACY_STORE_KEY);
    return imported > 0 ? repoToMap() : null;
  } catch {
    return null;
  }
}

export const PrintStudioView: React.FC = () => {
  const { cases, invoices, labs, brandingSettings } = useApp();

  const [printSettings] = useState<PrintSettings>(() => loadPrintSettings());
  const [kind, setKind] = useState<DocumentKind>('job_slip');
  const [templates, setTemplates] = useState<TemplateMap>({});
  const [enabled, setEnabled] = useState<string[]>(DEFAULT_ENABLED.job_slip);

  const [caseId, setCaseId] = useState<string>('');
  const [invoiceId, setInvoiceId] = useState<string>('');

  const [saveOpen, setSaveOpen] = useState(false);
  const [templateName, setTemplateName] = useState('');

  useEffect(() => {
    setEnabled(DEFAULT_ENABLED[kind]);
  }, [kind]);

  // Hydrate from SQLite; import legacy localStorage templates exactly once.
  useEffect(() => {
    setTemplates(importLegacyTemplates() ?? repoToMap());
  }, []);

  const selectedCase: DentalCase | null = useMemo(
    () => cases.find((c) => c.id === caseId) || cases[0] || null,
    [cases, caseId]
  );

  const selectedInvoice: Invoice | null = useMemo(() => {
    if (invoiceId) return invoices.find((i) => i.id === invoiceId) || null;
    if (selectedCase) {
      return invoices.find((i) => i.case_id === selectedCase.id || i.case_number === selectedCase.case_number) || invoices[0] || null;
    }
    return invoices[0] || null;
  }, [invoices, invoiceId, selectedCase]);

  const toggleSection = (id: string) => {
    setEnabled((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const saveTemplate = () => {
    if (!templateName.trim()) return;
    try {
      printTemplatesRepo.insert({ kind, name: templateName.trim(), sections: enabled });
      setTemplates(repoToMap());
    } catch {
      // DB unavailable — keep the modal usable rather than crashing
    }
    setTemplateName('');
    setSaveOpen(false);
  };

  const applyTemplate = (sections: string[]) => setEnabled(sections);

  const deleteTemplate = (name: string) => {
    try {
      const row = printTemplatesRepo.all().find((t) => t.kind === kind && t.name === name);
      if (row) printTemplatesRepo.delete(row.id);
      setTemplates(repoToMap());
    } catch {
      // DB unavailable
    }
  };

  const handlePrint = () => window.print();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-2xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
            {brandingSettings.appName || 'Dental Solutions'} • Print Studio
          </span>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 mt-0.5">Print Studio</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Configure exactly what appears on job slips, invoices, receipts, and statements — then print.
          </p>
        </div>
        <button
          onClick={handlePrint}
          className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold shadow-2xs flex items-center gap-1.5 cursor-pointer shrink-0"
        >
          <Printer className="w-3.5 h-3.5" /> Print {KIND_META.find((k) => k.id === kind)?.label}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left: configuration */}
        <div className="lg:col-span-5 space-y-4">
          {/* Document type */}
          <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-2xs">
            <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2.5">Document Type</h3>
            <div className="grid grid-cols-4 gap-1.5">
              {KIND_META.map((k) => (
                <button
                  key={k.id}
                  onClick={() => setKind(k.id)}
                  className={`flex flex-col items-center gap-1 py-2.5 rounded-lg border text-[11px] font-bold transition-colors cursor-pointer ${
                    kind === k.id
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {k.icon}
                  {k.label}
                </button>
              ))}
            </div>
          </div>

          {/* Data source */}
          <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-2xs space-y-3">
            <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Preview Data</h3>
            {(kind === 'job_slip') && (
              <select
                value={caseId || selectedCase?.id || ''}
                onChange={(e) => setCaseId(e.target.value)}
                className="w-full p-2 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-slate-400"
              >
                {cases.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.case_number} — {c.patient_name || 'Unnamed'} ({c.case_type_name})
                  </option>
                ))}
              </select>
            )}
            {(kind === 'invoice' || kind === 'receipt' || kind === 'statement') && (
              <select
                value={invoiceId || selectedInvoice?.id || ''}
                onChange={(e) => setInvoiceId(e.target.value)}
                className="w-full p-2 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-slate-400"
              >
                {invoices.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.invoice_number} — {i.lab_name} ({i.payment_status})
                  </option>
                ))}
              </select>
            )}
            <p className="text-[10px] text-slate-400">
              The printed document always uses this record — switching here re-renders the preview instantly.
            </p>
          </div>

          {/* Sections */}
          <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-2xs">
            <div className="flex items-center justify-between mb-2.5">
              <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Sections on Printout</h3>
              <button
                onClick={() => setEnabled(DEFAULT_ENABLED[kind])}
                className="text-[10px] font-bold text-slate-400 hover:text-slate-700 inline-flex items-center gap-1 cursor-pointer"
                title="Reset to all sections"
              >
                <RotateCcw className="w-3 h-3" /> Reset
              </button>
            </div>
            <div className="space-y-1.5">
              {PRINT_SECTIONS[kind].map((s) => {
                const isOn = enabled.includes(s.id);
                return (
                  <label
                    key={s.id}
                    className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                      isOn ? 'bg-indigo-50/60 border-indigo-200' : 'bg-white border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <input
                        type="checkbox"
                        checked={isOn}
                        onChange={() => toggleSection(s.id)}
                        className="w-3.5 h-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer shrink-0"
                      />
                      <span className="min-w-0">
                        <span className="block text-xs font-bold text-slate-800 truncate">{s.label}</span>
                        <span className="block text-[10px] text-slate-400 truncate">{s.hint}</span>
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Templates */}
          <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-2xs">
            <div className="flex items-center justify-between mb-2.5">
              <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Saved Templates ({KIND_META.find((k) => k.id === kind)?.label})</h3>
              <button
                onClick={() => { setTemplateName(''); setSaveOpen(true); }}
                className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-[10px] font-bold inline-flex items-center gap-1 cursor-pointer"
              >
                <Save className="w-3 h-3" /> Save Current
              </button>
            </div>
            {(templates[kind] || []).length === 0 ? (
              <p className="text-[11px] text-slate-400">No saved templates for this document type yet.</p>
            ) : (
              <div className="space-y-1.5">
                {(templates[kind] || []).map((t) => (
                  <div key={t.name} className="flex items-center justify-between px-3 py-2 rounded-lg border border-slate-200 bg-white">
                    <button onClick={() => applyTemplate(t.sections)} className="text-xs font-bold text-slate-700 hover:text-indigo-700 cursor-pointer text-left truncate">
                      {t.name} <span className="text-[10px] font-normal text-slate-400">({t.sections.length} sections)</span>
                    </button>
                    <button onClick={() => deleteTemplate(t.name)} className="text-slate-300 hover:text-rose-600 cursor-pointer p-1" title="Delete template">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: live preview */}
        <div className="lg:col-span-7">
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
            <div className="px-4 py-2.5 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-800">Live Preview</h3>
              <span className="text-[10px] text-slate-400 font-semibold">
                {enabled.length}/{PRINT_SECTIONS[kind].length} sections
              </span>
            </div>
            <div className="print-preview-shell">
              <div className={printSettings.paper === 'letter' ? 'print-preview-page paper-letter' : 'print-preview-page'}>
                <div className="print-area">
                  <PrintDocument
                    kind={kind}
                    sections={enabled}
                    branding={brandingSettings}
                    printSettings={printSettings}
                    caseData={selectedCase}
                    invoice={selectedInvoice}
                    labName={selectedInvoice?.lab_name || labs[0]?.name}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Save template modal */}
      {saveOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-sm w-full p-5 border border-slate-200 shadow-xl space-y-3">
            <h3 className="text-sm font-bold text-slate-900">Save Print Template</h3>
            <input
              type="text"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              placeholder="e.g. Minimal Job Slip"
              className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:border-slate-400 text-slate-900"
              autoFocus
            />
            <p className="text-[10px] text-slate-400">Saves the current {enabled.length}-section selection for {KIND_META.find((k) => k.id === kind)?.label} documents.</p>
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setSaveOpen(false)} className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold cursor-pointer">Cancel</button>
              <button
                onClick={saveTemplate}
                disabled={!templateName.trim()}
                className="px-4 py-1.5 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-400 text-white rounded-lg text-xs font-bold cursor-pointer transition-colors"
              >
                Save Template
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
