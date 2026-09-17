import React from 'react';
import { DentalCase } from '../../types';
import { useApp } from '../../context/AppContext';
import { QRCodeSVG } from 'qrcode.react';
import { Phone, MapPin, Mail, Facebook, Calendar, Clock, Sparkles } from 'lucide-react';

interface LabCardSlipProps {
  caseData: DentalCase;
}

export const LabCardSlip: React.FC<LabCardSlipProps> = ({ caseData }) => {
  const { brandingSettings } = useApp();

  // Format date as DD-MM-YYYY
  const dateFormatted = caseData.created_at
    ? new Date(caseData.created_at).toLocaleDateString('en-GB', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }).replace(/\//g, '-')
    : new Date().toLocaleDateString('en-GB', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }).replace(/\//g, '-');

  // Format delivery date
  const delivDateFormatted = caseData.delivery_date
    ? new Date(caseData.delivery_date).toLocaleDateString('en-GB', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }).replace(/\//g, '-')
    : caseData.delivery_date;

  // Teeth string or representation
  const teethStr = caseData.selected_teeth.length > 0 
    ? caseData.selected_teeth.map(t => `#${t}`).join(', ') 
    : 'Full Arch';

  // QR Code tracking payload string
  const qrTrackingPayload = JSON.stringify({
    case_number: caseData.case_number,
    lab: caseData.lab_name,
    doctor: caseData.doctor_name,
    type: caseData.case_type_name,
    shade: caseData.shade || 'N/A',
    teeth: caseData.selected_teeth,
    delivery: caseData.delivery_date,
    status: caseData.status,
    lab_app: brandingSettings.appName || 'Dental Solutions'
  });

  return (
    <div className="w-full max-w-2xl bg-white border-2 border-slate-900 rounded-3xl p-6 sm:p-8 font-sans text-slate-900 shadow-xl relative print:border-black print:shadow-none print:bg-white print:p-6 print:rounded-none">
      
      {/* Top Header */}
      <div className="flex items-start justify-between border-b-2 border-slate-900 pb-4 mb-5">
        {/* Left Branding */}
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            {brandingSettings.logoUrl ? (
              <img 
                src={brandingSettings.logoUrl} 
                alt="Lab Logo" 
                className="w-10 h-10 rounded-xl object-contain bg-slate-50 border border-slate-300 p-0.5 shrink-0"
              />
            ) : (
              <div className="w-10 h-10 rounded-xl bg-slate-900 text-indigo-400 font-black text-lg flex items-center justify-center shrink-0">
                {brandingSettings.appName ? brandingSettings.appName.substring(0, 2).toUpperCase() : 'DS'}
              </div>
            )}
            <div>
              <h1 className="text-2xl font-black tracking-tight text-slate-900 uppercase">
                {brandingSettings.appName || 'DENTAL SOLUTIONS'}
              </h1>
              <p className="text-[11px] font-bold text-indigo-600 uppercase tracking-widest -mt-0.5">
                {brandingSettings.tagline || 'Digital Dental Laboratory'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 text-xs font-semibold text-slate-700 pt-1">
            <span>Date: <strong className="font-mono text-sm border-b border-slate-400 px-1.5">{dateFormatted}</strong></span>
            <span className="bg-slate-900 text-white px-2.5 py-0.5 rounded-lg text-[10px] font-black tracking-widest uppercase">
              WORKSTATION JOB SLIP
            </span>
          </div>
        </div>

        {/* Right QR Code & Serial Number */}
        <div className="flex flex-col items-end text-right space-y-1.5">
          <div className="p-1.5 bg-white border-2 border-slate-900 rounded-xl shadow-xs print:border-black">
            <QRCodeSVG 
              value={qrTrackingPayload} 
              size={68} 
              level="M" 
              includeMargin={false}
            />
          </div>
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
            Case Serial Number
          </div>
          <div className="text-base font-black font-mono text-indigo-700 print:text-black border-b-2 border-indigo-600 print:border-black px-2 py-0.5">
            #{caseData.case_number}
          </div>
        </div>
      </div>

      {/* Main Form Fields */}
      <div className="space-y-4 text-sm font-medium">
        {/* Doctor Name & Lab Name */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="flex items-baseline gap-2">
            <span className="font-extrabold text-slate-900 min-w-[75px]">Dr. Name:</span>
            <div className="flex-1 border-b-2 border-slate-300 font-extrabold text-base text-slate-900 px-2 py-0.5 bg-slate-50/50 print:bg-transparent">
              {caseData.doctor_name || 'Dr. Attending'}
            </div>
          </div>

          <div className="flex items-baseline gap-2">
            <span className="font-extrabold text-slate-900 min-w-[75px]">Clinic / Pt:</span>
            <div className="flex-1 border-b-2 border-slate-300 font-extrabold text-base text-indigo-900 print:text-black px-2 py-0.5 bg-slate-50/50 print:bg-transparent">
              {caseData.lab_name}
            </div>
          </div>
        </div>

        {/* Teeth Numbers & Material */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="flex items-baseline gap-2">
            <span className="font-extrabold text-slate-900 min-w-[75px]">Teeth No:</span>
            <div className="flex-1 border-b-2 border-slate-300 font-mono font-black text-indigo-700 print:text-black px-2 py-0.5 bg-indigo-50/30 print:bg-transparent">
              {teethStr}
            </div>
          </div>

          <div className="flex items-baseline gap-2">
            <span className="font-extrabold text-slate-900 min-w-[75px]">Material:</span>
            <div className="flex-1 border-b-2 border-slate-300 font-bold text-slate-900 px-2 py-0.5 bg-slate-50/50 print:bg-transparent">
              {caseData.case_type_name}
            </div>
          </div>
        </div>

        {/* Shade & Priority */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="flex items-baseline gap-2">
            <span className="font-extrabold text-slate-900 min-w-[75px]">Shade:</span>
            <div className="flex-1 border-b-2 border-slate-300 font-mono font-black text-lg text-amber-700 print:text-black px-2 py-0.5 tracking-wider bg-amber-50/30 print:bg-transparent">
              {caseData.shade || 'A1.5'}
            </div>
          </div>

          <div className="flex items-baseline gap-2">
            <span className="font-extrabold text-slate-900 min-w-[75px]">Priority:</span>
            <div className="flex-1 border-b-2 border-slate-300 font-bold text-slate-900 uppercase text-xs px-2 py-0.5">
              <span className={`px-2 py-0.5 rounded font-black ${
                caseData.priority === 'urgent' 
                  ? 'bg-rose-100 text-rose-800' 
                  : 'bg-slate-100 text-slate-800'
              }`}>
                {caseData.priority}
              </span>
            </div>
          </div>
        </div>

        {/* Instructions */}
        <div className="space-y-1">
          <div className="font-extrabold text-slate-900">Workstation Instructions:</div>
          <div className="border-2 border-slate-200 rounded-xl p-3 font-semibold text-slate-800 bg-slate-50/80 min-h-[50px] text-xs leading-relaxed print:bg-transparent print:border-black">
            {caseData.instructions || 'Standard anatomical contours & high-gloss polish.'}
          </div>
        </div>

        {/* Delivery Date & Time */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
          <div className="flex items-baseline gap-2">
            <span className="font-extrabold text-slate-900 min-w-[95px]">Delivery Date:</span>
            <div className="flex-1 border-b-2 border-slate-900 font-mono font-black text-base text-slate-900 px-2 py-0.5">
              {delivDateFormatted}
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="font-extrabold text-slate-900 min-w-[75px]">Time:</span>
            <div className="flex-1 border-b-2 border-slate-900 font-mono font-black text-base text-slate-900 px-2 py-0.5">
              05:00 PM
            </div>
          </div>
        </div>
      </div>

      {/* Footer Contact Details */}
      <div className="mt-6 pt-4 border-t-2 border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-2 text-[11px] text-slate-600 font-medium print:border-black">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-1 font-bold text-slate-900">
            <Phone className="w-3.5 h-3.5 text-indigo-600 print:text-black" /> {brandingSettings.phone || '0333-0473797'}
          </span>
          <span className="flex items-center gap-1 font-semibold">
            <Mail className="w-3.5 h-3.5 text-indigo-600 print:text-black" /> {brandingSettings.email || 'info@dentalsolutions.pk'}
          </span>
        </div>
        <div className="flex items-center gap-1 text-[10px] text-center sm:text-right">
          <MapPin className="w-3.5 h-3.5 text-indigo-600 shrink-0 print:text-black" />
          <span>{brandingSettings.address || 'Batala Street Near Railway Park, Gill Road, Gujranwala.'}</span>
        </div>
      </div>
    </div>
  );
};
