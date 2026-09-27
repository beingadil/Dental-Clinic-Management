/**
 * Pure policy for the login brute-force backoff (see AppContext.login):
 * 5 consecutive failures within a rolling 60s window lock retries for 30s,
 * doubling per additional failure, capped at 5 minutes. Success or 60s of
 * quiet resets the counter. Kept pure so the policy is unit-testable.
 */
export interface BackoffState {
  count: number;
  lastFail: number;
  until: number; // 0 = not locked
}

const LOCK_THRESHOLD = 5;
const BASE_LOCK_MS = 30_000;
const MAX_LOCK_MS = 300_000;
const DECAY_MS = 60_000;

export function nextBackoff(
  prev: BackoffState,
  nowMs: number,
  success = false,
): BackoffState {
  if (success) return { count: 0, lastFail: 0, until: 0 };
  const decayed = nowMs - prev.lastFail >= DECAY_MS;
  const count = decayed ? 1 : prev.count + 1;
  const until =
    count >= LOCK_THRESHOLD
      ? nowMs + Math.min(BASE_LOCK_MS * 2 ** (count - LOCK_THRESHOLD), MAX_LOCK_MS)
      : 0;
  return { count, lastFail: nowMs, until };
}
