/**
 * Codec for `audit_events.old_state` / `new_state`.
 *
 * These are JSON text columns written from two places (repos.log for direct
 * audit calls, syncCore for the write-through collection sync) and read back
 * from one (auditRepo.all / forEntity). The bug this module exists to prevent:
 * the write side used an unconditional `JSON.stringify`, so a value that had
 * already been encoded once got encoded again on the next hydrate→sync cycle.
 * Backslash count roughly doubles per cycle, so the column grew exponentially
 * until `JSON.stringify` threw "Invalid string length" — a RangeError that
 * aborted the entire snapshot transaction, so a handful of audit rows stopped
 * every table in the database from persisting.
 *
 * Deliberately dependency-free: `repos.ts` imports `./index` (which pulls in
 * seeds, persistence and legacy migration), and syncCore needs these two
 * functions without inheriting that. No imports keeps the encode/decode pair
 * the one place both write paths agree on.
 */

/**
 * Largest `old_state` / `new_state` value we will persist, in encoded bytes.
 *
 * These columns are re-encoded on every hydrate→sync cycle, so an oversized
 * value is not a one-time cost — it is a permanently inflated row that every
 * future save must read, rewrite and serialize again. 64 KB keeps a
 * legitimate settings snapshot comfortably inside it while making a runaway
 * blob impossible to store.
 */
const AUDIT_STATE_MAX_BYTES = 64 * 1024;

/**
 * Encode a state value for its column.
 *
 * Idempotent: a caller that already holds encoded text gets it back unchanged
 * instead of a second layer of escaping. Oversized values are truncated and
 * flagged rather than written whole.
 */
export function encodeAuditState(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const encoded = typeof value === 'string' ? value : JSON.stringify(value);
  if (encoded === undefined) return null;
  if (encoded.length <= AUDIT_STATE_MAX_BYTES) return encoded;
  return JSON.stringify({
    _truncated: true,
    _originalBytes: encoded.length,
    preview: encoded.slice(0, AUDIT_STATE_MAX_BYTES / 2),
  });
}

/**
 * Decode a state column back to its original value.
 *
 * Peels the layers left by the pre-fix double encoding, so an existing
 * database shrinks to the value it always meant instead of carrying the growth
 * forward forever. Non-JSON text is returned unchanged.
 */
export function decodeAuditState(text: string | null | undefined): unknown {
  if (text === null || text === undefined || text === '') return undefined;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return text;
  }
  // Pre-fix rows are JSON text wrapped in another JSON string. Peel layers
  // until we reach something that is not itself an encoded string.
  while (typeof value === 'string') {
    try {
      const next = JSON.parse(value);
      if (typeof next === 'string') {
        value = next;
        continue;
      }
      return next;
    } catch {
      return value;
    }
  }
  return value;
}