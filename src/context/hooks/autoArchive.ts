import type { DentalCase } from '../../types';

/** Cases delivered more than this many days ago are auto-archived on boot. */
export const AUTO_ARCHIVE_DAYS = 30;

const DAY_MS = 86400000;

/**
 * Pick the cases the auto-archive sweep should archive.
 *
 * Selection rules:
 *  - status must be exactly 'delivered' (the terminal workstation state)
 *  - the case must not already be archived (archived_at set)
 *  - the delivery date must be strictly older than (today - 30 days)
 *
 * The cutoff is computed against `today` (injectable for tests). Cases carry no
 * `delivered_at` timestamp, so `delivery_date` — the day the case was or was
 * due to be delivered — is the age basis, matching the Archive tab's date
 * filter. Deliberately pure: no React state, no DB access, no clock reads.
 */
export function selectCasesToAutoArchive(cases: DentalCase[], today: Date = new Date()): DentalCase[] {
  const cutoffMs = today.getTime() - AUTO_ARCHIVE_DAYS * DAY_MS;
  const cutoff = cutoffMs - (cutoffMs % DAY_MS); // midnight UTC of the cutoff day
  return cases.filter((c) => {
    if (c.status !== 'delivered') return false;
    if (c.archived_at) return false;
    if (!c.delivery_date) return false;
    const d = new Date(c.delivery_date);
    if (Number.isNaN(d.getTime())) return false;
    return d.getTime() < cutoff;
  });
}
