import React, { useMemo, useState, useEffect } from "react";
import {
  Check,
  Trash2,
  Activity,
  Stethoscope,
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

/* =========================================================================
   FDI IDENTITY — 32 permanent teeth
   ========================================================================= */

export type ToothId =
  | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18
  | 21 | 22 | 23 | 24 | 25 | 26 | 27 | 28
  | 31 | 32 | 33 | 34 | 35 | 36 | 37 | 38
  | 41 | 42 | 43 | 44 | 45 | 46 | 47 | 48;

// Panoramic order (Maxilla 1..16 -> FDI 18..28; Mandible 32..17 -> FDI 48..38)
export const UPPER_PANORAMIC_TEETH: ToothId[] = [
  18, 17, 16, 15, 14, 13, 12, 11,
  21, 22, 23, 24, 25, 26, 27, 28,
];
export const LOWER_PANORAMIC_TEETH: ToothId[] = [
  48, 47, 46, 45, 44, 43, 42, 41,
  31, 32, 33, 34, 35, 36, 37, 38,
];
export const ALL_TEETH: ToothId[] = [
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

/* =========================================================================
   ANATOMICAL MODEL
   ========================================================================= */

type Arch = "upper" | "lower";

type ToothType =
  | "central-incisor"
  | "lateral-incisor"
  | "canine"
  | "first-premolar"
  | "second-premolar"
  | "first-molar"
  | "second-molar"
  | "third-molar";

interface Tooth {
  id: ToothId;
  arch: Arch;
  quadrant: 1 | 2 | 3 | 4;
  type: ToothType;
  index: number;
  x: number;
  y: number;
  rotation: number;
}

function getQuadrant(id: ToothId): 1 | 2 | 3 | 4 {
  return Math.floor(id / 10) as 1 | 2 | 3 | 4;
}

function getToothType(id: ToothId): ToothType {
  switch (id % 10) {
    case 1: return "central-incisor";
    case 2: return "lateral-incisor";
    case 3: return "canine";
    case 4: return "first-premolar";
    case 5: return "second-premolar";
    case 6: return "first-molar";
    case 7: return "second-molar";
    case 8: return "third-molar";
    default: return "central-incisor";
  }
}

function isPosterior(type: ToothType): boolean {
  return type === "first-premolar" ||
    type === "second-premolar" ||
    type === "first-molar" ||
    type === "second-molar" ||
    type === "third-molar";
}

/*
 * Generates a natural parabolic dental arch.
 * x increases left -> right, y increases top -> bottom.
 * Upper arch: posterior edges at top (edgeY), centrals dip toward the
 * occlusal band (centerY). Lower arch mirrors it. Spacing (51.7 units)
 * exceeds the widest adjacent crown pair (~50 units) so teeth never overlap.
 */
function createArch(ids: ToothId[], arch: Arch): Tooth[] {
  const centerX = 500;
  const leftX = 112;
  const rightX = 888;
  const centerY = arch === "upper" ? 278 : 398;
  const edgeY = arch === "upper" ? 130 : 545;
  const teeth = ids.length;

  return ids.map((id, index) => {
    const t = index / (teeth - 1);
    const x = leftX + (rightX - leftX) * t;

    // Normalized horizontal distance from the center (-1 posterior .. 0 central .. 1 posterior)
    const normalized = (x - centerX) / ((rightX - leftX) / 2);

    // Parabolic arch curve: 1 at center, 0 at posterior edges
    const curve = 1 - normalized * normalized;

    const y = arch === "upper"
      ? edgeY + curve * (centerY - edgeY)
      : edgeY - curve * (edgeY - centerY);

    // Rotation follows the tangent of the arch
    const rotation = arch === "upper" ? normalized * 21 : -normalized * 21;

    return {
      id,
      arch,
      quadrant: getQuadrant(id),
      type: getToothType(id),
      index,
      x,
      y,
      rotation,
    };
  });
}

const INITIAL_TEETH: Tooth[] = [
  ...createArch(UPPER_PANORAMIC_TEETH, "upper"),
  ...createArch(LOWER_PANORAMIC_TEETH, "lower"),
];

export interface ToothLayoutPoint {
  id: ToothId;
  arch: Arch;
  x: number;
  y: number;
  rotation: number;
}

/**
 * Static arch layout for all 32 teeth (FDI identity + parabolic position).
 * Shared with print documents so the paper chart matches the on-screen one.
 */
export function getToothLayout(): ToothLayoutPoint[] {
  return INITIAL_TEETH.map(({ id, arch, x, y, rotation }) => ({ id, arch, x, y, rotation }));
}

/* =========================================================================
   VISUAL STATE MODEL — prep types mapped to clinical overlay art
   ========================================================================= */

interface ToothVisual {
  prep?: string;       // restoration / prep type id (crown, implant, pontic, ...)
  shade?: string;      // VITA shade key
  caries?: boolean;    // note marker "C: ..."
  filling?: boolean;   // note marker "F: ..."
}

const POST_CORE = "post_core";

/* Caries / filling chart markers are derived from the per-tooth notes:
   a note starting with "C:" flags caries, "F:" flags an intracoronal filling. */
function visualFor(
  id: number,
  preps: Record<number, string>,
  shades: Record<number, string>,
  details: Record<number, ToothDetailData>
): ToothVisual {
  const notes = details[id]?.notes || "";
  return {
    prep: preps[id],
    shade: shades[id],
    caries: /^\s*C\s*:/i.test(notes),
    filling: /^\s*F\s*:/i.test(notes),
  };
}

/* =========================================================================
   MAIN COMPONENT
   ========================================================================= */

export default function Odontogram({
  initialSelected = [11, 21],
  initialRestorations = {},
  initialShades = {},
  initialMaterials = {},
  defaultMaterial = 'Zirconia (Multi-layer 3D Pro)',
  onChange,
}: OdontogramProps) {
  const [numbering, setNumbering] = useState<"FDI" | "Universal">("FDI");
  const [selected, setSelected] = useState<number[]>(initialSelected);
  const [restorations, setRestorations] = useState<Record<number, string>>(initialRestorations);
  const [shades, setShades] = useState<Record<number, string>>(initialShades);
  const [materials, setMaterials] = useState<Record<number, string>>(initialMaterials);
  const [toothDetailsState, setToothDetailsState] = useState<Record<number, ToothDetailData>>({});
  const [activeRestoration, setActiveRestoration] = useState("crown");
  const [activeMaterial, setActiveMaterial] = useState(defaultMaterial);
  const [activeShade, setActiveShade] = useState("A2");
  const [selectedToothId, setSelectedToothId] = useState<number | null>(initialSelected[0] || null);

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

  const activeMaterials = useMemo(() => clinicalSpecs.materials.filter(m => m.is_active), [clinicalSpecs]);
  const activePrepTypes = useMemo(() => clinicalSpecs.prepTypes.filter(p => p.is_active), [clinicalSpecs]);
  const activeShadeList = useMemo(() => {
    const list: string[] = [];
    clinicalSpecs.shadeGuides.forEach(g => {
      g.shades.forEach(s => {
        if (!list.includes(s)) list.push(s);
      });
    });
    return list.length > 0
      ? list
      : ['A1', 'A2', 'A3', 'A3.5', 'A4', 'B1', 'B2', 'B3', 'B4', 'C1', 'C2', 'C3', 'C4', 'D2', 'D3', 'D4', 'BL1', 'BL2', 'BL3', 'BL4'];
  }, [clinicalSpecs]);

  // Teeth geometry merged with current clinical state — FDI id is the identity
  const teeth = useMemo(() => {
    return INITIAL_TEETH.map((tooth) => ({
      ...tooth,
      visual: visualFor(tooth.id, restorations, shades, toothDetailsState),
      selected: selectedSet.has(tooth.id),
    }));
  }, [restorations, shades, selectedSet, toothDetailsState]);

  const selectedTooth = teeth.find((t) => t.id === selectedToothId) ?? null;

  function getDisplayNumber(fdiTooth: number): number | string {
    return numbering === "FDI" ? fdiTooth : UNIVERSAL_NUMBERS[fdiTooth] || fdiTooth;
  }

  /* ---------------- state sync to parent (preserved contract) ---------------- */

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
      if (selectedToothId === tooth) {
        setSelectedToothId(nextSelected.length > 0 ? nextSelected[0] : null);
      }
    } else {
      nextSelected = [...selected, tooth].sort((a, b) => a - b);
      setSelectedToothId(tooth);
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

  function selectGroup(teethIds: number[]) {
    const isAlreadySelected =
      selected.length === teethIds.length &&
      teethIds.every((t) => selectedSet.has(t));
    const nextSelected = isAlreadySelected ? [] : teethIds;

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
    setSelectedToothId(nextSelected.length > 0 ? nextSelected[0] : null);
    emitChange(nextSelected, nextRestorations, nextShades, nextMaterials);
  }

  function applyRestoration(restType: string) {
    setActiveRestoration(restType);
    if (!selectedToothId) return;

    const nextRestorations = { ...restorations, [selectedToothId]: restType };
    setRestorations(nextRestorations);
    emitChange(selected, nextRestorations, shades, materials);
  }

  function applyMaterial(matName: string) {
    setActiveMaterial(matName);
    if (!selectedToothId) return;

    const nextMaterials = { ...materials, [selectedToothId]: matName };
    setMaterials(nextMaterials);
    emitChange(selected, restorations, shades, nextMaterials);
  }

  function applyShade(shadeVal: string) {
    setActiveShade(shadeVal);
    if (!selectedToothId) return;

    const nextShades = { ...shades, [selectedToothId]: shadeVal };
    setShades(nextShades);
    emitChange(selected, restorations, nextShades, materials);
  }

  function updateToothDetailField(tooth: number, key: keyof ToothDetailData, val: any) {
    const current = toothDetailsState[tooth] || { tooth_number: tooth };
    const updated = { ...toothDetailsState, [tooth]: { ...current, [key]: val } };
    setToothDetailsState(updated);
    emitChange(selected, restorations, shades, materials, updated);
  }

  // Active tooth information for the inspector
  const activeToothObj = selectedToothId ? {
    tooth: selectedToothId,
    displayNum: getDisplayNumber(selectedToothId),
    name: TOOTH_NAMES[selectedToothId] || `Tooth #${selectedToothId}`,
    type: INITIAL_TEETH.find((t) => t.id === selectedToothId)?.type ?? "central-incisor",
    restoration: restorations[selectedToothId] || activeRestoration || "crown",
    material: materials[selectedToothId] || activeMaterial || defaultMaterial,
    shade: shades[selectedToothId] || activeShade || "A2",
    details: toothDetailsState[selectedToothId] || {
      tooth_number: selectedToothId,
      notes: ""
    },
  } : null;

  // Restoration breakdown for the summary strip
  const conditionStats = useMemo(() => {
    const total = Math.max(selected.length, 1);
    const counts: Record<string, number> = {
      crown: 0, implant: 0, veneer: 0, inlay_onlay: 0, pontic: 0, abutment: 0, other: 0,
    };
    selected.forEach((t) => {
      const r = restorations[t] || "crown";
      if (counts[r] !== undefined) counts[r]++;
      else counts.other++;
    });

    return [
      { label: "Crowns", count: counts.crown, pct: selected.length ? Math.round((counts.crown / total) * 100) : 0, bg: "bg-indigo-400" },
      { label: "Implants", count: counts.implant, pct: selected.length ? Math.round((counts.implant / total) * 100) : 0, bg: "bg-purple-400" },
      { label: "Veneers", count: counts.veneer, pct: selected.length ? Math.round((counts.veneer / total) * 100) : 0, bg: "bg-violet-400" },
      { label: "Inlays/Onlays", count: counts.inlay_onlay, pct: selected.length ? Math.round((counts.inlay_onlay / total) * 100) : 0, bg: "bg-emerald-400" },
      { label: "Pontics", count: counts.pontic, pct: selected.length ? Math.round((counts.pontic / total) * 100) : 0, bg: "bg-amber-400" },
      { label: "Abutments", count: counts.abutment, pct: selected.length ? Math.round((counts.abutment / total) * 100) : 0, bg: "bg-cyan-400" },
    ];
  }, [selected, restorations]);

  /* =========================================================================
     RENDER
     ========================================================================= */

  return (
    <div className="dsp-odontogram w-full">

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-1.5 bg-white p-1 rounded-2xl border border-slate-200 text-xs font-bold shadow-2xs">
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

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => selectGroup(UPPER_PANORAMIC_TEETH)} className="dsp-chip">Upper Arch</button>
          <button type="button" onClick={() => selectGroup(LOWER_PANORAMIC_TEETH)} className="dsp-chip">Lower Arch</button>
          <button type="button" onClick={() => selectGroup(ALL_TEETH)} className="dsp-chip dsp-chip-accent">All 32 Units</button>
          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setSelected([]);
                setSelectedToothId(null);
                emitChange([], restorations, shades, materials);
              }}
              className="dsp-chip dsp-chip-danger"
            >
              <Trash2 className="w-3.5 h-3.5" /> Clear ({selected.length})
            </button>
          )}
        </div>
      </div>

      {/* Main 2-column layout: chart + inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">

        {/* Chart column */}
        <div className="lg:col-span-8 flex flex-col gap-4">
          <div className="bg-white rounded-3xl p-4 md:p-5 shadow-xs border border-slate-200">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900 tracking-tight flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-indigo-600 animate-pulse"></span>
                  Interactive Dental Odontogram (FDI Charting)
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Click any tooth to select it, then assign restoration, material, and shade.
                </p>
              </div>
              <span className="text-xs font-bold px-3 py-1 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-600/20">
                {selected.length} Units Active
              </span>
            </div>

            <svg
              className="dsp-chart-svg"
              viewBox="0 0 1000 690"
              preserveAspectRatio="xMidYMid meet"
              role="img"
              aria-label="32 tooth FDI dental odontogram"
            >
              {/* Arch guides */}
              <path d="M 112 130 Q 500 16 888 130" className="dsp-arch-guide" />
              <path d="M 112 545 Q 500 662 888 545" className="dsp-arch-guide" />

              {/* Midline */}
              <line x1="500" y1="58" x2="500" y2="648" className="dsp-midline" />

              {/* Jaw labels */}
              <text x="500" y="34" textAnchor="middle" className="dsp-jaw-label">MAXILLA</text>
              <text x="500" y="676" textAnchor="middle" className="dsp-jaw-label">MANDIBLE</text>

              {/* All 32 teeth — FDI id is the identity */}
              {teeth.map((tooth) => (
                <ToothNode
                  key={tooth.id}
                  tooth={tooth}
                  selected={tooth.selected}
                  displayNumber={getDisplayNumber(tooth.id)}
                  onClick={() => toggleTooth(tooth.id)}
                />
              ))}
            </svg>

            {/* Clinical color legend */}
            <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5 mt-3 pt-3 border-t border-slate-100 text-[11px] font-medium text-slate-500">
              <span className="inline-flex items-center gap-1.5"><span className="dsp-dot" style={{ background: "#4f46e5" }}></span> Crown</span>
              <span className="inline-flex items-center gap-1.5"><span className="dsp-dot" style={{ background: "#9333ea" }}></span> Implant</span>
              <span className="inline-flex items-center gap-1.5"><span className="dsp-dot" style={{ background: "#8b5cf6" }}></span> Veneer</span>
              <span className="inline-flex items-center gap-1.5"><span className="dsp-dot" style={{ background: "#10b981" }}></span> Inlay / Onlay</span>
              <span className="inline-flex items-center gap-1.5"><span className="dsp-dot" style={{ background: "#f59e0b" }}></span> Bridge Pontic</span>
              <span className="inline-flex items-center gap-1.5"><span className="dsp-dot" style={{ background: "#0891b2" }}></span> Abutment</span>
              <span className="inline-flex items-center gap-1.5"><span className="dsp-dot" style={{ background: "#7c3aed" }}></span> Post &amp; Core</span>
            </div>
          </div>

          {/* Restoration breakdown */}
          <div className="bg-white rounded-3xl p-4 md:p-5 shadow-xs border border-slate-200">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900 flex items-center gap-2">
                <Activity className="w-4 h-4 text-indigo-600" />
                Case Restorations Breakdown ({selected.length} Units)
              </h3>
              <span className="text-[11px] text-slate-400 font-semibold">Active Restorations</span>
            </div>
            <div className="grid grid-cols-6 gap-3 items-end h-24 px-2 text-center select-none">
              {conditionStats.map((stat, i) => (
                <div key={i} className="flex flex-col items-center gap-1.5 h-full justify-end">
                  <span className="text-[11px] font-bold text-slate-800">
                    {stat.count} <span className="text-[9px] text-slate-400 font-normal">({stat.pct}%)</span>
                  </span>
                  <div
                    className={`w-full max-w-[38px] ${stat.bg} rounded-xl transition-all duration-300 shadow-2xs`}
                    style={{ height: `${Math.max(12, Math.min(100, stat.pct * 2.2))}%` }}
                  ></div>
                  <span className="text-[10px] font-medium text-slate-500 truncate w-full">{stat.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Inspector column */}
        <div className="lg:col-span-4 flex flex-col gap-4">
          {activeToothObj ? (
            <div className="bg-white rounded-3xl p-5 shadow-xs border border-slate-200">
              <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-200">
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-900">
                  Tooth Specification
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-indigo-50 text-indigo-700 border border-indigo-600/20">
                  Unit #{activeToothObj.displayNum}
                </span>
              </div>

              {/* Identification */}
              <div className="flex items-start gap-3.5 pb-4 border-b border-slate-100">
                <div className="w-12 h-16 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center shrink-0 shadow-2xs">
                  <ToothThumbnail type={activeToothObj.type} shade={SHADE_COLORS[activeToothObj.shade] || "#ffffff"} prep={activeToothObj.restoration} />
                </div>
                <div className="leading-tight flex-1 min-w-0">
                  <h3 className="text-sm font-black text-indigo-700 truncate">
                    {activeToothObj.name}
                  </h3>
                </div>
              </div>

              {/* Shade */}
              <div className="py-3 border-b border-slate-100 space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                    VITA Shade Guide:
                  </label>
                  <span className="text-xs font-mono font-bold text-indigo-700">{activeToothObj.shade}</span>
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
                          : "bg-white hover:bg-slate-100 text-slate-600 border-slate-200"
                      }`}
                    >
                      <span
                        className="w-2.5 h-2.5 rounded-full border border-slate-400/40"
                        style={{ background: SHADE_COLORS[s] || "#FFFFFF" }}
                      />
                      <span>{s}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Per-tooth notes (prefix "C:" flags caries, "F:" flags a filling marker) */}
              <div className="pt-3">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                  Per-Tooth Notes (Unit #{activeToothObj.tooth}):
                </label>
                <textarea
                  rows={2}
                  value={activeToothObj.details.notes || ""}
                  onChange={(e) => updateToothDetailField(activeToothObj.tooth, "notes", e.target.value)}
                  placeholder="Incisal translucency, margin finish line, stump shade..."
                  className="w-full p-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-500 resize-none text-slate-900"
                />
                <p className="mt-1 text-[10px] text-slate-400">
                  Chart markers: start a note with <span className="font-mono font-bold text-slate-500">C:</span> for caries or <span className="font-mono font-bold text-slate-500">F:</span> for an intracoronal filling.
                </p>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-3xl p-6 shadow-xs border border-slate-200 text-center py-12">
              <Stethoscope className="w-10 h-10 text-slate-300 mx-auto mb-2" />
              <p className="text-xs font-bold text-slate-900">No tooth currently selected</p>
              <p className="text-[11px] text-slate-400 mt-0.5">Click any tooth on the dental chart to inspect and configure.</p>
            </div>
          )}

          {/* Selected units list */}
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
                  const s = shades[t] || "A2";
                  const mat = materials[t] || activeMaterial || defaultMaterial;
                  const isCurrent = selectedToothId === t;
                  return (
                    <div
                      key={t}
                      onClick={() => setSelectedToothId(t)}
                      className={`p-2.5 bg-white rounded-2xl border transition-all flex items-center justify-between cursor-pointer hover:border-indigo-500/40 ${
                        isCurrent ? "border-indigo-600 ring-2 ring-indigo-600/15 shadow-xs" : "border-slate-200"
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-10 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-center p-1 shrink-0">
                          <span className="font-mono font-black text-xs text-slate-900">
                            #{getDisplayNumber(t)}
                          </span>
                        </div>
                        <div className="leading-tight min-w-0">
                          <h4 className="text-xs font-bold text-slate-900 truncate">
                            {TOOTH_NAMES[t] ? TOOTH_NAMES[t].split("(")[0] : `Tooth #${t}`}
                          </h4>
                          <p className="text-[10px] text-slate-500 mt-0.5 truncate">
                            {mat.split("(")[0]} • <span className="font-bold text-indigo-700">{s}</span>
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

function prepLabel(prepTypes: ClinicalPrepType[], id: string): string {
  const found = prepTypes.find((p) => p.id === id);
  return found ? found.name : id;
}

/* =========================================================================
   TOOTH NODE (SVG)
   ========================================================================= */

function ToothNode({
  tooth,
  selected,
  displayNumber,
  onClick,
}: {
  tooth: Tooth & { visual: ToothVisual; selected: boolean };
  selected: boolean;
  displayNumber: number | string;
  onClick: () => void;
}) {
  const upper = tooth.arch === "upper";
  const label = displayNumber;

  return (
    <g
      className="dsp-tooth"
      transform={`translate(${tooth.x} ${tooth.y}) rotate(${tooth.rotation})`}
      onClick={onClick}
      tabIndex={0}
      role="button"
      aria-label={`Tooth ${tooth.id}`}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
    >
      {selected && (
        <ellipse cx="0" cy="0" rx="24" ry="40" className="dsp-selection-halo" />
      )}

      {/* Posterior crowns get a slight horizontal taper so adjacent units never touch */}
      <g transform={isPosterior(tooth.type) ? "scale(0.84 1)" : undefined}>
        <ToothShape type={tooth.type} arch={tooth.arch} selected={selected} shade={tooth.visual.shade} />
      </g>

      <ClinicalOverlay
        state={{
          prep: tooth.visual.prep,
          filling: !!tooth.visual.filling,
          caries: !!tooth.visual.caries,
        }}
        arch={tooth.arch}
        type={tooth.type}
      />

      <text
        x="0"
        y={upper ? "-56" : "56"}
        textAnchor="middle"
        className={selected ? "dsp-fdi-number dsp-fdi-active" : "dsp-fdi-number"}
        transform={`rotate(${-tooth.rotation})`}
      >
        {label}
      </text>
    </g>
  );
}

/* =========================================================================
   ANATOMICAL TOOTH SHAPES — 8 differentiated types, upper/lower variants
   ========================================================================= */

function ToothShape({
  type,
  arch,
  selected,
  shade,
}: {
  type: ToothType;
  arch: Arch;
  selected: boolean;
  shade?: string;
}) {
  const toothClass = selected ? "dsp-tooth-shape dsp-tooth-selected" : "dsp-tooth-shape";
  const fill = shade ? SHADE_COLORS[shade] || "#ffffff" : "#ffffff";
  const upper = arch === "upper";

  switch (type) {
    case "central-incisor":
      return (
        <path
          className={toothClass}
          style={shade ? { fill } : undefined}
          d={upper
            ? `M -13 22 C -15 13 -15 1 -13 -11 C -12 -20 -8 -28 0 -30 C 8 -28 12 -20 13 -11 C 15 1 15 13 13 22 C 8 27 4 29 0 29 C -4 29 -8 27 -13 22 Z`
            : `M -13 -22 C -15 -13 -15 -1 -13 11 C -12 20 -8 28 0 30 C 8 28 12 20 13 11 C 15 1 15 -13 13 -22 C 8 -27 4 -29 0 -29 C -4 -29 -8 -27 -13 -22 Z`}
        />
      );
    case "lateral-incisor":
      return (
        <path
          className={toothClass}
          style={shade ? { fill } : undefined}
          d={upper
            ? `M -11 21 C -13 11 -13 0 -11 -11 C -10 -19 -6 -25 0 -27 C 6 -25 10 -19 11 -11 C 13 0 13 11 11 21 C 6 26 3 27 0 27 C -3 27 -6 26 -11 21 Z`
            : `M -11 -21 C -13 -11 -13 0 -11 11 C -10 19 -6 25 0 27 C 6 25 10 19 11 11 C 13 0 13 -11 11 -21 C 6 -26 3 -27 0 -27 C -3 -27 -6 -26 -11 -21 Z`}
        />
      );
    case "canine":
      return (
        <path
          className={toothClass}
          style={shade ? { fill } : undefined}
          d={upper
            ? `M -15 21 C -16 11 -15 0 -12 -12 C -9 -22 -4 -28 0 -36 C 4 -28 9 -22 12 -12 C 15 0 16 11 15 21 C 9 27 5 30 0 30 C -5 30 -9 27 -15 21 Z`
            : `M -15 -21 C -16 -11 -15 0 -12 12 C -9 22 -4 28 0 36 C 4 28 9 22 12 12 C 15 0 16 -11 15 -21 C 9 -27 5 -30 0 -30 C -5 -30 -9 -27 -15 -21 Z`}
        />
      );
    case "first-premolar":
      return (
        <path
          className={toothClass}
          style={shade ? { fill } : undefined}
          d={upper
            ? `M -17 20 C -18 10 -17 0 -14 -11 C -12 -20 -8 -27 -3 -29 C -1 -26 -1 -22 0 -18 C 1 -22 2 -26 4 -29 C 9 -27 13 -20 15 -11 C 18 0 18 10 17 20 C 11 26 6 29 0 29 C -6 29 -11 26 -17 20 Z`
            : `M -17 -20 C -18 -10 -17 0 -14 11 C -12 20 -8 27 -3 29 C -1 26 -1 22 0 18 C 1 22 2 26 4 29 C 9 27 13 20 15 11 C 18 0 18 -10 17 -20 C 11 -26 6 -29 0 -29 C -6 -29 -11 -26 -17 -20 Z`}
        />
      );
    case "second-premolar":
      return (
        <path
          className={toothClass}
          style={shade ? { fill } : undefined}
          d={upper
            ? `M -18 20 C -19 10 -18 0 -15 -11 C -13 -20 -9 -26 -3 -29 C -1 -26 -1 -23 0 -19 C 1 -23 2 -26 4 -29 C 9 -26 14 -20 16 -11 C 19 0 19 10 18 20 C 12 26 7 29 0 29 C -7 29 -12 26 -18 20 Z`
            : `M -18 -20 C -19 -10 -18 0 -15 11 C -13 20 -9 26 -3 29 C -1 26 -1 23 0 19 C 1 23 2 26 4 29 C 9 26 14 20 16 11 C 19 0 19 -10 18 -20 C 12 -26 7 -29 0 -29 C -7 -29 -12 -26 -18 -20 Z`}
        />
      );
    case "first-molar":
      return (
        <path
          className={toothClass}
          style={shade ? { fill } : undefined}
          d={upper
            ? `M -23 20 C -25 9 -24 -3 -21 -13 C -18 -23 -12 -29 -5 -31 C -2 -29 -1 -25 0 -21 C 1 -25 3 -29 6 -31 C 13 -29 19 -23 22 -13 C 25 -3 25 9 23 20 C 17 27 9 31 0 31 C -9 31 -17 27 -23 20 Z`
            : `M -23 -20 C -25 -9 -24 3 -21 13 C -18 23 -12 29 -5 31 C -2 29 -1 25 0 21 C 1 25 3 29 6 31 C 13 29 19 23 22 13 C 25 3 25 -9 23 -20 C 17 -27 9 -31 0 -31 C -9 -31 -17 -27 -23 -20 Z`}
        />
      );
    case "second-molar":
      return (
        <path
          className={toothClass}
          style={shade ? { fill } : undefined}
          d={upper
            ? `M -24 20 C -26 8 -25 -4 -21 -14 C -18 -23 -12 -29 -5 -31 C -2 -29 -1 -25 0 -21 C 1 -25 3 -29 6 -31 C 13 -29 19 -23 22 -14 C 26 -4 26 8 24 20 C 18 28 9 31 0 31 C -9 31 -18 28 -24 20 Z`
            : `M -24 -20 C -26 -8 -25 4 -21 14 C -18 23 -12 29 -5 31 C -2 29 -1 25 0 21 C 1 25 3 29 6 31 C 13 29 19 23 22 14 C 26 4 26 -8 24 -20 C 18 -28 9 -31 0 -31 C -9 -31 -18 -28 -24 -20 Z`}
        />
      );
    case "third-molar":
      return (
        <path
          className={toothClass}
          style={shade ? { fill } : undefined}
          d={upper
            ? `M -26 19 C -28 8 -27 -4 -23 -14 C -19 -24 -12 -29 -5 -30 C -2 -28 -1 -24 0 -20 C 2 -24 3 -28 7 -30 C 14 -29 21 -23 24 -14 C 28 -4 28 8 26 19 C 19 27 10 30 0 30 C -10 30 -19 27 -26 19 Z`
            : `M -26 -19 C -28 -8 -27 4 -23 14 C -19 24 -12 29 -5 30 C -2 28 -1 24 0 20 C 2 24 3 28 7 30 C 14 29 21 23 24 14 C 28 4 28 -8 26 -19 C 19 -27 10 -30 0 -30 C -10 -30 -19 -27 -26 -19 Z`}
        />
      );
  }
}

/* =========================================================================
   CLINICAL OVERLAYS — conditions drawn on top of intact anatomy
   ========================================================================= */

function ClinicalOverlay({
  state,
  arch,
  type,
}: {
  state: { prep?: string; filling?: boolean; caries?: boolean };
  arch: Arch;
  type: ToothType;
}) {
  const upper = arch === "upper";
  const prep = state.prep;
  const posterior = isPosterior(type);

  return (
    <g pointerEvents="none">
      {/* Occlusal fissure pattern for posterior teeth */}
      {posterior && (
        <path
          d={upper
            ? `M -11 -3 L 0 5 L 11 -3 M 0 5 L -7 11 M 0 5 L 7 11`
            : `M -11 3 L 0 -5 L 11 3 M 0 -5 L -7 -11 M 0 -5 L 7 -11`}
          className="dsp-tooth-detail"
        />
      )}

      {state.caries && (
        <circle cx="0" cy="3" r="5" className="dsp-caries" />
      )}

      {state.filling && (
        <path
          d={`M -9 -3 Q 0 -10 9 -3 L 6 6 Q 0 10 -6 6 Z`}
          className="dsp-filling"
          transform={upper ? undefined : "scale(1,-1)"}
        />
      )}

      {/* Prep-type overlays */}
      {prep === "crown" && (
        <path
          d={upper
            ? `M -19 -16 Q 0 -31 19 -16 L 15 13 Q 0 21 -15 13 Z`
            : `M -19 16 Q 0 31 19 16 L 15 -13 Q 0 -21 -15 -13 Z`}
          className="dsp-crown"
        />
      )}
      {prep === "veneer" && (
        <path
          d={upper
            ? `M -13 -20 C -14 -8 -14 6 -12 18`
            : `M -13 20 C -14 8 -14 -6 -12 -18`}
          className="dsp-veneer"
        />
      )}
      {prep === "inlay_onlay" && (
        <path
          d={upper
            ? `M -9 -2 L 0 4 L 9 -2 M 0 4 L -5 9 M 0 4 L 5 9`
            : `M -9 2 L 0 -4 L 9 2 M 0 -4 L -5 -9 M 0 -4 L 5 -9`}
          className="dsp-inlay"
        />
      )}
      {prep === "pontic" && (
        <ellipse cx="0" cy={upper ? 8 : -8} rx="14" ry="9" className="dsp-pontic" />
      )}
      {prep === "abutment" && (
        <g>
          <rect x="-8" y={upper ? 10 : -18} width="16" height="8" rx="2" className="dsp-abutment" />
        </g>
      )}
      {prep === "implant" && (
        <g>
          <rect x="-5" y={upper ? -18 : -18} width="10" height="36" rx="3" className="dsp-implant" />
          <path
            d={`M -5 -11 H 5 M -5 -4 H 5 M -5 3 H 5 M -5 10 H 5`}
            className="dsp-implant-lines"
          />
        </g>
      )}
      {prep === POST_CORE && (
        <path
          d={upper ? `M 0 -18 L 0 19` : `M 0 18 L 0 -19`}
          className="dsp-post-core"
        />
      )}
      {prep === "coping" && (
        <path
          d={upper
            ? `M -17 -14 Q 0 -28 17 -14 L 13 12 Q 0 19 -13 12 Z`
            : `M -17 14 Q 0 28 17 14 L 13 -12 Q 0 -19 -13 -12 Z`}
          className="dsp-coping"
        />
      )}
    </g>
  );
}

/* =========================================================================
   INSPECTOR THUMBNAIL — same anatomy as the chart, rendered from ToothType
   ========================================================================= */

function ToothThumbnail({ type, shade, prep }: { type: ToothType; shade: string; prep: string }) {
  const paths: Record<ToothType, string> = {
    "central-incisor": "M 6 28 C 4 20 4 10 6 2 C 9 -1 15 -1 18 2 C 20 10 20 20 18 28 C 15 31 9 31 6 28 Z",
    "lateral-incisor": "M 7 27 C 5 19 5 10 7 3 C 10 0 14 0 17 3 C 19 10 19 19 17 27 C 14 30 10 30 7 27 Z",
    "canine": "M 6 27 C 4 19 5 10 9 -3 C 11 3 14 3 15 -3 C 19 10 20 19 18 27 C 15 30 9 30 6 27 Z",
    "first-premolar": "M 4 26 C 2 18 3 9 7 0 C 9 3 11 3 12 0 C 13 3 15 3 17 0 C 21 9 22 18 20 26 C 15 30 9 30 4 26 Z",
    "second-premolar": "M 4 26 C 2 18 3 9 7 0 C 9 3 11 3 12 0 C 13 3 15 3 17 0 C 21 9 22 18 20 26 C 15 30 9 30 4 26 Z",
    "first-molar": "M 3 25 C 1 17 2 8 6 -1 C 9 2 11 2 12 -1 C 13 2 16 2 18 -1 C 22 8 23 17 21 25 C 15 29 9 29 3 25 Z",
    "second-molar": "M 3 25 C 1 17 2 8 6 -1 C 9 2 11 2 12 -1 C 13 2 16 2 18 -1 C 22 8 23 17 21 25 C 15 29 9 29 3 25 Z",
    "third-molar": "M 2 24 C 0 16 1 8 5 0 C 8 3 10 3 12 0 C 14 3 16 3 19 0 C 23 8 24 16 22 24 C 15 28 9 28 2 24 Z",
  };
  const isImplant = prep === "implant";

  return (
    <svg className="w-6 h-12" viewBox="0 0 24 32">
      {isImplant ? (
        <g>
          <rect x="9" y="6" width="6" height="22" rx="2.5" fill="#aeb9c1" stroke="#65727b" strokeWidth="1" />
          <path d="M 9 12 H 15 M 9 17 H 15 M 9 22 H 15" stroke="#65727b" strokeWidth="1" fill="none" />
        </g>
      ) : (
        <path d={paths[type]} fill={shade} stroke="#4f46e5" strokeWidth="1.3" />
      )}
    </svg>
  );
}
