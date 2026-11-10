import React, { useMemo, useState, useEffect, useLayoutEffect, useRef } from "react";
import ReactOdontogram, { type ToothDetail } from 'react-odontogram';
import 'react-odontogram/style.css';
import { useOptionalApp } from '../../context/AppContext';
import { isThemeMode } from '../../theme/theme';
import { getTodayStr } from '../../utils/dateUtils';
import {
  Trash2,
  Activity,
} from "lucide-react";
import "./Odontogram.css";
import {
  getClinicalSpecs
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

/*
 * Generates a natural parabolic dental arch.
 * x increases left -> right, y increases top -> bottom.
 * Upper arch: posterior edges at top (edgeY), centrals dip toward the
 * occlusal band (centerY). Lower arch mirrors it. Spacing (51.7 units)
 * exceeds the widest adjacent crown pair (~50 units) so teeth never overlap.
 */
function createArch(ids: ToothId[], arch: Arch): Tooth[] {
  const centerX = 500;
  const leftX = 34;
  const rightX = 966;
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

/** Width of the notation strips' viewBox. `getCTM()` reports tooth centres in
 *  the library chart's PIXEL space (it includes the viewBox scale), so measured
 *  x values are divided into strip units by this ratio. */
const NUMBER_STRIP_WIDTH = 900;

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
   Prep types mapped to chart fills — the chart colors each tooth by its prep.
   `teethConditions` in react-odontogram paints the tooth's shadow path; the
   outline stays the palette's stroke so lettering stays legible on dark.
   ========================================================================= */

const PREP_COLORS: Record<string, { outlineColor: string; fillColor: string }> = {
  crown: { outlineColor: '#3730a3', fillColor: '#6366f1' },
  implant: { outlineColor: '#7e22ce', fillColor: '#a855f7' },
  veneer: { outlineColor: '#6d28d9', fillColor: '#8b5cf6' },
  inlay_onlay: { outlineColor: '#047857', fillColor: '#10b981' },
  pontic: { outlineColor: '#b45309', fillColor: '#f59e0b' },
  abutment: { outlineColor: '#155e75', fillColor: '#0891b2' },
  post_core: { outlineColor: '#5b21b6', fillColor: '#7c3aed' },
  coping: { outlineColor: '#475569', fillColor: '#64748b' },
};

const PREP_LABELS: Record<string, string> = {
  crown: 'Crown',
  implant: 'Implant',
  veneer: 'Veneer',
  inlay_onlay: 'Inlay / Onlay',
  pontic: 'Bridge Pontic',
  abutment: 'Abutment',
  post_core: 'Post & Core',
  coping: 'Coping',
};

/* The quick-prep chips under the chart, in catalog order. */
const PREP_MENU = Object.entries(PREP_LABELS).map(([id, label]) => ({
  id,
  label,
  color: PREP_COLORS[id],
}));

/* =========================================================================
   MAIN COMPONENT
   ========================================================================= */

function Odontogram({
  /* Empty by default. The previous [11, 21] default meant a brand-new case was
     born with two teeth charted that nobody selected — they reached the
     odontogram, tooth_details, the job slip and the billable-unit count. A
     caller that genuinely wants a pre-filled chart passes `initialSelected`. */
  initialSelected = [],
  initialRestorations = {},
  initialShades = {},
  initialMaterials = {},
  defaultMaterial = 'Zirconia (Multi-layer 3D Pro)',
  onChange,
}: OdontogramProps) {
  /* The app paints light and dark by class; the library ships its own palette
     so it needs the string. `userPreferences.theme_mode` + the OS media query
     is the same resolution the global bootstrap uses. */
  const appContext = useOptionalApp();
  const userPreferences = appContext?.userPreferences;
  const themeMode = isThemeMode(userPreferences?.theme_mode) ? userPreferences.theme_mode : 'system';
  const [isDark, setIsDark] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return themeMode !== 'light';
    return themeMode === 'system' ? window.matchMedia('(prefers-color-scheme: dark)').matches : themeMode === 'dark';
  });

  useEffect(() => {
    const mq = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : null;
    const resolve = () => setIsDark(themeMode === 'system' ? !!mq?.matches : themeMode === 'dark');
    resolve();
    if (!mq) return undefined;
    mq.addEventListener('change', resolve);
    return () => mq.removeEventListener('change', resolve);
  }, [themeMode]);
  const [numbering, setNumbering] = useState<"FDI" | "Universal">("FDI");
  const [selected, setSelected] = useState<number[]>(initialSelected);
  const [restorations, setRestorations] = useState<Record<number, string>>(initialRestorations);
  const [shades, setShades] = useState<Record<number, string>>(initialShades);
  const [materials, setMaterials] = useState<Record<number, string>>(initialMaterials);
  const [toothDetailsState] = useState<Record<number, ToothDetailData>>({});
  const [activeRestoration] = useState("crown");
  const [activeMaterial] = useState(defaultMaterial);
  const [activeShade, setActiveShade] = useState("A2");
  const [selectedToothId, setSelectedToothId] = useState<number | null>(initialSelected[0] || null);

/* Clinical specs — BUNDLED, not editable.
   *
   * The comment here used to read "Dynamic Clinical Specs from Settings", and a
   * listener for a `clinical-specs-updated` event that nothing in the codebase
   * ever dispatched: `clinicalSpecsService` exposes `getClinicalSpecs()` and no
   * writer, and there is no Settings tab for materials, prep types, shade
   * guides or implant brands. So the specs are seeded once at install and are
   * read-only forever — which is a defensible design, but not one the code was
   * honest about.
   *
   * The listener is kept because it costs nothing and is the correct seam IF a
   * settings editor is ever added: the service already returns the current
   * specs, so a `dispatchEvent(new Event('clinical-specs-updated'))` from a
   * future writer would light this up with no change here.
   *
   * KNOWN INEFFICIENCY, deliberately left as-is for now.
   * `useState(getClinicalSpecs())` evaluates its argument on EVERY render and
   * keeps only the first result, while getClinicalSpecs issues four SQL reads
   * (materials, prep types, shade guides, implant brands) — eight on a database
   * that has not been seeded yet. On a chart that re-renders as the operator
   * hovers and selects teeth, that is a pile of discarded queries per
   * interaction. `useState(() => getClinicalSpecs())` is the fix.
   *
   * It is not applied because tests/components/odontogramMemo.test.tsx uses the
   * call count of this very function as its render counter: the lazy initialiser
   * runs once per MOUNT, so both arms of the memoisation benchmark would read 0
   * and the test would pass no matter what the component did. Applying the fix
   * requires that test to grow a render-counting seam that does not depend on
   * this call — there is currently no externally mockable function in the
   * render body (isPosterior is local, getTodayStr is only reached from an
   * event handler). Worth doing; not worth doing blind. */
  const [clinicalSpecs, setClinicalSpecs] = useState(getClinicalSpecs());

  useEffect(() => {
    const handleSpecsUpdate = () => {
      setClinicalSpecs(getClinicalSpecs());
    };
    window.addEventListener('clinical-specs-updated', handleSpecsUpdate);
    return () => window.removeEventListener('clinical-specs-updated', handleSpecsUpdate);
  }, []);

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  /* The chart library keeps its own selection state; bumping this reseeds it
     whenever WE change the selection outside the chart (arch buttons, clear,
     the per-tooth remove X). */
  const [chartKey, setChartKey] = useState(0);
  /* Visible tooth numbers layered over the library chart. The library keeps its
     teeth as unlabelled outlines, so we measure each tooth once per remount and
     paint the active notation on its crown — same viewBox, so the overlay
     scales exactly like the chart. */
  const chartWrapRef = useRef<HTMLDivElement>(null);
  const [numberOverlay, setNumberOverlay] = useState<{
    upper: { id: number; x: number }[];
    lower: { id: number; x: number }[];
  } | null>(null);

  useLayoutEffect(() => {
    const wrap = chartWrapRef.current;
    if (!wrap) return;
    const libSvg = wrap.querySelector('.Odontogram svg');
    if (!libSvg) return;
    try {
      /* getCTM maps to the SVG's viewport space, i.e. CSS pixels with the
         viewBox scale already applied — NOT viewBox user units. The strips
         stretch NUMBER_STRIP_WIDTH units across the same pixels, so measured
         x values must be inflated into viewBox units or the numbers drift
         progressively leftwards towards the distal teeth. */
      const libWidth = (libSvg as SVGSVGElement).getBoundingClientRect().width;
      const pxToViewBox = libWidth > 0 ? NUMBER_STRIP_WIDTH / libWidth : 1;
      const teeth = [...libSvg.querySelectorAll('g[class^="teeth-"]')].map((g) => {
        const el = g as SVGGraphicsElement;
        const cls = el.getAttribute('class') || '';
        const fdi = Number.parseInt(cls.split(/\s+/)[0].replace('teeth-', ''), 10);
        /* getBBox speaks the element's LOCAL user space, which is why mirrored
           quadrants interleaved. getCTM maps it onto the svg's viewport. */
        const bb = el.getBBox();
        const centre = new DOMPoint(bb.x + bb.width / 2, bb.y + bb.height / 2).matrixTransform(
          el.getCTM() as DOMMatrix,
        );
        return { id: fdi, x: centre.x * pxToViewBox };
      });
      const upper = teeth.filter((t) => t.id < 30).sort((a, b) => a.x - b.x);
      const lower = teeth.filter((t) => t.id >= 30).sort((a, b) => a.x - b.x);
      setNumberOverlay({ upper, lower });
    } catch {
      // jsdom has no getBBox; the chart works without the overlay in tests.
      setNumberOverlay(null);
    }
  }, [chartKey, numbering]);

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

  // Notation follows the toggle; conditions colour each tooth by its prep type.
  const conditionGroups = useMemo(() => {
    const byPrep = new Map<string, number[]>();
    selected.forEach((t) => {
      const prep = restorations[t] || "crown";
      const list = byPrep.get(prep) || [];
      list.push(t);
      byPrep.set(prep, list);
    });
    const groups: { label: string; teeth: string[]; outlineColor: string; fillColor: string }[] = [];
    byPrep.forEach((ids, prep) => {
      const color = PREP_COLORS[prep];
      if (!color || ids.length === 0) return;
      groups.push({ label: PREP_LABELS[prep] || prep, teeth: ids.map((i) => `teeth-${i}`), ...color });
    });
    return groups;
  }, [selected, restorations]);

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
        date: existing.date || getTodayStr(),
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

  const parseToothId = (id: string): number => Number.parseInt(id.replace('teeth-', ''), 10);

  /* Quick prep assignment straight from the chart: the chips colour every
     selected unit the same way `Teeth & Shade` does. A menu appears the moment
     something is charted — no trip down to the inspector mid-flow. */
  const applyPrepToSelection = (prep: string) => {
    if (selected.length === 0) return;
    const next = { ...restorations };
    selected.forEach((t) => {
      next[t] = prep;
    });
    setRestorations(next);
    emitChange(selected, next, shades, materials);
  };

  /* One path for every selection change we originate (arch buttons, the per-tooth
     remove X, "clear"). Restoration/shade/material defaults are defaulted for
     newly charted teeth, the chart is reseeded, and the parent is notified. */
  function applySelection(
    nextSelected: number[],
    focusTooth?: number | null,
  ) {
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
    if (focusTooth !== undefined) setSelectedToothId(focusTooth);
    setChartKey((k) => k + 1);
    emitChange(nextSelected, nextRestorations, nextShades, nextMaterials);
  }

  /* The chart owns its internal state and reports the WHOLE selection on every
     change. We reconcile that with our per-tooth bookkeeping and keep the
     inspector pointed at the most recently charted tooth. */
  function handleChartSelection(items: ToothDetail[]) {
    const next = items.map((t) => parseToothId(t.id)).sort((a, b) => a - b);
    const nextRestorations = { ...restorations };
    const nextShades = { ...shades };
    const nextMaterials = { ...materials };
    next.forEach((t) => {
      if (!nextRestorations[t]) nextRestorations[t] = activeRestoration || "crown";
      if (!nextShades[t]) nextShades[t] = activeShade || "A2";
      if (!nextMaterials[t]) nextMaterials[t] = activeMaterial || defaultMaterial;
    });

    setSelected(next);
    setRestorations(nextRestorations);
    setShades(nextShades);
    setMaterials(nextMaterials);

    const added = next.find((id) => !selectedSet.has(id));
    if (added !== undefined) {
      setSelectedToothId(added);
    } else if (next.length === 0) {
      setSelectedToothId(null);
    } else {
      setSelectedToothId((current) =>
        current !== null && next.includes(current) ? current : next[next.length - 1],
      );
    }
    emitChange(next, nextRestorations, nextShades, nextMaterials);
  }

  function toggleTooth(tooth: number) {
    const isSel = selectedSet.has(tooth);
    const next = isSel ? selected.filter((t) => t !== tooth) : [...selected, tooth].sort((a, b) => a - b);
    applySelection(next, isSel ? (next.length ? next[0] : null) : tooth);
  }

  function selectGroup(teethIds: number[]) {
    const isAlreadySelected =
      selected.length === teethIds.length &&
      teethIds.every((t) => selectedSet.has(t));
    applySelection(isAlreadySelected ? [] : [...teethIds], isAlreadySelected ? null : teethIds[0] ?? null);
  }

  /**
   * A shade applies to the WHOLE selection, not just the inspected tooth.
   *
   * The operator picks a shade once for the job: a bridge's abutments and
   * pontics are matched to each other, so per-tooth shade entry is only a
   * last-resort override. Writing to `selectedToothId` alone left a 3-unit case
   * with 3 different shades from one click, and the inspector showed the shade
   * the operator did NOT just pick.
   *
   * One tooth keeps the old behaviour exactly, so a deliberate per-tooth
   * override on a single tooth still works.
   */
  function applyShade(shadeVal: string) {
    setActiveShade(shadeVal);
    if (!selectedToothId) return;

    const targets = selected.length > 1 ? selected : [selectedToothId];
    const nextShades = { ...shades };
    targets.forEach((t) => {
      nextShades[t] = shadeVal;
    });
    setShades(nextShades);
    emitChange(selected, restorations, nextShades, materials);
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

    const BAR_COLORS = {
      crown: "var(--brand-600)",
      implant: "#c084fc",
      veneer: "#a78bfa",
      inlay_onlay: "#34d399",
      pontic: "#fbbf24",
      abutment: "#22d3ee",
    } as const;
    const pick = (count: number, fill: string, label: string) => ({
      label,
      count,
      pct: selected.length ? Math.round((count / total) * 100) : 0,
      fill,
    });

    return [
      pick(counts.crown, BAR_COLORS.crown, "Crowns"),
      pick(counts.implant, BAR_COLORS.implant, "Implants"),
      pick(counts.veneer, BAR_COLORS.veneer, "Veneers"),
      pick(counts.inlay_onlay, BAR_COLORS.inlay_onlay, "Inlays/Onlays"),
      pick(counts.pontic, BAR_COLORS.pontic, "Pontics"),
      pick(counts.abutment, BAR_COLORS.abutment, "Abutments"),
    ];
  }, [selected, restorations]);

  /* =========================================================================
     RENDER
     ========================================================================= */

  return (
    <div className="dsp-odontogram w-full">

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="dsp-arch-group" role="group" aria-label="Notation system">
          <button
            type="button"
            onClick={() => setNumbering("FDI")}
            className="dsp-arch-btn"
            data-active={numbering === "FDI"}
            aria-pressed={numbering === "FDI"}
            title="World standard ISO FDI two-digit numbering (11-48)"
          >
            FDI (11–48)
          </button>
          <button
            type="button"
            onClick={() => setNumbering("Universal")}
            className="dsp-arch-btn"
            data-active={numbering === "Universal"}
            aria-pressed={numbering === "Universal"}
            title="Universal numbering system (1–32)"
          >
            Universal (1–32)
          </button>
        </div>

        <div className="dsp-arch-row">
          <div className="dsp-arch-group" role="group" aria-label="Arch selection">
            <button
              type="button"
              onClick={() => selectGroup(UPPER_PANORAMIC_TEETH)}
              className="dsp-arch-btn"
              data-active={UPPER_PANORAMIC_TEETH.every((t) => selectedSet.has(t))}
              aria-pressed={UPPER_PANORAMIC_TEETH.every((t) => selectedSet.has(t))}
            >
              Upper Arch
            </button>
            <button
              type="button"
              onClick={() => selectGroup(LOWER_PANORAMIC_TEETH)}
              className="dsp-arch-btn"
              data-active={LOWER_PANORAMIC_TEETH.every((t) => selectedSet.has(t))}
              aria-pressed={LOWER_PANORAMIC_TEETH.every((t) => selectedSet.has(t))}
            >
              Lower Arch
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => selectGroup(ALL_TEETH)}
              className="dsp-arch-all"
              data-active={ALL_TEETH.every((t) => selectedSet.has(t))}
              aria-pressed={ALL_TEETH.every((t) => selectedSet.has(t))}
            >
              All 32 Units
            </button>
            {selected.length > 0 && (
              <button
                type="button"
                onClick={() => applySelection([], null)}
                className="dsp-arch-clear"
              >
                <Trash2 className="w-3.5 h-3.5" /> Clear ({selected.length})
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main 2-column layout: chart + inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">

        {/* Chart column — full width */}
        <div className="lg:col-span-12 flex flex-col gap-4">
          <div className="dsp-odontogram-lib">
            <div className="dsp-panel-head">
              <div>
                <h3 className="dsp-panel-title">
                  <span className="dsp-panel-pulse" aria-hidden="true"></span>
                  Interactive Dental Odontogram
                  <span className="dsp-panel-title-note">({numbering} Charting)</span>
                </h3>
                <p className="dsp-panel-sub">
                  Click any tooth to select it, then assign restoration, material, and shade.
                </p>
              </div>
              <span className="dsp-panel-units">
                {selected.length} {selected.length === 1 ? 'Unit' : 'Units'} Active
              </span>
            </div>

            <div ref={chartWrapRef} className="flex flex-col">
              {/* Notation strip — upper arch, sits ABOVE the teeth */}
              {numberOverlay && (
                <svg viewBox={`0 0 ${NUMBER_STRIP_WIDTH} 22`} className="dsp-number-strip" aria-hidden="true">
                  {numberOverlay.upper.map(({ id, x }) => (
                    <text
                      key={id}
                      x={x}
                      y="11"
                      textAnchor="middle"
                      dominantBaseline="central"
                      className="dsp-number-label"
                    >
                      {getDisplayNumber(id)}
                    </text>
                  ))}
                </svg>
              )}
              <ReactOdontogram
                key={chartKey}
                theme={isDark ? 'dark' : 'light'}
                colors={isDark
                  ? { darkBlue: '#aab6ff', baseBlue: '#d0d5f6', lightBlue: '#5361e6' }
                  : { darkBlue: '#3e5edc', baseBlue: '#475569', lightBlue: '#c6ccf8' }}
                notation={numbering === "FDI" ? "FDI" : "Universal"}
                layout="square"
                className="w-full"
                defaultSelected={selected.map((t) => `teeth-${t}`)}
                teethConditions={conditionGroups}
                onChange={handleChartSelection}
                tooltip={{
                  content: (payload) =>
                    payload ? (
                      <span className="block leading-snug">
                        <span className="block font-bold">
                          {TOOTH_NAMES[parseToothId(payload.id)] || payload.type}
                        </span>
                        <span className="block text-[10px] opacity-75">
                          {payload.type} · Universal {payload.notations.universal} · Palmer {payload.notations.palmer}
                        </span>
                      </span>
                    ) : null,
                }}
              />
              {/* Notation strip — lower arch, sits BELOW the teeth */}
              {numberOverlay && (
                <svg viewBox={`0 0 ${NUMBER_STRIP_WIDTH} 22`} className="dsp-number-strip" aria-hidden="true">
                  {numberOverlay.lower.map(({ id, x }) => (
                    <text
                      key={id}
                      x={x}
                      y="11"
                      textAnchor="middle"
                      dominantBaseline="central"
                      className="dsp-number-label"
                    >
                      {getDisplayNumber(id)}
                    </text>
                  ))}
                </svg>
              )}
            </div>

            {/* Quick prep menu — appears the moment teeth are charted */}
            {selected.length > 0 && (
              <div className="dsp-prep-menu" role="toolbar" aria-label="Set prep type for selected teeth">
                <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
                  <span className="dsp-prep-menu-label whitespace-nowrap text-[10px] font-bold uppercase tracking-[0.16em]">
                    Set prep · <span className="dsp-prep-menu-count">{selected.length} unit{selected.length === 1 ? "" : "s"}</span>
                  </span>
                  <div className="flex flex-wrap items-center gap-1">
                    {PREP_MENU.map((option) => {
                      const active = selected.every((t) => (restorations[t] || "crown") === option.id);
                      return (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => applyPrepToSelection(option.id)}
                          aria-pressed={active}
                          title={`Set every selected tooth to ${option.label}`}
                          className={`dsp-prep-chip ${active ? "dsp-prep-chip-active" : ""}`}
                        >
                          <span
                            className="dsp-prep-chip-dot"
                            style={{ background: option.color.fillColor, borderColor: option.color.outlineColor }}
                          />
                          <span>{option.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => applySelection([], null)}
                  className="dsp-prep-chip dsp-prep-chip-clear"
                  title="Clear the selection"
                  aria-label="Clear the selection"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            </div>

          {/* Restoration breakdown */}
          <div className="dsp-breakdown-card">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <h3 className="text-xs font-bold uppercase tracking-wider dsp-spec-h flex items-center gap-2">
                <Activity className="w-4 h-4 text-brand-600" aria-hidden="true" />
                Case Restorations Breakdown
                <span className="dsp-panel-units">{selected.length} Units</span>
              </h3>
              <span className="dsp-spec-muted text-[11px] font-semibold">Active Restorations</span>
            </div>
            <div className="grid grid-cols-6 gap-2 sm:gap-3 select-none">
              {conditionStats.map((stat) => (
                <div key={stat.label} className="flex flex-col items-center gap-1.5 min-w-0">
                  <span className="dsp-breakdown-count">
                    {stat.count}
                    <span className="dsp-breakdown-pct">{stat.pct}%</span>
                  </span>
                  <div
                    className="dsp-breakdown-track"
                    role="img"
                    aria-label={`${stat.label}: ${stat.count} of ${selected.length} units (${stat.pct}%)`}
                  >
                    <div
                      className="dsp-breakdown-fill"
                      style={{
                        height: `${stat.count > 0 ? Math.max(10, stat.pct) : 0}%`,
                        background: stat.fill,
                      }}
                    />
                  </div>
                  <span className="dsp-breakdown-label">{stat.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Inspector column — moved below the chart so the teeth get the room */}
        <div className="lg:col-span-12 grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
          {/* Tooth Specification — always visible; disabled until a tooth is charted */}
          <div className="dsp-spec-card">
            <div className="flex items-center justify-between mb-3 pb-2 border-b dsp-spec-divider">
              <h2 className="text-xs font-bold uppercase tracking-wider dsp-spec-h">
                Tooth Specification
              </h2>
              <span className="dsp-spec-chip-unit inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-black uppercase">
                {activeToothObj ? `Unit #${activeToothObj.displayNum}` : 'No unit'}
              </span>
            </div>

            {/* Identification */}
            <div className="flex items-start gap-3.5 pb-4 border-b dsp-spec-divider">
              <div className="dsp-spec-thumb w-12 h-16 rounded-xl border flex items-center justify-center shrink-0 shadow-2xs">
                <ToothThumbnail
                  type={activeToothObj ? activeToothObj.type : 'central-incisor'}
                  shade={activeToothObj ? SHADE_COLORS[activeToothObj.shade] || '#ffffff' : '#ffffff'}
                  prep={activeToothObj ? activeToothObj.restoration : 'crown'}
                />
              </div>
              <div className="leading-tight flex-1 min-w-0">
                {activeToothObj ? (
                  <h3 className="text-sm font-black dsp-spec-ink truncate">
                    {activeToothObj.name}
                  </h3>
                ) : (
                  <>
                    <h3 className="text-sm font-black dsp-spec-muted truncate">No tooth charted</h3>
                    <p className="mt-1 text-[10px] dsp-spec-muted leading-snug">
                      Click any tooth on the chart to assign a restoration, material and shade.
                    </p>
                  </>
                )}
              </div>
            </div>

            {/* Shade */}
            <div className="py-3 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label className="text-[10px] font-bold uppercase tracking-wider dsp-spec-eyebrow">
                  VITA Shade Guide:
                </label>
                <span className="text-xs font-mono font-bold dsp-shade-value">
                  {activeToothObj ? activeToothObj.shade : '—'}
                </span>
              </div>
              <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto pr-1">
                {activeShadeList.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => applyShade(s)}
                    disabled={!activeToothObj}
                    aria-pressed={activeToothObj?.shade === s}
                    className={`dsp-shade-chip ${activeToothObj?.shade === s ? 'dsp-shade-chip-active' : ''} ${!activeToothObj ? 'dsp-shade-chip-empty' : ''}`}
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full border border-slate-400/40"
                      style={{ background: SHADE_COLORS[s] || '#FFFFFF' }}
                    />
                    <span>{s}</span>
                  </button>
                ))}
              </div>
              {!activeToothObj && (
                <p className="text-[10px] dsp-spec-muted pt-1">
                  The guide stays open for planning — it activates the moment a tooth is selected.
                </p>
              )}
            </div>
          </div>

          {/* Selected units list */}
          <div className="dsp-units-card space-y-3">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b dsp-spec-divider pb-3">
              <h4 className="text-xs font-bold uppercase tracking-wider dsp-spec-h">
                Case Selected Teeth Units ({selected.length})
              </h4>
              <span className="text-[11px] font-semibold dsp-spec-muted">Units in this job</span>
            </div>
            {selected.length === 0 ? (
              <div className="dsp-units-empty p-4 text-center text-xs dsp-spec-muted">
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
                      className={`p-2.5 dsp-units-row flex items-center justify-between cursor-pointer ${
                        isCurrent ? "dsp-units-row-active" : ""
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="dsp-spec-thumb w-8 h-10 rounded-lg border flex items-center justify-center p-1 shrink-0">
                          <span className="font-mono font-black text-xs dsp-spec-ink">
                            #{getDisplayNumber(t)}
                          </span>
                        </div>
                        <div className="leading-tight min-w-0">
                          <h4 className="text-xs font-bold dsp-spec-ink truncate">
                            {TOOTH_NAMES[t] ? TOOTH_NAMES[t].split("(")[0] : `Tooth #${t}`}
                          </h4>
                          <p className="text-[10px] dsp-spec-muted mt-0.5 truncate">
                            {mat.split("(")[0]} • <span className="font-bold dsp-shade-value">{s}</span>
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleTooth(t);
                        }}
                        className="p-1.5 dsp-spec-muted hover:text-rose-600 dark:hover:text-rose-300 hover:bg-rose-500/10 rounded-lg transition-colors cursor-pointer shrink-0"
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

/**
 * Memoised because this is the most expensive subtree in the case workflow:
 * 32 tooth groups, shade paths and clinical overlays. Measured at ~27ms per
 * render under jsdom, so a parent re-render that does not touch the chart
 * (file uploads, validation messages) should not pay for it.
 *
 * The `initial*` props are `useState` seeds only — they are read once on mount
 * and never re-synced — so skipping a re-render cannot strand the chart with
 * stale data. `CaseDetailModal` derives those objects with `useMemo` and keeps
 * `onChange` stable, otherwise the memo would never hit.
 */
export default React.memo(Odontogram);

/* =========================================================================
   INSPECTOR THUMBNAIL — same tooth-type silhouette the spec card prints
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
