/**
 * The dashboard panel registry.
 *
 * One list, three consumers: the panel content map, the hidden-panel recovery
 * list in the layout bar, and the preference filter. Lives in its own module so
 * the dashboard and the Settings layout card validate against the SAME key
 * list — a layout saved from Settings used to be filtered by a different set
 * of keys than the one the dashboard rendered, so panels could silently drop
 * out of a saved arrangement.
 */
export const PANEL_LABELS: Record<string, string> = {
  workflow: 'Production Workflow',
  attention: 'Needs Attention',
  schedule: "Today's Schedule",
  revenue: 'Revenue & Collections',
  atRisk: 'Cases At Risk',
  activity: 'Recent Activity',
  quickActions: 'Quick Actions',
  workload: 'Bench Workload',
  performance: 'Lab Performance',
  upcoming: 'Upcoming Deliveries',
};

/**
 * Panel keys. This list is a SUPERSET by contract: a saved layout in
 * `user_preferences` names these keys, so dropping one silently drops a
 * reader's arrangement. Adding keys is safe; removing them is not.
 */
export const PANEL_KEYS = Object.keys(PANEL_LABELS);

/**
 * How much visual weight a panel carries.
 *
 * WHY THIS EXISTS — ten panels with the same border, radius, header size and
 * shadow give the eye no entry point: the page reads as a framework demo rather
 * than an instrument. Rank is the fix, and it is deliberately the ONLY thing
 * that changes: nothing here touches layout keys, order, spans or hidden state,
 * so a layout saved before this existed still loads byte-identically (see
 * tests/dashboard/dashboardLayout.test.ts).
 *
 * - `lead`      sits directly on the canvas, full width, no card at all. The
 *               page's structural axis. Only `workflow` qualifies: it answers
 *               "where is the work", which is the question the whole board
 *               hangs off.
 * - `primary`   the working set — a real card, the thing you read every
 *               morning.
 * - `reference` borderless and hairline-ruled: looked up, not read. This is
 *               where roughly 40% of the page's chrome stops existing without
 *               a single fact going away.
 */
export type PanelRank = 'lead' | 'primary' | 'reference';

/**
 * Rank per panel key. Anything unlisted defaults to `primary`, so a panel added
 * later is a card until someone decides otherwise — the safe default, since a
 * mistyped key can then never make a panel vanish into a hairline.
 */
export const PANEL_RANK: Record<string, PanelRank> = {
  workflow: 'lead',
  attention: 'primary',
  schedule: 'primary',
  revenue: 'primary',
  atRisk: 'primary',
  activity: 'reference',
  quickActions: 'reference',
  workload: 'reference',
  performance: 'reference',
  upcoming: 'reference',
};

/** Rank for a panel key, defaulting to `primary` for unknown keys. */
export const rankOf = (key: string): PanelRank => PANEL_RANK[key] ?? 'primary';
