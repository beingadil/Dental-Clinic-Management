import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { DentalCase, CaseStatus, PriorityLevel, CaseTemplate, ToothDetail, CaseAttachment } from '../../types';
import Odontogram, { SHADE_COLORS } from './Odontogram';
import { CaseAttachmentsPanel } from './CaseAttachmentsPanel';
import { CaseNotesPanel } from './CaseNotesPanel';
import { CaseJobSlipModal } from './CaseJobSlipModal';
import { CaseProgressIndicator } from './CaseProgressIndicator';
import { openFileInBrowser } from '../../utils/fileUtils';
import { getClinicalSpecs, ClinicalMaterial } from '../../services/clinicalSpecsService';
import {
  X,
  Check,
  Trash2,
  Bookmark,
  Clock,
  FileText,
  Paperclip,
  MessageSquare,
  DollarSign,
  AlertCircle,
  Printer,
  Maximize2,
  Minimize2,
  User,
  Eye,
  Download,
  File,
  Upload,
  CheckCircle2,
  Box,
  Layers,
  ExternalLink,
  Save,
  Palette,
  ArrowRight,
  ArrowLeft,
  CalendarDays,
  Sparkles
} from 'lucide-react';
import { PRIORITY_SLA_DAYS, prioritySlaLabel, computeSlaDueDate } from '../../services/prioritySla';

/* ------------------------------------------------------------------ */
/*  Design system — Soft Structuralism                                 */
/*  Warm cream canvas · espresso ink · teal accent · hairline bezels   */
/* ------------------------------------------------------------------ */

const EASE = 'ease-[cubic-bezier(0.32,0.72,0,1)]';

/* Module-level field primitives (no hooks — safe to define here) */

const Eyebrow: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <span className={`inline-flex items-center rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400 ${className}`}>
    {children}
  </span>
);

const FieldLabel: React.FC<{ children: React.ReactNode; required?: boolean }> = ({ children, required }) => (
  <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">
    {children}
    {required && <span className="ml-1 text-indigo-600">*</span>}
  </span>
);

const inputCls = `w-full rounded-xl bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 ring-1 ring-slate-200
  placeholder:text-slate-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] transition-all duration-500 ${EASE}
  hover:ring-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500/40`;

const bezelCard = `rounded-[1.5rem] bg-slate-900/[0.035] p-1.5 ring-1 ring-slate-900/10 shadow-[0_1px_2px_rgba(15,23,42,0.06)]`;
const bezelCardInner = `rounded-[calc(1.5rem-0.375rem)] bg-white p-6 shadow-[inset_0_1px_1px_rgba(255,255,255,0.9)]`;

interface CaseDetailModalProps {
  initialCase?: DentalCase | null; // null if creating new case
  appliedTemplate?: CaseTemplate | null;
  /** Pre-selected shade for a NEW case (e.g. picked in the dashboard shade guide). */
  initialShade?: string | null;
  onClose: () => void;
}

/* Wizard step definitions — attachments are NOT a creation gate: they are
   managed inside the Teeth & Shade step once the case exists. There is no
   fourth "review" step: step 3 is the last one and it ends with Create. */
type StepKey = 'basics' | 'chart' | 'schedule';

const STEPS: { key: StepKey; numeral: string; label: string; caption: string }[] = [
  { key: 'basics', numeral: '01', label: 'Procedure', caption: 'Clinic, doctor & case type' },
  { key: 'chart', numeral: '02', label: 'Teeth & Shade', caption: 'FDI charting & aesthetics' },
  { key: 'schedule', numeral: '03', label: 'Schedule & Price', caption: 'SLA, delivery, billing & review' },
];

export const CaseDetailModal: React.FC<CaseDetailModalProps> = ({
  initialCase,
  appliedTemplate,
  initialShade,
  onClose,
}) => {
  const {
    labs,
    caseTypes,
    pricingOverrides,
    addCase,
    updateCase,
    deleteCase,
    saveAsTemplate,
    getDoctorPreferredLab,
    setDoctorPreferredLab,
    caseAttachments,
    addCaseAttachment,
    deleteCaseAttachment,
    user
  } = useApp();

  const isEdit = Boolean(initialCase?.id);
  const attachmentsForCase = isEdit && initialCase ? (caseAttachments[initialCase.id] || []) : [];

  /* ---------------------------- form state (preserved) ---------------------------- */
  const [patientName, setPatientName] = useState(initialCase?.patient_name || '');
  const [labId, setLabId] = useState(initialCase?.lab_id || labs[0]?.id || '');
  const [caseTypeId, setCaseTypeId] = useState(
    initialCase?.case_type_id || appliedTemplate?.case_type_id || caseTypes[0]?.id || ''
  );
  const [doctorName, setDoctorName] = useState(initialCase?.doctor_name || '');
  const [pendingAttachments, setPendingAttachments] = useState<Omit<CaseAttachment, 'id' | 'case_id' | 'uploaded_at'>[]>([]);
  const [selectedTeeth, setSelectedTeeth] = useState<number[]>(
    initialCase?.selected_teeth || appliedTemplate?.selected_teeth || [11, 21]
  );
  const [toothDetails, setToothDetails] = useState<Record<number, ToothDetail>>(
    initialCase?.tooth_details || {}
  );
  const [material, setMaterial] = useState<string>(
    initialCase?.material || 'Zirconia (Multi-layer 3D Pro)'
  );
  const [shade, setShade] = useState(initialCase?.shade || appliedTemplate?.shade || initialShade || 'A2');
  const [clinicalSpecs, setClinicalSpecs] = useState(getClinicalSpecs());

  useEffect(() => {
    const handleSpecsUpdate = () => {
      setClinicalSpecs(getClinicalSpecs());
    };
    window.addEventListener('clinical-specs-updated', handleSpecsUpdate);
    return () => window.removeEventListener('clinical-specs-updated', handleSpecsUpdate);
  }, []);

  const [priority, setPriority] = useState<PriorityLevel>(
    initialCase?.priority || appliedTemplate?.default_priority || 'normal'
  );
  const [deliveryDate, setDeliveryDate] = useState(
    initialCase?.delivery_date || computeSlaDueDate(initialCase?.priority || appliedTemplate?.default_priority || 'normal')
  );
  const [priorityFeedback, setPriorityFeedback] = useState<string | null>(null);
  const [previewModalAttachment, setPreviewModalAttachment] = useState<{
    filename: string;
    file_type: string;
    file_url: string;
    uploaded_by?: string;
    uploaded_at?: string;
    file_size?: string;
    id?: string;
  } | null>(null);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);

  const [price, setPrice] = useState<number>(
    initialCase?.price || caseTypes.find((ct) => ct.id === (initialCase?.case_type_id || appliedTemplate?.case_type_id))?.base_price || caseTypes[0]?.base_price || 0
  );
  const [discount, setDiscount] = useState<number>(initialCase?.discount || 0);
  const [instructions, setInstructions] = useState(
    initialCase?.instructions || appliedTemplate?.instructions || ''
  );
  const [status, setStatus] = useState<CaseStatus>(initialCase?.status || 'received');
  const [photoUrl, setPhotoUrl] = useState<string>(initialCase?.photo_url || '');

  const [isFullScreen, setIsFullScreen] = useState(false);
  const [statusNote, setStatusNote] = useState('');
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [templateNameInput, setTemplateNameInput] = useState('');
  const [showJobSlipModal, setShowJobSlipModal] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  /* ---------------------------- wizard state ---------------------------- */
  const STEP_SETTLE_MS = 350;
  const stepEnteredAtRef = React.useRef(0);
  const [step, setStep] = useState(0);
  /* Editing jumps straight to any step — the record already exists, so nothing
     is being bypassed. Creating starts locked to step 1. */
  const [maxVisited, setMaxVisited] = useState(isEdit ? STEPS.length - 1 : 0);
  const [attempted, setAttempted] = useState(false);

  const stepValid: Record<StepKey, boolean> = {
    basics: !!(labId && caseTypeId && doctorName.trim().length >= 2 && doctorName.trim().length <= 100),
    chart: selectedTeeth.length > 0,
    schedule:
      !!deliveryDate &&
      !isNaN(new Date(deliveryDate).getTime()) &&
      new Date(deliveryDate).getTime() <= Date.now() + 365 * 24 * 60 * 60 * 1000 &&
      price > 0 &&
      !isNaN(price) &&
      discount >= 0 &&
      !isNaN(discount) &&
      discount <= price,
  };

  const stepError: Record<StepKey, string | null> = {
    basics: !doctorName.trim()
      ? 'Doctor name is required'
      : doctorName.trim().length < 2 || doctorName.trim().length > 100
      ? 'Doctor name must be between 2 and 100 characters'
      : !labId
      ? 'Please select a dental clinic'
      : !caseTypeId
      ? 'Please select a case procedure / type'
      : null,
    chart: selectedTeeth.length === 0 ? 'At least one tooth must be selected on the FDI chart' : null,
    schedule: !deliveryDate || isNaN(new Date(deliveryDate).getTime())
      ? 'Delivery date is required'
      : new Date(deliveryDate).getTime() > Date.now() + 365 * 24 * 60 * 60 * 1000
      ? 'Delivery date cannot be more than 1 year in the future'
      : price <= 0 || isNaN(price)
      ? 'Base price must be a positive number'
      : discount < 0 || isNaN(discount)
      ? 'Discount cannot be negative'
      : discount > price
      ? 'Discount cannot exceed case price'
      : null,
  };

  const goToStep = (i: number) => {
    if (i <= maxVisited) {
      setStep(i);
      setAttempted(false);
    }
  };

  const goNext = () => {
    if (!stepValid[STEPS[step].key]) {
      setAttempted(true);
      return;
    }
    setAttempted(false);
    const n = Math.min(step + 1, STEPS.length - 1);
    setStep(n);
    setMaxVisited((m) => Math.max(m, n));
  };

  const goBack = () => {
    setAttempted(false);
    setStep((s) => Math.max(0, s - 1));
  };

  /* ---------------------------- helpers (preserved) ---------------------------- */

  const getAttachmentCategory = (filename?: string, file_type?: string) => {
    const lowerName = (filename || '').toLowerCase();
    const ext = lowerName.split('.').pop() || '';
    const safeType = (file_type || '').toLowerCase();
    if (['stl', 'ply', 'obj', 'cad'].includes(ext) || safeType.includes('sla') || safeType.includes('model')) {
      return {
        category: '3D Dental Scan / CAD Model',
        badge: 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-600/20',
        kind: 'cad'
      };
    }
    if (['dcm', 'dicom'].includes(ext) || safeType.includes('dicom')) {
      return {
        category: 'CBCT / DICOM Scan',
        badge: 'bg-violet-50 text-violet-800 ring-1 ring-violet-600/20',
        kind: 'dicom'
      };
    }
    if (['jpg', 'jpeg', 'png', 'webp', 'heic', 'svg'].includes(ext) || safeType.startsWith('image/')) {
      return {
        category: 'Patient Photo / Shade Image',
        badge: 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-600/20',
        kind: 'image'
      };
    }
    if (['pdf', 'doc', 'docx', 'txt'].includes(ext) || safeType.includes('pdf') || safeType.includes('word')) {
      return {
        category: 'Prescription / Clinical Notes',
        badge: 'bg-amber-50 text-amber-800 ring-1 ring-amber-600/20',
        kind: 'doc'
      };
    }
    return {
      category: 'Case File Attachment',
      badge: 'bg-slate-100 text-slate-600 ring-1 ring-slate-200',
      kind: 'file'
    };
  };

  const handlePriorityToggle = (newP: PriorityLevel) => {
    setPriority(newP);
    const label = prioritySlaLabel(newP);
    if (isEdit && initialCase) {
      updateCase(initialCase.id, { priority: newP }, `Priority set (${label})`);
      setPriorityFeedback(`Priority set: ${label}`);
      setTimeout(() => setPriorityFeedback(null), 2500);
    } else {
      setDeliveryDate(computeSlaDueDate(newP));
      setPriorityFeedback(`Priority set: ${label} — delivery auto-set`);
      setTimeout(() => setPriorityFeedback(null), 2500);
    }
  };

  const handleLocalFileUpload = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    let loadedCount = 0;

    files.forEach((file) => {
      const reader = new FileReader();
      reader.onerror = (e) => {
        console.warn('Error reading file attachment:', e);
      };
      reader.onload = (evt) => {
        const dataUrl = (evt.target?.result as string) || '';
        const safeType = file.type || 'application/octet-stream';
        const safeName = file.name || 'unnamed-file';
        const newAttachment: Omit<CaseAttachment, 'id' | 'case_id' | 'uploaded_at'> = {
          filename: safeName,
          file_type: safeType,
          file_url: dataUrl,
          uploaded_by: user ? user.name : 'Lab Staff',
          file_size: `${(file.size / (1024 * 1024)).toFixed(2)} MB`
        };

        if (isEdit && initialCase) {
          addCaseAttachment(initialCase.id, newAttachment);
        } else {
          setPendingAttachments(prev => [...(prev || []), newAttachment]);
          if (!photoUrl && (safeType.startsWith('image/') || /\.(jpe?g|png|webp)$/i.test(safeName))) {
            setPhotoUrl(dataUrl);
          }
        }

        loadedCount++;
        if (loadedCount === files.length) {
          setUploadNotice(`Added ${files.length} file(s) from local storage!`);
          setTimeout(() => setUploadNotice(null), 3000);
        }
      };
      reader.readAsDataURL(file);
    });
  };

  const preferredLab = doctorName ? getDoctorPreferredLab(doctorName) : undefined;

  /* Auto pricing on lab / case-type selection (create mode) */
  useEffect(() => {
    if (isEdit) return;

    const selectedCT = caseTypes.find((ct) => ct.id === caseTypeId);
    if (!selectedCT) return;

    const override = pricingOverrides.find((po) => po.lab_id === labId && po.case_type_id === caseTypeId);
    if (override) {
      setPrice(override.custom_price);
      if (override.discount_percentage) {
        setDiscount((override.custom_price * override.discount_percentage) / 100);
      } else {
        setDiscount(0);
      }
    } else {
      setPrice(selectedCT.base_price);
      setDiscount(0);
    }
  }, [labId, caseTypeId, isEdit]);

  const handleApplyPreferredLab = () => {
    if (preferredLab) {
      setLabId(preferredLab.lab_id);
    }
  };

  const handleSetDoctorPreference = () => {
    if (!doctorName.trim() || !labId) return;
    const selectedLab = labs.find((l) => l.id === labId);
    if (selectedLab) {
      setDoctorPreferredLab(doctorName.trim(), labId, selectedLab.name);
      alert(`Set "${selectedLab.name}" as preferred lab for ${doctorName}`);
    }
  };

  /* ---------------------------- validation & submit (preserved) ---------------------------- */

  const validate = () => {
    const errs: Record<string, string> = {};

    if (!labId) errs.labId = 'Please select a dental clinic';
    if (!caseTypeId) errs.caseTypeId = 'Please select a case material type';

    if (!doctorName.trim()) {
      errs.doctorName = 'Doctor name is required';
    } else if (doctorName.trim().length < 2 || doctorName.trim().length > 100) {
      errs.doctorName = 'Doctor name must be between 2 and 100 characters';
    }

    if (selectedTeeth.length === 0) {
      errs.selectedTeeth = 'At least one tooth must be selected on the FDI chart';
    }

    if (shade && shade.length > 50) {
      errs.shade = 'Shade text cannot exceed 50 characters';
    }

    if (!deliveryDate) {
      errs.deliveryDate = 'Delivery date is required';
    } else {
      const delTime = new Date(deliveryDate).getTime();
      const maxTime = new Date().getTime() + 365 * 24 * 60 * 60 * 1000;
      if (isNaN(delTime)) {
        errs.deliveryDate = 'Invalid delivery date';
      } else if (delTime > maxTime) {
        errs.deliveryDate = 'Delivery date cannot be more than 1 year in the future';
      }
    }

    if (price <= 0 || isNaN(price)) {
      errs.price = 'Price must be a positive number';
    }

    if (discount < 0 || isNaN(discount)) {
      errs.discount = 'Discount cannot be negative';
    } else if (discount > price) {
      errs.discount = 'Discount cannot exceed case price';
    }

    if (instructions && instructions.length > 1000) {
      errs.instructions = 'Instructions cannot exceed 1000 characters';
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const jumpToFirstInvalidStep = () => {
    if (!stepValid.basics) { setStep(0); return; }
    if (!stepValid.chart) { setStep(1); return; }
    if (!stepValid.schedule) { setStep(2); return; }
  };

  /* The only place a case is ever written. Reachable from the last step only,
     and never within a moment of arriving there: a fast double click used to
     let the second press land on the freshly mounted submit button and save a
     half-filled case (the "saves on step 2" report). */
  const commitCase = () => {
    if (step < STEPS.length - 1) return;
    if (Date.now() - stepEnteredAtRef.current < STEP_SETTLE_MS) return;

    if (!validate()) {
      jumpToFirstInvalidStep();
      setAttempted(true);
      return;
    }

    const selectedLab = labs.find((l) => l.id === labId);
    const selectedCT = caseTypes.find((ct) => ct.id === caseTypeId);

    const finalPrice = Math.max(0, price - discount);

    if (isEdit && initialCase) {
      updateCase(
        initialCase.id,
        {
          patient_name: patientName.trim() || initialCase.patient_name,
          lab_id: labId,
          lab_name: selectedLab ? selectedLab.name : initialCase.lab_name,
          case_type_id: caseTypeId,
          case_type_name: selectedCT ? selectedCT.name : initialCase.case_type_name,
          doctor_name: doctorName.trim(),
          selected_teeth: selectedTeeth,
          tooth_details: toothDetails,
          shade: shade.trim(),
          material: material.trim(),
          delivery_date: deliveryDate,
          priority,
          price,
          discount,
          final_price: finalPrice,
          instructions: instructions.trim(),
          status: status === 'draft' ? 'received' : status,
          photo_url: photoUrl
        },
        statusNote
      );
    } else {
      const newCase = addCase({
        patient_name: patientName.trim() || undefined,
        lab_id: labId,
        lab_name: selectedLab ? selectedLab.name : 'Unknown Lab',
        case_type_id: caseTypeId,
        case_type_name: selectedCT ? selectedCT.name : 'Zirconia Crown',
        doctor_name: doctorName.trim(),
        selected_teeth: selectedTeeth,
        tooth_details: toothDetails,
        shade: shade.trim(),
        material: material.trim(),
        delivery_date: deliveryDate,
        priority,
        price,
        discount,
        final_price: finalPrice,
        instructions: instructions.trim(),
        photo_url: photoUrl,
        status: status === 'draft' ? 'received' : status,
      });

      if (newCase && pendingAttachments.length > 0) {
        pendingAttachments.forEach(att => addCaseAttachment(newCase.id, att));
      }
    }

    onClose();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Enter key / stray submit on a non-final step means "advance", never save.
    if (step < STEPS.length - 1) {
      goNext();
      return;
    }
    commitCase();
  };

  const handleSaveAsTemplate = () => {
    if (!templateNameInput.trim()) return;
    const selectedCT = caseTypes.find((ct) => ct.id === caseTypeId);

    saveAsTemplate(
      templateNameInput.trim(),
      {
        id: '',
        case_number: '',
        lab_id: labId,
        lab_name: '',
        case_type_id: caseTypeId,
        case_type_name: selectedCT ? selectedCT.name : 'Zirconia Crown',
        doctor_name: doctorName,
        selected_teeth: selectedTeeth,
        shade,
        delivery_date: deliveryDate,
        priority,
        price,
        discount,
        final_price: price - discount,
        instructions,
        status,
        created_at: '',
        updated_at: '',
        history: []
      },
      'Template created from case form'
    );

    setTemplateModalOpen(false);
    setTemplateNameInput('');
    alert('Template saved successfully!');
  };

  const finalComputedPrice = Math.max(0, price - discount);

  const selectedLab = labs.find((l) => l.id === labId);
  const selectedCT = caseTypes.find((ct) => ct.id === caseTypeId);

  /* Tracks when the wizard landed on the current step so the final submit can
     ignore a click that was really aimed at the "Continue" button. */
  useEffect(() => {
    stepEnteredAtRef.current = Date.now();
  }, [step]);

  /* Priority visual mapping */
  const priorityDot: Record<PriorityLevel, string> = {
    low: 'bg-sky-500',
    normal: 'bg-indigo-500',
    high: 'bg-amber-500',
    urgent: 'bg-rose-500',
  };
  const priorityHeaderBadge: Record<PriorityLevel, string> = {
    low: 'bg-sky-400/10 text-sky-300 ring-1 ring-sky-400/30',
    normal: 'bg-indigo-400/10 text-indigo-300 ring-1 ring-indigo-400/30',
    high: 'bg-amber-400/10 text-amber-300 ring-1 ring-amber-400/30',
    urgent: 'bg-rose-400/10 text-rose-300 ring-1 ring-rose-400/30',
  };

  /* Shared shade-toggle handler (sets global shade + per-tooth details) */
  const applyShadeToSelection = (s: string) => {
    setShade(s);
    setToothDetails((prev) => {
      const updated = { ...prev };
      selectedTeeth.forEach((t) => {
        updated[t] = {
          ...(updated[t] || { tooth_number: t, prep_type: 'crown', material }),
          shade: s,
        };
      });
      return updated;
    });
  };

  /* ================================================================== */
  /*  Shared step content — used by the create wizard AND the edit form  */
  /* ================================================================== */

  const renderBasicsSection = () => (
    <div className={bezelCard}>
      <div className={bezelCardInner}>
        <div className="mb-5 flex items-center justify-between">
          <Eyebrow>01 · Referral</Eyebrow>
            <span className="font-mono text-[10px] tracking-widest text-slate-400">WHO & WHAT</span>
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div>
              <FieldLabel>Patient Name / ID</FieldLabel>
              <input
                type="text"
                value={patientName}
                onChange={(e) => setPatientName(e.target.value)}
                placeholder="e.g. Sarah Jenkins (optional)"
                className={inputCls}
              />
            </div>
            <div>
              <FieldLabel required>Doctor Name</FieldLabel>
              <input
                type="text"
                value={doctorName}
                onChange={(e) => {
                  setDoctorName(e.target.value);
                  if (errors.doctorName) setErrors((prev) => ({ ...prev, doctorName: '' }));
                }}
                placeholder="e.g. Dr. Tariq Mahmood"
                className={inputCls}
              />
              {errors.doctorName && <p className="mt-1 text-[11px] font-medium text-rose-600">{errors.doctorName}</p>}
            </div>
            <div>
              <div className="flex items-end justify-between">
                <FieldLabel required>Dental Clinic</FieldLabel>
                {doctorName && labId && (
                  <button
                    type="button"
                    onClick={handleSetDoctorPreference}
                    className={`mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-indigo-700 transition-colors hover:text-indigo-500 ${EASE}`}
                  >
                    Set preferred
                  </button>
                )}
              </div>
              <select
                value={labId}
                onChange={(e) => {
                  setLabId(e.target.value);
                  if (errors.labId) setErrors((prev) => ({ ...prev, labId: '' }));
                }}
                className={inputCls}
              >
                {labs.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.phone ? `${l.name} (${l.phone})` : l.name}
                  </option>
                ))}
              </select>
              {errors.labId && <p className="mt-1 text-[11px] font-medium text-rose-600">{errors.labId}</p>}
              {preferredLab && (
                <div className="mt-2 flex items-center justify-between gap-2 rounded-xl bg-indigo-50/70 px-3 py-2 text-xs text-indigo-800 ring-1 ring-indigo-600/15">
                  <span className="truncate">
                    Preferred lab: <strong className="font-semibold">{preferredLab.lab_name}</strong>
                  </span>
                  {labId !== preferredLab.lab_id && (
                    <button
                      type="button"
                      onClick={handleApplyPreferredLab}
                      className={`shrink-0 rounded-full bg-indigo-600 px-3 py-1 text-[10px] font-bold text-white transition-all duration-500 hover:bg-indigo-700 active:scale-[0.97] ${EASE}`}
                    >
                      Auto-select
                    </button>
                  )}
                </div>
              )}
            </div>
            <div>
              <FieldLabel required>Case Procedure / Type</FieldLabel>
              <select
                value={caseTypeId}
                onChange={(e) => setCaseTypeId(e.target.value)}
                className={inputCls}
              >
                {caseTypes.map((ct) => (
                  <option key={ct.id} value={ct.id}>
                    {ct.name} (PKR {ct.base_price.toLocaleString()})
                  </option>
                ))}
              </select>
              {selectedCT && (
                <p className="mt-1.5 font-mono text-[11px] tracking-wide text-slate-400">
                  BASE PKR {selectedCT.base_price.toLocaleString()}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
  );

  const renderChartSection = () => (
    <div className="space-y-6">
      <div className={bezelCard}>
        <div className={bezelCardInner}>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
            <Eyebrow>02 · FDI Charting</Eyebrow>
            <span className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-3.5 py-1.5 font-mono text-[11px] font-bold tracking-wider text-white">
              {selectedTeeth.length} UNIT{selectedTeeth.length === 1 ? '' : 'S'} ACTIVE
            </span>
          </div>
          <Odontogram
            initialSelected={selectedTeeth}
            initialRestorations={
              Object.entries(toothDetails || {}).reduce((acc, [t, d]) => {
                const detail = d as ToothDetail | undefined;
                if (detail?.prep_type) acc[Number(t)] = detail.prep_type;
                return acc;
              }, {} as Record<number, string>)
            }
            initialShades={
              Object.entries(toothDetails || {}).reduce((acc, [t, d]) => {
                const detail = d as ToothDetail | undefined;
                if (detail?.shade) acc[Number(t)] = detail.shade;
                return acc;
              }, {} as Record<number, string>)
            }
            initialMaterials={
              Object.entries(toothDetails || {}).reduce((acc, [t, d]) => {
                const detail = d as ToothDetail | undefined;
                if (detail?.material) acc[Number(t)] = detail.material;
                return acc;
              }, {} as Record<number, string>)
            }
            onChange={({ selected, restorationByTooth, shadeByTooth, materialByTooth, toothDetails: generatedDetails }) => {
              setSelectedTeeth(selected);
              if (errors.selectedTeeth && selected.length > 0) {
                setErrors((prev) => ({ ...prev, selectedTeeth: '' }));
              }
              const updatedDetails: Record<number, ToothDetail> = {};
              selected.forEach((t) => {
                updatedDetails[t] = {
                  tooth_number: t,
                  prep_type: (restorationByTooth[t] as any) || 'crown',
                  shade: shadeByTooth[t] || shade || 'A2',
                  material: materialByTooth?.[t] || material || 'Zirconia (Multi-layer 3D Pro)',
                  notes: generatedDetails?.[t]?.notes || '',
                  implant_brand: generatedDetails?.[t]?.implant_brand,
                  implant_size: generatedDetails?.[t]?.implant_size,
                };
              });
              setToothDetails(updatedDetails);
              if (selected.length > 0) {
                const latestTooth = selected[selected.length - 1];
                if (shadeByTooth[latestTooth]) {
                  setShade(shadeByTooth[latestTooth]);
                }
                if (materialByTooth?.[latestTooth]) {
                  setMaterial(materialByTooth[latestTooth]);
                }
              }
            }}
          />
          {errors.selectedTeeth && (
            <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-rose-600">
              <AlertCircle className="h-3.5 w-3.5" /> {errors.selectedTeeth}
            </p>
          )}
          {attempted && stepError.chart && (
            <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-rose-600">
              <AlertCircle className="h-3.5 w-3.5" /> {stepError.chart}
            </p>
          )}
        </div>
      </div>

      {!isEdit && (
        <div className={bezelCard}>
          <div className={bezelCardInner}>
            <Eyebrow>02 · Scans &amp; photos</Eyebrow>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <label className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-indigo-600 px-4 py-2 text-xs font-bold text-white transition-all duration-500 hover:bg-indigo-700 active:scale-[0.97] ${EASE}`}>
                <Upload className="h-3.5 w-3.5" />
                Add files
                <input
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => handleLocalFileUpload(e.target.files)}
                />
              </label>
              <span className="text-xs text-slate-500">
                {pendingAttachments.length === 0
                  ? 'Optional — STL scans, intraoral photos or prescriptions. They attach when the case is created.'
                  : `${pendingAttachments.length} file${pendingAttachments.length === 1 ? '' : 's'} ready to attach on create.`}
              </span>
            </div>
            {uploadNotice && (
              <div className="mt-3 flex items-center gap-2 rounded-xl bg-indigo-50 px-3 py-2.5 text-xs text-indigo-800 ring-1 ring-indigo-600/15">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span className="font-semibold">{uploadNotice}</span>
              </div>
            )}
            {pendingAttachments.length > 0 && (
              <ul className="mt-3 divide-y divide-slate-100">
                {pendingAttachments.map((att, i) => (
                  <li key={`${att.filename}-${i}`} className="flex items-center justify-between gap-3 py-2 text-xs">
                    <span className="flex min-w-0 items-center gap-2">
                      <Paperclip className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                      <span className="truncate font-semibold text-slate-800" title={att.filename}>{att.filename}</span>
                      <span className="shrink-0 text-slate-400">{att.file_size}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setPendingAttachments((prev) => prev.filter((_, idx) => idx !== i))}
                      className="rounded-full p-1 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600"
                      title="Remove file"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );

  const renderScheduleSection = () => (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      <div className="space-y-6 lg:col-span-7">
        <div className={bezelCard}>
          <div className={bezelCardInner}>
            <Eyebrow>03 · Priority & SLA</Eyebrow>
            <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {(['low', 'normal', 'high', 'urgent'] as PriorityLevel[]).map((p) => {
                const isActive = priority === p;
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => handlePriorityToggle(p)}
                    className={`group flex flex-col items-start gap-2 rounded-2xl p-3.5 text-left transition-all duration-500 ${EASE} active:scale-[0.97] ${
                      isActive
                        ? 'bg-slate-900 text-white shadow-[0_12px_28px_-12px_rgba(15,23,42,0.5)]'
                        : 'bg-white ring-1 ring-slate-200 hover:ring-slate-300'
                    }`}
                    title={`SLA: ready in ${PRIORITY_SLA_DAYS[p]} day${PRIORITY_SLA_DAYS[p] === 1 ? '' : 's'}`}
                  >
                    <span className="flex items-center gap-1.5">
                      <span className={`h-1.5 w-1.5 rounded-full ${priorityDot[p]} ${p === 'urgent' && isActive ? 'animate-pulse' : ''}`} />
                      <span className={`text-xs font-bold ${isActive ? 'text-white' : 'text-slate-900'}`}>
                        {p === 'normal' ? 'Medium' : p.charAt(0).toUpperCase() + p.slice(1)}
                      </span>
                    </span>
                    <span className={`font-mono text-[10px] tracking-wider ${isActive ? 'text-slate-400' : 'text-slate-400'}`}>
                      {PRIORITY_SLA_DAYS[p]}D TURNAROUND
                    </span>
                  </button>
                );
              })}
            </div>
            {priorityFeedback && (
              <div className={`mt-3 inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-3 py-1.5 text-[11px] font-semibold text-indigo-800 ring-1 ring-indigo-600/20 animate-fadeIn`}>
                <CheckCircle2 className="h-3.5 w-3.5" />
                {priorityFeedback}
              </div>
            )}

            <div className="mt-5">
              <FieldLabel required>Target Delivery Date</FieldLabel>
              <div className="relative">
                <CalendarDays className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="date"
                  value={deliveryDate}
                  onChange={(e) => setDeliveryDate(e.target.value)}
                  className={`${inputCls} pl-10`}
                />
              </div>
              {(errors.deliveryDate || (attempted && stepError.schedule && stepError.schedule.includes('date'))) && (
                <p className="mt-1 text-[11px] font-medium text-rose-600">{errors.deliveryDate || stepError.schedule}</p>
              )}
            </div>
          </div>
        </div>

        <div className={bezelCard}>
          <div className={bezelCardInner}>
            <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">
              <FileText className="h-4 w-4 text-indigo-700" />
              Technician Special Instructions
            </span>
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={3}
              placeholder="Incisal translucency, pontic design, margin bevel specifications..."
              className={`${inputCls} mt-3 resize-none`}
            />
            {errors.instructions && <p className="mt-1 text-[11px] font-medium text-rose-600">{errors.instructions}</p>}
          </div>
        </div>
      </div>

      <div className="lg:col-span-5">
        <div className={`${bezelCard} h-full`}>
          <div className={`${bezelCardInner} flex h-full flex-col`}>
            <Eyebrow>Financial · PKR</Eyebrow>
            <div className="mt-4 space-y-4">
              <div>
                <FieldLabel>Base Price</FieldLabel>
                <input
                  type="number"
                  value={price}
                  onChange={(e) => setPrice(Number(e.target.value))}
                  className={`${inputCls} font-mono font-bold`}
                />
                {errors.price && <p className="mt-1 text-[11px] font-medium text-rose-600">{errors.price}</p>}
              </div>
              <div>
                <FieldLabel>Discount</FieldLabel>
                <input
                  type="number"
                  value={discount}
                  onChange={(e) => setDiscount(Number(e.target.value))}
                  className={`${inputCls} font-mono font-semibold text-rose-700`}
                />
                {errors.discount && <p className="mt-1 text-[11px] font-medium text-rose-600">{errors.discount}</p>}
              </div>
              <div className="rounded-2xl bg-slate-900 p-5">
                <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">Final price — auto-computed</div>
                <div className="mt-1.5 font-mono text-2xl font-bold tracking-tight text-white">
                  PKR {finalComputedPrice.toLocaleString()}
                </div>
                {discount > 0 && (
                  <div className="mt-1 font-mono text-[11px] text-indigo-300">
                    −PKR {discount.toLocaleString()} applied
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

    </div>
  );

  /* ================================================================== */
  /*  Modal shell                                                        */
  /* ================================================================== */

  const shellSize = isFullScreen
    ? 'h-full w-full max-w-none rounded-none'
    : isEdit
    ? 'max-h-[96vh] w-full max-w-[1500px]'
    : 'max-h-[94vh] w-full max-w-5xl';

  const stepContent = [
    renderBasicsSection,
    renderChartSection,
    renderScheduleSection,
  ][step];

  return (
    <div className={`no-print-backdrop fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/60 backdrop-blur-sm ${isFullScreen ? 'p-0' : 'p-2 sm:p-4 md:p-6'}`}>
      <div
        className={`flex flex-col overflow-hidden bg-white ring-1 ring-slate-200 shadow-[0_48px_96px_-24px_rgba(15,23,42,0.45)] transition-all duration-500 ${EASE} my-auto ${shellSize}`}
        style={{ borderRadius: isFullScreen ? 0 : '2rem' }}
      >
        {/* ---------------------------- Header ---------------------------- */}
        <div className="relative shrink-0 bg-slate-900 px-6 py-4 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <Eyebrow className="text-slate-400">
                {isEdit ? 'Case file' : 'New lab case'}
              </Eyebrow>
              <h2 className="mt-1 truncate text-lg font-bold tracking-tight text-white">
                {isEdit ? `Case ${initialCase?.case_number}` : 'Create Dental Case'}
              </h2>
              <p className="mt-0.5 truncate text-xs text-slate-400">
                {isEdit
                  ? 'Workflow, charting, attachments & history'
                  : 'Three focused steps — procedure, charting, schedule'}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {/* Priority badge (edit mode keeps it prominent) */}
              {isEdit && (
                <div className={`hidden items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] font-black uppercase tracking-wider sm:flex ${priorityHeaderBadge[priority]}`}>
                  {priority === 'urgent' && (
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75"></span>
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-rose-400"></span>
                    </span>
                  )}
                  <span>{priority === 'normal' ? 'Medium' : priority.charAt(0).toUpperCase() + priority.slice(1)}</span>
                </div>
              )}
              {isEdit && (
                <button
                  type="button"
                  onClick={() => setShowJobSlipModal(true)}
                  className={`hidden items-center gap-1.5 rounded-full bg-white/10 px-4 py-2 text-xs font-bold text-white transition-all duration-500 hover:bg-white/20 active:scale-[0.97] md:inline-flex ${EASE}`}
                  title="Print Job Slip / Workstation Routing Ticket"
                >
                  <Printer className="h-4 w-4" />
                  Job Slip
                </button>
              )}
              {!isEdit && (
                <button
                  type="button"
                  onClick={() => setTemplateModalOpen(true)}
                  className={`hidden items-center gap-1.5 rounded-full bg-white/10 px-4 py-2 text-xs font-bold text-white transition-all duration-500 hover:bg-white/20 active:scale-[0.97] md:inline-flex ${EASE}`}
                  title="Save the current teeth, shade and instructions as a reusable preset"
                >
                  <Bookmark className="h-4 w-4" />
                  Save preset
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsFullScreen(!isFullScreen)}
                className="rounded-full p-2 text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
                title={isFullScreen ? 'Restore window size' : 'Expand to full page'}
              >
                {isFullScreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-full p-2 text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>

        {/* ------------------ Wizard stepper — identical in create & edit ------------------ */}
        {(
          <div className="shrink-0 border-b border-slate-200 bg-white px-6 py-4">
            <div className="flex items-center justify-between">
              {/* Desktop rail */}
              <div className="hidden flex-1 items-center gap-1 md:flex">
                {STEPS.map((s, i) => {
                  const done = i < step;
                  const active = i === step;
                  const locked = i > maxVisited;
                  return (
                    <React.Fragment key={s.key}>
                      {i > 0 && (
                        <div className={`mx-1 h-px flex-1 transition-all duration-700 ${EASE} ${i <= step ? 'bg-indigo-600/50' : 'bg-slate-200'}`} />
                      )}
                      <button
                        type="button"
                        disabled={locked}
                        onClick={() => goToStep(i)}
                        className={`group flex items-center gap-2.5 rounded-full py-1.5 pl-1.5 pr-3.5 transition-all duration-500 ${EASE} ${
                          locked ? 'cursor-not-allowed opacity-45' : 'cursor-pointer hover:bg-slate-100'
                        }`}
                      >
                        <span
                          className={`flex h-9 w-9 items-center justify-center rounded-full font-mono text-[11px] font-bold transition-all duration-500 ${EASE} ${
                            active
                              ? 'bg-slate-900 text-white shadow-[0_8px_20px_-6px_rgba(15,23,42,0.55)]'
                              : done
                              ? 'bg-indigo-600/10 text-indigo-800 ring-1 ring-indigo-600/30'
                              : 'bg-white text-slate-400 ring-1 ring-slate-200'
                          }`}
                        >
                          {done ? <Check className="h-4 w-4" /> : s.numeral}
                        </span>
                        <span className="text-left">
                          <span className={`block text-xs font-bold leading-tight ${active ? 'text-slate-900' : done ? 'text-indigo-800' : 'text-slate-400'}`}>
                            {s.label}
                          </span>
                          <span className="hidden text-[10px] leading-tight text-slate-400 lg:block">{s.caption}</span>
                        </span>
                      </button>
                    </React.Fragment>
                  );
                })}
              </div>
              {/* Mobile compact */}
              <div className="flex w-full items-center justify-between md:hidden">
                <span className="text-xs font-bold text-slate-900">
                  Step {step + 1} of {STEPS.length} — {STEPS[step].label}
                </span>
                <div className="flex items-center gap-1.5">
                  {STEPS.map((s, i) => (
                    <span
                      key={s.key}
                      className={`h-1.5 rounded-full transition-all duration-500 ${EASE} ${
                        i === step ? 'w-6 bg-slate-900' : i < step ? 'w-1.5 bg-indigo-600/60' : 'w-1.5 bg-slate-300'
                      }`}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ---------------------------- Body ---------------------------- */}
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-8 md:px-10 md:py-10">
              {isEdit ? (
                <div className="space-y-6">
                  {/* Step 3 · live stage control (editing only) */}
                  {step === 2 && (
                  <div className={bezelCard}>
                    <div className={bezelCardInner}>
                      <div className="mb-3 flex items-center justify-between">
                        <Eyebrow>Stage workflow</Eyebrow>
                        <span className="text-[11px] text-slate-400">Click any stage to update case status</span>
                      </div>
                      <CaseProgressIndicator
                        status={status}
                        onStatusChange={(newStatus) => setStatus(newStatus)}
                        variant="detailed"
                        showLabels={true}
                      />
                      <input
                        type="text"
                        value={statusNote}
                        onChange={(e) => setStatusNote(e.target.value)}
                        placeholder="Status change note (optional)"
                        className={`${inputCls} mt-4`}
                      />
                    </div>
                  </div>
                  )}

                  {step === 0 && renderBasicsSection()}
                  {step === 1 && renderChartSection()}
                  {step === 2 && renderScheduleSection()}

                  {/* Step 2 · internal case notes (editing only) */}
                  {step === 2 && initialCase && (
                    <div className={bezelCard}>
                      <div className={bezelCardInner}>
                        <CaseNotesPanel caseId={initialCase.id} />
                      </div>
                    </div>
                  )}

                  {/* Step 3 · history timeline (editing only) */}
                  {step === 2 && initialCase && initialCase.history.length > 0 && (
                    <div className={bezelCard}>
                      <div className={bezelCardInner}>
                        <Eyebrow>Status history</Eyebrow>
                        <div className="mt-3 max-h-44 space-y-2 overflow-y-auto pr-1">
                          {initialCase.history.map((h) => (
                            <div key={h.id} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2.5 text-xs">
                              <div className="flex min-w-0 items-center gap-2">
                                <span className="rounded-full bg-slate-900 px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-white">
                                  {h.status}
                                </span>
                                <span className="truncate text-slate-600">{h.notes || 'Status updated'}</span>
                              </div>
                              <span className="shrink-0 font-mono text-[10px] text-slate-400">
                                {h.timestamp} · {h.updated_by}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Step 2 · scans & photos (editing only) */}
                  {step === 1 && initialCase && (
                    <div className={bezelCard}>
                      <div className={bezelCardInner}>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <Eyebrow>Scans & photos ({attachmentsForCase.length})</Eyebrow>
                          <div className="flex items-center gap-2">
                            <label className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-indigo-600 px-4 py-2 text-xs font-bold text-white transition-all duration-500 hover:bg-indigo-700 active:scale-[0.97] ${EASE}`}>
                              <Upload className="h-3.5 w-3.5" />
                              Upload
                              <input
                                type="file"
                                multiple
                                className="hidden"
                                onChange={(e) => handleLocalFileUpload(e.target.files)}
                              />
                            </label>
                          </div>
                        </div>

                        {uploadNotice && (
                          <div className="mt-3 flex items-center gap-2 rounded-xl bg-indigo-50 px-3 py-2.5 text-xs text-indigo-800 ring-1 ring-indigo-600/15">
                            <CheckCircle2 className="h-4 w-4 shrink-0" />
                            <span className="font-semibold">{uploadNotice}</span>
                          </div>
                        )}

                        {attachmentsForCase.length > 0 ? (
                          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                            {attachmentsForCase.map((att) => {
                              const cat = getAttachmentCategory(att?.filename, att?.file_type);
                              const isImage = (att?.file_type || '').startsWith('image/');
                              const isMainPhoto = photoUrl === att.file_url;

                              return (
                                <div
                                  key={att.id}
                                  className={`flex flex-col justify-between gap-2.5 rounded-xl bg-white p-3 ring-1 transition-all duration-500 ${EASE} ${
                                    isMainPhoto ? 'ring-2 ring-indigo-500/50' : 'ring-slate-200 hover:ring-slate-300'
                                  }`}
                                >
                                  <div className="flex items-start gap-3">
                                    <div
                                      onClick={() => setPreviewModalAttachment(att)}
                                      className="flex h-14 w-14 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-lg bg-slate-100 ring-1 ring-slate-200"
                                      title="Click to view full preview & metadata"
                                    >
                                      {isImage ? (
                                        <img src={att.file_url} alt={att.filename} className="h-full w-full object-cover" />
                                      ) : cat.kind === 'cad' ? (
                                        <Box className="h-7 w-7 text-indigo-700" />
                                      ) : cat.kind === 'dicom' ? (
                                        <Layers className="h-7 w-7 text-violet-700" />
                                      ) : (
                                        <FileText className="h-7 w-7 text-slate-400" />
                                      )}
                                    </div>

                                    <div className="min-w-0 flex-1">
                                      <div className="flex flex-wrap items-center gap-1.5">
                                        <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${cat.badge}`}>
                                          {cat.category}
                                        </span>
                                        {isMainPhoto && (
                                          <span className="flex items-center gap-1 rounded-full bg-indigo-600 px-2 py-0.5 text-[9px] font-bold text-white">
                                            <Check className="h-2.5 w-2.5" /> Main
                                          </span>
                                        )}
                                      </div>
                                      <div className="mt-1 truncate text-xs font-bold text-slate-900" title={att.filename}>
                                        {att.filename}
                                      </div>
                                      <div className="mt-1 grid grid-cols-2 gap-x-2 text-[10px] text-slate-400">
                                        <div>Size: {att.file_size || 'N/A'}</div>
                                        <div>Type: {att.file_type || 'Unknown'}</div>
                                        <div>By: {att.uploaded_by || 'Lab Staff'}</div>
                                        <div>Date: {att.uploaded_at ? att.uploaded_at.substring(0, 10) : 'Recent'}</div>
                                      </div>
                                    </div>
                                  </div>

                                  <div className="flex items-center justify-between border-t border-slate-200 pt-2">
                                    <div className="flex items-center gap-1">
                                      <button
                                        type="button"
                                        onClick={() => openFileInBrowser(att.file_url, att.filename, att.file_type)}
                                        className="rounded-full px-2.5 py-1 text-[11px] font-semibold text-indigo-800 transition-colors hover:bg-indigo-50"
                                        title="Open file in browser tab"
                                      >
                                        Open
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setPreviewModalAttachment(att)}
                                        className="rounded-full px-2.5 py-1 text-[11px] font-semibold text-slate-600 transition-colors hover:bg-slate-100"
                                        title="Inspect metadata"
                                      >
                                        Preview
                                      </button>
                                      {isImage && !isMainPhoto && (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setPhotoUrl(att.file_url);
                                            updateCase(initialCase.id, { photo_url: att.file_url }, 'Updated main case photo');
                                          }}
                                          className="rounded-full px-2.5 py-1 text-[11px] font-semibold text-indigo-800 transition-colors hover:bg-indigo-50"
                                          title="Set as primary reference photo"
                                        >
                                          Set main
                                        </button>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-1">
                                      <a
                                        href={att.file_url}
                                        download={att.filename}
                                        className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-indigo-50 hover:text-indigo-700"
                                        title="Download to local computer"
                                      >
                                        <Download className="h-3.5 w-3.5" />
                                      </a>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          if (confirm(`Delete ${att.filename}?`)) {
                                            deleteCaseAttachment(initialCase.id, att.id);
                                          }
                                        }}
                                        className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600"
                                        title="Delete attachment"
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="mt-4 rounded-2xl border-2 border-dashed border-slate-200 bg-white py-6 text-center">
                            <Paperclip className="mx-auto mb-1.5 h-8 w-8 text-slate-300" />
                            <p className="text-xs font-bold text-slate-900">No scans or photos attached yet.</p>
                            <p className="mt-0.5 text-[11px] text-slate-400">
                              Upload STL scans, intraoral photos or clinical documents.
                            </p>
                            <label className={`mt-3 inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-indigo-600 px-4 py-2 text-xs font-bold text-white transition-all duration-500 hover:bg-indigo-700 active:scale-[0.97] ${EASE}`}>
                              <Upload className="h-3.5 w-3.5" />
                              Browse local files
                              <input
                                type="file"
                                multiple
                                className="hidden"
                                onChange={(e) => handleLocalFileUpload(e.target.files)}
                              />
                            </label>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div key={step} className="animate-step-in">
                  {stepContent()}
                </div>
              )}
            </div>

            {/* ---------------------------- Footer ---------------------------- */}
            <div className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-200 bg-white px-6 py-4">
              {isEdit && initialCase ? (
                <button
                  type="button"
                  onClick={() => {
                    if (confirm(`Are you sure you want to PERMANENTLY delete case ${initialCase.case_number}?`)) {
                      deleteCase(initialCase.id);
                      onClose();
                    }
                  }}
                  className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2.5 text-xs font-bold text-rose-700 ring-1 ring-rose-600/25 transition-all duration-500 hover:bg-rose-50 active:scale-[0.97] ${EASE}`}
                >
                  <Trash2 className="h-4 w-4" />
                  Delete Case
                </button>
              ) : (
                <span className="hidden text-[11px] font-medium text-slate-400 sm:block">
                  Step {step + 1} of {STEPS.length} · {STEPS[step].label}
                </span>
              )}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className={`rounded-full px-4 py-2.5 text-xs font-bold text-slate-600 transition-colors hover:bg-slate-100 ${EASE}`}
                >
                  Cancel
                </button>

                {step > 0 && (
                  <button
                    type="button"
                    onClick={goBack}
                    className={`inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-xs font-bold text-slate-600 ring-1 ring-slate-200 transition-all duration-500 hover:ring-slate-300 active:scale-[0.97] ${EASE}`}
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    Back
                  </button>
                )}
                {step < STEPS.length - 1 ? (
                  <button
                    type="button"
                    onClick={goNext}
                    className={`group inline-flex items-center gap-2 rounded-full bg-slate-900 py-2.5 pl-5 pr-2.5 text-xs font-bold text-white shadow-[0_12px_28px_-10px_rgba(15,23,42,0.55)] transition-all duration-500 hover:bg-indigo-600 active:scale-[0.98] ${EASE}`}
                  >
                    <span>Continue</span>
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 transition-transform duration-500 group-hover:translate-x-0.5 group-hover:-translate-y-px">
                      <ArrowRight className="h-4 w-4" />
                    </span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={commitCase}
                    className={`group inline-flex items-center gap-2 rounded-full bg-indigo-600 py-2.5 pl-5 pr-2.5 text-xs font-bold text-white shadow-[0_12px_28px_-10px_rgba(79,70,229,0.45)] transition-all duration-500 hover:bg-indigo-700 active:scale-[0.98] ${EASE}`}
                  >
                    <span>{isEdit ? 'Save Changes' : 'Create Dental Case'}</span>
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/15 transition-transform duration-500 group-hover:translate-x-0.5 group-hover:-translate-y-px">
                      <Check className="h-4 w-4" />
                    </span>
                  </button>
                )}
              </div>
            </div>
        </form>
      </div>

      {/* ---------------------------- Attachment preview modal ---------------------------- */}
      {previewModalAttachment && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-[1.5rem] bg-slate-100 p-2 ring-1 ring-slate-900/10 shadow-[0_48px_96px_-24px_rgba(15,23,42,0.5)]">
            <div className="rounded-[calc(1.5rem-0.5rem)] bg-white p-5">
              <div className="mb-4 flex items-center justify-between">
                <span className={`rounded-full px-3 py-1 text-[10px] font-bold ${getAttachmentCategory(previewModalAttachment.filename, previewModalAttachment.file_type).badge}`}>
                  {getAttachmentCategory(previewModalAttachment.filename, previewModalAttachment.file_type).category}
                </span>
                <button
                  type="button"
                  onClick={() => setPreviewModalAttachment(null)}
                  className="rounded-full p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-900"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="flex min-h-[280px] items-center justify-center rounded-2xl bg-slate-900 p-4">
                {(previewModalAttachment.file_type || '').startsWith('image/') || /\.(jpe?g|png|webp|gif)$/i.test(previewModalAttachment.filename || '') ? (
                  <img
                    src={previewModalAttachment.file_url}
                    alt={previewModalAttachment.filename || 'preview'}
                    className="max-h-[420px] max-w-full rounded-xl object-contain"
                  />
                ) : getAttachmentCategory(previewModalAttachment.filename, previewModalAttachment.file_type).kind === 'cad' ? (
                  <div className="space-y-3 p-6 text-center">
                    <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-white/[0.06] text-indigo-300 ring-1 ring-indigo-400/20">
                      <Box className="h-8 w-8" />
                    </div>
                    <h4 className="text-sm font-bold text-white">3D CAD / STL Surface Mesh</h4>
                    <p className="mx-auto max-w-xs text-xs leading-relaxed text-slate-400">
                      Dental CAD scan mesh. Ready for milling, 3D printing, or CAD/CAM fabrication.
                    </p>
                  </div>
                ) : getAttachmentCategory(previewModalAttachment.filename, previewModalAttachment.file_type).kind === 'dicom' ? (
                  <div className="space-y-3 p-6 text-center">
                    <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-white/[0.06] text-violet-300 ring-1 ring-violet-400/20">
                      <Layers className="h-8 w-8" />
                    </div>
                    <h4 className="text-sm font-bold text-white">CBCT / DICOM Volumetric Scan</h4>
                    <p className="mx-auto max-w-xs text-xs leading-relaxed text-slate-400">
                      High-resolution 3D radiographic tomography slice series.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3 p-6 text-center">
                    <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-white/[0.06] text-slate-300 ring-1 ring-white/15">
                      <FileText className="h-8 w-8" />
                    </div>
                    <h4 className="text-sm font-bold text-white">Clinical Document / Prescription</h4>
                    <p className="mx-auto max-w-xs text-xs leading-relaxed text-slate-400">
                      Doctor instructions, lab prescription, or patient clinical record.
                    </p>
                  </div>
                )}
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2 text-[11px]">
                {[
                  ['File name', previewModalAttachment.filename || '—'],
                  ['Size', previewModalAttachment.file_size || '—'],
                  ['Type', previewModalAttachment.file_type || '—'],
                  ['Uploaded by', previewModalAttachment.uploaded_by || 'Lab Staff'],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-xl bg-slate-50 px-3 py-2">
                    <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400">{k}</div>
                    <div className="mt-0.5 truncate font-semibold text-slate-900" title={v}>{v}</div>
                  </div>
                ))}
              </div>

              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => openFileInBrowser(previewModalAttachment.file_url, previewModalAttachment.filename, previewModalAttachment.file_type)}
                  className={`inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-4 py-2 text-xs font-bold text-white transition-all duration-500 hover:bg-indigo-600 active:scale-[0.97] ${EASE}`}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open in browser
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---------------------------- Save as Template modal ---------------------------- */}
      {templateModalOpen && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-[1.5rem] bg-slate-100 p-2 ring-1 ring-slate-900/10 shadow-[0_48px_96px_-24px_rgba(15,23,42,0.5)]">
            <div className="space-y-4 rounded-[calc(1.5rem-0.5rem)] bg-white p-5">
              <div className="flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                  <Bookmark className="h-4 w-4 text-indigo-700" /> Save as Preset Template
                </h3>
                <button
                  type="button"
                  onClick={() => setTemplateModalOpen(false)}
                  className="rounded-full p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-900"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <p className="text-xs leading-relaxed text-slate-600">
                Save teeth selection, shade, and instructions as a quick preset for future cases.
              </p>
              <div>
                <FieldLabel>Preset Template Name</FieldLabel>
                <input
                  type="text"
                  value={templateNameInput}
                  onChange={(e) => setTemplateNameInput(e.target.value)}
                  placeholder="e.g. Anterior Zirconia Shade A2 Standard"
                  className={inputCls}
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setTemplateModalOpen(false)}
                  className={`rounded-full px-4 py-2 text-xs font-bold text-slate-600 transition-colors hover:bg-slate-100 ${EASE}`}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveAsTemplate}
                  className={`inline-flex items-center gap-1.5 rounded-full bg-indigo-600 px-5 py-2 text-xs font-bold text-white transition-all duration-500 hover:bg-indigo-700 active:scale-[0.97] ${EASE}`}
                >
                  <Bookmark className="h-3.5 w-3.5" />
                  Save Preset
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---------------------------- Job slip modal (edit mode) ---------------------------- */}
      {showJobSlipModal && initialCase && (
        <CaseJobSlipModal caseData={initialCase} onClose={() => setShowJobSlipModal(false)} />
      )}
    </div>
  );
};
