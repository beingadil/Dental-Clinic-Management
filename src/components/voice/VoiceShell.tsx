import React, { useEffect, useMemo, useRef, useState } from 'react';
import { VoiceOrb } from './VoiceOrb';
import { listMemories, clearMemories } from '../../services/voiceMemory';
import { X, SendHorizonal, AudioLines, CheckCircle2, History, Sparkles, Maximize2, Minimize2 } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { moduleForView, isViewProtected, isModuleUnlocked } from '../../services/moduleSecurity';
import { speak, cancelSpeech } from '../../services/voiceUtterance';
import { askAssistant } from '../../services/voiceAssistant';
import { probeGroq } from '../../services/voiceGate';
import { can, canPost } from '../../services/permissions';
import { savePrintSettings, saveDocumentSections, setStatementBankExcluded, setInvoiceSummaryExcluded } from '../../services/printSettings';
import { saveNotificationConfig, announceNotificationConfigChanged } from '../../services/notificationSettings';
import { closeMonth } from '../../services/monthClose';
import { groqEnabled } from '../../services/voiceGroq';
import { recordClip, transcribeWithGroq } from '../../services/voiceGroqStt';
import type { WriteCommand } from '../../services/voiceWrite';
import { getTodayStr } from '../../utils/dateUtils';
import { invoiceBalanceDue } from '../../services/financeDomain';

type ShellStatus = 'idle' | 'listening' | 'thinking' | 'locked' | 'error' | 'done';

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e?: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

const getRecognition = (): SpeechRecognitionLike | null => {
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.lang = 'en-PK';
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  return rec;
};

const rankCandidates = (labs: { id: string; name: string }[], hint: string) => {
  const f = hint.toLowerCase();
  return labs
    .map((lab) => ({ lab, score: f.split(' ').filter((tok) => tok.length >= 3).reduce((acc, tok) => acc + (lab.name.toLowerCase().includes(tok) ? tok.length : 0), 0) }))
    .filter((x) => x.score > 0 || x.lab.name.toLowerCase().includes(f))
    .sort((a, b) => b.score - a.score);
};

/** Push-to-talk + offline answers. Write actions require explicit confirmation. */
export const VoiceShell: React.FC = () => {
  const {
    user, currentView, userPreferences, labs, invoices, advancePayments, accountAdjustments, cases,
    caseTypes, labContacts, labAddresses, pricingOverrides,
    addLabContact, addLabAddress, addPricingOverride, addCase, applyAdvanceCreditV2, bulkMarkPaid,
    recordTransactionV2, recordAdvanceDepositV2, setCurrentView, addLab, updateLab, updateCase, addCaseNote, recordQcCase, archiveCase,
  } = useApp();
  const [open, setOpen] = useState(false);
  const [online, setOnline] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [memoryCount, setMemoryCount] = useState(() => listMemories().length);
  const [status, setStatus] = useState<ShellStatus>('idle');
  const [query, setQuery] = useState('');
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<WriteCommand | null>(null);
  const [pendingRisk, setPendingRisk] = useState<'write' | 'destructive'>('write');
  const [pendingNote, setPendingNote] = useState('');
  type SlotMode =
    | { kind: 'createClinic'; step: 'name' | 'doctor' | 'phone'; name?: string; doctor?: string; phone?: string }
    | { kind: 'createCase'; step: 'patient' | 'clinic' | 'caseType' | 'teeth' | 'price' | 'priority' | 'shade' | 'delivery' | 'doctor'; patient?: string; clinic?: string; caseType?: string; teeth?: number[]; doctor?: string; price?: number; priority?: string; shade?: string; delivery?: string };
  const [slotMode, setSlotMode] = useState<SlotMode | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const cloudStop = useRef<null | (() => void)>(null);

  const voiceEnabled = !!userPreferences?.voice_enabled;
  const cloudMic = !!userPreferences?.voice_cloud_transcription && groqEnabled();
  const locked = useMemo(() => {
    const id = moduleForView(currentView);
    if (!id) return false;
    return isViewProtected(id, currentView) && !isModuleUnlocked(id);
  }, [currentView]);

  const close = () => { setOpen(false); setStatus('idle'); cancelSpeech(); recRef.current?.stop(); cloudStop.current?.(); cloudStop.current = null; };
  const toggle = () => {
    if (locked) { setStatus('locked'); setAnswer('This module is locked.'); return; }
    setOpen((v) => { const next = !v; if (next) setStatus('idle'); return next; });
  };

  const queueWrite = (cmd: WriteCommand, note: string, risk: 'write' | 'destructive' = 'write') => {
    setPending(cmd);
    setPendingRisk(risk);
    setPendingNote(note);
    setStatus('done');
    const destructiveBanner = risk === 'destructive' ? 'DESTRUCTIVE — this cannot be undone: ' : '';
    if (cmd.kind === 'createClinic') {
      setAnswer(`${destructiveBanner}Confirm: create clinic “${cmd.clinicHint}”?`);
      speak(`Confirm: create clinic ${cmd.clinicHint}.`, { rate: userPreferences?.voice_tts_rate, voiceUri: userPreferences?.voice_tts_voice_uri, locale: userPreferences?.voice_locale || 'en-PK', allowClinicalDetail: false });
      return;
    }
    if (cmd.kind === 'createCase') {
      setAnswer(`${destructiveBanner}Confirm: create case for ${cmd.patientName ?? 'patient'} — ${cmd.caseTypeName ?? 'case'} at ${cmd.clinicHint} — PKR ${cmd.amount.toLocaleString()}?`);
      speak(`Confirm: create case for ${cmd.patientName ?? 'patient'} at ${cmd.clinicHint}.`, { rate: userPreferences?.voice_tts_rate, voiceUri: userPreferences?.voice_tts_voice_uri, locale: userPreferences?.voice_locale || 'en-PK', allowClinicalDetail: false });
      return;
    }
    if (cmd.amount === 0) {
      const label = (() => {
        switch (cmd.kind) {
          case 'printSettingsSave': return 'apply the print settings';
          case 'printSectionsSave': return `set ${cmd.docKind} print sections`;
          case 'notificationConfigSave': return 'save the notification configuration';
          case 'closeMonth': return `close ${cmd.month || ''} for ${cmd.labName || cmd.clinicHint}`;
          case 'setCaseStatus': return `move case ${cmd.caseNumber} to “${cmd.targetStatus}”`;
          case 'addCaseNote': return `add a note to ${cmd.caseNumber}`;
          case 'recordQc': return `record QC ${cmd.qcResult?.toUpperCase()} for ${cmd.caseNumber}`;
          case 'archiveCase': return `archive ${cmd.caseNumber}`;
          case 'updateClinicField': return `update ${cmd.field} for ${cmd.clinicHint} to “${cmd.value}”`;
          case 'updateClinicDoctor': return `set doctor for ${cmd.clinicHint} to ${cmd.doctorName}`;
          case 'addClinicContact': return `add contact “${cmd.contactName}” to ${cmd.clinicHint}`;
          case 'addClinicAddress': return `add a ${cmd.addressType} address for ${cmd.clinicHint}`;
          case 'addPricingOverride': return `set pricing override for ${cmd.caseTypeName} at ${cmd.clinicHint}`;
          default: return 'continue';
        }
      })();
      setAnswer(`${destructiveBanner}Confirm: ${label}.`);
      speak(`Confirm: ${label}.`, { rate: userPreferences?.voice_tts_rate, voiceUri: userPreferences?.voice_tts_voice_uri, locale: userPreferences?.voice_locale || 'en-PK', allowClinicalDetail: false });
      return;
    }
    const amount = `PKR ${cmd.amount.toLocaleString()}`;
    const kind = cmd.kind === 'payment' ? `payment against ${cmd.invoiceNumber || 'the oldest unpaid invoices'}`
      : cmd.kind === 'applyAdvance' ? `apply advance to ${cmd.invoiceNumber}`
      : cmd.kind === 'markPaid' ? `mark ${(cmd.invoiceNumbers || []).join(', ')} paid`
      : 'advance deposit';
    setAnswer(`${destructiveBanner}Confirm: ${amount} ${kind} for ${cmd.clinicHint} via ${cmd.method.toUpperCase()}?`);
    speak(`${destructiveBanner}Confirm: ${amount} ${kind} for ${cmd.clinicHint}.`, {
      rate: userPreferences?.voice_tts_rate, voiceUri: userPreferences?.voice_tts_voice_uri,
      locale: userPreferences?.voice_locale || 'en-PK', allowClinicalDetail: false,
    });
  };

  const submit = async (raw?: string) => {
    const text = (raw ?? query).trim();
    if (!text || busy) return;

    /* Guided entry interview: “Add clinic” asks for the name, doctor, phone one
       at a time, mirrors the New Clinic form, then opens the form pre-filled. */
    if (slotMode) {
      const val = text.trim();
      const skip = /^(skip|none|no|-)$/i.test(val);
      if (slotMode.kind === 'createClinic') {
        if (slotMode.step === 'name') {
          if (skip || val.length < 2) { setAnswer('A clinic needs a name — say the clinic name.'); return; }
          setSlotMode({ ...slotMode, name: val, step: 'doctor' });
          setAnswer(`Got “${val}”. Doctor's name? Say “skip” to leave it blank.`);
          return;
        }
        if (slotMode.step === 'doctor') {
          setSlotMode({ ...slotMode, doctor: skip ? undefined : val, step: 'phone' });
          setAnswer(skip ? 'Okay. Phone? Say “skip” to leave it blank.' : `Got doctor ${val}. Phone? Say “skip” to leave it blank.`);
          return;
        }
        const phone = skip ? undefined : val;
        setCurrentView('labs');
        // LabListView mounts AFTER the view flips; if we fire the prefill
        // event synchronously it lands before the listener exists and is lost.
        const detail = { name: slotMode.name!, doctor: slotMode.doctor, phone };
        window.setTimeout(() => {
          try {
            window.dispatchEvent(new CustomEvent('voice:create-clinic', { detail }));
          } catch { /* prefill is best effort */ }
        }, 350);
        setSlotMode(null);
        setAnswer(`Opening Labs → New Clinic pre-filled with “${detail.name}”${detail.doctor ? `, doctor ${detail.doctor}` : ''}. Review the form and press “Add clinic” to finish.`);
        speak('Opening the new clinic form with your details — review and press add clinic.', {
          rate: userPreferences?.voice_tts_rate, voiceUri: userPreferences?.voice_tts_voice_uri,
          locale: userPreferences?.voice_locale || 'en-PK', allowClinicalDetail: false,
        });
        return;
      }

      /* Guided case creation — asks for the same fields the New Case form asks. */
      if (slotMode.step === 'patient') {
        if (skip || val.length < 2) { setAnswer('Patient name is required.'); return; }
        setSlotMode({ ...slotMode, patient: val, step: 'clinic' });
        setAnswer('Which clinic?');
        return;
      }
      if (slotMode.step === 'clinic') {
        const matches = (labs || []).filter((l) => l.name.toLowerCase().includes(val.toLowerCase()));
        if (matches.length === 1) {
          setSlotMode({ ...slotMode, clinic: matches[0].name, step: 'caseType' });
          setAnswer(`Got ${matches[0].name}. Which case type? For example: “Zirconia Crown”.`);
          return;
        }
        setAnswer(matches.length > 1 ? `Which clinic — ${matches.map((m) => m.name).slice(0, 5).join(', ')}?` : 'No matching clinic. Say the exact clinic name or add it first.');
        return;
      }
      if (slotMode.step === 'caseType') {
        const wanted = val.toLowerCase();
        const exact = (caseTypes || []).find((c) => c.name.toLowerCase() === wanted);
        const partial = (caseTypes || []).filter((c) => c.name.toLowerCase().includes(wanted));
        const chosen = exact || (partial.length === 1 ? partial[0] : partial[0]);
        if (!chosen) {
          const examples = (caseTypes || []).slice(0, 4).map((c) => c.name).join(', ');
          setAnswer(`No case type “${val}”. Known: ${examples}.`);
          return;
        }
        if (!exact && partial.length > 1) {
          setAnswer(`Which case type — ${partial.slice(0, 5).map((c) => c.name).join(', ')}?`);
          return;
        }
        const needsTeeth = chosen.needs_teeth !== false;
        setSlotMode({ ...slotMode, caseType: chosen.name, step: needsTeeth ? 'teeth' : 'price' });
        setAnswer(needsTeeth
          ? `Got ${chosen.name} — which teeth? Say FDI numbers (e.g. “26 27”). Say “skip” if this case has no teeth.`
          : `Got ${chosen.name}. Price, PKR?`);
        return;
      }
      if (slotMode.step === 'teeth') {
        if (skip) {
          setSlotMode({ ...slotMode, teeth: [], step: 'price' });
          setAnswer('No teeth — price PKR?');
          return;
        }
        const fdi = /\b(1[1-8]|2[1-8]|3[1-8]|4[1-8])\b/g;
        const found: number[] = Array.from(new Set((val.match(fdi) || []).map(Number)));
        if (!found.length) {
          setAnswer('Say FDI numbers (e.g. “26 27”), or “skip” for no teeth.');
          return;
        }
        const ct = (caseTypes || []).find((c) => c.name.toLowerCase() === (slotMode.caseType || '').toLowerCase());
        const unit = ct?.base_price ?? 0;
        const proposed = unit * found.length;
        setSlotMode({ ...slotMode, teeth: found, price: proposed, step: 'price' });
        setAnswer(`${found.length} tooth${found.length === 1 ? '' : ' teeth'} × PKR ${unit.toLocaleString()} = PKR ${proposed.toLocaleString()}. Say a number to override, or “skip” to accept.`);
        return;
      }
      if (slotMode.step === 'price') {
        const n = Number(val.replace(/[^\d.]/g, ''));
        const nValid = Number.isFinite(n) && n > 0;
        if (slotMode.price !== undefined) {
          setSlotMode({ ...slotMode, price: skip ? slotMode.price : (nValid ? n : slotMode.price), step: 'priority' });
          setAnswer('Priority? Say “low”, “normal”, “high” or “urgent” (default normal), or “skip”.');
          return;
        }
        if (!nValid) { setAnswer('Give a positive amount, e.g. “8500”.'); return; }
        setSlotMode({ ...slotMode, price: n, step: 'priority' });
        setAnswer('Priority? Say “low”, “normal”, “high” or “urgent” (default normal), or “skip”.');
        return;
      }
      if (slotMode.step === 'priority') {
        const map: Record<string, string> = { low: 'low', normal: 'normal', high: 'high', urgent: 'urgent', rush: 'urgent', critical: 'urgent' };
        const chosen = skip ? 'normal' : (map[val.toLowerCase()] || 'normal');
        setSlotMode({ ...slotMode, priority: chosen, step: 'shade' });
        setAnswer(`Priority ${chosen}. Shade? (e.g. “A2”) Say “skip”.`);
        return;
      }
      if (slotMode.step === 'shade') {
        setSlotMode({ ...slotMode, shade: skip ? undefined : val.toUpperCase(), step: 'delivery' });
        setAnswer('Delivery date? (YYYY-MM-DD, or “tomorrow”)');
        return;
      }
      if (slotMode.step === 'delivery') {
        const resolveDate = (raw: string): string | null => {
          const t = raw.toLowerCase().trim();
          if (t === 'today') return getTodayStr();
          if (t === 'tomorrow') { const d = new Date(); d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
          if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
          const d = new Date(raw);
          if (Number.isNaN(d.getTime())) return null;
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        };
        const d = resolveDate(val);
        if (!d) { setAnswer('Say a date like 2026-11-30, “today” or “tomorrow”.'); return; }
        setSlotMode({ ...slotMode, delivery: d, step: 'doctor' });
        setAnswer(`Delivery ${d}. Doctor? Say “skip” to leave blank.`);
        return;
      }
      // doctor step → finish
      const doctor = skip ? undefined : val;
      const ct = (caseTypes || []).find((c) => c.name.toLowerCase() === (slotMode.caseType || '').toLowerCase());
      setSlotMode(null);
      queueWrite(
        {
          kind: 'createCase', amount: slotMode.price!, clinicHint: slotMode.clinic!,
          caseTypeId: ct?.id, caseTypeName: slotMode.caseType, doctorName: doctor,
          patientName: slotMode.patient, deliveryDate: slotMode.delivery, method: 'bank',
          teeth: slotMode.teeth, priority: slotMode.priority, shade: slotMode.shade,
        },
        'voice:createCase',
        'write',
      );
      return;
    }
    if (/^(add|create|new|register|log)\s+(a\s+)?(case|job)\s*$/i.test(text)) {
      setSlotMode({ kind: 'createCase', step: 'patient' });
      setAnswer('Patient name?');
      setStatus('idle');
      return;
    }
    if (/^(add|create|new|make)\s+(a\s+)?(clinic|lab|dental clinic)\s*$/i.test(text)) {
      setSlotMode({ kind: 'createClinic', step: 'name' });
      setAnswer('What is the clinic’s name?');
      setStatus('idle');
      return;
    }

    // Spoken confirmation path: an action is pending — a spoken yes confirms.
    if (pending) {
      if (/^(confirm|yes|do it|go ahead|ok)$/i.test(text)) { confirmPending(); return; }
      if (/^(cancel|no|stop|abort)$/i.test(text)) { cancelPending(); return; }
      setAnswer(pendingRisk === 'destructive' ? 'Say “confirm” to proceed or “cancel” to abort. This action cannot be undone.' : 'Say “confirm” to post it or “cancel”.');
      return;
    }

    setBusy(true);
    setAnswer('');
    try {
      setStatus('thinking');
      const result = await askAssistant(text, {
        labs: labs || [], invoices: invoices || [], advancePayments: advancePayments || [], accountAdjustments: accountAdjustments || [], cases: cases || [],
        caseTypes: caseTypes || [], labContacts: labContacts || [], labAddresses: labAddresses || [], pricingOverrides: pricingOverrides || [], user,
        allowClinicalDetail: !!userPreferences?.voice_read_clinical_detail,
        api: {
          labs: labs || [],
          invoices: invoices || [],
          cases: cases || [],
          advancePayments: advancePayments || [],
          setCurrentView, addLab, updateLab, updateCase, addCaseNote, recordQcCase, archiveCase, recordTransactionV2, recordAdvanceDepositV2,
        },
      });
      if (result.navigateTo) {
        setCurrentView(result.navigateTo);
      }
      if (result.pendingWrite) {
        queueWrite(result.pendingWrite, text, result.risk === 'destructive' ? 'destructive' : 'write');
        setBusy(false);
        return;
      }
      setAnswer(result.text);
      setMemoryCount(listMemories().length);
      setStatus('done');
      speak(result.text, {
        rate: userPreferences?.voice_tts_rate, voiceUri: userPreferences?.voice_tts_voice_uri,
        locale: userPreferences?.voice_locale || 'en-PK',
        allowClinicalDetail: !!userPreferences?.voice_read_clinical_detail,
      });
    } catch {
      setStatus('error');
      setAnswer('Something went wrong. Try again.');
    } finally {
      setBusy(false);
      setQuery('');
    }
  };

  const resolveClinicForWrite = (hint: string) => {
    const ranked = rankCandidates(labs || [], hint);
    if (ranked.length === 1) return { clinic: ranked[0].lab };
    if (ranked.length > 1 && ranked[0].score > ranked[1].score) return { clinic: ranked[0].lab };
    const exact = (labs || []).find((l) => l.name.toLowerCase() === hint.toLowerCase());
    if (exact) return { clinic: exact };
    return { candidates: ranked.map((r) => r.lab.name).slice(0, 4) };
  };

  /** Voice-layer permission re-check before any confirm executes. */
  const deny = (action: string) => {
    if (!user) return 'Sign in required.';
    return can(user, action) ? null : `Requires the “${action}” permission.`;
  };

  const cancelPending = () => { setPending(null); setPendingNote(''); setStatus('idle'); setAnswer(''); cancelSpeech(); };

  const confirmPending = () => {
    if (!pending) return;
    if (pending.kind === 'createClinic') {
      try {
        const created = addLab({
          name: pending.clinicHint,
          contact_person: '',
          phone: '',
          email: '',
          address: '',
          doctor_name: '',
          code: '',
          notes: pendingNote || 'Created by voice assistant',
          opening_balance: 0,
          opening_balance_type: 'debit',
        });
        setAnswer(`Clinic “${created.name}” created. Open Settings or the directory to add doctor, phone and pricing.`);
        setStatus('done');
        setPending(null);
        setPendingNote('');
      } catch (err) {
        setStatus('error');
        setAnswer(err instanceof Error ? err.message : 'Could not create the clinic.');
      }
      return;
    }
    if (pending.kind === 'setCaseStatus' && pending.caseNumber && pending.targetStatus) {
      const blocked = deny('case:edit');
      if (blocked) { setStatus('error'); setAnswer(blocked); return; }
      const target = (cases || []).find((c) => c.case_number === pending.caseNumber);
      if (!target) {
        setStatus('error');
        setAnswer(`No case ${pending.caseNumber} found.`);
        return;
      }
      try {
        updateCase(target.id, { status: pending.targetStatus } as never, `Voice: moved to ${pending.targetStatus}`);
        setAnswer(`Case ${pending.caseNumber} moved to ${pending.targetStatus}.`);
        setStatus('done');
        setPending(null);
        setPendingNote('');
      } catch (err) {
        setStatus('error');
        setAnswer(err instanceof Error ? err.message : 'Could not move the case.');
      }
      return;
    }
    if (pending.kind === 'updateClinicDoctor' && pending.doctorName) {
      const blocked = deny('clinic:edit');
      if (blocked) { setStatus('error'); setAnswer(blocked); return; }
      const ranked = rankCandidates(labs || [], pending.clinicHint);
      const exact = (labs || []).find((l) => l.name.toLowerCase() === pending.clinicHint.toLowerCase());
      const chosen = exact || (ranked.length && ranked[0].score > (ranked[1]?.score ?? -1) ? ranked[0].lab : null);
      if (!chosen) {
        setStatus('error');
        setAnswer(ranked.length > 1 ? `Which clinic — ${ranked.map((r) => r.lab.name).slice(0, 4).join(', ')}?` : 'I could not match that clinic. Say the exact clinic name.');
        return;
      }
      try {
        updateLab(chosen.id, { contact_person: pending.doctorName, doctor_name: pending.doctorName });
        setAnswer(`Doctor for ${chosen.name} set to ${pending.doctorName}.`);
        setStatus('done');
        setPending(null);
        setPendingNote('');
      } catch (err) {
        setStatus('error');
        setAnswer(err instanceof Error ? err.message : 'Could not update the doctor.');
      }
      return;
    }
    if (pending.kind === 'addCaseNote' && pending.caseNumber && pending.noteText) {
      const blocked = deny('case:edit');
      if (blocked) { setStatus('error'); setAnswer(blocked); return; }
      const target = (cases || []).find((c) => c.case_number === pending.caseNumber);
      if (!target) { setStatus('error'); setAnswer(`No case ${pending.caseNumber} found.`); return; }
      try {
        addCaseNote(target.id, pending.noteText, user?.name || 'Voice');
        setAnswer(`Note added on ${pending.caseNumber}.`);
        setStatus('done');
        setPending(null); setPendingNote('');
      } catch (err) { setStatus('error'); setAnswer(err instanceof Error ? err.message : 'Could not add the note.'); }
      return;
    }
    if (pending.kind === 'recordQc' && pending.caseNumber && pending.qcResult) {
      const blocked = deny('case:edit');
      if (blocked) { setStatus('error'); setAnswer(blocked); return; }
      const target = (cases || []).find((c) => c.case_number === pending.caseNumber);
      if (!target) { setStatus('error'); setAnswer(`No case ${pending.caseNumber} found.`); return; }
      try {
        const receipt = recordQcCase({
          action: 'record',
          case_id: target.id,
          result: pending.qcResult,
          reason_code: pending.qcReason as never,
          inspector: user?.name || 'Voice',
        });
        const after = receipt?.status_after ? ` Case moved to ${receipt.status_after}.` : '';
        setAnswer(`QC ${pending.qcResult.toUpperCase()} recorded on ${pending.caseNumber}.${after}`);
        setStatus('done');
        setPending(null); setPendingNote('');
      } catch (err) { setStatus('error'); setAnswer(err instanceof Error ? err.message : 'Could not record the QC result.'); }
      return;
    }
    if (pending.kind === 'archiveCase' && pending.caseNumber) {
      const blocked = deny('case:edit');
      if (blocked) { setStatus('error'); setAnswer(blocked); return; }
      const target = (cases || []).find((c) => c.case_number === pending.caseNumber);
      if (!target) { setStatus('error'); setAnswer(`No case ${pending.caseNumber} found.`); return; }
      if (target.status !== 'delivered') { setStatus('error'); setAnswer(`Case ${pending.caseNumber} is "${target.status}" — archive works on delivered cases only.`); setPending(null); setPendingNote(''); return; }
      try {
        archiveCase(target.id);
        setAnswer(`Case ${pending.caseNumber} archived.`);
        setStatus('done');
        setPending(null); setPendingNote('');
      } catch (err) { setStatus('error'); setAnswer(err instanceof Error ? err.message : 'Could not archive the case.'); }
      return;
    }
    if (pending.kind === 'updateClinicField' && pending.field && pending.value) {
      const blocked = deny('clinic:edit');
      if (blocked) { setStatus('error'); setAnswer(blocked); return; }
      const ranked = rankCandidates(labs || [], pending.clinicHint);
      const norm = (s: string) => (s || '').toLowerCase();
      const exact = (labs || []).find((l) => norm(l.name) === norm(pending.clinicHint!));
      const chosen = exact || (ranked.length && ranked[0].score > (ranked[1]?.score ?? -1) ? ranked[0].lab : null);
      if (!chosen) {
        setStatus('error');
        setAnswer(ranked.length > 1 ? `Which clinic — ${ranked.map((r) => r.lab.name).slice(0, 4).join(', ')}?` : 'I could not match that clinic. Say the exact clinic name.');
        return;
      }
      try {
        const updates: Record<string, string> = pending.field === 'doctor'
          ? { contact_person: pending.value, doctor_name: pending.value }
          : { [pending.field]: pending.value };
        updateLab(chosen.id, updates);
        setAnswer(`${pending.field} for ${chosen.name} updated.`);
        setStatus('done');
        setPending(null); setPendingNote('');
      } catch (err) { setStatus('error'); setAnswer(err instanceof Error ? err.message : 'Could not update the clinic.'); }
      return;
    }
    if (pending.kind === 'createCase' && pending.patientName && pending.clinicHint && pending.caseTypeName) {
      const blocked = deny('case:create');
      if (blocked) { setStatus('error'); setAnswer(blocked); return; }
      const exact = (labs || []).find((l) => l.name.toLowerCase() === pending.clinicHint!.toLowerCase());
      const ranked = rankCandidates(labs || [], pending.clinicHint!);
      const clinic = exact || (ranked.length && ranked[0].score > (ranked[1]?.score ?? -1) ? ranked[0].lab : null);
      const ct = (caseTypes || []).find((c) => c.name.toLowerCase() === pending.caseTypeName!.toLowerCase());
      if (!clinic || !ct) { setStatus('error'); setAnswer('Could not resolve the clinic or case type.'); return; }
      try {
        const created = addCase({
          lab_id: clinic.id, lab_name: clinic.name,
          case_type_id: ct.id, case_type_name: ct.name,
          doctor_name: pending.doctorName || 'Voice',
          selected_teeth: pending.teeth ?? [], shade: pending.shade,
          delivery_date: pending.deliveryDate!,
          priority: (pending.priority as never) ?? 'normal', price: pending.amount, discount: 0, final_price: pending.amount,
          status: 'received', patient_name: pending.patientName,
        } as never);
        setAnswer(`Case created for ${pending.patientName} at ${clinic.name} — ${ct.name}, PKR ${pending.amount.toLocaleString()}. Case number: ${created.case_number}.`);
        setStatus('done'); setPending(null); setPendingNote('');
      } catch (err) { setStatus('error'); setAnswer(err instanceof Error ? err.message : 'Could not create the case.'); }
      return;
    }
    if (pending.kind === 'addClinicContact' || pending.kind === 'addClinicAddress' || pending.kind === 'addPricingOverride') {
      const action = pending.kind === 'addPricingOverride' ? 'pricing:edit' : 'contacts:edit';
      const blocked = deny(action);
      if (blocked) { setStatus('error'); setAnswer(blocked); return; }
      const exact = (labs || []).find((l) => (l.name || '').toLowerCase() === (pending.clinicHint || '').toLowerCase());
      const ranked = rankCandidates(labs || [], pending.clinicHint || '');
      const chosen = exact || (ranked.length && ranked[0].score > (ranked[1]?.score ?? -1) ? ranked[0].lab : null);
      if (!chosen) { setStatus('error'); setAnswer(ranked.length > 1 ? `Which clinic — ${ranked.map((r) => r.lab.name).slice(0, 4).join(', ')}?` : 'I could not match that clinic. Say the exact clinic name.'); return; }
      try {
        if (pending.kind === 'addClinicContact') {
          addLabContact({ lab_id: chosen.id, name: pending.contactName!, phone: pending.contactPhone!, email: pending.contactEmail ?? '', role: pending.contactRole || undefined, notes: 'Added by voice assistant', is_primary: !!pending.isPrimary });
          setAnswer(`Contact “${pending.contactName}” added to ${chosen.name}${pending.isPrimary ? ' as primary' : ''}.`);
        } else if (pending.kind === 'addClinicAddress') {
          addLabAddress({ lab_id: chosen.id, type: pending.addressType!, street: pending.street!, city: pending.city!, state: pending.state!, postal_code: pending.postalCode!, country: pending.country!, is_default: !!pending.isDefault });
          setAnswer(`${pending.addressType} address added for ${chosen.name}${pending.isDefault ? ' as default' : ''}.`);
        } else {
          addPricingOverride({ lab_id: chosen.id, case_type_id: pending.caseTypeId!, case_type_name: pending.caseTypeName!, standard_price: pending.standardPrice!, custom_price: pending.customPrice!, discount_percentage: pending.discountPercentage, effective_date: pending.effectiveDate });
          setAnswer(`Pricing override set for ${pending.caseTypeName} at ${chosen.name}: PKR ${pending.customPrice?.toLocaleString()}.`);
        }
        setStatus('done'); setPending(null); setPendingNote('');
      } catch (err) { setStatus('error'); setAnswer(err instanceof Error ? err.message : 'Could not save.'); }
      return;
    }
    if (pending.kind === 'applyAdvance' && pending.invoiceNumber) {
      const blocked = deny('payment:record');
      if (blocked) { setStatus('error'); setAnswer(blocked); return; }
      const inv = (invoices || []).find((i) => i.invoice_number.toUpperCase() === pending.invoiceNumber!.toUpperCase());
      if (!inv) { setStatus('error'); setAnswer(`No invoice ${pending.invoiceNumber} found.`); return; }
      try {
        const ok = applyAdvanceCreditV2({ clinicId: inv.lab_id, invoiceId: inv.id, amount: pending.amount, notes: 'Voice-applied advance' });
        setAnswer(ok
          ? `Advance of PKR ${pending.amount.toLocaleString()} applied to ${inv.invoice_number} — receipt issued.`
          : `Could not apply — the wallet balance or the invoice balance may have changed.`);
        setStatus('done'); setPending(null); setPendingNote('');
      } catch (err) { setStatus('error'); setAnswer(err instanceof Error ? err.message : 'Could not apply the advance.'); }
      return;
    }
    if (pending.kind === 'markPaid' && pending.invoiceNumbers?.length) {
      if (user && !canPost(user, 'payment:bulk')) { setStatus('error'); setAnswer('Requires the “bulk settle” permission.'); return; }
      const nums = new Set(pending.invoiceNumbers.map((n) => n.toUpperCase()));
      const ids = (invoices || []).filter((i) => nums.has(i.invoice_number.toUpperCase())).map((i) => i.id);
      if (!ids.length) { setStatus('error'); setAnswer('No matching invoices remained.'); return; }
      try {
        bulkMarkPaid(ids);
        setAnswer(`${ids.length} invoice${ids.length > 1 ? 's' : ''} marked paid — payments journalled for PKR ${pending.amount.toLocaleString()}.`);
        setStatus('done'); setPending(null); setPendingNote('');
      } catch (err) { setStatus('error'); setAnswer(err instanceof Error ? err.message : 'Could not mark paid.'); }
      return;
    }
    if (pending.kind === 'printSettingsSave') {
      const blocked = deny('print:edit');
      if (blocked) { setStatus('error'); setAnswer(blocked); return; }
      try {
        savePrintSettings(pending.printSettings as never);
        setAnswer('Print settings saved.');
        setStatus('done');
        setPending(null); setPendingNote('');
      } catch (err) { setStatus('error'); setAnswer(err instanceof Error ? err.message : 'Could not save print settings.'); }
      return;
    }
    if (pending.kind === 'printSectionsSave' && pending.docKind && pending.sections) {
      const blocked = deny('print:edit');
      if (blocked) { setStatus('error'); setAnswer(blocked); return; }
      try {
        saveDocumentSections(pending.docKind, pending.sections);
        if (pending.docKind === 'statement') setStatementBankExcluded(!pending.sections.includes('bank'));
        if (pending.docKind === 'invoice') setInvoiceSummaryExcluded(false);
        setAnswer(`${pending.docKind} sections saved: ${pending.sections.join(', ')}.`);
        setStatus('done');
        setPending(null); setPendingNote('');
      } catch (err) { setStatus('error'); setAnswer(err instanceof Error ? err.message : 'Could not save print sections.'); }
      return;
    }
    if (pending.kind === 'notificationConfigSave') {
      const blocked = deny('notifications:edit');
      if (blocked) { setStatus('error'); setAnswer(blocked); return; }
      try {
        saveNotificationConfig(pending.notification as never);
        announceNotificationConfigChanged();
        setAnswer('Notification configuration saved — sweeps will use the new cadence.');
        setStatus('done');
        setPending(null); setPendingNote('');
      } catch (err) { setStatus('error'); setAnswer(err instanceof Error ? err.message : 'Could not save notification config.'); }
      return;
    }
    if (pending.kind === 'closeMonth' && pending.month && pending.labId) {
      if (user && !canPost(user, 'payment:record')) { setStatus('error'); setAnswer('Requires the “Record payment” permission to close a month.'); return; }
      try {
        closeMonth({ invoices: invoices || [], advancePayments: advancePayments || [], accountAdjustments: accountAdjustments || [], labs: labs || [], month: pending.month, labId: pending.labId, labName: pending.labName, actor: user?.name || 'System' });
        setAnswer(`${pending.month} closed for ${pending.labName}. Nothing locks — corrections can re-close.`);
        setStatus('done');
        setPending(null); setPendingNote('');
      } catch (err) { setStatus('error'); setAnswer(err instanceof Error ? err.message : 'Could not close the month.'); }
      return;
    }
    const { clinic, candidates } = resolveClinicForWrite(pending.clinicHint) as { clinic?: { id: string; name: string }; candidates?: string[] };
    if (!clinic) {
      setStatus('error');
      setAnswer(candidates?.length ? `Which clinic — ${candidates.join(', ')}?` : 'I could not match that clinic. Say the clinic name again.');
      return;
    }
    try {
      const date = getTodayStr();
      if (pending.kind === 'payment') {
        const clinicInvoices = (invoices || []).filter((i) => i.lab_id === clinic.id)
          .map((i) => ({ inv: i, balance: invoiceBalanceDue(i) }))
          .filter((x) => x.balance > 0)
          .sort((a, b) => String(a.inv.created_at).localeCompare(String(b.inv.created_at)));
        let remaining = pending.amount;
        const allocations: { invoiceId: string; amount: number }[] = [];
        if (pending.invoiceNumber) {
          const inv = clinicInvoices.find((x) => x.inv.invoice_number === pending.invoiceNumber);
          if (!inv) { setStatus('error'); setAnswer(`No outstanding invoice ${pending.invoiceNumber} for ${clinic.name}.`); return; }
          const alloc = Math.min(inv.balance, pending.amount);
          allocations.push({ invoiceId: inv.inv.id, amount: alloc });
          remaining -= alloc;
        } else {
          for (const { inv, balance } of clinicInvoices) {
            if (remaining <= 0) break;
            const alloc = Math.min(balance, remaining);
            if (alloc > 0) allocations.push({ invoiceId: inv.id, amount: alloc });
            remaining -= alloc;
          }
        }
        const result = recordTransactionV2({
          clinicId: clinic.id, amount: pending.amount, method: pending.method, date,
          notes: pendingNote || 'Voice-confirmed payment', allocations, saveRemainingAsAdvance: false, isVerified: false,
        });
        const unapplied = Math.max(0, pending.amount - allocations.reduce((s, a) => s + a.amount, 0));
        setAnswer(`Payment posted for ${clinic.name}: receipt ${result.receiptNumber}.${unapplied > 0 ? ` Unapplied PKR ${unapplied.toLocaleString()} held on the receipt.` : ''}`);
      } else {
        const result = recordAdvanceDepositV2({
          clinicId: clinic.id, amount: pending.amount, method: pending.method, date,
          notes: pendingNote || 'Voice-confirmed advance deposit', isVerified: false,
        });
        setAnswer(`Advance deposit recorded for ${clinic.name}: receipt ${result.receiptNumber}.`);
      }
      setStatus('done');
      setPending(null);
      setPendingNote('');
    } catch (err) {
      setStatus('error');
      setAnswer(err instanceof Error ? err.message : 'Could not post the transaction.');
    }
  };

  const listen = () => {
    if (locked || busy) return;
    // Opt-in Groq Whisper path — used when browser speech is unavailable or fails.
    if (cloudMic && typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia)) {
      void (async () => {
        setStatus('listening');
        setAnswer('Listening — speak now…');
        try {
          const handle = await recordClip();
          const timeout = window.setTimeout(async () => {
            try {
              const blob = await handle.stop();
              setStatus('thinking');
              setAnswer('Transcribing…');
              const text = await transcribeWithGroq(blob);
              if (text) { setQuery(text); void submit(text); }
              else { setStatus('error'); setAnswer('Groq transcription did not return text. Check the Groq key in Settings, or type the question.'); }
            } finally { cloudStop.current = null; }
          }, 6000);
          cloudStop.current = () => { window.clearTimeout(timeout); handle.cancel(); };
        } catch (err) {
          const msg = err instanceof Error && err.name === 'NotAllowedError'
            ? 'Microphone is blocked. Click the padlock next to the address bar → Allow for microphone, then try again.'
            : 'Microphone is unavailable. Type your question — the assistant answers it the same way.';
          setStatus('error');
          setAnswer(msg);
        }
      })();
      return;
    }

    const rec = getRecognition();
    if (!rec) { setStatus('error'); setAnswer('Built-in speech recognition is not available here. Enable “Cloud microphone (Groq)” in Settings → Voice Assistant, or type the question.'); return; }
    recRef.current?.stop();
    recRef.current = rec;
    setStatus('listening');
    setAnswer('Listening — speak now…');
    rec.onresult = (e) => {
      const transcript = Array.from(e.results).map((r) => r[0]?.transcript || '').join(' ').trim();
      if (transcript) { setQuery(transcript); void submit(transcript); }
    };
    rec.onerror = (e) => {
      const code = e?.error || 'unknown';
      const message =
        code === 'not-allowed' || code === 'service-not-allowed'
          ? 'Microphone is blocked. Click the padlock in the address bar → Allow for microphone, then try again.'
          : code === 'no-speech'
          ? 'No speech detected. Speak right after the listening icon appears.'
          : code === 'network'
          ? 'The built-in recognizer failed (Chrome/Edge need internet). Enable “Cloud microphone (Groq)” in Settings, or type the question.'
          : `Speech recognition failed (${code}). Try “Cloud microphone (Groq)” in Settings, or type the question.`;
      setStatus('error');
      setAnswer(message);
    };
    rec.onend = () => { if (status === 'listening') setStatus('idle'); };
    try { rec.start(); window.setTimeout(() => rec.stop(), 8000); } catch { setStatus('error'); }
  };

  useEffect(() => {
    if (!voiceEnabled || !user) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyV') { e.preventDefault(); toggle(); }
      if (e.key === 'Escape' && open) close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [voiceEnabled, user, open, locked]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (!voiceEnabled) cancelSpeech(); }, [voiceEnabled]);
  useEffect(() => {
    if (!voiceEnabled) { setOnline(true); return; }
    let alive = true;
    // Probe once on mount; if offline, retry every 5s until we come back.
    let isOnline = true;
    const check = async () => {
      const ok = await probeGroq();
      isOnline = ok;
      if (alive) setOnline(ok);
    };
    void check();
    const timer = window.setInterval(() => { if (!isOnline) void check(); }, 5000);
    const onOnline = () => { isOnline = true; void check(); };
    const onOffline = () => { isOnline = false; setOnline(false); cancelSpeech(); setOpen(false); };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [voiceEnabled]);
  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  if (!voiceEnabled || !user || !online) return null;

  return (
    <aside aria-label="Voice assistant" className="no-print pointer-events-none fixed bottom-24 right-4 sm:right-6 z-[90] flex flex-col items-end gap-2">
      {/* The orb is the single entry point; breathing idle → ring pulse while listening/thinking. */}
      <VoiceOrb
        state={locked ? 'locked' : status === 'listening' ? 'listening' : status === 'thinking' ? 'thinking' : 'idle'}
        locked={locked}
        onClick={toggle}
      />


      {open && (
        <div className={`pointer-events-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl ${expanded ? 'fixed inset-4 sm:inset-10 z-[95] flex flex-col overflow-hidden' : 'w-80'}`}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Voice Assistant {expanded ? '— dedicated panel' : ''}</span>
            <div className="flex items-center gap-1.5">
              <button type="button" onClick={() => setExpanded((v) => !v)} aria-label={expanded ? 'Collapse panel' : 'Open dedicated panel'} title={expanded ? 'Collapse' : 'Dedicated panel'} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              </button>
              <button type="button" onClick={close} aria-label="Close voice assistant" className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="h-4 w-4" /></button>
            </div>
          </div>
          {expanded && (
            <div className="mt-3 grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-3">
              <div className="rounded-xl border border-slate-100 bg-slate-50 p-2.5 overflow-y-auto max-h-[30vh] lg:max-h-full">
                <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500"><Sparkles className="h-3.5 w-3.5" /> Quick commands</div>
                <div className="mt-2 flex flex-col gap-1.5">
                  {['Cash collected today', 'Overdue cases', 'Standings', 'Mir Dental balance', 'Outstanding invoices for Mir Dental', 'Month close status for October 2026', 'Open general ledger', 'Open settings'].map((cmd) => (
                    <button key={cmd} type="button" onClick={() => void submit(cmd)} className="text-left rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-semibold text-slate-700 hover:border-indigo-300 hover:text-indigo-700">{cmd}</button>
                  ))}
                </div>
                <div className="mt-3 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500"><History className="h-3.5 w-3.5" /> Memory ({listMemories().length})<button type="button" onClick={() => { clearMemories(); setMemoryCount(0); }} className="ml-auto text-[10px] font-bold text-slate-400 hover:text-rose-600">Clear</button></div>
                <div className="mt-1.5 max-h-48 overflow-y-auto lg:max-h-none divide-y divide-slate-200">
                  {listMemories().slice(0, 12).map((m) => (
                    <div key={m.id} className="py-1.5">
                      <p className="text-[10px] font-semibold text-slate-600">{m.question}</p>
                      <p className="text-[10px] text-slate-400 leading-snug line-clamp-2">{m.answer}</p>
                    </div>
                  ))}
                  {memoryCount === 0 && <p className="text-[11px] text-slate-400 py-2">Answers get stored here (redacted) as the assistant learns.</p>}
                </div>
              </div>
            </div>
          )}
          <div className="mt-3 min-h-[64px] whitespace-pre-wrap rounded-xl border border-slate-100 bg-slate-50 p-2.5 text-xs text-slate-700" role="status" aria-live="polite">
            {busy ? 'Thinking…' : answer || 'Ask a clinic balance, statement, ledger, outstanding or advance wallet — or say “Record payment of PKR 5,000 for Mir Dental”.'}
          </div>

          {pending && (
            <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
              <div className="flex items-center gap-1.5 font-bold"><CheckCircle2 className="h-4 w-4" />{pendingRisk === 'destructive' ? 'Destructive action — cannot be undone' : 'Confirm the action below'}</div>
              <p className="mt-1.5">{answer}</p>
              <p className="mt-1 text-[10px] font-semibold text-slate-500">Or say “confirm” / “cancel”.</p>
              <div className="mt-2 flex gap-2">
                <button type="button" onClick={confirmPending} className={`flex-1 rounded-lg px-3 py-2 text-xs font-bold text-white ${pendingRisk === 'destructive' ? 'bg-rose-600 hover:bg-rose-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}>{pendingRisk === 'destructive' ? 'Confirm destructive' : 'Confirm & post'}</button>
                <button type="button" onClick={cancelPending} className="flex-1 rounded-lg border border-amber-300 px-3 py-2 text-xs font-bold text-amber-800 hover:bg-amber-100">Cancel</button>
              </div>
            </div>
          )}

          <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type or speak…"
              className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2.5 py-2 text-xs"
              aria-label="Ask the assistant"
            />
            <button type="button" onClick={listen} aria-label="Listen" title="Listen" className="ds-tap rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-100"><AudioLines className="h-4 w-4" /></button>
            <button type="submit" disabled={busy} aria-label="Ask" className="ds-tap rounded-lg bg-indigo-600 p-2 text-white hover:bg-indigo-700 disabled:opacity-50"><SendHorizonal className="h-4 w-4" /></button>
          </form>
          <p className="mt-2 text-[10px] text-slate-400">Mic: {cloudMic ? 'Groq Whisper (audio goes to Groq).' : 'Built-in Chrome/Edge online recognizer.'} If neither works, type the question. {groqEnabled() ? 'Groq routing ON.' : 'Groq routing off — offline answers.'}</p>
        </div>
      )}
    </aside>
  );
};
