import React, { useEffect, useMemo, useRef, useState } from 'react';
import { VoiceOrb, type VoiceOrbState } from './VoiceOrb';
import { listMemories, clearMemories } from '../../services/voiceMemory';
import { X, SendHorizonal, AudioLines, CheckCircle2, History, Sparkles, Maximize2, Minimize2, Mic } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { moduleForView, isViewProtected, isModuleUnlocked } from '../../services/moduleSecurity';
import { speak, cancelSpeech } from '../../services/voiceUtterance';
import { askAssistant } from '../../services/voiceAssistant';
import { probeGroq } from '../../services/voiceGate';
import { can, canPost } from '../../services/permissions';
import { savePrintSettings, saveDocumentSections, setStatementBankExcluded, setInvoiceSummaryExcluded } from '../../services/printSettings';
import { type DentalCase } from '../../types';
import { saveNotificationConfig, announceNotificationConfigChanged } from '../../services/notificationSettings';
import { closeMonth } from '../../services/monthClose';
import { loadSlaSettings, saveSlaSettings, computeSlaDueDate } from '../../services/prioritySla';
import { groqEnabled } from '../../services/voiceGroq';
import { recordClip, transcribeWithGroq, type RecordingHandle } from '../../services/voiceGroqStt';
import type { WriteCommand } from '../../services/voiceWrite';
import { selectCasesToAutoArchive } from '../../context/hooks/autoArchive';
import { getTodayStr } from '../../utils/dateUtils';
import { invoiceBalanceDue } from '../../services/financeDomain';

type ShellStatus = 'idle' | 'listening' | 'thinking' | 'typing' | 'locked' | 'error' | 'done';

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

/** AI-executed write commands come from the agentic loop — the shell runs
    them immediately through executeWrite. Only destructive actions keep a
    typed-token gate (the red flow in queueWrite). */
const findLabByHint = (labs: { id: string; name: string }[], hint?: string): { id: string; name: string } | null => {
  const h = (hint || '').trim().toLowerCase();
  if (!h) return null;
  const exact = labs.find((l) => l.name.toLowerCase() === h);
  if (exact) return exact;
  const contains = labs.filter((l) => l.name.toLowerCase().includes(h));
  return contains.length === 1 ? contains[0] : (contains[0] && contains.length > 1 ? contains[0] : null);
};

/** Push-to-talk + offline answers. Writes execute immediately through the AI. */
export const VoiceShell: React.FC = () => {
  const {
    user, currentView, userPreferences, labs, invoices, advancePayments, accountAdjustments, cases,
    caseTypes, labContacts, labAddresses, pricingOverrides, qcInspections, caseNotes, caseAttachments,
    templates, doctorPreferences, allPayments, reconciliationItems, auditEvents, savedVouchers,
    addLabContact, addLabAddress, addPricingOverride, addCase, applyAdvanceCreditV2, bulkMarkPaid,
    recordTransactionV2, recordAdvanceDepositV2, setCurrentView, addLab, updateLab, updateCase, addCaseNote, recordQcCase, archiveCase,
    restoreCase, deleteCasePermanently, saveAsTemplate,
    deleteCaseNote, deleteCaseAttachment, deleteLab, deleteLabContact, deleteLabAddress,
    deletePricingOverride, setDoctorPreferredLab, addCaseType, updateCaseType, deleteCaseType,
    recordAccountAdjustment, deleteAccountAdjustment, deletePaymentV2, updatePaymentAmountV2,
    deleteInvoice, issueCreditNoteV2, reconcileItemV2, flagReconciliationExceptionV2,
    saveVoucherToSystem, deleteSavedVoucher,
  } = useApp();
  const [open, setOpen] = useState(false);
  const [online, setOnline] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [memoryCount, setMemoryCount] = useState(() => listMemories().length);
  const [status, setStatus] = useState<ShellStatus>('idle');
  const [query, setQuery] = useState('');
  const [answer, setAnswer] = useState('');
  const [typedConfirm, setTypedConfirm] = useState('');
  const [expectTyped, setExpectTyped] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /* Destructive actions only: the typed-token red gate (audit F2 destructive). */
  const [pending, setPending] = useState<WriteCommand | null>(null);
  const [pendingRisk, setPendingRisk] = useState<'write' | 'destructive'>('write');
  const [pendingNote, setPendingNote] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const cloudStop = useRef<null | (() => void)>(null);

  const voiceEnabled = !!userPreferences?.voice_enabled;
  /* Cloud mic (Groq Whisper) works in Tauri/WebView2 whenever a Groq key is
     configured — it uses fetch + getUserMedia + MediaRecorder, no
     SpeechRecognition API needed. The built-in Chrome/Edge recognizer does not
     exist in WebView2, so cloud mic is the only reliable speech-input path on
     desktop. */
  const cloudMic = groqEnabled() && typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);

  /* ── Always-On Mic (VAD + Groq Whisper) ───────────────────────────────
      While the orb is open and Always Listen is enabled, a poller watches
      the microphone RMS. When speech starts it begins a Groq Whisper capture;
      when speech ends it transcribes and submits. Submission goes through
      `submit()` so every gate (amber writes, typed-token destructive) still
      applies exactly as in push-to-talk. */
  const vadRef = useRef<{ stream: MediaStream; ctx: AudioContext; timer: number } | null>(null);
  const busyRef = useRef(busy); busyRef.current = busy;
  /* Assigned lazily in startAlwaysOn: it runs from the effect, by which time
     `submit` below is initialized. */
  const submitRef = useRef<((raw?: string) => Promise<void>) | null>(null);
  const SPEECH_START_RMS = 0.045;
  const SPEECH_END_RMS = 0.012;

  const stopAlwaysOn = () => {
    const v = vadRef.current;
    vadRef.current = null;
    if (v) {
      window.clearTimeout(v.timer);
      v.stream.getTracks().forEach((t) => t.stop());
      void v.ctx.close();
    }
  };

  const startAlwaysOn = () => {
    if (!cloudMic || busyRef.current) return;
    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        submitRef.current = submit;
        const ctx = new AudioContext();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        source.connect(analyser);
        analyser.fftSize = 256;
        const samples = new Float32Array(analyser.frequencyBinCount);
        let recording = false;
        let handle: RecordingHandle | null = null;

        const poll = async () => {
          if (!analyser) return;
          if (!busyRef.current) {
            analyser.getFloatTimeDomainData(samples);
            let sumSq = 0;
            for (let i = 0; i < samples.length; i++) { sumSq += samples[i] * samples[i]; }
            const rms = Math.sqrt(sumSq / samples.length);
            if (rms > SPEECH_START_RMS && !recording) {
              recording = true;
              setStatus('listening');
              setAnswer('Speak now — transcribing…');
              handle = await recordClip();
            } else if (rms < SPEECH_END_RMS && recording) {
              recording = false;
              const done = handle;
              handle = null;
              setStatus('idle');
              setAnswer('Listening (always-on)');
              void done?.stop()
                .then((blob: Blob) => transcribeWithGroq(blob))
                .then((text: string | null) => { if (text) { setQuery(text); void submitRef.current?.(text); } })
                .catch(() => { /* ignore */ });
            }
          }
          if (vadRef.current) {
            vadRef.current.timer = window.setTimeout(poll, 300);
          }
        };

        const timer = window.setTimeout(poll, 300);
        vadRef.current = { stream, ctx, timer };
        void ctx.resume();
      } catch (err) {
        stopAlwaysOn();
        setStatus('error');
        setAnswer(err instanceof Error && err.name === 'NotAllowedError'
          ? 'Microphone access is blocked. Allow microphone for this app in your system settings, then try again.'
          : 'Always-on mic unavailable — type your questions instead.');
      }
    })();
  };
  const locked = useMemo(() => {
    const id = moduleForView(currentView);
    if (!id) return false;
    return isViewProtected(id, currentView) && !isModuleUnlocked(id);
  }, [currentView]);

  const close = () => { stopAlwaysOn(); setOpen(false); setStatus('idle'); cancelSpeech(); recRef.current?.stop(); cloudStop.current?.(); cloudStop.current = null; };
  const toggle = () => {
    if (locked) { setStatus('locked'); setAnswer('This module is locked.'); return; }
    setOpen((v) => { const next = !v; if (next) setStatus('idle'); return next; });
  };

  /* Writes auto-execute (the AI agentic loop resolved the intent). Only
     destructive actions park in the red-gate queue: the operator must type the
     shown token; spoken confirmation is intentionally not accepted. */
  const queueWrite = (cmd: WriteCommand, note: string, risk: 'destructive' = 'destructive') => {
    setPending(cmd);
    setPendingRisk(risk);
    setPendingNote(note);
    setStatus('done');
    const want = cmd.kind === 'purgeCase' ? `PURGE ${cmd.caseNumber}` : `DELETE ${cmd.caseNumber}`;
    setExpectTyped(want);
    setAnswer(`DESTRUCTIVE — type “${want}” to confirm. This cannot be undone.`);
  };

  const submit = async (raw?: string) => {
    const text = (raw ?? query).trim();
    if (!text || busy) return;
    /* Destructive confirmation — accept typed token OR spoken token match. */
    if (pending && pendingRisk === 'destructive') {
      const norm = (s: string) => s.replace(/\s+/g, '').toUpperCase();
      const want = norm(expectTyped || '');
      const typedOk = typedMatch();
      const spokenOk = !!want && norm(text) === want;
      if (typedOk || spokenOk) {
        executeWrite(pending);
        setPending(null);
        setPendingNote('');
        setExpectTyped(null);
        setTypedConfirm('');
        setStatus('done');
        return;
      }
      setStatus('typing');
      setAnswer(`Say “${expectTyped}” or type it to confirm — this cannot be undone.`);
      return;
    }
    /* Everything — reads, writes, navigation — goes through the agentic loop
       (Groq tool calling) below. No fixed-phrase routing, no slot interviews. */
    setBusy(true);
    setAnswer('');
    try {
      setStatus('thinking');
      const result = await askAssistant(text, {
        labs: labs || [], invoices: invoices || [], advancePayments: advancePayments || [], accountAdjustments: accountAdjustments || [], cases: cases || [],
        caseTypes: caseTypes || [], labContacts: labContacts || [], labAddresses: labAddresses || [], pricingOverrides: pricingOverrides || [],
        qcInspections: qcInspections || [], caseNotes: caseNotes || {}, caseAttachments: caseAttachments || {},
        templates: templates || [], doctorPreferences: doctorPreferences || [], allPayments: allPayments || [],
        reconciliationItems: reconciliationItems || [], auditEvents: auditEvents || [], user,
        allowClinicalDetail: !!userPreferences?.voice_read_clinical_detail,
        api: {
          labs: labs || [], invoices: invoices || [], cases: cases || [],
          advancePayments: advancePayments || [],
          setCurrentView, addLab, updateLab, updateCase, addCaseNote, recordQcCase, archiveCase, recordTransactionV2, recordAdvanceDepositV2,
        },
      });
      if (result.navigateTo) setCurrentView(result.navigateTo);
      if (result.pendingWrite) {
        if (result.risk === 'destructive') {
          // Destructive: the typed-token red gate — auto-execute for the rest.
          queueWrite(result.pendingWrite, text, 'destructive');
          setBusy(false);
          return;
        }
        const tts = {
          rate: userPreferences?.voice_tts_rate, voiceUri: userPreferences?.voice_tts_voice_uri,
          locale: userPreferences?.voice_locale || 'en-PK',
          allowClinicalDetail: !!userPreferences?.voice_read_clinical_detail,
        };
        await executeWrite(result.pendingWrite);
        setMemoryCount(listMemories().length);
        setStatus('done');
        setAnswer(result.text);
        speak(result.text, tts);
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
    const clinic = findLabByHint(labs || [], hint);
    if (!clinic) return { candidates: (labs || []).filter((l) => l.name.toLowerCase().includes(hint.toLowerCase())).map((l) => l.name).slice(0, 4) };
    return { clinic: { id: clinic.id, name: clinic.name } };
  };

  const deny = (action: string) => {
    if (!user) return 'Sign in required.';
    return can(user, action) ? null : `Requires the “${action}” permission.`;
  };

  const cancelPending = () => { setPending(null); setPendingNote(''); setExpectTyped(null); setStatus('idle'); setAnswer(''); cancelSpeech(); };
  const findCaseByNumber = (num: string): DentalCase | null => (cases || []).find((c) => c.case_number === num) || null;

  /* Destructive confirm: require typing the token shown in the red banner
     (accepted from the typed-confirm input or the main input). Spoken
     "confirm" is intentionally rejected for destructive actions. */
  const typedMatch = (): boolean => {
    if (!pending) return false;
    const want = (expectTyped || '').replace(/\s+/g, '').toUpperCase();
    const typed = ((typedConfirm || query) || '').replace(/\s+/g, '').toUpperCase();
    return !!want && typed === want;
  };

  const executeWrite = (cmd: WriteCommand) => {
    if (!cmd) return;
    if (cmd.kind === 'createClinic') {
      try {
        const created = addLab({
          name: cmd.clinicHint,
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
      } catch (err) {
        setStatus('error');
        setAnswer(err instanceof Error ? err.message : 'Could not create the clinic.');
      }
      return;
    }
    if (cmd.kind === 'setCaseStatus' && cmd.caseNumber && cmd.targetStatus) {
      const blocked = deny('case:edit');
      if (blocked) { setStatus('error'); setAnswer(blocked); return; }
      const target = (cases || []).find((c) => c.case_number === cmd.caseNumber);
      if (!target) {
        setStatus('error');
        setAnswer(`No case ${cmd.caseNumber} found.`);
        return;
      }
      try {
        updateCase(target.id, { status: cmd.targetStatus } as never, `Voice: moved to ${cmd.targetStatus}`);
        setAnswer(`Case ${cmd.caseNumber} moved to ${cmd.targetStatus}.`);
        setStatus('done');
      } catch (err) {
        setStatus('error');
        setAnswer(err instanceof Error ? err.message : 'Could not move the case.');
      }
      return;
    }
    if (cmd.kind === 'caseUpdateFields' && cmd.caseNumber) {
      const blocked = deny('case:edit');
      if (blocked) { setStatus('error'); setAnswer(blocked); return; }
      const target = findCaseByNumber(cmd.caseNumber);
      if (!target) { setStatus('error'); setAnswer(`No case ${cmd.caseNumber} found.`); return; }
      try {
        const fields = (cmd.updateFields || {}) as never;
        updateCase(target.id, fields, `Voice: updated case fields`);
        const parts = Object.entries(cmd.updateFields || {}).map(([k, v]) => `${k} = ${v}`).join(', ');
        setAnswer(`Case ${cmd.caseNumber} updated — ${parts}.`);
        setStatus('done'); setPending(null); setPendingNote('');      } catch (err) { setStatus('error'); setAnswer(err instanceof Error ? err.message : 'Could not update the case.'); }
      return;
    }
    if (cmd.kind === 'casePriority' && cmd.caseNumber && cmd.priority) {
      const blocked = deny('case:edit');
      if (blocked) { setStatus('error'); setAnswer(blocked); return; }
      const target = findCaseByNumber(cmd.caseNumber);
      if (!target) { setStatus('error'); setAnswer(`No case ${cmd.caseNumber} found.`); return; }
      try {
        updateCase(target.id, { priority: cmd.priority } as never, `Voice: priority ${cmd.priority}`);
        setAnswer(`Priority of ${cmd.caseNumber} set to “${cmd.priority}”.`);
        setStatus('done'); setPending(null); setPendingNote('');      } catch (err) { setStatus('error'); setAnswer(err instanceof Error ? err.message : 'Could not set the priority.'); }
      return;
    }
    if (cmd.kind === 'bulkCaseStatus' && cmd.bulkCaseNumbers?.length && cmd.targetStatus) {
      const blocked = deny('case:edit');
      if (blocked) { setStatus('error'); setAnswer(blocked); return; }
      const moved: string[] = [];
      const missing: string[] = [];
      for (const num of cmd.bulkCaseNumbers) {
        const target = findCaseByNumber(num);
        if (!target) { missing.push(num); continue; }
        updateCase(target.id, { status: cmd.targetStatus } as never, `Voice: bulk move to ${cmd.targetStatus}`);
        moved.push(num);
      }
      if (!moved.length) {
        setStatus('error');
        setAnswer(missing.length ? `No case(s) found: ${missing.join(', ')}.` : 'Nothing matched those case numbers.');
        return;
      }
      setAnswer(`Moved ${moved.length} case(s) to “${cmd.targetStatus}”${missing.length ? ` — not found: ${missing.join(', ')}` : ''}.`);
      setStatus('done'); setPending(null); setPendingNote('');      return;
    }
    if (cmd.kind === 'restoreCase' && cmd.caseNumber) {
      const blocked = deny('case:edit');
      if (blocked) { setStatus('error'); setAnswer(blocked); return; }
      const target = findCaseByNumber(cmd.caseNumber);
      if (!target) { setStatus('error'); setAnswer(`No case ${cmd.caseNumber} found.`); return; }
      try {
        restoreCase(target.id);
        setAnswer(`Case ${cmd.caseNumber} restored to the workstation.`);
        setStatus('done'); setPending(null); setPendingNote('');      } catch (err) { setStatus('error'); setAnswer(err instanceof Error ? err.message : 'Could not restore the case.'); }
      return;
    }
    if (cmd.kind === 'caseTemplateSave' && cmd.caseNumber && cmd.templateName) {
      const blocked = deny('case:edit');
      if (blocked) { setStatus('error'); setAnswer(blocked); return; }
      const target = findCaseByNumber(cmd.caseNumber);
      if (!target) { setStatus('error'); setAnswer(`No case ${cmd.caseNumber} found.`); return; }
      try {
        saveAsTemplate(cmd.templateName, target);
        setAnswer(`Template “${cmd.templateName}” saved from ${cmd.caseNumber}.`);
        setStatus('done'); setPending(null); setPendingNote('');      } catch (err) { setStatus('error'); setAnswer(err instanceof Error ? err.message : 'Could not save the template.'); }
      return;
    }
    if (cmd.kind === 'deleteCase' && cmd.caseNumber) {
      const blocked = deny('case:delete');
      if (blocked) { setStatus('error'); setAnswer(blocked); return; }
      const target = findCaseByNumber(cmd.caseNumber);
      if (!target) { setStatus('error'); setAnswer(`No case ${cmd.caseNumber} found.`); return; }
      try {
        deleteCasePermanently(target.id);
        setAnswer(`Case ${cmd.caseNumber} deleted permanently.`);
        setStatus('done'); setPending(null); setPendingNote('');      } catch (err) { setStatus('error'); setAnswer(err instanceof Error ? err.message : 'Could not delete the case.'); }
      return;
    }
    if (cmd.kind === 'purgeCase' && cmd.caseNumber) {
      const blocked = deny('case:delete');
      if (blocked) { setStatus('error'); setAnswer(blocked); return; }
      const target = findCaseByNumber(cmd.caseNumber);
      if (!target) { setStatus('error'); setAnswer(`No case ${cmd.caseNumber} found.`); return; }
      try {
        deleteCasePermanently(target.id);
        setAnswer(`Case ${cmd.caseNumber} purged — case, notes, attachments and QC data removed.`);
        setStatus('done'); setPending(null); setPendingNote('');      } catch (err) { setStatus('error'); setAnswer(err instanceof Error ? err.message : 'Could not purge the case.'); }
      return;
    }
    if (cmd.kind === 'updateClinicDoctor' && cmd.doctorName) {
      const blocked = deny('clinic:edit');
      if (blocked) { setStatus('error'); setAnswer(blocked); return; }
      const chosen = findLabByHint(labs || [], cmd.clinicHint);
      if (!chosen) {
        setStatus('error');
        setAnswer('I could not match that clinic. Tell me the clinic name again.');
        return;
      }
      try {
        updateLab(chosen.id, { contact_person: cmd.doctorName, doctor_name: cmd.doctorName });
        setAnswer(`Doctor for ${chosen.name} set to ${cmd.doctorName}.`);
        setStatus('done');
      } catch (err) {
        setStatus('error');
        setAnswer(err instanceof Error ? err.message : 'Could not update the doctor.');
      }
      return;
    }
    if (cmd.kind === 'addCaseNote' && cmd.caseNumber && cmd.noteText) {
      const blocked = deny('case:edit');
      if (blocked) { setStatus('error'); setAnswer(blocked); return; }
      const target = (cases || []).find((c) => c.case_number === cmd.caseNumber);
      if (!target) { setStatus('error'); setAnswer(`No case ${cmd.caseNumber} found.`); return; }
      try {
        addCaseNote(target.id, cmd.noteText, user?.name || 'Voice');
        setAnswer(`Note added on ${cmd.caseNumber}.`);
        setStatus('done');
        setPending(null);      } catch (err) { setStatus('error'); setAnswer(err instanceof Error ? err.message : 'Could not add the note.'); }
      return;
    }
    if (cmd.kind === 'recordQc' && cmd.caseNumber && cmd.qcResult) {
      const blocked = deny('case:edit');
      if (blocked) { setStatus('error'); setAnswer(blocked); return; }
      const target = (cases || []).find((c) => c.case_number === cmd.caseNumber);
      if (!target) { setStatus('error'); setAnswer(`No case ${cmd.caseNumber} found.`); return; }
      try {
        const receipt = recordQcCase({
          action: 'record',
          case_id: target.id,
          result: cmd.qcResult,
          reason_code: cmd.qcReason as never,
          inspector: user?.name || 'Voice',
        });
        const after = receipt?.status_after ? ` Case moved to ${receipt.status_after}.` : '';
        setAnswer(`QC ${cmd.qcResult.toUpperCase()} recorded on ${cmd.caseNumber}.${after}`);
        setStatus('done');
        setPending(null);      } catch (err) { setStatus('error'); setAnswer(err instanceof Error ? err.message : 'Could not record the QC result.'); }
      return;
    }
    if (cmd.kind === 'bulkArchive') {
      const blocked = deny('case:edit');
      if (blocked) { setStatus('error'); setAnswer(blocked); return; }
      const due = selectCasesToAutoArchive(cases || [], new Date(`${getTodayStr()}T00:00:00`));
      if (!due.length) { setStatus('error'); setAnswer('Nothing to archive now — no delivered case is more than 30 days past delivery.'); return; }
      let archived = 0;
      for (const c of due) {
        try { archiveCase(c.id); archived += 1; } catch { /* keep going */ }
      }
      setAnswer(`Archived ${archived} delivered case${archived === 1 ? '' : 's'} from more than 30 days ago.`);
      setStatus('done'); setPending(null);      return;
    }
    if (cmd.kind === 'archiveCase' && cmd.caseNumber) {
      const blocked = deny('case:edit');
      if (blocked) { setStatus('error'); setAnswer(blocked); return; }
      const target = (cases || []).find((c) => c.case_number === cmd.caseNumber);
      if (!target) { setStatus('error'); setAnswer(`No case ${cmd.caseNumber} found.`); return; }
      if (target.status !== 'delivered') { setStatus('error'); setAnswer(`Case ${cmd.caseNumber} is "${target.status}" — archive works on delivered cases only.`); setPending(null); setPendingNote(''); return; }
      try {
        archiveCase(target.id);
        setAnswer(`Case ${cmd.caseNumber} archived.`);
        setStatus('done');
        setPending(null);      } catch (err) { setStatus('error'); setAnswer(err instanceof Error ? err.message : 'Could not archive the case.'); }
      return;
    }
    if (cmd.kind === 'updateClinicField' && cmd.field && cmd.value) {
      const blocked = deny('clinic:edit');
      if (blocked) { setStatus('error'); setAnswer(blocked); return; }
      const chosen = findLabByHint(labs || [], cmd.clinicHint);
      if (!chosen) { setStatus('error'); setAnswer('I could not match that clinic. Tell me the clinic name again.'); return; }
      try {
        const updates: Record<string, string> = cmd.field === 'doctor'
          ? { contact_person: cmd.value, doctor_name: cmd.value }
          : { [cmd.field]: cmd.value };
        updateLab(chosen.id, updates);
        setAnswer(`${cmd.field} for ${chosen.name} updated.`);
        setStatus('done');
        setPending(null);      } catch (err) { setStatus('error'); setAnswer(err instanceof Error ? err.message : 'Could not update the clinic.'); }
      return;
    }
    if (cmd.kind === 'createCase' && cmd.patientName && cmd.clinicHint && cmd.caseTypeName) {
      const blocked = deny('case:create');
      if (blocked) { setStatus('error'); setAnswer(blocked); return; }
      const clinic = findLabByHint(labs || [], cmd.clinicHint!);
      const ct = (caseTypes || []).find((c) => c.name.toLowerCase() === cmd.caseTypeName!.toLowerCase());
      if (!clinic || !ct) { setStatus('error'); setAnswer('Could not resolve the clinic or case type.'); return; }
      try {
        const created = addCase({
          lab_id: clinic.id, lab_name: clinic.name,
          case_type_id: ct.id, case_type_name: ct.name,
          doctor_name: cmd.doctorName || 'Voice',
          selected_teeth: cmd.teeth ?? [], shade: cmd.shade,
          delivery_date: cmd.deliveryDate!,
          priority: (cmd.priority as never) ?? 'normal', price: cmd.amount, discount: 0, final_price: cmd.amount,
          status: 'received', patient_name: cmd.patientName,
        } as never);
        setAnswer(`Case created for ${cmd.patientName} at ${clinic.name} — ${ct.name}, PKR ${cmd.amount.toLocaleString()}. Case number: ${created.case_number}.`);
        setStatus('done'); setPending(null);      } catch (err) { setStatus('error'); setAnswer(err instanceof Error ? err.message : 'Could not create the case.'); }
      return;
    }
    if (cmd.kind === 'addClinicContact' || cmd.kind === 'addClinicAddress' || cmd.kind === 'addPricingOverride') {
      const action = cmd.kind === 'addPricingOverride' ? 'pricing:edit' : 'contacts:edit';
      const blocked = deny(action);
      if (blocked) { setStatus('error'); setAnswer(blocked); return; }
      const chosen = findLabByHint(labs || [], cmd.clinicHint || '');
      if (!chosen) { setStatus('error'); setAnswer('I could not match that clinic. Tell me the clinic name again.'); return; }
      try {
        if (cmd.kind === 'addClinicContact') {
          addLabContact({ lab_id: chosen.id, name: cmd.contactName!, phone: cmd.contactPhone!, email: cmd.contactEmail ?? '', role: cmd.contactRole || undefined, notes: 'Added by voice assistant', is_primary: !!cmd.isPrimary });
          setAnswer(`Contact “${cmd.contactName}” added to ${chosen.name}${cmd.isPrimary ? ' as primary' : ''}.`);
        } else if (cmd.kind === 'addClinicAddress') {
          addLabAddress({ lab_id: chosen.id, type: cmd.addressType!, street: cmd.street!, city: cmd.city!, state: cmd.state!, postal_code: cmd.postalCode!, country: cmd.country!, is_default: !!cmd.isDefault });
          setAnswer(`${cmd.addressType} address added for ${chosen.name}${cmd.isDefault ? ' as default' : ''}.`);
        } else {
          addPricingOverride({ lab_id: chosen.id, case_type_id: cmd.caseTypeId!, case_type_name: cmd.caseTypeName!, standard_price: cmd.standardPrice!, custom_price: cmd.customPrice!, discount_percentage: cmd.discountPercentage, effective_date: cmd.effectiveDate });
          setAnswer(`Pricing override set for ${cmd.caseTypeName} at ${chosen.name}: PKR ${cmd.customPrice?.toLocaleString()}.`);
        }
        setStatus('done'); setPending(null);      } catch (err) { setStatus('error'); setAnswer(err instanceof Error ? err.message : 'Could not save.'); }
      return;
    }
    if (cmd.kind === 'applyAdvance' && cmd.invoiceNumber) {
      const blocked = deny('payment:record');
      if (blocked) { setStatus('error'); setAnswer(blocked); return; }
      const inv = (invoices || []).find((i) => i.invoice_number.toUpperCase() === cmd.invoiceNumber!.toUpperCase());
      if (!inv) { setStatus('error'); setAnswer(`No invoice ${cmd.invoiceNumber} found.`); return; }
      try {
        const ok = applyAdvanceCreditV2({ clinicId: inv.lab_id, invoiceId: inv.id, amount: cmd.amount, notes: 'Voice-applied advance' });
        setAnswer(ok
          ? `Advance of PKR ${cmd.amount.toLocaleString()} applied to ${inv.invoice_number} — receipt issued.`
          : `Could not apply — the wallet balance or the invoice balance may have changed.`);
        setStatus('done'); setPending(null);      } catch (err) { setStatus('error'); setAnswer(err instanceof Error ? err.message : 'Could not apply the advance.'); }
      return;
    }
    if (cmd.kind === 'markPaid' && cmd.invoiceNumbers?.length) {
      if (user && !canPost(user, 'payment:bulk')) { setStatus('error'); setAnswer('Requires the “bulk settle” permission.'); return; }
      const nums = new Set(cmd.invoiceNumbers.map((n) => n.toUpperCase()));
      const ids = (invoices || []).filter((i) => nums.has(i.invoice_number.toUpperCase())).map((i) => i.id);
      if (!ids.length) { setStatus('error'); setAnswer('No matching invoices remained.'); return; }
      try {
        bulkMarkPaid(ids);
        setAnswer(`${ids.length} invoice${ids.length > 1 ? 's' : ''} marked paid — payments journalled for PKR ${cmd.amount.toLocaleString()}.`);
        setStatus('done'); setPending(null);      } catch (err) { setStatus('error'); setAnswer(err instanceof Error ? err.message : 'Could not mark paid.'); }
      return;
    }
    if (cmd.kind === 'printSettingsSave') {
      const blocked = deny('print:edit');
      if (blocked) { setStatus('error'); setAnswer(blocked); return; }
      try {
        savePrintSettings(cmd.printSettings as never);
        setAnswer('Print settings saved.');
        setStatus('done');
        setPending(null);      } catch (err) { setStatus('error'); setAnswer(err instanceof Error ? err.message : 'Could not save print settings.'); }
      return;
    }
    if (cmd.kind === 'printSectionsSave' && cmd.docKind && cmd.sections) {
      const blocked = deny('print:edit');
      if (blocked) { setStatus('error'); setAnswer(blocked); return; }
      try {
        saveDocumentSections(cmd.docKind, cmd.sections);
        if (cmd.docKind === 'statement') setStatementBankExcluded(!cmd.sections.includes('bank'));
        if (cmd.docKind === 'invoice') setInvoiceSummaryExcluded(false);
        setAnswer(`${cmd.docKind} sections saved: ${cmd.sections.join(', ')}.`);
        setStatus('done');
        setPending(null);      } catch (err) { setStatus('error'); setAnswer(err instanceof Error ? err.message : 'Could not save print sections.'); }
      return;
    }
    if (cmd.kind === 'notificationConfigSave') {
      const blocked = deny('notifications:edit');
      if (blocked) { setStatus('error'); setAnswer(blocked); return; }
      try {
        saveNotificationConfig(cmd.notification as never);
        announceNotificationConfigChanged();
        setAnswer('Notification configuration saved — sweeps will use the new cadence.');
        setStatus('done');
        setPending(null);      } catch (err) { setStatus('error'); setAnswer(err instanceof Error ? err.message : 'Could not save notification config.'); }
      return;
    }
    if (cmd.kind === 'closeMonth' && cmd.month && cmd.labId) {
      if (user && !canPost(user, 'payment:record')) { setStatus('error'); setAnswer('Requires the “Record payment” permission to close a month.'); return; }
      try {
        closeMonth({ invoices: invoices || [], advancePayments: advancePayments || [], accountAdjustments: accountAdjustments || [], labs: labs || [], month: cmd.month, labId: cmd.labId, labName: cmd.labName, actor: user?.name || 'System' });
        setAnswer(`${cmd.month} closed for ${cmd.labName}. Nothing locks — corrections can re-close.`);
        setStatus('done');
        setPending(null);      } catch (err) { setStatus('error'); setAnswer(err instanceof Error ? err.message : 'Could not close the month.'); }
      return;
    }
    /* ── Case management extras ───────────────────────────────────────── */
    if (cmd.kind === 'deleteCaseNote' && cmd.caseNumber && cmd.noteText) {
      const blocked = deny('case:edit');
      if (blocked) { setStatus('error'); setAnswer(blocked); return; }
      const target = findCaseByNumber(cmd.caseNumber);
      const notes = target ? (caseNotes?.[target.id] || []) : [];
      const lower = cmd.noteText.toLowerCase();
      const hit = notes.find((n) => String(n.note_text || '').toLowerCase().includes(lower));
      if (!target || !hit) { setStatus('error'); setAnswer(`No note matching “${cmd.noteText.slice(0, 50)}” on ${cmd.caseNumber}.`); setPending(null); return; }
      try {
        deleteCaseNote(target.id, hit.id);
        setAnswer(`Note removed from ${cmd.caseNumber}.`);
        setStatus('done'); setPending(null); setPendingNote('');
      } catch (err) { setStatus('error'); setAnswer(err instanceof Error ? err.message : 'Could not delete the note.'); }
      return;
    }
    if (cmd.kind === 'deleteCaseAttachment' && cmd.caseNumber && cmd.fileName) {
      const blocked = deny('case:edit');
      if (blocked) { setStatus('error'); setAnswer(blocked); return; }
      const target = findCaseByNumber(cmd.caseNumber);
      const files = target ? (caseAttachments?.[target.id] || []) : [];
      const lower = cmd.fileName.toLowerCase();
      const hit = files.find((f) => String(f.filename || '').toLowerCase().includes(lower));
      if (!target || !hit) { setStatus('error'); setAnswer(`No attachment matching “${cmd.fileName}” on ${cmd.caseNumber}.`); setPending(null); return; }
      try {
        deleteCaseAttachment(target.id, hit.id);
        setAnswer(`Attachment “${hit.filename}” removed from ${cmd.caseNumber}.`);
        setStatus('done'); setPending(null); setPendingNote('');
      } catch (err) { setStatus('error'); setAnswer(err instanceof Error ? err.message : 'Could not delete the attachment.'); }
      return;
    }
    if (cmd.kind === 'createCaseFromTemplate' && cmd.templateName && cmd.clinicHint) {
      const blocked = deny('case:create');
      if (blocked) { setStatus('error'); setAnswer(blocked); return; }
      const chosen = findLabByHint(labs || [], cmd.clinicHint);
      const tpl = (templates || []).find((t) => t.template_name.toLowerCase() === cmd.templateName!.toLowerCase())
        || (templates || []).find((t) => t.template_name.toLowerCase().includes(cmd.templateName!.toLowerCase()));
      if (!chosen || !tpl) { setStatus('error'); setAnswer('Could not match that template or clinic.'); return; }
      const ct = (caseTypes || []).find((t) => t.id === tpl.case_type_id);
      const price = Number(ct?.base_price || 0);
      try {
        const created = addCase({
          lab_id: chosen.id, lab_name: chosen.name,
          case_type_id: tpl.case_type_id, case_type_name: tpl.case_type_name,
          doctor_name: 'Voice', selected_teeth: tpl.selected_teeth || [], shade: tpl.shade,
          instructions: tpl.instructions, delivery_date: cmd.deliveryDate || computeSlaDueDate(tpl.default_priority || 'normal'),
          priority: tpl.default_priority || 'normal', price, discount: 0, final_price: price,
          status: 'received', patient_name: cmd.patientName || 'Template case',
        } as never);
        setAnswer(`Case created from template “${tpl.template_name}” for ${cmd.patientName || 'the patient'} at ${chosen.name} — ${created.case_number}, PKR ${price.toLocaleString()}.`);
        setStatus('done'); setPending(null); setPendingNote('');
      } catch (err) { setStatus('error'); setAnswer(err instanceof Error ? err.message : 'Could not create the case.'); }
      return;
    }
    /* ── Lab / clinic lifecycle ───────────────────────────────────────── */
    if (cmd.kind === 'deleteLab') {
      const blocked = deny('clinic:edit');
      if (blocked) { setStatus('error'); setAnswer(blocked); return; }
      const chosen = findLabByHint(labs || [], cmd.clinicHint);
      if (!chosen) { setStatus('error'); setAnswer('I could not match that clinic. Tell me the clinic name again.'); return; }
      try {
        deleteLab(chosen.id);
        setAnswer(`${chosen.name} deleted with all its cases, invoices and history.`);
        setStatus('done'); setPending(null); setPendingNote('');
      } catch (err) { setStatus('error'); setAnswer(err instanceof Error ? err.message : 'Could not delete the clinic.'); }
      return;
    }
    if (cmd.kind === 'deleteLabContact' && cmd.contactName) {
      const blocked = deny('contacts:edit');
      if (blocked) { setStatus('error'); setAnswer(blocked); return; }
      const chosen = findLabByHint(labs || [], cmd.clinicHint);
      const hit = chosen ? (labContacts || []).find((c) => c.lab_id === chosen.id && c.name.toLowerCase().includes(cmd.contactName!.toLowerCase())) : null;
      if (!chosen || !hit) { setStatus('error'); setAnswer(`No contact matching “${cmd.contactName}” at that clinic.`); return; }
      try {
        deleteLabContact(hit.id);
        setAnswer(`Contact “${hit.name}” removed from ${chosen.name}.`);
        setStatus('done'); setPending(null); setPendingNote('');
      } catch (err) { setStatus('error'); setAnswer(err instanceof Error ? err.message : 'Could not delete the contact.'); }
      return;
    }
    if (cmd.kind === 'deleteLabAddress' && cmd.addressType) {
      const blocked = deny('contacts:edit');
      if (blocked) { setStatus('error'); setAnswer(blocked); return; }
      const chosen = findLabByHint(labs || [], cmd.clinicHint);
      const hit = chosen ? (labAddresses || []).find((a) => a.lab_id === chosen.id && a.type === cmd.addressType) : null;
      if (!chosen || !hit) { setStatus('error'); setAnswer(`No ${cmd.addressType} address on that clinic.`); return; }
      try {
        deleteLabAddress(hit.id);
        setAnswer(`${cmd.addressType} address removed from ${chosen.name}.`);
        setStatus('done'); setPending(null); setPendingNote('');
      } catch (err) { setStatus('error'); setAnswer(err instanceof Error ? err.message : 'Could not delete the address.'); }
      return;
    }
    if (cmd.kind === 'deletePricingOverride' && cmd.caseTypeName) {
      const blocked = deny('pricing:edit');
      if (blocked) { setStatus('error'); setAnswer(blocked); return; }
      const chosen = findLabByHint(labs || [], cmd.clinicHint);
      const hit = chosen ? (pricingOverrides || []).find((p) => p.lab_id === chosen.id && p.case_type_name.toLowerCase().includes(cmd.caseTypeName!.toLowerCase())) : null;
      if (!chosen || !hit) { setStatus('error'); setAnswer(`No ${cmd.caseTypeName} price override at that clinic.`); return; }
      try {
        deletePricingOverride(hit.id);
        setAnswer(`${hit.case_type_name} price override removed from ${chosen.name}.`);
        setStatus('done'); setPending(null); setPendingNote('');
      } catch (err) { setStatus('error'); setAnswer(err instanceof Error ? err.message : 'Could not delete the pricing override.'); }
      return;
    }
    if (cmd.kind === 'setDoctorPreferredLab' && cmd.doctorName) {
      const blocked = deny('clinic:edit');
      if (blocked) { setStatus('error'); setAnswer(blocked); return; }
      const chosen = findLabByHint(labs || [], cmd.clinicHint);
      if (!chosen) { setStatus('error'); setAnswer('I could not match that clinic.'); return; }
      try {
        setDoctorPreferredLab(cmd.doctorName, chosen.id, chosen.name);
        setAnswer(`Dr ${cmd.doctorName} now prefers ${chosen.name}.`);
        setStatus('done'); setPending(null); setPendingNote('');
      } catch (err) { setStatus('error'); setAnswer(err instanceof Error ? err.message : 'Could not save the preference.'); }
      return;
    }
    /* ── Catalog extras ───────────────────────────────────────────────── */
    if (cmd.kind === 'addCaseType' && cmd.caseTypeName) {
      const blocked = deny('catalog:edit');
      if (blocked) { setStatus('error'); setAnswer(blocked); return; }
      try {
        addCaseType({
          name: cmd.caseTypeName,
          base_price: Number(cmd.caseTypeBasePrice || 0),
          category: cmd.caseTypeCategory || undefined,
          lead_time_days: cmd.caseTypeLeaderDays || undefined,
          material_system: cmd.caseTypeMaterial || undefined,
          description: cmd.caseTypeDescription || undefined,
        } as never);
        setAnswer(`Case type “${cmd.caseTypeName}” added at PKR ${Number(cmd.caseTypeBasePrice || 0).toLocaleString()}.`);
        setStatus('done'); setPending(null); setPendingNote('');
      } catch (err) { setStatus('error'); setAnswer(err instanceof Error ? err.message : 'Could not add the case type.'); }
      return;
    }
    if (cmd.kind === 'updateCaseType' && cmd.caseTypeName) {
      const blocked = deny('catalog:edit');
      if (blocked) { setStatus('error'); setAnswer(blocked); return; }
      const ct = (caseTypes || []).find((t) => t.name.toLowerCase() === cmd.caseTypeName!.toLowerCase())
        || (caseTypes || []).find((t) => t.name.toLowerCase().includes(cmd.caseTypeName!.toLowerCase()));
      if (!ct) { setStatus('error'); setAnswer(`No case type named “${cmd.caseTypeName}”.`); return; }
      try {
        updateCaseType(ct.id, {
          base_price: cmd.caseTypeBasePrice !== undefined ? Number(cmd.caseTypeBasePrice) : undefined,
          category: cmd.caseTypeCategory || undefined,
          lead_time_days: cmd.caseTypeLeaderDays !== undefined ? Number(cmd.caseTypeLeaderDays) : undefined,
          material_system: cmd.caseTypeMaterial || undefined,
          description: cmd.caseTypeDescription || undefined,
        } as never);
        setAnswer(`Case type “${ct.name}” updated.`);
        setStatus('done'); setPending(null); setPendingNote('');
      } catch (err) { setStatus('error'); setAnswer(err instanceof Error ? err.message : 'Could not update the case type.'); }
      return;
    }
    if (cmd.kind === 'deleteCaseType' && cmd.caseTypeName) {
      const blocked = deny('catalog:edit');
      if (blocked) { setStatus('error'); setAnswer(blocked); return; }
      const ct = (caseTypes || []).find((t) => t.name.toLowerCase() === cmd.caseTypeName!.toLowerCase())
        || (caseTypes || []).find((t) => t.name.toLowerCase().includes(cmd.caseTypeName!.toLowerCase()));
      if (!ct) { setStatus('error'); setAnswer(`No case type named “${cmd.caseTypeName}”.`); return; }
      try {
        deleteCaseType(ct.id);
        setAnswer(`Case type “${ct.name}” deleted from the catalog.`);
        setStatus('done'); setPending(null); setPendingNote('');
      } catch (err) { setStatus('error'); setAnswer(err instanceof Error ? err.message : 'Could not delete the case type. A category may block it.'); }
      return;
    }
    if (cmd.kind === 'slaSave' && cmd.slaDays) {
      try {
        const current = loadSlaSettings();
        saveSlaSettings({ ...current, ...Object.fromEntries(Object.entries(cmd.slaDays).filter(([, v]) => v !== undefined)) } as never);
        const next = loadSlaSettings();
        setAnswer(`SLA updated — urgent ${next.urgent}d, high ${next.high}d, normal ${next.normal}d, low ${next.low}d.`);
        setStatus('done'); setPending(null); setPendingNote('');
      } catch (err) { setStatus('error'); setAnswer(err instanceof Error ? err.message : 'Could not save SLA settings.'); }
      return;
    }
    /* ── Billing depth ────────────────────────────────────────────────── */
    if (cmd.kind === 'recordAdjustment' && cmd.adjustmentType) {
      const blocked = deny('payment:record');
      if (blocked) { setStatus('error'); setAnswer(blocked); return; }
      const chosen = findLabByHint(labs || [], cmd.clinicHint);
      if (!chosen) { setStatus('error'); setAnswer('I could not match that clinic.'); return; }
      try {
        const adj = recordAccountAdjustment(chosen.id, cmd.adjustmentType, cmd.amount, cmd.reason || 'Recorded by voice');
        setAnswer(`${cmd.adjustmentType.replace(/_/g, ' ')} of PKR ${cmd.amount.toLocaleString()} recorded for ${chosen.name} — ${adj.adjustment_number}.`);
        setStatus('done'); setPending(null); setPendingNote('');
      } catch (err) { setStatus('error'); setAnswer(err instanceof Error ? err.message : 'Could not record the adjustment.'); }
      return;
    }
    if (cmd.kind === 'deleteAdjustment') {
      const blocked = deny('payment:edit');
      if (blocked) { setStatus('error'); setAnswer(blocked); return; }
      const chosen = findLabByHint(labs || [], cmd.clinicHint);
      const hit = chosen ? (accountAdjustments || [])
        .filter((a) => a.lab_id === chosen.id)
        .filter((a) => !cmd.amount || Math.abs(Number(a.amount) - cmd.amount) < 0.005)
        .filter((a) => !cmd.referenceNumber || String(a.reference_number || '').toLowerCase().includes(cmd.referenceNumber.toLowerCase()))
        .slice(-1)[0] : null;
      if (!chosen || !hit) { setStatus('error'); setAnswer('No matching adjustment found. Say “list adjustments” first.'); return; }
      try {
        const ok = deleteAccountAdjustment(hit.id);
        setAnswer(ok ? `${hit.adjustment_number || hit.id} deleted.` : 'Could not delete that adjustment.');
        setStatus('done'); setPending(null); setPendingNote('');
      } catch (err) { setStatus('error'); setAnswer(err instanceof Error ? err.message : 'Could not delete the adjustment.'); }
      return;
    }
    if (cmd.kind === 'deletePayment' && cmd.receiptNumber) {
      const blocked = deny('payment:edit');
      if (blocked) { setStatus('error'); setAnswer(blocked); return; }
      const want = cmd.receiptNumber.toUpperCase();
      const hit = (allPayments || []).find((p) => [p.receipt_number, p.payment_number, p.id].filter(Boolean).some((x) => String(x).toUpperCase() === want));
      if (!hit) { setStatus('error'); setAnswer(`No payment ${cmd.receiptNumber} found. Say “list payments” first.`); return; }
      try {
        const ok = deletePaymentV2(hit.id);
        setAnswer(ok ? `Payment ${cmd.receiptNumber} deleted and its allocation reversed.` : 'Could not delete that payment.');
        setStatus('done'); setPending(null); setPendingNote('');
      } catch (err) { setStatus('error'); setAnswer(err instanceof Error ? err.message : 'Could not delete the payment.'); }
      return;
    }
    if (cmd.kind === 'updatePayment' && cmd.receiptNumber && cmd.newAmount) {
      const blocked = deny('payment:edit');
      if (blocked) { setStatus('error'); setAnswer(blocked); return; }
      const want = cmd.receiptNumber.toUpperCase();
      const hit = (allPayments || []).find((p) => [p.receipt_number, p.payment_number, p.id].filter(Boolean).some((x) => String(x).toUpperCase() === want));
      if (!hit) { setStatus('error'); setAnswer(`No payment ${cmd.receiptNumber} found.`); return; }
      try {
        const ok = updatePaymentAmountV2(hit.id, cmd.newAmount);
        setAnswer(ok ? `Payment ${cmd.receiptNumber} changed to PKR ${cmd.newAmount.toLocaleString()}.` : 'Refused — the new amount may overpay the invoice.');
        setStatus('done'); setPending(null); setPendingNote('');
      } catch (err) { setStatus('error'); setAnswer(err instanceof Error ? err.message : 'Could not update the payment.'); }
      return;
    }
    if (cmd.kind === 'issueCreditNote' && cmd.invoiceNumber) {
      const blocked = deny('payment:record');
      if (blocked) { setStatus('error'); setAnswer(blocked); return; }
      const inv = (invoices || []).find((i) => i.invoice_number.toUpperCase() === cmd.invoiceNumber!.toUpperCase());
      if (!inv) { setStatus('error'); setAnswer(`No invoice ${cmd.invoiceNumber} found.`); return; }
      try {
        const adj = issueCreditNoteV2({
          clinicId: inv.lab_id, invoiceId: inv.id, amount: cmd.amount,
          reasonCode: 'other', reasonText: cmd.reason || 'Issued by voice',
        });
        setAnswer(`Credit note issued on ${inv.invoice_number} for PKR ${cmd.amount.toLocaleString()} — ${adj.adjustment_number}.`);
        setStatus('done'); setPending(null); setPendingNote('');
      } catch (err) { setStatus('error'); setAnswer(err instanceof Error ? err.message : 'Could not issue the credit note.'); }
      return;
    }
    if (cmd.kind === 'deleteInvoice' && cmd.invoiceNumber) {
      const blocked = deny('payment:edit');
      if (blocked) { setStatus('error'); setAnswer(blocked); return; }
      const inv = (invoices || []).find((i) => i.invoice_number.toUpperCase() === cmd.invoiceNumber!.toUpperCase());
      if (!inv) { setStatus('error'); setAnswer(`No invoice ${cmd.invoiceNumber} found.`); return; }
      try {
        deleteInvoice(inv.id);
        setAnswer(`Invoice ${cmd.invoiceNumber} deleted.`);
        setStatus('done'); setPending(null); setPendingNote('');
      } catch (err) { setStatus('error'); setAnswer(err instanceof Error ? err.message : 'Could not delete the invoice.'); }
      return;
    }
    if ((cmd.kind === 'reconcileItem' || cmd.kind === 'flagReconciliation') && cmd.referenceNumber) {
      const blocked = deny('payment:edit');
      if (blocked) { setStatus('error'); setAnswer(blocked); return; }
      const want = cmd.referenceNumber.toLowerCase();
      const hit = (reconciliationItems || []).find((r) => String(r.reference_number || '').toLowerCase().includes(want));
      if (!hit) { setStatus('error'); setAnswer(`No reconciliation item for “${cmd.referenceNumber}”.`); return; }
      try {
        if (cmd.kind === 'reconcileItem') {
          reconcileItemV2(hit.id, cmd.reason || 'Reconciled by voice');
          setAnswer(`Payment ${hit.reference_number} marked reconciled.`);
        } else {
          flagReconciliationExceptionV2(hit.id, cmd.reason || 'Flagged by voice');
          setAnswer(`Payment ${hit.reference_number} flagged — ${cmd.reason || 'exception recorded'}.`);
        }
        setStatus('done'); setPending(null); setPendingNote('');
      } catch (err) { setStatus('error'); setAnswer(err instanceof Error ? err.message : 'Could not update reconciliation.'); }
      return;
    }
    /* ── Saved vouchers (job slips / invoice log) ─────────────────────── */
    if (cmd.kind === 'saveVoucher' && cmd.caseNumber) {
      const blocked = deny('case:edit');
      if (blocked) { setStatus('error'); setAnswer(blocked); return; }
      const target = findCaseByNumber(cmd.caseNumber);
      if (!target) { setStatus('error'); setAnswer(`I can’t find case ${cmd.caseNumber}.`); return; }
      const voucherType = cmd.voucherType || 'job_slip';
      try {
        const saved = saveVoucherToSystem({
          voucher_number: `${voucherType === 'invoice' ? 'INV-V' : 'SLIP'}-${target.case_number}`,
          voucher_type: voucherType,
          case_id: target.id,
          case_number: target.case_number,
          lab_name: target.lab_name,
          doctor_name: target.doctor_name,
          patient_name: target.patient_name,
          case_type_name: target.case_type_name,
          amount: voucherType === 'invoice' ? Number(target.final_price || 0) : undefined,
          notes: `Logged by voice${target.selected_teeth?.length ? ` — teeth ${target.selected_teeth.join(', ')}` : ''}`,
        });
        setAnswer(`${voucherType === 'invoice' ? 'Invoice' : 'Job slip'} voucher ${saved.voucher_number} logged for ${target.case_number}.`);
        setStatus('done'); setPending(null); setPendingNote('');
      } catch (err) { setStatus('error'); setAnswer(err instanceof Error ? err.message : 'Could not log the voucher.'); }
      return;
    }
    if (cmd.kind === 'deleteVoucher' && cmd.voucherNumber) {
      const blocked = deny('print:edit');
      if (blocked) { setStatus('error'); setAnswer(blocked); return; }
      const want = cmd.voucherNumber.toUpperCase();
      const hit = (savedVouchers || []).find((v) => v.voucher_number.toUpperCase() === want)
        || (savedVouchers || []).find((v) => v.voucher_number.toUpperCase().includes(want));
      if (!hit) { setStatus('error'); setAnswer(`No voucher ${cmd.voucherNumber} in the register. Say “list vouchers” first.`); return; }
      try {
        deleteSavedVoucher(hit.id);
        setAnswer(`Voucher ${hit.voucher_number} deleted from the register.`);
        setStatus('done'); setPending(null); setPendingNote('');
      } catch (err) { setStatus('error'); setAnswer(err instanceof Error ? err.message : 'Could not delete the voucher.'); }
      return;
    }
    const { clinic, candidates } = resolveClinicForWrite(cmd.clinicHint) as { clinic?: { id: string; name: string }; candidates?: string[] };
    if (!clinic) {
      setStatus('error');
      setAnswer(candidates?.length ? `Which clinic — ${candidates.join(', ')}?` : 'I could not match that clinic. Tell me the clinic name again.');
      return;
    }
    try {
      const date = getTodayStr();
      if (cmd.kind === 'payment') {
        const clinicInvoices = (invoices || []).filter((i) => i.lab_id === clinic.id)
          .map((i) => ({ inv: i, balance: invoiceBalanceDue(i) }))
          .filter((x) => x.balance > 0)
          .sort((a, b) => String(a.inv.created_at).localeCompare(String(b.inv.created_at)));
        let remaining = cmd.amount;
        const allocations: { invoiceId: string; amount: number }[] = [];
        if (cmd.invoiceNumber) {
          const inv = clinicInvoices.find((x) => x.inv.invoice_number === cmd.invoiceNumber);
          if (!inv) { setStatus('error'); setAnswer(`No outstanding invoice ${cmd.invoiceNumber} for ${clinic.name}.`); return; }
          const alloc = Math.min(inv.balance, cmd.amount);
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
          clinicId: clinic.id, amount: cmd.amount, method: cmd.method, date,
          notes: pendingNote || 'Voice-confirmed payment', allocations, saveRemainingAsAdvance: false, isVerified: false,
        });
        const unapplied = Math.max(0, cmd.amount - allocations.reduce((s, a) => s + a.amount, 0));
        setAnswer(`Payment posted for ${clinic.name}: receipt ${result.receiptNumber}.${unapplied > 0 ? ` Unapplied PKR ${unapplied.toLocaleString()} held on the receipt.` : ''}`);
      } else {
        const result = recordAdvanceDepositV2({
          clinicId: clinic.id, amount: cmd.amount, method: cmd.method, date,
          notes: pendingNote || 'Voice-confirmed advance deposit', isVerified: false,
        });
        setAnswer(`Advance deposit recorded for ${clinic.name}: receipt ${result.receiptNumber}.`);
      }
      setStatus('done');
    } catch (err) {
      setStatus('error');
      setAnswer(err instanceof Error ? err.message : 'Could not post the transaction.');
    }
  };

  const listen = () => {
    if (locked || busy) return;
    // Push-to-tap and Always-On are mutually exclusive — stop the poller
    // so the manual clip isn't appended to the still-open speech path.
    stopAlwaysOn();
    // Cloud mic (Groq Whisper) — the only speech-input path that works in
    // Tauri/WebView2 (the built-in SpeechRecognition API is not exposed there).
    if (cloudMic) {
      void (async () => {
        setStatus('listening');
        setAnswer('Listening…');
        let startTimer: number | null = null;
        try {
          // Watchdog: if the mic doesn't start in time, surface an error.
          startTimer = window.setTimeout(() => {
            setStatus('error');
            setAnswer('Microphone did not start. Try again.');
          }, 4000);
          // Inline: mic → recorder → ready (no external promise chain).
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          window.clearTimeout(startTimer);
          startTimer = null;
          const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
          const recorder = new MediaRecorder(stream, { mimeType: mime });
          const chunks: BlobPart[] = [];
          recorder.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
          const blobPromise = new Promise<Blob>((r) => { recorder.onstop = () => r(new Blob(chunks, { type: mime })); });
          recorder.start();
          const timeout = window.setTimeout(async () => {
            try {
              recorder.stop();
              const blob = await blobPromise;
              setStatus('thinking');
              setAnswer('Transcribing…');
              const text = await transcribeWithGroq(blob);
              if (text) { setQuery(text); void submit(text); }
              else { setStatus('error'); setAnswer('Jarvis could not transcribe that — check the Groq key in Settings, or type the question.'); }
            } finally { cloudStop.current = null; }
          }, 6000);
          cloudStop.current = () => { window.clearTimeout(timeout); recorder.stop(); stream.getTracks().forEach((t) => t.stop()); };
        } catch (err) {
          const msg = err instanceof Error && err.name === 'NotAllowedError'
            ? 'Microphone access is blocked. Allow microphone for this app in your system settings, then try again.'
            : 'Microphone is unavailable on this device. Type your question — the assistant answers it the same way.';
          setStatus('error');
          setAnswer(msg);
        } finally {
          if (startTimer) window.clearTimeout(startTimer);
        }
      })();
      return;
    }

    const rec = getRecognition();
    if (!rec) {
      setStatus('error');
      setAnswer(groqEnabled()
        ? 'Cloud mic failed to start. Check microphone permissions, or type the question.'
        : 'No Groq key saved yet. Paste one in Settings → Jarvis → Groq API key, or type the question.');
      return;
    }
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

  /* Always-on mode: armed while Always Listen is on and the orb is open. */
  const alwaysOnActive = !!userPreferences?.voice_always_listen && !!cloudMic && !locked;
  /* Always-on mode: arm the VAD poller while the orb is open + toggle on. */
  useEffect(() => {
    if (open && userPreferences?.voice_always_listen) {
      if (cloudMic) startAlwaysOn();
      else {
        stopAlwaysOn();
        setStatus('idle');
        setAnswer('Always-on needs Groq: save a key in Settings → Jarvis, or pause Always Listen.');
      }
    } else {
      stopAlwaysOn();
    }
    return stopAlwaysOn;
  }, [open, userPreferences?.voice_always_listen, cloudMic, busy]); // eslint-disable-line react-hooks/exhaustive-deps

  /* A "listening" *speech capture* pulse beats faster; the always-on beat
     is steady — the visual says "already listening" vs "listening now". */
  const orbState: VoiceOrbState =
    locked ? 'locked' : status === 'listening' ? 'listening' : alwaysOnActive ? 'always_on' : status === 'thinking' ? 'thinking' : 'idle';
  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  if (!voiceEnabled || !user || !online) return null;

  return (
    <aside aria-label="Voice assistant" className="no-print pointer-events-none fixed bottom-24 right-4 sm:right-6 z-[90] flex flex-col items-end gap-2">
      {/* The orb is the single entry point; breathing idle → ring pulse while listening/thinking. */}
      <VoiceOrb
        state={orbState}
        locked={locked}
        onClick={toggle}
      />


      {open && (
        <div className={`pointer-events-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl ${expanded ? 'fixed inset-4 sm:inset-10 z-[95] flex flex-col overflow-hidden' : 'w-80'}`}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Jarvis {expanded ? '— dedicated panel' : ''}</span>
            <div className="flex items-center gap-1.5">
              <button type="button" onClick={() => setExpanded((v) => !v)} aria-label={expanded ? 'Collapse panel' : 'Open dedicated panel'} title={expanded ? 'Collapse' : 'Dedicated panel'} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              </button>
              <button type="button" onClick={close} aria-label="Close voice assistant" className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="h-4 w-4" /></button>
            </div>
          </div>
          {expanded && alwaysOnActive && (
            <div className="mt-2.5 rounded-xl border border-emerald-200 bg-emerald-50 p-2.5 text-xs font-semibold text-emerald-800" role="status">
              Always listening — speak anytime, or click the mic to type.
            </div>
          )}
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
            {busy ? 'Thinking…' : answer || 'Ask Jarvis — balances, statements, payments, navigation — or just talk.'}
          </div>

          {pending && (
            <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
              <div className="flex items-center gap-1.5 font-bold"><CheckCircle2 className="h-4 w-4" />{pendingRisk === 'destructive' ? 'Destructive action — cannot be undone' : ''}</div>
              <p className="mt-1.5">{answer}</p>
              {pendingRisk === 'destructive' && (
                <>
                  <p className="mt-1 text-[10px] font-semibold text-rose-600">Say “{expectTyped}” to confirm this cannot be undone. Or type it above.</p>
                  {expectTyped && (
                    <div className="mt-1 flex items-center gap-1 px-2 py-1 rounded bg-rose-50 text-[10px] font-semibold text-rose-900">
                      <Mic className="h-3 w-3" /> Spoken: “{expectTyped}”
                    </div>
                  )}
                </>
              )}
              <div className="mt-2 flex gap-2">
                {pendingRisk === 'destructive' ? (
                  <>
                    <input
                      type="text"
                      value={typedConfirm}
                      onChange={(e) => setTypedConfirm(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
                      placeholder={`Type “${expectTyped}”`}
                      aria-label="Type to confirm"
                      className="min-w-0 flex-1 rounded-lg border border-amber-300 bg-white px-2.5 py-2 text-xs font-bold text-rose-900"
                    />
                    <button type="button" onClick={() => void submit()} className="flex-1 rounded-lg px-3 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700">Confirm destructive</button>
                    <button type="button" onClick={cancelPending} className="flex-1 rounded-lg border border-amber-300 px-3 py-2 text-xs font-bold text-amber-800 hover:bg-amber-100">Cancel</button>
                  </>
                ) : null}
              </div>
            </div>
          )}

          <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ask Jarvis or type…"
              className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2.5 py-2 text-xs"
              aria-label="Ask Jarvis"
            />
            <button type="button" onClick={listen} aria-label="Listen" title="Listen" className="ds-tap rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-100"><AudioLines className="h-4 w-4" /></button>
            <button type="submit" disabled={busy} aria-label="Ask" className="ds-tap rounded-lg bg-indigo-600 p-2 text-white hover:bg-indigo-700 disabled:opacity-50"><SendHorizonal className="h-4 w-4" /></button>
          </form>
          <p className="mt-2 text-[10px] text-slate-400">Mic: {alwaysOnActive ? 'Always listening (VAD + Groq Whisper).' : cloudMic ? 'Groq Whisper cloud transcription (audio goes to Groq).' : 'No cloud mic — save a Groq API key in Settings → Jarvis, or type the question.'} {groqEnabled() ? 'Groq routing ON.' : 'Groq routing off — offline answers.'}</p>
        </div>
      )}
    </aside>
  );
};
