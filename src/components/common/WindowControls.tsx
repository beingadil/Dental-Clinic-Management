import { useEffect, useState } from 'react';
import { Minus, Square, Copy, X } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isDesktop } from '../../db/persistence';

/**
 * Native-feeling window controls for the desktop build — minimize,
 * maximize/restore and close, driven through the Tauri window API so the
 * user can size the app however they like (the OS window keeps its native
 * frame; these are convenience shortcuts always in reach in the header).
 *
 * Renders nothing on the web build.
 */

let cachedIsDesktop: boolean | null = null;

export function WindowControls() {
  const [show, setShow] = useState(false);
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (cachedIsDesktop === null) cachedIsDesktop = isDesktop();
      if (!cachedIsDesktop) return;
      try {
        const win = getCurrentWindow();
        const isMax = await win.isMaximized();
        if (mounted) {
          setMaximized(isMax);
          setShow(true);
        }
        const un1 = win.onResized(async () => {
          try { if (mounted) setMaximized(await win.isMaximized()); } catch { /* closing */ }
        });
        return () => un1.then((f) => f());
      } catch { /* not a Tauri context */ }
    })();
    return () => { mounted = false; };
  }, []);

  if (!show) return null;

  const minimize = () => { void getCurrentWindow().minimize(); };
  const toggleMaximize = () => { void getCurrentWindow().toggleMaximize(); };
  const close = () => { void getCurrentWindow().close(); };

  const btn =
    'w-9 h-9 flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 active:scale-95 transition-colors cursor-pointer';

  return (
    <div className="flex items-center gap-0.5 shrink-0" data-tauri-drag-region-exempt>
      <button type="button" onClick={minimize} className={btn} title="Minimize" aria-label="Minimize window">
        <Minus className="w-4 h-4" />
      </button>
      <button type="button" onClick={toggleMaximize} className={btn}
        title={maximized ? 'Restore window size' : 'Maximize window'}
        aria-label={maximized ? 'Restore window' : 'Maximize window'}>
        {maximized ? <Copy className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
      </button>
      <button
        type="button"
        onClick={close}
        className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-500 hover:text-white hover:bg-rose-600 active:scale-95 transition-colors cursor-pointer"
        title="Close window"
        aria-label="Close window"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
