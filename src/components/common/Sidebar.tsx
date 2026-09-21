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
  Plus,
  BookOpen,
  Printer
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
    brandingSettings
  } = useApp();

  const [isCollapsed, setIsCollapsed] = useState(false);

  const unpaidInvoicesCount = invoices.filter((i) => i.payment_status !== 'paid').length;

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
        { id: 'print', label: 'Print Studio', icon: Printer },
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
        </nav>

        {/* Footer info card */}
        {!isCollapsed ? (
          <div className="p-3 border-t border-slate-100">
            <div className="flex items-center justify-between px-2 py-1">
              <span className="text-[10px] font-semibold text-slate-400 truncate">{brandingSettings.appName || 'Dental Solutions'}</span>
              <span className="text-[10px] font-mono text-slate-400">v{currentVersion()}</span>
            </div>
          </div>
        ) : null}
      </aside>

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
