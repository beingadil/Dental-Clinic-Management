/**
 * SLA turnarounds are global, operator-configurable settings — not frozen code.
 *
 * They used to be a hardcoded const, so the turnaround a clinic quoted could not
 * be changed without editing and rebuilding the app. Every case, the delivery
 * date the wizard auto-computes, and the analytics turnaround report all read
 * the one map.
 *
 * These pin the two things that made this a real change rather than a UI swap:
 *
 *  1. `PRIORITY_SLA_DAYS` was a FROZEN object. Any importer captured the values
 *     at module-load time and kept them after a save, so a live edit would have
 *     updated the form and nothing else. It is a live proxy now.
 *  2. A bad persisted entry must fall back PER LEVEL. Discarding the whole map
 *     on one malformed key would reset the other three turnarounds to defaults
 *     and silently change the promise on cases already in flight.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const store = new Map<string, unknown>();
let getCalls: string[] = [];

/** settingsRepo.get() returns the ALREADY-PARSED value — mirroring it matters. */
const settingsRepo = {
  get: (namespace: string, key: string) => {
    getCalls.push(`${namespace}.${key}`);
    return store.get(`${namespace}.${key}`);
  },
  set: (namespace: string, key: string, value: unknown) => {
    store.set(`${namespace}.${key}`, value);
  },
};

vi.mock('../../src/db/repos', () => ({ settingsRepo }));

const importFresh = async () => {
  vi.resetModules();
  return import('../../src/services/prioritySla');
};

beforeEach(() => {
  store.clear();
  getCalls = [];
});

describe('SLA settings — global, persisted, live', () => {
  it('defaults to the shipped turnarounds on a fresh install', async () => {
    const { PRIORITY_SLA_DAYS, loadSlaSettings } = await importFresh();
    expect(loadSlaSettings()).toEqual({ urgent: 1, high: 2, normal: 4, low: 7 });
    expect(PRIORITY_SLA_DAYS.normal).toBe(4);
    // Read from the `sla` namespace so a clinic's values cannot collide with the
    // `print` namespace that shares the same settings table.
    expect(getCalls.some((c) => c.startsWith('sla.'))).toBe(true);
  });

  it('applies a saved change to every reader, not just the editor', async () => {
    const sla = await importFresh();

    sla.saveSlaSettings({ urgent: 1, high: 2, normal: 12, low: 21 });

    // The frozen-const regression: these used to keep their module-load values.
    expect(sla.PRIORITY_SLA_DAYS.normal).toBe(12);
    expect(sla.PRIORITY_SLA_DAYS.low).toBe(21);
    expect(sla.prioritySlaLabel('normal')).toBe('Medium — 12 days');
    expect(sla.prioritySlaLabel('urgent')).toBe('Urgent — 1 day');

    // And it survives a reload, so it is a real setting and not local state.
    const reloaded = await importFresh();
    expect(reloaded.PRIORITY_SLA_DAYS.normal).toBe(12);
  });

  it('drives the delivery date the wizard auto-computes', async () => {
    const sla = await importFresh();
    sla.saveSlaSettings({ urgent: 1, high: 2, normal: 10, low: 30 });

    // A case picked at "Medium" is now promised 10 days out, not 4.
    const from = new Date(2026, 9, 12);
    expect(sla.computeSlaDueDate('normal', from)).toBe('2026-10-22');
    expect(sla.computeSlaDueDate('low', from)).toBe('2026-11-11');
  });

  it('falls back per level when one saved entry is out of range', async () => {
    store.set('sla.days', { urgent: 9999, high: 2, normal: 'nonsense', low: 0 });
    const { PRIORITY_SLA_DAYS, loadSlaSettings } = await importFresh();

    // A 9999-day promise and a non-numeric value are both rejected...
    expect(PRIORITY_SLA_DAYS.urgent).toBe(1);
    expect(PRIORITY_SLA_DAYS.normal).toBe(4);
    // ...while the two valid entries still take effect. Discarding the whole map
    // here would have reset low/normal to defaults and changed cases in flight.
    expect(PRIORITY_SLA_DAYS.high).toBe(2);
    expect(loadSlaSettings().low).toBe(0);
  });

  it('drops a dead key instead of carrying it through a round-trip', async () => {
    store.set('sla.days', { normal: 5, express: 3 });
    const { loadSlaSettings } = await importFresh();
    expect(Object.keys(loadSlaSettings()).sort()).toEqual(['high', 'low', 'normal', 'urgent']);
  });

  it('survives a corrupt or double-encoded row without throwing', async () => {
    store.set('sla.days', 'not json at all');
    const { loadSlaSettings } = await importFresh();
    expect(loadSlaSettings()).toEqual({ urgent: 1, high: 2, normal: 4, low: 7 });

    // A row written by the old double-encoding bug still needs one parse.
    store.set('sla.days', JSON.stringify({ normal: 6 }));
    const again = await importFresh();
    expect(again.loadSlaSettings().normal).toBe(6);
  });

  it('saving one priority leaves the other three untouched', async () => {
    const sla = await importFresh();
    sla.saveSlaSettings({ urgent: 1, high: 2, normal: 4, low: 7 });
    sla.saveSlaSettings({ urgent: 1, high: 2, normal: 4, low: 14 });

    expect(sla.PRIORITY_SLA_DAYS.low).toBe(14);
    expect(sla.PRIORITY_SLA_DAYS.normal).toBe(4);
    expect(sla.PRIORITY_SLA_DAYS.urgent).toBe(1);
  });
});