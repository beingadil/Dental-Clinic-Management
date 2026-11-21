import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { probeGroq, _resetProbeCacheForTests } from '../../src/services/voiceGate';

describe('voice online gate', () => {
  beforeEach(() => _resetProbeCacheForTests());

  afterEach(() => {
    vi.unstubAllGlobals();
    _resetProbeCacheForTests();
  });

  it('treats ANY HTTP response (200, 401, even 404) as reachable', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ status: 401 });
    vi.stubGlobal('fetch', mockFetch);
    expect(await probeGroq()).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('treats a network error as offline', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ENOTFOUND')));
    expect(await probeGroq()).toBe(false);
  });

  it('caches the probe briefly instead of re-hitting the network', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ status: 200 });
    vi.stubGlobal('fetch', mockFetch);
    expect(await probeGroq()).toBe(true);
    expect(await probeGroq()).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
