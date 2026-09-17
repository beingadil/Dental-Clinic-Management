import React, { useMemo, useState, useEffect } from "react";
import { 
  Check, 
  Trash2, 
  ChevronDown, 
  Activity, 
  Stethoscope,
  Sparkles,
  Layers,
  Info,
  ShieldAlert,
  Box
} from "lucide-react";
import "./Odontogram.css";
import { 
  getClinicalSpecs, 
  ClinicalMaterial, 
  ClinicalPrepType, 
  ClinicalShadeGuide, 
  ClinicalImplantBrand,
  DEFAULT_MATERIALS
} from "../../services/clinicalSpecsService";

// FDI standard quadrant arrays
export const UPPER_RIGHT_Q1 = [18, 17, 16, 15, 14, 13, 12, 11];
export const UPPER_LEFT_Q2 = [21, 22, 23, 24, 25, 26, 27, 28];
export const LOWER_RIGHT_Q4 = [48, 47, 46, 45, 44, 43, 42, 41];
export const LOWER_LEFT_Q3 = [31, 32, 33, 34, 35, 36, 37, 38];

// Panoramic order (Maxilla 1..16 -> FDI 18..28; Mandible 32..17 -> FDI 48..38)
export const UPPER_PANORAMIC_TEETH = [...UPPER_RIGHT_Q1, ...UPPER_LEFT_Q2];
export const LOWER_PANORAMIC_TEETH = [...LOWER_RIGHT_Q4, ...LOWER_LEFT_Q3];

export const ALL_TEETH = [
  ...UPPER_PANORAMIC_TEETH,
  ...LOWER_PANORAMIC_TEETH,
];

export const UNIVERSAL_NUMBERS: Record<number, number> = {
  18: 1, 17: 2, 16: 3, 15: 4, 14: 5, 13: 6, 12: 7, 11: 8,
  21: 9, 22: 10, 23: 11, 24: 12, 25: 13, 26: 14, 27: 15, 28: 16,
  48: 32, 47: 31, 46: 30, 45: 29, 44: 28, 43: 27, 42: 26, 41: 25,
  31: 24, 32: 23, 33: 22, 34: 21, 35: 20, 36: 19, 37: 18, 38: 17,
};

export const TOOTH_NAMES: Record<number, string> = {
  18: "Upper Right 3rd Molar (Wisdom)",
  17: "Upper Right 2nd Molar",
  16: "Upper Right 1st Molar",
  15: "Upper Right 2nd Premolar",
  14: "Upper Right 1st Premolar",
  13: "Upper Right Canine",
  12: "Upper Right Lateral Incisor",
  11: "Upper Right Central Incisor",
  21: "Upper Left Central Incisor",
  22: "Upper Left Lateral Incisor",
  23: "Upper Left Canine",
  24: "Upper Left 1st Premolar",
  25: "Upper Left 2nd Premolar",
  26: "Upper Left 1st Molar",
  27: "Upper Left 2nd Molar",
  28: "Upper Left 3rd Molar (Wisdom)",
  48: "Lower Right 3rd Molar (Wisdom)",
  47: "Lower Right 2nd Molar",
  46: "Lower Right 1st Molar",
  45: "Lower Right 2nd Premolar",
  44: "Lower Right 1st Premolar",
  43: "Lower Right Canine",
  42: "Lower Right Lateral Incisor",
  41: "Lower Right Central Incisor",
  31: "Lower Left Central Incisor",
  32: "Lower Left Lateral Incisor",
  33: "Lower Left Canine",
  34: "Lower Left 1st Premolar",
  35: "Lower Left 2nd Premolar",
  36: "Lower Left 1st Molar",
  37: "Lower Left 2nd Molar",
  38: "Lower Left 3rd Molar (Wisdom)",
};

export const SHADE_COLORS: Record<string, string> = {
  A1: "#fffcf2",
  A2: "#f9ecd2",
  A3: "#f1dfbf",
  "A3.5": "#e7d2aa",
  A4: "#d9bc8d",
  B1: "#fffaeb",
  B2: "#f8edd4",
  B3: "#eedcb7",
  B4: "#d8b982",
  C1: "#f6ede0",
  C2: "#ebd9b8",
  C3: "#ddc29b",
  C4: "#caa97f",
  D2: "#ebd6b2",
  D3: "#d3af7b",
  D4: "#be9b68",
  BL1: "#ffffff",
  BL2: "#fffefa",
  BL3: "#fdfbf0",
  BL4: "#faf7e7",
  OM1: "#fdf8ee",
  OM2: "#f8f1e0",
  OM3: "#f2e8cf",
};

export interface ToothDetailData {
  tooth_number: number;
  prep_type?: string;
  material?: string;
  shade?: string;
  notes?: string;
  doctor?: string;
  surgical_kit?: string;
  implant_brand?: string;
  implant_manufacturer?: string;
  implant_model?: string;
  implant_size?: string;
  date?: string;
}

export interface OdontogramData {
  selected: number[];
  restorationByTooth: Record<number, string>;
  shadeByTooth: Record<number, string>;
  materialByTooth?: Record<number, string>;
  toothDetails?: Record<number, ToothDetailData>;
}

export interface OdontogramProps {
  initialSelected?: number[];
  initialRestorations?: Record<number, string>;
  initialShades?: Record<number, string>;
  initialMaterials?: Record<number, string>;
  defaultMaterial?: string;
  onChange?: (data: OdontogramData) => void;
}

export default function Odontogram({
  initialSelected = [11, 21],
  initialRestorations = {},
  initialShades = {},
  initialMaterials = {},
  defaultMaterial = 'Zirconia (Multi-layer 3D Pro)',
  onChange,
}: OdontogramProps) {
  const [numbering, setNumbering] = useState<"FDI" | "Universal">("FDI");
  const [activeTabMode, setActiveTabMode] = useState<"All" | "Dental" | "Perio" | "Endo" | "Aesthetics">("Dental");
  const [selected, setSelected] = useState<number[]>(initialSelected);
  const [restorations, setRestorations] = useState<Record<number, string>>(initialRestorations);
  const [shades, setShades] = useState<Record<number, string>>(initialShades);
  const [materials, setMaterials] = useState<Record<number, string>>(initialMaterials);
  const [toothDetailsState, setToothDetailsState] = useState<Record<number, ToothDetailData>>({});
  const [activeRestoration, setActiveRestoration] = useState("crown");
  const [activeMaterial, setActiveMaterial] = useState(defaultMaterial);
  const [activeShade, setActiveShade] = useState("A2");
  const [focusedTooth, setFocusedTooth] = useState<number | null>(initialSelected[0] || 11);

  // Dynamic Clinical Specs from Settings
  const [clinicalSpecs, setClinicalSpecs] = useState(getClinicalSpecs());

  useEffect(() => {
    const handleSpecsUpdate = () => {
      setClinicalSpecs(getClinicalSpecs());
    };
    window.addEventListener('clinical-specs-updated', handleSpecsUpdate);
    return () => window.removeEventListener('clinical-specs-updated', handleSpecsUpdate);
  }, []);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  // Active available items from settings
  const activeMaterials = useMemo(() => {
    return clinicalSpecs.materials.filter(m => m.is_active);
  }, [clinicalSpecs]);

  const activePrepTypes = useMemo(() => {
    return clinicalSpecs.prepTypes.filter(p => p.is_active);
  }, [clinicalSpecs]);

  const activeShadeList = useMemo(() => {
    const list: string[] = [];
    clinicalSpecs.shadeGuides.forEach(g => {
      g.shades.forEach(s => {
        if (!list.includes(s)) list.push(s);
      });
    });
    return list.length > 0 ? list : ['A1', 'A2', 'A3', 'A3.5', 'A4', 'B1', 'B2', 'B3', 'B4', 'C1', 'C2', 'C3', 'C4', 'D2', 'D3', 'D4', 'BL1', 'BL2', 'BL3', 'BL4'];
  }, [clinicalSpecs]);

  // Sync state to parent
  function emitChange(
    nextSelected: number[],
    nextRestorations: Record<number, string>,
    nextShades: Record<number, string>,
    nextMaterials: Record<number, string> = materials,
    nextDetails: Record<number, ToothDetailData> = toothDetailsState
  ) {
    const completeDetails: Record<number, ToothDetailData> = {};
    nextSelected.forEach((t) => {
      const existing: Partial<ToothDetailData> = nextDetails[t] || {};
      const rType = nextRestorations[t] || activeRestoration || "crown";
      completeDetails[t] = {
        tooth_number: t,
        prep_type: rType,
        material: nextMaterials[t] || activeMaterial || defaultMaterial,
        shade: nextShades[t] || activeShade || "A2",
        notes: existing.notes || "",
        doctor: existing.doctor || "Dr. Attending",
        surgical_kit: existing.surgical_kit || (rType === "implant" ? "Nobel Replace Tapered" : "Standard Diamond Prep Kit"),
        implant_manufacturer: existing.implant_manufacturer || (rType === "implant" ? "Nobel Biocare" : "Dental Solutions"),
        implant_model: existing.implant_model || (rType === "implant" ? "Replace Select Tapered" : (nextMaterials[t] || activeMaterial || defaultMaterial)),
        implant_size: existing.implant_size || "1 x 3.5mm x 10mm, 3 x 4.3mm x 11.5mm",
        date: existing.date || new Date().toISOString().substring(0, 10),
      };
    });

    onChange?.({
      selected: nextSelected,
      restorationByTooth: nextRestorations,
      shadeByTooth: nextShades,
      materialByTooth: nextMaterials,
      toothDetails: completeDetails,
    });
  }

  function toggleTooth(tooth: number) {
    let nextSelected: number[];
    if (selectedSet.has(tooth)) {
      nextSelected = selected.filter((t) => t !== tooth);
      if (focusedTooth === tooth) {
        setFocusedTooth(nextSelected.length > 0 ? nextSelected[0] : null);
      }
    } else {
      nextSelected = [...selected, tooth].sort((a, b) => a - b);
      setFocusedTooth(tooth);
    }

    const nextRestorations = { ...restorations };
    const nextShades = { ...shades };
    const nextMaterials = { ...materials };
    if (!nextRestorations[tooth]) nextRestorations[tooth] = activeRestoration || "crown";
    if (!nextShades[tooth]) nextShades[tooth] = activeShade || "A2";
    if (!nextMaterials[tooth]) nextMaterials[tooth] = activeMaterial || defaultMaterial;

    setSelected(nextSelected);
    setRestorations(nextRestorations);
    setShades(nextShades);
    setMaterials(nextMaterials);
    emitChange(nextSelected, nextRestorations, nextShades, nextMaterials);
  }

  function selectGroup(teeth: number[]) {
    const isAlreadySelected =
      selected.length === teeth.length &&
      teeth.every((t) => selectedSet.has(t));
    const nextSelected = isAlreadySelected ? [] : teeth;

    const nextRestorations = { ...restorations };
    const nextShades = { ...shades };
    const nextMaterials = { ...materials };
    nextSelected.forEach((t) => {
      if (!nextRestorations[t]) nextRestorations[t] = activeRestoration || "crown";
      if (!nextShades[t]) nextShades[t] = activeShade || "A2";
      if (!nextMaterials[t]) nextMaterials[t] = activeMaterial || defaultMaterial;
    });

    setSelected(nextSelected);
    setRestorations(nextRestorations);
    setShades(nextShades);
    setMaterials(nextMaterials);
    setFocusedTooth(nextSelected.length > 0 ? nextSelected[0] : null);
    emitChange(nextSelected, nextRestorations, nextShades, nextMaterials);
  }

  function applyRestoration(restType: string) {
    setActiveRestoration(restType);
    if (!selected.length && !focusedTooth) return;

    const nextRestorations = { ...restorations };
    if (focusedTooth) {
      nextRestorations[focusedTooth] = restType;
    } else {
      selected.forEach((t) => {
        nextRestorations[t] = restType;
      });
    }

    setRestorations(nextRestorations);
    emitChange(selected, nextRestorations, shades, materials);
  }

  function applyMaterial(matName: string) {
    setActiveMaterial(matName);
    if (!selected.length && !focusedTooth) return;

    const nextMaterials = { ...materials };
    if (focusedTooth) {
      nextMaterials[focusedTooth] = matName;
    } else {
      selected.forEach((t) => {
        nextMaterials[t] = matName;
      });
    }

    setMaterials(nextMaterials);
    emitChange(selected, restorations, shades, nextMaterials);
  }

  function applyShade(shadeVal: string) {
    setActiveShade(shadeVal);
    if (!selected.length && !focusedTooth) return;

    const nextShades = { ...shades };
    if (focusedTooth) {
      nextShades[focusedTooth] = shadeVal;
    } else {
      selected.forEach((t) => {
        nextShades[t] = shadeVal;
      });
    }

    setShades(nextShades);
    emitChange(selected, restorations, nextShades, materials);
  }

  function updateToothDetailField(tooth: number, key: keyof ToothDetailData, val: any) {
    const current = toothDetailsState[tooth] || { tooth_number: tooth };
    const updated = { ...toothDetailsState, [tooth]: { ...current, [key]: val } };
    setToothDetailsState(updated);
    emitChange(selected, restorations, shades, materials, updated);
  }

  // Display number helper (FDI or Universal)
  function getDisplayNumber(fdiTooth: number): number | string {
    return numbering === "FDI" ? fdiTooth : UNIVERSAL_NUMBERS[fdiTooth] || fdiTooth;
  }

  // Active tooth information
  const activeToothObj = focusedTooth ? {
    tooth: focusedTooth,
    displayNum: getDisplayNumber(focusedTooth),
    name: TOOTH_NAMES[focusedTooth] || `Tooth #${focusedTooth}`,
    restoration: restorations[focusedTooth] || activeRestoration || "crown",
    material: materials[focusedTooth] || activeMaterial || defaultMaterial,
    shade: shades[focusedTooth] || activeShade || "A2",
    details: toothDetailsState[focusedTooth] || {
      tooth_number: focusedTooth,
      doctor: "Dr. Attending",
      surgical_kit: restorations[focusedTooth] === "implant" ? "Nobel Replace Tapered" : "Standard Diamond Prep Kit",
      implant_manufacturer: restorations[focusedTooth] === "implant" ? "Nobel Biocare" : "Dental Solutions",
      implant_model: restorations[focusedTooth] === "implant" ? "Nobel Replace Tapered" : (materials[focusedTooth] || activeMaterial || defaultMaterial),
      implant_size: "1 x 3.5mm x 10mm, 3 x 4.3mm x 11.5mm",
      notes: ""
    }
  } : null;

  // Chart pathology breakdown calculation for bottom chart
  const conditionStats = useMemo(() => {
    const total = Math.max(selected.length, 1);
    const counts: Record<string, number> = {
      crown: 0,
      implant: 0,
      veneer: 0,
      inlay_onlay: 0,
      pontic: 0,
      abutment: 0,
      other: 0,
    };
    selected.forEach((t) => {
      const r = restorations[t] || "crown";
      if (counts[r] !== undefined) counts[r]++;
      else counts.other++;
    });

    return [
      { label: "Crowns", count: counts.crown, pct: selected.length ? Math.round((counts.crown / total) * 100) : 0, bg: "bg-blue-400 hover:bg-blue-500" },
      { label: "Implants", count: counts.implant, pct: selected.length ? Math.round((counts.implant / total) * 100) : 0, bg: "bg-purple-400 hover:bg-purple-500" },
      { label: "Veneers", count: counts.veneer, pct: selected.length ? Math.round((counts.veneer / total) * 100) : 0, bg: "bg-indigo-400 hover:bg-indigo-500" },
      { label: "Inlays/Onlays", count: counts.inlay_onlay, pct: selected.length ? Math.round((counts.inlay_onlay / total) * 100) : 0, bg: "bg-emerald-400 hover:bg-emerald-500" },
      { label: "Pontics", count: counts.pontic, pct: selected.length ? Math.round((counts.pontic / total) * 100) : 0, bg: "bg-amber-400 hover:bg-amber-500" },
      { label: "Abutments", count: counts.abutment, pct: selected.length ? Math.round((counts.abutment / total) * 100) : 0, bg: "bg-cyan-400 hover:bg-cyan-500" },
    ];
  }, [selected, restorations]);

  // Left Circular Arch SVG Coordinates Mapping for all 32 teeth
  const archNodesUpper = [
    { tooth: 18, x: 36, y: 145, w: 14, h: 12 },
    { tooth: 17, x: 36, y: 125, w: 14, h: 12 },
    { tooth: 16, x: 38, y: 105, w: 14, h: 12 },
    { tooth: 15, x: 44, y: 86, w: 13, h: 11 },
    { tooth: 14, x: 54, y: 70, w: 13, h: 11 },
    { tooth: 13, x: 68, y: 58, w: 12, h: 10 },
    { tooth: 12, x: 88, y: 50, w: 11, h: 9 },
    { tooth: 11, x: 108, y: 47, w: 11, h: 9.5 },
    { tooth: 21, x: 124, y: 47, w: 11, h: 9.5 },
    { tooth: 22, x: 144, y: 50, w: 11, h: 9 },
    { tooth: 23, x: 164, y: 58, w: 12, h: 10 },
    { tooth: 24, x: 178, y: 70, w: 13, h: 11 },
    { tooth: 25, x: 186, y: 86, w: 13, h: 11 },
    { tooth: 26, x: 190, y: 105, w: 14, h: 12 },
    { tooth: 27, x: 190, y: 125, w: 14, h: 12 },
    { tooth: 28, x: 190, y: 145, w: 14, h: 12 },
  ];

  const archNodesLower = [
    { tooth: 48, x: 36, y: 190, w: 14, h: 12 },
    { tooth: 47, x: 36, y: 210, w: 14, h: 12 },
    { tooth: 46, x: 38, y: 230, w: 14, h: 12 },
    { tooth: 45, x: 44, y: 248, w: 13, h: 11 },
    { tooth: 44, x: 54, y: 264, w: 13, h: 11 },
    { tooth: 43, x: 68, y: 276, w: 12, h: 10 },
    { tooth: 42, x: 88, y: 286, w: 11, h: 9 },
    { tooth: 41, x: 108, y: 290, w: 11, h: 9.5 },
    { tooth: 31, x: 124, y: 290, w: 11, h: 9.5 },
    { tooth: 32, x: 144, y: 286, w: 11, h: 9 },
    { tooth: 33, x: 164, y: 276, w: 12, h: 10 },
    { tooth: 34, x: 178, y: 264, w: 13, h: 11 },
    { tooth: 35, x: 186, y: 248, w: 13, h: 11 },
    { tooth: 36, x: 190, y: 230, w: 14, h: 12 },
    { tooth: 37, x: 190, y: 210, w: 14, h: 12 },
    { tooth: 38, x: 190, y: 190, w: 14, h: 12 },
  ];

  return (
    <div className="w-full bg-[#f8fafc] rounded-3xl p-4 md:p-6 border border-slate-200 shadow-sm font-sans text-slate-700">
      
      {/* Top Header Bar: Mode Pills, Numbering Toggle & Quick Actions */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5 pb-4 border-b border-slate-200/80">
        
        {/* Left: Mode Selection Pills */}
        <div className="flex items-center gap-1.5 bg-white p-1 rounded-2xl border border-slate-200 shadow-2xs text-xs font-medium text-slate-500">
          {(["All", "Dental", "Perio", "Endo", "Aesthetics"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setActiveTabMode(mode)}
              className={`px-3.5 py-1.5 rounded-xl transition-all font-semibold cursor-pointer ${
                activeTabMode === mode
                  ? "bg-blue-600 text-white shadow-xs"
                  : "hover:text-slate-800 hover:bg-slate-50 text-slate-600"
              }`}
            >
              {mode}
            </button>
          ))}
        </div>

        {/* Numbering Toggle & Arch Presets */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center bg-white p-1 rounded-2xl border border-slate-200 shadow-2xs text-xs font-bold">
            <button
              type="button"
              onClick={() => setNumbering("FDI")}
              className={`px-3 py-1 rounded-xl transition-all cursor-pointer ${
                numbering === "FDI" ? "bg-slate-900 text-white shadow-xs" : "text-slate-500 hover:text-slate-900"
              }`}
              title="World standard ISO FDI two-digit numbering (11-48)"
            >
              FDI (11–48)
            </button>
            <button
              type="button"
              onClick={() => setNumbering("Universal")}
              className={`px-3 py-1 rounded-xl transition-all cursor-pointer ${
                numbering === "Universal" ? "bg-slate-900 text-white shadow-xs" : "text-slate-500 hover:text-slate-900"
              }`}
              title="Universal numbering system (1–32)"
            >
              Universal (1–32)
            </button>
          </div>

          <button
            type="button"
            onClick={() => selectGroup(UPPER_PANORAMIC_TEETH)}
            className="px-2.5 py-1.5 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold rounded-xl border border-slate-200 shadow-2xs transition-colors cursor-pointer"
          >
            Upper Arch
          </button>
          <button
            type="button"
            onClick={() => selectGroup(LOWER_PANORAMIC_TEETH)}
            className="px-2.5 py-1.5 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold rounded-xl border border-slate-200 shadow-2xs transition-colors cursor-pointer"
          >
            Lower Arch
          </button>
          <button
            type="button"
            onClick={() => selectGroup(ALL_TEETH)}
            className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-bold rounded-xl border border-blue-200 transition-colors cursor-pointer"
          >
            All 32 Units
          </button>

          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setSelected([]);
                setFocusedTooth(null);
                emitChange([], restorations, shades, materials);
              }}
              className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 text-xs font-bold rounded-xl border border-rose-200 transition-colors cursor-pointer flex items-center gap-1"
            >
              <Trash2 className="w-3.5 h-3.5" /> Clear ({selected.length})
            </button>
          )}
        </div>
      </div>

      {/* Main 2-Column Clinical Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* Left 8-Cols: Dental Visual Models (Circular Arch + Panoramic Anatomical SVG) */}
        <div className="lg:col-span-8 flex flex-col gap-5">
          
          {/* Main Visual Odontogram Card */}
          <div className="bg-white rounded-3xl p-5 shadow-xs border border-slate-200">
            
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-bold text-slate-900 tracking-tight flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-blue-600 animate-pulse"></span>
                  Interactive Dental Odontogram (FDI Charting)
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Click any tooth to assign restoration, material, shade, and clinical specifications.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs font-bold px-3 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                  {selected.length} Units Active
                </span>
              </div>
            </div>

            {/* Visual Split: Left Circular Arch (4 cols) & Right Panoramic Realistic Model (8 cols) */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center py-2 min-h-[360px] border-t border-b border-slate-100">
              
              {/* 1. Left Circular Arch Guide - Cleaned dynamic mapping */}
              <div className="md:col-span-4 flex flex-col items-center justify-center relative select-none border-r border-slate-100 pr-2">
                <div className="relative w-[220px] h-[330px] flex items-center justify-center">
                  <svg className="w-full h-full overflow-visible" viewBox="0 0 240 360">
                    {/* Maxilla Arch Guide */}
                    <path
                      d="M 40 160 C 40 40, 200 40, 200 160"
                      fill="none"
                      stroke="#f1f5f9"
                      strokeDasharray="3 3"
                      strokeWidth="2"
                    />
                    {/* Mandible Arch Guide */}
                    <path
                      d="M 40 190 C 40 310, 200 310, 200 190"
                      fill="none"
                      stroke="#f1f5f9"
                      strokeDasharray="3 3"
                      strokeWidth="2"
                    />
                    
                    {/* Arch Labels */}
                    <text fill="#94a3b8" fontSize="10" fontWeight="700" letterSpacing="1" textAnchor="middle" x="120" y="105">
                      MAXILLA
                    </text>
                    <text fill="#94a3b8" fontSize="10" fontWeight="700" letterSpacing="1" textAnchor="middle" x="120" y="245">
                      MANDIBLE
                    </text>

                    {/* UPPER TEETH NODES ON CIRCULAR ARCH */}
                    {archNodesUpper.map((node) => {
                      const isSel = selectedSet.has(node.tooth);
                      const isFoc = focusedTooth === node.tooth;
                      const rest = restorations[node.tooth] || activeRestoration || "crown";
                      const s = shades[node.tooth] || "A2";

                      let nodeFill = "#ffffff";
                      let nodeStroke = "#cbd5e1";
                      if (isSel) {
                        if (rest === "implant") {
                          nodeFill = "#a855f7";
                          nodeStroke = "#7e22ce";
                        } else if (rest === "veneer") {
                          nodeFill = "#6366f1";
                          nodeStroke = "#4338ca";
                        } else if (rest === "inlay_onlay") {
                          nodeFill = "#10b981";
                          nodeStroke = "#047857";
                        } else {
                          nodeFill = SHADE_COLORS[s] || "#2563eb";
                          nodeStroke = "#2563eb";
                        }
                      }
                      if (isFoc) nodeStroke = "#1d4ed8";

                      return (
                        <g 
                          key={node.tooth} 
                          onClick={() => toggleTooth(node.tooth)} 
                          className="cursor-pointer group"
                        >
                          <rect
                            x={node.x}
                            y={node.y}
                            width={node.w}
                            height={node.h}
                            rx="2.5"
                            fill={nodeFill}
                            stroke={nodeStroke}
                            strokeWidth={isFoc ? "2.2" : isSel ? "1.5" : "1.1"}
                          />
                          {isSel && (
                            <text
                              x={node.x + node.w / 2}
                              y={node.y + node.h / 2 + 3}
                              fill={rest === "implant" || rest === "veneer" ? "#ffffff" : "#1e293b"}
                              fontSize="6.5"
                              fontWeight="bold"
                              textAnchor="middle"
                            >
                              {getDisplayNumber(node.tooth)}
                            </text>
                          )}
                        </g>
                      );
                    })}

                    {/* LOWER TEETH NODES ON CIRCULAR ARCH */}
                    {archNodesLower.map((node) => {
                      const isSel = selectedSet.has(node.tooth);
                      const isFoc = focusedTooth === node.tooth;
                      const rest = restorations[node.tooth] || activeRestoration || "crown";
                      const s = shades[node.tooth] || "A2";

                      let nodeFill = "#ffffff";
                      let nodeStroke = "#cbd5e1";
                      if (isSel) {
                        if (rest === "implant") {
                          nodeFill = "#a855f7";
                          nodeStroke = "#7e22ce";
                        } else if (rest === "veneer") {
                          nodeFill = "#6366f1";
                          nodeStroke = "#4338ca";
                        } else if (rest === "inlay_onlay") {
                          nodeFill = "#10b981";
                          nodeStroke = "#047857";
                        } else {
                          nodeFill = SHADE_COLORS[s] || "#2563eb";
                          nodeStroke = "#2563eb";
                        }
                      }
                      if (isFoc) nodeStroke = "#1d4ed8";

                      return (
                        <g 
                          key={node.tooth} 
                          onClick={() => toggleTooth(node.tooth)} 
                          className="cursor-pointer group"
                        >
                          <rect
                            x={node.x}
                            y={node.y}
                            width={node.w}
                            height={node.h}
                            rx="2.5"
                            fill={nodeFill}
                            stroke={nodeStroke}
                            strokeWidth={isFoc ? "2.2" : isSel ? "1.5" : "1.1"}
                          />
                          {isSel && (
                            <text
                              x={node.x + node.w / 2}
                              y={node.y + node.h / 2 + 3}
                              fill={rest === "implant" || rest === "veneer" ? "#ffffff" : "#1e293b"}
                              fontSize="6.5"
                              fontWeight="bold"
                              textAnchor="middle"
                            >
                              {getDisplayNumber(node.tooth)}
                            </text>
                          )}
                        </g>
                      );
                    })}
                  </svg>
                </div>
              </div>

              {/* 2. Right Panoramic Realistic Dental Anatomical Model (Clean dynamic SVG) */}
              <div className="md:col-span-8 overflow-x-auto custom-scrollbar flex flex-col items-center justify-center p-1 select-none">
                <div className="w-[520px] max-w-full">
                  <svg className="w-full h-auto overflow-visible select-none drop-shadow-xs" viewBox="0 0 520 280">
                    <defs>
                      {/* Realistic Soft Gum Gradient */}
                      <linearGradient id="cleanGumGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stopColor="#fee2e2" stopOpacity="0.85" />
                        <stop offset="100%" stopColor="#fecdd3" stopOpacity="0.45" />
                      </linearGradient>
                      {/* Titanium Implant Threaded Gradient */}
                      <linearGradient id="cleanImplantGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor="#9333ea" />
                        <stop offset="50%" stopColor="#c084fc" />
                        <stop offset="100%" stopColor="#7e22ce" />
                      </linearGradient>
                    </defs>

                    {/* Soft Gingiva Contour UPPER */}
                    <path
                      d="M 20,95 Q 60,35 150,30 Q 260,25 380,30 Q 460,35 500,95 C 470,85 430,90 410,75 C 370,85 330,75 290,75 C 230,75 190,85 150,75 C 110,90 70,85 20,95 Z"
                      fill="url(#cleanGumGradient)"
                      stroke="#fda4af"
                      strokeWidth="0.8"
                    />

                    {/* Soft Gingiva Contour LOWER */}
                    <path
                      d="M 20,185 Q 60,245 150,250 Q 260,255 380,250 Q 460,245 500,185 C 470,195 430,190 410,205 C 370,195 330,205 290,205 C 230,205 190,195 150,205 C 110,190 70,195 20,185 Z"
                      fill="url(#cleanGumGradient)"
                      stroke="#fda4af"
                      strokeWidth="0.8"
                    />

                    {/* UPPER ARCH NUMBERS */}
                    <g fill="#94a3b8" fontSize="8" fontWeight="700" textAnchor="middle">
                      {UPPER_PANORAMIC_TEETH.map((tooth, idx) => {
                        const x = 35 + idx * 28 + (idx > 7 ? 6 : 0);
                        const isFocused = focusedTooth === tooth;
                        const isSelected = selectedSet.has(tooth);
                        return (
                          <text 
                            key={tooth} 
                            x={x} 
                            y="145" 
                            className={`cursor-pointer transition-colors ${
                              isFocused ? "fill-blue-600 font-black text-[9px]" : isSelected ? "fill-blue-500 font-bold" : ""
                            }`}
                            onClick={() => toggleTooth(tooth)}
                          >
                            {getDisplayNumber(tooth)}
                          </text>
                        );
                      })}
                    </g>

                    {/* UPPER ANATOMICAL TEETH */}
                    {UPPER_PANORAMIC_TEETH.map((tooth, idx) => {
                      const xOffset = 25 + idx * 28 + (idx > 7 ? 6 : 0);
                      const isSelected = selectedSet.has(tooth);
                      const isFocused = focusedTooth === tooth;
                      const currentRest = restorations[tooth] || "crown";
                      const currentShade = shades[tooth] || "A2";
                      const isImplant = isSelected && currentRest === "implant";

                      const toothFill = isSelected ? (SHADE_COLORS[currentShade] || "#ffffff") : "#ffffff";
                      const strokeColor = isFocused ? "#2563eb" : isSelected ? "#3b82f6" : "#cbd5e1";
                      const strokeW = isFocused ? "2" : isSelected ? "1.5" : "1.1";

                      if (isImplant) {
                        return (
                          <g
                            key={tooth}
                            transform={`translate(${xOffset}, 26)`}
                            onClick={() => toggleTooth(tooth)}
                            className="cursor-pointer group"
                          >
                            {/* Threaded Titanium Root extending upward into maxilla */}
                            <path d="M 7.5,12 L 8.5,12 L 8,0 Z" fill="url(#cleanImplantGrad)" />
                            <path d="M 7,24 L 9,24 L 8.5,12 L 7.5,12 Z" fill="url(#cleanImplantGrad)" />
                            <path d="M 6.4,36 L 9.6,36 L 9,24 L 7,24 Z" fill="url(#cleanImplantGrad)" />
                            <path d="M 5.8,44 L 10.2,44 L 9.6,36 L 6.4,36 Z" fill="url(#cleanImplantGrad)" />
                            <rect x="4.5" y="44" width="7" height="4" rx="0.8" fill="#a855f7" stroke="#7e22ce" strokeWidth="1" />
                            {/* Ceramic Crown */}
                            <path d="M 3,48 C 1,62 3,70 8,70 C 13,70 15,62 13,48 Z" fill="#ffffff" stroke="#a855f7" strokeWidth="1.5" />
                            {isFocused && (
                              <ellipse cx="8" cy="35" rx="10" ry="38" fill="none" stroke="#c084fc" strokeWidth="1.2" strokeDasharray="3 3" />
                            )}
                          </g>
                        );
                      }

                      return (
                        <g
                          key={tooth}
                          transform={`translate(${xOffset}, ${30 + (idx === 7 || idx === 8 ? -10 : idx === 0 || idx === 15 ? 10 : 0)})`}
                          onClick={() => toggleTooth(tooth)}
                          className="cursor-pointer group"
                        >
                          <path
                            d="M 6,52 C 2,35 4,8 8,0 C 13,12 15,28 18,0 C 21,14 23,35 20,52 C 24,62 22,78 14,78 C 6,78 2,64 6,52 Z"
                            fill={toothFill}
                            stroke={strokeColor}
                            strokeWidth={strokeW}
                            className="group-hover:stroke-blue-500 transition-colors"
                          />
                          {isFocused && (
                            <ellipse cx="10" cy="40" rx="14" ry="44" fill="none" stroke="#3b82f6" strokeWidth="1.3" strokeDasharray="3 3" />
                          )}
                          {isSelected && currentRest === "veneer" && (
                            <path d="M 6,55 L 14,55 L 12,74 L 8,74 Z" fill="#c7d2fe" stroke="#6366f1" strokeWidth="0.9" />
                          )}
                        </g>
                      );
                    })}

                    {/* LOWER ARCH NUMBERS */}
                    <g fill="#94a3b8" fontSize="8" fontWeight="700" textAnchor="middle">
                      {LOWER_PANORAMIC_TEETH.map((tooth, idx) => {
                        const x = 35 + idx * 28 + (idx > 7 ? 6 : 0);
                        const isFocused = focusedTooth === tooth;
                        const isSelected = selectedSet.has(tooth);
                        return (
                          <text 
                            key={tooth} 
                            x={x} 
                            y="160" 
                            className={`cursor-pointer transition-colors ${
                              isFocused ? "fill-blue-600 font-black text-[9px]" : isSelected ? "fill-blue-500 font-bold" : ""
                            }`}
                            onClick={() => toggleTooth(tooth)}
                          >
                            {getDisplayNumber(tooth)}
                          </text>
                        );
                      })}
                    </g>

                    {/* LOWER ANATOMICAL TEETH */}
                    {LOWER_PANORAMIC_TEETH.map((tooth, idx) => {
                      const xOffset = 25 + idx * 28 + (idx > 7 ? 6 : 0);
                      const isSelected = selectedSet.has(tooth);
                      const isFocused = focusedTooth === tooth;
                      const currentRest = restorations[tooth] || "crown";
                      const currentShade = shades[tooth] || "A2";
                      const isImplant = isSelected && currentRest === "implant";

                      const toothFill = isSelected ? (SHADE_COLORS[currentShade] || "#ffffff") : "#ffffff";
                      const strokeColor = isFocused ? "#2563eb" : isSelected ? "#3b82f6" : "#cbd5e1";
                      const strokeW = isFocused ? "2" : isSelected ? "1.5" : "1.1";

                      if (isImplant) {
                        return (
                          <g
                            key={tooth}
                            transform={`translate(${xOffset}, 175)`}
                            onClick={() => toggleTooth(tooth)}
                            className="cursor-pointer group"
                          >
                            {/* Crown */}
                            <path d="M 3,22 C 1,8 3,0 8,0 C 13,0 15,8 13,22 Z" fill="#ffffff" stroke="#a855f7" strokeWidth="1.5" />
                            <path d="M 5,16 L 11,16" stroke="#c084fc" strokeWidth="1" />
                            {/* Titanium Collar */}
                            <rect x="4.5" y="22" width="7" height="4" rx="0.8" fill="#a855f7" stroke="#7e22ce" strokeWidth="1" />
                            {/* Threaded Titanium Body */}
                            <path d="M 5,26 L 11,26 L 10.2,32 L 5.8,32 Z" fill="url(#cleanImplantGrad)" />
                            <path d="M 5.8,32 L 10.2,32 L 9.6,40 L 6.4,40 Z" fill="url(#cleanImplantGrad)" />
                            <path d="M 6.4,40 L 9.6,40 L 9,50 L 7,50 Z" fill="url(#cleanImplantGrad)" />
                            <path d="M 7,50 L 9,50 L 8.5,62 L 7.5,62 Z" fill="url(#cleanImplantGrad)" />
                            {isFocused && (
                              <ellipse cx="8" cy="45" rx="9" ry="38" fill="none" stroke="#c084fc" strokeWidth="1.2" strokeDasharray="3 3" />
                            )}
                          </g>
                        );
                      }

                      return (
                        <g
                          key={tooth}
                          transform={`translate(${xOffset}, 174)`}
                          onClick={() => toggleTooth(tooth)}
                          className="cursor-pointer group"
                        >
                          <path
                            d="M 5,22 C 1,9 5,0 13,0 C 21,0 23,9 20,22 C 23,40 20,64 16,80 C 14,60 12,44 10,80 C 5,64 2,40 5,22 Z"
                            fill={toothFill}
                            stroke={strokeColor}
                            strokeWidth={strokeW}
                            className="group-hover:stroke-blue-500 transition-colors"
                          />
                          {isFocused && (
                            <ellipse cx="12" cy="40" rx="14" ry="44" fill="none" stroke="#3b82f6" strokeWidth="1.3" strokeDasharray="3 3" />
                          )}
                        </g>
                      );
                    })}
                  </svg>
                </div>
              </div>
            </div>

            {/* Clean Legend */}
            <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 mt-4 pt-3 text-[11px] font-medium text-slate-500">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-blue-500"></span> Crown Restoration
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-purple-500"></span> Implant Prosthesis
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-indigo-500"></span> Veneer
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span> Inlay / Onlay
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span> Bridge Pontic
              </span>
            </div>
          </div>

          {/* Bottom Procedure Breakdown Bar Chart */}
          <div className="bg-white rounded-3xl p-5 shadow-xs border border-slate-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center gap-2">
                <Activity className="w-4 h-4 text-blue-600" />
                Case Restorations Breakdown ({selected.length} Units)
              </h3>
              <span className="text-[11px] text-slate-400 font-semibold">Active Restorations</span>
            </div>

            <div className="grid grid-cols-6 gap-3 items-end h-28 px-2 text-center select-none">
              {conditionStats.map((stat, i) => (
                <div key={i} className="flex flex-col items-center gap-1.5 h-full justify-end">
                  <span className="text-[11px] font-bold text-slate-800">
                    {stat.count} <span className="text-[9px] text-slate-400 font-normal">({stat.pct}%)</span>
                  </span>
                  <div
                    className={`w-full max-w-[38px] ${stat.bg} rounded-xl transition-all duration-300 shadow-2xs`}
                    style={{ height: `${Math.max(14, Math.min(100, stat.pct * 2.2))}%` }}
                  ></div>
                  <span className="text-[10px] font-medium text-slate-500 truncate w-full">{stat.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right 4-Cols: Selected Tooth Inspector Panel */}
        <div className="lg:col-span-4 flex flex-col gap-4">
          
          {/* Primary Selected Tooth Card */}
          {activeToothObj ? (
            <div className="bg-white rounded-3xl p-5 shadow-xs border border-slate-200 relative">
              <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-100">
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                  Tooth Specification
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-blue-50 text-blue-700 border border-blue-200">
                  Unit #{activeToothObj.displayNum}
                </span>
              </div>

              {/* Tooth Identification Info & Thumbnail */}
              <div className="flex items-start gap-3.5 pb-4 border-b border-slate-100">
                <div className="w-12 h-16 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center shrink-0 shadow-2xs">
                  {activeToothObj.restoration === "implant" ? (
                    <svg className="w-6 h-12" viewBox="0 0 28 50">
                      <path d="M 6,14 C 4,5 7,1 14,1 C 21,1 24,5 22,14 Z" fill="#f8fafc" stroke="#a855f7" strokeWidth="1.2" />
                      <rect x="10" y="14" width="8" height="4" rx="1" fill="#a855f7" />
                      <path d="M 9,18 L 19,18 L 17.5,26 L 10.5,26 Z" fill="#9333ea" />
                      <path d="M 10.5,26 L 17.5,26 L 16,36 L 12,36 Z" fill="#9333ea" />
                      <path d="M 12,36 L 16,36 L 14,48 Z" fill="#9333ea" />
                    </svg>
                  ) : (
                    <svg className="w-6 h-12" viewBox="0 0 24 36">
                      <path
                        d="M 4,28 C 1,20 2,10 5,0 C 9,10 11,18 14,0 C 17,10 19,20 16,28 C 20,32 18,36 12,36 C 5,36 2,32 4,28 Z"
                        fill={SHADE_COLORS[activeToothObj.shade] || "#ffffff"}
                        stroke="#2563eb"
                        strokeWidth="1.3"
                      />
                    </svg>
                  )}
                </div>

                <div className="leading-tight flex-1 min-w-0">
                  <h3 className="text-sm font-black text-blue-600 truncate">
                    {activeToothObj.name}
                  </h3>
                  <div className="flex items-center gap-1.5 mt-1">
                    <span className="text-xs text-slate-400">Prep:</span>
                    <span className="text-xs font-bold text-slate-800 uppercase truncate">
                      {activeToothObj.restoration}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-[11px] text-slate-400">Material:</span>
                    <span className="text-[11px] font-bold text-indigo-700 truncate">
                      {activeToothObj.material}
                    </span>
                  </div>
                </div>
              </div>

              {/* Restoration Type Selection */}
              <div className="py-3 border-b border-slate-100 space-y-1.5">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                  Restoration / Preparation Type:
                </label>
                <div className="grid grid-cols-2 gap-1.5">
                  {activePrepTypes.slice(0, 6).map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => applyRestoration(p.id)}
                      className={`px-2 py-1.5 text-[11px] font-bold rounded-lg border text-left transition-all cursor-pointer flex items-center justify-between ${
                        activeToothObj.restoration === p.id
                          ? "bg-blue-600 text-white border-blue-600 shadow-xs"
                          : "bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200"
                      }`}
                    >
                      <span className="truncate">{p.name}</span>
                      {activeToothObj.restoration === p.id && <Check className="w-3 h-3 text-white shrink-0" />}
                    </button>
                  ))}
                </div>
              </div>

              {/* Dental Restoration Material Selection */}
              <div className="py-3 border-b border-slate-100 space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                    Restoration Material:
                  </label>
                  <span className="text-[10px] text-indigo-600 font-bold">Linked to #{activeToothObj.displayNum}</span>
                </div>
                <select
                  value={activeToothObj.material}
                  onChange={(e) => applyMaterial(e.target.value)}
                  className="w-full p-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-500 font-semibold text-slate-800"
                >
                  {activeMaterials.map((mat) => (
                    <option key={mat.id} value={mat.name}>
                      {mat.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Shade Guide Swatches */}
              <div className="py-3 border-b border-slate-100 space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                    VITA Shade Guide:
                  </label>
                  <span className="text-xs font-mono font-bold text-amber-700">{activeToothObj.shade}</span>
                </div>
                <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto pr-1">
                  {activeShadeList.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => applyShade(s)}
                      className={`px-2 py-1 text-[10px] font-mono font-bold rounded-md border flex items-center gap-1 transition-all cursor-pointer ${
                        activeToothObj.shade === s
                          ? "bg-slate-900 text-white border-slate-900 shadow-xs"
                          : "bg-white hover:bg-slate-50 text-slate-700 border-slate-200"
                      }`}
                    >
                      <span
                        className="w-2.5 h-2.5 rounded-full border border-slate-400/40"
                        style={{ background: SHADE_COLORS[s] || "#f8ecd2" }}
                      />
                      <span>{s}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Clinical Notes Input */}
              <div className="pt-3">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                    Per-Tooth Notes (Unit #{activeToothObj.tooth}):
                </label>
                <textarea
                  rows={2}
                  value={activeToothObj.details.notes || ""}
                  onChange={(e) => updateToothDetailField(activeToothObj.tooth, "notes", e.target.value)}
                  placeholder="Incisal translucency, margin finish line, stump shade..."
                  className="w-full p-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-blue-500 resize-none text-slate-800"
                />
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-3xl p-6 shadow-xs border border-slate-200 text-center py-12">
              <Stethoscope className="w-10 h-10 text-slate-300 mx-auto mb-2" />
              <p className="text-xs font-bold text-slate-700">No tooth currently selected</p>
              <p className="text-[11px] text-slate-400 mt-0.5">Click any tooth on the dental chart to inspect and configure.</p>
            </div>
          )}

          {/* Case Selected Teeth Units */}
          <div className="space-y-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 px-1">
              Case Selected Teeth Units ({selected.length})
            </h4>

            {selected.length === 0 ? (
              <div className="p-4 bg-slate-50 rounded-2xl border border-dashed border-slate-200 text-center text-xs text-slate-400">
                No units assigned yet.
              </div>
            ) : (
              <div className="space-y-2 max-h-52 overflow-y-auto pr-1 custom-scrollbar">
                {selected.map((t) => {
                  const rest = restorations[t] || "crown";
                  const s = shades[t] || "A2";
                  const mat = materials[t] || activeMaterial || defaultMaterial;
                  const isCurrent = focusedTooth === t;

                  return (
                    <div
                      key={t}
                      onClick={() => setFocusedTooth(t)}
                      className={`p-2.5 bg-white rounded-2xl border transition-all flex items-center justify-between cursor-pointer hover:border-blue-300 ${
                        isCurrent ? "border-blue-500 ring-2 ring-blue-100 shadow-xs" : "border-slate-200"
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-10 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-center p-1 shrink-0">
                          <span className="font-mono font-black text-xs text-slate-900">
                            #{getDisplayNumber(t)}
                          </span>
                        </div>
                        <div className="leading-tight min-w-0">
                          <h4 className="text-xs font-bold text-slate-800 truncate">
                            {TOOTH_NAMES[t] ? TOOTH_NAMES[t].split("(")[0] : `Tooth #${t}`}
                          </h4>
                          <p className="text-[10px] text-slate-400 mt-0.5 truncate">
                            {mat.split("(")[0]} • <span className="font-bold text-amber-700">{s}</span>
                          </p>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleTooth(t);
                        }}
                        className="p-1.5 text-slate-300 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer shrink-0"
                        title="Deselect tooth"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

        </div>

      </div>
    </div>
  );
}
