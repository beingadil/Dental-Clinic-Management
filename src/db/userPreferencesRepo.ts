/**
 * Per-user preferences store (D4, migration 014). One JSON row per user —
 * UI zoom and personal toggles follow the person, not the machine.
 * The legacy global blob (settings:preferences:global) remains the
 * fallback for users who have not saved preferences yet.
 */
import { getDatabase } from './core';

export interface StoredUserPreferences {
  user_id: string;
  value: unknown;
  updated_at: string;
}

export const userPreferencesRepo = {
  get(userId: string): unknown | undefined {
    const row = getDatabase().get<{ value: string }>('SELECT value FROM user_preferences WHERE user_id = ?', [userId]);
    if (!row) return undefined;
    try {
      return JSON.parse(row.value);
    } catch {
      return undefined;
    }
  },

  set(userId: string, value: unknown): void {
    getDatabase().run(
      `INSERT INTO user_preferences (user_id, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [userId, JSON.stringify(value), new Date().toISOString()]
    );
  },

  delete(userId: string): void {
    getDatabase().run('DELETE FROM user_preferences WHERE user_id = ?', [userId]);
  },
};
