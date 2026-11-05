// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

/**
 * A module password can cover only some views, so the gate must decide per
 * view. The risky case is the Reports group, where the shell reuses the same
 * gate component as the active tab changes: an unprotected tab must never leave
 * an "open" state behind that the next, protected tab inherits.
 */
const { security } = vi.hoisted(() => ({
  security: {
    lock: { enabled: true, views: ['print-invoices'] as string[] },
    unlocked: false,
    password: 'billing-secret',
  },
}));

vi.mock('../../src/context/AppContext', () => ({
  useApp: () => ({
    user: { name: 'Super Admin' },
    brandingSettings: { lab_name: 'Test Lab' },
    setCurrentView: () => {},
  }),
}));

vi.mock('../../src/db/repos', () => ({
  auditRepo: { log: vi.fn() },
}));

vi.mock('../../src/services/moduleSecurity', () => ({
  isViewProtected: (_module: string, view: string) =>
    security.lock.enabled && security.lock.views.includes(view),
  isModuleUnlocked: () => security.unlocked,
  unlockModule: () => {
    security.unlocked = true;
  },
  verifyModulePassword: async (_module: string, password: string) =>
    password === security.password,
  moduleDefinition: () => ({
    id: 'billing',
    label: 'Billing & Invoices',
    description: 'Invoices, payments and statement printing.',
    views: ['billing', 'print-invoices'],
  }),
}));

import { ModuleAccessGate } from '../../src/components/common/ModuleAccessGate';

const content = <div>Invoice content</div>;

beforeEach(() => {
  security.lock = { enabled: true, views: ['print-invoices'] };
  security.unlocked = false;
});

afterEach(() => {
  cleanup();
});

describe('ModuleAccessGate view coverage', () => {
  it('renders an uncovered view without asking for the module password', () => {
    render(
      <ModuleAccessGate module="billing" view="billing">
        {content}
      </ModuleAccessGate>,
    );

    expect(screen.getByText('Invoice content')).toBeTruthy();
    expect(screen.queryByLabelText('Module password')).toBeNull();
  });

  it('asks for the password on a covered view', () => {
    render(
      <ModuleAccessGate module="billing" view="print-invoices">
        {content}
      </ModuleAccessGate>,
    );

    expect(screen.queryByText('Invoice content')).toBeNull();
    expect(screen.getByLabelText('Module password')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Print Invoices' })).toBeTruthy();
  });

  it('does not carry an uncovered tab open state into a protected tab', () => {
    const { rerender } = render(
      <ModuleAccessGate module="billing" view="billing">
        {content}
      </ModuleAccessGate>,
    );
    expect(screen.getByText('Invoice content')).toBeTruthy();

    // Same mounted component, new view: this is the Reports-group tab switch.
    rerender(
      <ModuleAccessGate module="billing" view="print-invoices">
        {content}
      </ModuleAccessGate>,
    );

    expect(screen.queryByText('Invoice content')).toBeNull();
    expect(screen.getByLabelText('Module password')).toBeTruthy();
  });

  it('keeps one unlock across the covered views of the same module', async () => {
    security.lock.views = ['billing', 'print-invoices'];
    const { rerender } = render(
      <ModuleAccessGate module="billing" view="print-invoices">
        {content}
      </ModuleAccessGate>,
    );

    fireEvent.change(screen.getByLabelText('Module password'), {
      target: { value: 'billing-secret' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Unlock this view/i }));

    await screen.findByText('Invoice content');

    rerender(
      <ModuleAccessGate module="billing" view="billing">
        {content}
      </ModuleAccessGate>,
    );
    expect(screen.queryByLabelText('Module password')).toBeNull();
    expect(screen.getByText('Invoice content')).toBeTruthy();
  });
});
