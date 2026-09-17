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
  ShieldAlert, 
  Clock, 
  FileText, 
  Paperclip, 
  MessageSquare, 
  Sparkles, 
  DollarSign, 
  AlertCircle,
  Printer,
  Maximize2,
  Minimize2,
  User,
  Eye,
  Download,
  File,
  Image as ImageIcon,
  Upload,
  CheckCircle2,
  Box,
  Layers,
  ExternalLink,
  Save,
  FileEdit,
  Palette
} from 'lucide-react';
import { PRIORITY_SLA_DAYS, prioritySlaLabel, computeSlaDueDate } from '../../services/prioritySla';

interface CaseDetailModalProps {
  initialCase?: DentalCase | null; // null if creating new case
  appliedTemplate?: CaseTemplate | null;
  onClose: () => void;
}

export const CaseDetailModal: React.FC<CaseDetailModalProps> = ({
  initialCase,
  appliedTemplate,
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

  // Form Fields
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
  const [shade, setShade] = useState(initialCase?.shade || appliedTemplate?.shade || 'A2');
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
  const [dragActive, setDragActive] = useState(false);
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
  const [activeTab, setActiveTab] = useState<'details' | 'attachments' | 'notes'>('details');
  const [statusNote, setStatusNote] = useState('');
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [templateNameInput, setTemplateNameInput] = useState('');
  const [showJobSlipModal, setShowJobSlipModal] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Helper to categorize case attachments
  const getAttachmentCategory = (filename?: string, file_type?: string) => {
    const lowerName = (filename || '').toLowerCase();
    const ext = lowerName.split('.').pop() || '';
    const safeType = (file_type || '').toLowerCase();
    if (['stl', 'ply', 'obj', 'cad'].includes(ext) || safeType.includes('sla') || safeType.includes('model')) {
      return {
        category: '3D Dental Scan / CAD Model',
        badge: 'bg-indigo-50 text-indigo-700 border-indigo-200',
        kind: 'cad'
      };
    }
    if (['dcm', 'dicom'].includes(ext) || safeType.includes('dicom')) {
      return {
        category: 'CBCT / DICOM Scan',
        badge: 'bg-purple-50 text-purple-700 border-purple-200',
        kind: 'dicom'
      };
    }
    if (['jpg', 'jpeg', 'png', 'webp', 'heic', 'svg'].includes(ext) || safeType.startsWith('image/')) {
      return {
        category: 'Patient Photo / Shade Image',
        badge: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        kind: 'image'
      };
    }
    if (['pdf', 'doc', 'docx', 'txt'].includes(ext) || safeType.includes('pdf') || safeType.includes('word')) {
      return {
        category: 'Prescription / Clinical Notes',
        badge: 'bg-blue-50 text-blue-700 border-blue-200',
        kind: 'doc'
      };
    }
    return {
      category: 'Case File Attachment',
      badge: 'bg-slate-100 text-slate-700 border-slate-200',
      kind: 'file'
    };
  };

  // Priority toggling handler with instant feedback, SLA due-date sync
  const handlePriorityToggle = (newP: PriorityLevel) => {
    setPriority(newP);
    const label = prioritySlaLabel(newP);
    if (isEdit && initialCase) {
      updateCase(initialCase.id, { priority: newP }, `Priority set (${label})`);
      setPriorityFeedback(`Priority set: ${label}`);
      setTimeout(() => setPriorityFeedback(null), 2500);
    } else {
      // Create mode: align the target delivery date with the SLA commitment.
      setDeliveryDate(computeSlaDueDate(newP));
      setPriorityFeedback(`Priority set: ${label} (delivery auto-set)`);
      setTimeout(() => setPriorityFeedback(null), 2500);
    }
  };

  // Local storage / file system upload handler
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
          // Auto set case photo url if not set and uploaded file is an image
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

  // Preferred Lab Suggestion State
  const preferredLab = doctorName ? getDoctorPreferredLab(doctorName) : undefined;

  // Auto calculate pricing on Lab / Case Type selection if creating new case or changing case type
  useEffect(() => {
    if (isEdit) return; // don't override manually set price when editing

    const selectedLab = labs.find((l) => l.id === labId);
    const selectedCT = caseTypes.find((ct) => ct.id === caseTypeId);
    if (!selectedCT) return;

    // Check pricing overrides
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

  // Apply Doctor Preferred Lab if available
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

  // Validation
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
      const maxTime = new Date().getTime() + 365 * 24 * 60 * 60 * 1000; // 1 year
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

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

  const handleSaveDraft = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const selectedLab = labs.find((l) => l.id === labId);
    const selectedCT = caseTypes.find((ct) => ct.id === caseTypeId);
    const finalPrice = Math.max(0, (price || 0) - (discount || 0));

    if (isEdit && initialCase) {
      updateCase(
        initialCase.id,
        {
          patient_name: patientName.trim() || initialCase.patient_name || 'Draft Patient',
          lab_id: labId || labs[0]?.id || '',
          lab_name: selectedLab ? selectedLab.name : initialCase.lab_name || 'Draft Lab',
          case_type_id: caseTypeId,
          case_type_name: selectedCT ? selectedCT.name : initialCase.case_type_name || 'Dental Case',
          doctor_name: doctorName.trim() || initialCase.doctor_name || 'Draft Doctor',
          selected_teeth: selectedTeeth,
          tooth_details: toothDetails,
          shade: shade.trim() || 'A2',
          material: material.trim(),
          delivery_date: deliveryDate,
          priority,
          price: isNaN(price) ? 0 : price,
          discount: isNaN(discount) ? 0 : discount,
          final_price: finalPrice,
          instructions: instructions.trim(),
          status: 'draft',
          photo_url: photoUrl
        },
        'Saved as draft'
      );
    } else {
      const newCase = addCase({
        patient_name: patientName.trim() || 'Draft Patient',
        lab_id: labId || labs[0]?.id || '',
        lab_name: selectedLab ? selectedLab.name : 'Draft Lab',
        case_type_id: caseTypeId || caseTypes[0]?.id || '',
        case_type_name: selectedCT ? selectedCT.name : 'Dental Case',
        doctor_name: doctorName.trim() || 'Unassigned Doctor',
        selected_teeth: selectedTeeth.length > 0 ? selectedTeeth : [11],
        tooth_details: toothDetails,
        shade: shade.trim() || 'A2',
        material: material.trim(),
        delivery_date: deliveryDate,
        priority,
        price: isNaN(price) ? 0 : price,
        discount: isNaN(discount) ? 0 : discount,
        final_price: finalPrice,
        instructions: instructions.trim(),
        photo_url: photoUrl,
        status: 'draft',
      });

      if (newCase && pendingAttachments.length > 0) {
        pendingAttachments.forEach(att => addCaseAttachment(newCase.id, att));
      }
    }

    onClose();
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

  return (
    <div className={`fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center ${isFullScreen ? 'p-0' : 'p-2 sm:p-4 md:p-6'} overflow-y-auto`}>
      <div className={`bg-white shadow-2xl border border-slate-200 overflow-hidden flex flex-col transition-all duration-200 ${
        isFullScreen 
          ? 'w-full h-full max-w-none max-h-screen rounded-none' 
          : 'w-full max-w-[98vw] xl:max-w-[1580px] 2xl:max-w-[1780px] max-h-[96vh] rounded-2xl my-auto'
      }`}>
        {/* Modal Header */}
        <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between shrink-0">
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="font-bold text-lg text-white">
                {isEdit ? `Case Details: ${initialCase?.case_number}` : 'Create New Dental Case'}
              </span>

              {/* Visual Priority Indicator Badge */}
              <div 
                className={`px-3 py-1 rounded-lg text-xs font-black uppercase tracking-wider flex items-center gap-1.5 border shadow-sm transition-all ${
                  priority === 'urgent'
                    ? 'bg-rose-950/90 text-rose-300 border-rose-600 shadow-rose-900/50'
                    : priority === 'high'
                    ? 'bg-amber-950/90 text-amber-300 border-amber-600 shadow-amber-900/50'
                    : priority === 'normal'
                    ? 'bg-emerald-950/90 text-emerald-300 border-emerald-600 shadow-emerald-900/50'
                    : 'bg-blue-950/90 text-blue-300 border-blue-600 shadow-blue-900/50'
                }`}
              >
                {priority === 'urgent' && (
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
                  </span>
                )}
                {priority === 'urgent' ? (
                  <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
                ) : priority === 'high' ? (
                  <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
                ) : priority === 'normal' ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Clock className="w-3.5 h-3.5 text-blue-400" />
                )}
                <span>Priority: {priority === 'normal' ? 'Medium' : priority.charAt(0).toUpperCase() + priority.slice(1)}</span>
              </div>

              {priorityFeedback && (
                <span className="text-[11px] font-bold text-emerald-300 bg-emerald-950 px-2 py-0.5 rounded-md border border-emerald-700/60 flex items-center gap-1 animate-fadeIn">
                  <Check className="w-3 h-3 text-emerald-400" />
                  {priorityFeedback}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              {isEdit ? 'Update case workflow, FDI teeth, instructions & history' : 'Auto-generates case number and invoice record'}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowJobSlipModal(true)}
              className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg flex items-center gap-1.5 transition-all shadow-xs cursor-pointer"
              title="Print Job Slip / Workstation Routing Ticket"
            >
              <Printer className="w-4 h-4" />
              <span>Print Job Slip</span>
            </button>
            <button
              type="button"
              onClick={() => setTemplateModalOpen(true)}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors"
            >
              <Bookmark className="w-4 h-4 text-blue-400" />
              <span>Save Preset</span>
            </button>
            <button
              type="button"
              onClick={() => setIsFullScreen(!isFullScreen)}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg transition-colors cursor-pointer"
              title={isFullScreen ? "Restore Window Size" : "Expand to Full Page"}
            >
              {isFullScreen ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tab Navigation if Editing */}
        {isEdit && (
          <div className="bg-slate-100 border-b border-slate-200 px-6 flex items-center gap-4 shrink-0">
            <button
              type="button"
              onClick={() => setActiveTab('details')}
              className={`py-2.5 text-xs font-bold border-b-2 flex items-center gap-1.5 transition-colors ${
                activeTab === 'details' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              <FileText className="w-4 h-4" /> Case Details & Tooth Chart
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('attachments')}
              className={`py-2.5 text-xs font-bold border-b-2 flex items-center gap-1.5 transition-colors ${
                activeTab === 'attachments' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              <Paperclip className="w-4 h-4" /> Case Attachments & Photos
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('notes')}
              className={`py-2.5 text-xs font-bold border-b-2 flex items-center gap-1.5 transition-colors ${
                activeTab === 'notes' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              <MessageSquare className="w-4 h-4" /> Notes & History Log
            </button>
          </div>
        )}

        {/* Interactive Visual Case Stage Tracker Header */}
        <div className="bg-slate-50 border-b border-slate-200 px-6 py-3.5 shrink-0">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="font-extrabold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-indigo-600" /> Case Stage Workflow Stepper
            </span>
            <span className="text-[11px] text-slate-500">
              Click any stage step to advance or update case status
            </span>
          </div>
          <CaseProgressIndicator
            status={status}
            onStatusChange={(newStatus) => setStatus(newStatus)}
            variant="detailed"
            showLabels={true}
          />
        </div>

        {/* Modal Scrollable Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          {activeTab === 'attachments' && isEdit && initialCase && (
            <CaseAttachmentsPanel caseId={initialCase.id} />
          )}

          {activeTab === 'notes' && isEdit && initialCase && (
            <CaseNotesPanel caseId={initialCase.id} />
          )}

          {activeTab === 'details' && (
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Row 1: Patient, Doctor Name & Preferred Clinic */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1 flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-slate-400" />
                    <span>Patient Name / ID</span>
                  </label>
                  <input
                    type="text"
                    value={patientName}
                    onChange={(e) => setPatientName(e.target.value)}
                    placeholder="e.g. Sarah Jenkins (Optional)"
                    className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-blue-500 font-medium"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1">
                    Doctor Name <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={doctorName}
                    onChange={(e) => {
                      setDoctorName(e.target.value);
                      if (errors.doctorName) setErrors((prev) => ({ ...prev, doctorName: '' }));
                    }}
                    placeholder="e.g. Dr. Tariq Mahmood"
                    className={`w-full p-2.5 text-xs bg-slate-50 border rounded-xl focus:outline-none focus:ring-2 transition-all ${
                      errors.doctorName ? 'border-rose-400 bg-rose-50/20' : 'border-slate-200 focus:border-blue-500'
                    }`}
                  />
                  {errors.doctorName && <p className="text-[11px] text-rose-500 mt-1">{errors.doctorName}</p>}

                  {/* Doctor Preferred Lab Suggestion */}
                  {preferredLab && (
                    <div className="mt-2 p-2 bg-blue-50 border border-blue-200 rounded-lg flex items-center justify-between text-xs text-blue-900">
                      <span>Preferred Lab: <strong>{preferredLab.lab_name}</strong></span>
                      {labId !== preferredLab.lab_id && (
                        <button
                          type="button"
                          onClick={handleApplyPreferredLab}
                          className="px-2 py-0.5 bg-blue-600 text-white font-semibold text-[10px] rounded hover:bg-blue-700"
                        >
                          Auto-Select Lab
                        </button>
                      )}
                    </div>
                  )}
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                      Dental Clinic / Practice <span className="text-rose-500">*</span>
                    </label>
                    {doctorName && labId && (
                      <button
                        type="button"
                        onClick={handleSetDoctorPreference}
                        className="text-[10px] text-blue-600 font-semibold hover:underline"
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
                    className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-blue-500"
                  >
                    {labs.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name} ({l.phone})
                      </option>
                    ))}
                  </select>
                  {errors.labId && <p className="text-[11px] text-rose-500 mt-1">{errors.labId}</p>}
                </div>
              </div>

              {/* Row 2: Case Material, Status & Delivery Date */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1">
                    Case Procedure / Type <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={caseTypeId}
                    onChange={(e) => setCaseTypeId(e.target.value)}
                    className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-blue-500"
                  >
                    {caseTypes.map((ct) => (
                      <option key={ct.id} value={ct.id}>
                        {ct.name} (PKR {ct.base_price.toLocaleString()})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1">
                    Priority & SLA
                  </label>
                  <div className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl flex items-center gap-1">
                    {(['low', 'normal', 'high', 'urgent'] as PriorityLevel[]).map((p) => {
                      const isActive = priority === p;
                      const activeCls = p === 'urgent'
                        ? 'bg-rose-600 text-white'
                        : p === 'high'
                        ? 'bg-amber-500 text-white'
                        : p === 'normal'
                        ? 'bg-emerald-600 text-white'
                        : 'bg-blue-600 text-white';
                      return (
                        <button
                          key={p}
                          type="button"
                          onClick={() => handlePriorityToggle(p)}
                          className={`flex-1 px-1.5 py-1.5 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${
                            isActive ? activeCls + ' shadow-sm' : 'text-slate-500 hover:bg-slate-200/70'
                          }`}
                          title={`SLA: ready in ${PRIORITY_SLA_DAYS[p]} day${PRIORITY_SLA_DAYS[p] === 1 ? '' : 's'}`}
                        >
                          {p === 'normal' ? 'Medium' : p.charAt(0).toUpperCase() + p.slice(1)}
                          <span className="block text-[8px] font-semibold opacity-75">{PRIORITY_SLA_DAYS[p]}d</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1">
                    Target Delivery Date <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={deliveryDate}
                    onChange={(e) => setDeliveryDate(e.target.value)}
                    className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-blue-500"
                  />
                  {errors.deliveryDate && <p className="text-[11px] text-rose-500 mt-1">{errors.deliveryDate}</p>}
                </div>
              </div>

              {/* Odontogram (per-tooth material, prep & shade are set on the chart below) */}
              <div className="w-full">
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
                  <p className="text-xs text-rose-500 font-semibold mt-1 flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5" /> {errors.selectedTeeth}
                  </p>
                )}
              </div>

              {/* VITA Classical & Multi-Tooth Shade Selection */}
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
                    <Palette className="w-4 h-4 text-amber-600" />
                    VITA Classical & Bleach Shade Guide
                  </label>
                  <span className="text-[11px] text-slate-500">
                    Active Shade: <strong className="text-slate-900 font-mono text-xs">{shade || 'None'}</strong>
                  </span>
                </div>

                {/* VITA Classical Swatch Grid */}
                <div className="space-y-1.5">
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">VITA Classical Swatches</div>
                  <div className="grid grid-cols-8 sm:grid-cols-16 gap-1.5">
                    {['A1', 'A2', 'A3', 'A3.5', 'A4', 'B1', 'B2', 'B3', 'B4', 'C1', 'C2', 'C3', 'C4', 'D2', 'D3', 'D4'].map((s) => {
                      const isCurrent = shade === s;
                      const swatchColor = SHADE_COLORS[s] || '#F9F7EB';
                      return (
                        <button
                          key={s}
                          type="button"
                          onClick={() => {
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
                          }}
                          className={`group flex flex-col items-center p-1 rounded-lg border transition-all cursor-pointer ${
                            isCurrent
                              ? 'border-indigo-600 ring-2 ring-indigo-300 bg-white shadow-xs'
                              : 'border-slate-200 bg-white hover:border-slate-400 hover:shadow-2xs'
                          }`}
                          title={`Select VITA ${s}`}
                        >
                          <span
                            className="w-5 h-5 rounded-md border border-black/10 shadow-2xs group-hover:scale-105 transition-transform"
                            style={{ backgroundColor: swatchColor }}
                          />
                          <span className={`text-[10px] font-bold mt-0.5 ${isCurrent ? 'text-indigo-900 font-black' : 'text-slate-700'}`}>
                            {s}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Bleach Shades */}
                <div className="space-y-1.5 pt-1">
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Bleach & High-Aesthetic Shades</div>
                  <div className="flex flex-wrap gap-1.5">
                    {['BL1', 'BL2', 'BL3', 'BL4', 'OM1', 'OM2', 'OM3'].map((s) => {
                      const isCurrent = shade === s;
                      const swatchColor = SHADE_COLORS[s] || '#FFFFFF';
                      return (
                        <button
                          key={s}
                          type="button"
                          onClick={() => {
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
                          }}
                          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border transition-all cursor-pointer ${
                            isCurrent
                              ? 'border-indigo-600 ring-2 ring-indigo-300 bg-white shadow-xs'
                              : 'border-slate-200 bg-white hover:border-slate-400'
                          }`}
                        >
                          <span
                            className="w-3.5 h-3.5 rounded-full border border-black/10"
                            style={{ backgroundColor: swatchColor }}
                          />
                          <span className={`text-xs font-bold ${isCurrent ? 'text-indigo-900' : 'text-slate-700'}`}>
                            {s}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Custom multi-layer shade notes live in Technician Special Instructions below —
                    the canonical shade is picked from the swatches above (or per tooth on the chart). */}
              </div>

              {/* Pricing Breakdown Card */}
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
                <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                  <DollarSign className="w-4 h-4 text-emerald-600" />
                  Financial Calculation (PKR)
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs text-slate-600 mb-1 font-semibold">Base Price (PKR)</label>
                    <input
                      type="number"
                      value={price}
                      onChange={(e) => setPrice(Number(e.target.value))}
                      className="w-full p-2 text-xs bg-white border border-slate-200 rounded-lg font-bold text-slate-900"
                    />
                    {errors.price && <p className="text-[10px] text-rose-500 mt-0.5">{errors.price}</p>}
                  </div>

                  <div>
                    <label className="block text-xs text-slate-600 mb-1 font-semibold">Discount (PKR)</label>
                    <input
                      type="number"
                      value={discount}
                      onChange={(e) => setDiscount(Number(e.target.value))}
                      className="w-full p-2 text-xs bg-white border border-slate-200 rounded-lg font-semibold text-rose-600"
                    />
                    {errors.discount && <p className="text-[10px] text-rose-500 mt-0.5">{errors.discount}</p>}
                  </div>

                  <div>
                    <label className="block text-xs text-slate-600 mb-1 font-semibold">Final Price (PKR) — auto-computed</label>
                    <div className="p-2 bg-emerald-100 text-emerald-900 text-sm font-bold rounded-lg text-center border border-emerald-300">
                      PKR {Math.max(0, price - discount).toLocaleString()}
                    </div>
                  </div>
                </div>
              </div>

              {/* Special Instructions */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1">
                  Technician Special Instructions
                </label>
                <textarea
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  rows={3}
                  placeholder="Incisal translucency, pontic design, margin bevel specifications..."
                  className="w-full p-3 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-blue-500 resize-none"
                />
                {errors.instructions && <p className="text-[11px] text-rose-500 mt-1">{errors.instructions}</p>}
              </div>

              {/* Upload Case Picture & Other Docs from Local Storage (New Case) */}
              {!isEdit && (
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-900 flex items-center gap-1.5">
                        <Upload className="w-4 h-4 text-blue-600" />
                        Upload Case Picture & Documents from Local Storage
                      </h4>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Upload patient photos, shade guides, 3D STL scans, DICOM files, or clinical prescriptions directly from your device.
                      </p>
                    </div>
                    {pendingAttachments.length > 0 && (
                      <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-800 border border-blue-200">
                        {pendingAttachments.length} file{pendingAttachments.length > 1 ? 's' : ''} ready
                      </span>
                    )}
                  </div>

                  {/* Drag & Drop Upload Zone */}
                  <div
                    onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setDragActive(true); }}
                    onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDragActive(false); }}
                    onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragActive(true); }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setDragActive(false);
                      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                        handleLocalFileUpload(e.dataTransfer.files);
                      }
                    }}
                    className={`border-2 border-dashed rounded-xl p-5 text-center transition-all ${
                      dragActive
                        ? 'border-blue-500 bg-blue-50/70 scale-[1.005]'
                        : 'border-slate-300 bg-white hover:border-blue-400 hover:bg-slate-50/70'
                    }`}
                  >
                    <div className="w-10 h-10 mx-auto rounded-full bg-blue-50 text-blue-600 flex items-center justify-center mb-2">
                      <Paperclip className="w-5 h-5" />
                    </div>
                    <p className="text-xs font-bold text-slate-800">
                      Drag & Drop case pictures or scans here, or browse from your computer
                    </p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Supports JPG, PNG, WEBP, STL, OBJ, PLY, DCM, PDF, DOCX (Local Storage)
                    </p>

                    <label className="inline-flex items-center gap-1.5 mt-3 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-xs cursor-pointer transition-colors">
                      <Upload className="w-3.5 h-3.5" />
                      Browse Files from Local Storage
                      <input
                        type="file"
                        multiple
                        className="hidden"
                        onChange={(e) => handleLocalFileUpload(e.target.files)}
                      />
                    </label>
                  </div>

                  {uploadNotice && (
                    <div className="p-2.5 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-xl flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span className="font-semibold">{uploadNotice}</span>
                    </div>
                  )}

                  {/* Local Storage Files Preview & Metadata Cards */}
                  {pendingAttachments.length > 0 && (
                    <div className="space-y-2 pt-1">
                      <div className="text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                        Files ready to be attached on case creation:
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                        {pendingAttachments.map((att, i) => {
                          const cat = getAttachmentCategory(att?.filename, att?.file_type);
                          const isImage = (att?.file_type || '').startsWith('image/');
                          const isMainPhoto = photoUrl === att.file_url;

                          return (
                            <div
                              key={i}
                              className={`p-2.5 bg-white rounded-xl border transition-all flex items-center justify-between gap-2.5 ${
                                isMainPhoto ? 'border-emerald-400 ring-2 ring-emerald-100' : 'border-slate-200 hover:border-slate-300'
                              }`}
                            >
                              <div className="flex items-center gap-2.5 overflow-hidden">
                                <div 
                                  onClick={() => setPreviewModalAttachment(att)}
                                  className="w-11 h-11 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0 overflow-hidden cursor-pointer group"
                                  title="Click to inspect metadata & preview"
                                >
                                  {isImage ? (
                                    <img src={att.file_url} alt={att.filename} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                                  ) : cat.kind === 'cad' ? (
                                    <Box className="w-5 h-5 text-indigo-600" />
                                  ) : (
                                    <File className="w-5 h-5 text-slate-500" />
                                  )}
                                </div>
                                <div className="min-w-0">
                                  <div className="text-xs font-bold text-slate-900 truncate" title={att.filename}>
                                    {att.filename}
                                  </div>
                                  <div className="flex flex-wrap items-center gap-1 mt-0.5">
                                    <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded border ${cat.badge}`}>
                                      {cat.category}
                                    </span>
                                    <span className="text-[10px] text-slate-400">
                                      {att.file_size || 'Unknown size'}
                                    </span>
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-center gap-1 shrink-0">
                                {isImage && (
                                  <button
                                    type="button"
                                    onClick={() => setPhotoUrl(att.file_url)}
                                    className={`px-2 py-1 rounded-lg text-[10px] font-bold transition-colors cursor-pointer ${
                                      isMainPhoto
                                        ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                                        : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                                    }`}
                                    title={isMainPhoto ? 'Primary case picture' : 'Set as primary case picture'}
                                  >
                                    {isMainPhoto ? 'Primary Photo' : 'Set Main'}
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => openFileInBrowser(att.file_url, att.filename, att.file_type)}
                                  className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
                                  title="Open file in browser tab"
                                >
                                  <ExternalLink className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setPreviewModalAttachment(att)}
                                  className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
                                  title="Inspect Metadata & Preview"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setPendingAttachments(prev => prev.filter((_, idx) => idx !== i))}
                                  className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                                  title="Remove from upload queue"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Status Change Note (if editing status) */}
              {isEdit && (
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1">
                    Status History Change Log Note (Optional)
                  </label>
                  <input
                    type="text"
                    value={statusNote}
                    onChange={(e) => setStatusNote(e.target.value)}
                    placeholder="Reason for status change or QC verification note..."
                    className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl"
                  />
                </div>
              )}

              {/* History Timeline preview if editing */}
              {isEdit && initialCase && initialCase.history.length > 0 && (
                <div className="border-t border-slate-100 pt-4 space-y-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                    <Clock className="w-4 h-4 text-blue-600" /> Case Status History Timeline
                  </h4>
                  <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                    {initialCase.history.map((h) => (
                      <div key={h.id} className="p-2.5 bg-slate-50 rounded-lg border border-slate-100 text-xs flex items-center justify-between">
                        <div>
                          <span className="font-bold text-slate-900 uppercase text-[10px] px-2 py-0.5 bg-slate-200 rounded mr-2">
                            {h.status}
                          </span>
                          <span className="text-slate-600">{h.notes || 'Status updated'}</span>
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {h.timestamp} • {h.updated_by}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Dental Scans & Patient Photos Preview Section with Metadata */}
              {isEdit && initialCase && (
                <div className="border-t border-slate-200 pt-5 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-900 flex items-center gap-1.5">
                        <Paperclip className="w-4 h-4 text-blue-600" />
                        Dental Scans, CAD & Patient Photos Preview ({attachmentsForCase.length})
                      </h4>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Inspect file metadata, view 3D dental scans and patient photos, or upload additional assets from local storage.
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-bold rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer border border-blue-200">
                        <Upload className="w-3.5 h-3.5" />
                        <span>Upload from Local Storage</span>
                        <input
                          type="file"
                          multiple
                          className="hidden"
                          onChange={(e) => handleLocalFileUpload(e.target.files)}
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => setActiveTab('attachments')}
                        className="text-xs font-bold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-xl transition-colors cursor-pointer"
                      >
                        All Files Tab
                      </button>
                    </div>
                  </div>

                  {uploadNotice && (
                    <div className="p-2.5 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-xl flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span className="font-semibold">{uploadNotice}</span>
                    </div>
                  )}

                  {attachmentsForCase.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {attachmentsForCase.map((att) => {
                        const cat = getAttachmentCategory(att?.filename, att?.file_type);
                        const isImage = (att?.file_type || '').startsWith('image/');
                        const isMainPhoto = photoUrl === att.file_url;

                        return (
                          <div 
                            key={att.id} 
                            className={`p-3 bg-slate-50 hover:bg-white border rounded-xl transition-all shadow-xs flex flex-col justify-between gap-2.5 ${
                              isMainPhoto ? 'border-emerald-400 ring-2 ring-emerald-50' : 'border-slate-200 hover:border-slate-300'
                            }`}
                          >
                            <div className="flex items-start gap-3">
                              <div 
                                onClick={() => setPreviewModalAttachment(att)}
                                className="w-14 h-14 rounded-lg bg-white border border-slate-200 flex items-center justify-center shrink-0 overflow-hidden cursor-pointer group shadow-xs"
                                title="Click to view full preview & metadata"
                              >
                                {isImage ? (
                                  <img 
                                    src={att.file_url} 
                                    alt={att.filename} 
                                    className="w-full h-full object-cover group-hover:scale-105 transition-transform" 
                                  />
                                ) : cat.kind === 'cad' ? (
                                  <Box className="w-7 h-7 text-indigo-600 group-hover:scale-110 transition-transform" />
                                ) : cat.kind === 'dicom' ? (
                                  <Layers className="w-7 h-7 text-purple-600 group-hover:scale-110 transition-transform" />
                                ) : (
                                  <FileText className="w-7 h-7 text-slate-500 group-hover:scale-110 transition-transform" />
                                )}
                              </div>

                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase tracking-wider ${cat.badge}`}>
                                    {cat.category}
                                  </span>
                                  {isMainPhoto && (
                                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center gap-1">
                                      <Check className="w-2.5 h-2.5" /> Main Case Photo
                                    </span>
                                  )}
                                </div>

                                <div className="text-xs font-bold text-slate-900 truncate mt-1" title={att.filename}>
                                  {att.filename}
                                </div>

                                <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px] text-slate-500">
                                  <div>
                                    <span className="font-semibold text-slate-600">Size:</span> {att.file_size || 'N/A'}
                                  </div>
                                  <div>
                                    <span className="font-semibold text-slate-600">Type:</span> {att.file_type || 'Unknown'}
                                  </div>
                                  <div>
                                    <span className="font-semibold text-slate-600">By:</span> {att.uploaded_by || 'Lab Staff'}
                                  </div>
                                  <div>
                                    <span className="font-semibold text-slate-600">Date:</span> {att.uploaded_at ? att.uploaded_at.substring(0, 10) : 'Recent'}
                                  </div>
                                </div>
                              </div>
                            </div>

                            {/* Action Buttons for each attachment */}
                            <div className="flex items-center justify-between pt-2 border-t border-slate-200/70 text-xs">
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => openFileInBrowser(att.file_url, att.filename, att.file_type)}
                                  className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-semibold rounded-lg border border-indigo-200 flex items-center gap-1 text-[11px] transition-colors cursor-pointer"
                                  title="Open file/photo directly in browser tab"
                                >
                                  <ExternalLink className="w-3 h-3 text-indigo-600" />
                                  <span>Open in Browser</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setPreviewModalAttachment(att)}
                                  className="px-2.5 py-1 bg-white hover:bg-slate-100 text-slate-700 font-semibold rounded-lg border border-slate-200 flex items-center gap-1 text-[11px] transition-colors cursor-pointer"
                                  title="Inspect file metadata"
                                >
                                  <Eye className="w-3 h-3 text-blue-600" />
                                  <span>Preview</span>
                                </button>
                                {isImage && !isMainPhoto && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setPhotoUrl(att.file_url);
                                      updateCase(initialCase.id, { photo_url: att.file_url }, 'Updated main case photo');
                                    }}
                                    className="px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-semibold rounded-lg border border-emerald-200 text-[11px] transition-colors cursor-pointer"
                                    title="Set as primary reference photo"
                                  >
                                    Set as Main Photo
                                  </button>
                                )}
                              </div>

                              <div className="flex items-center gap-1">
                                <a
                                  href={att.file_url}
                                  download={att.filename}
                                  className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                  title="Download to local computer"
                                >
                                  <Download className="w-3.5 h-3.5" />
                                </a>
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (confirm(`Delete ${att.filename}?`)) {
                                      deleteCaseAttachment(initialCase.id, att.id);
                                    }
                                  }}
                                  className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                                  title="Delete attachment"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-center py-6 bg-slate-50 border border-slate-200 border-dashed rounded-xl">
                      <Paperclip className="w-8 h-8 text-slate-300 mx-auto mb-1.5" />
                      <p className="text-xs font-bold text-slate-700">No scans or photos attached to this case yet.</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Upload dental STL scans, intraoral photos, or clinical documents from your local storage.
                      </p>
                      <label className="inline-flex items-center gap-1.5 mt-3 px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-xs cursor-pointer transition-colors">
                        <Upload className="w-3.5 h-3.5" />
                        Browse Local Files
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
              )}

              {/* Action Buttons */}
              <div className="flex items-center justify-between pt-4 border-t border-slate-200">
                {isEdit && initialCase ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm(`Are you sure you want to PERMANENTLY delete case ${initialCase.case_number}?`)) {
                        deleteCase(initialCase.id);
                        onClose();
                      }
                    }}
                    className="px-4 py-2 bg-rose-50 hover:bg-rose-100 text-rose-600 font-semibold text-xs rounded-xl flex items-center gap-1.5 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" /> Delete Case
                  </button>
                ) : (
                  <div />
                )}

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs rounded-xl transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveDraft}
                    className="px-4 py-2 bg-slate-200/80 hover:bg-slate-300 text-slate-800 font-semibold text-xs rounded-xl border border-slate-300 flex items-center gap-1.5 transition-colors cursor-pointer"
                    title="Save case in Draft state without submitting to production"
                  >
                    <Save className="w-3.5 h-3.5 text-slate-600" />
                    <span>Save as Draft</span>
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs rounded-xl shadow-md shadow-blue-500/20 flex items-center gap-1.5 transition-all cursor-pointer"
                  >
                    <Check className="w-4 h-4" />
                    <span>{isEdit ? 'Save Changes' : 'Create Dental Case'}</span>
                  </button>
                </div>
              </div>
            </form>
          )}
        </div>
      </div>

      {/* Save as Template Modal */}
      {templateModalOpen && (
        <div className="fixed inset-0 z-60 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-5 border border-slate-200 shadow-2xl space-y-4">
            <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
              <Bookmark className="w-4 h-4 text-blue-600" /> Save Case as Template Preset
            </h3>
            <p className="text-xs text-slate-500">
              Save teeth selection, shade, and instructions as a quick preset for future cases.
            </p>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Preset Template Name</label>
              <input
                type="text"
                value={templateNameInput}
                onChange={(e) => setTemplateNameInput(e.target.value)}
                placeholder="e.g. Anterior Zirconia Shade A2 Standard"
                className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setTemplateModalOpen(false)}
                className="px-3 py-1.5 bg-slate-100 text-slate-700 text-xs font-semibold rounded-lg"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveAsTemplate}
                className="px-4 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-lg"
              >
                Save Preset
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Printable Case Job Slip Modal */}
      {showJobSlipModal && (
        <CaseJobSlipModal
          caseData={
            initialCase || {
              id: 'temp-new',
              case_number: 'CASE-DRAFT',
              patient_name: 'Patient (Pending Save)',
              lab_id: labId,
              lab_name: labs.find((l) => l.id === labId)?.name || 'Dental Clinic',
              case_type_id: caseTypeId,
              case_type_name: caseTypes.find((ct) => ct.id === caseTypeId)?.name || 'Dental Restoration',
              doctor_name: doctorName || 'Dr. Attending',
              selected_teeth: selectedTeeth,
              shade: shade || 'A2',
              delivery_date: deliveryDate,
              priority: priority,
              price: price,
              discount: discount,
              final_price: finalComputedPrice,
              instructions: instructions,
              status: status,
              photo_url: photoUrl,
              created_at: new Date().toISOString().substring(0, 10),
              updated_at: new Date().toISOString().substring(0, 10),
              history: []
            }
          }
          onClose={() => setShowJobSlipModal(false)}
        />
      )}
      {/* File Attachment Metadata & Preview Inspector Lightbox Modal */}
      {previewModalAttachment && (
        <div className="fixed inset-0 z-60 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 overflow-y-auto animate-fadeIn">
          <div className="bg-white w-full max-w-4xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh]">
            {/* Modal Header */}
            <div className="bg-slate-900 text-white px-5 py-3.5 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5 overflow-hidden">
                <span className="p-1.5 rounded-lg bg-slate-800 text-blue-400">
                  <Eye className="w-4 h-4" />
                </span>
                <div className="truncate">
                  <h3 className="text-sm font-bold text-white truncate" title={previewModalAttachment.filename}>
                    {previewModalAttachment.filename}
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Attachment Metadata & High-Resolution Preview Inspector
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPreviewModalAttachment(null)}
                className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 overflow-y-auto flex-1 grid grid-cols-1 md:grid-cols-12 gap-5">
              {/* Media Preview Stage (Left) */}
              <div className="md:col-span-7 bg-slate-950/95 rounded-xl border border-slate-800 p-3 flex flex-col items-center justify-center min-h-[320px] max-h-[500px] overflow-hidden">
                {(previewModalAttachment.file_type || '').startsWith('image/') || /\.(jpe?g|png|webp|gif)$/i.test(previewModalAttachment.filename || '') ? (
                  <img
                    src={previewModalAttachment.file_url}
                    alt={previewModalAttachment.filename || 'preview'}
                    className="max-w-full max-h-[440px] object-contain rounded-lg shadow-md"
                  />
                ) : getAttachmentCategory(previewModalAttachment.filename, previewModalAttachment.file_type).kind === 'cad' ? (
                  <div className="text-center p-6 space-y-3">
                    <div className="w-16 h-16 rounded-2xl bg-indigo-950/80 border border-indigo-700/60 text-indigo-400 flex items-center justify-center mx-auto shadow-inner">
                      <Box className="w-8 h-8" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-white">3D CAD / STL Surface Mesh</h4>
                      <p className="text-xs text-slate-400 mt-1 max-w-xs mx-auto">
                        Dental CAD scan mesh. Ready for milling, 3D printing, or CAD/CAM fabrication.
                      </p>
                    </div>
                    <span className="inline-block px-3 py-1 rounded-full text-xs font-bold bg-indigo-900/60 text-indigo-300 border border-indigo-700/60">
                      Standard Triangulation Language (STL / PLY)
                    </span>
                  </div>
                ) : getAttachmentCategory(previewModalAttachment.filename, previewModalAttachment.file_type).kind === 'dicom' ? (
                  <div className="text-center p-6 space-y-3">
                    <div className="w-16 h-16 rounded-2xl bg-purple-950/80 border border-purple-700/60 text-purple-400 flex items-center justify-center mx-auto shadow-inner">
                      <Layers className="w-8 h-8" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-white">CBCT / DICOM Volumetric Scan</h4>
                      <p className="text-xs text-slate-400 mt-1 max-w-xs mx-auto">
                        High-resolution 3D radiographic tomography slice series.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="text-center p-6 space-y-3">
                    <div className="w-16 h-16 rounded-2xl bg-slate-900 border border-slate-700 text-slate-400 flex items-center justify-center mx-auto">
                      <FileText className="w-8 h-8" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-white">Clinical Document / Prescription</h4>
                      <p className="text-xs text-slate-400 mt-1 max-w-xs mx-auto">
                        Doctor instructions, lab prescription, or patient clinical record.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Metadata Details (Right) */}
              <div className="md:col-span-5 flex flex-col justify-between space-y-4">
                <div className="space-y-4">
                  <div>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase tracking-wider ${
                      getAttachmentCategory(previewModalAttachment.filename, previewModalAttachment.file_type).badge
                    }`}>
                      {getAttachmentCategory(previewModalAttachment.filename, previewModalAttachment.file_type).category}
                    </span>
                    <h4 className="text-base font-bold text-slate-900 mt-1.5 break-all">
                      {previewModalAttachment.filename}
                    </h4>
                  </div>

                  {/* Metadata Specification Table */}
                  <div className="bg-slate-50 rounded-xl border border-slate-200 p-3.5 space-y-2.5 text-xs">
                    <div className="flex justify-between items-center py-1 border-b border-slate-200/60">
                      <span className="text-slate-500 font-medium">Case Association:</span>
                      <span className="text-slate-900 font-bold">
                        {initialCase?.case_number || 'New Case (Draft)'}
                      </span>
                    </div>
                    <div className="flex justify-between items-center py-1 border-b border-slate-200/60">
                      <span className="text-slate-500 font-medium">File Size:</span>
                      <span className="text-slate-900 font-bold">
                        {previewModalAttachment.file_size || 'N/A'}
                      </span>
                    </div>
                    <div className="flex justify-between items-center py-1 border-b border-slate-200/60">
                      <span className="text-slate-500 font-medium">MIME Type:</span>
                      <span className="text-slate-900 font-mono text-[11px] truncate max-w-[160px]" title={previewModalAttachment.file_type}>
                        {previewModalAttachment.file_type || 'application/octet-stream'}
                      </span>
                    </div>
                    <div className="flex justify-between items-center py-1 border-b border-slate-200/60">
                      <span className="text-slate-500 font-medium">Uploaded By:</span>
                      <span className="text-slate-900 font-semibold">
                        {previewModalAttachment.uploaded_by || user?.name || 'Lab Staff'}
                      </span>
                    </div>
                    <div className="flex justify-between items-center py-1">
                      <span className="text-slate-500 font-medium">Uploaded Date:</span>
                      <span className="text-slate-900 font-semibold">
                        {previewModalAttachment.uploaded_at ? previewModalAttachment.uploaded_at : 'Today (Recent)'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Direct Action Controls */}
                <div className="space-y-2 pt-2">
                  <button
                    type="button"
                    onClick={() => openFileInBrowser(previewModalAttachment.file_url, previewModalAttachment.filename, previewModalAttachment.file_type)}
                    className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-2 shadow-xs transition-colors cursor-pointer"
                  >
                    <ExternalLink className="w-4 h-4" />
                    Open File in Browser Tab
                  </button>

                  {((previewModalAttachment.file_type || '').startsWith('image/') || /\.(jpe?g|png|webp)$/i.test(previewModalAttachment.filename || '')) && (
                    <button
                      type="button"
                      onClick={() => {
                        setPhotoUrl(previewModalAttachment.file_url);
                        if (isEdit && initialCase) {
                          updateCase(initialCase.id, { photo_url: previewModalAttachment.file_url }, 'Updated main case photo');
                        }
                        setPreviewModalAttachment(null);
                      }}
                      className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-2 shadow-xs transition-colors cursor-pointer"
                    >
                      <Check className="w-4 h-4" />
                      Set as Primary Case Photo
                    </button>
                  )}

                  <a
                    href={previewModalAttachment.file_url}
                    download={previewModalAttachment.filename}
                    className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-2 shadow-xs transition-colors cursor-pointer"
                  >
                    <Download className="w-4 h-4" />
                    Download File to Computer
                  </a>

                  <button
                    type="button"
                    onClick={() => setPreviewModalAttachment(null)}
                    className="w-full py-2 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-colors cursor-pointer"
                  >
                    Close Inspector
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
