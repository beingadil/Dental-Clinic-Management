import React, { useState } from 'react';
import { X, FileText, Search, MessageSquare, ExternalLink, Calendar, User } from 'lucide-react';
import { DentalCase } from '../../types';

interface ClinicNotesModalProps {
  cases: DentalCase[];
  onClose: () => void;
  onSelectCase: (c: DentalCase) => void;
}

export const ClinicNotesModal: React.FC<ClinicNotesModalProps> = ({
  cases,
  onClose,
  onSelectCase,
}) => {
  const [searchTerm, setSearchTerm] = useState('');

  // Extract cases with instructions or notes
  const notesList = cases
    .filter(c => c.instructions || (c.doctor_name && c.patient_name))
    .filter(c => {
      const q = searchTerm.toLowerCase();
      return (
        (c.case_number || '').toLowerCase().includes(q) ||
        (c.lab_name || '').toLowerCase().includes(q) ||
        (c.doctor_name || '').toLowerCase().includes(q) ||
        (c.instructions || '').toLowerCase().includes(q) ||
        (c.patient_name || '').toLowerCase().includes(q)
      );
    });

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-2xl rounded-3xl p-6 shadow-2xl border border-slate-200 space-y-4 max-h-[90vh] overflow-y-auto">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-blue-600 text-white flex items-center justify-center shadow-xs">
              <MessageSquare className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Doctor Prescription & Clinical Notes</h3>
              <p className="text-xs text-slate-500">All instructions, margin adjustments, shade modifications & prep guidelines</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by doctor, clinic, case # or instruction keyword..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full text-xs bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-4 py-2.5 text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Notes List */}
        <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
          {notesList.length > 0 ? (
            notesList.map(c => (
              <div
                key={c.id}
                onClick={() => {
                  onSelectCase(c);
                  onClose();
                }}
                className="p-3.5 rounded-2xl bg-slate-50 hover:bg-blue-50/50 border border-slate-200/80 transition cursor-pointer group space-y-2"
              >
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-extrabold text-blue-700 group-hover:underline">#{c.case_number}</span>
                    <span className="font-bold text-slate-800">{c.lab_name}</span>
                    {c.doctor_name && (
                      <span className="text-slate-500 font-medium">({c.doctor_name})</span>
                    )}
                  </div>
                  <span className="text-[10px] text-slate-400 flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    Due {c.delivery_date}
                  </span>
                </div>

                <div className="p-2.5 rounded-xl bg-white border border-slate-200/60 text-xs text-slate-700 leading-relaxed font-medium">
                  {c.instructions || `Standard ${c.case_type_name} fabrication. Shade ${c.shade || 'A2'}, Teeth: ${c.selected_teeth?.join(', ') || 'N/A'}.`}
                </div>

                <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1">
                  <span>Patient: <strong className="text-slate-700">{c.patient_name}</strong> • Tooth: <strong className="text-slate-700">{c.selected_teeth?.map(t => `#${t}`).join(', ') || 'FDI'}</strong></span>
                  <span className="text-blue-600 font-bold flex items-center gap-1 group-hover:translate-x-0.5 transition-transform">
                    <span>Open Odontogram</span>
                    <ExternalLink className="w-3 h-3" />
                  </span>
                </div>
              </div>
            ))
          ) : (
            <div className="p-6 text-center text-slate-400 border border-dashed rounded-xl">
              No matching clinical notes found.
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="pt-2 border-t border-slate-100 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition cursor-pointer"
          >
            Close
          </button>
        </div>

      </div>
    </div>
  );
};
