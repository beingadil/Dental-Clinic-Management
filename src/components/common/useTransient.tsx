/**
 * Transient UI state — the "Saved!" banner, and the 21 timers behind it.
 *
 * THE PATTERN THIS REPLACES
 * Sixteen files each declared a boolean, set it true after a save, and cleared
 * it with their own `setTimeout`:
 *
 *     const [savedSuccess, setSavedSuccess] = useState(false);
 *     save(); setSavedSuccess(true); setTimeout(() => setSavedSuccess(false), 4000);
 *
 * Then each hand-wrote the same green banner to render it. Two problems that
 * only a shared primitive can fix:
 *
 *   1. The timers were never cleared. A component that unmounts inside those
 *      four seconds left a live timer holding a closure over a `setState` for a
 *      component that no longer exists — and in one case a second save within
 *      the window stacked timers, so the banner cleared early, mid-sequence.
 *   2. The banner itself was rewritten per file, which is how `BulkPrintModal`
 *      ended up with a `const [, setSavedSuccess]` whose value was deliberately
 *      thrown away (see the note there) — a dead write kept alive by copy-paste.
 *
 * `useTransient` owns the timer and clears it on unmount and on re-trigger, so a
 * repeated save extends the window instead of racing it.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, AlertCircle } from 'lucide-react';

export type TransientMessage = { type: 'success' | 'error'; text: string };

/**
 * A value that resets itself after `ms`.
 *
 * `true` is the common case (a boolean "saved" flag), so `useTransientFlag` is
 * the shape most call sites want; `useTransientMessage` carries a text banner.
 */
export function useTransientFlag(ms = 4000): [boolean, () => void, () => void] {
  const [on, setOn] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  // Unmount cleanup: the whole point. A bare setTimeout in an effect-free
  // component body outlives the component.
  useEffect(() => clearTimer, [clearTimer]);

  const trigger = useCallback(() => {
    clearTimer();
    setOn(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      setOn(false);
    }, ms);
  }, [clearTimer, ms]);

  return [on, trigger, () => setOn(false)];
}

/**
 * Type first, then the message — the same order every existing call site used
 * when it called `setUserMsg({ type, text })` / `setSavedNote({ type, text })`.
 * Keeping that order means adopting the hook is a rename, not a rewrite of every
 * call.
 */
export function useTransientMessage(ms = 4000) {
  const [message, setMessage] = useState<TransientMessage | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => clearTimer, [clearTimer]);

  /* `durationMs` overrides the component default for one call. Needed by
     BackupTab, which flashes a 6s "export in progress" and a 5s "export failed"
     from the same component — two genuinely different urgencies, so two
     different dwell times. Without the override the shorter would be cut short
     or the longer padded. */
  const flash = useCallback(
    (type: TransientMessage['type'] = 'success', text: string, durationMs?: number) => {
      clearTimer();
      setMessage({ type, text });
      timer.current = setTimeout(() => {
        timer.current = null;
        setMessage(null);
      }, durationMs ?? ms);
    },
    [clearTimer, ms],
  );

  return [message, flash, () => setMessage(null)] as const;
}

/**
 * The banner itself, so sixteen files stop drawing it.
 *
 * Deliberately plain: a line of ink and an icon. The old per-file versions grew
 * shadows, rounded containers and colour-per-file, which is why they drifted.
 */
export const TransientBanner: React.FC<{ message: TransientMessage | null; className?: string }> = ({
  message,
  className = '',
}) => {
  if (!message) return null;
  const failed = message.type === 'error';
  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 text-xs font-semibold ${
        failed ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'
      } ${className}`}
    >
      {failed ? (
        <AlertCircle className="w-4 h-4 shrink-0" />
      ) : (
        <CheckCircle2 className="w-4 h-4 shrink-0" />
      )}
      <span>{message.text}</span>
    </div>
  );
};
