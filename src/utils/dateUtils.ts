/**
 * Date and time utilities for Dental Solutions LIMS & ERP
 *
 * EVERY stored business date comes from this module's helpers, and they all
 * read the OPERATOR'S LOCAL calendar day. The billing, ledger and audit tabs
 * default their window to `getTodayStr()`, so a stored date has to come from
 * the same clock.
 *
 * `new Date().toISOString()` must never be used for a stored date or
 * timestamp: it converts to UTC. In PKT (UTC+5) everything booked between
 * 00:00 and 05:00 local — the hours a clinic actually closes its books — was
 * stamped with *yesterday*, so freshly created invoices and payments silently
 * dropped out of the default Today filter and only appeared after the date
 * filter was cleared. SLA delivery dates were a day early for the same reason.
 */

/** Any Date rendered as a local `YYYY-MM-DD` day (never the UTC day). */
export const getDateStr = (d: Date = new Date()): string => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const getTodayStr = (): string => getDateStr();

export const getTomorrowStr = (): string => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return getDateStr(d);
};

export const getYesterdayStr = (): string => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return getDateStr(d);
};

export const getDaysOffsetStr = (days: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return getDateStr(d);
};

/**
 * Local wall-clock stamp `YYYY-MM-DD HH:mm` — the shape stored on
 * `created_at` / `updated_at` / audit `timestamp`. Slicing 10 characters off
 * this yields the local business day, which is what every tab filters on.
 */
export const getNowStamp = (): string => {
  const d = new Date();
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${getDateStr(d)} ${hours}:${minutes}`;
};

export const formatDate = (dateStr?: string): string => {
  if (!dateStr) return 'N/A';
  try {
    const parts = dateStr.split('T')[0].split('-');
    if (parts.length === 3) {
      const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return dateStr;
  }
};

export const formatTimeAgo = (dateStr?: string): string => {
  if (!dateStr) return '';
  try {
    const now = Date.now();
    const then = new Date(dateStr).getTime();
    if (isNaN(then)) return dateStr;
    const diffSec = Math.floor((now - then) / 1000);

    if (diffSec < 60) return 'Just now';
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
    if (diffSec < 172800) return 'Yesterday';
    if (diffSec < 604800) return `${Math.floor(diffSec / 86400)}d ago`;
    return formatDate(dateStr);
  } catch {
    return dateStr;
  }
};

export const daysDiff = (targetDateStr: string, baseDateStr = getTodayStr()): number => {
  try {
    const t = new Date(targetDateStr.split('T')[0]).getTime();
    const b = new Date(baseDateStr.split('T')[0]).getTime();
    return Math.round((t - b) / (1000 * 60 * 60 * 24));
  } catch {
    return 0;
  }
};
