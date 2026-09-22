import { useEffect, useState } from 'react';
import { Download, X, ArrowRight } from 'lucide-react';
import {
  checkForUpdates,
  downloadUpdate,
  UpdateStatus,
} from '../../services/updateService';

/**
 * In-app auto-update banner (Phase 9 hardening).
 *
 * - On app start (and at most hourly afterwards) the app silently checks the
 *   GitHub Pages update manifest. On an offline machine this fails silently —
 *   the offline `.dentalupdate` import in Settings remains the update path.
 * - When a newer release exists, a dismissible banner offers a one-click
 *   download of the branded installer, which opens in the system browser
 *   (via the Tauri `open_external` command on desktop).
 */
export function UpdateBanner() {
  const [status, setStatus] = useState<UpdateStatus>({ state: 'idle' });
  const [dismissed, setDismissed] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const CHECK_INTERVAL_MS = 60 * 60 * 1000; // re-check hourly
    let timer: number | undefined;

    const check = async () => {
      const result = await checkForUpdates();
      if (!cancelled) setStatus(result);
    };

    check();
    timer = window.setInterval(check, CHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
    };
  }, []);

  if (status.state !== 'available' || dismissed) return null;

  const handleDownload = async () => {
    setDownloading(true);
    const result = await downloadUpdate(status.download_url);
    setDownloading(false);
    if (result.ok) setDismissed(true); // browser handles the download from here
  };

  return (
    <div className="bg-gradient-to-r from-indigo-600 via-indigo-600 to-blue-600 text-white">
      <div className="w-full max-w-[1880px] 2xl:max-w-[2100px] mx-auto px-4 py-2 flex flex-col sm:flex-row sm:items-center gap-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <ArrowRight className="w-4 h-4 shrink-0" />
          <p className="text-xs font-bold truncate">
            Dental Solutions v{status.version} is available
          </p>
          {status.released_at && (
            <span className="hidden md:inline text-[10px] text-indigo-100 truncate">
              released {new Date(status.released_at).toLocaleDateString()}
            </span>
          )}
          {status.notes && (
            <span className="hidden lg:inline text-[10px] text-indigo-100 truncate">
              — {status.notes}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleDownload}
            disabled={downloading}
            className="px-3 py-1.5 bg-white text-indigo-700 hover:bg-indigo-50 disabled:opacity-70 text-[11px] font-black rounded-lg cursor-pointer flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5" />
            {downloading ? 'Opening download…' : 'Download Installer'}
          </button>
          <button
            onClick={() => setDismissed(true)}
            title="Dismiss until next check"
            className="p-1.5 hover:bg-white/15 rounded-lg cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
