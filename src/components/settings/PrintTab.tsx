import React, { useState } from 'react';
import {
  loadPrintSettings,
  savePrintSettings,
  loadDocumentSections,
  saveDocumentSections,
  PrintSettings,
} from '../../services/printSettings';
import { DocumentKind, PRINT_SECTIONS, DEFAULT_ENABLED } from '../print/printRenderer';
import { PrintSectionPicker } from '../common/PrintSectionPicker';
import { PreviewFrame } from '../common/ui';
import { useApp } from '../../context/AppContext';
import {
  CheckCircle2,
  Printer,
} from 'lucide-react';

/** Draft settings → the on-screen sheet, so the preview moves with the form. */
const MARGIN_MM: Record<PrintSettings['margin'], number> = { narrow: 8, normal: 12, wide: 18 };
const FONT_SCALE: Record<PrintSettings['fontSize'], number> = { compact: 0.88, normal: 1, large: 1.12 };
const PAPER_ASPECT: Record<PrintSettings['paper'], string> = { a4: '210 / 297', letter: '8.5 / 11' };

/** TAB: PRINT & DOCUMENTS — extracted verbatim from SettingsView (P3 split). */
export const PrintTab: React.FC = () => {
  const { brandingSettings } = useApp();
  const [printSettingsForm, setPrintSettingsForm] = useState<PrintSettings>(() => loadPrintSettings());
  const [printSaved, setPrintSaved] = useState(false);

  /* "What prints" per document kind — stored immediately (no Save needed), and
     read by the invoice dialog and batch printing, so paper always matches. */
  const [sectionKind, setSectionKind] = useState<DocumentKind>('invoice');
  const [docSections, setDocSections] = useState<Record<string, string[]>>(() => ({
    invoice: loadDocumentSections('invoice', DEFAULT_ENABLED.invoice),
    job_slip: loadDocumentSections('job_slip', DEFAULT_ENABLED.job_slip),
    receipt: loadDocumentSections('receipt', DEFAULT_ENABLED.receipt),
    statement: loadDocumentSections('statement', DEFAULT_ENABLED.statement),
  }));

  const handleSectionsChange = (next: string[]) => {
    setDocSections((prev) => ({ ...prev, [sectionKind]: next }));
    saveDocumentSections(sectionKind, next);
  };

  const handleSavePrintSettings = (e: React.FormEvent) => {
    e.preventDefault();
    savePrintSettings(printSettingsForm);
    setPrintSaved(true);
    setTimeout(() => setPrintSaved(false), 3000);
  };

  return (
    <div className="bg-white rounded-3xl border border-slate-200 shadow-xs p-6 space-y-5">
      <div className="flex items-center gap-2.5 pb-3 border-b border-slate-100">
        <div className="p-2.5 bg-slate-100 text-slate-600 rounded-2xl">
          <Printer className="w-5 h-5" />
        </div>
        <div>
          <h2 className="text-base font-bold text-slate-900">Print &amp; Documents</h2>
          <p className="text-xs text-slate-500">Global page layout plus the section list for every printed invoice, job slip, receipt and statement. The invoice print dialog edits the same stored list.</p>
        </div>
      </div>

      <form onSubmit={handleSavePrintSettings} className="space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Paper Size</label>
            <select
              value={printSettingsForm.paper}
              onChange={(e) => setPrintSettingsForm((p) => ({ ...p, paper: e.target.value as PrintSettings['paper'] }))}
              className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl font-bold"
            >
              <option value="a4">A4 (210 × 297 mm)</option>
              <option value="letter">US Letter (8.5 × 11 in)</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Page Margins</label>
            <select
              value={printSettingsForm.margin}
              onChange={(e) => setPrintSettingsForm((p) => ({ ...p, margin: e.target.value as PrintSettings['margin'] }))}
              className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl font-bold"
            >
              <option value="narrow">Narrow (8 mm)</option>
              <option value="normal">Normal (12 mm)</option>
              <option value="wide">Wide (18 mm)</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Text Size</label>
            <select
              value={printSettingsForm.fontSize}
              onChange={(e) => setPrintSettingsForm((p) => ({ ...p, fontSize: e.target.value as PrintSettings['fontSize'] }))}
              className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl font-bold"
            >
              <option value="compact">Compact</option>
              <option value="normal">Normal</option>
              <option value="large">Large</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Job Slip Style</label>
            <select
              value={printSettingsForm.jobSlipStyle}
              onChange={(e) => setPrintSettingsForm((p) => ({ ...p, jobSlipStyle: e.target.value as PrintSettings['jobSlipStyle'] }))}
              className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl font-bold"
            >
              <option value="compact">Compact tag (100 × 95 mm, 6-up on A4)</option>
              <option value="full">Full-page lab card (A4)</option>
            </select>
          </div>
        </div>

        {/* D8 — labelled, live layout preview. Built from the draft settings
            rather than embedding the real print renderer: a `.print-area` inside
            Settings would satisfy `body:has(.print-area)` and hijack the print
            isolation the document dialogs depend on. */}
        <PreviewFrame
          label="Layout preview"
          artefact={sectionKind === 'job_slip' ? 'job_slip' : sectionKind}
          hint={`${printSettingsForm.paper === 'letter' ? 'US Letter' : 'A4'} · ${MARGIN_MM[printSettingsForm.margin]} mm margins · ${printSettingsForm.fontSize} text · ${docSections[sectionKind]?.length ?? 0} sections`}
          bodyClassName="p-4 bg-slate-100"
        >
          <div className="flex justify-center">
            <div
              className="bg-white shadow-md border border-slate-200 w-full max-w-[280px] overflow-hidden"
              style={{
                aspectRatio: PAPER_ASPECT[printSettingsForm.paper],
                fontSize: `${FONT_SCALE[printSettingsForm.fontSize]}rem`,
              }}
            >
              <div
                className="h-full flex flex-col"
                style={{ padding: `${MARGIN_MM[printSettingsForm.margin] / 2.6}%` }}
              >
                <div
                  className={`flex items-center gap-1.5 pb-1 border-b border-slate-200 ${
                    printSettingsForm.logoPosition === 'center'
                      ? 'flex-col text-center'
                      : printSettingsForm.logoPosition === 'right'
                      ? 'flex-row-reverse text-right'
                      : ''
                  }`}
                >
                  {printSettingsForm.showLogo && (
                    brandingSettings?.logoUrl ? (
                      <img src={brandingSettings.logoUrl} alt="" className="w-4 h-4 object-contain shrink-0" />
                    ) : (
                      <span className="w-4 h-4 rounded bg-brand-600 text-white text-[6px] font-bold flex items-center justify-center shrink-0">
                        {(brandingSettings?.appName || 'DS').slice(0, 2).toUpperCase()}
                      </span>
                    )
                  )}
                  <div className="min-w-0">
                    <p className="text-[8px] font-bold text-slate-900 leading-tight truncate">
                      {brandingSettings?.lab_name || brandingSettings?.appName || 'Dental Solutions'}
                    </p>
                    {brandingSettings?.tagline && (
                      <p className="text-[6px] text-ink-muted uppercase tracking-wide truncate">
                        {brandingSettings.tagline}
                      </p>
                    )}
                  </div>
                </div>

                <p className="text-[7px] font-bold tracking-widest text-slate-500 mt-1">
                  {sectionKind === 'job_slip' ? 'DENTAL LAB JOB SLIP'
                    : sectionKind === 'invoice' ? 'INVOICE'
                    : sectionKind === 'receipt' ? 'PAYMENT RECEIPT'
                    : 'ACCOUNT STATEMENT'}
                </p>

                <ul className="mt-1 space-y-0.5 flex-1 min-h-0 overflow-hidden">
                  {PRINT_SECTIONS[sectionKind]
                    .filter((section) => (docSections[sectionKind] || []).includes(section.id))
                    .map((section) => (
                      <li
                        key={section.id}
                        className="flex items-center gap-1 text-[6px] text-slate-600 leading-tight"
                      >
                        <span className="w-0.5 h-0.5 rounded-full bg-slate-400 shrink-0" />
                        <span className="truncate">{section.label}</span>
                      </li>
                    ))}
                  {(docSections[sectionKind] || []).length === 0 && (
                    <li className="text-[6px] text-ink-danger font-semibold">
                      Nothing selected — this document would print blank.
                    </li>
                  )}
                </ul>

                <p className="text-[5px] text-ink-muted border-t border-slate-100 pt-0.5 truncate">
                  {brandingSettings?.phone || brandingSettings?.email || brandingSettings?.address || ''}
                </p>
              </div>
            </div>
          </div>
          <p className="mt-3 text-[11px] text-slate-500">
            Structure, paper shape, margin and text scale as this document will lay out. Sections
            appear in printed order; the real output adds the live case, patient and pricing data.
          </p>
        </PreviewFrame>

        <div className="pt-4 border-t border-slate-100 space-y-4">
          <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Logo on Printed Documents</h3>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={printSettingsForm.showLogo}
              onChange={(e) => setPrintSettingsForm((p) => ({ ...p, showLogo: e.target.checked }))}
              className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
            />
            <span className="text-xs font-bold text-slate-800">Print the lab logo on documents</span>
          </label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Logo Position</label>
              <select
                value={printSettingsForm.logoPosition}
                disabled={!printSettingsForm.showLogo}
                onChange={(e) => setPrintSettingsForm((p) => ({ ...p, logoPosition: e.target.value as PrintSettings['logoPosition'] }))}
                className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl font-bold disabled:opacity-50"
              >
                <option value="left">Left (letterhead style)</option>
                <option value="center">Centered above name</option>
                <option value="right">Right</option>
              </select>
            </div>
            <div className="flex items-end">
              <p className="text-[11px] text-slate-500">Upload or replace the logo itself in Branding &amp; Identity. Every invoice and job slip prints live from its own dialog.</p>
            </div>
            {printSettingsForm.logoPosition === 'right' && (
              <p className="md:col-span-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                Right placement mirrors the letterhead — logo right, contact block moves left.
              </p>
            )}
          </div>
        </div>

        <div className="pt-4 border-t border-slate-100 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
              Document Content — What Prints
            </h3>
            <span className="text-[10px] font-semibold text-slate-500">Saved automatically</span>
          </div>
          <p className="text-[11px] text-slate-500">
            Choose the sections that appear on each document. These lists are the same ones the
            print dialogs use — unticking a section here removes it from every future printout.
          </p>

          <div className="flex flex-wrap gap-1.5">
            {(['invoice', 'job_slip', 'receipt', 'statement'] as DocumentKind[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setSectionKind(k)}
                className={`rounded-xl border px-3.5 py-2 text-xs font-semibold transition-colors cursor-pointer ${
                  sectionKind === k
                    ? 'bg-brand-600 text-white border-brand-600'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                {k === 'job_slip' ? 'Job Slip' : k.charAt(0).toUpperCase() + k.slice(1)}
                <span className={sectionKind === k ? 'text-white/60' : 'text-ink-muted'}>
                  {' '}· {docSections[k]?.length ?? 0}/{PRINT_SECTIONS[k].length}
                </span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                saveDocumentSections(sectionKind, DEFAULT_ENABLED[sectionKind]);
                setDocSections((prev) => ({ ...prev, [sectionKind]: [...DEFAULT_ENABLED[sectionKind]] }));
              }}
              className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 cursor-pointer"
            >
              Restore all
            </button>
          </div>

          <PrintSectionPicker
            kind={sectionKind}
            value={docSections[sectionKind] || []}
            onChange={handleSectionsChange}
          />
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            className="px-5 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-bold text-xs rounded-xl shadow-md cursor-pointer"
          >
            Save Print Settings
          </button>
          {printSaved && (
            <span className="text-xs font-bold text-ink-success flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" /> Saved — applies to all documents
            </span>
          )}
        </div>
      </form>
    </div>
  );
};
