import { useState } from 'react';
import { Invoice, AdvancePayment, AccountAdjustment, JournalEntry, AuditEvent, ReconciliationItem, SavedVoucher, AppNotification } from '../../types';
import { INITIAL_NOTIFICATIONS } from '../../data/initialData';
import {
  reconciliationRepo, invoicesRepo, advancePaymentsRepo, adjustmentsRepo,
  journalRepo, vouchersRepo, auditRepo, notificationsRepo,
} from '../../db/repos';
import { hydrateAllFromDb, dbMirror, dbRows } from './domainState';

/**
 * Billing domain state — invoices, advances, adjustments, journal, audit,
 * vouchers, reconciliation and notifications. Extracted from AppContext with
 * an identical surface: values plus raw setters, so restore/wipe flows keep
 * setting them directly. Persistence stays in AppContext's sync effect.
 */
export function useBillingDomain() {
  const [invoices, setInvoices] = useState<Invoice[]>(() => {
    if (dbMirror['invoices']) return dbMirror['invoices'] as Invoice[];
    return dbRows('invoices', () => invoicesRepo.all() as Invoice[]) || [];
  });

  const [notifications, setNotifications] = useState<AppNotification[]>(() => {
    if (dbMirror['notifications']) return dbMirror['notifications'] as AppNotification[];
    const fromDb = dbRows('notifications', () => notificationsRepo.all() as AppNotification[]) || [];
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
    return dbRows('savedVouchers', () => vouchersRepo.all() as SavedVoucher[]) || [];
  });
  const [advancePayments, setAdvancePayments] = useState<AdvancePayment[]>(() => {
    if (dbMirror['advancePayments']) return dbMirror['advancePayments'] as AdvancePayment[];
    return dbRows('advancePayments', () => advancePaymentsRepo.all() as AdvancePayment[]) || [];
  });
  const [accountAdjustments, setAccountAdjustments] = useState<AccountAdjustment[]>(() => {
    if (dbMirror['accountAdjustments']) return dbMirror['accountAdjustments'] as AccountAdjustment[];
    return dbRows('accountAdjustments', () => adjustmentsRepo.all() as AccountAdjustment[]) || [];
  });
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>(() => {
    if (dbMirror['journalEntries']) return dbMirror['journalEntries'] as JournalEntry[];
    return dbRows('journalEntries', () => journalRepo.all() as JournalEntry[]) || [];
  });
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>(() => {
    if (dbMirror['auditEvents']) return dbMirror['auditEvents'] as AuditEvent[];
    return dbRows('auditEvents', () => auditRepo.all() as AuditEvent[]) || [];
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
