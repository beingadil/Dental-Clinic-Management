import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import {
  LayoutDashboard,
  FolderKanban,
  Building2,
  Receipt,
  BarChart3,
  Bell,
  Settings,
  X,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  SlidersHorizontal,
  Activity,
  CheckCircle2,
  Clock,
  Plus,
  BookOpen
} from 'lucide-react';

interface SidebarProps {
  onOpenNewCaseModal?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ onOpenNewCaseModal }) => {
  const { 
    currentView, 
    setCurrentView, 
    sidebarOpen, 
    setSidebarOpen, 
    unreadCount, 
    overdueCount, 
    invoices,
    cases,
    brandingSettings
  } = useApp();

  const [isCollapsed, setIsCollapsed] = useState(false);
  const [showHealthModal, setShowHealthModal] = useState(false);

  const unpaidInvoicesCount = invoices.filter((i) => i.payment_status !== 'paid').length;
  const urgentCasesCount = cases.filter((c) => c.priority === 'urgent' && c.status !== 'delivered').length;

  const navGroups = [
    {
      groupTitle: 'WORKSPACE',
      items: [
        { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
        { 
          id: 'cases', 
          label: 'Dental Workstation', 
          icon: FolderKanban, 
          badge: overdueCount > 0 ? `${overdueCount}` : undefined, 
          badgeColor: 'bg-amber-500 text-white font-bold' 
        },
      ]
    },
    {
      groupTitle: 'MANAGEMENT',
      items: [
        { id: 'labs', label: 'Dental Clinics', icon: Building2 },
        { 
          id: 'billing', 
          label: 'Billing & Invoices', 
          icon: Receipt, 
          badge: unpaidInvoicesCount > 0 ? `${unpaidInvoicesCount}` : undefined, 
          badgeColor: 'bg-indigo-100 text-indigo-700 font-bold' 
        },
        { id: 'catalog', label: 'Price List & Catalog', icon: BookOpen },
      ]
    },
    {
      groupTitle: 'INTELLIGENCE',
      items: [
        { id: 'analytics', label: 'Analytics & Reports', icon: BarChart3 },
        { 
          id: 'notifications', 
          label: 'System Inbox', 
          icon: Bell, 
          badge: unreadCount > 0 ? `${unreadCount}` : undefined, 
          badgeColor: 'bg-rose-500 text-white font-bold' 
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
        {/* Brand Header */}
        <div className="h-[70px] px-4 flex items-center justify-between border-b border-slate-200/70 shrink-0">
          <div 
            onClick={() => { setCurrentView('dashboard'); setSidebarOpen(false); }}
            className="flex items-center gap-3 cursor-pointer group min-w-0"
          >
            {brandingSettings.logoUrl ? (
              <img 
                src={brandingSettings.logoUrl} 
                alt={brandingSettings.appName} 
                className="w-10 h-10 rounded-xl object-contain bg-slate-50 border border-slate-200 p-1 shrink-0 shadow-2xs group-hover:scale-105 transition-transform"
              />
            ) : (
              <div className="w-10 h-10 bg-slate-950 rounded-xl flex items-center justify-center text-indigo-400 shadow-md border border-slate-800 group-hover:scale-105 group-hover:border-indigo-500/50 transition-all shrink-0">
                <Activity className="w-5 h-5 text-indigo-400" />
              </div>
            )}
            {!isCollapsed && (
              <div className="truncate min-w-0">
                <span className="font-bold text-sm tracking-tight text-slate-900 block truncate">{brandingSettings.appName || 'DENTAL LAB'}</span>
                <span className="font-semibold text-[10px] tracking-wider text-slate-400 block uppercase truncate">
                  {brandingSettings.tagline ? brandingSettings.tagline.split('•')[0] : 'Workstation Pro'}
                </span>
              </div>
            )}
          </div>
          
          <div className="flex items-center gap-1">
            <button
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="hidden lg:flex text-slate-400 hover:text-slate-900 p-1.5 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
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

        {/* Action Shortcut Button */}
        {!isCollapsed && onOpenNewCaseModal && (
          <div className="px-3 pt-3.5">
            <button
              onClick={onOpenNewCaseModal}
              className="w-full py-2.5 px-3.5 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white text-xs font-bold rounded-xl shadow-sm shadow-indigo-600/20 flex items-center justify-center gap-2 transition-all cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Log New Case</span>
            </button>
          </div>
        )}

        {/* Navigation Groups */}
        <nav className="flex-1 px-3 py-4 space-y-5 overflow-y-auto no-scrollbar">
          {navGroups.map((group, idx) => (
            <div key={idx} className="space-y-1">
              {!isCollapsed && (
                <div className="px-3 mb-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                  {group.groupTitle}
                </div>
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
                    className={`w-full flex items-center ${isCollapsed ? 'justify-center py-3' : 'justify-between px-3 py-2.5'} rounded-xl font-medium text-xs md:text-sm transition-all cursor-pointer ${
                      isActive
                        ? 'bg-slate-900 text-white font-semibold shadow-xs'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-indigo-400' : 'text-slate-400'}`} />
                      {!isCollapsed && <span className="truncate">{item.label}</span>}
                    </div>
                    {!isCollapsed && item.badge && (
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${
                        isActive ? 'bg-slate-800 text-slate-200' : (item.badgeColor || 'bg-slate-100 text-slate-600')
                      }`}>
                        {item.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}

          {/* Quick Filters Section */}
          {!isCollapsed && (
            <div className="pt-3 border-t border-slate-100 space-y-2">
              <div className="px-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                <SlidersHorizontal className="w-3 h-3 text-slate-400" />
                <span>QUICK FILTERS</span>
              </div>
              
              <div className="space-y-1">
                <button
                  onClick={() => {
                    setCurrentView('cases');
                    setSidebarOpen(false);
                  }}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium text-slate-600 hover:bg-amber-50 hover:text-amber-900 transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-amber-500" />
                    <span>Overdue Cases</span>
                  </div>
                  <span className="font-bold text-amber-700 text-[11px] font-mono">{overdueCount}</span>
                </button>

                <button
                  onClick={() => {
                    setCurrentView('cases');
                    setSidebarOpen(false);
                  }}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium text-slate-600 hover:bg-rose-50 hover:text-rose-900 transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-rose-500" />
                    <span>Urgent Priority</span>
                  </div>
                  <span className="font-bold text-rose-700 text-[11px] font-mono">{urgentCasesCount}</span>
                </button>

                <button
                  onClick={() => {
                    setCurrentView('billing');
                    setSidebarOpen(false);
                  }}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium text-slate-600 hover:bg-indigo-50 hover:text-indigo-900 transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-indigo-500" />
                    <span>Unpaid Invoices</span>
                  </div>
                  <span className="font-bold text-indigo-700 text-[11px] font-mono">{unpaidInvoicesCount}</span>
                </button>
              </div>
            </div>
          )}
        </nav>

        {/* Footer info card */}
        {!isCollapsed ? (
          <div className="p-3 border-t border-slate-100">
            <div className="bg-slate-900 rounded-2xl p-4 text-white relative overflow-hidden shadow-md border border-slate-800">
              <div className="relative z-10">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-bold tracking-widest text-slate-300 uppercase">LAB SUITE ENTERPRISE</span>
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                </div>
                <p className="text-xs font-medium mb-3 text-slate-300">FDI Tooth Engine & Live Billing Online</p>
                <button 
                  onClick={() => setShowHealthModal(true)}
                  className="w-full py-2 bg-white/10 hover:bg-white/20 text-white border border-white/20 rounded-xl text-xs font-bold transition-all backdrop-blur-xs flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Activity className="w-3.5 h-3.5 text-slate-300" />
                  <span>System Status</span>
                </button>
              </div>
              <div className="absolute -right-4 -bottom-4 w-20 h-20 bg-indigo-600 rounded-full blur-xl opacity-30 pointer-events-none"></div>
            </div>
          </div>
        ) : (
          <div className="p-3 border-t border-slate-100 flex justify-center">
            <button
              onClick={() => setShowHealthModal(true)}
              className="w-10 h-10 rounded-xl bg-slate-900 text-indigo-400 flex items-center justify-center hover:bg-indigo-900 transition-colors"
              title="System Status"
            >
              <Activity className="w-5 h-5" />
            </button>
          </div>
        )}
      </aside>

      {/* System Health Diagnostics Modal */}
      {showHealthModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 border border-slate-100 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
                  <Activity className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-800 text-sm">System Health Diagnostics</h3>
                  <p className="text-xs text-slate-400">Dental Solutions Pro Workstation v2.4</p>
                </div>
              </div>
              <button
                onClick={() => setShowHealthModal(false)}
                className="text-slate-400 hover:text-slate-800 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 bg-emerald-50 rounded-2xl border border-emerald-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span className="font-semibold text-emerald-950">FDI Tooth Engine</span>
                </div>
                <span className="font-mono font-bold text-emerald-700 text-[10px] uppercase">Active (ISO 3950)</span>
              </div>

              <div className="p-3 bg-emerald-50 rounded-2xl border border-emerald-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span className="font-semibold text-emerald-950">Auto Invoice & Billing</span>
                </div>
                <span className="font-mono font-bold text-emerald-700 text-[10px] uppercase">Synced</span>
              </div>

              <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-slate-600" />
                  <span className="font-semibold text-slate-800">Local Data Storage</span>
                </div>
                <span className="font-mono font-bold text-slate-600 text-[10px]">Persistent</span>
              </div>
            </div>

            <button
              onClick={() => setShowHealthModal(false)}
              className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl text-xs transition-colors"
            >
              Close Diagnostics
            </button>
          </div>
        </div>
      )}

      {/* Mobile Bottom Bar navigation */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-slate-200 px-2 py-1 flex items-center justify-around shadow-lg">
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
              className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg relative ${
                isActive ? 'text-indigo-600 font-bold' : 'text-slate-500'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="text-[10px]">{item.label}</span>
              {item.badge ? (
                <span className="absolute top-0.5 right-2 w-2 h-2 rounded-full bg-rose-500" />
              ) : null}
            </button>
          );
        })}
      </div>
    </>
  );
};
