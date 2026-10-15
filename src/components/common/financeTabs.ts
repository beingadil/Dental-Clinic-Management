/**
 * Finance tab ownership — the one place the finance tab strips are declared.
 *
 * Why this is a module and not two inline arrays: the read-only money tabs
 * (Clinic Accounts, General Ledger, Audit Trail) were migrated out of Billing
 * into Analytics & Reports and then came back — a second tab strip claiming the
 * same three ids and rendering the same three surfaces. Nothing failed, because
 * a duplicated tab is not a type error, not a test failure and not a warning;
 * it is just a surface that quietly exists twice and drifts.
 *
 * So the declarations were pulled up here, and the mistake is now loud in two
 * independent ways:
 *
 *   1. Each view's ids are a hand-written union (`BillingTab`, `ReportsTab`) and
 *      its array is typed with that union. Adding an id the view may not own is
 *      a COMPILE error — e.g. `{ id: 'clinic_accounts', … }` in BILLING_TABS
 *      does not build.
 *   2. `OWNERSHIP_IS_DISJOINT` is a type-level assertion that the unions do not
 *      overlap, so no id can be claimed by both views even if both unions are
 *      edited at once.
 *
 *   Together with the coverage assertions in tests/components/financeTabOwnership.test.ts,
 *   a view's union and its array are pinned to exactly the same set: the array
 *   may not carry an id the union forbids (`satisfies` above), and the union may
 *   not permit an id the array never declares (the `Exclude` assertions in the
 *   guard). A union member that nothing renders — a tab you can never reach —
 *   therefore cannot be introduced quietly.
 *
 * The unions are written out by hand on purpose. Deriving them from the arrays
 * (`typeof BILLING_TABS[number]['id']`) would make adding an id to an array
 * always legal, which is the opposite of the guarantee wanted here.
 */
import {
  BookOpen,
  FileSpreadsheet,
  FileText,
} from 'lucide-react';
import type { TabItem } from './ui';

/**
 * Money in: the operational register.
 *
 * One tab. There used to be two — Invoices & Receivables, and Payments &
 * Transactions — and the second was removed because a solo operator running a
 * month-end statement does not think "now I am on the payments tab"; they think
 * "what does this clinic owe me, and what have they paid". Both answers live on
 * one surface now: the invoice table above, the payment register below.
 *
 * The union is written out by hand and pinned against the array by
 * tests/components/financeTabOwnership.test.ts, so an id the array does not
 * declare cannot be added back quietly.
 */
export type BillingTab = 'invoices';

/** Money out, looked back on: business intelligence and the read-only books. */
/**
 * The read-only books that remain.
 *
 * Overview, Clinic Accounts and Audit Trail were removed by the operator. The
 * union narrows with the array, and tests/components/financeTabOwnership.test.ts
 * pins the two together, so neither can be half-updated - which is exactly what
 * caught this removal on its first attempt.
 *
 * The audit trail is not lost data: audit events are still recorded and still
 * reachable through the journal inspector. It is no longer a separate screen.
 */
export type ReportsTab = 'general_ledger' | 'statements';

/**
 * `as const` is load-bearing, not cosmetic.
 *
 * It keeps each entry's `id` as its LITERAL type, which is what lets the guard
 * in the test file prove the union and the array are exactly the same set. With
 * a plain `TabItem<BillingTab>[]` annotation the element ids widen to the union
 * itself, so "does the array declare every id the union permits" becomes
 * circular and can never fail. `satisfies` (rather than a plain annotation) is
 * what keeps the reverse direction checked: an id that is not in the union is
 * still a compile error.
 */
export const BILLING_TABS = [
  { id: 'invoices', label: 'Invoices & Receivables', icon: FileText },
] as const satisfies readonly TabItem<BillingTab>[];

export const REPORTS_TABS = [
  { id: 'general_ledger', label: 'General Ledger', icon: BookOpen },
  { id: 'statements', label: 'Reports & Statements', icon: FileSpreadsheet },
] as const satisfies readonly TabItem<ReportsTab>[];

export type FinanceViewName = 'BillingView' | 'ReportsView';

/**
 * The finance surface: which view owns which tabs.
 *
 * Exposed as data so the ownership guard can assert disjointness over the map
 * itself rather than re-parsing two component files.
 */
export const FINANCE_TABS: Record<FinanceViewName, readonly TabItem<string>[]> = {
  BillingView: BILLING_TABS,
  ReportsView: REPORTS_TABS,
};

/**
 * The label a tab declares for its id.
 *
 * Replaces the hand-maintained label maps that used to sit in each view (a
 * ternary in Billing, a `Record` in Reports). Those were a second copy of the
 * tab table and would silently mislabel anything added later; reading from the
 * declaration cannot drift from it.
 */
export const labelOf = <T extends string>(tabs: readonly TabItem<T>[], id: T): string =>
  tabs.find((tab) => tab.id === id)?.label ?? id;

/**
 * Compile-time guard: the two unions must not overlap.
 *
 * `Extract<BillingTab, ReportsTab>` is exactly the set of ids claimed twice. If
 * it is ever non-empty this assignment fails to typecheck, which is what turns
 * "duplicated tab id" into a build error rather than something only a test
 * catches.
 */
const OWNERSHIP_IS_DISJOINT: Extract<BillingTab, ReportsTab> extends never ? true : never = true;
void OWNERSHIP_IS_DISJOINT;
