import {
  BarChart3,
  Bell,
  BookOpen,
  Building2,
  FolderKanban,
  LayoutDashboard,
  Receipt,
  type LucideIcon,
} from 'lucide-react';
import type { LockableModuleId } from '../../services/moduleSecurity';
import { REPORTS_TABS } from './financeTabs';

/**
 * One icon per lockable module. Kept in the UI layer instead of the service so
 * the security registry stays free of React component values.
 */
export const MODULE_ICONS: Record<LockableModuleId, LucideIcon> = {
  dashboard: LayoutDashboard,
  cases: FolderKanban,
  labs: Building2,
  billing: Receipt,
  catalog: BookOpen,
  reports: BarChart3,
  notifications: Bell,
};

/** Human labels for the view ids a module covers, for the settings detail. */
export const VIEW_LABELS: Record<string, string> = {
  ...(Object.fromEntries(REPORTS_TABS.map((tab) => [tab.id, tab.label])) as Record<
    string,
    string
  >),
  dashboard: 'Dashboard',
  cases: 'Dental Workstation',
  labs: 'Dental Clinics',
  billing: 'Payment Receive',
  'print-invoices': 'Print Invoices',
  catalog: 'Price List & Catalog',
  reports: 'Reports overview',
  analytics: 'Analytics entry',
  notifications: 'System Inbox',
  settings: 'System Settings',
};
