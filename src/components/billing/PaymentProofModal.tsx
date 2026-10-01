import React, { useState } from 'react';
import { PaymentRecord, PaymentAttachment } from '../../types';
import { Download, ExternalLink, Image as ImageIcon, ChevronLeft, ChevronRight, FileText } from 'lucide-react';
import { Modal } from '../common/ui';

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
    <Modal
      open
      onClose={onClose}
      label="Payment proof attachment"
      maxWidth="max-w-3xl"
      cardClassName="flex flex-col max-h-[90vh]"
      backdropClassName="bg-slate-900/80"
      header={
        <div className="flex flex-wrap items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-brand-100 flex items-center justify-center text-brand-700">
            <ImageIcon className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-slate-900">Payment Proof Documents</h3>
              <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-brand-50 text-brand-700 border border-brand-200">
                {payment.payment_number || 'Receipt'}
              </span>
            </div>
            <p className="text-xs text-slate-500">
              Invoice {payment.invoice_number} • {payment.lab_name} • PKR {payment.amount.toLocaleString()}
            </p>
          </div>
          <button
            onClick={() => handleDownload(currentAttachment)}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 transition-colors flex items-center gap-1.5 shadow-2xs cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-slate-500" />
            <span>Download</span>
          </button>
        </div>
      }
    >

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
                className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-xs font-semibold flex items-center gap-2 cursor-pointer"
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
                className="absolute left-4 top-1/2 -translate-y-1/2 p-2 bg-black/60 hover:bg-black/80 text-white rounded-full transition-colors backdrop-blur-xs cursor-pointer"
                title="Previous attachment"
                aria-label="Previous attachment"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <button
                onClick={() => setCurrentIndex((prev) => (prev < attachments.length - 1 ? prev + 1 : 0))}
                className="absolute right-4 top-1/2 -translate-y-1/2 p-2 bg-black/60 hover:bg-black/80 text-white rounded-full transition-colors backdrop-blur-xs cursor-pointer"
                title="Next attachment"
                aria-label="Next attachment"
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
            <p className="text-[11px] text-slate-500">
              Uploaded on {currentAttachment.uploaded_at} by {currentAttachment.uploaded_by || 'Staff'} • {currentAttachment.file_size}
            </p>
          </div>

          {attachments.length > 1 && (
            <div className="flex items-center gap-1.5">
              {attachments.map((att, idx) => (
                <button
                  key={att.id || idx}
                  onClick={() => setCurrentIndex(idx)}
                  aria-label={`Show attachment ${idx + 1} of ${attachments.length}`}
                  aria-current={currentIndex === idx}
                  className={`w-10 h-10 rounded-lg overflow-hidden border-2 transition-all cursor-pointer ${
                    currentIndex === idx ? 'border-brand-600 scale-105 shadow-xs' : 'border-transparent opacity-60 hover:opacity-100'
                  }`}
                >
                  <img src={att.file_url} alt="" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>
    </Modal>
  );
};
