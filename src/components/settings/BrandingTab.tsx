import React, { useState, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import type { BrandingSettings } from '../../types';
import { validateFile } from '../../services/fileValidation';
import { BRAND_SWATCHES, resolveBrandSwatch, applyBrandColor } from '../../services/brandingTheme';
import { PreviewFrame } from '../common/ui';
import {
  Check,
  Palette,
  Upload,
  CreditCard,
  Image as ImageIcon,
  AlertTriangle,
} from 'lucide-react';

/** TAB: BRANDING & IDENTITY — extracted verbatim from SettingsView (P3 split). */
export const BrandingTab: React.FC = () => {
  const { brandingSettings, updateBrandingSettings } = useApp();

  const [brandingForm, setBrandingForm] = useState(brandingSettings);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const logo2InputRef = useRef<HTMLInputElement>(null);

  const handleBrandingChange = (key: keyof typeof brandingSettings, value: string) => {
    setBrandingForm((prev) => ({ ...prev, [key]: value }));
  };

  // D7 — the accent being edited. Picking a swatch repaints the live app
  // immediately (so the choice is judged in context, not in a swatch strip),
  // while Save is what persists it; boot always re-applies the stored value.
  const draftSwatch = resolveBrandSwatch(brandingForm.primaryColor);
  const selectBrandColor = (hex: string) => {
    setBrandingForm((prev) => ({ ...prev, primaryColor: hex }));
    applyBrandColor(hex);
  };

  // F11: logo validation via the shared helper — size + MIME (images only).
  // Errors surface inline (B6 voice) instead of alert().
  const [logoError, setLogoError] = useState<string>('');

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>, key: 'logoUrl' | 'logoUrl2' = 'logoUrl') => {
    const file = e.target.files?.[0];
    if (file) {
      const check = validateFile(file, { maxMB: 2, mimeAllow: ['image/'] });
      if (!check.ok) {
        setLogoError(check.error || 'Logo not accepted.');
        e.target.value = '';
        return;
      }
      setLogoError('');
      const reader = new FileReader();
      reader.onload = (event) => {
        const base64 = event.target?.result as string;
        setBrandingForm((prev) => ({ ...prev, [key]: base64 }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSaveBranding = (e: React.FormEvent) => {
    e.preventDefault();
    updateBrandingSettings(brandingForm);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-2xs p-5 space-y-6">
      <div className="flex items-center justify-between pb-4 border-b border-slate-100">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-slate-100 text-slate-700 rounded-lg">
            <Palette className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-900">Dashboard Branding & Identity</h2>
            <p className="text-xs text-slate-500">Changes update the header, navigation sidebar, case job slips, and invoices in real time</p>
          </div>
        </div>

        {saveSuccess && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-50 text-emerald-700 rounded-lg text-xs font-semibold border border-emerald-200 animate-in fade-in">
            <Check className="w-3.5 h-3.5 text-ink-success" /> Saved to Database!
          </div>
        )}
      </div>

      <form onSubmit={handleSaveBranding} className="space-y-6">
        {/* Live Preview — mirrors the real white header exactly (WYSIWYG,
            blank-safe: no fabricated contact details) */}
        <PreviewFrame
          label="Header preview"
          artefact="header"
          hint="Live — logo, name and accent"
          bodyClassName="p-4"
        >
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {brandingForm.logoUrl ? (
            <img
              src={brandingForm.logoUrl}
              alt="Logo Preview"
              className="w-8 h-8 rounded-xl object-contain bg-slate-100 p-0.5 border border-slate-200 shrink-0"
            />
          ) : (
            <div className="w-8 h-8 rounded-xl bg-brand-600 text-white font-bold flex items-center justify-center text-xs shrink-0">
              {brandingForm.appName ? brandingForm.appName.substring(0, 2).toUpperCase() : 'DS'}
            </div>
          )}
          <div>
            <span className="text-sm font-bold text-slate-900 block">{brandingForm.appName || 'Dental Solutions'}</span>
            {brandingForm.tagline && (
              <span className="text-[10px] font-semibold text-ink-muted block uppercase tracking-wider">{brandingForm.tagline}</span>
            )}
          </div>
        </div>

        {(brandingForm.phone || brandingForm.email) && (
          <div className="text-right text-xs text-slate-500 hidden md:block border-l border-slate-200 pl-4">
            {brandingForm.phone && <p>{brandingForm.phone}</p>}
            {brandingForm.email && <p className="text-[11px] text-ink-muted">{brandingForm.email}</p>}
          </div>
        )}
      </div>
        </PreviewFrame>

        {/* D7 — the accent. Fixed swatches only: every one is contrast-checked
            for white text, and an unknown stored value falls back to indigo. */}
        <PreviewFrame
          label="Brand accent"
          hint="On-screen app chrome only — print ink never changes"
        >
          <div role="radiogroup" aria-label="Brand accent colour" className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {BRAND_SWATCHES.map((swatch) => {
              const selected = draftSwatch.id === swatch.id;
              return (
                <button
                  key={swatch.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={`${swatch.name} accent`}
                  onClick={() => selectBrandColor(swatch.hex)}
                  className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-all cursor-pointer ${
                    selected
                      ? 'border-brand-600 ring-2 ring-brand-600/25 bg-brand-50'
                      : 'border-slate-200 bg-white hover:bg-slate-50'
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className="w-6 h-6 rounded-lg shrink-0 border border-black/10 shadow-2xs"
                    style={{ backgroundColor: swatch.tokens['600'] }}
                  />
                  <span className="min-w-0">
                    <span className="block text-xs font-bold text-slate-900">{swatch.name}</span>
                    <span className="block text-[11px] text-slate-500 truncate">{swatch.note}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <p className="mt-3 text-[11px] text-slate-500">
            Every swatch is contrast-checked for white text on its solid shade (WCAG AA, at least
            4.5:1). The accent paints the app's own chrome; printed invoices, job slips and
            statements keep their existing ink.
          </p>
        </PreviewFrame>

        {/* Logo Upload Section */}
      <div className="space-y-3">
        <label className="block text-xs font-bold text-slate-800 uppercase tracking-wider">Dashboard Logo</label>
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
          {brandingForm.logoUrl ? (
            <div className="relative group">
              <img
                src={brandingForm.logoUrl}
                alt="Current Logo"
                className="w-16 h-16 rounded-full object-contain bg-slate-50 border border-slate-200 p-1 shadow-xs"
              />
              <button
                type="button"
                onClick={() => setBrandingForm((prev) => ({ ...prev, logoUrl: '' }))}
                className="absolute -top-2 -right-2 w-5 h-5 bg-fill-danger text-white rounded-full text-xs font-bold flex items-center justify-center shadow-md hover:bg-rose-600 cursor-pointer"
                title="Remove Logo"
              >
                ×
              </button>
            </div>
          ) : (
            <div className="w-16 h-16 rounded-2xl bg-slate-100 border-2 border-dashed border-slate-300 flex flex-col items-center justify-center text-ink-muted shrink-0">
              <ImageIcon className="w-6 h-6" />
              <span className="text-[9px] font-bold mt-1">No Logo</span>
            </div>
          )}

          <div className="space-y-2 flex-1 w-full">
            {logoError && (
              <p role="alert" className="text-xs text-ink-danger font-medium">{logoError}</p>
            )}
            <div className="flex items-center gap-2 flex-wrap">
              <input
                ref={logoInputRef}
                type="file"
                accept="image/*"
                onChange={handleLogoUpload}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => logoInputRef.current?.click()}
                className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer shadow-xs"
              >
                <Upload className="w-4 h-4 text-indigo-400" />
                <span>Upload Logo Image</span>
              </button>
            </div>

            <div>
              <input
                type="text"
                placeholder="Or enter direct Logo URL (https://...)"
                value={brandingForm.logoUrl || ''}
                onChange={(e) => handleBrandingChange('logoUrl', e.target.value)}
                className="w-full p-2 text-xs bg-slate-50 border border-slate-200 rounded-xl font-mono"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Second Logo — optional, printed on the right of the letterhead on
          invoices, receipts and statements (e.g. partner / B2B mark). */}
      <div className="space-y-3">
        <label className="block text-xs font-bold text-slate-800 uppercase tracking-wider">
          Second Logo <span className="font-medium normal-case tracking-normal text-ink-muted">(optional — printed on invoices)</span>
        </label>
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
          {brandingForm.logoUrl2 ? (
            <div className="relative group">
              <img
                src={brandingForm.logoUrl2}
                alt="Second Logo"
                className="w-16 h-16 rounded-2xl object-contain bg-slate-50 border border-slate-200 p-1 shadow-xs"
              />
              <button
                type="button"
                onClick={() => setBrandingForm((prev) => ({ ...prev, logoUrl2: '' }))}
                className="absolute -top-2 -right-2 w-5 h-5 bg-fill-danger text-white rounded-full text-xs font-bold flex items-center justify-center shadow-md hover:bg-rose-600 cursor-pointer"
                title="Remove second logo"
              >
                ×
              </button>
            </div>
          ) : (
            <div className="w-16 h-16 rounded-2xl bg-slate-100 border-2 border-dashed border-slate-300 flex flex-col items-center justify-center text-ink-muted shrink-0">
              <ImageIcon className="w-6 h-6" />
              <span className="text-[9px] font-bold mt-1">Empty</span>
            </div>
          )}

          <div className="space-y-2 flex-1 w-full">
            <div className="flex items-center gap-2 flex-wrap">
              <input
                ref={logo2InputRef}
                type="file"
                accept="image/*"
                onChange={(e) => handleLogoUpload(e, 'logoUrl2')}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => logo2InputRef.current?.click()}
                className="px-3.5 py-2 bg-white hover:bg-slate-50 border border-slate-300 text-slate-800 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer shadow-2xs"
              >
                <Upload className="w-4 h-4 text-indigo-600" />
                <span>Upload Second Logo</span>
              </button>
            </div>

            <input
              type="text"
              placeholder="Or enter direct logo URL (https://...)"
              value={brandingForm.logoUrl2 || ''}
              onChange={(e) => handleBrandingChange('logoUrl2', e.target.value)}
              className="w-full p-2 text-xs bg-slate-50 border border-slate-200 rounded-xl font-mono"
            />
          </div>
        </div>
      </div>

      {/* Form Inputs */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1">Dashboard / Lab Title *</label>
          <input
            type="text"
            value={brandingForm.appName}
            onChange={(e) => handleBrandingChange('appName', e.target.value)}
            placeholder="e.g. Dental Solutions"
            className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-indigo-500/20 font-semibold"
            required
          />
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1">Tagline / Subtitle</label>
          <input
            type="text"
            value={brandingForm.tagline}
            onChange={(e) => handleBrandingChange('tagline', e.target.value)}
            placeholder="e.g. Serving Smiles • Digital Dental Laboratory"
            className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white"
          />
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1">Official Contact Phone</label>
          <input
            type="text"
            value={brandingForm.phone || ''}
            onChange={(e) => handleBrandingChange('phone', e.target.value)}
            placeholder="e.g. 0333-0473797"
            className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white font-mono"
          />
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1">Official Email Address</label>
          <input
            type="email"
            value={brandingForm.email || ''}
            onChange={(e) => handleBrandingChange('email', e.target.value)}
            placeholder="e.g. info@dentalsolutions.pk"
            className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white"
          />
        </div>

        <div className="md:col-span-2">
          <label className="block text-xs font-bold text-slate-700 mb-1">Laboratory Physical Address</label>
          <input
            type="text"
            value={brandingForm.address || ''}
            onChange={(e) => handleBrandingChange('address', e.target.value)}
            placeholder="e.g. Batala Street Near Railway Park, Gill Road, Gujranwala."
            className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white"
          />
        </div>
      </div>

      {/* Bank Details for Billing Vouchers */}
      <div className="pt-4 border-t border-slate-100 space-y-3">
        <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
          <CreditCard className="w-4 h-4 text-indigo-600" /> Bank Details for Billing Vouchers
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Bank Name</label>
            <input
              type="text"
              value={brandingForm.bankName || ''}
              onChange={(e) => handleBrandingChange('bankName', e.target.value)}
              placeholder="e.g. Meezan Bank Ltd"
              className="w-full p-2 text-xs bg-slate-50 border border-slate-200 rounded-xl"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Account Title</label>
            <input
              type="text"
              value={brandingForm.bankAccountTitle || ''}
              onChange={(e) => handleBrandingChange('bankAccountTitle', e.target.value)}
              placeholder="e.g. Dental Solutions Lab"
              className="w-full p-2 text-xs bg-slate-50 border border-slate-200 rounded-xl"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Account Number</label>
            <input
              type="text"
              value={brandingForm.bankAccountNumber || ''}
              onChange={(e) => handleBrandingChange('bankAccountNumber', e.target.value)}
              placeholder="e.g. 01020304050607"
              className="w-full p-2 text-xs bg-slate-50 border border-slate-200 rounded-xl font-mono"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">IBAN Number</label>
            <input
              type="text"
              value={brandingForm.bankIban || ''}
              onChange={(e) => handleBrandingChange('bankIban', e.target.value)}
              placeholder="e.g. PK36MEZN00010203..."
              className="w-full p-2 text-xs bg-slate-50 border border-slate-200 rounded-xl font-mono"
            />
          </div>
        </div>
      </div>

      {/* Workstation Visual Warning & Div Highlighting Settings */}
      <div className="pt-6 border-t border-slate-100 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 text-ink-danger" />
              Workstation 24-Hour Due Date Warning & Div Highlighting System
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Configure how cases approaching due dates are visually highlighted across Kanban cards and Table View rows
            </p>
          </div>

          {/* Toggle Switch */}
          <label className="flex items-center gap-2 cursor-pointer select-none self-start sm:self-auto bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200">
            <input
              type="checkbox"
              checked={brandingForm.enable24hWarning !== false}
              onChange={(e) => setBrandingForm((prev) => ({ ...prev, enable24hWarning: e.target.checked }))}
              className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
            />
            <span className="text-xs font-bold text-slate-800">Enable 24h Red Warning</span>
          </label>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Warning Threshold Hours */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Warning Threshold (Hours Before Due)
            </label>
            <select
              value={brandingForm.warningThresholdHours ?? 24}
              onChange={(e) => setBrandingForm((prev) => ({ ...prev, warningThresholdHours: Number(e.target.value) }))}
              className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-800 focus:bg-white"
            >
              <option value={12}>12 Hours (Urgent Same-Day)</option>
              <option value={24}>24 Hours (Next Day Due - Standard)</option>
              <option value={36}>36 Hours (1.5 Days)</option>
              <option value={48}>48 Hours (2 Days Lead Time)</option>
              <option value={72}>72 Hours (3 Days Lead Time)</option>
            </select>
          </div>

          {/* Warning Highlight Color Theme */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Highlight Color Theme
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              {[
                { id: 'rose', name: 'Rose Red', bg: 'bg-rose-600' },
                { id: 'red', name: 'Crimson', bg: 'bg-red-600' },
                { id: 'amber', name: 'Amber', bg: 'bg-fill-warning' },
                { id: 'purple', name: 'Purple', bg: 'bg-purple-600' },
                { id: 'indigo', name: 'Indigo', bg: 'bg-indigo-600' },
                { id: 'emerald', name: 'Emerald', bg: 'bg-fill-success' },
              ].map((clr) => (
                <button
                  type="button"
                  key={clr.id}
                  onClick={() => setBrandingForm((prev) => ({ ...prev, warningHighlightColor: clr.id as any }))}
                  className={`p-2 rounded-xl text-[10px] font-bold flex items-center justify-center gap-1.5 border cursor-pointer transition-all ${
                    (brandingForm.warningHighlightColor || 'rose') === clr.id
                      ? 'border-slate-900 ring-2 ring-slate-900/20 bg-slate-100 font-extrabold text-slate-900'
                      : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <span className={`w-2.5 h-2.5 rounded-full ${clr.bg}`} />
                  <span>{clr.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Highlight Visual Style Mode */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Highlight Visual Style
            </label>
            <select
              value={brandingForm.warningHighlightStyle || 'border'}
              onChange={(e) => setBrandingForm((prev) => ({ ...prev, warningHighlightStyle: e.target.value as any }))}
              className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-800 focus:bg-white"
            >
              <option value="border">Border Glow + Animated Icon</option>
              <option value="solid">Solid Banner Top Header</option>
              <option value="badge">Pulsing Warning Tag Badge</option>
              <option value="full">Full Highlight Background Fill</option>
            </select>
          </div>
        </div>

        {/* Custom Div Card Background Color */}
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1">
            Workstation Card Background Tint
          </label>
          <div className="flex flex-wrap items-center gap-2.5">
            {[
              { code: '#ffffff', label: 'Pure White' },
              { code: '#f8fafc', label: 'Soft Slate' },
              { code: '#fefcfb', label: 'Warm Ivory' },
              { code: '#f0f9ff', label: 'Cool Cyan' },
              { code: '#f5f3ff', label: 'Soft Lavender' },
            ].map((preset) => (
              <button
                type="button"
                key={preset.code}
                onClick={() => setBrandingForm((prev) => ({ ...prev, cardBgColor: preset.code }))}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-2 border cursor-pointer transition-all ${
                  (brandingForm.cardBgColor || '#ffffff') === preset.code
                    ? 'border-indigo-600 ring-2 ring-indigo-600/30 font-bold bg-white text-indigo-900'
                    : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                }`}
              >
                <span className="w-3.5 h-3.5 rounded-full border border-slate-300 shadow-xs shrink-0" style={{ backgroundColor: preset.code }} />
                <span>{preset.label}</span>
              </button>
            ))}
            <div className="flex items-center gap-1.5 bg-slate-50 p-1 rounded-xl border border-slate-200">
              <span className="text-[11px] font-bold text-slate-500 pl-2">Custom:</span>
              <input
                type="color"
                value={brandingForm.cardBgColor || '#ffffff'}
                onChange={(e) => setBrandingForm((prev) => ({ ...prev, cardBgColor: e.target.value }))}
                className="w-7 h-7 rounded-lg cursor-pointer border-0 p-0"
                title="Custom Color"
              />
            </div>
          </div>
        </div>
      </div>

        {/* LIVE CARD PREVIEW IN SETTINGS */}
        <PreviewFrame
          label="Live workstation card highlighting"
          artefact="card"
          surface="dark"
          className="mt-3"
          bodyClassName="p-4"
          hint={<>Threshold: <strong className="text-white">{brandingForm.warningThresholdHours || 24} Hours</strong></>}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-slate-900">
            {/* Normal Card Preview */}
            <div
              className="rounded-2xl p-3.5 border border-slate-200 shadow-xs space-y-2"
              style={{ backgroundColor: brandingForm.cardBgColor || '#ffffff' }}
            >
              <div className="flex items-center justify-between text-xs font-bold text-slate-800">
                <span>DS-0042 • Normal Case</span>
                <span className="px-1.5 py-0.5 rounded text-[9px] bg-slate-100 text-slate-600 uppercase font-semibold">Normal</span>
              </div>
              <p className="text-[11px] text-slate-600">Zirconia Crown (A2) • Dr. Tariq</p>
              <p className="text-[10px] text-ink-muted font-mono">Due: 2026-08-10 (Standard Lead Time)</p>
            </div>

            {/* Warning Highlighted Card Preview */}
            <div
              className={`rounded-2xl p-3.5 border shadow-md space-y-2 relative transition-all ${
                (brandingForm.warningHighlightColor || 'rose') === 'rose'
                  ? 'border-rose-500 ring-2 ring-rose-500/40'
                  : (brandingForm.warningHighlightColor) === 'red'
                  ? 'border-red-600 ring-2 ring-red-600/40'
                  : (brandingForm.warningHighlightColor) === 'amber'
                  ? 'border-amber-500 ring-2 ring-amber-500/40'
                  : (brandingForm.warningHighlightColor) === 'purple'
                  ? 'border-purple-500 ring-2 ring-purple-500/40'
                  : (brandingForm.warningHighlightColor) === 'indigo'
                  ? 'border-indigo-500 ring-2 ring-indigo-500/40'
                  : 'border-emerald-500 ring-2 ring-emerald-500/40'
              }`}
              style={{
                backgroundColor: brandingForm.warningHighlightStyle === 'full'
                  ? ((brandingForm.warningHighlightColor || 'rose') === 'rose' ? '#fff1f2' : '#fef2f2')
                  : (brandingForm.cardBgColor || '#ffffff')
              }}
            >
              {brandingForm.warningHighlightStyle === 'solid' && (
                <div className="bg-rose-600 text-white text-[10px] font-bold px-2.5 py-1 rounded-t-xl -mx-3.5 -mt-3.5 mb-2 flex items-center justify-between">
                  <span>DUE WITHIN {brandingForm.warningThresholdHours || 24} HOURS</span>
                  <span className="uppercase text-[9px] bg-white/20 px-1.5 py-0.2 rounded">URGENT</span>
                </div>
              )}

              <div className="flex items-center justify-between text-xs font-bold text-slate-900">
                <div className="flex items-center gap-1.5">
                  <span>DS-0018 • High Priority</span>
                  <AlertTriangle className="w-3.5 h-3.5 text-ink-danger animate-bounce" />
                </div>
                <span className="px-2 py-0.5 rounded-md text-[9px] font-extrabold bg-rose-600 text-white uppercase shadow-xs">
                  DUE IN 8H
                </span>
              </div>

              <p className="text-[11px] text-slate-700 font-semibold">E-max Veneers (BL2) • Dr. Ayesha</p>

              <div className="flex items-center justify-between text-[11px] font-extrabold text-rose-700 pt-1.5 border-t border-rose-100">
                <span>⏰ Due Today (Expires Soon)</span>
                <span className="text-[10px] underline">Fast-Track QC</span>
              </div>
            </div>
          </div>
        </PreviewFrame>

        <div className="flex justify-end pt-2">
          <button
            type="submit"
            className="px-5 py-2 bg-brand-600 hover:bg-brand-700 text-white font-semibold rounded-lg text-xs shadow-2xs transition-colors flex items-center gap-2 cursor-pointer"
          >
            <Check className="w-4 h-4" />
            <span>Save Branding Settings</span>
          </button>
        </div>
      </form>
    </div>
  );
}
