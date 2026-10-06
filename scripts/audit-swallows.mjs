/**
 * Audit helper: find catch blocks that swallow their error entirely.
 *
 * A catch is "silent" when its body does nothing observable — no throw, no
 * console.*, no state update, no callback, no comment-free silent return.
 * Those are the blocks where a real SQLite/runtime error disappears without
 * a trace and the UI carries on as if the write succeeded.
 *
 * Usage: node scripts/audit-swallows.mjs [dir]
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.argv[2] ?? 'src';

/** Words that count as "the error did something". */
const OBSERVABLE =
  /\b(throw|console\.|setError|setLastError|reportError|notify|alert|rethrow|notifyError|trackError|captureError|dispatchEvent|lastSaveError)\b/;

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.|\.d\.ts$/.test(entry)) yield full;
  }
}

/** Extract the balanced block that starts at the `{` following `index`. */
function blockAt(text, index) {
  let depth = 0;
  let i = index;
  for (; i < text.length; i++) {
    const c = text[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return { body: text.slice(index + 1, i), end: i };
    } else if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      i++;
      while (i < text.length && text[i] !== quote) {
        if (text[i] === '\\') i++;
        i++;
      }
    }
  }
  return null;
}

const findings = [];
for (const file of walk(root)) {
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');
  const lineOf = (idx) => text.slice(0, idx).split('\n').length;

  const re = /catch\s*(\([^)]*\))?\s*\{/g;
  let m;
  while ((m = re.exec(text))) {
    const braceIdx = m.index + m[0].length - 1;
    const parsed = blockAt(text, braceIdx);
    if (!parsed) continue;
    const body = parsed.body;
    // strip comments so an "explanatory" comment does not read as behaviour
    const code = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').trim();
    const empty = code === '';
    const returnsOnly = /^return\s*;?$/.test(code);
    const onlyFallback = /^(return\s+(null|undefined|false|true|\[\]|\{\}|''|"")\s*;?|return)$/.test(code);
    if (!OBSERVABLE.test(code) && (empty || returnsOnly || onlyFallback)) {
      findings.push({
        file: relative(process.cwd(), file).replace(/\\/g, '/'),
        line: lineOf(m.index),
        kind: empty ? 'EMPTY' : onlyFallback ? 'FALLBACK-ONLY' : 'RETURN-ONLY',
        text: lines[lineOf(m.index) - 1].trim().slice(0, 100),
        context: code.replace(/\s+/g, ' ').slice(0, 120),
      });
    }
  }
}

console.log(`silent catch blocks: ${findings.length}\n`);
const byFile = new Map();
for (const f of findings) {
  if (!byFile.has(f.file)) byFile.set(f.file, []);
  byFile.get(f.file).push(f);
}
for (const [file, list] of [...byFile].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`${file}  (${list.length})`);
  for (const f of list) console.log(`  L${f.line}  ${f.kind}  -> ${f.context || '(empty)'}`);
}