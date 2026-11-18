import React, { useEffect, useMemo, useState } from 'react';
import { Mic, Lock, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { moduleForView, isViewProtected, isModuleUnlocked } from '../../services/moduleSecurity';
import { isSpeechSynthesisAvailable, speak, cancelSpeech } from '../../services/voiceUtterance';

type ShellStatus = 'idle' | 'listening' | 'thinking' | 'needs-clarification' | 'locked' | 'error' | 'done';

/**
 * Phase 1 voice shell: push-to-talk affordance + spoken output only.
 * No speech recognition, no intents, no network — by design.
 */
export const VoiceShell: React.FC = () => {
  const { user, currentView, userPreferences } = useApp();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<ShellStatus>('idle');
  const [message, setMessage] = useState<string>('');

  const voiceEnabled = !!userPreferences?.voice_enabled;
  const locked = useMemo(() => {
    const id = moduleForView(currentView);
    if (!id) return false;
    return isViewProtected(id, currentView) && !isModuleUnlocked(id);
  }, [currentView]);

  const close = () => {
    setOpen(false);
    setStatus('idle');
    cancelSpeech();
  };

  const toggle = () => {
    if (locked) {
      setStatus('locked');
      setMessage('This module is locked. Unlock it to use the assistant.');
      return;
    }
    setOpen((v) => {
      const next = !v;
      if (next) setStatus('idle');
      else setStatus('idle');
      return next;
    });
  };

  const testVoice = () => {
    const spoken = speak(
      'Voice assistant ready. Dental Solutions.',
      {
        rate: userPreferences?.voice_tts_rate,
        voiceUri: userPreferences?.voice_tts_voice_uri,
        locale: userPreferences?.voice_locale || 'en-PK',
        allowClinicalDetail: false,
      },
    );
    setStatus(spoken ? 'done' : 'error');
    setMessage(
      spoken
        ? 'Voice output is ready.'
        : 'Voice output is not available on this device. You can still use the visual assistant.',
    );
  };

  useEffect(() => {
    if (!voiceEnabled || !user) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyV') {
        e.preventDefault();
        toggle();
      }
      if (e.key === 'Escape' && open) close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [voiceEnabled, user, open, locked]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!voiceEnabled) cancelSpeech();
  }, [voiceEnabled]);

  if (!voiceEnabled || !user) return null;

  return (
    <aside
      aria-label="Voice assistant"
      className="no-print pointer-events-none fixed bottom-24 right-4 sm:right-6 z-[90] flex flex-col items-end gap-2"
    >
      {/* Inert shell while disabled/locked; never intercepts clicks. */}
      <button
        type="button"
        aria-label={locked ? 'Voice assistant locked' : 'Toggle voice assistant'}
        aria-expanded={open}
        aria-disabled={locked}
        title={locked ? 'Module locked — unlock it to use the assistant' : 'Voice assistant (Ctrl+Shift+V)'}
        onClick={toggle}
        className={`pointer-events-auto ds-tap flex h-11 w-11 items-center justify-center rounded-full border shadow-lg transition-colors ${
          locked
            ? 'cursor-not-allowed border-slate-300 bg-slate-100 text-slate-400'
            : 'cursor-pointer border-indigo-200 bg-white text-indigo-600 hover:bg-indigo-50'
        }`}
      >
        {locked ? <Lock className="h-4 w-4" /> : <Mic className="h-5 w-5" />}
      </button>

      {open && (
        <div className="pointer-events-auto w-72 rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Voice Assistant</span>
            <button
              type="button"
              onClick={close}
              aria-label="Close voice assistant"
              className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-2 text-xs text-slate-600" role="status" aria-live="polite">
            {locked
              ? 'This module is locked.'
              : status === 'error'
                ? 'Voice output is not available on this device.'
                : message || 'Ready. Press Ctrl+Shift+V to toggle. (Voice input arrives in a later phase.)'}
          </p>
          {!locked && (
            <button
              type="button"
              onClick={testVoice}
              className="mt-3 w-full rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
            >
              Test voice output
            </button>
          )}
          {!isSpeechSynthesisAvailable() && (
            <p className="mt-2 text-[10px] font-semibold text-amber-700">
              No speech synthesizer on this device.
            </p>
          )}
        </div>
      )}
    </aside>
  );
};

/** FAB-only; retained for the future push-to-talk mic affordance. */
export const VoiceButton: React.FC = VoiceShell;
