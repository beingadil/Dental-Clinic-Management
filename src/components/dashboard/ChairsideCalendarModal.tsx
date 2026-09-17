import React, { useState } from 'react';
import { X, Calendar, Clock, User, CheckCircle2, AlertCircle, Plus, Sparkles, Building2, Stethoscope } from 'lucide-react';
import { DentalCase } from '../../types';
import { chairsideRepo } from '../../db/repos';
import { isDatabaseReady } from '../../db/core';

interface ChairsideCalendarModalProps {
  cases: DentalCase[];
  onClose: () => void;
  onSelectCase: (c: DentalCase) => void;
  onOpenNewCase?: () => void;
}

interface CustomAppointment {
  id: string;
  time: string;
  period: 'AM' | 'PM';
  patient: string;
  doctor: string;
  clinic: string;
  procedure: string;
  tooth: string;
  shade: string;
  status: 'confirmed' | 'in_chair' | 'pending_stl' | 'completed';
  caseRef?: string;
}

export const ChairsideCalendarModal: React.FC<ChairsideCalendarModalProps> = ({
  cases,
  onClose,
  onSelectCase,
  onOpenNewCase,
}) => {
  const [showAddForm, setShowAddForm] = useState(false);
  const [newAppt, setNewAppt] = useState({
    time: '10:00',
    period: 'AM' as 'AM' | 'PM',
    patient: '',
    doctor: '',
    clinic: '',
    procedure: 'Crown Try-in & Margin Check',
    tooth: 'FDI #',
    shade: 'A2',
    status: 'confirmed' as const
  });

  // Custom appointments persist in the SQLite `chairside_appointments` table
  // (single source of truth) — the legacy dsw_custom_chairside_appts localStorage
  // key is only read by the one-time legacy migrator.
  const [customAppointments, setCustomAppointments] = useState<CustomAppointment[]>(() => {
    try {
      if (!isDatabaseReady()) return [];
      return chairsideRepo.all().map((r: any) => ({
        id: r.id,
        time: r.time,
        period: (r.period === 'PM' ? 'PM' : 'AM') as 'AM' | 'PM',
        patient: r.patient,
        doctor: r.doctor,
        clinic: r.clinic,
        procedure: r.procedure ?? '',
        tooth: r.tooth ?? 'FDI #',
        shade: r.shade ?? 'A2',
        status: (r.status ?? 'confirmed') as CustomAppointment['status'],
        caseRef: r.case_ref ?? undefined,
      }));
    } catch {
      return [];
    }
  });

  const saveCustomAppointments = (list: CustomAppointment[]) => {
    const previous = customAppointments;
    setCustomAppointments(list);
    try {
      if (!isDatabaseReady()) return;
      const prevById = new Map(previous.map((a) => [a.id, a]));
      const nextIds = new Set(list.map((a) => a.id));
      for (const a of list) {
        if (prevById.has(a.id)) {
          chairsideRepo.update(a.id, {
            time: a.time,
            period: a.period,
            patient: a.patient,
            doctor: a.doctor,
            clinic: a.clinic,
            procedure: a.procedure,
            tooth: a.tooth,
            shade: a.shade,
            status: a.status,
            case_ref: a.caseRef ?? null,
          });
        } else {
          chairsideRepo.insert({
            id: a.id,
            time: a.time,
            period: a.period,
            patient: a.patient,
            doctor: a.doctor,
            clinic: a.clinic,
            procedure: a.procedure,
            tooth: a.tooth,
            shade: a.shade,
            status: a.status,
            case_ref: a.caseRef ?? null,
          });
        }
      }
      for (const prev of previous) {
        if (!nextIds.has(prev.id)) chairsideRepo.delete(prev.id);
      }
    } catch (e) {
      console.warn('Failed to save chairside appointments:', e);
      setCustomAppointments(previous); // revert UI to last-known DB state
    }
  };

  // Convert active cases with delivery dates into chairside appointment view items
  const caseDerivedAppointments: CustomAppointment[] = cases.slice(0, 10).map((c, idx) => {
    const hours = 9 + (idx % 8);
    const period: 'AM' | 'PM' = hours >= 12 ? 'PM' : 'AM';
    const displayHour = hours > 12 ? hours - 12 : hours;
    const timeStr = `${String(displayHour).padStart(2, '0')}:${(idx % 2 === 0 ? '00' : '30')}`;

    return {
      id: `case-appt-${c.id}`,
      time: timeStr,
      period,
      patient: c.patient_name || 'Patient',
      doctor: c.doctor_name || 'Doctor',
      clinic: c.lab_name || 'Dental Clinic',
      procedure: `${c.case_type_name || 'Dental Restoration'} Delivery & Check`,
      tooth: c.selected_teeth?.length ? `FDI #${c.selected_teeth.join(', #')}` : 'FDI Chart',
      shade: c.shade || 'A2',
      status: c.status === 'delivered' ? 'completed' : c.status === 'in_progress' ? 'in_chair' : 'confirmed',
      caseRef: c.case_number
    };
  });

  const allAppointments = [...customAppointments, ...caseDerivedAppointments];

  const handleAddAppointment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAppt.patient.trim() || !newAppt.clinic.trim()) return;

    const item: CustomAppointment = {
      id: `appt-${Date.now()}`,
      time: newAppt.time,
      period: newAppt.period,
      patient: newAppt.patient.trim(),
      doctor: newAppt.doctor.trim() || 'Dr. Assigned',
      clinic: newAppt.clinic.trim(),
      procedure: newAppt.procedure.trim(),
      tooth: newAppt.tooth.trim() || 'FDI Chart',
      shade: newAppt.shade.trim() || 'A2',
      status: newAppt.status,
    };

    saveCustomAppointments([item, ...customAppointments]);
    setShowAddForm(false);
    setNewAppt({
      time: '10:00',
      period: 'AM',
      patient: '',
      doctor: '',
      clinic: '',
      procedure: 'Crown Try-in & Margin Check',
      tooth: 'FDI #',
      shade: 'A2',
      status: 'confirmed'
    });
  };

  const toggleStatus = (id: string) => {
    const updated = customAppointments.map(a => {
      if (a.id === id) {
        const nextStatus = a.status === 'confirmed' ? 'in_chair' : a.status === 'in_chair' ? 'completed' : 'confirmed';
        return { ...a, status: nextStatus as any };
      }
      return a;
    });
    saveCustomAppointments(updated);
  };

  const handleOpenCase = (caseRef?: string) => {
    if (!caseRef) return;
    const targetCase = cases.find(c => (c.case_number || '').includes(caseRef.replace('DS-', '')));
    if (targetCase) {
      onSelectCase(targetCase);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-3xl rounded-3xl p-6 shadow-2xl border border-slate-200 space-y-4 max-h-[90vh] overflow-y-auto">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-blue-600 text-white flex items-center justify-center shadow-xs">
              <Calendar className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Chairside Clinical Trials & Try-In Schedule</h3>
              <p className="text-xs text-slate-500">Live schedule of clinic floor try-ins, shade matching & torque checks</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowAddForm(!showAddForm)}
              className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{showAddForm ? 'Cancel' : 'New Appointment'}</span>
            </button>
            <button 
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Add Appointment Form */}
        {showAddForm && (
          <form onSubmit={handleAddAppointment} className="p-4 bg-blue-50/60 rounded-2xl border border-blue-100 space-y-3">
            <div className="text-xs font-bold text-blue-900 flex items-center gap-1.5">
              <Plus className="w-3.5 h-3.5" /> Schedule Chairside Try-In Appointment
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">Patient Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Patient Name"
                  value={newAppt.patient}
                  onChange={(e) => setNewAppt({ ...newAppt, patient: e.target.value })}
                  className="w-full p-2 bg-white border border-slate-200 rounded-xl"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">Clinic / Lab *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Dental Clinic"
                  value={newAppt.clinic}
                  onChange={(e) => setNewAppt({ ...newAppt, clinic: e.target.value })}
                  className="w-full p-2 bg-white border border-slate-200 rounded-xl"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">Doctor Name</label>
                <input
                  type="text"
                  placeholder="e.g. Dr. Name"
                  value={newAppt.doctor}
                  onChange={(e) => setNewAppt({ ...newAppt, doctor: e.target.value })}
                  className="w-full p-2 bg-white border border-slate-200 rounded-xl"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">Time</label>
                <div className="flex gap-1">
                  <input
                    type="text"
                    placeholder="10:00"
                    value={newAppt.time}
                    onChange={(e) => setNewAppt({ ...newAppt, time: e.target.value })}
                    className="w-full p-2 bg-white border border-slate-200 rounded-xl text-center font-bold"
                  />
                  <select
                    value={newAppt.period}
                    onChange={(e) => setNewAppt({ ...newAppt, period: e.target.value as any })}
                    className="p-2 bg-white border border-slate-200 rounded-xl font-bold"
                  >
                    <option value="AM">AM</option>
                    <option value="PM">PM</option>
                  </select>
                </div>
              </div>
              <div className="sm:col-span-2">
                <label className="block text-[11px] font-bold text-slate-700 mb-1">Procedure</label>
                <input
                  type="text"
                  placeholder="e.g. Crown Try-in & Margin Check"
                  value={newAppt.procedure}
                  onChange={(e) => setNewAppt({ ...newAppt, procedure: e.target.value })}
                  className="w-full p-2 bg-white border border-slate-200 rounded-xl"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">Shade</label>
                <input
                  type="text"
                  placeholder="A2"
                  value={newAppt.shade}
                  onChange={(e) => setNewAppt({ ...newAppt, shade: e.target.value })}
                  className="w-full p-2 bg-white border border-slate-200 rounded-xl text-center uppercase font-bold"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-xs cursor-pointer"
              >
                Save Schedule
              </button>
            </div>
          </form>
        )}

        {/* Appointments List */}
        <div className="space-y-3">
          {allAppointments.length === 0 ? (
            <div className="p-8 text-center bg-slate-50 border border-slate-200/80 rounded-2xl space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center mx-auto">
                <Calendar className="w-6 h-6" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-slate-800">No Chairside Appointments Scheduled</h4>
                <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                  Chairside try-ins and clinical shade checks appear here automatically as cases are received, or you can add custom chairside appointments directly.
                </p>
              </div>
              <button
                onClick={() => setShowAddForm(true)}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-xs transition cursor-pointer inline-flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                <span>Add First Chairside Appointment</span>
              </button>
            </div>
          ) : (
            allAppointments.map((appt) => (
              <div
                key={appt.id}
                className="p-4 rounded-2xl border border-slate-200/80 bg-slate-50/50 hover:bg-slate-50 transition flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="flex items-start gap-3">
                  {/* Time Badge */}
                  <div className="text-center w-14 py-2 bg-white rounded-xl border border-slate-200 text-slate-800 shadow-2xs shrink-0">
                    <span className="block text-xs font-black leading-none">{appt.time}</span>
                    <span className="text-[10px] text-slate-400 font-bold uppercase">{appt.period}</span>
                  </div>

                  {/* Details */}
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <h4 className="text-xs font-bold text-slate-900">{appt.patient}</h4>
                      <span className="text-[11px] text-slate-500 font-medium">({appt.doctor})</span>
                      {appt.caseRef && (
                        <button
                          onClick={() => handleOpenCase(appt.caseRef)}
                          className="px-2 py-0.5 rounded-md bg-blue-100 text-blue-700 text-[10px] font-extrabold hover:underline cursor-pointer"
                        >
                          #{appt.caseRef}
                        </button>
                      )}
                    </div>
                    <p className="text-xs font-semibold text-slate-700">{appt.procedure}</p>
                    <div className="flex items-center gap-3 text-[11px] text-slate-500">
                      <span>Clinic: <strong className="text-slate-700">{appt.clinic}</strong></span>
                      <span>•</span>
                      <span>Tooth: <strong className="text-slate-700">{appt.tooth}</strong></span>
                      <span>•</span>
                      <span>Shade: <strong className="text-slate-700">{appt.shade}</strong></span>
                    </div>
                  </div>
                </div>

                {/* Status Toggle Button */}
                <div className="flex items-center gap-2 self-end sm:self-center">
                  <button
                    onClick={() => toggleStatus(appt.id)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition cursor-pointer ${
                      appt.status === 'confirmed'
                        ? 'bg-emerald-100 hover:bg-emerald-200 text-emerald-800'
                        : appt.status === 'in_chair'
                        ? 'bg-blue-100 hover:bg-blue-200 text-blue-800'
                        : appt.status === 'completed'
                        ? 'bg-slate-200 hover:bg-slate-300 text-slate-700'
                        : 'bg-amber-100 hover:bg-amber-200 text-amber-800'
                    }`}
                  >
                    {appt.status === 'confirmed' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />}
                    {appt.status === 'in_chair' && <Clock className="w-3.5 h-3.5 text-blue-600 animate-spin" />}
                    {appt.status === 'completed' && <CheckCircle2 className="w-3.5 h-3.5 text-slate-600" />}
                    {appt.status === 'pending_stl' && <AlertCircle className="w-3.5 h-3.5 text-amber-600" />}
                    
                    <span className="capitalize">
                      {appt.status === 'in_chair' ? 'In Chair Now' : appt.status === 'pending_stl' ? 'Pending STL' : appt.status}
                    </span>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
          <span>Total Chairside Visits: <strong>{allAppointments.length}</strong></span>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs transition cursor-pointer"
          >
            Close Calendar
          </button>
        </div>

      </div>
    </div>
  );
};
