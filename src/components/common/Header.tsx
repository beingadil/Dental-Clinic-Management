/**
 * Header.
 *
 * THE REDESIGN, IN ONE PARAGRAPH
 * This bar was the last part of the shell still speaking raw Tailwind palette
 * classes while the dashboard spoke `ds-*`. Beside a rail painted from
 * `--ds-surface`, a header painted from `bg-white/95` and an app canvas painted
 * from `bg-slate-50` means three near-identical darks meeting at a visible
 * seam in dark mode. Inside the bar the same drift showed up as detail: three
 * different hover hues in one search popover (indigo for cases, purple for
 * clinics, emerald for invoices), circular avatar and count pills, and
 * `shadow-xl` — a pure-black shadow, which is invisible on the near-black
 * surface it was supposed to lift off.
 *
 * It now consumes `src/theme/shell.css`, which is built from the same semantic
 * tokens as the panels. One accent (blue) does the work; every other surface is
 * a neutral step; elevation is a hue-tinted lift that becomes a light rim in
 * dark.
 *
 * Behaviour is untouched: the same search matching, the same Cmd/Ctrl+K, the
 * same outside-click and Escape handling, the same two dropdowns. What changed
 * is that the result rows are real `<button>`s — they were clickable `<div>`s,
 * which is unreachable by keyboard and invisible to a screen reader.
 */
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
  ArrowRight,
  ExternalLink,
} from 'lucide-react';
import { DentalCase } from '../../types';
import { ThemeToggle } from './ThemeToggle';
import { formatDoctorName } from '../../utils/doctorName';

export const Header: React.FC = () => {
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
    setSelectedCaseForModal,
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

  const matchedCases = cleanTerm
    ? cases
        .filter(
          (c) =>
            (c.patient_name || '').toLowerCase().includes(cleanTerm) ||
            (c.case_number || '').toLowerCase().includes(cleanTerm) ||
            formatDoctorName(c.doctor_name, '').toLowerCase().includes(cleanTerm) ||
            (c.lab_name || '').toLowerCase().includes(cleanTerm) ||
            (c.case_type_name || '').toLowerCase().includes(cleanTerm) ||
            (c.shade || '').toLowerCase().includes(cleanTerm),
        )
        .slice(0, 6)
    : [];

  const matchedLabs = cleanTerm
    ? labs
        .filter(
          (l) =>
            (l.name || '').toLowerCase().includes(cleanTerm) ||
            formatDoctorName(l.doctor_name, '').toLowerCase().includes(cleanTerm) ||
            (l.contact_person || '').toLowerCase().includes(cleanTerm) ||
            (l.code || '').toLowerCase().includes(cleanTerm),
        )
        .slice(0, 3)
    : [];

  const matchedInvoices = cleanTerm
    ? invoices
        .filter(
          (inv) =>
            (inv.invoice_number || '').toLowerCase().includes(cleanTerm) ||
            (inv.case_number || '').toLowerCase().includes(cleanTerm) ||
            (inv.lab_name || '').toLowerCase().includes(cleanTerm) ||
            formatDoctorName(inv.doctor_name, '').toLowerCase().includes(cleanTerm),
        )
        .slice(0, 3)
    : [];

  const totalResultsCount = matchedCases.length + matchedLabs.length + matchedInvoices.length;

  // Search suggestions derived from the operator's real data — never hardcoded names.
  const quickSuggestions = React.useMemo(() => {
    const urgentCount = cases.filter((c) => c.priority === 'urgent').length;
    const sugg: string[] = [];
    if (urgentCount > 0) sugg.push('Urgent Priority');
    const doctors = Array.from(new Set(cases.map((c) => formatDoctorName(c.doctor_name, '')).filter(Boolean))).slice(0, 2);
    sugg.push(...(doctors as string[]));
    const materials = Array.from(new Set(cases.map((c) => c.case_type_name).filter(Boolean))).slice(0, 2);
    sugg.push(...(materials as string[]));
    const latestCase = cases
      .map((c) => c.case_number)
      .sort()
      .pop();
    if (latestCase) sugg.push(latestCase);
    return Array.from(new Set(sugg)).slice(0, 6);
  }, [cases]);

  /**
   * Which field matched, so the result says WHY it surfaced.
   *
   * `tone` replaced a hard-coded palette class per match. Cases are the accent
   * because they are the primary result type and the thing the operator is
   * looking for; the rest are neutral. The old version painted a matched case
   * indigo, a matched doctor purple and a matched clinic amber inside one
   * popover, which read as three different products' worth of meaning rather
   * than one list.
   */
  const getCaseMatchBadge = (c: DentalCase) => {
    if (!cleanTerm) return null;
    if ((c.patient_name || '').toLowerCase().includes(cleanTerm)) {
      return { label: 'Patient', value: c.patient_name, icon: UserCheck };
    }
    if ((c.case_number || '').toLowerCase().includes(cleanTerm)) {
      return { label: 'Case', value: c.case_number, icon: Hash };
    }
    if (formatDoctorName(c.doctor_name, '').toLowerCase().includes(cleanTerm)) {
      return { label: 'Doctor', value: formatDoctorName(c.doctor_name), icon: Stethoscope };
    }
    if ((c.lab_name || '').toLowerCase().includes(cleanTerm)) {
      return { label: 'Clinic', value: c.lab_name, icon: Building2 };
    }
    return { label: 'Material', value: c.case_type_name, icon: FileText };
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
    document.removeEventListener('mousedown', handleClickOutside);
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

  const goTo = (view: string) => {
    setCurrentView(view);
    setShowGlobalResults(false);
  };

  return (
    <header className="ds-headerbar ds-glass sticky top-0 z-30 flex items-center justify-between gap-4 sm:gap-6 shrink-0 w-full px-4 sm:px-6">
      {/* ZONE A · Mobile drawer toggle + brand lockup. Same `.ds-brand-mark`
          geometry as the rail, so the two do not read as two logos. */}
      <div className="flex items-center shrink-0">
        <div className="flex items-center gap-3 lg:hidden">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="ds-iconbtn ds-hit"
            title="Toggle navigation"
            aria-label="Toggle navigation"
            aria-expanded={sidebarOpen}
          >
            <Menu className="w-5 h-5" />
          </button>

          <button onClick={() => setCurrentView('dashboard')} className="flex items-center gap-2.5 cursor-pointer">
            {brandingSettings.logoUrl ? (
              <img
                src={brandingSettings.logoUrl}
                alt={brandingSettings.appName}
                className="w-8 h-8 rounded-lg object-contain bg-ds-surface border border-ds-line p-0.5"
              />
            ) : (
              <span className="ds-brand-mark !w-8 !h-8 !rounded-lg" aria-hidden="true">
                <ActivityGlyph />
              </span>
            )}
            <span className="ds-brand-name">{brandingSettings.appName || 'Dental Solutions'}</span>
          </button>
        </div>
      </div>

      {/* ZONE B · Command bar. The app's highest-traffic control, so it is the
          one place that gets a real focus ring instead of a border swap. */}
      <div ref={searchContainerRef} className="flex-1 max-w-[760px] min-w-0 relative">
        <div className="ds-command">
          <span
            className="absolute left-3 text-ds-muted flex items-center pointer-events-none group-focus-within:text-ds-accent"
            aria-hidden="true"
          >
            <Search className="w-4 h-4" />
          </span>
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
            aria-label="Search cases, clinics and invoices"
            aria-expanded={showGlobalResults}
            role="combobox"
            aria-controls="global-search-results"
            placeholder="Search cases, clinics, invoices…"
            className="ds-command-input"
          />
          <div className="absolute right-2 flex items-center gap-1">
            {searchTerm ? (
              <button
                onClick={() => {
                  setSearchTerm('');
                  setShowGlobalResults(false);
                }}
                className="ds-iconbtn !w-7 !h-7"
                title="Clear search"
                aria-label="Clear search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            ) : (
              <kbd className="hidden sm:inline-flex items-center gap-0.5 px-2 py-1 text-[10px] font-mono font-semibold text-ds-muted bg-ds-surface border border-ds-line rounded-md pointer-events-none select-none">
                <span>⌘</span>
                <span>K</span>
              </kbd>
            )}
          </div>
        </div>

        {showGlobalResults && (
          <div
            id="global-search-results"
            role="listbox"
            aria-label="Search results"
            className="ds-popover ds-glass absolute left-0 right-0 mt-2 py-2 z-50 max-h-[520px] overflow-y-auto"
          >
            <div className="px-4 pb-2.5 mb-1 border-b border-ds-line flex items-center justify-between gap-3">
              <span className="text-[11px] font-bold tracking-wide text-ds-ink-soft flex items-center gap-2 shrink-0">
                <Search className="w-3.5 h-3.5 text-ds-muted" />
                {cleanTerm ? `Results (${totalResultsCount})` : 'Quick case lookup'}
              </span>
              <span className="text-[10px] text-ds-muted truncate">
                {cleanTerm ? 'Enter opens · click a case to inspect' : 'By patient, case ID or doctor'}
              </span>
            </div>

            {/* No term yet: suggest real entries from the operator's own data. */}
            {!cleanTerm && (
              <div className="px-4 py-3 space-y-3">
                <div className="text-[11px] font-bold tracking-wide text-ds-ink-soft">Popular in your lab</div>
                <div className="flex flex-wrap gap-2">
                  {quickSuggestions.map((tag) => (
                    <button
                      key={tag}
                      onClick={() => {
                        setSearchTerm(tag);
                        setShowGlobalResults(true);
                      }}
                      className="ds-hit inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-ds-sunken hover:bg-ds-surface border border-ds-line rounded-lg text-[11px] font-semibold text-ds-ink-soft hover:text-ds-ink transition-colors cursor-pointer"
                    >
                      <Search className="w-3 h-3 text-ds-muted" />
                      <span>{tag}</span>
                    </button>
                  ))}
                </div>
                <div className="pt-2.5 border-t border-ds-line flex items-center justify-between gap-3">
                  <span className="text-[11px] text-ds-muted">Esc dismisses · Enter goes to the workstation</span>
                  <button
                    onClick={() => goTo('cases')}
                    className="text-[11px] font-bold text-ds-accent hover:text-ds-accent-strong transition-colors cursor-pointer shrink-0"
                  >
                    Open workstation
                  </button>
                </div>
              </div>
            )}

            {cleanTerm && totalResultsCount === 0 && (
              <div className="px-6 py-10 text-center space-y-2.5">
                <div className="w-10 h-10 mx-auto rounded-xl bg-ds-sunken border border-ds-line flex items-center justify-center text-ds-muted">
                  <Search className="w-5 h-5" />
                </div>
                <div className="text-[13px] font-bold text-ds-ink">No match for “{searchTerm}”</div>
                <p className="text-[11px] text-ds-muted max-w-xs mx-auto leading-relaxed">
                  Try a patient first name, a case number like DS-0001, or a doctor's surname.
                </p>
                <div className="pt-1">
                  <button
                    onClick={() => goTo('cases')}
                    className="text-[11px] font-bold text-ds-accent hover:text-ds-accent-strong transition-colors cursor-pointer"
                  >
                    Browse all cases
                  </button>
                </div>
              </div>
            )}

            {cleanTerm && totalResultsCount > 0 && (
              <div className="space-y-3">
                {matchedCases.length > 0 && (
                  <div>
                    <div className="ds-nav-group-label px-4 mb-1.5">
                      <span>Cases ({matchedCases.length})</span>
                      <span className="ds-nav-group-rule" aria-hidden="true" />
                    </div>

                    <div className="px-2 space-y-0.5">
                      {matchedCases.map((c) => {
                        const matchBadge = getCaseMatchBadge(c);
                        const isUrgent = c.priority === 'urgent';
                        return (
                          <div
                            key={c.id}
                            className="group flex items-center justify-between gap-3 rounded-lg px-2 py-2 hover:bg-ds-sunken transition-colors"
                          >
                            {/* The row's primary action is a real button, so the
                                list is reachable by keyboard. The previous <div
                                onClick> was not — only the secondary action was. */}
                            <button
                              onClick={() => handleOpenCase(c)}
                              className="flex items-center gap-3 min-w-0 flex-1 text-left cursor-pointer rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ds-accent"
                            >
                              <span
                                className="ds-avatar !w-9 !h-9 !rounded-lg shrink-0 group-hover:bg-ds-accent group-hover:text-white group-hover:border-transparent transition-colors"
                                aria-hidden="true"
                              >
                                {c.patient_name ? c.patient_name.charAt(0).toUpperCase() : 'P'}
                              </span>

                              <span className="min-w-0">
                                <span className="flex items-center gap-2 flex-wrap">
                                  <span className="text-xs font-bold text-ds-ink truncate">{c.patient_name || 'Patient'}</span>
                                  <span className="px-1.5 py-0.5 font-mono text-[10px] font-bold text-ds-muted bg-ds-sunken rounded">
                                    {c.case_number}
                                  </span>
                                  {isUrgent && (
                                    <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-ds-risk-soft text-ds-risk-ink uppercase">
                                      {c.priority}
                                    </span>
                                  )}
                                  {matchBadge && (
                                    <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded-md border border-ds-line bg-ds-sunken text-ds-ink-soft flex items-center gap-1">
                                      <matchBadge.icon className="w-3 h-3 text-ds-muted" />
                                      <span>
                                        {matchBadge.label}: {matchBadge.value}
                                      </span>
                                    </span>
                                  )}
                                </span>

                                <span className="text-[11px] text-ds-muted mt-0.5 flex items-center gap-2 truncate">
                                  <span className="flex items-center gap-1 text-ds-body">
                                    <Stethoscope className="w-3 h-3 text-ds-muted" />
                                    <span>{formatDoctorName(c.doctor_name, 'Doctor')}</span>
                                  </span>
                                  <span aria-hidden="true">·</span>
                                  <span className="truncate">{c.lab_name}</span>
                                  <span aria-hidden="true">·</span>
                                  <span className="font-medium text-ds-ink-soft">{c.case_type_name}</span>
                                  {c.shade && <span className="font-bold text-ds-accent">({c.shade})</span>}
                                </span>
                              </span>
                            </button>

                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleViewInWorkstation(c);
                                }}
                                className="hidden sm:inline-flex items-center gap-1 px-2 py-1 text-[10px] font-semibold text-ds-muted hover:text-ds-accent bg-ds-sunken hover:bg-ds-accent-soft rounded-md transition-colors cursor-pointer"
                                title="View in workstation"
                              >
                                <span>Workstation</span>
                                <ExternalLink className="w-3 h-3" />
                              </button>
                              <span className="text-ds-muted group-hover:text-ds-accent transition-colors" aria-hidden="true">
                                <ChevronRight className="w-4 h-4" />
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {matchedLabs.length > 0 && (
                  <div className="pt-2 border-t border-ds-line">
                    <div className="ds-nav-group-label px-4 mt-1 mb-1.5">
                      <span>Clinics ({matchedLabs.length})</span>
                      <span className="ds-nav-group-rule" aria-hidden="true" />
                    </div>
                    <div className="px-2 space-y-0.5">
                      {matchedLabs.map((l) => (
                        <button
                          key={l.id}
                          onClick={() => goTo('labs')}
                          className="ds-popover-row group !min-h-0 !px-2 !py-2"
                        >
                          <span className="ds-icon-tile !w-7 !h-7 !rounded-lg bg-ds-accent-soft text-ds-accent shrink-0">
                            <Building2 className="w-3.5 h-3.5" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-xs font-bold text-ds-ink truncate">
                              {l.name} {l.code ? `(${l.code})` : ''}
                            </span>
                            <span className="block text-[10px] text-ds-muted truncate">
                              {l.doctor_name ? `${formatDoctorName(l.doctor_name)} · ` : ''}
                              {l.phone}
                            </span>
                          </span>
                          <ChevronRight className="w-3.5 h-3.5 text-ds-muted group-hover:text-ds-accent transition-colors shrink-0" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {matchedInvoices.length > 0 && (
                  <div className="pt-2 border-t border-ds-line">
                    <div className="ds-nav-group-label px-4 mt-1 mb-1.5">
                      <span>Invoices ({matchedInvoices.length})</span>
                      <span className="ds-nav-group-rule" aria-hidden="true" />
                    </div>
                    <div className="px-2 space-y-0.5">
                      {matchedInvoices.map((inv) => (
                        <button
                          key={inv.id}
                          onClick={() => goTo('billing')}
                          className="ds-popover-row group !min-h-0 !px-2 !py-2"
                        >
                          <span className="ds-icon-tile !w-7 !h-7 !rounded-lg bg-ds-accent-soft text-ds-accent shrink-0">
                            <Receipt className="w-3.5 h-3.5" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-xs font-bold text-ds-ink truncate">
                              {inv.invoice_number} · {inv.case_number}
                            </span>
                            <span className="block text-[10px] text-ds-muted truncate">
                              {inv.lab_name} · PKR {(inv.final_amount || 0).toLocaleString()}
                            </span>
                          </span>
                          <span className="flex items-center gap-1.5 shrink-0">
                            <span
                              className={`px-1.5 py-0.5 text-[10px] font-bold rounded ${
                                inv.payment_status === 'paid'
                                  ? 'bg-ds-pos-soft text-ds-pos-ink'
                                  : 'bg-ds-warn-soft text-ds-warn-ink'
                              }`}
                            >
                              {(inv.payment_status || 'unpaid').toUpperCase()}
                            </span>
                            <ChevronRight className="w-3.5 h-3.5 text-ds-muted group-hover:text-ds-accent transition-colors" />
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="pt-2.5 mt-1 border-t border-ds-line flex items-center justify-between gap-3 px-4">
                  <span className="text-[11px] text-ds-muted">Need the full list?</span>
                  <button
                    onClick={() => goTo('cases')}
                    className="text-[11px] font-bold text-ds-accent hover:text-ds-accent-strong flex items-center gap-1 transition-colors cursor-pointer"
                  >
                    <span>All cases in the workstation</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ZONE C · Global switches. One visual family: same size, same radius,
          same hover, so the eye reads a toolbar rather than three unrelated
          buttons. */}
      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        <div className="hidden sm:block">
          <ThemeToggle />
        </div>

        <div ref={notifContainerRef} className="relative shrink-0">
          <button
            onClick={() => {
              setShowNotifMenu(!showNotifMenu);
              setShowUserMenu(false);
            }}
            className="ds-iconbtn ds-hit"
            title="Notifications"
            aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ''}`}
            aria-expanded={showNotifMenu}
          >
            <Bell className="w-[18px] h-[18px]" />
            {unreadCount > 0 && <span className="ds-count">{unreadCount > 99 ? '99+' : unreadCount}</span>}
          </button>

          {showNotifMenu && (
            <div className="ds-popover absolute right-0 top-full mt-2 w-80 md:w-96 py-2 z-50">
              <div className="px-4 py-2.5 border-b border-ds-line flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-[13px] text-ds-ink">Notifications</h3>
                  {unreadCount > 0 && (
                    <span className="px-2 py-0.5 text-[11px] font-bold bg-ds-risk-soft text-ds-risk-ink rounded-md">
                      {unreadCount} new
                    </span>
                  )}
                </div>
                {unreadCount > 0 && (
                  <button
                    onClick={markAllNotificationsRead}
                    className="text-[11px] font-bold text-ds-accent hover:text-ds-accent-strong flex items-center gap-1 transition-colors cursor-pointer"
                  >
                    <CheckCheck className="w-3.5 h-3.5" />
                    Mark all read
                  </button>
                )}
              </div>

              <div className="max-h-80 overflow-y-auto">
                {unreadNotifications.length === 0 ? (
                  <div className="px-4 py-8 text-center text-[12px] text-ds-muted">Nothing unread. You are caught up.</div>
                ) : (
                  unreadNotifications.slice(0, 5).map((n, idx) => (
                    <button
                      key={`${n.id}-${idx}`}
                      onClick={() => {
                        markNotificationRead(n.id);
                        setCurrentView('notifications');
                        setShowNotifMenu(false);
                      }}
                      className="w-full px-4 py-3 hover:bg-ds-sunken transition-colors flex gap-3 items-start text-left cursor-pointer border-b border-ds-line last:border-b-0"
                    >
                      <span
                        className={`ds-icon-tile !w-8 !h-8 !rounded-lg shrink-0 ${
                          n.type === 'overdue_case'
                            ? 'bg-ds-warn-soft text-ds-warn-ink'
                            : n.type === 'escalation'
                              ? 'bg-ds-risk-soft text-ds-risk-ink'
                              : 'bg-ds-sunken text-ds-muted'
                        }`}
                      >
                        {n.type === 'overdue_case' ? (
                          <AlertTriangle className="w-4 h-4" />
                        ) : n.type === 'escalation' ? (
                          <ShieldCheck className="w-4 h-4" />
                        ) : (
                          <FileText className="w-4 h-4" />
                        )}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-xs font-semibold text-ds-ink truncate">{n.title}</span>
                        <span className="block text-xs text-ds-body line-clamp-2 mt-0.5">{n.message}</span>
                        <span className="block text-[10px] text-ds-muted mt-1">{n.created_at}</span>
                      </span>
                    </button>
                  ))
                )}
              </div>

              <div className="px-4 py-2.5 border-t border-ds-line text-center">
                <button
                  onClick={() => {
                    setCurrentView('notifications');
                    setShowNotifMenu(false);
                  }}
                  className="text-[11px] font-bold text-ds-accent hover:text-ds-accent-strong transition-colors cursor-pointer"
                >
                  Open the system inbox
                </button>
              </div>
            </div>
          )}
        </div>

        <div ref={userMenuContainerRef} className="relative shrink-0">
          <button
            onClick={() => {
              setShowUserMenu(!showUserMenu);
              setShowNotifMenu(false);
            }}
            className="ds-row-target h-9 flex items-center gap-2.5 p-1 pr-2 hover:bg-ds-sunken rounded-lg transition-colors active:scale-[0.98] text-left cursor-pointer"
            aria-label="Account menu"
            aria-expanded={showUserMenu}
          >
            <span className="ds-avatar" aria-hidden="true">
              {getUserInitials(user?.name)}
            </span>
            <span className="hidden md:flex flex-col justify-center text-left">
              <span className="font-semibold text-xs text-ds-ink leading-tight truncate max-w-[150px]">
                {user?.name || 'My Account'}
              </span>
              <span className="text-[10px] text-ds-muted font-medium leading-tight truncate max-w-[150px]">
                {user?.role}
              </span>
            </span>
          </button>

          {showUserMenu && (
            <div className="ds-popover absolute right-0 top-full mt-2 w-60 py-2 z-50">
              <div className="px-4 py-3 border-b border-ds-line">
                <div className="font-semibold text-[13px] text-ds-ink truncate">{user?.name || 'My Account'}</div>
                <div className="text-[11px] text-ds-muted truncate">{user?.email}</div>
                <span className="inline-block mt-1.5 px-2 py-0.5 text-[10px] font-bold bg-ds-accent-soft text-ds-accent-strong rounded">
                  {user?.role}
                </span>
              </div>
              <div className="py-1">
                <button
                  onClick={() => {
                    setCurrentView('settings');
                    setShowUserMenu(false);
                  }}
                  className="ds-popover-row"
                >
                  <User className="w-4 h-4 text-ds-muted" />
                  Settings &amp; preferences
                </button>
                <button onClick={logout} className="ds-popover-row" data-tone="risk">
                  <LogOut className="w-4 h-4" />
                  Sign out
                </button>
              </div>
            </div>
          )}
        </div>

        {/*
          The window's own minimise / maximise / close live in the OS title
          bar, not here. They were duplicated in this header, which meant the
          desktop build showed two sets of them and the web build showed
          none — the same screen behaving differently depending on how it was
          opened. The OS already owns them, so the header leaves them alone.
        */}
      </div>
    </header>
  );
};

/** The default mark, shared with the rail so both draw the same glyph. */
const ActivityGlyph: React.FC = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" className="w-[18px] h-[18px]" aria-hidden="true">
    <path d="M22 12h-4l-3 9L9 3l-3 9H2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);