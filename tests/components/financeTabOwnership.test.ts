/**
 * Finance tab ownership guard.
 *
 * The bug this prevents: the read-only money tabs — Clinic Accounts, General
 * Ledger, Audit Trail — were migrated out of Billing into Analytics & Reports
 * and then came back. They reappeared in the Billing tab strip while the
 * Analytics copies were still there, so two views claimed the same three tab
 * ids and rendered the same three surfaces. Nothing failed: two tab strips
 * showing the same ledger is not a type error, not a test failure and not a
 * warning — it is just a surface that exists twice and drifts.
 *
 * The declarations now live in one module (src/components/common/financeTabs.ts)
 * and the mistake is caught at two different times:
 *
 *   BEFORE THE BUILD — the `@ts-expect-error` block below is a real compile-time
 *   regression test. Each directive only compiles while the id genuinely sits
 *   outside that view's union, so widening `BillingTab` to re-admit a read-only
 *   tab makes the directive unused and `tsc --noEmit` (part of `npm run lint`)
 *   fails. That is the check that runs in CI before anything is deployed.
 *
 *   IN THE SUITE — the assertions below walk the ownership map for shared ids,
 *   a second owner for a migrated tab, a stray declaration elsewhere in src/,
 *   and a tab that has no render branch (or a branch with no tab).
 *
 * The map is asserted from the imported declarations rather than by re-parsing
 * component source, so this file no longer keeps a second copy of the tab table
 * that could itself drift.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BILLING_TABS, FINANCE_TABS, REPORTS_TABS } from '../../src/components/common/financeTabs';
import type { BillingTab, ReportsTab } from '../../src/components/common/financeTabs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), 'utf8');

/** Workspace-relative path with forward slashes, for readable failure text. */
const relPath = (absolute: string) =>
  absolute
    .slice(ROOT.length)
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');

/** The module that owns the declarations. */
const SHARED = ['src', 'components', 'common', 'financeTabs.ts'];

/** Where each view keeps its tab strip and its render branches. */
const VIEW_FILES: Record<string, string[]> = {
  BillingView: ['src', 'components', 'billing', 'BillingView.tsx'],
  ReportsView: ['src', 'components', 'reports', 'ReportsView.tsx'],
};

/** The tabs that were migrated out of Billing. Each must have exactly one home. */
const MIGRATED = ['clinic_accounts', 'general_ledger', 'audit_log'];

/** Every .ts/.tsx under src, so a stray declaration is caught wherever it lands. */
function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sourceFiles(path, acc);
    else if (/\.tsx?$/.test(entry)) acc.push(path);
  }
  return acc;
}

// ── Compile-time half ────────────────────────────────────────────────────────
//
// These are values, not assertions, because the guarantee is about what COMPILES.
// A `@ts-expect-error` fails the build when the error it expects stops occurring,
// which is exactly the regression we want to catch: re-admitting a read-only tab
// to Billing. Keep them next to the suite so `npm run lint` covers it.

// @ts-expect-error Clinic Accounts belongs to Reports, not Billing
const billingCannotOwnClinicAccounts: BillingTab = 'clinic_accounts';
// @ts-expect-error General Ledger belongs to Reports, not Billing
const billingCannotOwnGeneralLedger: BillingTab = 'general_ledger';
// @ts-expect-error The Audit Trail belongs to Reports, not Billing
const billingCannotOwnAuditLog: BillingTab = 'audit_log';
// @ts-expect-error Invoices belong to Billing, not Reports
const reportsCannotOwnInvoices: ReportsTab = 'invoices';

void [billingCannotOwnClinicAccounts, billingCannotOwnGeneralLedger, billingCannotOwnAuditLog, reportsCannotOwnInvoices];

// ── Union/array fidelity ─────────────────────────────────────────────────────
//
// The declarations live in the shared module; these two assertions pin the
// union and its array to the SAME set, from both sides:
//
//   array ⊆ union — `satisfies readonly TabItem<…>[]` on the declaration, so an
//                   id the view may not own does not compile.
//   union ⊆ array — the `Exclude` assertions here, so a union member the array
//                   never declares does not compile either.
//
// The second direction is the one nothing else covers: a permitted-but-never-
// declared id typechecks happily, gives `activeTab` a state the strip cannot
// select, and leaves a render branch that can never be reached. `Exclude`
// yields exactly those orphans, and resolves to `never` — so the line stops
// compiling — the moment one exists.
//
// The assertions are `never`-typed declarations rather than test bodies because
// the property being checked is a compile-time one; there is nothing to observe
// at runtime. This is also why they sit here and not in the module:
// OWNERSHIP_IS_DISJOINT guards the module's own internal consistency, while
// these guard the fidelity of the model this suite describes.

type BillingDeclaredIds = (typeof BILLING_TABS)[number]['id'];
type ReportsDeclaredIds = (typeof REPORTS_TABS)[number]['id'];

/**
 * Every id `BillingTab` permits, minus every id BILLING_TABS declares.
 *
 * `never` while the two agree, which is why the line compiles today. The first
 * permitted id that no entry declares makes the type `never`, and `true` is not
 * assignable to it — so this declaration is the assertion.
 */
const EVERY_BILLING_ID_IS_DECLARED: Exclude<BillingTab, BillingDeclaredIds> extends never
  ? true
  : never = true;

/** Every id `ReportsTab` permits, minus every id REPORTS_TABS declares. */
const EVERY_REPORTS_ID_IS_DECLARED: Exclude<ReportsTab, ReportsDeclaredIds> extends never
  ? true
  : never = true;

void [EVERY_BILLING_ID_IS_DECLARED, EVERY_REPORTS_ID_IS_DECLARED];

// ── Suite ────────────────────────────────────────────────────────────────────

describe('finance tab ownership', () => {
  it('pins the finance surface to the tabs each view is supposed to own', () => {
    const expected: Record<string, string[]> = {
      BillingView: ['invoices', 'transactions'],
      ReportsView: ['overview', 'clinic_accounts', 'general_ledger', 'audit_log', 'statements'],
    };

    const findings: string[] = [];
    for (const [view, ids] of Object.entries(expected)) {
      const declared = (FINANCE_TABS[view as keyof typeof FINANCE_TABS] ?? []).map((t) => t.id);
      if (declared.slice().sort().join(',') !== ids.slice().sort().join(',')) {
        findings.push(`${view} declares [${declared.join(', ')}] but owns [${ids.join(', ')}]`);
      }
    }
    expect(findings, `The finance surface changed:\n  ${findings.join('\n  ')}`).toEqual([]);
  });

  it('never lets two views claim the same tab id', () => {
    const owners = new Map<string, string[]>();
    for (const [view, tabs] of Object.entries(FINANCE_TABS)) {
      for (const tab of tabs) owners.set(tab.id, [...(owners.get(tab.id) ?? []), view]);
    }

    const shared = [...owners]
      .filter(([, views]) => views.length > 1)
      .map(([id, views]) => `tab '${id}' is claimed by ${views.join(' and ')}`);

    expect(shared, `Shared tab ids:\n  ${shared.join('\n  ')}`).toEqual([]);
  });

  it('gives each migrated read-only tab exactly one owner', () => {
    const findings: string[] = [];
    for (const id of MIGRATED) {
      const owners = Object.entries(FINANCE_TABS)
        .filter(([, tabs]) => tabs.some((tab) => tab.id === id))
        .map(([view]) => view);

      if (owners.join(',') !== 'ReportsView') {
        findings.push(
          `'${id}' is owned by [${owners.join(', ') || 'no view'}] but must be owned only by ReportsView`,
        );
      }
    }
    expect(findings, `Migrated tabs regrew a second owner:\n  ${findings.join('\n  ')}`).toEqual([]);
  });

  it('declares the migrated tabs in no other file in the tree', () => {
    // The map only governs views that are in it. Someone bypassing it with a
    // local `tabs={[…]}` would be invisible to the checks above, so the ids are
    // also swept across every source file.
    const allowed = new Set(
      [SHARED, VIEW_FILES.ReportsView].map((parts) => relPath(join(ROOT, ...parts))),
    );

    const findings: string[] = [];
    const files = sourceFiles(join(ROOT, 'src'));

    for (const id of MIGRATED) {
      const stray = files
        .filter((file) => readFileSync(file, 'utf8').includes(id))
        .map(relPath)
        .filter((rel) => !allowed.has(rel));

      if (stray.length) {
        findings.push(`'${id}' is declared outside its home in [${stray.join(', ')}]`);
      }
    }
    expect(findings, `Migrated tabs leaked into other files:\n  ${findings.join('\n  ')}`).toEqual(
      [],
    );
  });

  it('renders a body for every tab it declares, and no body for anything else', () => {
    // Catches the leftover half of an incomplete migration: a render block for a
    // tab that is no longer in the strip (dead code that still ships), or a tab
    // in the strip that switches to nothing (a blank panel).
    const findings: string[] = [];
    for (const [view, tabs] of Object.entries(FINANCE_TABS)) {
      const file = VIEW_FILES[view];
      expect(file, `${view} has no source file registered in this test`).toBeDefined();

      const declared = tabs.map((tab) => tab.id).sort().join(',');
      const rendered = [
        ...new Set(
          [...read(...file).matchAll(/activeTab === '([^']+)'/g)].map((m) => m[1]),
        ),
      ]
        .sort()
        .join(',');

      if (declared !== rendered) {
        findings.push(`${view} declares [${declared}] but renders [${rendered}]`);
      }
    }
    expect(findings, `Tab/branch mismatch:\n  ${findings.join('\n  ')}`).toEqual([]);
  });
});
