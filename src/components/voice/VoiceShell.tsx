import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Mic, Lock, X, SendHorizonal, AudioLines, CheckCircle2 } from 'lucide-react';
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
    recordTransactionV2, recordAdvanceDepositV2, setCurrentView, addLab,
  } = useApp();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<ShellStatus>('idle');
  const [query, setQuery] = useState('');
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<WriteCommand | null>(null);
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

  const queueWrite = (cmd: WriteCommand, note: string) => {
    setPending(cmd);
    setPendingNote(note);
    setStatus('done');
    if (cmd.kind === 'createClinic') {
      setAnswer(`Confirm: create clinic “${cmd.clinicHint}”?`);
      speak(`Confirm: create clinic ${cmd.clinicHint}.`, { rate: userPreferences?.voice_tts_rate, voiceUri: userPreferences?.voice_tts_voice_uri, locale: userPreferences?.voice_locale || 'en-PK', allowClinicalDetail: false });
      return;
    }
    const amount = `PKR ${cmd.amount.toLocaleString()}`;
    const kind = cmd.kind === 'payment' ? `payment against ${cmd.invoiceNumber || 'the oldest unpaid invoices'}` : 'advance deposit';
    setAnswer(`Confirm: ${amount} ${kind} for ${cmd.clinicHint} via ${cmd.method.toUpperCase()}?`);
    speak(`Confirm: ${amount} ${kind} for ${cmd.clinicHint}.`, {
      rate: userPreferences?.voice_tts_rate, voiceUri: userPreferences?.voice_tts_voice_uri,
      locale: userPreferences?.voice_locale || 'en-PK', allowClinicalDetail: false,
    });
  };

  const submit = async (raw?: string) => {
    const text = (raw ?? query).trim();
    if (!text || busy) return;
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
          setCurrentView, addLab, recordTransactionV2, recordAdvanceDepositV2,
        },
      });
      if (result.navigateTo) {
        setCurrentView(result.navigateTo);
      }
      if (result.pendingWrite) {
        queueWrite(result.pendingWrite, text);
        setBusy(false);
        return;
      }
      setAnswer(result.text);
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
      <button
        type="button"
        aria-label={locked ? 'Voice assistant locked' : 'Toggle voice assistant (Ctrl+Shift+V)'}
        aria-expanded={open}
        aria-disabled={locked}
        title={locked ? 'Module locked' : 'Voice assistant (Ctrl+Shift+V)'}
        onClick={toggle}
        className={`pointer-events-auto ds-tap flex h-11 w-11 items-center justify-center rounded-full border shadow-lg transition-colors ${
          locked ? 'cursor-not-allowed border-slate-300 bg-slate-100 text-slate-400' : 'cursor-pointer border-indigo-200 bg-white text-indigo-600 hover:bg-indigo-50'
        }`}
      >
        {locked ? <Lock className="h-4 w-4" /> : <Mic className="h-5 w-5" />}
      </button>

      {open && (
        <div className="pointer-events-auto w-80 rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Voice Assistant</span>
            <button type="button" onClick={close} aria-label="Close voice assistant" className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="h-4 w-4" /></button>
          </div>
          <div className="mt-3 min-h-[64px] whitespace-pre-wrap rounded-xl border border-slate-100 bg-slate-50 p-2.5 text-xs text-slate-700" role="status" aria-live="polite">
            {busy ? 'Thinking…' : answer || 'Ask a clinic balance, statement, ledger, outstanding or advance wallet — or say “Record payment of PKR 5,000 for Mir Dental”.'}
          </div>

          {pending && (
            <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
              <div className="flex items-center gap-1.5 font-bold"><CheckCircle2 className="h-4 w-4" /> Confirm the action below</div>
              <p className="mt-1.5">{answer}</p>
              <div className="mt-2 flex gap-2">
                <button type="button" onClick={confirmPending} className="flex-1 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-700">Confirm & post</button>
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
