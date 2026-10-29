/**
 * Sidebar.
 *
 * THE REDESIGN, IN ONE PARAGRAPH
 * This rail used to be the odd one out. The dashboard had been converted to the
 * `ds-*` semantic tokens while this file — and `Header.tsx` beside it — still
 * spoke raw Tailwind palette classes. So the navigation painted its canvas from
 * `--ds-surface`, the header bar directly beside it from `bg-white/95`, and the
 * app canvas under both from `bg-slate-50`: three near-identical darks in dark
 * mode, none of them the same one, meeting at a seam you could see. On top of
 * that the active row carried TWO signals (an accent-soft pill and a 3px
 * accent bar), every count was a circular pill, and the avatar was a circle
 * sitting under a square brand mark.
 *
 * Everything below now comes from `src/theme/shell.css`, which consumes the
 * SAME `ds-*` tokens the panels do. Repointing one token moves the rail, the
 * header and the dashboard together — which is the entire reason the token
 * layer exists.
 *
 * Two behaviours are unchanged on purpose, because both are load-bearing for
 * small screens and neither was part of the complaint: the collapsed rail and
 * the mobile bottom dock.
 *
 * `lg:static` + `lg:z-auto` on the rail are load-bearing, not cosmetic, and
 * tests/components/sidebarStacking.test.ts asserts them by name. It finds the
 * element by searching for the literal tag and then taking the NEXT className,
 * so that tag must not be spelled out in this file's prose either — a mention
 * of it up here makes the test read the scrim's class list instead and fail on
 * a class the rail genuinely carries.
 */
import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { can, deniedTooltip } from '../../services/permissions';
import { currentVersion } from '../../services/updateService';
import { ConnectivityStatus } from './ConnectivityStatus';
import {
  LayoutDashboard,
  FolderKanban,
  Building2,
  Receipt,
  BarChart3,
  Bell,
  Settings,
  X,
  PanelLeftClose,
  PanelLeftOpen,
  Activity,
  BookOpen,
} from 'lucide-react';

const NAV_ACTION: Record<string, string> = {
  dashboard: 'dashboard:view',
  cases: 'cases:view',
  labs: 'clinics:view',
  billing: 'billing:view',
  catalog: 'catalog:view',
  analytics: 'reports:view',
  notifications: 'notifications:view',
  settings: 'settings:view',
};

export const Sidebar: React.FC = () => {
  const { currentView, setCurrentView, sidebarOpen, setSidebarOpen, unreadCount, overdueCount, invoices, brandingSettings, user } =
    useApp();

  const [isCollapsed, setIsCollapsed] = useState(false);

  const unpaidInvoicesCount = invoices.filter((i) => i.payment_status !== 'paid').length;

  /**
   * `tone` drives the badge colour and is deliberately NOT decorative: a count
   * in amber means cases are running past a promise, a count in rose means money
   * or an escalation is waiting. Neutral is for counts that are simply a number
   * ("2 unpaid invoices") rather than a warning. Previously every badge wore the
   * same neutral pill, so a 7-overdue badge looked exactly like a 3-unpaid one.
   */
  interface NavItem {
    id: string;
    label: string;
    icon: React.FC<{ className?: string }>;
    badge?: string;
    tone?: 'warn' | 'risk' | 'neutral';
  }

  const navGroups: { groupTitle: string; items: NavItem[] }[] = [
    {
      groupTitle: 'Workspace',
      items: [
        { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
        {
          id: 'cases',
          label: 'Dental Workstation',
          icon: FolderKanban,
          badge: overdueCount > 0 ? `${overdueCount}` : undefined,
          tone: 'warn',
        },
      ],
    },
    {
      groupTitle: 'Management',
      items: [
        { id: 'labs', label: 'Dental Clinics', icon: Building2 },
        {
          id: 'billing',
          label: 'Billing & Invoices',
          icon: Receipt,
          badge: unpaidInvoicesCount > 0 ? `${unpaidInvoicesCount}` : undefined,
          tone: 'neutral',
        },
        { id: 'catalog', label: 'Price List & Catalog', icon: BookOpen },
      ],
    },
    {
      groupTitle: 'Insights',
      items: [
        { id: 'analytics', label: 'Analytics & Reports', icon: BarChart3 },
        {
          id: 'notifications',
          label: 'System Inbox',
          icon: Bell,
          badge: unreadCount > 0 ? `${unreadCount}` : undefined,
          tone: 'risk',
        },
        { id: 'settings', label: 'System Settings', icon: Settings },
      ],
    },
  ];

  const go = (id: string) => {
    setCurrentView(id);
    setSidebarOpen(false);
  };

  return (
    <>
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 bg-ds-inverse/40 backdrop-blur-xs z-40 lg:hidden transition-opacity"
        />
      )}

      {/* `lg:z-auto` is load-bearing, not cosmetic. At lg the rail is a plain
          flex sibling of <main>, but `z-50` still resolves for flex items even
          when `position: static` — so without this the rail painted OVER every
          full-page overlay mounted inside <main> (the case viewer is
          `fixed inset-0 z-40`), hiding its left column behind the nav. The
          drawer genuinely needs z-50 on mobile, where it is `fixed` over the
          backdrop; on desktop it is in flow and must not outrank modals.

          Width comes from the shell tokens rather than a literal, because the
          mobile dock's safe-area padding and the collapsed rail's icon
          centring have to agree with it. */}
      <aside
        className={`ds-rail ds-rail-float fixed lg:static top-0 left-0 z-50 lg:z-auto h-screen shrink-0 flex flex-col transition-[width,transform] duration-200 ease-out ${
          isCollapsed ? 'w-[var(--ds-rail-w-collapsed)]' : 'w-[var(--ds-rail-w)]'
        } ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}
      >
        {/* Brand header. The collapsed rail stacks the mark over the toggle so
            nothing collides at 76px. */}
        <div
          className={`shrink-0 flex items-center border-b border-ds-line ${
            isCollapsed ? 'flex-col justify-center gap-2 py-3.5 px-2' : 'h-16 justify-between px-4'
          }`}
        >
          <button
            onClick={() => go('dashboard')}
            className="ds-hit flex items-center gap-3 min-w-0 text-left cursor-pointer group rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ds-accent"
            title={brandingSettings.appName || 'Dental Lab'}
          >
            {brandingSettings.logoUrl ? (
              <img
                src={brandingSettings.logoUrl}
                alt={brandingSettings.appName}
                className="w-[38px] h-[38px] rounded-xl object-contain bg-ds-surface border border-ds-line p-1 shrink-0 transition-transform duration-200 group-hover:scale-105"
              />
            ) : (
              <span className="ds-brand-mark" aria-hidden="true">
                <Activity className="w-[18px] h-[18px]" />
              </span>
            )}
            {!isCollapsed && (
              <span className="truncate min-w-0">
                <span className="ds-brand-name block truncate">
                  {brandingSettings.appName || 'DENTAL LAB'}
                </span>
                <span className="ds-brand-tagline block truncate">
                  {brandingSettings.tagline ? brandingSettings.tagline.split('•')[0] : 'Lab Workstation'}
                </span>
              </span>
            )}
          </button>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="ds-iconbtn hidden lg:inline-flex"
              title={isCollapsed ? 'Expand navigation' : 'Collapse navigation'}
              aria-label={isCollapsed ? 'Expand navigation' : 'Collapse navigation'}
            >
              {isCollapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
            </button>
            <button
              onClick={() => setSidebarOpen(false)}
              className="ds-iconbtn lg:hidden"
              aria-label="Close navigation"
            >
              <X className="w-[18px] h-[18px]" />
            </button>
          </div>
        </div>

        <nav className="flex-1 px-3 py-5 space-y-6 overflow-y-auto no-scrollbar" aria-label="Main navigation">
          {navGroups.map((group, idx) => (
            <div key={idx} className="space-y-1">
              {!isCollapsed ? (
                <div className="ds-nav-group-label px-2 mb-2">
                  <span>{group.groupTitle}</span>
                  <span className="ds-nav-group-rule" aria-hidden="true" />
                </div>
              ) : (
                idx > 0 && <div className="mx-2 mb-2.5 border-t border-ds-line" aria-hidden="true" />
              )}
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = currentView === item.id;
                const navAction = NAV_ACTION[item.id] ?? 'dashboard:view';
                const disabled = !can(user, navAction as any);
                return (
                  <button
                    key={item.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => { if (!disabled) go(item.id); }}
                    title={disabled ? deniedTooltip : (isCollapsed ? item.label : undefined)}
                    aria-current={isActive ? 'page' : undefined}
                    data-active={isActive}
                    className={`ds-nav-row ds-row-target active:scale-[0.98] ${
                      !disabled && !isActive ? 'ds-glass-pill-row' : ''
                    } ${
                      disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
                    } ${isCollapsed ? 'justify-center py-3' : 'gap-3 pl-3 pr-2.5 py-2'}`}
                  >
                    <Icon
                      className={`w-[17px] h-[17px] shrink-0 transition-colors ${
                        isActive ? 'text-ds-accent' : 'text-ds-muted'
                      }`}
                    />
                    {!isCollapsed && <span className="truncate">{item.label}</span>}
                    {!isCollapsed && item.badge && (
                      <span className="ds-nav-badge" data-tone={item.tone ?? 'neutral'}>
                        {item.badge}
                      </span>
                    )}
                    {isCollapsed && item.badge && (
                      <span
                        className={`absolute top-2 right-2 w-2 h-2 rounded-full ring-2 ring-ds-sunken ${
                          item.tone === 'warn' ? 'bg-ds-warn' : item.tone === 'risk' ? 'bg-ds-risk' : 'bg-ds-accent'
                        }`}
                        aria-hidden="true"
                      />
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Version strip. In the collapsed rail this collapses to the number
            alone — the app name is already the mark directly above it, so
            repeating it at 76px only produces a truncated duplicate. */}
        <div className="shrink-0 border-t border-ds-line px-4 py-3">
          {isCollapsed ? (
            <span
              className="block text-center font-mono text-[10px] text-ds-muted tabular-nums"
              title={`v${currentVersion()}`}
            >
              v{currentVersion()}
            </span>
          ) : (
            <div className="space-y-2">
              <ConnectivityStatus />
              <div className="flex items-center justify-between gap-2">
              <span className="truncate text-[10px] font-semibold tracking-wider text-ds-muted uppercase">
                {brandingSettings.appName || 'Dental Solutions'}
              </span>
              <span className="font-mono text-[10px] text-ds-muted tabular-nums shrink-0">
                v{currentVersion()}
              </span>
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* Mobile dock. Shares the rail's palette and its focus/active contract;
          the only deliberate difference is the active treatment, which is a
          tint rather than the rail's filled plate (see `.ds-dock-item`). */}
      <nav
        className="ds-rail lg:hidden fixed bottom-0 left-0 right-0 z-30 border-t border-r-0 px-2 pt-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))] flex items-center justify-around"
        aria-label="Mobile navigation"
      >
        {[
          { id: 'dashboard', label: 'Home', icon: LayoutDashboard },
          { id: 'cases', label: 'Cases', icon: FolderKanban, badge: overdueCount > 0 || undefined },
          { id: 'labs', label: 'Clinics', icon: Building2 },
          { id: 'billing', label: 'Billing', icon: Receipt },
          { id: 'notifications', label: 'Inbox', icon: Bell, badge: unreadCount > 0 || undefined },
        ].map((item) => {
          const Icon = item.icon;
          const isActive = currentView === item.id;
          return (
            <button
              key={item.id}
              onClick={() => go(item.id)}
              aria-current={isActive ? 'page' : undefined}
              data-active={isActive}
              className="ds-dock-item"
            >
              <Icon className="w-[19px] h-[19px]" />
              <span>{item.label}</span>
              {item.badge && (
                <span
                  className="absolute top-1 right-2.5 w-1.5 h-1.5 rounded-full bg-ds-risk"
                  aria-hidden="true"
                />
              )}
            </button>
          );
        })}
      </nav>
    </>
  );
};