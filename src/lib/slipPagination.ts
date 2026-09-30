/**
 * A4 6-up job-slip pagination.
 *
 * One A4 sheet carries exactly six 100 × 95 mm slips (2 columns × 3 rows).
 * Selection order is authoritative — never re-sorted. The sixth position on a
 * sheet must never spill onto the next page (chunking by 6 guarantees it).
 *
 *   1 job  → 1 page [1 slip]
 *   6 jobs → 1 page
 *   7 jobs → 2 pages [6, 1]
 *  13 jobs → 3 pages [6, 6, 1]
 */

export const SLIPS_PER_SHEET = 6;

export function chunkSlipsForA4<T>(slips: T[]): T[][] {
  const pages: T[][] = [];
  for (let i = 0; i < slips.length; i += SLIPS_PER_SHEET) {
    pages.push(slips.slice(i, i + SLIPS_PER_SHEET));
  }
  return pages;
}
