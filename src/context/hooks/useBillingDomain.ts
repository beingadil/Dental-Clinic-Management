import { useState } from 'react';
import { Invoice, AdvancePayment, AccountAdjustment, JournalEntry, AuditEvent, ReconciliationItem, SavedVoucher, AppNotification } from '../../types';
import { INITIAL_NOTIFICATIONS } from '../../data/initialData';
import { reconciliationRepo } from '../../db/repos';
import { hydrateAllFromDb, dbMirror, dbRows, sqliteDb } from './domainState';

/**
 * Billing domain state — invoices, advances, adjustments, journal, audit,
 * vouchers, reconciliation and notifications. Extracted from AppContext with
 * an identical surface: values plus raw setters, so restore/wipe flows keep
 * setting them directly. Persistence stays in AppContext's sync effect.
 */
export function useBillingDomain() {
  const [invoices, setInvoices] = useState<Invoice[]>(() => {
    if (dbMirror['invoices']) return dbMirror['invoices'] as Invoice[];
    return sqliteDb.invoices.getAll();
  });

  const [notifications, setNotifications] = useState<AppNotification[]>(() => {
    if (dbMirror['notifications']) return dbMirror['notifications'] as AppNotification[];
    const fromDb = sqliteDb.notifications.getAll();
    const parsed: AppNotification[] = fromDb.length > 0 ? fromDb : INITIAL_NOTIFICATIONS;
    const seen = new Set<string>();
    const safeList = Array.isArray(parsed) ? parsed : INITIAL_NOTIFICATIONS;
    return safeList.map((n, idx) => {
      let id = n.id;
      if (!id || seen.has(id)) {
        id = `notif-${Date.now()}-${idx}-${Math.random().toString(36).substring(2, 6)}`;
      }
      seen.add(id);
      return { ...n, id };
    });
  });

  const [savedVouchers, setSavedVouchers] = useState<SavedVoucher[]>(() => {
    if (dbMirror['savedVouchers']) return dbMirror['savedVouchers'] as SavedVoucher[];
    return sqliteDb.vouchers.getAll();
  });
  const [advancePayments, setAdvancePayments] = useState<AdvancePayment[]>(() => {
    if (dbMirror['advancePayments']) return dbMirror['advancePayments'] as AdvancePayment[];
    return sqliteDb.advancePayments.getAll();
  });
  const [accountAdjustments, setAccountAdjustments] = useState<AccountAdjustment[]>(() => {
    if (dbMirror['accountAdjustments']) return dbMirror['accountAdjustments'] as AccountAdjustment[];
    return sqliteDb.adjustments.getAll();
  });
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>(() => {
    if (dbMirror['journalEntries']) return dbMirror['journalEntries'] as JournalEntry[];
    return sqliteDb.journalEntries.getAll();
  });
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>(() => {
    if (dbMirror['auditEvents']) return dbMirror['auditEvents'] as AuditEvent[];
    return sqliteDb.audit.getAll();
  });
  const [reconciliationItems, setReconciliationItems] = useState<ReconciliationItem[]>(() => dbRows('reconciliationItems', () => reconciliationRepo.all() as ReconciliationItem[]));

  return {
    invoices, setInvoices,
    notifications, setNotifications,
    savedVouchers, setSavedVouchers,
    advancePayments, setAdvancePayments,
    accountAdjustments, setAccountAdjustments,
    journalEntries, setJournalEntries,
    auditEvents, setAuditEvents,
    reconciliationItems, setReconciliationItems,
  };
}
