/**
 * Audit helper: find repo/service functions that issue 2+ writes without a
 * transaction. In sql.js an interrupted or failed multi-statement write leaves
 * the database half-updated with no rollback — the "saved but incomplete"
 * class of bug.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.argv[2] ?? 'src';

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.|\.d\.ts$/.test(entry)) yield full;
  }
}

const WRITE = /\.run\s*\(|\.insert\s*\(|\.update\s*\(|\.delete\s*\(|\.set\s*\(|\.save\s*\(/;
const TX = /withTransaction|\.transaction\s*\(/;

for (const file of walk(root)) {
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');
  // crude but effective: treat every 2-space-indented method start as a boundary
  const starts = [];
  lines.forEach((l, i) => {
    const m = l.match(/^ {2}(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(/);
    if (m) starts.push({ i, name: m[1] });
  });
  starts.push({ i: lines.length, name: '<eof>' });
  for (let s = 0; s < starts.length - 1; s++) {
    const a = starts[s], b = starts[s + 1];
    const body = lines.slice(a.i, b.i).join('\n');
    const writes = (body.match(WRITE) ?? []).length;
    if (writes >= 2 && !TX.test(body)) {
      console.log(`${relative(process.cwd(), file).replace(/\\/g, '/')}:${a.i + 1}  ${a.name}  (${writes} writes, no transaction)`);
    }
  }
}