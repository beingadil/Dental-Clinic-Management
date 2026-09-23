import React, { useState, useRef, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { 
  Bell, 
  Search, 
  Menu, 
  User, 
  LogOut, 
  CheckCheck, 
  AlertTriangle, 
  FileText, 
  ShieldCheck,
  X,
  Building2,
  Receipt,
  ChevronRight,
  UserCheck,
  Stethoscope,
  Hash,
  Clock,
  ArrowRight,
  ExternalLink
} from 'lucide-react';
import { DentalCase } from '../../types';

interface HeaderProps {
  /** Reserved for future global actions; the header intentionally hosts no case-creation entry. */
  onOpenNewCaseModal?: () => void;
}

export const Header: React.FC<HeaderProps> = () => {
  const { 
    user, 
    logout, 
    notifications, 
    unreadCount, 
    markNotificationRead, 
    markAllNotificationsRead, 
    sidebarOpen, 
    setSidebarOpen, 
    setCurrentView,
    searchTerm,
    setSearchTerm,
    cases,
    labs,
    invoices,
    brandingSettings,
    setSelectedCaseForModal
  } = useApp();

  const [showNotifMenu, setShowNotifMenu] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showGlobalResults, setShowGlobalResults] = useState(false);

  const searchContainerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const notifContainerRef = useRef<HTMLDivElement>(null);
  const userMenuContainerRef = useRef<HTMLDivElement>(null);

  const getUserInitials = (name?: string) => {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  };

  const unreadNotifications = notifications.filter((n) => !n.is_read && !n.read && !n.is_archived);

  // Global Search Filtering - Priority on Patient Name, Case ID, and Doctor Name
  const cleanTerm = searchTerm.trim().toLowerCase();
  
  const matchedCases = cleanTerm ? cases.filter(c => 
    (c.patient_name || '').toLowerCase().includes(cleanTerm) ||
    (c.case_number || '').toLowerCase().includes(cleanTerm) ||
    (c.doctor_name || '').toLowerCase().includes(cleanTerm) ||
    (c.lab_name || '').toLowerCase().includes(cleanTerm) ||
    (c.case_type_name || '').toLowerCase().includes(cleanTerm) ||
    (c.shade || '').toLowerCase().includes(cleanTerm)
  ).slice(0, 6) : [];

  const matchedLabs = cleanTerm ? labs.filter(l =>
    (l.name || '').toLowerCase().includes(cleanTerm) ||
    (l.doctor_name || '').toLowerCase().includes(cleanTerm) ||
    (l.contact_person || '').toLowerCase().includes(cleanTerm) ||
    (l.code || '').toLowerCase().includes(cleanTerm)
  ).slice(0, 3) : [];

  const matchedInvoices = cleanTerm ? invoices.filter(i =>
    (i.invoice_number || '').toLowerCase().includes(cleanTerm) ||
    (i.case_number || '').toLowerCase().includes(cleanTerm) ||
    (i.lab_name || '').toLowerCase().includes(cleanTerm) ||
    (i.doctor_name || '').toLowerCase().includes(cleanTerm)
  ).slice(0, 3) : [];

  const totalResultsCount = matchedCases.length + matchedLabs.length + matchedInvoices.length;

  // Search suggestions derived from the operator's real data — never hardcoded names.
  const quickSuggestions = React.useMemo(() => {
    const urgentCount = cases.filter((c) => c.priority === 'urgent').length;
    const sugg: string[] = [];
    if (urgentCount > 0) sugg.push('Urgent Priority');
    const doctors = Array.from(new Set(cases.map((c) => c.doctor_name).filter(Boolean)))
      .slice(0, 2);
    sugg.push(...doctors as string[]);
    const materials = Array.from(new Set(cases.map((c) => c.case_type_name).filter(Boolean)))
      .slice(0, 2);
    sugg.push(...materials as string[]);
    const latestCase = cases
      .map((c) => c.case_number)
      .sort()
      .pop();
    if (latestCase) sugg.push(latestCase);
    return Array.from(new Set(sugg)).slice(0, 6);
  }, [cases]);

  // Determine which specific field matched for high-clarity user feedback
  const getCaseMatchBadge = (c: DentalCase) => {
    if (!cleanTerm) return null;
    if ((c.patient_name || '').toLowerCase().includes(cleanTerm)) {
      return { label: 'Matched Patient', value: c.patient_name, icon: UserCheck, color: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
    }
    if ((c.case_number || '').toLowerCase().includes(cleanTerm)) {
      return { label: 'Matched Case ID', value: c.case_number, icon: Hash, color: 'bg-indigo-50 text-indigo-700 border-indigo-200' };
    }
    if ((c.doctor_name || '').toLowerCase().includes(cleanTerm)) {
      return { label: 'Matched Doctor', value: c.doctor_name, icon: Stethoscope, color: 'bg-purple-50 text-purple-700 border-purple-200' };
    }
    if ((c.lab_name || '').toLowerCase().includes(cleanTerm)) {
      return { label: 'Matched Clinic', value: c.lab_name, icon: Building2, color: 'bg-amber-50 text-amber-700 border-amber-200' };
    }
    return { label: 'Matched Material', value: c.case_type_name, icon: FileText, color: 'bg-slate-50 text-slate-700 border-slate-200' };
  };

  // Keyboard shortcut (Cmd+K / Ctrl+K / Escape)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
        setShowGlobalResults(true);
      } else if (e.key === 'Escape') {
        setShowGlobalResults(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Close dropdowns on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (searchContainerRef.current && !searchContainerRef.current.contains(target)) {
        setShowGlobalResults(false);
      }
      if (notifContainerRef.current && !notifContainerRef.current.contains(target)) {
        setShowNotifMenu(false);
      }
      if (userMenuContainerRef.current && !userMenuContainerRef.current.contains(target)) {
        setShowUserMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleOpenCase = (c: DentalCase) => {
    setSelectedCaseForModal(c);
    setShowGlobalResults(false);
  };

  const handleViewInWorkstation = (c: DentalCase) => {
    setSearchTerm(c.case_number);
    setCurrentView('cases');
    setShowGlobalResults(false);
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      if (matchedCases.length === 1) {
        handleOpenCase(matchedCases[0]);
      } else if (cleanTerm) {
        setCurrentView('cases');
        setShowGlobalResults(false);
      }
    }
  };

  return (
    <header className="sticky top-0 z-30 h-[70px] bg-white/95 backdrop-blur-md border-b border-slate-200/80 px-4 sm:px-6 flex items-center justify-between gap-4 sm:gap-6 shrink-0 w-full shadow-2xs">
      {/* ZONE A: Left Zone - Mobile Drawer Toggle */}
      <div className="flex items-center shrink-0">
        <div className="flex items-center gap-3 lg:hidden">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="w-10 h-10 flex items-center justify-center text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-colors active:scale-95 cursor-pointer"
            title="Toggle Navigation"
            aria-label="Toggle Navigation"
          >
            <Menu className="w-5 h-5" />
          </button>

          <div 
            onClick={() => setCurrentView('dashboard')}
            className="flex items-center gap-2 cursor-pointer"
          >
            {brandingSettings.logoUrl ? (
              <img 
                src={brandingSettings.logoUrl} 
                alt={brandingSettings.appName} 
                className="w-8 h-8 rounded-xl object-contain bg-slate-100 p-0.5 border border-slate-200"
              />
            ) : (
              <div className="w-8 h-8 rounded-xl bg-indigo-600 text-white font-bold flex items-center justify-center text-xs">
                {brandingSettings.appName ? brandingSettings.appName.substring(0, 2).toUpperCase() : 'DS'}
              </div>
            )}
            <span className="font-bold text-slate-900 text-sm">{brandingSettings.appName || 'Dental Solutions'}</span>
          </div>
        </div>
      </div>

      {/* ZONE B: Flexible Center Search Area */}
      <div ref={searchContainerRef} className="flex-1 max-w-[760px] min-w-0 relative">
        <div className="relative w-full h-10 flex items-center group">
          <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-600 transition-colors pointer-events-none flex items-center">
            <Search className="w-4 h-4" />
          </div>
          <input
            ref={searchInputRef}
            type="text"
            value={searchTerm}
            onFocus={() => setShowGlobalResults(true)}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setShowGlobalResults(true);
            }}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search cases by Patient Name, Case ID (e.g. DS-0001), or Doctor Name..."
            className="w-full h-10 pl-10 pr-14 text-xs md:text-sm bg-slate-50/80 hover:bg-slate-100/70 focus:bg-white border border-slate-200/90 focus:border-indigo-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/15 transition-all placeholder:text-slate-400 font-medium text-slate-900 shadow-2xs"
          />
          <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
            {searchTerm ? (
              <button
                onClick={() => {
                  setSearchTerm('');
                  setShowGlobalResults(false);
                }}
                className="text-slate-400 hover:text-slate-600 p-1 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                title="Clear search"
                aria-label="Clear search"
              >
                <X className="w-4 h-4" />
              </button>
            ) : (
              <kbd className="hidden sm:inline-flex items-center gap-0.5 px-2 py-0.5 text-[10px] font-mono font-medium text-slate-400 bg-white border border-slate-200 rounded-md shadow-2xs pointer-events-none">
                <span>⌘</span>
                <span>K</span>
              </kbd>
            )}
          </div>
        </div>

        {/* Global Case Search Results Dropdown */}
        {showGlobalResults && (
          <div className="absolute left-0 right-0 mt-2 bg-white rounded-2xl shadow-xl border border-slate-200/90 py-3 z-50 max-h-[520px] overflow-y-auto space-y-3">
            {/* Header info bar */}
            <div className="px-4 pb-2 border-b border-slate-100 flex items-center justify-between">
              <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <Search className="w-3.5 h-3.5 text-slate-500" />
                {cleanTerm ? `Search Results (${totalResultsCount})` : 'Quick Case Lookup'}
              </span>
              <span className="text-[10px] text-slate-400 font-medium">
                {cleanTerm ? 'Click case to open details directly' : 'Search by Patient, Case ID, or Doctor'}
              </span>
            </div>

            {/* If no search term entered yet: suggest real entries from the operator's own data */}
            {!cleanTerm && (
              <div className="p-4 space-y-3">
                <div className="text-xs font-semibold text-slate-500">Quick Filters & Popular Searches:</div>
                <div className="flex flex-wrap gap-2">
                  {quickSuggestions.map((tag) => (
                    <button
                      key={tag}
                      onClick={() => {
                        setSearchTerm(tag);
                        setShowGlobalResults(true);
                      }}
                      className="px-3 py-1 bg-slate-50 hover:bg-slate-100 hover:text-slate-900 border border-slate-200 rounded-lg text-xs font-medium text-slate-600 transition-colors flex items-center gap-1.5 cursor-pointer"
                    >
                      <Search className="w-3 h-3 text-slate-400" />
                      <span>{tag}</span>
                    </button>
                  ))}
                </div>
                <div className="pt-2 border-t border-slate-100 text-[11px] text-slate-400 flex items-center justify-between">
                  <span>Press Esc to dismiss or Enter to view results</span>
                  <button
                    onClick={() => {
                      setCurrentView('cases');
                      setShowGlobalResults(false);
                    }}
                    className="text-slate-700 hover:text-slate-900 font-semibold"
                  >
                    Open Workstation →
                  </button>
                </div>
              </div>
            )}

            {/* When searching and zero matches found */}
            {cleanTerm && totalResultsCount === 0 && (
              <div className="p-8 text-center space-y-2">
                <div className="w-10 h-10 mx-auto rounded-full bg-slate-100 flex items-center justify-center text-slate-400">
                  <Search className="w-5 h-5" />
                </div>
                <div className="text-xs font-semibold text-slate-800">
                  No cases found matching "{searchTerm}"
                </div>
                <p className="text-[11px] text-slate-400 max-w-sm mx-auto">
                  Try searching with a patient first name (e.g. Ali), case number (e.g. DS-0001), or doctor surname (e.g. Tariq).
                </p>
                <div className="pt-2">
                  <button
                    onClick={() => {
                      setCurrentView('cases');
                      setShowGlobalResults(false);
                    }}
                    className="text-xs text-indigo-600 hover:underline font-bold"
                  >
                    View All Cases in Workstation
                  </button>
                </div>
              </div>
            )}

            {/* Matches Display */}
            {cleanTerm && totalResultsCount > 0 && (
              <div className="space-y-4 px-2">
                {/* 1. DENTAL CASES (Primary focus) */}
                {matchedCases.length > 0 && (
                  <div>
                    <div className="px-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 flex items-center justify-between">
                      <span>Dental cases ({matchedCases.length})</span>
                      <span className="text-[10px] font-normal text-indigo-600">Enter to open • Click card</span>
                    </div>

                    <div className="space-y-1.5">
                      {matchedCases.map((c) => {
                        const matchBadge = getCaseMatchBadge(c);
                        const isUrgent = c.priority === 'urgent';
                        return (
                          <div
                            key={c.id}
                            onClick={() => handleOpenCase(c)}
                            className="p-3 bg-white hover:bg-indigo-50/70 border border-slate-100 hover:border-indigo-200 rounded-xl cursor-pointer transition-all flex items-center justify-between gap-3 group shadow-2xs"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="w-9 h-9 rounded-xl bg-indigo-100 text-indigo-700 font-bold flex items-center justify-center text-xs group-hover:bg-indigo-600 group-hover:text-white transition-colors shrink-0">
                                {c.patient_name ? c.patient_name.charAt(0).toUpperCase() : 'P'}
                              </div>

                              <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-xs font-bold text-slate-900 group-hover:text-indigo-900">
                                    {c.patient_name || 'Patient'}
                                  </span>
                                  <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-slate-100 text-slate-700">
                                    {c.case_number}
                                  </span>
                                  {isUrgent && (
                                    <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-rose-100 text-rose-700 uppercase">
                                      {c.priority}
                                    </span>
                                  )}
                                  {matchBadge && (
                                    <span className={`px-1.5 py-0.5 text-[10px] font-semibold rounded border flex items-center gap-1 ${matchBadge.color}`}>
                                      <matchBadge.icon className="w-3 h-3" />
                                      <span>{matchBadge.label}: {matchBadge.value}</span>
                                    </span>
                                  )}
                                </div>

                                <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-2 truncate">
                                  <span className="flex items-center gap-1 text-slate-600">
                                    <Stethoscope className="w-3 h-3 text-slate-400" />
                                    <span>{c.doctor_name || 'Doctor'}</span>
                                  </span>
                                  <span>•</span>
                                  <span className="truncate">{c.lab_name}</span>
                                  <span>•</span>
                                  <span className="font-medium text-slate-700">{c.case_type_name}</span>
                                  {c.shade && <span className="text-indigo-600 font-bold">({c.shade})</span>}
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleViewInWorkstation(c);
                                }}
                                className="hidden sm:inline-flex px-2 py-1 text-[10px] font-semibold text-slate-500 hover:text-indigo-600 bg-slate-50 hover:bg-indigo-100/50 rounded-lg transition-colors items-center gap-1"
                                title="View in Workstation"
                              >
                                <span>Workstation</span>
                                <ExternalLink className="w-3 h-3" />
                              </button>
                              <div className="p-1.5 text-slate-300 group-hover:text-indigo-600 transition-colors">
                                <ChevronRight className="w-4 h-4" />
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* 2. DENTAL CLINICS */}
                {matchedLabs.length > 0 && (
                  <div className="pt-2 border-t border-slate-100">
                    <div className="px-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">
                      Dental clinics ({matchedLabs.length})
                    </div>
                    <div className="space-y-1">
                      {matchedLabs.map((l) => (
                        <div
                          key={l.id}
                          onClick={() => {
                            setCurrentView('labs');
                            setShowGlobalResults(false);
                          }}
                          className="p-2 hover:bg-purple-50/60 rounded-xl cursor-pointer transition-all flex items-center justify-between gap-3 group"
                        >
                          <div className="flex items-center gap-2.5">
                            <div className="p-1.5 bg-purple-100 text-purple-700 rounded-lg group-hover:bg-purple-600 group-hover:text-white transition-colors">
                              <Building2 className="w-3.5 h-3.5" />
                            </div>
                            <div>
                              <div className="text-xs font-bold text-slate-900">{l.name} {l.code ? `(${l.code})` : ''}</div>
                              <div className="text-[10px] text-slate-500">{l.doctor_name ? `Doctor: ${l.doctor_name} | ` : ''}{l.phone}</div>
                            </div>
                          </div>
                          <ChevronRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-purple-600" />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 3. INVOICES */}
                {matchedInvoices.length > 0 && (
                  <div className="pt-2 border-t border-slate-100">
                    <div className="px-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">
                      Invoices &amp; billing ({matchedInvoices.length})
                    </div>
                    <div className="space-y-1">
                      {matchedInvoices.map((inv) => (
                        <div
                          key={inv.id}
                          onClick={() => {
                            setCurrentView('billing');
                            setShowGlobalResults(false);
                          }}
                          className="p-2 hover:bg-emerald-50/60 rounded-xl cursor-pointer transition-all flex items-center justify-between gap-3 group"
                        >
                          <div className="flex items-center gap-2.5">
                            <div className="p-1.5 bg-emerald-100 text-emerald-700 rounded-lg group-hover:bg-emerald-600 group-hover:text-white transition-colors">
                              <Receipt className="w-3.5 h-3.5" />
                            </div>
                            <div>
                              <div className="text-xs font-bold text-slate-900">{inv.invoice_number} (Case #{inv.case_number})</div>
                              <div className="text-[10px] text-slate-500">{inv.lab_name} | PKR {(inv.final_amount || 0).toLocaleString()}</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`px-1.5 py-0.5 text-[10px] font-bold rounded ${
                              inv.payment_status === 'paid' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                            }`}>
                              {(inv.payment_status || 'unpaid').toUpperCase()}
                            </span>
                            <ChevronRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-emerald-600" />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Bottom View All Link */}
                <div className="pt-2 border-t border-slate-100 flex items-center justify-between px-2 text-xs">
                  <span className="text-slate-400 text-[11px]">Looking for advanced filters?</span>
                  <button
                    onClick={() => {
                      setCurrentView('cases');
                      setShowGlobalResults(false);
                    }}
                    className="font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
                  >
                    <span>View all cases in Workstation</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ZONE C: Right Action Area - Unified Coherent Action Group */}
      <div className="flex items-center gap-2 sm:gap-3 shrink-0">

        {/* Notification Bell Dropdown */}
        <div ref={notifContainerRef} className="relative shrink-0">
          <button
            onClick={() => {
              setShowNotifMenu(!showNotifMenu);
              setShowUserMenu(false);
            }}
            className="relative w-11 h-11 flex items-center justify-center text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-colors active:scale-95 cursor-pointer shrink-0"
            title="Notifications"
          >
            <Bell className="w-5 h-5" />
            {unreadCount > 0 && (
              <span className="absolute top-2 right-2 flex items-center justify-center min-w-[18px] h-[18px] px-1 bg-rose-500 text-white text-[10px] font-bold rounded-full pointer-events-none">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>

          {showNotifMenu && (
            <div className="absolute right-0 top-full mt-2 w-80 md:w-96 bg-white rounded-xl shadow-xl border border-slate-200 py-2 z-50">
              <div className="px-4 py-2 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-sm text-slate-900">Notifications</h3>
                  {unreadCount > 0 && (
                    <span className="px-2 py-0.5 text-[11px] font-medium bg-rose-50 text-rose-600 rounded-full">
                      {unreadCount} new
                    </span>
                  )}
                </div>
                {unreadCount > 0 && (
                  <button
                    onClick={markAllNotificationsRead}
                    className="text-xs text-indigo-600 hover:text-indigo-700 font-medium flex items-center gap-1"
                  >
                    <CheckCheck className="w-3.5 h-3.5" />
                    Mark all read
                  </button>
                )}
              </div>

              <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
                {unreadNotifications.length === 0 ? (
                  <div className="p-6 text-center text-slate-400 text-sm">
                    No unread notifications
                  </div>
                ) : (
                  unreadNotifications.slice(0, 5).map((n, idx) => (
                    <div
                      key={`${n.id}-${idx}`}
                      onClick={() => {
                        markNotificationRead(n.id);
                        setCurrentView('notifications');
                        setShowNotifMenu(false);
                      }}
                      className="p-3.5 hover:bg-slate-50 cursor-pointer transition-colors flex gap-3 items-start"
                    >
                      <div className="p-2 rounded-lg bg-slate-100 text-slate-600 shrink-0">
                        {n.type === 'overdue_case' ? (
                          <AlertTriangle className="w-4 h-4 text-amber-600" />
                        ) : n.type === 'escalation' ? (
                          <ShieldCheck className="w-4 h-4 text-rose-600" />
                        ) : (
                          <FileText className="w-4 h-4 text-slate-500" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold text-slate-900 truncate">{n.title}</div>
                        <div className="text-xs text-slate-600 line-clamp-2 mt-0.5">{n.message}</div>
                        <div className="text-[10px] text-slate-400 mt-1">{n.created_at}</div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="px-4 py-2 border-t border-slate-100 text-center">
                <button
                  onClick={() => {
                    setCurrentView('notifications');
                    setShowNotifMenu(false);
                  }}
                  className="text-xs font-semibold text-indigo-600 hover:text-indigo-700"
                >
                  View All Notifications & History →
                </button>
              </div>
            </div>
          )}
        </div>

        {/* User Profile Menu */}
        <div ref={userMenuContainerRef} className="relative shrink-0">
          <button
            onClick={() => {
              setShowUserMenu(!showUserMenu);
              setShowNotifMenu(false);
            }}
            className="h-11 flex items-center gap-2.5 p-1 pr-2.5 hover:bg-slate-100 rounded-xl transition-colors active:scale-[0.98] text-left cursor-pointer shrink-0"
          >
            <div className="w-9 h-9 rounded-full bg-indigo-100 text-indigo-700 font-bold flex items-center justify-center text-xs shadow-inner border border-indigo-200/60 shrink-0">
              {getUserInitials(user?.name)}
            </div>
            <div className="hidden md:flex flex-col justify-center text-left">
              <span className="font-semibold text-xs text-slate-900 leading-tight truncate max-w-[150px]">
                {user?.name || 'My Account'}
              </span>
              <span className="text-[10px] text-slate-500 font-medium leading-tight mt-0.5 truncate max-w-[150px]">
                {user?.role}
              </span>
            </div>
          </button>

          {showUserMenu && (
            <div className="absolute right-0 top-full mt-2 w-56 bg-white rounded-xl shadow-xl border border-slate-200 py-2 z-50">
              <div className="px-4 py-2 border-b border-slate-100">
                <div className="font-semibold text-sm text-slate-900">{user?.name || 'My Account'}</div>
                <div className="text-xs text-slate-500">{user?.email}</div>
                <span className="inline-block mt-1 px-2 py-0.5 text-[10px] font-semibold bg-indigo-50 text-indigo-600 rounded">
                  {user?.role}
                </span>
              </div>
              <button
                onClick={() => {
                  setCurrentView('settings');
                  setShowUserMenu(false);
                }}
                className="w-full text-left px-4 py-2 text-xs text-slate-700 hover:bg-slate-50 flex items-center gap-2"
              >
                <User className="w-4 h-4 text-slate-400" />
                Settings & Preferences
              </button>
              <div className="border-t border-slate-100 my-1" />
              <button
                onClick={logout}
                className="w-full text-left px-4 py-2 text-xs text-rose-600 hover:bg-rose-50 flex items-center gap-2 font-medium"
              >
                <LogOut className="w-4 h-4 text-rose-500" />
                Sign Out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};

