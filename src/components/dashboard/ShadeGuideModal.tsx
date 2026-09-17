import React, { useState } from 'react';
import { X, Sparkles, Check, Copy, Info, CheckCircle2 } from 'lucide-react';

interface ShadeGuideModalProps {
  onClose: () => void;
  onSelectShade?: (shade: string) => void;
}

interface ShadeItem {
  code: string;
  group: 'A' | 'B' | 'C' | 'D' | 'BL';
  name: string;
  hex: string;
  rgb: string;
  hue: string;
  translucency: string;
  recommendedFor: string;
}

const SHADES: ShadeItem[] = [
  // Bleach Shades
  { code: 'BL1', group: 'BL', name: 'Bleach 1 (Ultra White)', hex: '#FCFBF7', rgb: '252, 251, 247', hue: 'High Value Hollywood White', translucency: '57% (High Translucent)', recommendedFor: 'Veneers, Anterior Hollywood Smiles' },
  { code: 'BL2', group: 'BL', name: 'Bleach 2 (Super White)', hex: '#FAF7EE', rgb: '250, 247, 238', hue: 'Extra Light Natural Bleach', translucency: '55%', recommendedFor: 'Full Arch Monolithic Zirconia' },
  { code: 'BL3', group: 'BL', name: 'Bleach 3 (Natural White)', hex: '#F7F3E3', rgb: '247, 243, 227', hue: 'Light Aesthetic White', translucency: '52%', recommendedFor: 'Anterior & Posterior Crowns' },
  { code: 'BL4', group: 'BL', name: 'Bleach 4 (Soft Bleach)', hex: '#F3EEDB', rgb: '243, 238, 219', hue: 'Soft Bleached Enamel', translucency: '49%', recommendedFor: 'E-max & Multi-layer Zirconia' },

  // Group A (Reddish-Brownish)
  { code: 'A1', group: 'A', name: 'A1 (Light Red-Brown)', hex: '#F5EEDB', rgb: '245, 238, 219', hue: 'Reddish-Brownish Light', translucency: '49%', recommendedFor: 'Young Patients Anterior Restorations' },
  { code: 'A2', group: 'A', name: 'A2 (Universal Natural)', hex: '#EFE2C6', rgb: '239, 226, 198', hue: 'Standard Universal Enamel', translucency: '46%', recommendedFor: 'Most Popular Natural Match (45% of cases)' },
  { code: 'A3', group: 'A', name: 'A3 (Medium Red-Brown)', hex: '#E7D5B2', rgb: '231, 213, 178', hue: 'Medium Reddish-Brown', translucency: '43%', recommendedFor: 'Adult Posterior & Anterior Crowns' },
  { code: 'A3.5', group: 'A', name: 'A3.5 (Deep Red-Brown)', hex: '#DFC49B', rgb: '223, 196, 155', hue: 'Deep Warm Red-Brown', translucency: '41%', recommendedFor: 'Mature Dentition & Canine Matching' },
  { code: 'A4', group: 'A', name: 'A4 (Dark Red-Brown)', hex: '#D2B386', rgb: '210, 179, 134', hue: 'Dark Reddish-Brown', translucency: '39%', recommendedFor: 'Deeply Stained / Sclerotic Teeth' },

  // Group B (Reddish-Yellowish)
  { code: 'B1', group: 'B', name: 'B1 (Light Yellow-Red)', hex: '#F7F1D8', rgb: '247, 241, 216', hue: 'Light Reddish-Yellow', translucency: '51%', recommendedFor: 'High Value Anterior Veneers' },
  { code: 'B2', group: 'B', name: 'B2 (Natural Yellow)', hex: '#F0E5BE', rgb: '240, 229, 190', hue: 'Warm Yellowish-White', translucency: '47%', recommendedFor: 'Natural Incisor Restorations' },
  { code: 'B3', group: 'B', name: 'B3 (Medium Yellow)', hex: '#E8D6A4', rgb: '232, 214, 164', hue: 'Medium Reddish-Yellow', translucency: '44%', recommendedFor: 'Premolar & Molar PFM/Zirconia' },
  { code: 'B4', group: 'B', name: 'B4 (Warm Deep Yellow)', hex: '#DFC38B', rgb: '223, 195, 139', hue: 'Deep Warm Yellow', translucency: '40%', recommendedFor: 'Cervical Matching & Older Adults' },

  // Group C (Greyish)
  { code: 'C1', group: 'C', name: 'C1 (Light Grey)', hex: '#EBE4D5', rgb: '235, 228, 213', hue: 'Cool Light Greyish', translucency: '45%', recommendedFor: 'Translucent Greyish Enamel' },
  { code: 'C2', group: 'C', name: 'C2 (Medium Grey)', hex: '#DFD5C0', rgb: '223, 213, 192', hue: 'Medium Cool Greyish', translucency: '42%', recommendedFor: 'Endodontically Treated Teeth' },
  { code: 'C3', group: 'C', name: 'C3 (Dark Grey)', hex: '#D1C4AA', rgb: '209, 196, 170', hue: 'Deep Grey Tone', translucency: '39%', recommendedFor: 'Heavy Metal Core Masking' },
  { code: 'C4', group: 'C', name: 'C4 (Olive Grey)', hex: '#C2B193', rgb: '194, 177, 147', hue: 'Dark Olive-Grey', translucency: '37%', recommendedFor: 'Darkened Stumps & Tetracycline Stains' },

  // Group D (Reddish-Grey)
  { code: 'D2', group: 'D', name: 'D2 (Light Red-Grey)', hex: '#E8DCBF', rgb: '232, 220, 191', hue: 'Light Reddish-Grey', translucency: '44%', recommendedFor: 'Subtle Pinkish-Grey Anterior Shades' },
  { code: 'D3', group: 'D', name: 'D3 (Medium Red-Grey)', hex: '#DECBA9', rgb: '222, 203, 169', hue: 'Medium Reddish-Grey', translucency: '41%', recommendedFor: 'Mixed Dentition Match' },
  { code: 'D4', group: 'D', name: 'D4 (Warm Red-Grey)', hex: '#D3BC96', rgb: '211, 188, 150', hue: 'Warm Reddish-Grey', translucency: '38%', recommendedFor: 'Posterior Multi-Unit Bridges' },
];

export const ShadeGuideModal: React.FC<ShadeGuideModalProps> = ({ onClose, onSelectShade }) => {
  const [selectedGroup, setSelectedGroup] = useState<'ALL' | 'A' | 'B' | 'C' | 'D' | 'BL'>('ALL');
  const [activeShade, setActiveShade] = useState<ShadeItem>(SHADES[5]); // Default A2
  const [copied, setCopied] = useState(false);

  const filteredShades = selectedGroup === 'ALL' 
    ? SHADES 
    : SHADES.filter(s => s.group === selectedGroup);

  const handleCopy = (code: string) => {
    navigator.clipboard?.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-4xl rounded-3xl p-6 shadow-2xl border border-slate-200 space-y-5 max-h-[92vh] overflow-y-auto">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-purple-600 text-white flex items-center justify-center shadow-xs">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-extrabold text-slate-900">VITA Classical & 3D-Master Digital Shade Guide</h3>
              <p className="text-xs text-slate-500">ISO 3950 dental color standards, translucency indices & sintering specs</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Group Filter Tabs */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {[
            { key: 'ALL', label: 'All Shades (20)' },
            { key: 'BL', label: 'Bleach Group (BL1 - BL4)' },
            { key: 'A', label: 'Group A (Reddish-Brown)' },
            { key: 'B', label: 'Group B (Reddish-Yellow)' },
            { key: 'C', label: 'Group C (Greyish)' },
            { key: 'D', label: 'Group D (Reddish-Grey)' },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setSelectedGroup(tab.key as any)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer ${
                selectedGroup === tab.key
                  ? 'bg-purple-600 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Main Content Grid: Swatches on Left, Inspector on Right */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
          
          {/* Swatches Grid (7 Cols) */}
          <div className="md:col-span-7 space-y-3">
            <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">Select Shade Swatch</div>
            <div className="grid grid-cols-4 sm:grid-cols-5 gap-2.5">
              {filteredShades.map(s => {
                const isSelected = activeShade.code === s.code;
                return (
                  <button
                    key={s.code}
                    onClick={() => setActiveShade(s)}
                    className={`p-2.5 rounded-2xl border text-center transition flex flex-col items-center justify-between gap-1.5 cursor-pointer relative group ${
                      isSelected 
                        ? 'border-purple-600 bg-purple-50/50 ring-2 ring-purple-500/20 shadow-xs' 
                        : 'border-slate-200/80 bg-slate-50/50 hover:bg-white hover:border-slate-300'
                    }`}
                  >
                    {/* Visual Tooth Swatch */}
                    <div 
                      className="w-8 h-10 rounded-t-lg rounded-b-md shadow-xs border border-slate-300/60 relative overflow-hidden transition group-hover:scale-105"
                      style={{ backgroundColor: s.hex }}
                    >
                      {/* Gradient enamel shine */}
                      <div className="absolute inset-0 bg-gradient-to-tr from-black/10 via-transparent to-white/40 pointer-events-none" />
                      {isSelected && (
                        <div className="absolute inset-0 flex items-center justify-center bg-purple-900/20">
                          <Check className="w-3.5 h-3.5 text-purple-700 stroke-[3]" />
                        </div>
                      )}
                    </div>
                    <span className={`text-xs font-extrabold ${isSelected ? 'text-purple-700' : 'text-slate-800'}`}>
                      {s.code}
                    </span>
                    <span className="text-[9px] text-slate-400 font-semibold">{s.group === 'BL' ? 'Bleach' : `Gr. ${s.group}`}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Active Shade Inspector Card (5 Cols) */}
          <div className="md:col-span-5 bg-slate-50/80 rounded-2xl p-5 border border-slate-200/80 flex flex-col justify-between space-y-4">
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-100 text-purple-800 uppercase tracking-wider">
                  Shade Specification
                </span>
                <button
                  onClick={() => handleCopy(activeShade.code)}
                  className="text-xs text-purple-600 hover:text-purple-700 font-semibold flex items-center gap-1 cursor-pointer"
                >
                  {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? 'Copied' : 'Copy Code'}</span>
                </button>
              </div>

              {/* Large Shade Visual */}
              <div className="flex items-center gap-4 mb-4">
                <div 
                  className="w-16 h-20 rounded-t-2xl rounded-b-lg shadow-md border-2 border-slate-300/80 relative overflow-hidden shrink-0"
                  style={{ backgroundColor: activeShade.hex }}
                >
                  <div className="absolute inset-0 bg-gradient-to-tr from-black/10 via-transparent to-white/50" />
                </div>
                <div>
                  <h4 className="text-2xl font-black text-slate-900">{activeShade.code}</h4>
                  <p className="text-xs font-semibold text-slate-700">{activeShade.name}</p>
                  <span className="text-[11px] text-slate-400 block mt-0.5">{activeShade.hue}</span>
                </div>
              </div>

              {/* Spec Rows */}
              <div className="space-y-2 text-xs">
                <div className="p-2.5 bg-white rounded-xl border border-slate-200/60 flex items-center justify-between">
                  <span className="text-slate-500 font-medium">Translucency Index</span>
                  <span className="font-bold text-slate-800">{activeShade.translucency}</span>
                </div>
                <div className="p-2.5 bg-white rounded-xl border border-slate-200/60 flex items-center justify-between">
                  <span className="text-slate-500 font-medium">Digital RGB Color</span>
                  <span className="font-mono font-bold text-slate-700">rgb({activeShade.rgb})</span>
                </div>
                <div className="p-2.5 bg-white rounded-xl border border-slate-200/60 flex items-center justify-between">
                  <span className="text-slate-500 font-medium">Hex Color Code</span>
                  <span className="font-mono font-bold text-purple-700">{activeShade.hex}</span>
                </div>
                <div className="p-2.5 bg-white rounded-xl border border-slate-200/60">
                  <span className="text-slate-400 font-medium block text-[10px] uppercase mb-0.5">Clinical Recommendation</span>
                  <span className="font-semibold text-slate-800 leading-snug">{activeShade.recommendedFor}</span>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="pt-3 border-t border-slate-200 flex gap-2">
              <button
                onClick={() => {
                  if (onSelectShade) onSelectShade(activeShade.code);
                  onClose();
                }}
                className="flex-1 py-2.5 bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs rounded-xl shadow-xs transition flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Apply Shade {activeShade.code} to Case</span>
              </button>
            </div>

          </div>

        </div>

      </div>
    </div>
  );
};
