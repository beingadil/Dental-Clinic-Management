import { sha256Hex } from '../db/crypto';

/**
 * Local attachment storage service (Phase 5).
 *
 * Browser mode: validated data URLs stored in SQLite (`attachments.data_url`,
 * `payment_attachments.file_url`), with per-attachment checksums. Quota-safe
 * limits are enforced BEFORE storage so a 20 MB file can't silently break
 * persistence the way the legacy base64-in-JSON flow could.
 *
 * Desktop/Tauri mode (Phase 12): the same validation writes files to the app
 * data dir and stores only the path — `storage_path` is already in the schema.
 */

export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024; // 8 MB per file
export const MAX_TOTAL_PER_ENTITY = 32 * 1024 * 1024; // 32 MB per case/payment

export const ALLOWED_MIME = [
  'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/heic',
  'application/pdf',
  'model/stl', 'model/obj', 'application/sla', 'application/octet-stream', // CAD scans often arrive as octet-stream
  'application/dicom',
  'text/plain',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

export interface ValidatedAttachment {
  filename: string;
  file_type: string;
  size_bytes: number;
  size_label: string;
  data_url: string;
  checksum: string;
  storage_path: string;
}

export class AttachmentError extends Error {
  constructor(message: string, public readonly code: 'TYPE' | 'SIZE' | 'READ' | 'TOTAL') {
    super(message);
    this.name = 'AttachmentError';
  }
}

function extensionAllowlisted(name: string, mime: string): boolean {
  const ext = (name.split('.').pop() || '').toLowerCase();
  const okExt = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'heic', 'pdf', 'stl', 'obj', 'ply', 'dcm', 'dicom', 'txt', 'doc', 'docx', 'sla'];
  if (ALLOWED_MIME.includes(mime)) return true;
  // octet-stream + known dental extension is acceptable (STL/DICOM frequently arrive this way)
  return mime === 'application/octet-stream' && okExt.includes(ext);
}

function sanitizeFilename(name: string): string {
  // strip path components & control characters (path-traversal defense)
  return (name.split(/[\\/]/).pop() || 'file').replace(/[\u0000-\u001f<>:"|?*]/g, '_').slice(0, 180);
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function dataUrlBytes(dataUrl: string): number {
  const base64 = dataUrl.split(',')[1] || '';
  return Math.floor((base64.length * 3) / 4);
}

/**
 * Validates a browser File and converts it to a stored attachment.
 * Throws AttachmentError with a user-safe message on any violation.
 */
export async function processFile(file: File, entityType: string, entityId: string): Promise<ValidatedAttachment> {
  const filename = sanitizeFilename(file.name || 'file');
  const mime = file.type || 'application/octet-stream';

  if (!extensionAllowlisted(filename, mime)) {
    throw new AttachmentError(`"${filename}" has an unsupported file type`, 'TYPE');
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new AttachmentError(`"${filename}" exceeds the ${formatBytes(MAX_ATTACHMENT_BYTES)} per-file limit`, 'SIZE');
  }

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new AttachmentError(`Could not read "${filename}"`, 'READ'));
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsDataURL(file);
  });

  const actualBytes = dataUrlBytes(dataUrl);
  if (actualBytes > MAX_ATTACHMENT_BYTES) {
    throw new AttachmentError(`"${filename}" exceeds the ${formatBytes(MAX_ATTACHMENT_BYTES)} per-file limit`, 'SIZE');
  }

  // decode for checksum (base64 → bytes)
  const base64 = dataUrl.split(',')[1] || '';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const checksum = await sha256Hex(bytes);

  const day = new Date().toISOString().slice(0, 10);
  return {
    filename,
    file_type: mime,
    size_bytes: actualBytes,
    size_label: formatBytes(actualBytes),
    data_url: dataUrl,
    checksum,
    storage_path: `attachments/${entityType}/${entityId}/${day}/${filename}`,
  };
}

/** Enforce per-entity total budget before accepting a batch of files. */
export function assertTotalWithinBudget(existingTotalBytes: number, incoming: { size_bytes: number }[]): void {
  const total = incoming.reduce((s, a) => s + a.size_bytes, 0);
  if (existingTotalBytes + total > MAX_TOTAL_PER_ENTITY) {
    throw new AttachmentError(
      `Attachment storage limit (${formatBytes(MAX_TOTAL_PER_ENTITY)}) reached for this record`,
      'TOTAL'
    );
  }
}
