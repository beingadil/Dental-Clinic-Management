import React, { useRef, useState } from 'react';
import { PaymentAttachment } from '../../types';
import { UploadCloud, X, Image as ImageIcon, FileText, AlertCircle } from 'lucide-react';

interface PaymentProofUploaderProps {
  attachments: PaymentAttachment[];
  onChange: (attachments: PaymentAttachment[]) => void;
  maxFiles?: number;
}

export const PaymentProofUploader: React.FC<PaymentProofUploaderProps> = ({
  attachments,
  onChange,
  maxFiles = 5
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  // Compress & encode image to base64 to keep storage efficient and safe
  const processImageFile = (file: File): Promise<PaymentAttachment> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const rawUrl = e.target?.result as string;

        // If file is image, compress via canvas
        if (file.type.startsWith('image/')) {
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            const MAX_WIDTH = 1200;
            const MAX_HEIGHT = 1200;
            let width = img.width;
            let height = img.height;

            if (width > height) {
              if (width > MAX_WIDTH) {
                height *= MAX_WIDTH / width;
                width = MAX_WIDTH;
              }
            } else {
              if (height > MAX_HEIGHT) {
                width *= MAX_HEIGHT / height;
                height = MAX_HEIGHT;
              }
            }

            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.drawImage(img, 0, 0, width, height);
              const compressedUrl = canvas.toDataURL('image/jpeg', 0.8);
              const sizeInKb = Math.round((compressedUrl.length * 3) / 4 / 1024);
              resolve({
                id: `patt-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
                payment_id: '',
                file_name: file.name,
                file_type: 'image/jpeg',
                file_size: `${sizeInKb} KB`,
                file_url: compressedUrl,
                uploaded_at: new Date().toISOString().replace('T', ' ').substring(0, 16)
              });
            } else {
              resolve({
                id: `patt-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
                payment_id: '',
                file_name: file.name,
                file_type: file.type,
                file_size: `${Math.round(file.size / 1024)} KB`,
                file_url: rawUrl,
                uploaded_at: new Date().toISOString().replace('T', ' ').substring(0, 16)
              });
            }
          };
          img.onerror = () => reject(new Error('Failed to load image for processing'));
          img.src = rawUrl;
        } else {
          resolve({
            id: `patt-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            payment_id: '',
            file_name: file.name,
            file_type: file.type,
            file_size: `${Math.round(file.size / 1024)} KB`,
            file_url: rawUrl,
            uploaded_at: new Date().toISOString().replace('T', ' ').substring(0, 16)
          });
        }
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setErrorMsg(null);

    if (attachments.length + files.length > maxFiles) {
      setErrorMsg(`Maximum of ${maxFiles} proof attachments allowed per payment.`);
      return;
    }

    setIsProcessing(true);
    try {
      const newItems: PaymentAttachment[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.size > 5 * 1024 * 1024) {
          setErrorMsg(`File "${file.name}" exceeds 5MB limit.`);
          continue;
        }
        const processed = await processImageFile(file);
        newItems.push(processed);
      }
      onChange([...attachments, ...newItems]);
    } catch (err) {
      console.error(err);
      setErrorMsg('Failed to process one or more images.');
    } finally {
      setIsProcessing(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const removeAttachment = (indexToRemove: number) => {
    onChange(attachments.filter((_, idx) => idx !== indexToRemove));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
          <ImageIcon className="w-3.5 h-3.5 text-indigo-600" />
          <span>Payment Proof / Transfer Receipts ({attachments.length}/{maxFiles})</span>
        </label>
        <span className="text-[11px] text-slate-400">PNG, JPG, WebP (Max 5MB each)</span>
      </div>

      {/* Upload Zone */}
      <div
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          handleFiles(e.dataTransfer.files);
        }}
        className={`border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-1.5 ${
          attachments.length >= maxFiles
            ? 'bg-slate-50 border-slate-200 cursor-not-allowed opacity-60'
            : 'bg-indigo-50/40 border-indigo-200 hover:bg-indigo-50 hover:border-indigo-400'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,.pdf"
          disabled={attachments.length >= maxFiles || isProcessing}
          onChange={(e) => handleFiles(e.target.files)}
          className="hidden"
        />

        <UploadCloud className="w-6 h-6 text-indigo-600" />
        <p className="text-xs font-semibold text-slate-700">
          {isProcessing ? 'Optimizing & Attaching images...' : 'Click to browse or drag & drop payment proof screenshots'}
        </p>
        <p className="text-[10px] text-slate-500">
          Deposit slips, Meezan/HBL bank transfer receipts, cash vouchers, or cheque images
        </p>
      </div>

      {errorMsg && (
        <div className="flex items-center gap-1.5 text-xs text-rose-600 bg-rose-50 border border-rose-200 p-2 rounded-lg">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Preview Thumbnails List */}
      {attachments.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 pt-1">
          {attachments.map((att, idx) => (
            <div
              key={att.id || idx}
              className="relative group bg-white border border-slate-200 rounded-xl p-2 flex items-center gap-2 shadow-xs hover:border-slate-300 transition-all"
            >
              {att.file_url && att.file_type?.startsWith('image/') ? (
                <img
                  src={att.file_url}
                  alt={att.file_name}
                  className="w-10 h-10 object-cover rounded-lg border border-slate-100 shrink-0"
                />
              ) : (
                <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center text-slate-500 shrink-0">
                  <FileText className="w-5 h-5" />
                </div>
              )}

              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-slate-800 truncate" title={att.file_name}>
                  {att.file_name}
                </p>
                <p className="text-[10px] text-slate-400">{att.file_size || 'Image'}</p>
              </div>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  removeAttachment(idx);
                }}
                className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                title="Remove attachment"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
