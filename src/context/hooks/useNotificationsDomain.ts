import { useCallback } from 'react';
import type { AppNotification } from '../../types';
import { notificationsRepo } from '../../db/repos';
import { isDatabaseReady } from '../../db/core';
import { mirrorSet } from './domainState';
import {
  buildGenericNotification,
  prependUniqueNotifications,
} from '../../services/notificationDomain';

/**
 * Notification domain logic (audit finding F2) — the read/unread/archive/
 * delete/list management plus the generic add path, extracted from AppContext.
 * Consumes the raw notifications state from useBillingDomain; exposes the exact
 * same function surface AppContext offered before, so the context value and
 * every consumer stay unchanged.
 */
export function useNotificationsDomain(
  notifications: AppNotification[],
  setNotifications: React.Dispatch<React.SetStateAction<AppNotification[]>>,
  onBulkDelete?: (count: number) => void,
) {
  const dbWrite = (fn: () => void): void => {
    if (!isDatabaseReady()) return;
    try {
      fn();
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.error('[cutover] DB write failed:', e?.message || e);
    }
  };

  /** Insert fresh notification(s) with the shared dedupe-on-prepend rule. */
  const pushNotifications = useCallback(
    (fresh: AppNotification | AppNotification[]) => {
      const list = Array.isArray(fresh) ? fresh : [fresh];
      setNotifications((prev) => prependUniqueNotifications(prev, list));
    },
    [setNotifications],
  );

  const markNotificationRead = (id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true, read: true } : n)));
  };

  const markNotificationUnread = (id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: false, read: false } : n)));
  };

  const markAllNotificationsRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true, read: true })));
  };

  const clearReadNotifications = () => {
    setNotifications((prev) => prev.filter((n) => !n.is_read && !n.read));
  };

  const clearAllNotifications = () => {
    setNotifications([]);
  };

  const archiveNotification = (id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_archived: true } : n)));
  };

  const restoreNotification = (id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_archived: false } : n)));
  };

  const deleteNotification = (id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  };

  const bulkDeleteNotifications = (ids: string[]) => {
    setNotifications((prev) => prev.filter((n) => !ids.includes(n.id)));
    onBulkDelete?.(ids.length);
  };

  const addNotification = (n: Omit<AppNotification, 'id' | 'created_at'>) => {
    pushNotifications(buildGenericNotification(n as any, `notif-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`));
  };

  return {
    pushNotifications,
    markNotificationRead,
    markNotificationUnread,
    markAllNotificationsRead,
    clearReadNotifications,
    clearAllNotifications,
    archiveNotification,
    restoreNotification,
    deleteNotification,
    bulkDeleteNotifications,
    addNotification,
  };
}
