import React, { useState } from 'react';
import { PaymentRecord, PaymentAttachment } from '../../types';
import { X, Download, ExternalLink, Image as ImageIcon, ChevronLeft, ChevronRight, FileText } from 'lucide-react';

interface PaymentProofModalProps {
  payment: PaymentRecord;
  onClose: () => void;
}

export const PaymentProofModal: React.FC<PaymentProofModalProps> = ({ payment, onClose }) => {
  const attachments = payment.attachments || [];
  const [currentIndex, setCurrentIndex] = useState(0);

  if (attachments.length === 0) {
    return null;
  }

  const currentAttachment: PaymentAttachment = attachments[currentIndex];

  const handleDownload = (att: PaymentAttachment) => {
    if (!att.file_url) return;
    const a = document.createElement('a');
    a.href = att.file_url;
    a.download = att.file_name || `payment_proof_${payment.payment_number || 'receipt'}.jpg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center text-indigo-700">
              <ImageIcon className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-slate-900">Payment Proof Documents</h3>
                <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                  {payment.payment_number || 'Receipt'}
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Invoice {payment.invoice_number} • {payment.lab_name} • PKR {payment.amount.toLocaleString()}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => handleDownload(currentAttachment)}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 transition-colors flex items-center gap-1.5 shadow-2xs"
            >
              <Download className="w-3.5 h-3.5 text-slate-500" />
              <span>Download</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content Viewer */}
        <div className="flex-1 min-h-[360px] max-h-[500px] bg-slate-950 flex items-center justify-center relative p-4 select-none">
          {currentAttachment.file_url && currentAttachment.file_type?.startsWith('image/') ? (
            <img
              src={currentAttachment.file_url}
              alt={currentAttachment.file_name}
              className="max-h-full max-w-full object-contain rounded-lg shadow-lg"
            />
          ) : (
            <div className="flex flex-col items-center gap-3 text-slate-300">
              <FileText className="w-16 h-16 text-slate-500" />
              <p className="text-sm font-medium">{currentAttachment.file_name}</p>
              <button
                onClick={() => handleDownload(currentAttachment)}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold flex items-center gap-2"
              >
                <Download className="w-4 h-4" />
                <span>Download Attachment ({currentAttachment.file_size})</span>
              </button>
            </div>
          )}

          {/* Navigation Arrows */}
          {attachments.length > 1 && (
            <>
              <button
                onClick={() => setCurrentIndex((prev) => (prev > 0 ? prev - 1 : attachments.length - 1))}
                className="absolute left-4 top-1/2 -translate-y-1/2 p-2 bg-black/60 hover:bg-black/80 text-white rounded-full transition-colors backdrop-blur-xs"
                title="Previous attachment"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <button
                onClick={() => setCurrentIndex((prev) => (prev < attachments.length - 1 ? prev + 1 : 0))}
                className="absolute right-4 top-1/2 -translate-y-1/2 p-2 bg-black/60 hover:bg-black/80 text-white rounded-full transition-colors backdrop-blur-xs"
                title="Next attachment"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </>
          )}
        </div>

        {/* Footer info & thumbnails */}
        <div className="px-6 py-3 border-t border-slate-100 bg-white flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-slate-900 truncate max-w-md">{currentAttachment.file_name}</p>
            <p className="text-[11px] text-slate-400">
              Uploaded on {currentAttachment.uploaded_at} by {currentAttachment.uploaded_by || 'Staff'} • {currentAttachment.file_size}
            </p>
          </div>

          {attachments.length > 1 && (
            <div className="flex items-center gap-1.5">
              {attachments.map((att, idx) => (
                <button
                  key={att.id || idx}
                  onClick={() => setCurrentIndex(idx)}
                  className={`w-10 h-10 rounded-lg overflow-hidden border-2 transition-all ${
                    currentIndex === idx ? 'border-indigo-600 scale-105 shadow-xs' : 'border-transparent opacity-60 hover:opacity-100'
                  }`}
                >
                  <img src={att.file_url} alt="" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
