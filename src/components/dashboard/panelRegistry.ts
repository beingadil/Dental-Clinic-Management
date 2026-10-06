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

export const PANEL_KEYS = Object.keys(PANEL_LABELS);