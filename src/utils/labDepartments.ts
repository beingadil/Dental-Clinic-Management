/**
 * Bench departments.
 *
 * A dental lab routes a case through physical benches, not just statuses: the
 * milling station, the waxing bench, the sintering furnace. The schema gained a
 * `cases.department` column (migration 015) so the dashboard can report real
 * bench load instead of a guess.
 *
 * This list is the single source of truth for both the case form's selector
 * and the workload panel's rows, so the two can never disagree about what the
 * departments are.
 *
 * `UNASSIGNED` is a real, visible state rather than a silent bucket: existing
 * cases have no department, and showing them as "Unassigned" tells the user
 * there is data to fill in instead of implying the bench is empty.
 */

export const LAB_DEPARTMENTS = [
  'CAD / CAM',
  'Waxing',
  'Sintering',
  'Porcelain',
  'Acrylic',
  'Welding',
  'Finishing',
  'QC',
] as const;

export type LabDepartment = (typeof LAB_DEPARTMENTS)[number];

/** Shown for cases whose department has never been set. */
export const UNASSIGNED = 'Unassigned' as const;

/** Every label the workload panel can render, assigned or not. */
export const departmentLabel = (department?: string | null): string =>
  (department || '').trim() || UNASSIGNED;

export const isRealDepartment = (department?: string | null): boolean =>
  LAB_DEPARTMENTS.includes((department || '').trim() as LabDepartment);