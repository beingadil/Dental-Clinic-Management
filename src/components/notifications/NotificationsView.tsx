import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { AppNotification, DentalCase } from '../../types';
import { 
  Bell, 
  AlertTriangle, 
  DollarSign, 
  Info, 
  Check, 
  Trash2, 
  CheckCheck, 
  ExternalLink,
  Archive,
  RotateCcw,
  Eye,
  EyeOff,
  Filter,
  Search,
  PlusCircle,
  Sparkles,
  Layers,
  FileText,
  Clock,
  CheckCircle2,
  X,
  Stethoscope,
  Building2,
  Receipt
} from 'lucide-react';

export const NotificationsView: React.FC = () => {
  const { 
    notifications, 
    markNotificationRead,
    markNotificationUnread,
    markAllNotificationsRead,
    clearReadNotifications,
    clearAllNotifications,
    archiveNotification,
    restoreNotification,
    deleteNotification,
    addNotification,
    setCurrentView,
    setSearchTerm,
    cases,
    setSelectedCaseForModal
  } = useApp();

  const [activeTab, setActiveTab] = useState<'all' | 'unread' | 'overdue' | 'billing' | 'status' | 'archived'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showTestModal, setShowTestModal] = useState(false);
  const [testNotificationType, setTestNotificationType] = useState<AppNotification['type']>('overdue_case');
  const [testTitle, setTestTitle] = useState('');
  const [testMessage, setTestMessage] = useState('');
  const [confirmClearAll, setConfirmClearAll] = useState(false);

  // Filter notifications based on tab and search
  const filteredNotifications = useMemo(() => {
    return notifications.filter((n) => {
      const isArchived = Boolean(n.is_archived);
      const isRead = Boolean(n.is_read ?? n.read);

      // Tab filtering
      if (activeTab === 'archived') {
        if (!isArchived) return false;
      } else {
        if (isArchived) return false;
        if (activeTab === 'unread' && isRead) return false;
        if (activeTab === 'overdue' && n.type !== 'overdue_case') return false;
        if (activeTab === 'billing' && n.type !== 'unpaid_invoice') return false;
        if (activeTab === 'status' && n.type !== 'status_change') return false;
      }

      // Search query filtering
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchTitle = (n.title || '').toLowerCase().includes(query);
        const matchMsg = (n.message || '').toLowerCase().includes(query);
        const matchCase = (n.case_number || '').toLowerCase().includes(query);
        return matchTitle || matchMsg || matchCase;
      }

      return true;
    });
  }, [notifications, activeTab, searchQuery]);

  // Counts for tabs
  const counts = useMemo(() => {
    const active = notifications.filter(n => !n.is_archived);
    return {
      all: active.length,
      unread: active.filter(n => !n.is_read && !n.read).length,
      overdue: active.filter(n => n.type === 'overdue_case').length,
      billing: active.filter(n => n.type === 'unpaid_invoice').length,
      status: active.filter(n => n.type === 'status_change').length,
      archived: notifications.filter(n => n.is_archived).length,
    };
  }, [notifications]);

  // Selection handlers
  const handleSelectAll = () => {
    if (selectedIds.length === filteredNotifications.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredNotifications.map(n => n.id));
    }
  };

  const handleToggleSelect = (id: string) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  // Bulk actions
  const handleBulkMarkRead = () => {
    selectedIds.forEach(id => markNotificationRead(id));
    setSelectedIds([]);
  };

  const handleBulkMarkUnread = () => {
    selectedIds.forEach(id => markNotificationUnread(id));
    setSelectedIds([]);
  };

  const handleBulkArchive = () => {
    selectedIds.forEach(id => archiveNotification(id));
    setSelectedIds([]);
  };

  const handleBulkDelete = () => {
    selectedIds.forEach(id => deleteNotification(id));
    setSelectedIds([]);
  };

  // Target entity navigation
  const handleOpenTarget = (n: AppNotification) => {
    markNotificationRead(n.id);
    
    // Check if associated with a case
    if (n.case_id || n.case_number) {
      const foundCase = cases.find(c => 
        (n.case_id && c.id === n.case_id) || 
        (n.case_number && c.case_number === n.case_number)
      );
      if (foundCase) {
        setSelectedCaseForModal(foundCase);
        return;
      }
      if (n.case_number) {
        setSearchTerm(n.case_number);
      }
      setCurrentView('cases');
      return;
    }

    if (n.invoice_id) {
      setCurrentView('billing');
      return;
    }

    if (n.lab_id) {
      setCurrentView('labs');
      return;
    }

    // Default fallback
    setCurrentView('cases');
  };

  // Handle adding test alert
  const handleSendTestNotification = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const title = testTitle.trim() || 'Urgent Case Status Notice';
    const message = testMessage.trim() || 'Case #DS-0001 requires high priority technician review before final zirconia sintering.';
    
    addNotification({
      title,
      message,
      type: testNotificationType,
      priority: 'high',
      case_number: 'DS-0001',
      link_url: '/cases',
    });

    setTestTitle('');
    setTestMessage('');
    setShowTestModal(false);
  };

  const getNotificationIcon = (type: AppNotification['type']) => {
    switch (type) {
      case 'overdue_case':
        return <AlertTriangle className="w-4 h-4 text-rose-600" />;
      case 'unpaid_invoice':
        return <DollarSign className="w-4 h-4 text-emerald-600" />;
      case 'status_change':
        return <CheckCircle2 className="w-4 h-4 text-blue-600" />;
      case 'system':
      default:
        return <Bell className="w-4 h-4 text-indigo-600" />;
    }
  };

  const getTypeBadge = (type: AppNotification['type']) => {
    switch (type) {
      case 'overdue_case':
        return <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-rose-100 text-rose-700">OVERDUE</span>;
      case 'unpaid_invoice':
        return <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-emerald-100 text-emerald-700">BILLING</span>;
      case 'status_change':
        return <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-blue-100 text-blue-700">STATUS UPDATE</span>;
      default:
        return <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-purple-100 text-purple-700">ALERT</span>;
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
            <span>Notification & Alert Center</span>
            {counts.unread > 0 && (
              <span className="px-2.5 py-0.5 text-xs font-bold bg-rose-100 text-rose-700 rounded-full border border-rose-200 animate-pulse">
                {counts.unread} unread
              </span>
            )}
          </h1>
          <p className="text-xs md:text-sm text-slate-500 mt-1">
            Real-time notifications for overdue laboratory cases, clinic doctor communications, billing milestones, and quality control alerts.
          </p>
        </div>

        {/* Global Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Create / Trigger Demo Notification */}
          <button
            onClick={() => setShowTestModal(true)}
            className="px-3.5 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold text-xs rounded-xl flex items-center gap-1.5 transition-colors border border-indigo-200 shadow-2xs cursor-pointer"
            title="Create a test notification"
          >
            <PlusCircle className="w-4 h-4 text-indigo-600" />
            <span>Send Test Alert</span>
          </button>

          {/* Mark All As Read */}
          <button
            onClick={markAllNotificationsRead}
            disabled={counts.unread === 0}
            className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed text-slate-700 font-bold text-xs rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer"
            title="Mark all notifications as read"
          >
            <CheckCheck className="w-4 h-4 text-blue-600" />
            <span>Mark All Read</span>
          </button>

          {/* Clear Read Notifications */}
          <button
            onClick={clearReadNotifications}
            className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer"
            title="Delete all read notifications"
          >
            <Check className="w-4 h-4 text-slate-500" />
            <span>Clear Read</span>
          </button>

          {/* Clear All Notifications */}
          {confirmClearAll ? (
            <div className="flex items-center gap-1 bg-rose-50 p-1 rounded-xl border border-rose-200">
              <span className="text-[11px] font-bold text-rose-700 px-1">Confirm Clear All?</span>
              <button
                onClick={() => {
                  clearAllNotifications();
                  setConfirmClearAll(false);
                }}
                className="px-2 py-1 bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-bold rounded-lg cursor-pointer"
              >
                Yes, Clear
              </button>
              <button
                onClick={() => setConfirmClearAll(false)}
                className="px-2 py-1 bg-slate-200 hover:bg-slate-300 text-slate-700 text-[11px] font-bold rounded-lg cursor-pointer"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmClearAll(true)}
              className="px-3 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 font-semibold text-xs rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer"
              title="Clear all notifications"
            >
              <Trash2 className="w-4 h-4" />
              <span>Clear All</span>
            </button>
          )}
        </div>
      </div>

      {/* Tabs and In-Module Search Filter */}
      <div className="bg-white rounded-xl p-3 border border-slate-200 shadow-2xs flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        {/* Filter Tabs */}
        <div className="flex items-center gap-1 overflow-x-auto pb-1 md:pb-0">
          {[
            { id: 'all', label: 'All Alerts', count: counts.all },
            { id: 'unread', label: 'Unread', count: counts.unread },
            { id: 'overdue', label: 'Overdue Cases', count: counts.overdue },
            { id: 'billing', label: 'Invoices & Billing', count: counts.billing },
            { id: 'status', label: 'Status Updates', count: counts.status },
            { id: 'archived', label: 'Archived', count: counts.archived },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
                activeTab === tab.id
                  ? 'bg-slate-900 text-white shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <span>{tab.label}</span>
              <span className={`text-[11px] px-1.5 py-0.5 rounded font-bold ${
                activeTab === tab.id ? 'bg-slate-800 text-slate-200' : 'bg-slate-100 text-slate-600'
              }`}>
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        {/* Search within notifications */}
        <div className="relative min-w-[240px]">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter notifications..."
            className="w-full pl-9 pr-7 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-slate-400 text-slate-900 placeholder:text-slate-400"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 cursor-pointer"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Bulk Action Bar (Visible when notifications are selected) */}
      {selectedIds.length > 0 && (
        <div className="bg-slate-900 text-white rounded-xl p-3 px-4 shadow-sm flex flex-wrap items-center justify-between gap-3 animate-in fade-in duration-150">
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={selectedIds.length === filteredNotifications.length && filteredNotifications.length > 0}
              onChange={handleSelectAll}
              className="rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4 cursor-pointer"
            />
            <span className="text-xs font-semibold">
              {selectedIds.length} notification{selectedIds.length > 1 ? 's' : ''} selected
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleBulkMarkRead}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white text-xs font-medium rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Eye className="w-3.5 h-3.5" />
              <span>Mark Read</span>
            </button>
            <button
              onClick={handleBulkMarkUnread}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white text-xs font-medium rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <EyeOff className="w-3.5 h-3.5" />
              <span>Mark Unread</span>
            </button>
            <button
              onClick={handleBulkArchive}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white text-xs font-medium rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Archive className="w-3.5 h-3.5" />
              <span>Archive</span>
            </button>
            <button
              onClick={handleBulkDelete}
              className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-medium rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete</span>
            </button>
            <button
              onClick={() => setSelectedIds([])}
              className="p-1 text-slate-300 hover:text-white rounded-lg ml-1 cursor-pointer"
              title="Deselect All"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Notifications List */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
        {/* List Header with Select All */}
        <div className="px-4 py-3 bg-slate-50/80 border-b border-slate-200 flex items-center justify-between text-xs font-semibold text-slate-600">
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={filteredNotifications.length > 0 && selectedIds.length === filteredNotifications.length}
              onChange={handleSelectAll}
              disabled={filteredNotifications.length === 0}
              className="rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4 cursor-pointer"
            />
            <span>Select All in this View</span>
          </div>
          <span className="text-[11px] text-slate-400">
            Showing {filteredNotifications.length} item{filteredNotifications.length === 1 ? '' : 's'}
          </span>
        </div>

        {/* List Content */}
        {filteredNotifications.length === 0 ? (
          <div className="p-12 text-center text-slate-400 space-y-3">
            <div className="w-12 h-12 mx-auto rounded-full bg-slate-100 flex items-center justify-center text-slate-400">
              <Bell className="w-6 h-6" />
            </div>
            <div>
              <p className="font-bold text-sm text-slate-700">No notifications found</p>
              <p className="text-xs text-slate-400 mt-0.5">
                {searchQuery ? `No alerts matched your search "${searchQuery}".` : 'You are all caught up! No notifications in this category.'}
              </p>
            </div>
            <div className="pt-2">
              <button
                onClick={() => setShowTestModal(true)}
                className="px-4 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-semibold text-xs rounded-xl inline-flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <PlusCircle className="w-3.5 h-3.5" />
                <span>Generate Test Alert</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filteredNotifications.map((n) => {
              const isRead = Boolean(n.is_read ?? n.read);
              const isSelected = selectedIds.includes(n.id);
              const isArchived = Boolean(n.is_archived);

              return (
                <div
                  key={n.id}
                  className={`p-4 transition-all flex items-start justify-between gap-4 group ${
                    !isRead ? 'bg-indigo-50/20' : 'hover:bg-slate-50/80'
                  } ${isSelected ? 'bg-indigo-50/40' : ''}`}
                >
                  {/* Checkbox and Icon */}
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div className="pt-1 flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => handleToggleSelect(n.id)}
                        className="rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4 cursor-pointer"
                      />
                    </div>

                    <div className={`p-2.5 rounded-xl shrink-0 mt-0.5 ${
                      !isRead ? 'bg-indigo-100/70' : 'bg-slate-100'
                    }`}>
                      {getNotificationIcon(n.type)}
                    </div>

                    {/* Notification Body */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {getTypeBadge(n.type)}
                        <h4 className={`text-xs font-bold ${!isRead ? 'text-slate-900' : 'text-slate-700'}`}>
                          {n.title}
                        </h4>
                        {!isRead && (
                          <span className="w-2 h-2 rounded-full bg-indigo-600 shrink-0" title="Unread" />
                        )}
                        {n.priority === 'high' && (
                          <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase rounded bg-rose-50 text-rose-600 border border-rose-200">
                            High Priority
                          </span>
                        )}
                      </div>

                      <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                        {n.message}
                      </p>

                      <div className="flex items-center gap-3 mt-2 flex-wrap text-[11px] text-slate-400">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          <span>{n.created_at || 'Just now'}</span>
                        </span>

                        {n.case_number && (
                          <span className="font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded">
                            Case #{n.case_number}
                          </span>
                        )}

                        {n.invoice_id && (
                          <span className="font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">
                            Invoice #{n.invoice_id}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Notification Action Buttons (Always working) */}
                  <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
                    {/* Primary target link button */}
                    <button
                      onClick={() => handleOpenTarget(n)}
                      className="px-2.5 py-1.5 bg-indigo-50 hover:bg-indigo-600 text-indigo-700 hover:text-white rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                      title="View Details"
                    >
                      <span>View</span>
                      <ExternalLink className="w-3 h-3" />
                    </button>

                    {/* Toggle Read/Unread Button */}
                    {isRead ? (
                      <button
                        onClick={() => markNotificationUnread(n.id)}
                        className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                        title="Mark as unread"
                      >
                        <EyeOff className="w-4 h-4" />
                      </button>
                    ) : (
                      <button
                        onClick={() => markNotificationRead(n.id)}
                        className="p-1.5 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
                        title="Mark as read"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                    )}

                    {/* Archive / Restore Button */}
                    {isArchived ? (
                      <button
                        onClick={() => restoreNotification(n.id)}
                        className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                        title="Restore to active inbox"
                      >
                        <RotateCcw className="w-4 h-4" />
                      </button>
                    ) : (
                      <button
                        onClick={() => archiveNotification(n.id)}
                        className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                        title="Archive notification"
                      >
                        <Archive className="w-4 h-4" />
                      </button>
                    )}

                    {/* Delete Button */}
                    <button
                      onClick={() => deleteNotification(n.id)}
                      className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                      title="Delete notification"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Test Notification Creation Modal */}
      {showTestModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-4 animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-indigo-100 text-indigo-700 rounded-xl">
                  <Sparkles className="w-4 h-4" />
                </div>
                <h3 className="font-bold text-base text-slate-900">Send Test Laboratory Notification</h3>
              </div>
              <button
                onClick={() => setShowTestModal(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSendTestNotification} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Alert Category
                </label>
                <select
                  value={testNotificationType}
                  onChange={(e) => setTestNotificationType(e.target.value as any)}
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 font-medium"
                >
                  <option value="overdue_case">Overdue Case Alert</option>
                  <option value="unpaid_invoice">Unpaid Invoice Alert</option>
                  <option value="status_change">Quality Control / Status Update</option>
                  <option value="system">General System Announcement</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Notification Title
                </label>
                <input
                  type="text"
                  value={testTitle}
                  onChange={(e) => setTestTitle(e.target.value)}
                  placeholder="e.g. Urgent Case #DS-0001: QC Review Required"
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 font-medium"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Alert Message
                </label>
                <textarea
                  value={testMessage}
                  onChange={(e) => setTestMessage(e.target.value)}
                  rows={3}
                  placeholder="e.g. Dr. Tariq called requesting rush delivery for patient Fatima Ali (Zirconia Crown, Shade A2)."
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 font-medium"
                  required
                />
              </div>

              {/* Quick Presets */}
              <div className="space-y-1.5">
                <span className="text-[11px] font-semibold text-slate-400">Quick Presets:</span>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setTestNotificationType('overdue_case');
                      setTestTitle('Rush Crown Case Overdue (Dr. Tariq)');
                      setTestMessage('Case #DS-0001 for patient Fatima Ali has exceeded the promised turnaround window. Please expedite sintering.');
                    }}
                    className="px-2.5 py-1 text-[10px] font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg"
                  >
                    Overdue Rush
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setTestNotificationType('unpaid_invoice');
                      setTestTitle('Payment Pending: Apex Dental Clinic');
                      setTestMessage('Invoice #INV-2026-003 with balance PKR 45,000 is 14 days overdue. Automated reminder sent.');
                    }}
                    className="px-2.5 py-1 text-[10px] font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg"
                  >
                    Overdue Invoice
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setTestNotificationType('status_change');
                      setTestTitle('QC Passed: All-on-4 Hybrid Denture');
                      setTestMessage('Case #DS-0004 passed final quality control check and is packaged for courier dispatch.');
                    }}
                    className="px-2.5 py-1 text-[10px] font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg"
                  >
                    QC Passed
                  </button>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowTestModal(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-xs cursor-pointer flex items-center gap-1.5"
                >
                  <Bell className="w-3.5 h-3.5" />
                  <span>Send Notification</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
