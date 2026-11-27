// Person (partner/referrer) groupings for clinics. Stored locally so an
// operator can set them once and they survive across sessions. A clinic can
// belong to at most one person; the person's commission rate applies to the
// billed value of that clinic's work in the chosen window.
export type PersonRateScope = 'person' | 'clinic';

export interface Person {
  id: string;
  name: string;
  contact?: string;
  /** Default commission rate (0–100) applied to the billed value. */
  commissionRate: number;
  /** Whether the rate is taken from the person or overridden per clinic. */
  rateScope: PersonRateScope;
  createdAt: string;
  updatedAt: string;
}

export interface ClinicAssignment {
  /** Person id, or null when unassigned. */
  personId: string | null;
  /** Optional per-clinic override rate (0–100). Used when rateScope === 'clinic'. */
  rateOverride?: number | null;
}

const PERSONS_KEY = 'ds.persons.v1';
const ASSIGNMENTS_KEY = 'ds.clinicPersonMap.v1';

const safeParse = <T>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const safeWrite = (key: string, value: unknown): void => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore (private mode / quota)
  }
};

export const loadPersons = (): Person[] => safeParse<Person[]>(PERSONS_KEY, []);

export const savePersons = (persons: Person[]): void => safeWrite(PERSONS_KEY, persons);

export const loadAssignments = (): Record<string, ClinicAssignment> =>
  safeParse<Record<string, ClinicAssignment>>(ASSIGNMENTS_KEY, {});

export const saveAssignments = (assignments: Record<string, ClinicAssignment>): void =>
  safeWrite(ASSIGNMENTS_KEY, assignments);

export const newPersonId = (): string =>
  `per_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

export const personForLab = (
  labId: string,
  persons: Person[],
  assignments: Record<string, ClinicAssignment>
): Person | null => {
  const a = assignments[labId];
  if (!a || !a.personId) return null;
  return persons.find((p) => p.id === a.personId) ?? null;
};

export const effectiveRate = (
  labId: string,
  persons: Person[],
  assignments: Record<string, ClinicAssignment>
): number => {
  const a = assignments[labId];
  if (!a || !a.personId) return 0;
  const person = persons.find((p) => p.id === a.personId);
  if (!person) return 0;
  if (person.rateScope === 'clinic' && a.rateOverride != null) return a.rateOverride;
  return person.commissionRate;
};

/** Commission = rate% of the billed value. */
export const commissionFor = (billed: number, rate: number): number =>
  Math.round((billed * rate) / 100);
