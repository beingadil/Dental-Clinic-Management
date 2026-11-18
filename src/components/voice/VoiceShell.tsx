import React, { useEffect, useMemo, useRef, useState } from 'react';
import { VoiceOrb } from './VoiceOrb';
import { listMemories, clearMemories } from '../../services/voiceMemory';
import { X, SendHorizonal, AudioLines, CheckCircle2, History, Sparkles, Maximize2, Minimize2 } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { moduleForView, isViewProtected, isModuleUnlocked } from '../../services/moduleSecurity';
import { speak, cancelSpeech } from '../../services/voiceUtterance';
import { askAssistant } from '../../services/voiceAssistant';
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
    recordTransactionV2, recordAdvanceDepositV2, setCurrentView, addLab, updateLab, updateCase, addCaseNote, recordQcCase, archiveCase,
  } = useApp();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [memoryCount, setMemoryCount] = useState(() => listMemories().length);
  const [status, setStatus] = useState<ShellStatus>('idle');
  const [query, setQuery] = useState('');
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<WriteCommand | null>(null);
  const [pendingRisk, setPendingRisk] = useState<'write' | 'destructive'>('write');
  const [pendingNote, setPendingNote] = useState('');
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
    const amount = `PKR ${cmd.amount.toLocaleString()}`;
    const kind = cmd.kind === 'payment' ? `payment against ${cmd.invoiceNumber || 'the oldest unpaid invoices'}` : 'advance deposit';
    setAnswer(`${destructiveBanner}Confirm: ${amount} ${kind} for ${cmd.clinicHint} via ${cmd.method.toUpperCase()}?`);
    speak(`${destructiveBanner}Confirm: ${amount} ${kind} for ${cmd.clinicHint}.`, {
      rate: userPreferences?.voice_tts_rate, voiceUri: userPreferences?.voice_tts_voice_uri,
      locale: userPreferences?.voice_locale || 'en-PK', allowClinicalDetail: false,
    });
  };

  const submit = async (raw?: string) => {
    const text = (raw ?? query).trim();
    if (!text || busy) return;

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
        labs: labs || [], invoices: invoices || [], advancePayments: advancePayments || [], accountAdjustments: accountAdjustments || [], cases: cases || [], user,
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
  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  if (!voiceEnabled || !user) return null;

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
