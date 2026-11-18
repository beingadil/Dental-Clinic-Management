import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Mic, Lock, X, SendHorizonal, AudioLines } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { moduleForView, isViewProtected, isModuleUnlocked } from '../../services/moduleSecurity';
import { speak, cancelSpeech } from '../../services/voiceUtterance';
import { askAssistant } from '../../services/voiceAssistant';
import { groqEnabled } from '../../services/voiceGroq';

type ShellStatus = 'idle' | 'listening' | 'thinking' | 'needs-clarification' | 'locked' | 'error' | 'done';
type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
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

/** Voice assistant: push-to-talk + offline answers. Speech STT feature-detected. */
export const VoiceShell: React.FC = () => {
  const { user, currentView, userPreferences, labs, invoices, advancePayments, accountAdjustments } = useApp();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<ShellStatus>('idle');
  const [query, setQuery] = useState('');
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);

  const voiceEnabled = !!userPreferences?.voice_enabled;
  const locked = useMemo(() => {
    const id = moduleForView(currentView);
    if (!id) return false;
    return isViewProtected(id, currentView) && !isModuleUnlocked(id);
  }, [currentView]);

  const close = () => { setOpen(false); setStatus('idle'); cancelSpeech(); recRef.current?.stop(); };
  const toggle = () => {
    if (locked) { setStatus('locked'); setAnswer('This module is locked.'); return; }
    setOpen((v) => { const next = !v; if (next) setStatus('idle'); return next; });
  };

  const submit = async (raw?: string) => {
    const text = (raw ?? query).trim();
    if (!text || busy) return;
    setBusy(true);
    setStatus('thinking');
    setAnswer('');
    try {
      const result = await askAssistant(text, {
        labs: labs || [],
        invoices: invoices || [],
        advancePayments: advancePayments || [],
        accountAdjustments: accountAdjustments || [],
        user,
      });
      setAnswer(result.text);
      setStatus('done');
      speak(result.text, {
        rate: userPreferences?.voice_tts_rate,
        voiceUri: userPreferences?.voice_tts_voice_uri,
        locale: userPreferences?.voice_locale || 'en-PK',
        allowClinicalDetail: !!userPreferences?.voice_read_clinical_detail,
      });
    } catch {
      setStatus('error');
      setAnswer('Something went wrong answering that. Check Settings and retry.');
    } finally {
      setBusy(false);
      setQuery('');
    }
  };

  const listen = () => {
    if (locked || busy) return;
    const rec = getRecognition();
    if (!rec) {
      setStatus('error');
      setAnswer('Speech recognition is not available in this runtime. Type the question instead.');
      return;
    }
    recRef.current?.stop();
    recRef.current = rec;
    setStatus('listening');
    rec.onresult = (e) => {
      const transcript = Array.from(e.results).map((r) => r[0]?.transcript || '').join(' ').trim();
      if (transcript) { setQuery(transcript); void submit(transcript); }
    };
    rec.onerror = () => { setStatus('error'); setAnswer('Could not hear you. Try again or type the question.'); };
    rec.onend = () => { if (status === 'listening') setStatus('idle'); };
    try { rec.start(); setTimeout(() => rec.stop(), 8000); } catch { setStatus('error'); }
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
          <div className="mt-3 rounded-xl border border-slate-100 bg-slate-50 p-2.5 text-xs text-slate-700 min-h-[64px] whitespace-pre-wrap" role="status" aria-live="polite">
            {busy ? 'Thinking…' : answer || 'Ask a clinic balance, statement, ledger, outstanding or advance wallet. Try “Mir Dental balance”.'}
          </div>
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
            <button type="button" onClick={listen} aria-label="Listen" title="Listen" className="ds-tap rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-100">
              <AudioLines className="h-4 w-4" />
            </button>
            <button type="submit" disabled={busy} aria-label="Ask" className="ds-tap rounded-lg bg-indigo-600 p-2 text-white hover:bg-indigo-700 disabled:opacity-50"><SendHorizonal className="h-4 w-4" /></button>
          </form>
          <p className="mt-2 text-[10px] text-slate-400">{groqEnabled() ? 'Groq routing enabled (opt-in).' : 'Offline answers. Add a Groq key in the docs or settings to enable routing.'}</p>
        </div>
      )}
    </aside>
  );
};
