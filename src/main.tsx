import React, { useEffect, useState } from 'react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import { initializeDatabase } from './db';
import { flushNow } from './db/persistence';

// sql.js WASM is vendored into public/vendor/ and served as a static asset.
// (The bundler `?url` import rewrote inconsistently between dev/preview, which
// produced 404 → HTML fallback → 'expected magic word 00 61 73 6d' crashes.)
const WASM_URL = '/vendor/sql-wasm.wasm';

// Global uncaught error & promise rejection safety guards
if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (event) => snapshotSafe(event));
  window.addEventListener('error', (event) => snapshotSafe(event));
}

function snapshotSafe(event: any): void {
  try {
    void flushNow();
  } catch { /* best effort */ }
  // Preserve original AI Studio-era behavior: log, don't crash the SPA shell.
  console.warn('Global error captured:', event?.message || event?.reason);
  if (event?.preventDefault) event.preventDefault?.();
}

const Boot: React.FC = () => {
  const [status, setStatus] = useState<'booting' | 'ready' | 'failed'>('booting');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    initializeDatabase({
      locateFile: () => WASM_URL,
    })
      .then(() => {
        if (!cancelled) setStatus('ready');
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error('[db] boot failed', err);
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setStatus('failed');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (status === 'booting') {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-slate-50 gap-4">
        <div className="w-10 h-10 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
        <div className="text-slate-600 font-medium">Initializing local database…</div>
        <div className="text-slate-400 text-sm">All data stays on this computer</div>
      </div>
    );
  }

  if (status === 'failed') {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-slate-50 gap-3 px-6 text-center">
        <div className="text-rose-600 font-semibold text-lg">Database failed to initialize</div>
        <div className="text-slate-600 text-sm max-w-md font-mono break-words">{error}</div>
        <button
          className="mt-3 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700"
          onClick={() => window.location.reload()}
        >
          Retry
        </button>
      </div>
    );
  }

  return <App />;
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Boot />
  </StrictMode>,
);
