/**
 * Column-coverage audit.
 *
 * The app's write model is "React state is the truth, SQLite is a mirror
 * rebuilt by whole-table DELETE + INSERT". That model has one blind spot: a
 * column that no INSERT/UPDATE ever names is silently NULL forever, and a
 * column named by a write site that the schema does not have throws on the
 * spot. Neither shows up in the type checker or in a passing test suite.
 *
 * Reads migrations.ts for the schema and every .ts/.tsx under src for writes,
 * then reports:
 *   DEAD    — column exists, nothing in the app ever writes it
 *   UNKNOWN — a write site names a column the table does not have
 *   REQUIRED— NOT NULL column with no default that no write site supplies
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const files = walk(SRC);
const read = (p) => readFileSync(p, 'utf8');

// ---------------------------------------------------------------- schema
const migrations = read(join(SRC, 'db/migrations.ts'));
const schema = new Map(); // table -> { col: decl }
const re = /CREATE TABLE (?:IF NOT EXISTS )?([a-z_][a-z0-9_]*)\s*\(([\s\S]*?)\n\s*\)\s*(?:,|;|`|')/g;
let m;
while ((m = re.exec(migrations))) {
  const [, table, body] = m;
  const cols = new Map();
  for (const rawLine of body.split('\n')) {
    const line = rawLine.replace(/,$/, '').trim();
    if (!line || /^(FOREIGN|PRIMARY|UNIQUE|CHECK|CONSTRAINT)\b/i.test(line)) continue;
    const cm = /^([a-z_][a-z0-9_]*)\s+([A-Za-z]+)/.exec(line);
    if (!cm) continue;
    cols.set(cm[1], line);
  }
  schema.set(table, cols);
}

// ALTER TABLE ... ADD COLUMN — later migrations append columns to tables created
// earlier, so the CREATE TABLE sweep alone under-reports the live schema.
const alterRe = /ALTER TABLE ([a-z_][a-z0-9_]*)\s+ADD COLUMN\s+([a-z_][a-z0-9_]*)([^;\n]*)/gi;
while ((m = alterRe.exec(migrations))) {
  const [, table, col, rest] = m;
  const cols = schema.get(table);
  if (!cols) {
    schema.set(table, new Map([[col, `${col} ${rest.trim()}`]]));
    continue;
  }
  if (!cols.has(col)) cols.set(col, `${col} ${rest.trim()}`.trim());
}

// Table-rebuild migrations create `<table>_vNN` then RENAME it back onto
// `<table>`. The final shape is the _vNN one, so it must win over the original.
for (const [table, cols] of [...schema]) {
  const base = table.match(/^(.+)_v\d+$/);
  if (!base || !schema.has(base[1])) continue;
  const merged = new Map(schema.get(base[1]));
  for (const [c, d] of cols) merged.set(c, d);
  schema.set(base[1], merged);
  schema.delete(table);
}

// sqliteStorage.ts carries its own legacy export-only DDL string; it is a
// divergence to report, not a column-coverage finding.
const SKIP = new Set([join(SRC, 'services/sqliteStorage.ts'), join(SRC, 'db/migrations.ts')]);

// ---------------------------------------------------------------- writes
const writes = []; // { table, columns, file, line }
const insRe = /INSERT(?: OR REPLACE)? INTO ([a-z_][a-z0-9_]*)\s*\(([\s\S]*?)\)\s*VALUES/gi;
const updRe = /UPDATE ([a-z_][a-z0-9_]*)\s+SET\s+([\s\S]*?)\s+WHERE/gi;
for (const file of files) {
  if (SKIP.has(file)) continue;
  const src = read(file);
  const rel = relative(ROOT, file);
  for (const re2 of [insRe, updRe]) {
    re2.lastIndex = 0;
    let hit;
    while ((hit = re2.exec(src))) {
      const [, table, colText] = hit;
      if (!schema.has(table)) continue;
      const columns = colText
        .split(',')
        .map((c) => c.trim())
        .filter((c) => /^[a-z_][a-z0-9_]*$/i.test(c))
        .map((c) => c.replace(/^(or|ignore)\s+/i, '').trim());
      writes.push({
        table,
        columns,
        file: rel,
        line: src.slice(0, hit.index).split('\n').length,
      });
    }
  }
}

const findings = [];
for (const [table, cols] of schema) {
  const tableWrites = writes.filter((w) => w.table === table);
  const written = new Set(tableWrites.flatMap((w) => w.columns));
  for (const [col, decl] of cols) {
    if (!written.has(col)) {
      findings.push({ kind: 'DEAD', table, col, detail: decl, sites: tableWrites.length });
    }
    if (/NOT NULL/i.test(decl) && !/DEFAULT/i.test(decl) && !written.has(col)) {
      findings.push({ kind: 'REQUIRED', table, col, detail: decl, sites: tableWrites.length });
    }
  }
  for (const w of tableWrites) {
    for (const c of w.columns) {
      if (!cols.has(c)) {
        findings.push({ kind: 'UNKNOWN', table, col: c, detail: `${w.file}:${w.line}`, sites: 1 });
      }
    }
  }
}

console.log(`schema tables: ${schema.size}   write sites parsed: ${writes.length}`);
if (!findings.length) {
  console.log('no column-coverage findings');
} else {
  for (const kind of ['UNKNOWN', 'REQUIRED', 'DEAD']) {
    const list = findings.filter((f) => f.kind === kind);
    if (!list.length) continue;
    console.log(`\n${kind} (${list.length}):`);
    for (const f of list) {
      console.log(`  ${f.table}.${f.col}${kind === 'UNKNOWN' ? '  <- ' + f.detail : '  (' + f.detail + ')'}`);
    }
  }
}