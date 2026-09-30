import { describe, it, expect } from 'vitest';
import { chunkSlipsForA4, SLIPS_PER_SHEET } from '../../src/lib/slipPagination';

/**
 * A4 6-up batch pagination — acceptance contract from the job-slip spec:
 * 1/2/3 jobs = 1 page; 6 = 1 page; 7 = 2 pages; 12 = 2; 13 = 3.
 * Order must be preserved exactly (selection order is authoritative).
 */

const mk = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ case_number: `DS-${String(i + 1).padStart(4, '0')}` }));

describe('chunkSlipsForA4', () => {
  it('keeps a single job on one page', () => {
    const pages = chunkSlipsForA4(mk(1));
    expect(pages).toHaveLength(1);
    expect(pages[0]).toHaveLength(1);
  });

  it('fits exactly six jobs on one page — the 6th never spills', () => {
    const pages = chunkSlipsForA4(mk(6));
    expect(pages).toHaveLength(1);
    expect(pages[0]).toHaveLength(SLIPS_PER_SHEET);
  });

  it('sends the 7th job to a second page', () => {
    const pages = chunkSlipsForA4(mk(7));
    expect(pages).toHaveLength(2);
    expect(pages[0]).toHaveLength(6);
    expect(pages[1]).toHaveLength(1);
  });

  it('fits twelve jobs on two full pages', () => {
    const pages = chunkSlipsForA4(mk(12));
    expect(pages).toHaveLength(2);
    expect(pages[0]).toHaveLength(6);
    expect(pages[1]).toHaveLength(6);
  });

  it('sends the 13th job to a third page', () => {
    const pages = chunkSlipsForA4(mk(13));
    expect(pages).toHaveLength(3);
    expect(pages.map((p) => p.length)).toEqual([6, 6, 1]);
  });

  it('handles two and three jobs on one page', () => {
    expect(chunkSlipsForA4(mk(2))).toHaveLength(1);
    expect(chunkSlipsForA4(mk(3))).toHaveLength(1);
  });

  it('returns no pages for an empty selection', () => {
    expect(chunkSlipsForA4([])).toEqual([]);
  });

  it('never reorders — selection order is authoritative', () => {
    const slips = [
      { case_number: 'DS-0008' },
      { case_number: 'DS-0012' },
      { case_number: 'DS-0014' },
      { case_number: 'DS-0020' },
      { case_number: 'DS-0021' },
      { case_number: 'DS-0025' },
      { case_number: 'DS-0030' },
    ];
    const pages = chunkSlipsForA4(slips);
    expect(pages[0].map((s) => s.case_number)).toEqual([
      'DS-0008', 'DS-0012', 'DS-0014', 'DS-0020', 'DS-0021', 'DS-0025',
    ]);
    expect(pages[1].map((s) => s.case_number)).toEqual(['DS-0030']);
  });
});
