/**
 * Read-only retrieval over the build-time RAG index (SQLite FTS4 + BM25).
 * Injection-proof: every query term is quoted before it reaches MATCH.
 */
import { ensureRagStore, getRagManifest } from './ragStore';

export interface RagHit {
  path: string;
  module: string;
  type: 'doc' | 'code' | 'style' | 'config' | 'changelog';
  symbol: string | null;
  heading_path: string;
  citation: string;
  excerpt: string;
  score: number;
  sha: string;
}

export interface RagQueryOptions {
  modules?: string[];
  types?: Array<RagHit['type']>;
  pathPrefix?: string;
  limit?: number;
}

const fold = (s: string) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export const tokenize = (s: string): string[] => {
  const m = fold(s).match(/[a-z0-9_]+/g);
  return m && m.length ? m : [];
};

export const normalizeQuery = (raw: string): { ftsMatch: string; terms: string[] } => {
  const tokens = tokenize(raw || '').slice(0, 24);
  if (!tokens.length) return { ftsMatch: '', terms: [] };
  const terms = tokens.slice(0, -1).map((t) => `"${t}"`);
  terms.push(`"${tokens[tokens.length - 1]}"*`);
  return { ftsMatch: terms.join(' '), terms: tokens };
};

export const bm25Score = ({
  tf, df, docLen, avgLen, nDocs, k1 = 1.2, b = 0.75,
}: { tf: number; df: number; docLen: number; avgLen: number; nDocs: number; k1?: number; b?: number }): number => {
  if (df <= 0 || nDocs <= 0 || docLen <= 0) return 0;
  const idf = Math.log(1 + (nDocs - df + 0.5) / (df + 0.5));
  const norm = k1 * (1 - b + (b * docLen) / (avgLen || docLen));
  return idf * ((tf * (k1 + 1)) / (tf + norm));
};

export const citationFor = (r: { path: string; symbol: string | null; heading_path: string }): string =>
  r.symbol ? `${r.path}:${r.symbol}` : `${r.path} › ${r.heading_path}`;

export const excerptFor = (content: string, terms: string[], maxLen = 240): string => {
  const low = fold(content);
  let idx = -1;
  for (const t of terms) { idx = low.indexOf(t); if (idx >= 0) break; }
  if (idx < 0) return content.slice(0, maxLen);
  const start = Math.max(0, idx - Math.floor(maxLen / 3));
  return content.slice(start, start + maxLen).trim();
};

/** Zone-weighted BM25 re-rank (symbol 3, heading 2, content 1). */
export async function searchRag(query: string, opts: RagQueryOptions = {}): Promise<RagHit[]> {
  const engine = await ensureRagStore();
  if (!engine) return [];
  const manifest = getRagManifest();
  const { ftsMatch, terms } = normalizeQuery(query);
  if (!ftsMatch) return [];

  try {
    const params: any[] = [ftsMatch];
    let filter = '';
    if (opts.modules?.length) { filter += ` AND c.module IN (${opts.modules.map(() => '?').join(',')})`; params.push(...opts.modules); }
    if (opts.types?.length) { filter += ` AND c.type IN (${opts.types.map(() => '?').join(',')})`; params.push(...opts.types); }
    if (opts.pathPrefix) { filter += ' AND c.path LIKE ? || \'%\''; params.push(opts.pathPrefix); }
    const limit = Math.max(1, Math.min(50, opts.limit ?? 6));

    const rows = engine.all<{ id: number; path: string; module: string; type: string; symbol: string | null; heading_path: string; content: string; sha: string }>(
      `SELECT c.* FROM rag_fts f JOIN rag_chunks c ON c.id = f.rowid WHERE rag_fts MATCH ?${filter} LIMIT 200`,
      params as any[],
    );
    if (!rows.length) return [];

    const nDocsRow = engine.get<{ value: number }>("SELECT value FROM rag_stats WHERE key='doc_count'");
    const avgRow = engine.get<{ value: number }>("SELECT value FROM rag_stats WHERE key='avg_len'");
    const nDocs = nDocsRow?.value ?? rows.length;
    const avgLen = avgRow?.value ?? 1;
    const dfRows = engine.all<{ term: string; df: number }>(
      `SELECT term, df FROM rag_df WHERE term IN (${terms.map(() => '?').join(',')})`,
      terms as any[],
    );
    const dfs = new Map(dfRows.map((r) => [r.term, r.df]));

    const zw = manifest?.zoneWeights ?? { symbol: 3, heading: 2, content: 1 };
    const scored = rows.map((row) => {
      const content = fold(row.content), heading = fold(row.heading_path), symbol = fold(row.symbol || '');
      let score = 0;
      for (const term of terms) {
        const tf = (content.split(term).length - 1) * zw.content
          + (heading.split(term).length - 1) * zw.heading
          + (symbol ? (symbol.split(term).length - 1) * zw.symbol : 0);
        const df = dfs.get(term) ?? 1;
        score += bm25Score({ tf, df, docLen: content.split(/\s+/).filter(Boolean).length || 1, avgLen, nDocs, k1: 1.2, b: 0.75 });
      }
      return { row, score };
    });
    scored.sort((a, b) => b.score - a.score || a.row.path.localeCompare(b.row.path));

    return scored.slice(0, limit).map(({ row, score }) => ({
      path: row.path, module: row.module, type: row.type as RagHit['type'],
      symbol: row.symbol, heading_path: row.heading_path,
      citation: citationFor(row), excerpt: excerptFor(row.content, terms),
      score, sha: row.sha,
    }));
  } catch {
    return []; // never let retrieval break the app
  }
}
