/**
 * Pure policy for the login brute-force backoff (see AppContext.login):
 * 5 consecutive failures within a rolling 60s window lock retries for 30s,
 * doubling per additional failure, capped at 5 minutes. Success or 60s of
 * quiet resets the counter. Kept pure so the policy is unit-testable.
 */
/**
 * THE PASSWORD RULE, in one place.
 *
 * It was implemented three times with two different answers: creating a user
 * and first-run admin setup both demanded 8 characters, while an admin resetting
 * someone else's password and a user changing their own both accepted any
 * non-empty string. So the strictest path in the app was *creating* an account —
 * an admin could provision a user with a solid password and then, through the
 * reset dialog, replace it with `a`.
 *
 * Lives beside the backoff policy rather than in the component because three
 * different forms have to agree on it and none of them should be the one that
 * decides.
 */
export const MIN_PASSWORD_LENGTH = 8;

export const passwordProblem = (password: string | undefined | null): string | null => {
  if (!password) return 'A password is required';
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `A password of at least ${MIN_PASSWORD_LENGTH} characters is required`;
  }
  return null;
};

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
