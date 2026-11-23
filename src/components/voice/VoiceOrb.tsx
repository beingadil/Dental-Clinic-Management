import React from 'react';
import { Mic, Lock } from 'lucide-react';

export type VoiceOrbState = 'idle' | 'listening' | 'thinking' | 'locked' | 'always_on';

/**
 * Speaking/listening orb for the assistant. Inline keyframes so the shell stays
 * self-contained (Tailwind has no slow-spin keyframe wired for custom widths).
 */
export const VoiceOrb: React.FC<{ state: VoiceOrbState; locked?: boolean; onClick: () => void }> = ({ state, locked, onClick }) => {
  const palette =
    state === 'always_on'
      ? ['#22c55e', '#34d399', '#bbf7d0']
      : state === 'listening'
        ? ['#6366f1', '#818cf8', '#c7d2fe']
        : state === 'thinking'
          ? ['#f59e0b', '#fcd34d', '#fef3c7']
          : ['#334155', '#94a3b8', '#e2e8f0'];
  return (
    <button
      type="button"
      aria-label={locked ? 'Voice assistant locked' : state === 'listening' ? 'Stop listening' : state === 'always_on' ? 'Jarvis — listening (always on)' : 'Toggle voice assistant (Ctrl+Shift+V)'}
      aria-pressed={state === 'listening'}
      aria-description={state === 'always_on' ? 'Mic is always listening while this orb is open' : undefined}
      aria-disabled={locked}
      title={locked ? 'Module locked' : state === 'listening' ? 'Listening — press again to stop' : state === 'always_on' ? 'Jarvis — listening (always on). Click to open.' : 'Voice assistant (Ctrl+Shift+V)'}
      onClick={onClick}
      className="pointer-events-auto relative flex h-12 w-12 select-none items-center justify-center rounded-full cursor-pointer"
      style={{ background: `radial-gradient(circle at 35% 35%, ${palette[1]}, ${palette[0]})` }}
    >
      <style>{`
        @keyframes voice-ring { 0% { transform: scale(0.9); opacity: 0.8; } 100% { transform: scale(1.9); opacity: 0; } }
        @keyframes voice-ring-soft { 0% { transform: scale(0.95); opacity: 0.5; } 50% { transform: scale(1.35); opacity: 0.9; } 100% { transform: scale(0.95); opacity: 0.5; } }
        @keyframes voice-breathe { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.12); } }
        @keyframes voice-spin { to { transform: rotate(360deg); } }
      `}</style>

      {(state === 'listening' || state === 'always_on') && !locked && (
        <>
          <span aria-hidden className="absolute inline-flex h-full w-full rounded-full" style={{ animation: state === 'always_on' ? 'voice-ring-soft 2.4s ease-out infinite' : 'voice-ring 1.6s ease-out infinite', border: '2px solid #22c55e' }} />
          <span aria-hidden className="absolute inline-flex h-full w-full rounded-full" style={{ animation: state === 'always_on' ? 'voice-ring-soft 2.4s ease-out infinite 0.6s' : 'voice-ring 1.6s ease-out infinite 0.5s', border: '2px solid #4ade80' }} />
        </>
      )}

      <span className="relative flex h-9 w-9 items-center justify-center rounded-full bg-slate-900/80 text-white" style={{ animation: 'voice-breathe 3s ease-in-out infinite' }}>
        {locked ? <Lock className="h-4 w-4" /> : <Mic className="h-5 w-5" />}
      </span>
      {state === 'thinking' && !locked && (
        <span aria-hidden className="pointer-events-none absolute -bottom-1 h-2 w-2 rounded-full bg-amber-300" style={{ animation: 'voice-spin 1s linear infinite' }} />
      )}
    </button>
  );
};
