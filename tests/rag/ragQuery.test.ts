import { describe, it, expect } from 'vitest';
import { normalizeQuery, tokenize, bm25Score, citationFor, excerptFor } from '../../src/services/ragQuery';

describe('RAG query math', () => {
  it('tokenizes into lowercase [a-z0-9_] and folds accents', () => {
    expect(tokenize('ClinicÁN balance 99,500 PKR')).toEqual(['clinican', 'balance', '99', '500', 'pkr']);
  });

  it('builds an injection-proof MATCH expression with a prefix on the last term', () => {
    expect(normalizeQuery('" OR 1=1 --')).toEqual({ ftsMatch: '"or" "1" "1"*', terms: ['or', '1', '1'] });
    expect(normalizeQuery(' Mir Dental balance ').ftsMatch).toBe('"mir" "dental" "balance"*');
  });

  it('empty queries produce no MATCH', () => {
    expect(normalizeQuery('  !!! ')).toEqual({ ftsMatch: '', terms: [] });
  });

  it('bm25 ranks rare terms above common ones', () => {
    const rare = bm25Score({ tf: 3, df: 1, docLen: 50, avgLen: 50, nDocs: 1000 });
    const common = bm25Score({ tf: 3, df: 900, docLen: 50, avgLen: 50, nDocs: 1000 });
    expect(rare).toBeGreaterThan(common);
  });

  it('citations use path:symbol when a symbol exists, else heading path', () => {
    expect(citationFor({ path: 'src/services/x.ts', symbol: 'getBalance', heading_path: 'x' }))
      .toBe('src/services/x.ts:getBalance');
    expect(citationFor({ path: 'docs/A.md', symbol: null, heading_path: 'A › B' })).toBe('docs/A.md › A › B');
  });

  it('excerpt prefers the first matching term window', () => {
    const out = excerptFor('alpha beta gamma delta epsilon', ['gamma'], 20);
    expect(out).toContain('gamma');
  });
});
