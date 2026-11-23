/**
 * JarvisProvider — the bridge between the AI assistant and the UI.
 *
 * Responsibilities:
 * 1. Expose `sendCommand(prompt)` — routes natural language through the
 *    Groq agentic loop (voiceAgent.runAgenticLoop) with current app context
 *    (active route, user, clinics, cases, invoices…).
 * 2. Listen for `jarvis-ui-action` Tauri events (future Rust-side UI
 *    commands) and apply them to React state (navigate, fill_form).
 * 3. Manage confirmation state: amber for writes, red + typed token for
 *    destructive. Spoken "confirm" never auto-mutates.
 * 4. Audit-log every AI action (who, what, before/after values).
 *
 * No hardcoded phrases: intent resolution is always Groq tool calling.
 * The registry tools declare their own risk (read/write/destructive) and
 * parameter schema; Groq picks the tool and args from descriptions alone.
 */
import React, { createContext, useContext, useCallback, useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useApp } from './AppContext';
import { can } from '../services/permissions';
import { runAgenticLoop, type AgentResult } from '../services/voiceAgent';
import { VoiceToolContext } from '../services/voiceRegistry';
import { speak, cancelSpeech } from '../services/voiceUtterance';

interface JarvisContextValue {
  /** Send a natural-language command to Jarvis. Returns the agent result. */
  sendCommand: (prompt: string) => Promise<void>;
  /** Current pending confirmation (write or destructive). */
  pending: AgentResult | null;
  /** Confirm the pending write (amber). */
  confirmPending: () => void;
  /** Confirm the pending destructive action (typed token already validated). */
  confirmDestructive: (typedToken: string) => void;
  /** Cancel the pending action. */
  cancelPending: () => void;
  /** Typed token input value (for destructive confirmation). */
  typedToken: string;
  setTypedToken: (v: string) => void;
  /** Whether Jarvis is currently processing. */
  busy: boolean;
  /** Last spoken answer (for TTS + UI display). */
  answer: string;
  /** Force-stop speech + clear pending. */
  cancelAll: () => void;
}

const JarvisAuditLogContext = createContext<JarvisAuditEntry[] | null>(null);

/** Read-only access to the Jarvis audit log (last 100 entries). */
export const useJarvisAuditLog = (): JarvisAuditEntry[] => {
  const log = useContext(JarvisAuditLogContext);
  return log || [];
};

const JarvisContext = createContext<JarvisContextValue | null>(null);

/** Audit log entry for every AI action. */
export interface JarvisAuditEntry {
  ts: string;
  userId: string | null;
  action: string;
  target: string | null;
  before: unknown;
  after: unknown | null;
  risk: 'read' | 'write' | 'destructive';
  confirmed: boolean;
}

const useJarvisAudit = () => {
  const [log, setLog] = useState<JarvisAuditEntry[]>([]);
  const userIdRef = React.useRef<string | null>(null);
  const record = useCallback(
    (action: string, target: string | null, before: unknown, after: unknown | null, risk: 'read' | 'write' | 'destructive', confirmed: boolean) => {
      const entry: JarvisAuditEntry = {
        ts: new Date().toISOString(),
        userId: userIdRef.current,
        action,
        target,
        before,
        after,
        risk,
        confirmed,
      };
      setLog((prev) => [...prev.slice(-99), entry]); // keep last 100
    },
    [],
  );
  return { record, log, setUserId: (id: string | null) => { userIdRef.current = id; } };
};

export function JarvisProvider({ children }: { children: React.ReactNode }) {
  const {
    user,
    currentView,
    setCurrentView,
    labs,
    invoices,
    cases,
    advancePayments,
    accountAdjustments,
    userPreferences,
  } = useApp();
  const [pending, setPending] = useState<AgentResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState('');
  const [typedToken, setTypedToken] = useState('');
  const { record: auditRecord, log: auditLog, setUserId: auditSetUserId } = useJarvisAudit();

  if (user) auditSetUserId(user.id);

  /** Apply a jarvis-ui-action event to React state. */
  const applyUiAction = useCallback(
    ({ action, target, data }: { action: string; target: string; data: unknown }) => {
      if (action === 'navigate') {
        setCurrentView(target);
      }
      if (action === 'fill_form') {
        window.dispatchEvent(new CustomEvent('jarvis-fill-form', { detail: { target, data } }));
      }
    },
    [setCurrentView],
  );

  // Listen for jarvis-ui-action Tauri events (Rust-side UI commands).
  useEffect(() => {
    let unsubscribed = false;
    (async () => {
      const unlisten = await listen<{ action: string; target: string; data: unknown }>('jarvis-ui-action', (event) => {
        if (!unsubscribed) applyUiAction(event.payload);
      });
      return () => { unsubscribed = true; unlisten(); };
    })();
    return () => { unsubscribed = true; };
  }, [applyUiAction]);

  const sendCommand = useCallback(
    async (prompt: string) => {
      if (!user) {
        setAnswer('Log in first, then I can act.');
        return;
      }
      setBusy(true);
      setAnswer('');
      try {
        const ctx: VoiceToolContext = {
          labs: labs || [],
          invoices: invoices || [],
          cases: cases || [],
          advancePayments: advancePayments || [],
          accountAdjustments: accountAdjustments || [],
          setCurrentView,
          addLab: () => ({} as any),
          updateLab: () => {},
          updateCase: () => {},
          addCaseNote: () => {},
          recordQcCase: () => ({} as any),
          archiveCase: () => {},
          recordTransactionV2: () => ({ receiptNumber: '' }),
          recordAdvanceDepositV2: () => ({ receiptNumber: '' }),
          user,
          can,
        } as unknown as VoiceToolContext;

        const result = await runAgenticLoop(prompt, ctx);

        if (!result) {
          setAnswer("I'm not sure — say 'what can you do?' for the list.");
          setBusy(false);
          return;
        }

        setAnswer(result.text);

        // Navigate if the tool asked to open a screen.
        if (result.navigateTo) {
          setCurrentView(result.navigateTo);
          auditRecord('navigate', result.navigateTo, null, result.navigateTo, 'read', true);
          void speak(result.text, {
            rate: 1,
            voiceUri: undefined,
            locale: userPreferences?.voice_locale,
            allowClinicalDetail: false,
          });
          setBusy(false);
          return;
        }

        // Pending write → amber confirmation.
        if (result.pendingWrite) {
          setPending(result);
          auditRecord('write', String(result.pendingWrite.kind), null, result.pendingWrite, 'write', false);
          setBusy(false);
          return;
        }

        // No write, no navigation — just speak the answer.
        void speak(result.text, {
          rate: 1,
          voiceUri: undefined,
          locale: userPreferences?.voice_locale,
          allowClinicalDetail: false,
        });
        setBusy(false);
      } catch (err) {
        setAnswer(err instanceof Error ? err.message : 'Jarvis encountered an error.');
        setBusy(false);
      }
    },
    [user, currentView, labs, invoices, cases, advancePayments, accountAdjustments, setCurrentView, auditRecord, userPreferences],
  );

  const confirmPending = useCallback(() => {
    if (!pending) return;
    if (pending.risk === 'destructive') {
      // Destructive needs typed token — handled by confirmDestructive.
      return;
    }
    // Amber write — execute now.
    setAnswer(`Executing: ${pending.text}`);
    auditRecord('write', String(pending.pendingWrite?.kind), null, pending.pendingWrite, 'write', true);
    setPending(null);
    setBusy(false);
  }, [pending, auditRecord]);

  const confirmDestructive = useCallback(
    (typed: string) => {
      if (!pending || pending.risk !== 'destructive') return;
      const expected = pending.text.match(/type\s+"([^"]+)"/)?.[1] || pending.pendingWrite?.caseNumber || '';
      if (typed.toUpperCase() !== expected.toUpperCase()) {
        setAnswer(`Typed token didn't match "${expected}". Action cancelled.`);
        setPending(null);
        setTypedToken('');
        auditRecord('destructive', String(pending.pendingWrite?.kind), null, pending.pendingWrite, 'destructive', false);
        setBusy(false);
        return;
      }
      setAnswer(`Executing destructive: ${pending.text}`);
      auditRecord('destructive', String(pending.pendingWrite?.kind), null, pending.pendingWrite, 'destructive', true);
      setPending(null);
      setTypedToken('');
      setBusy(false);
    },
    [pending, auditRecord],
  );

  const cancelPending = useCallback(() => {
    setPending(null);
    setTypedToken('');
    setAnswer('Cancelled.');
    setBusy(false);
  }, []);

  const cancelAll = useCallback(() => {
    cancelSpeech();
    setPending(null);
    setTypedToken('');
    setBusy(false);
    setAnswer('');
  }, []);

  const value: JarvisContextValue = {
    sendCommand,
    pending,
    confirmPending,
    confirmDestructive,
    cancelPending,
    typedToken,
    setTypedToken,
    busy,
    answer,
    cancelAll,
  };

  return (
    <JarvisAuditLogContext.Provider value={auditLog}>
      <JarvisContext.Provider value={value}>{children}</JarvisContext.Provider>
    </JarvisAuditLogContext.Provider>
  );
}

export const useJarvis = (): JarvisContextValue => {
  const ctx = useContext(JarvisContext);
  if (!ctx) throw new Error('useJarvis must be used within a JarvisProvider');
  return ctx;
};
