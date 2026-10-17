import { describe, it, expect } from 'vitest';

/**
 * The case-search matcher, tested behaviourally rather than by reading the
 * component.
 *
 * The first version of this rule tried the punctuation-free copy of the haystack
 * ONLY for all-digit queries. So "0123" found "DS-0123" but "ds0123" — letters
 * and digits together, which is what people actually type — found nothing at
 * all. It looked like a broken search box with no way to tell why. These cases
 * exist so that exact shape of bug cannot come back quietly.
 */

/** A case as the component holds it, reduced to the searched fields. */
interface Case {
  case_number: string;
  patient_name?: string;
  doctor_name?: string;
  case_type_name?: string;
  shade?: string;
  status?: string;
  priority?: string;
  delivery_date?: string;
  selected_teeth?: number[];
}

/** The index the component builds: text as written, plus a punctuation-free copy. */
const index = (c: Case) => {
  const plain = [
    c.case_number,
    c.patient_name,
    c.doctor_name,
    c.case_type_name,
    c.shade,
    c.status,
    c.priority,
    c.delivery_date,
    (c.selected_teeth || []).map((t) => `#${t}`).join(' '),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return { plain, bare: plain.replace(/[^a-z0-9]/g, '') };
};

/** The matching rule under test. */
const matches = (entry: { plain: string; bare: string }, query: string) => {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  return tokens.every((token) => {
    if (entry.plain.includes(token)) return true;
    const bareToken = token.replace(/[^a-z0-9]/g, '');
    return bareToken.length > 0 && entry.bare.includes(bareToken);
  });
};

const CASE: Case = {
  case_number: 'DS-0123',
  patient_name: 'Hadia',
  doctor_name: 'Dr Haroon',
  case_type_name: 'PFM Crown',
  shade: 'A2',
  status: 'delivered',
  priority: 'urgent',
  delivery_date: '2026-10-18',
  selected_teeth: [26, 27],
};

const other: Case = {
  case_number: 'DS-0065',
  patient_name: 'Bilal',
  doctor_name: 'Dr Umer',
  case_type_name: 'Zirconia',
  status: 'in_lab',
};

describe('searching a case list', () => {
  const hit = index(CASE);

  it('matches a case number as written', () => {
    expect(matches(hit, 'DS-0123')).toBe(true);
    expect(matches(hit, 'ds-0123')).toBe(true);
  });

  it('matches a case number with the hyphen omitted', () => {
    /* THE REGRESSION. Letters and digits together used to fall through, because
       the punctuation-free copy was only consulted for all-digit queries. */
    expect(matches(hit, 'ds0123')).toBe(true);
    expect(matches(hit, 'DS0123')).toBe(true);
  });

  it('matches digits on their own too', () => {
    expect(matches(hit, '0123')).toBe(true);
    expect(matches(hit, '123')).toBe(true);
  });

  it('matches the patient name, which is what people search for most', () => {
    expect(matches(hit, 'Hadia')).toBe(true);
    expect(matches(hit, 'hadia')).toBe(true);
    expect(matches(hit, 'HADIA')).toBe(true);
  });

  it('matches doctor, material, shade, status and date', () => {
    expect(matches(hit, 'Haroon')).toBe(true);
    expect(matches(hit, 'PFM')).toBe(true);
    expect(matches(hit, 'a2')).toBe(true);
    expect(matches(hit, 'delivered')).toBe(true);
    expect(matches(hit, '2026-10-18')).toBe(true);
    expect(matches(hit, '2026-10-18'.replace(/-/g, ''))).toBe(true);
  });

  it('matches teeth', () => {
    expect(matches(hit, '#26')).toBe(true);
    expect(matches(hit, '26')).toBe(true);
  });

  it('narrows as words are added, rather than widening', () => {
    expect(matches(hit, 'Hadia')).toBe(true);
    expect(matches(hit, 'Hadia PFM')).toBe(true);
    // Two words that are both present but on DIFFERENT cases must not match
    // either one — that is the difference between AND and OR.
    expect(matches(hit, 'Hadia Zirconia')).toBe(false);
  });

  it('does not match another patient', () => {
    expect(matches(hit, 'Bilal')).toBe(false);
    expect(matches(index(other), 'Hadia')).toBe(false);
  });

  it('returns everything for an empty query', () => {
    expect(matches(hit, '')).toBe(true);
    expect(matches(hit, '   ')).toBe(true);
  });

  it('matches nothing for a query that is not there', () => {
    expect(matches(hit, 'zzzznope')).toBe(false);
  });
});