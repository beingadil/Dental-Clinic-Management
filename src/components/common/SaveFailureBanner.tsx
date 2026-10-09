import { useEffect, useState } from 'react';
import { HardDriveDownload } from 'lucide-react';
import { getLastSaveError } from '../../db/persistence';

/**
 * Persistent banner when the database could NOT be written to storage.
 *
 * The failure mode this closes (audit D6) is the worst kind for a clinic: the
 * autosave fails (disk full, permissions, browser-storage quota), a
 * console.error is written, and the app carries on looking perfectly healthy
 * while the newest invoices, payments and case notes exist only in memory.
 * Closing the window then discards them with no warning to anyone.
 *
 * The banner stays up until a save actually succeeds, and points at the one
 * action that genuinely protects the work — exporting a .dentalbackup.
 */
export function SaveFailureBanner() {
  const [error, setError] = useState<string | null>(() => getLastSaveError());

  useEffect(() => {
    // Fires on both success and failure — a later successful save must clear it.
    const onSaveStatus = () => setError(getLastSaveError());
    window.addEventListener('db:save-status', onSaveStatus);
    return () => window.removeEventListener('db:save-status', onSaveStatus);
  }, []);

  if (!error) return null;

  return (
    <div className="flex items-start gap-3 bg-fill-warning text-white px-4 py-2.5 text-xs font-bold shadow-lg">
      <HardDriveDownload className="w-4 h-4 shrink-0 mt-0.5" />
      <div className="min-w-0">
        <p>
          Changes are not being written to disk — the database could not be saved.
          Export a .dentalbackup from Settings &gt; Database &amp; Backup now to protect this work.
        </p>
        <p className="font-mono font-normal opacity-90 truncate" title={error}>{error}</p>
      </div>
    </div>
  );
}
