// Node-environment test (no DOM): parses the Rust command signatures and the
// TypeScript IPC bindings as text.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

/**
 * IPC argument-removal contract for `db_load` and `db_backup_file`.
 *
 * Both commands used to take an optional caller-supplied path and were hardened
 * by DELETING the parameter, because nothing anywhere ever passed one:
 *
 *   db_load(path)          -> `resolve_db_path` did `PathBuf::from(p)` with no
 *                             containment check, and `Connection::open` CREATES
 *                             a missing file. That is an arbitrary-file-WRITE
 *                             primitive reachable from the webview: any script
 *                             that could call invoke() (a CSP-injected blob, a
 *                             malicious note renderer, a supply-chained dep
 *                             that reaches the IPC bridge) could drop a
 *                             SQLite-shaped file anywhere the user could
 *                             write — Startup folder, an autorun drop point,
 *                             over a document.
 *
 *   db_backup_file(dest)   -> `fs::copy(live_db, dest)` straight into the
 *                             caller's path, silently OVERWRITING whatever
 *                             sat there with the clinic's entire database.
 *                             Not a create-primitive: a destroy-and-exfiltrate
 *                             one. `dest` could name a user's real document.
 *
 * Validating them instead of removing them was rejected on purpose: restore
 * already flows through `db_save_bytes` (webview file input -> bytes) and
 * user-chosen backup exports already flow through `save_file_bytes` + the
 * native save dialog, so there is no legitimate caller for either parameter.
 *
 * The failure mode this guards is DRIFT. Rust and TypeScript are two files with
 * no shared type: re-adding `path: Option<String>` to Rust alone breaks every
 * caller; re-adding it to the `desktopDb()` binding *plus* a call site
 * silently reopens the hole, and nothing — tsc, vitest, the production build —
 * objects. So both sides are asserted here, and so is the handler body.
 */
const root = resolve(__dirname, '../..');

const libRs = readFileSync(resolve(root, 'src-tauri/src/lib.rs'), 'utf8');
const persistenceTs = readFileSync(resolve(root, 'src/db/persistence.ts'), 'utf8');

/* ------------------------------------------------------------------ *
 * Rust signature parsing
 * ------------------------------------------------------------------ */

/** Splits a Rust parameter list on top-level commas only (so
 *  `state: State<DbState>` and `Result<PathBuf, String>` stay intact). */
function splitTopLevel(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of list) {
    if (ch === '(' || ch === '[' || ch === '{' || ch === '<') depth++;
    else if (ch === ')' || ch === ']' || ch === '}' || ch === '>') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      out.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out.map((p) => p.trim()).filter((p) => p.length > 0);
}

/** Returns the raw parameter list of `#[tauri::command] fn <name>(...)`.
 *  Throws if the command is not declared, so a rename fails loudly instead of
 *  quietly turning every assertion below into a vacuous pass. */
function commandParams(name: string): string {
  // `#[tauri::command]` (optionally with args) followed only by further
  // attributes and whitespace before `fn <name>(` — deliberately NOT a loose
  // `fn name(` scan, which would happily match an unrelated helper.
  const re = new RegExp(
    String.raw`#\[\s*tauri::command[^\]]*\]\s*(?:#\[[^\]]*\]\s*)*fn\s+${name}\s*\(`,
    'g',
  );
  const matches = [...libRs.matchAll(re)];
  expect(
    matches.length,
    `expected exactly one #[tauri::command] fn ${name} in src-tauri/src/lib.rs, found ${matches.length}`,
  ).toBe(1);

  const open = matches[0].index! + matches[0][0].length - 1;
  let depth = 0;
  for (let i = open; i < libRs.length; i++) {
    if (libRs[i] === '(') depth++;
    else if (libRs[i] === ')') {
      depth--;
      if (depth === 0) return libRs.slice(open + 1, i);
    }
  }
  throw new Error(`unbalanced parentheses in fn ${name}`);
}

/** The full signature line, for drift diagnostics. */
function commandSignature(name: string): string {
  const params = commandParams(name);
  return `fn ${name}(${params.replace(/\s+/g, ' ').trim()})`;
}

function paramName(param: string): string {
  return param.split(':')[0].trim().replace(/[&*]/g, '').replace(/^mut\s+/, '');
}

function paramType(param: string): string {
  const idx = param.indexOf(':');
  return (idx === -1 ? '' : param.slice(idx + 1)).trim();
}

/** The `tauri::generate_handler![...]` list, as bare command names. */
function registeredCommands(): string[] {
  const m = libRs.match(/tauri::generate_handler!\[([\s\S]*?)\]/);
  expect(m, 'no tauri::generate_handler! found in lib.rs').toBeTruthy();
  return m![1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.split('::').pop()!);
}

/** Body of a Rust `fn`, by brace matching from the end of its signature. */
function fnBody(name: string): string {
  const re = new RegExp(String.raw`\bfn\s+${name}\s*\(`);
  const m = re.exec(libRs);
  expect(m, `fn ${name} not found`).toBeTruthy();
  let i = libRs.indexOf('{', m!.index + m![0].length);
  let depth = 0;
  for (let j = i; j < libRs.length; j++) {
    if (libRs[j] === '{') depth++;
    else if (libRs[j] === '}') {
      depth--;
      if (depth === 0) return libRs.slice(i + 1, j);
    }
  }
  throw new Error(`unbalanced braces in fn ${name}`);
}

/* ------------------------------------------------------------------ *
 * Source discovery
 * ------------------------------------------------------------------ */

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

/** Every `.ts`/`.tsx` file under src/, as repo-relative paths. */
function srcFiles(): string[] {
  return sourceFiles(resolve(root, 'src')).map((f) => f.slice(root.length + 1));
}

describe('IPC: db_load / db_backup_file take no caller-supplied path', () => {
  describe('Rust command signatures (src-tauri/src/lib.rs)', () => {
    it('db_load is declared exactly once as a #[tauri::command]', () => {
      // Guards the parser: if the declaration ever moves to another file or
      // the attribute is dropped, commandParams() throws rather than letting a
      // substring search pass on a stale match.
      expect(commandSignature('db_load')).toBe('fn db_load(app: AppHandle, state: State<DbState>)');
    });

    it('db_backup_file is declared exactly once as a #[tauri::command]', () => {
      expect(commandSignature('db_backup_file')).toBe('fn db_backup_file(state: State<DbState>)');
    });

    it('db_load accepts exactly two parameters, neither of them a path', () => {
      const params = splitTopLevel(commandParams('db_load'));
      expect(params.map(paramName)).toEqual(['app', 'state']);
      // The specific regression: `path: Option<String>`.
      expect(params.map(paramType).join(' ')).not.toMatch(/Option\s*<\s*String\s*>/);
      expect(params.map(paramName)).not.toContain('path');
      expect(params.map(paramType).join(' ')).not.toContain('PathBuf');
    });

    it('db_backup_file accepts exactly one parameter, and it is not a destination', () => {
      const params = splitTopLevel(commandParams('db_backup_file'));
      expect(params.map(paramName)).toEqual(['state']);
      // The specific regression: `dest: Option<String>` fed straight to fs::copy.
      expect(params.map(paramName)).not.toContain('dest');
      expect(params.map(paramName)).not.toContain('destination');
      expect(params.map(paramType).join(' ')).not.toMatch(/Option\s*<\s*String\s*>/);
      expect(params.map(paramType).join(' ')).not.toContain('PathBuf');
    });

    it('resolve_db_path takes only the app handle and derives the path itself', () => {
      // The sink. If this ever grows a caller path again, db_load's zero-arg
      // signature is cosmetic.
      expect(libRs).toMatch(/fn\s+resolve_db_path\s*\(\s*app:\s*&AppHandle\s*\)/);
      const body = fnBody('resolve_db_path');
      expect(body).toContain('app_data_dir()');
      expect(body).toMatch(/dental_solutions\.sqlite/);
      expect(body).not.toMatch(/Option\s*</);
      expect(body).not.toMatch(/PathBuf::from/);
    });

    it('db_load builds its path from resolve_db_path and never from an argument', () => {
      const body = fnBody('db_load');
      expect(body).toMatch(/resolve_db_path\(&app\)/);
      // A `PathBuf::from(x)` in here would be the unhardened sink returning.
      expect(body).not.toMatch(/PathBuf::from/);
    });

    it('db_backup_file derives its target beside the database, not from a caller', () => {
      const body = fnBody('db_backup_file');
      expect(body).toMatch(/path\.with_extension\(/);
      // Every path in here is derived from `path`; no argument reaches a sink.
      expect(body).not.toMatch(/PathBuf::from/);
      expect(body).not.toMatch(/fs::copy\(/);
    });

    it('db_backup_file lands the backup atomically, so a torn copy is never left named .bak', () => {
      // `fs::copy` straight onto the .bak name is not atomic: an interrupted
      // copy leaves a truncated file that still looks like a valid backup.
      // The bytes go to a .tmp sibling, fsync, then rename into place.
      const body = fnBody('db_backup_file');
      expect(body).toMatch(/fs::File::create\(&tmp\)/);
      expect(body).toMatch(/f\.sync_all\(\)/);
      expect(body).toMatch(/fs::rename\(&tmp,\s*&target\)/);
      // Every failure path clears the temp file, or it lingers as litter that
      // the next backup can collide with.
      const cleanupCount = (body.match(/remove_file\(&tmp\)/g) ?? []).length;
      expect(cleanupCount).toBeGreaterThanOrEqual(3);
    });

    it('still registers both commands, under the names the frontend invokes', () => {
      // Guards the other half of the contract: if the Rust symbol is renamed
      // but the handler list still answers to the old name, invoke() 404s at
      // runtime and the app opens with an empty database.
      const registered = registeredCommands();
      expect(registered).toContain('db_load');
      expect(registered).toContain('db_backup_file');
      expect(new Set(registered).size).toBe(registered.length);
    });
  });

  describe('TypeScript bindings (src/db/persistence.ts)', () => {
    it('declares db_load as a zero-argument function', () => {
      // The drift guard proper: a non-zero-arg binding here is the tell that a
      // path argument is coming back on the wire.
      expect(persistenceTs).toMatch(/db_load:\s*\(\s*\)\s*=>/);
      expect(persistenceTs).not.toMatch(/db_load:\s*\((?!\s*\))/);
    });

    it('declares db_backup_file as a zero-argument function', () => {
      expect(persistenceTs).toMatch(/db_backup_file:\s*\(\s*\)\s*=>/);
      expect(persistenceTs).not.toMatch(/db_backup_file:\s*\((?!\s*\))/);
    });

    it('invokes both commands with no payload argument at all', () => {
      // `invoke('db_load', { path })` would silently re-open the hole while
      // still type-checking against a zero-arg binding, so assert the second
      // argument is absent rather than empty.
      expect(persistenceTs).toMatch(/db_load:\s*\(\s*\)\s*=>\s*invoke\(\s*'db_load'\s*\)/);
      expect(persistenceTs).toMatch(/db_backup_file:\s*\(\s*\)\s*=>\s*invoke\(\s*'db_backup_file'\s*\)/);
      expect(persistenceTs).not.toMatch(/invoke\(\s*'db_load'\s*,/);
      expect(persistenceTs).not.toMatch(/invoke\(\s*'db_backup_file'\s*,/);
    });

    it('the app calls both bindings with no arguments', () => {
      // `tauri.db_load({ path })` — the historical call shape. Also catches a
      // future `db_load(somePath)` that the types would (correctly) reject.
      expect(persistenceTs).toMatch(/tauri\.db_load\(\s*\)/);
      expect(persistenceTs).not.toMatch(/db_load\(\s*[^)\s]/);
      expect(persistenceTs).not.toMatch(/db_backup_file\(\s*[^)\s]/);
    });
  });

  describe('no call site anywhere in src/ smuggles a path back in', () => {
    const files = srcFiles();

    it('scanned a plausible number of files (guards the scanner)', () => {
      expect(files.length).toBeGreaterThan(50);
    });

    const offenders = files.flatMap((rel) => {
      const text = readFileSync(resolve(root, rel), 'utf8');
      const hits: string[] = [];
      if (/db_load\(\s*[^)\s]/.test(text)) hits.push(`${rel}: db_load() called with an argument`);
      if (/db_backup_file\(\s*[^)\s]/.test(text)) hits.push(`${rel}: db_backup_file() called with an argument`);
      if (/invoke\(\s*'db_load'\s*,/.test(text)) hits.push(`${rel}: invoke('db_load', <payload>)`);
      if (/invoke(\s*)'db_backup_file'\s*,/.test(text)) hits.push(`${rel}: invoke('db_backup_file', <payload>)`);
      return hits;
    });

    it('every invoke of db_load / db_backup_file is argument-free', () => {
      // src/services/backupScheduler.ts uses a raw `invoke` wrapper rather than
      // the persistence binding — that bypass is why this is a src-wide sweep
      // and not just a persistence.ts check.
      expect(offenders).toEqual([]);
    });

    it('found the callers it is protecting (guards against a vacuous sweep)', () => {
      // If these disappear, the sweep above would match nothing and pass
      // silently. Requiring the known callers keeps it honest.
      const scheduler = readFileSync(resolve(root, 'src/services/backupScheduler.ts'), 'utf8');
      expect(scheduler).toMatch(/invoke\(\s*'db_backup_file'\s*\)/);
      expect(persistenceTs).toMatch(/tauri\.db_load\(\s*\)/);
    });
  });
});
