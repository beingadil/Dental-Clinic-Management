import { useTransientFlag } from '../common/useTransient';
import React, { useState, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { validateFile } from '../../services/fileValidation';
import { BRAND_SWATCHES, resolveBrandSwatch, applyBrandColor } from '../../services/brandingTheme';
import { PreviewFrame } from '../common/ui';
import {
  Check,
  Palette,
  Upload,
  Image as ImageIcon,
} from 'lucide-react';

/** TAB: BRANDING & IDENTITY — extracted verbatim from SettingsView (P3 split). */
export const BrandingTab: React.FC = () => {
  const { brandingSettings, updateBrandingSettings } = useApp();

  const [brandingForm, setBrandingForm] = useState(brandingSettings);
  const [saveSuccess, flashSaveSuccess] = useTransientFlag(3000);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const logo2InputRef = useRef<HTMLInputElement>(null);

  const handleBrandingChange = (key: keyof typeof brandingSettings, value: string) => {
    setBrandingForm((prev) => ({ ...prev, [key]: value }));
  };

  const draftSwatch = resolveBrandSwatch(brandingForm.primaryColor);
  const selectBrandColor = (hex: string) => {
    setBrandingForm((prev) => ({ ...prev, primaryColor: hex }));
    applyBrandColor(hex);
  };

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
    flashSaveSuccess();
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
            <Palette className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">Branding & Identity</h2>
            <p className="text-xs text-slate-500">Header, sidebar, case slips, and invoices — applied in real time</p>
          </div>
        </div>
        {saveSuccess && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-50 text-emerald-700 rounded-lg text-xs font-semibold border border-emerald-200 animate-in fade-in">
            <Check className="w-3.5 h-3.5 text-ink-success" /> Saved
          </div>
        )}
      </div>

      <form onSubmit={handleSaveBranding} className="p-6 space-y-8">
        {/* Section 1: Identity */}
        <section className="space-y-4">
          <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Identity</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Lab / Practice Name *</label>
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
              <label className="block text-xs font-bold text-slate-700 mb-1">Contact Phone</label>
              <input
                type="text"
                value={brandingForm.phone || ''}
                onChange={(e) => handleBrandingChange('phone', e.target.value)}
                placeholder="e.g. 0333-0473797"
                className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Contact Email</label>
              <input
                type="email"
                value={brandingForm.email || ''}
                onChange={(e) => handleBrandingChange('email', e.target.value)}
                placeholder="e.g. info@dentalsolutions.pk"
                className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-bold text-slate-700 mb-1">Physical Address</label>
              <input
                type="text"
                value={brandingForm.address || ''}
                onChange={(e) => handleBrandingChange('address', e.target.value)}
                placeholder="e.g. Batala Street Near Railway Park, Gill Road, Gujranwala."
                className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white"
              />
            </div>
          </div>
        </section>

        {/* Section 2: Logo */}
        <section className="space-y-4 pt-4 border-t border-slate-100">
          <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Logo</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Primary logo */}
            <div className="space-y-2">
              <label className="block text-xs font-bold text-slate-700 mb-1">Primary Logo</label>
              <div className="flex items-center gap-3">
                {brandingForm.logoUrl ? (
                  <img
                    src={brandingForm.logoUrl}
                    alt="Logo"
                    className="w-12 h-12 rounded-xl object-contain bg-slate-50 border border-slate-200 p-1 shrink-0"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-xl bg-slate-100 border-2 border-dashed border-slate-300 flex items-center justify-center text-ink-muted shrink-0">
                    <ImageIcon className="w-5 h-5" />
                  </div>
                )}
                <div className="space-y-1.5 flex-1">
                  <div className="flex items-center gap-2">
                    <input
                      ref={logoInputRef}
                      type="file"
                      accept="image/*"
                      onChange={(e) => handleLogoUpload(e, 'logoUrl')}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => logoInputRef.current?.click()}
                      className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold transition-all flex items-center gap-2 cursor-pointer"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>Upload</span>
                    </button>
                    {brandingForm.logoUrl && (
                      <button
                        type="button"
                        onClick={() => setBrandingForm((prev) => ({ ...prev, logoUrl: '' }))}
                        className="px-2 py-1.5 text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 rounded-lg cursor-pointer transition-colors"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  <input
                    type="text"
                    placeholder="Or paste logo URL"
                    value={brandingForm.logoUrl || ''}
                    onChange={(e) => handleBrandingChange('logoUrl', e.target.value)}
                    className="w-full p-2 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono"
                  />
                </div>
              </div>
              {logoError && (
                <p role="alert" className="text-xs text-rose-600 font-medium">{logoError}</p>
              )}
            </div>

            {/* Second logo */}
            <div className="space-y-2">
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Second Logo <span className="text-[10px] font-normal text-ink-muted">(optional — invoices)</span>
              </label>
              <div className="flex items-center gap-3">
                {brandingForm.logoUrl2 ? (
                  <img
                    src={brandingForm.logoUrl2}
                    alt="Second Logo"
                    className="w-12 h-12 rounded-xl object-contain bg-slate-50 border border-slate-200 p-1 shrink-0"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-xl bg-slate-100 border-2 border-dashed border-slate-300 flex items-center justify-center text-ink-muted shrink-0">
                    <ImageIcon className="w-5 h-5" />
                  </div>
                )}
                <div className="space-y-1.5 flex-1">
                  <div className="flex items-center gap-2">
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
                      className="px-3 py-1.5 bg-white hover:bg-slate-50 border border-slate-300 text-slate-800 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer"
                    >
                      <Upload className="w-3.5 h-3.5 text-indigo-600" />
                      <span>Upload</span>
                    </button>
                    {brandingForm.logoUrl2 && (
                      <button
                        type="button"
                        onClick={() => setBrandingForm((prev) => ({ ...prev, logoUrl2: '' }))}
                        className="px-2 py-1.5 text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 rounded-lg cursor-pointer transition-colors"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  <input
                    type="text"
                    placeholder="Or paste logo URL"
                    value={brandingForm.logoUrl2 || ''}
                    onChange={(e) => handleBrandingChange('logoUrl2', e.target.value)}
                    className="w-full p-2 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono"
                  />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Section 3: Brand accent */}
        <section className="space-y-4 pt-4 border-t border-slate-100">
          <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Brand Accent</h3>
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
                    alt="Logo"
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
        </section>

        {/* Section 4: Bank details */}
        <section className="space-y-4 pt-4 border-t border-slate-100">
          <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Bank Details for Billing Vouchers</h3>
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
        </section>

        <div className="flex justify-end pt-2">
          <button
            type="submit"
            className="px-5 py-2 ds-glass-pill font-semibold text-xs transition-colors flex items-center gap-2 cursor-pointer"
          >
            <Check className="w-4 h-4" />
            <span>Save Branding Settings</span>
          </button>
        </div>
      </form>
    </div>
  );
};