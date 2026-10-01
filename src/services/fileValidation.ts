/**
 * Client-side file validation for uploads persisted into SQLite (as base64
 * inside the synced row). A multi-MB proof must never reach the engine: it
 * bloats every subsequent snapshot AND every .dentalbackup export.
 */
export interface FileValidationOptions {
  /** Maximum accepted size in megabytes. */
  maxMB: number;
  /** Accepted MIME prefixes/types, e.g. ['image/', 'application/pdf']. */
  mimeAllow: string[];
}

export interface FileValidationResult {
  ok: boolean;
  error?: string;
}

export function validateFile(file: { size: number; type?: string; name?: string }, options: FileValidationOptions): FileValidationResult {
  if (file.size > options.maxMB * 1024 * 1024) {
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    return { ok: false, error: `"${file.name || 'File'}" is ${mb} MB — the limit is ${options.maxMB} MB. Compress or crop the proof first.` };
  }
  const type = (file.type || '').toLowerCase();
  const allowed = options.mimeAllow.some((a) => (a.endsWith('/') ? type.startsWith(a) : type === a));
  if (type && !allowed) {
    return { ok: false, error: `"${file.name || 'File'}" is type ${type} — only images and PDFs are accepted.` };
  }
  return { ok: true };
}
