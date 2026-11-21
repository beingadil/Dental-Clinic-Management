/* Offline RAG index builder (git-tracked sources only). */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import initSqlJs from 'sql.js';

import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'public', 'rag');
const MANIFEST = path.join(OUT_DIR, 'rag-manifest.json');
const MIN_CHUNK = 80;
const MAX_CHUNK = 2000;
const EXCL_DIRS = /(public\/fonts|public\/icons|public\/vendor|src\/assets|src-tauri\/icons|src-tauri\/gen|src-tauri\/target|\.github|\.githooks|tests|src\/dev)/;
const EXCL_FILES = /(package-lock\.json|Cargo\.lock|docs\/explainer-video-script\.md|\.env|\.png$|\.jpg$|\.jpeg$|\.gif$|\.svg$|\.woff2$|\.wasm$)/;

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const fold = (s) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const tokenize = (s) => { const m = fold(String(s)).match(/[a-z0-9_]+/g); return m ? m : []; };
const moduleOf = (p) => {
  const comp = p.match(/^src\/(components\/([^/]+)|(db|context|services|utils|lib)|types\.ts)\//);
  if (comp) return comp[2] || 'core';
  if (p.startsWith('docs/') || /\.md$/i.test(p)) return 'docs';
  if (p.startsWith('scripts/')) return 'tooling';
  if (p.startsWith('src-tauri/')) return 'desktop';
  return 'other';
};
const typeOf = (p) => {
  if (/CHANGELOG\.md$/i.test(p)) return 'changelog';
  if (/\.css$/.test(p)) return 'style';
  if (/tauri\.conf\.json$|Cargo\.toml$/.test(p)) return 'config';
  if (/\.(md|markdown)$/i.test(p)) return 'doc';
  if (/\.(ts|tsx|rs|mjs)$/.test(p)) return 'code';
  return 'doc';
};
const corpusTier = (p) => {
  if (/(PRODUCT|README)\.md$/i.test(p)) return 0;
  if (p.startsWith('docs/')) return 1;
  if (/CHANGELOG\.md$/i.test(p)) return 2;
  if (p.startsWith('scripts/')) return 4;
  if (p.startsWith('src-tauri/')) return 5;
  if (p.startsWith('src/')) return 3;
  return 6;
};

function readTracked() {
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT }).toString().trim();
  const listing = execFileSync('git', ['ls-files', '-z', '-s'], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 })
    .toString().split('\0').filter(Boolean);
  const files = [];
  for (const line of listing) {
    const m = line.match(/^(\d+)\s+([0-9a-f]+)\s+\d+\t?(.*)$/);
    if (!m) continue;
    const [, , blobSha, rel] = m;
    const norm = rel.replace(/\\/g, '/');
    if (!/^(?:[^/]+\.md|src\/.*\.(ts|tsx|css|rs)|scripts\/.*\.mjs|src-tauri\/src\/.*\.rs|src-tauri\/(tauri\.conf\.json|Cargo\.toml))$/.test(norm)) continue;
    if (EXCL_DIRS.test(norm) || EXCL_FILES.test(norm)) continue;
    const abs = path.join(ROOT, norm);
    if (!fs.existsSync(abs)) continue;
    const size = fs.statSync(abs).size;
    if (size > 1024 * 1024) continue;
    files.push({ path: norm, blobSha, tier: corpusTier(norm), size });
  }
  files.sort((a, b) => a.tier - b.tier || a.path.localeCompare(b.path));
  return { commit, files };
}

function splitParagraphs(text, max) {
  const parts = text.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  const chunks = [];
  let buf = '';
  for (const part of parts) {
    if (part.length > max) {
      if (buf) chunks.push(buf); buf = '';
      for (let i = 0; i < part.length; i += max) chunks.push(part.slice(i, i + max));
      continue;
    }
    if ((buf + '\n\n' + part).trim().length > max) { chunks.push(buf); buf = part; } else buf = (buf ? buf + '\n\n' + part : part);
  }
  if (buf) chunks.push(buf);
  return chunks;
}

function chunkMarkdown(content) {
  const chunks = [];
  const stack = [];
  const lines = content.split(/\r?\n/);
  let inFence = false, buf = [], bufLen = 0, sinceFlush = 0;
  const flush = () => { const text = buf.join('\n').trim(); if (text.length >= MIN_CHUNK) chunks.push({ content: text, heading_path: stack.slice().join(' › ') }); buf = []; bufLen = 0; };
  for (const raw of lines) {
    const line = raw;
    if (/^\s*```/.test(line)) inFence = !inFence;
    const m = !inFence && line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (m) {
      flush();
      const level = m[1].length;
      stack.splice(level - 1);
      stack[level - 1] = m[2].trim();
      continue;
    }
    buf.push(line); bufLen += line.length + 1; sinceFlush += 1;
    if (bufLen >= MAX_CHUNK) flush();
    if (sinceFlush >= 400) flush();
  }
  flush();
  return chunks;
}

function chunkCss(content) {
  const chunks = [];
  const re = /([^{}]+)\{[^{}]*\}/g;
  let m, last = 0;
  while ((m = re.exec(content))) {
    const sel = m[1].trim().slice(0, 120);
    chunks.push({ content: m[0].trim(), heading_path: `${sel}` });
    last = m.index + m[0].length;
  }
  if (chunks.length === 0 && content.trim().length >= MIN_CHUNK) chunks.push({ content: content.trim(), heading_path: 'rules' });
  return chunks;
}

function chunkCode(content, filePath) {
  const chunks = [];
  const lines = content.split(/\r?\n/);
  const re = /^\s*export\s+(default\s+)?(async\s+)?(function|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*|default)/;
  let i = 0;
  while (i < lines.length) {
    const m = lines[i].match(re);
    if (!m) { i += 1; continue; }
    const start = i;
    // attach immediately-preceding contiguous JSDoc/comment block
    let docStart = start - 1;
    while (docStart >= 0 && /^\s*(\/\/|\/\*|\*|\*\/$)/.test(lines[docStart])) docStart -= 1;
    docStart += 1;
    const symbol = m[3 + (m[1] ? 1 : 0) - 1] || (m[1] ? 'default' : null);
    const nameMatch = lines[i].match(/(?:function|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/);
    const sym = nameMatch?.[1] || (m[1] ? 'default' : 'anonymous');
    let depth = 0, started = false, j = start;
    for (; j < lines.length && j - start < 400; j += 1) {
      const line = lines[j];
      for (const ch of line) {
        if (ch === '{') { depth += 1; started = true; } else if (ch === '}') depth -= 1;
      }
      if (started && depth <= 0 && j > start) break;
    }
    const body = lines.slice(docStart, Math.min(j + 1, lines.length)).join('\n').trim();
    if (body.length >= MIN_CHUNK) chunks.push({ content: body, symbol: sym, heading_path: filePath + ' › ' + sym });
    i = Math.max(j + 1, start + 1);
  }
  // file summary chunk
  const exported = Array.from(content.matchAll(/^\s*export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm)).map((x) => x[1]);
  if (exported.length) {
    const summary = (filePath + '\n' + exported.slice(0, 40).join(', ')).slice(0, MAX_CHUNK);
    chunks.unshift({ content: summary, symbol: null, heading_path: filePath });
  }
  return chunks;
}

function chunkContent(content, filePath, type) {
  const lower = filePath.toLowerCase();
  if (type === 'changelog') return content.split(/^##\s*\[/m).slice(1).map((entry) => {
    const body = '## [' + entry.trim();
    const version = (entry.match(/^([^\]]+)\]/)?.[1] || 'unknown').trim();
    return { content: body.slice(0, MAX_CHUNK), symbol: '[' + version + ']', heading_path: filePath + ' › ' + version };
  });
  if (type === 'style') return chunkCss(content).map((c) => ({ ...c, heading_path: filePath + ' › ' + c.heading_path }));
  if (type === 'code') return chunkCode(content, filePath);
  if (/\.(md|markdown)$/i.test(lower)) return chunkMarkdown(content).map((c) => ({ ...c, heading_path: filePath + (c.heading_path ? ' › ' + c.heading_path : '') }));
  return splitParagraphs(content, MAX_CHUNK).map((c) => ({ content: c, heading_path: filePath }));
}

async function build({ ifStale = false, check = false, injected = null, outDir = OUT_DIR } = {}) {
  const { commit, files } = injected || readTracked();
  const bytes = files.reduce((a, f) => a + f.size, 0);
  if (ifStale && !injected) {
    try {
      const mani = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
      if (mani.commit === commit && fs.existsSync(path.join(outDir, mani.file))) { console.log('RAG index up to date'); return 0; }
    } catch { /* rebuild */ }
  }
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run(`CREATE TABLE rag_chunks(id INTEGER PRIMARY KEY, path TEXT NOT NULL, module TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('doc','code','style','config','changelog')),
    symbol TEXT, heading_path TEXT NOT NULL, content TEXT NOT NULL, sha TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'git', token_count INTEGER NOT NULL);`);
  db.run(`CREATE VIRTUAL TABLE rag_fts USING fts4(path, symbol, heading_path, content, content=rag_chunks, tokenize=unicode61);`);
  db.run('CREATE TABLE rag_df(term TEXT PRIMARY KEY, df INTEGER NOT NULL)');
  db.run('CREATE TABLE rag_stats(key TEXT PRIMARY KEY, value REAL NOT NULL)');
  db.run('CREATE INDEX rag_chunks_path ON rag_chunks(path)');
  db.run('CREATE INDEX rag_chunks_module_type ON rag_chunks(module, type)');

  const df = new Map(), stats = { doc_count: 0, avg_len: 0 };
  let totalTokens = 0;
  const ins = db.prepare('INSERT INTO rag_chunks (path, module, type, symbol, heading_path, content, sha, source, token_count) VALUES (?,?,?,?,?,?,?,?,?)');
  for (const f of files) {
    let content;
    try { content = injected ? injected.get(f.path) : fs.readFileSync(path.join(ROOT, f.path), 'utf8'); } catch { continue; }
    const chunks = chunkContent(content, f.path, typeOf(f.path));
    for (const ch of chunks) {
      const text = ch.content.slice(0, MAX_CHUNK);
      if (text.length < MIN_CHUNK) continue;
      const tokens = tokenize(text);
      if (!tokens.length) continue;
      const uniq = new Set(tokens);
      for (const t of uniq) df.set(t, (df.get(t) || 0) + 1);
      ins.run([f.path, moduleOf(f.path), typeOf(f.path), ch.symbol ?? null, (ch.heading_path || f.path).slice(0, 240), text, f.blobSha, 'git', tokens.length]);
      stats.doc_count += 1;
      totalTokens += tokens.length;
    }
  }
  ins.free();
  stats.avg_len = stats.doc_count ? totalTokens / stats.doc_count : 0;
  for (const [term, count] of df) db.run('INSERT INTO rag_df (term, df) VALUES (?,?)', [term, count]);
  db.run('INSERT INTO rag_stats (key, value) VALUES (?,?)', ['doc_count', stats.doc_count]);
  db.run('INSERT INTO rag_stats (key, value) VALUES (?,?)', ['avg_len', stats.avg_len]);
  db.run("INSERT INTO rag_fts(rag_fts) VALUES('rebuild')");

  const fileName = `rag-index-${commit.slice(0, 12)}.sqlite`;
  const tmp = outDir + path.sep + '.' + fileName + '.tmp';
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(tmp, Buffer.from(db.export()));
  const fileBytes = fs.readFileSync(tmp);
  fs.renameSync(tmp, path.join(outDir, fileName));
  const manifest = {
    schemaVersion: 1, commit, builtAt: new Date().toISOString(),
    file: fileName, chunks: stats.doc_count, bytes: fileBytes.length,
    sha256: sha256(fileBytes), tokenizer: 'unicode61',
    k1: 1.2, b: 0.75, zoneWeights: { symbol: 3, heading: 2, content: 1 },
  };
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
  for (const stale of fs.readdirSync(outDir)) {
    if (stale.startsWith('rag-index-') && stale !== fileName && stale.endsWith('.sqlite')) fs.rmSync(path.join(outDir, stale), { force: true });
  }
  if (check) console.log('RAG index verified:', stats.doc_count, 'chunks');
  else console.log('RAG index built:', stats.doc_count, 'chunks,', (fileBytes.length / 1024).toFixed(1), 'KB');
  return 0;
}

const args = process.argv.slice(2);
const check = args.includes('--check');
const ifStale = args.includes('--if-stale');
const injectedArg = args.find((a) => a.startsWith('--injected-test-data='));
const outArg = args.find((a) => a.startsWith('--out='));
try {
  if (injectedArg) {
    const parsed = JSON.parse(fs.readFileSync(injectedArg.split('=', 2)[1], 'utf8'));
    const fileMap = new Map(Object.entries(parsed.files));
    const ret = await build({ injected: { commit: parsed.commit, files: parsed.files, get: (p) => fileMap.get(p) }, outDir: outArg ? path.resolve(outArg.split('=', 2)[1]) : OUT_DIR });
    process.exit(ret);
  }
  process.exit(await build({ ifStale, check }));
} catch (err) {
  console.error('RAG build failed:', err && err.message ? err.message : err);
  process.exit(1);
}
