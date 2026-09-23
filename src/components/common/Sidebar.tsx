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
  Printer,
  Clock3
} from 'lucide-react';

interface SidebarProps {}

export const Sidebar: React.FC<SidebarProps> = () => {
  const { 
    currentView, 
    setCurrentView, 
    sidebarOpen, 
    setSidebarOpen, 
    unreadCount, 
    overdueCount, 
    invoices,
    brandingSettings
  } = useApp();

  const [isCollapsed, setIsCollapsed] = useState(false);

  const unpaidInvoicesCount = invoices.filter((i) => i.payment_status !== 'paid').length;

  interface NavItem {
    id: string;
    label: string;
    icon: React.FC<{ className?: string }>;
    badge?: string;
    badgeColor?: string;
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
          badgeColor: 'bg-amber-50 text-amber-700 border border-amber-200' 
        },
      ]
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
          badgeColor: 'bg-indigo-50 text-indigo-700 border border-indigo-100' 
        },
        { id: 'catalog', label: 'Price List & Catalog', icon: BookOpen },
        { id: 'print', label: 'Print Studio', icon: Printer },
      ]
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
          badgeColor: 'bg-rose-50 text-rose-700 border border-rose-200' 
        },
        { id: 'settings', label: 'System Settings', icon: Settings },
      ]
    }
  ];

  return (
    <>
      {/* Backdrop for mobile */}
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-40 lg:hidden transition-opacity"
        />
      )}

      {/* Main Sidebar */}
      <aside
        className={`fixed lg:static top-0 left-0 z-50 h-screen bg-white/95 backdrop-blur-md border-r border-slate-200/80 text-slate-800 flex flex-col shrink-0 transition-all duration-300 ease-in-out shadow-xs ${
          isCollapsed ? 'w-20' : 'w-64'
        } ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        {/* Brand Header — the collapsed rail stacks logo over the toggle inside
            a taller header so nothing ever collides at 80px width */}
        <div className={`border-b border-slate-200/70 shrink-0 flex items-center ${
          isCollapsed ? 'flex-col justify-center gap-2 py-4 px-2' : 'h-[70px] justify-between px-4'
        }`}>
          <div 
            onClick={() => { setCurrentView('dashboard'); setSidebarOpen(false); }}
            className="flex items-center gap-3 cursor-pointer group min-w-0"
          >
            {brandingSettings.logoUrl ? (
              <img 
                src={brandingSettings.logoUrl} 
                alt={brandingSettings.appName} 
                className={`rounded-xl object-contain bg-slate-50 border border-slate-200 p-1 shrink-0 group-hover:scale-105 transition-transform ${
                  isCollapsed ? 'w-10 h-10' : 'w-10 h-10'
                }`}
              />
            ) : (
              <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                <Activity className="w-5 h-5 text-white" />
              </div>
            )}
            {!isCollapsed && (
              <div className="truncate min-w-0">
                <span className="font-bold text-sm tracking-tight text-slate-900 block truncate">{brandingSettings.appName || 'DENTAL LAB'}</span>
                <span className="font-semibold text-[10px] tracking-wider text-slate-400 block uppercase truncate">
                  {brandingSettings.tagline ? brandingSettings.tagline.split('•')[0] : 'Lab Workstation'}
                </span>
              </div>
            )}
          </div>
          
          <div className={`flex items-center ${isCollapsed ? 'flex-col gap-1' : 'gap-1'}`}>
            <button
              onClick={() => setIsCollapsed(!isCollapsed)}
              className={`hidden lg:flex text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors active:scale-95 cursor-pointer ${
                isCollapsed ? 'p-1' : 'p-1.5'
              }`}
              title={isCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
              aria-label={isCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
            >
              {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
            </button>
            <button
              onClick={() => setSidebarOpen(false)}
              className="lg:hidden text-slate-400 hover:text-slate-900 p-1.5 rounded-lg cursor-pointer"
              aria-label="Close Sidebar"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Navigation Groups */}
        <nav className="flex-1 px-3 py-4 space-y-6 overflow-y-auto no-scrollbar" aria-label="Main navigation">
          {navGroups.map((group, idx) => (
            <div key={idx} className="space-y-1">
              {!isCollapsed && (
                <div className="px-3 mb-1.5 text-[10px] font-semibold text-slate-400/90 uppercase tracking-[0.14em] flex items-center gap-2">
                  <span>{group.groupTitle}</span>
                  <span className="h-px flex-1 bg-slate-100" aria-hidden="true" />
                </div>
              )}
              {isCollapsed && idx > 0 && <div className="mx-3 mb-2 border-t border-slate-100" />}
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
                    className={`group relative w-full flex items-center ${isCollapsed ? 'justify-center py-3' : 'justify-between px-3 py-2.5'} rounded-xl font-medium text-xs md:text-sm transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/30 active:scale-[0.98] ${
                      isActive
                        ? 'bg-indigo-50 text-indigo-700 font-semibold'
                        : 'text-slate-600 hover:bg-slate-100/80 hover:text-slate-900'
                    }`}
                  >
                    {isActive && (
                      <span
                        className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-full bg-indigo-600 transition-all duration-200 group-hover:h-6"
                        aria-hidden="true"
                      />
                    )}
                    <div className="flex items-center min-w-0">
                      <Icon className={`w-4 h-4 shrink-0 transition-colors ${
                        isActive ? 'text-indigo-600' : 'text-slate-400 group-hover:text-slate-600'
                      }`} />
                      {!isCollapsed && <span className="truncate ml-3">{item.label}</span>}
                    </div>
                    {!isCollapsed && item.badge && (
                      <span className={`ml-2 px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 tabular-nums transition-transform duration-200 group-hover:scale-105 ${
                        item.badgeColor || 'bg-slate-100 text-slate-600'
                      }`}>
                        {item.badge}
                      </span>
                    )}
                    {isCollapsed && item.badge && (
                      <span
                        className={`absolute top-1.5 right-1.5 w-2 h-2 rounded-full ring-2 ring-white ${
                          item.badgeColor?.split(' ')[0] || 'bg-rose-500'
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

        {/* Footer info card */}
        {!isCollapsed ? (
          <div className="p-3 border-t border-slate-100">
            <div className="flex items-center justify-between px-2 py-1">
              <span className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-400 truncate">
                <Clock3 className="w-3 h-3 text-slate-400" />
                <span className="truncate">{brandingSettings.appName || 'Dental Solutions'}</span>
              </span>
              <span className="text-[10px] font-mono text-slate-400 tabular-nums">v{currentVersion()}</span>
            </div>
          </div>
        ) : (
          <div className="p-3 border-t border-slate-100 flex justify-center">
            <span className="text-[10px] font-mono text-slate-400" title={`v${currentVersion()}`}>v{currentVersion()}</span>
          </div>
        )}
      </aside>

      {/* Mobile Bottom Bar navigation */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-slate-200 px-2 pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] flex items-center justify-around" aria-label="Mobile navigation">
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
              className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg relative transition-colors active:scale-95 ${
                isActive ? 'text-indigo-600 font-bold' : 'text-slate-500'
              }`}
            >
              <span className={`absolute -top-1 h-0.5 w-8 rounded-full ${isActive ? 'bg-indigo-600' : 'bg-transparent'}`} aria-hidden="true" />
              <Icon className="w-5 h-5" />
              <span className="text-[10px]">{item.label}</span>
              {item.badge ? (
                <span className="absolute top-0.5 right-2 w-2 h-2 rounded-full bg-rose-500" aria-hidden="true" />
              ) : null}
            </button>
          );
        })}
      </nav>
    </>
  );
};
