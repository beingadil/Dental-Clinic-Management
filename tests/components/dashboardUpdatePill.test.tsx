// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';

const runAutoUpdate = vi.fn();
const applyStagedUpdate = vi.fn();
const listeners: ((p: unknown) => void)[] = [];

vi.mock('../../src/services/updateInstaller', () => ({
  runAutoUpdate: () => runAutoUpdate(),
  applyStagedUpdate: () => applyStagedUpdate(),
  isAutoUpdateBusy: (p: { state: string }) =>
    ['checking', 'downloading', 'verifying', 'backing_up', 'applying'].includes(p.state),
  onAutoUpdatePhase: (l: (p: unknown) => void) => {
    listeners.push(l);
    l({ state: 'idle' });
    return () => {};
  },
}));

import { UpdatePill } from '../../src/components/dashboard/UpdatePill';

/** Drives the pill into a phase, the way the real installer store would. */
const setPhase = (phase: unknown) =>
  act(() => {
    listeners.forEach((l) => l(phase));
  });

afterEach(() => {
  cleanup();
  listeners.length = 0;
  runAutoUpdate.mockClear();
  applyStagedUpdate.mockClear();
});

describe('dashboard UpdatePill', () => {
  it('says nothing when there is nothing to report', () => {
    render(<UpdatePill />);
    expect(screen.queryByRole('status')).toBeNull();

    setPhase({ state: 'checking' });
    expect(screen.queryByRole('status')).toBeNull();

    setPhase({ state: 'up_to_date' });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('offers Install once a version is available', () => {
    render(<UpdatePill />);
    setPhase({ state: 'available', version: '2.18.0' });

    expect(screen.getByText(/v2\.18\.0 is available/i)).toBeTruthy();
    fireEvent.click(screen.getByText('Install'));
    expect(runAutoUpdate).toHaveBeenCalledTimes(1);
  });

  it('reports download progress with no buttons to click mid-work', () => {
    render(<UpdatePill />);
    setPhase({ state: 'downloading', version: '2.18.0', received: 5242880, total: 10485760 });

    expect(screen.getByText(/Downloading v2\.18\.0 — 50%/)).toBeTruthy();
    expect(screen.queryByText('Install')).toBeNull();
    expect(screen.queryByLabelText('Hide update notice')).toBeNull();
  });

  it('offers Restart & Apply when the installer is staged', () => {
    render(<UpdatePill />);
    setPhase({ state: 'ready_to_apply', version: '2.18.0', bytes: 10485760 });

    expect(screen.getByText(/restart to install it/i)).toBeTruthy();
    fireEvent.click(screen.getByText(/Restart & Apply/));
    expect(applyStagedUpdate).toHaveBeenCalledTimes(1);
    expect(runAutoUpdate).not.toHaveBeenCalled();
  });

  it('shows the reason and a retry when the install fails', () => {
    render(<UpdatePill />);
    setPhase({ state: 'failed', message: 'Checksum mismatch — download again.' });

    expect(screen.getByText('Checksum mismatch — download again.')).toBeTruthy();
    fireEvent.click(screen.getByText('Try again'));
    expect(runAutoUpdate).toHaveBeenCalledTimes(1);
  });

  it('can be hidden, and comes back for the next phase', () => {
    render(<UpdatePill />);
    setPhase({ state: 'available', version: '2.18.0' });

    fireEvent.click(screen.getByLabelText('Hide update notice'));
    expect(screen.queryByRole('status')).toBeNull();

    // A new phase re-shows it — the user dismissed the old news, not the next.
    setPhase({ state: 'ready_to_apply', version: '2.18.0', bytes: 1 });
    expect(screen.getByRole('status')).toBeTruthy();
  });
});