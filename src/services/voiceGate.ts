/**
 * Reachability probe for Groq. The assistant is online-only: any HTTP response
 * (even 401 — means the host is reachable) counts as online; network error counts as offline.
 * Cached briefly so the UI doesn't hammer the network on every keystroke.
 */
const PROBE_URL = 'https://api.groq.com/openai/v1/models';
const CACHE_MS = 8000;

let cached: { at: number; ok: boolean } | null = null;

export const probeGroq = async (): Promise<boolean> => {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_MS) return cached.ok;
  try {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      cached = { at: now, ok: false };
      return false;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    const res = await fetch(PROBE_URL, { method: 'GET', signal: controller.signal });
    clearTimeout(timer);
    // Any HTTP answer (200, 401, 403, even 404) proves the network is up.
    cached = { at: now, ok: res.status < 500 };
    return cached.ok;
  } catch {
    cached = { at: now, ok: false };
    return false;
  }
};

export const _resetProbeCacheForTests = (): void => { cached = null; };
