import { personsRepo, labsRepo } from '../db/repos';

// Person (partner/referrer) groupings for clinics. Persisted in the local
// SQLite/IndexedDB database (migration 032) so they survive DB export/restore
// and stay consistent across sessions. localStorage is kept as a cache so a
// read before the engine is ready (or on a build without the new table) never
// crashes.
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

const PERSONS_CACHE_KEY = 'ds.persons.v1';
const ASSIGNMENTS_CACHE_KEY = 'ds.clinicPersonMap.v1';

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

const fromDbPerson = (row: any): Person => ({
  id: row.id,
  name: row.name,
  contact: row.contact ?? undefined,
  commissionRate: row.commissionRate ?? row.commission_rate ?? 0,
  rateScope: (row.rateScope ?? row.rate_scope ?? 'person') as PersonRateScope,
  createdAt: row.createdAt ?? row.created_at ?? new Date().toISOString(),
  updatedAt: row.updatedAt ?? row.updated_at ?? new Date().toISOString(),
});

export const loadPersons = (): Person[] => {
  try {
    const rows = personsRepo.all();
    const persons = rows.map(fromDbPerson);
    safeWrite(PERSONS_CACHE_KEY, persons);
    return persons;
  } catch {
    return safeParse<Person[]>(PERSONS_CACHE_KEY, []);
  }
};

export const savePersons = (persons: Person[]): void => {
  try {
    const existing = personsRepo.all().map((r: any) => r.id);
    const nextIds = new Set(persons.map((p) => p.id));
    // Remove persons no longer present.
    for (const id of existing) {
      if (!nextIds.has(id)) personsRepo.delete(id);
    }
    // Upsert the rest.
    for (const p of persons) {
      const row = personsRepo.byId(p.id);
      if (row) {
        personsRepo.update(p.id, {
          name: p.name,
          contact: p.contact ?? null,
          commission_rate: p.commissionRate,
          rate_scope: p.rateScope,
        });
      } else {
        personsRepo.insert({
          id: p.id,
          name: p.name,
          contact: p.contact ?? null,
          commissionRate: p.commissionRate,
          rateScope: p.rateScope,
          createdAt: p.createdAt,
        });
      }
    }
  } catch {
    // fall back to cache only
  }
  safeWrite(PERSONS_CACHE_KEY, persons);
};

export const loadAssignments = (): Record<string, ClinicAssignment> => {
  try {
    const labs = labsRepo.all();
    const map: Record<string, ClinicAssignment> = {};
    for (const lab of labs) {
      if (lab.person_id) {
        map[lab.id] = {
          personId: lab.person_id,
          rateOverride: lab.commission_rate ?? null,
        };
      }
    }
    safeWrite(ASSIGNMENTS_CACHE_KEY, map);
    return map;
  } catch {
    return safeParse<Record<string, ClinicAssignment>>(ASSIGNMENTS_CACHE_KEY, {});
  }
};

export const saveAssignments = (assignments: Record<string, ClinicAssignment>): void => {
  try {
    const labs = labsRepo.all();
    for (const lab of labs) {
      const a = assignments[lab.id];
      const personId = a?.personId ?? null;
      const rateOverride = (a?.rateOverride ?? null) as number | null;
      // Only write when something changed to avoid needless updates.
      if (lab.person_id !== personId || lab.commission_rate !== rateOverride) {
        labsRepo.update(lab.id, { person_id: personId, commission_rate: rateOverride });
      }
    }
  } catch {
    // fall back to cache only
  }
  safeWrite(ASSIGNMENTS_CACHE_KEY, assignments);
};

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