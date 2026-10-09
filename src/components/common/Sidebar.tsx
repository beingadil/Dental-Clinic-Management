/**
 * Sidebar.
 *
 * Restyled to share the dashboard's design language rather than describing its
 * own. The old version picked its own indigo palette, its own radii and its own
 * active treatment, so the navigation read as a different product bolted onto
 * the left of the new dashboard. Everything below now comes from the `ds-*`
 * tokens in dashboard-tokens.css, which means a theme change moves the
 * navigation and the panels together.
 *
 * Two behaviours are unchanged on purpose: the collapsed rail (80px, icons
 * only, badges reduced to dots) and the mobile bottom bar. Both are load-bearing
 * for small screens and neither was part of the complaint.
 */
import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { currentVersion } from '../../services/updateService';
import {
  LayoutDashboard,
  FolderKanban,
  Building2,
  Receipt,
  BarChart3,
  Bell,
  Settings,
  X,
  ChevronLeft,
  ChevronRight,
  Activity,
  BookOpen,
  Clock3,
} from 'lucide-react';

export const Sidebar: React.FC = () => {
  const { currentView, setCurrentView, sidebarOpen, setSidebarOpen, unreadCount, overdueCount, invoices, brandingSettings } =
    useApp();

  const [isCollapsed, setIsCollapsed] = useState(false);

  const unpaidInvoicesCount = invoices.filter((i) => i.payment_status !== 'paid').length;

  interface NavItem {
    id: string;
    label: string;
    icon: React.FC<{ className?: string }>;
    badge?: string;
    /** Dot colour for the collapsed rail, where the count will not fit. */
    dot: string;
  }

  const navGroups: { groupTitle: string; items: NavItem[] }[] = [
    {
      groupTitle: 'Workspace',
      items: [
        { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, dot: 'bg-ds-accent' },
        {
          id: 'cases',
          label: 'Dental Workstation',
          icon: FolderKanban,
          badge: overdueCount > 0 ? `${overdueCount}` : undefined,
          dot: 'bg-ds-warn',
        },
      ],
    },
    {
      groupTitle: 'Management',
      items: [
        { id: 'labs', label: 'Dental Clinics', icon: Building2, dot: 'bg-ds-accent' },
        {
          id: 'billing',
          label: 'Billing & Invoices',
          icon: Receipt,
          badge: unpaidInvoicesCount > 0 ? `${unpaidInvoicesCount}` : undefined,
          dot: 'bg-ds-qc',
        },
        { id: 'catalog', label: 'Price List & Catalog', icon: BookOpen, dot: 'bg-ds-accent' },
      ],
    },
    {
      groupTitle: 'Insights',
      items: [
        { id: 'analytics', label: 'Analytics & Reports', icon: BarChart3, dot: 'bg-ds-accent' },
        {
          id: 'notifications',
          label: 'System Inbox',
          icon: Bell,
          badge: unreadCount > 0 ? `${unreadCount}` : undefined,
          dot: 'bg-ds-risk',
        },
        { id: 'settings', label: 'System Settings', icon: Settings, dot: 'bg-ds-accent' },
      ],
    },
  ];

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
          backdrop; on desktop it is in flow and must not outrank modals. */}
      <aside
        className={`fixed lg:static top-0 left-0 z-50 lg:z-auto h-screen bg-ds-surface border-r border-ds-line text-ds-ink-soft flex flex-col shrink-0 transition-all duration-300 ease-in-out ${
          isCollapsed ? 'w-20' : 'w-64'
        } ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}
      >
        {/* Brand header. The collapsed rail stacks the mark over the toggle so
            nothing collides at 80px. */}
        <div
          className={`border-b border-ds-line shrink-0 flex items-center ${
            isCollapsed ? 'flex-col justify-center gap-2 py-4 px-2' : 'h-[70px] justify-between px-4'
          }`}
        >
          <button
            onClick={() => {
              setCurrentView('dashboard');
              setSidebarOpen(false);
            }}
            className="ds-hit flex items-center gap-3 cursor-pointer group min-w-0 text-left"
          >
            {brandingSettings.logoUrl ? (
              <img
                src={brandingSettings.logoUrl}
                alt={brandingSettings.appName}
                className="w-10 h-10 rounded-xl object-contain bg-ds-sunken border border-ds-line p-1 shrink-0 group-hover:scale-105 transition-transform"
              />
            ) : (
              <div className="w-10 h-10 bg-ds-accent rounded-xl flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                <Activity className="w-5 h-5 text-white" />
              </div>
            )}
            {!isCollapsed && (
              <div className="truncate min-w-0">
                <span className="font-bold text-sm tracking-tight text-ds-ink block truncate">
                  {brandingSettings.appName || 'DENTAL LAB'}
                </span>
                <span className="font-semibold text-[10px] tracking-wider text-ds-muted block uppercase truncate">
                  {brandingSettings.tagline ? brandingSettings.tagline.split('•')[0] : 'Lab Workstation'}
                </span>
              </div>
            )}
          </button>

          <div className={`flex items-center ${isCollapsed ? 'flex-col gap-1' : 'gap-1'}`}>
            <button
              onClick={() => setIsCollapsed(!isCollapsed)}
              className={`hidden lg:flex text-ds-muted hover:text-ds-ink hover:bg-ds-sunken rounded-lg transition-colors active:scale-95 cursor-pointer ds-hit ${
                isCollapsed ? 'p-1' : 'p-1.5'
              }`}
              title={isCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
              aria-label={isCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
            >
              {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
            </button>
            <button
              onClick={() => setSidebarOpen(false)}
              className="lg:hidden text-ds-muted hover:text-ds-ink p-1.5 rounded-lg cursor-pointer ds-hit"
              aria-label="Close Sidebar"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-6 overflow-y-auto no-scrollbar" aria-label="Main navigation">
          {navGroups.map((group, idx) => (
            <div key={idx} className="space-y-1">
              {!isCollapsed ? (
                <div className="px-3 mb-1.5 text-[10px] font-semibold text-ds-muted uppercase tracking-[0.14em] flex items-center gap-2">
                  <span>{group.groupTitle}</span>
                  <span className="h-px flex-1 bg-ds-line" aria-hidden="true" />
                </div>
              ) : (
                idx > 0 && <div className="mx-3 mb-2 border-t border-ds-line" />
              )}
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = currentView === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      setCurrentView(item.id);
                      setSidebarOpen(false);
                    }}
                    title={isCollapsed ? item.label : undefined}
                    aria-current={isActive ? 'page' : undefined}
                    className={`ds-row-target group relative w-full flex items-center ${
                      isCollapsed ? 'justify-center py-3' : 'justify-between px-3 py-2.5'
                    } rounded-xl font-medium text-xs md:text-sm transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent/30 active:scale-[0.98] ${
                      isActive
                        ? 'bg-ds-accent-soft text-ds-accent-strong font-semibold'
                        : 'text-ds-ink-soft hover:bg-ds-sunken hover:text-ds-ink'
                    }`}
                  >
                    {isActive && (
                      <span
                        className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-full bg-ds-accent"
                        aria-hidden="true"
                      />
                    )}
                    <span className="flex items-center min-w-0">
                      <Icon
                        className={`w-4 h-4 shrink-0 transition-colors ${
                          isActive ? 'text-ds-accent' : 'text-ds-muted group-hover:text-ds-ink-soft'
                        }`}
                      />
                      {!isCollapsed && <span className="truncate ml-3">{item.label}</span>}
                    </span>
                    {!isCollapsed && item.badge && (
                      <span className="ml-2 px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 tabular-nums bg-ds-sunken text-ds-ink-soft border border-ds-line">
                        {item.badge}
                      </span>
                    )}
                    {isCollapsed && item.badge && (
                      <span className={`absolute top-1.5 right-1.5 w-2 h-2 rounded-full ring-2 ring-ds-surface ${item.dot}`} aria-hidden="true" />
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        {!isCollapsed ? (
          <div className="p-3 border-t border-ds-line">
            <div className="flex items-center justify-between px-2 py-1">
              <span className="flex items-center gap-1.5 text-[10px] font-semibold text-ds-muted truncate">
                <Clock3 className="w-3 h-3" />
                <span className="truncate">{brandingSettings.appName || 'Dental Solutions'}</span>
              </span>
              <span className="text-[10px] font-mono text-ds-muted tabular-nums">v{currentVersion()}</span>
            </div>
          </div>
        ) : (
          <div className="p-3 border-t border-ds-line flex justify-center">
            <span className="text-[10px] font-mono text-ds-muted" title={`v${currentVersion()}`}>
              v{currentVersion()}
            </span>
          </div>
        )}
      </aside>

      {/* Mobile bottom bar */}
      <nav
        className="lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-ds-surface border-t border-ds-line px-2 pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] flex items-center justify-around"
        aria-label="Mobile navigation"
      >
        {[
          { id: 'dashboard', label: 'Home', icon: LayoutDashboard },
          { id: 'cases', label: 'Cases', icon: FolderKanban },
          { id: 'labs', label: 'Clinics', icon: Building2 },
          { id: 'billing', label: 'Billing', icon: Receipt },
          { id: 'notifications', label: 'Inbox', icon: Bell, badge: unreadCount },
        ].map((item) => {
          const Icon = item.icon;
          const isActive = currentView === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setCurrentView(item.id)}
              aria-current={isActive ? 'page' : undefined}
              className={`ds-row-target flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg relative transition-colors active:scale-95 ${
                isActive ? 'text-ds-accent font-bold' : 'text-ds-muted'
              }`}
            >
              <span
                className={`absolute -top-1 h-0.5 w-8 rounded-full ${isActive ? 'bg-ds-accent' : 'bg-transparent'}`}
                aria-hidden="true"
              />
              <Icon className="w-5 h-5" />
              <span className="text-[10px]">{item.label}</span>
              {item.badge ? <span className="absolute top-0.5 right-2 w-2 h-2 rounded-full bg-ds-risk" aria-hidden="true" /> : null}
            </button>
          );
        })}
      </nav>
    </>
  );
};