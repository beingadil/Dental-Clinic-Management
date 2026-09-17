import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { CaseAttachment } from '../../types';
import { openFileInBrowser } from '../../utils/fileUtils';
import { 
  Upload, 
  File, 
  Image as ImageIcon, 
  Download, 
  Trash2, 
  Eye, 
  X, 
  CheckCircle2, 
  Box, 
  Layers, 
  FileText,
  ExternalLink
} from 'lucide-react';

interface CaseAttachmentsPanelProps {
  caseId: string;
}

export const CaseAttachmentsPanel: React.FC<CaseAttachmentsPanelProps> = ({ caseId }) => {
  const { caseAttachments, addCaseAttachment, deleteCaseAttachment, user } = useApp();
  const attachments = (caseAttachments && caseAttachments[caseId]) || [];

  const [previewItem, setPreviewItem] = useState<CaseAttachment | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [uploadedMsg, setUploadedMsg] = useState('');

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

  const handleFileUpload = (files: FileList | null) => {
    if (!files || files.length === 0) return;

    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onerror = (e) => {
        console.warn('Error reading attachment:', e);
      };
      reader.onload = (e) => {
        const result = e.target?.result as string;
        addCaseAttachment(caseId, {
          filename: file.name || 'unnamed-file',
          file_type: file.type || 'application/octet-stream',
          file_url: result,
          uploaded_by: user ? user.name : 'Lab Staff',
          file_size: `${(file.size / (1024 * 1024)).toFixed(2)} MB`
        });
        setUploadedMsg(`Uploaded ${file.name} successfully!`);
        setTimeout(() => setUploadedMsg(''), 3000);
      };
      reader.readAsDataURL(file);
    });
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileUpload(e.dataTransfer.files);
    }
  };

  return (
    <div className="space-y-4">
      {/* Upload Drag & Drop Area */}
      <div
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded-xl p-6 text-center transition-all ${
          dragActive
            ? 'border-blue-500 bg-blue-50/50 scale-[1.01]'
            : 'border-slate-200 bg-slate-50/50 hover:border-blue-400 hover:bg-slate-50'
        }`}
      >
        <div className="w-10 h-10 mx-auto rounded-full bg-blue-100 text-blue-600 flex items-center justify-center mb-2">
          <Upload className="w-5 h-5" />
        </div>
        <h4 className="text-xs font-bold text-slate-800">
          Drag & Drop Case Photos, STL Scans, or Documents from Local Storage
        </h4>
        <p className="text-[11px] text-slate-500 mt-1">Supports JPG, PNG, PDF, STL, PLY, OBJ, DCM, DOCX</p>

        <label className="inline-block mt-3 px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs rounded-xl cursor-pointer shadow-xs transition-colors">
          Browse Local Files
          <input
            type="file"
            multiple
            className="hidden"
            onChange={(e) => handleFileUpload(e.target.files)}
          />
        </label>
      </div>

      {uploadedMsg && (
        <div className="p-2.5 bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs rounded-lg flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          <span>{uploadedMsg}</span>
        </div>
      )}

      {/* Attachments List */}
      <div className="space-y-2">
        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
          Attached Dental Scans & Patient Photos ({attachments.length})
        </h4>

        {attachments.length === 0 ? (
          <div className="text-center py-8 text-xs text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-200">
            No files or dental scans attached to this case yet.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {attachments.map((att) => {
              const cat = getAttachmentCategory(att.filename, att.file_type);
              const isImage = (att.file_type || '').startsWith('image/');

              return (
                <div
                  key={att.id}
                  className="p-3 bg-white rounded-xl border border-slate-200 shadow-xs flex items-center justify-between gap-3 hover:border-blue-200 transition-all group"
                >
                  <div className="flex items-center gap-3 overflow-hidden">
                    <div 
                      onClick={() => setPreviewItem(att)}
                      className="w-12 h-12 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0 overflow-hidden cursor-pointer"
                      title="Inspect metadata & preview"
                    >
                      {isImage ? (
                        <img src={att.file_url} alt={att.filename} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                      ) : cat.kind === 'cad' ? (
                        <Box className="w-6 h-6 text-indigo-600" />
                      ) : cat.kind === 'dicom' ? (
                        <Layers className="w-6 h-6 text-purple-600" />
                      ) : (
                        <FileText className="w-6 h-6 text-slate-500" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-slate-900 truncate" title={att.filename}>
                        {att.filename}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded border ${cat.badge}`}>
                          {cat.category}
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        {att.uploaded_at} • {att.file_size || 'N/A'} • {att.uploaded_by}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => openFileInBrowser(att.file_url, att.filename, att.file_type)}
                      className="p-1.5 text-slate-600 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors cursor-pointer"
                      title="Open file in browser tab"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreviewItem(att)}
                      className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors cursor-pointer"
                      title="Inspect Metadata & Preview"
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                    <a
                      href={att.file_url}
                      download={att.filename}
                      className="p-1.5 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-md transition-colors"
                      title="Download to computer"
                    >
                      <Download className="w-4 h-4" />
                    </a>
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm(`Delete attachment "${att.filename}"?`)) {
                          deleteCaseAttachment(caseId, att.id);
                        }
                      }}
                      className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-md transition-colors cursor-pointer"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Preview Modal with Metadata & Open in Browser button */}
      {previewItem && (
        <div className="fixed inset-0 z-60 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-5 border border-slate-200 shadow-2xl relative">
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-100">
              <div>
                <h3 className="font-bold text-sm text-slate-900 break-all">{previewItem.filename}</h3>
                <p className="text-xs text-slate-500">
                  Uploaded by {previewItem.uploaded_by} • {previewItem.uploaded_at}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewItem(null)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="max-h-[60vh] overflow-auto flex items-center justify-center bg-slate-950/95 rounded-xl p-4 mb-4">
              {(previewItem.file_type || '').startsWith('image/') ? (
                <img src={previewItem.file_url} alt={previewItem.filename} className="max-h-[50vh] object-contain rounded-lg shadow" />
              ) : getAttachmentCategory(previewItem.filename, previewItem.file_type).kind === 'cad' ? (
                <div className="text-center py-8 text-white space-y-2">
                  <Box className="w-12 h-12 text-indigo-400 mx-auto" />
                  <p className="text-sm font-bold">3D Dental CAD / STL Mesh</p>
                  <p className="text-xs text-slate-400">Ready for 3D printing and milling workstations</p>
                </div>
              ) : (
                <div className="text-center py-8 text-white space-y-2">
                  <FileText className="w-12 h-12 text-slate-400 mx-auto" />
                  <p className="text-sm font-bold">{previewItem.filename}</p>
                  <p className="text-xs text-slate-400">Clinical document & prescription record</p>
                </div>
              )}
            </div>

            {/* Metadata Table */}
            <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 grid grid-cols-2 gap-2 text-xs mb-4">
              <div><span className="font-bold text-slate-600">Category:</span> {getAttachmentCategory(previewItem.filename, previewItem.file_type).category}</div>
              <div><span className="font-bold text-slate-600">File Size:</span> {previewItem.file_size || 'N/A'}</div>
              <div><span className="font-bold text-slate-600">Type:</span> {previewItem.file_type}</div>
              <div><span className="font-bold text-slate-600">Uploaded By:</span> {previewItem.uploaded_by}</div>
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => openFileInBrowser(previewItem.file_url, previewItem.filename, previewItem.file_type)}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl shadow-xs transition-colors cursor-pointer"
              >
                <ExternalLink className="w-4 h-4" /> Open in Browser
              </button>
              <a
                href={previewItem.file_url}
                download={previewItem.filename}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl shadow-xs transition-colors"
              >
                <Download className="w-4 h-4" /> Download File
              </a>
              <button
                type="button"
                onClick={() => setPreviewItem(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
