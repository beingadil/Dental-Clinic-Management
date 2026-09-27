import { describe, it, expect } from 'vitest';
import { nextBackoff } from '../../src/context/hooks/loginBackoff';

describe('login backoff policy', () => {
  it('does not lock before 5 consecutive failures', () => {
    let s = { count: 0, lastFail: 0, until: 0 };
    for (let i = 0; i < 4; i++) s = nextBackoff(s, 1000 + i);
    expect(s.count).toBe(4);
    expect(s.until).toBe(0);
  });

  it('locks for 30s on the 5th failure and doubles after', () => {
    let s = { count: 4, lastFail: 0, until: 0 };
    s = nextBackoff(s, 5000);
    expect(s.until).toBe(5000 + 30_000);
    s = nextBackoff(s, 5000 + 5_000); // still within the 60s decay window
    expect(s.until).toBe(10_000 + 60_000); // 6th failure → 60s lock
  });

  it('caps the wait at 5 minutes', () => {
    let s = { count: 500, lastFail: Date.now(), until: 0 };
    const t = Date.now();
    s = nextBackoff(s, t);
    expect(s.until - t).toBeLessThanOrEqual(300_000);
  });

  it('decays after 60s of quiet and resets on success', () => {
    let s = nextBackoff({ count: 6, lastFail: 0, until: 0 }, 10_000);
    expect(s.count).toBe(7);
    s = nextBackoff(s, 10_000 + 61_000); // quiet long enough → restart count
    expect(s.count).toBe(1);
    expect(s.until).toBe(0);
    s = nextBackoff({ count: 9, lastFail: Date.now(), until: 123 }, 456, true);
    expect(s.count).toBe(0);
  });
});
