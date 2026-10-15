// Node-environment test (no DOM): static analysis of src/context/AppContext.tsx.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * PHI-in-console regression guard.
 *
 * `triggerAgentWorkflow` used to be:
 *
 *   const triggerAgentWorkflow = (event: string, payload: any) => {
 *     console.log(event, payload);
 *   };
 *
 * and every case mutation funnels through it:
 *
 *   triggerAgentWorkflow('CASE_CREATED',  { case_id, case_number, caseData })
 *   triggerAgentWorkflow('CASE_UPDATED',  { case_id, updates })
 *   triggerAgentWorkflow('CASE_DELETED',  { case_id, case_number })
 *   triggerAgentWorkflow('CASE_NOTE_ADDED',{ case_id, note })
 *   triggerAgentWorkflow('ATTACHMENT_UPLOADED', { case_id, attachment })
 *
 * `caseData` IS the `DentalCase` row, so the very first call dumped
 * `patient_name`, the treating doctor and the clinical notes into the WebView2
 * console on every case creation. That sink is bad in a way a log rotation
 * policy does not fix:
 *
 *   - devtools is not a user-facing surface, so nothing in the app can clear it;
 *   - it is attached to the clinic's patient data with no retention limit, no
 *     access control and no audit trail;
 *   - support screenshots ("send me a screenshot of the error") capture it;
 *   - and every other console call in src/ only ever passes an Error or a
 *     counter, so this one line was the single PHI sink in the codebase — the
 *     one nobody would think to audit.
 *
 * The fix was to drop the argument entirely (`(_payload)`) and log only the
 * event name, which is the whole diagnostic value of a stub whose only consumer
 * was that log line.
 *
 * WHY THE SCANNER IS NOT A SUBSTRING CHECK: the explanatory comment directly
 * above `triggerAgentWorkflow` contains the words "payload", "patient_name" and
 * "console" — precisely so the next reader understands what not to re-add. A
 * naive `text.includes('console.log(event, payload)')`-adjacent grep therefore
 * either passes vacuously or fails on the documentation. This file parses the
 * actual CALL EXPRESSIONS with comments blanked out, and self-checks its own
 * detector against synthetic vulnerable snippets so "it still catches the bug"
 * is an assertion, not a hope.
 */
const root = resolve(__dirname, '../..');
const source = readFileSync(resolve(root, 'src/context/AppContext.tsx'), 'utf8');

/* ------------------------------------------------------------------ *
 * A very small lexer: enough to find balanced call arguments in a
 * .tsx file without pulling in a parser, and to blank comments
 * while preserving every character offset.
 * ------------------------------------------------------------------ */

/**
 * Returns a copy of `src` with every comment character replaced by a space
 * (newlines preserved, so line numbers and offsets survive). String literals,
 * template literals and their contents are left untouched — which matters,
 * because the hardened log line IS a template literal and must still be found.
 */
function blankComments(src: string): string {
  const out = src.split('');
  let i = 0;
  let quote: string | null = null;
  let line = false;
  let block = false;

  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < out.length; k++) if (out[k] !== '\n') out[k] = ' ';
  };

  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];
    if (line) {
      if (ch === '\n') line = false;
      else blank(i, i + 1);
      i++;
      continue;
    }
    if (block) {
      if (ch === '*' && next === '/') {
        blank(i, i + 2);
        i += 2;
        block = false;
        continue;
      }
      blank(i, i + 1);
      i++;
      continue;
    }
    if (quote) {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      i++;
      continue;
    }
    if (ch === '/' && next === '/') {
      line = true;
      i += 2;
      continue;
    }
    if (ch === '/' && next === '*') {
      block = true;
      i += 2;
      continue;
    }
    i++;
  }
  return out.join('');
}

/** End index of the bracket opened at `open`, skipping strings/comments. */
function matchBracket(src: string, open: number, opener = '(', closer = ')'): number {
  let depth = 0;
  let i = open;
  let quote: string | null = null;
  while (i < src.length) {
    const ch = src[i];
    if (quote) {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      i++;
      continue;
    }
    if (ch === opener) depth++;
    else if (ch === closer) {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

/**
 * Blanks out the literal TEXT of string and template literals while keeping
 * every identifier, operator and `${...}` interpolation intact.
 *
 * This distinction is the difference between catching the bug and missing it:
 * `console.log(\`[triggered] ${payload}\`)` leaks exactly as much PHI as
 * `console.log(event, payload)` does, so the interpolated expression has to
 * survive. Conversely `console.log('[cutover] removed 3 keys')` must NOT be
 * scanned as if those words were variables.
 */
function scrubLiterals(src: string): string {
  const out = src.split('');
  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < out.length; k++) if (out[k] !== '\n') out[k] = ' ';
  };

  let i = 0;
  while (i < src.length) {
    const ch = src[i];

    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === '\\') {
          j += 2;
          continue;
        }
        if (src[j] === ch) break;
        j++;
      }
      blank(i + 1, Math.min(j, src.length));
      i = Math.min(j + 1, src.length);
      continue;
    }

    if (ch === '`') {
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === '\\') {
          blank(j, j + 2);
          j += 2;
          continue;
        }
        if (src[j] === '`') break;
        if (src[j] === '$' && src[j + 1] === '{') {
          // An interpolation is CODE, not literal text: recurse into it so a
          // string inside the interpolation is blanked but a bare identifier
          // survives to be checked.
          const close = matchBracket(src, j + 1, '{', '}');
          if (close === -1) {
            j = src.length;
            break;
          }
          const inner = scrubLiterals(src.slice(j + 2, close));
          for (let k = 0; k < inner.length; k++) out[j + 2 + k] = inner[k];
          j = close + 1;
          continue;
        }
        blank(j, j + 1);
        j++;
      }
      i = Math.min(j + 1, src.length);
      continue;
    }

    i++;
  }
  return out.join('');
}

const code = blankComments(source);

type ConsoleCall = {
  method: string;
  methodName: string;
  args: string;
  at: number;
  /** Argument list with literal TEXT blanked but interpolated expressions and
   *  bare identifiers preserved — this is what the leak checks scan. */
  argExpressions: string;
};

/** Every `console.<method>(...)` call, with its raw and scrubbed args. */
function consoleCalls(src: string): ConsoleCall[] {
  const out: ConsoleCall[] = [];
  const re = /\bconsole\s*\.\s*([A-Za-z]+)\s*\(/g;
  for (const m of src.matchAll(re)) {
    const open = m.index + m[0].length - 1;
    const close = matchBracket(src, open);
    if (close === -1) continue;
    const args = src.slice(open + 1, close);
    out.push({
      method: m[1],
      methodName: `console.${m[1]}`,
      args,
      argExpressions: scrubLiterals(args),
      at: m.index,
    });
  }
  return out;
}

/** Splits a top-level argument list on commas. */
function splitArgs(args: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  let quote: string | null = null;
  for (let i = 0; i < args.length; i++) {
    const ch = args[i];
    if (quote) {
      current += ch;
      if (ch === '\\') {
        current += args[i + 1] ?? '';
        i++;
      } else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      current += ch;
      continue;
    }
    if ('([{'.includes(ch)) depth++;
    if (')]}'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) {
      out.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out.map((a) => a.trim()).filter(Boolean);
}

/** `(params) => { body }` for the named workflow trigger, if present. */
function workflowTrigger(src: string): { params: string[]; body: string } | null {
  const m = /const\s+triggerAgentWorkflow\s*=\s*\(/.exec(src);
  if (!m) return null;
  const open = m.index + m[0].length - 1;
  const close = matchBracket(src, open);
  if (close === -1) return null;
  const braceOpen = src.indexOf('{', close);
  const braceClose = matchBracket(src, braceOpen, '{', '}');
  return {
    params: splitArgs(src.slice(open + 1, close)),
    body: src.slice(braceOpen + 1, braceClose),
  };
}

/** Identifiers that carry patient-identifying data. Deliberately specific:
 *  a bare `record` or `data` would flag half the codebase. */
const PHI_IDENTIFIERS = [
  'patient_name',
  'patientName',
  'patient_phone',
  'patientPhone',
  'caseData',
  'case_data',
  'caseNumber',
  'case_number',
  'attachment',
  'newNote',
  'target',
];

const calls = consoleCalls(code);
const trigger = workflowTrigger(code);

/** Every console call in `src` whose ARGUMENT EXPRESSIONS reference `ident`. */
function leakingCalls(src: string, ident: string): ConsoleCall[] {
  const re = new RegExp(String.raw`\b${ident}\b`);
  return consoleCalls(src).filter((c) => re.test(c.argExpressions));
}

describe('no patient data in console output (src/context/AppContext.tsx)', () => {
  it('scans a real file that still has the console calls it guards', () => {
    // Guards the scanner: if the file is emptied, renamed, or the console calls
    // are all deleted, everything below would pass vacuously.
    expect(source.length).toBeGreaterThan(10_000);
    expect(calls.length).toBeGreaterThanOrEqual(5);
    expect(trigger).not.toBeNull();
  });

  it('triggerAgentWorkflow still accepts the payload argument', () => {
    // The callers pass a record on purpose — five call sites in this file rely
    // on the two-argument shape. This test pins the SIGNATURE so the next
    // person does not "clean up" the unused parameter by editing all five
    // callers instead.
    expect(trigger!.params.length).toBe(2);
    expect(trigger!.params[0]).toMatch(/^event\b/);
  });

  it('names the workflow payload with an underscore, so it is declared unused', () => {
    // `_payload` is the TypeScript/eslint convention for "intentionally
    // received, deliberately not used". It is also the thing a reviewer
    // scanning the diff will notice has lost its `console.log`.
    expect(trigger!.params[1]).toMatch(/^_/);
    expect(trigger!.params[1]).toMatch(/payload/i);
  });

  it('no console.* call in this file receives the workflow payload', () => {
    // THE assertion. `_?payload` covers both the original `payload` and today's
    // `_payload`, so a rename-and-log (`console.log(event, _payload)`) is
    // caught too. Scanned against comment-blanked, literal-stripped argument
    // expressions, so the explanatory comment three lines above the function
    // — which names "payload" and "patient_name" — cannot trip this.
    const leaks = leakingCalls(code, '_?payload');
    expect(
      leaks.map((c) => c.methodName),
      'a console.* call receives the workflow payload — that payload is a whole ' +
        'case row (patient_name, doctor, notes) and the console is an ' +
        'unclearable, unauditable PHI sink',
    ).toEqual([]);
  });

  it('no console.* call in this file receives a patient-identifying record', () => {
    // Second net, independent of the parameter name. Catches the plausible
    // reintroduction `console.log(event, caseData)` from one of the five
    // call sites, which the check above would miss if the parameter were
    // renamed on the way in.
    const leaks = PHI_IDENTIFIERS.flatMap((ident) =>
      leakingCalls(code, ident).map((c) => `${c.methodName}(... ${ident} ...)`),
    );
    expect([...new Set(leaks)]).toEqual([]);
  });

  it('the workflow trigger logs the event name, and nothing else', () => {
    const bodyCalls = consoleCalls(trigger!.body);
    expect(bodyCalls.length).toBe(1);
    // The event name is the part worth keeping: it is the whole diagnostic
    // value of a stub whose only consumer was the old log line. Checked
    // against the scrubbed arguments, where `${event}` survives as an
    // expression but the literal "[Agent Workflow Triggered]" does not.
    expect(bodyCalls[0].argExpressions).toMatch(/\bevent\b/);
    expect(bodyCalls[0].args.split(',').length).toBe(1);
  });

  /* ---------------------------------------------------------------------
   * Guard the guard. Without these, "the scanner found nothing" and
   * "the scanner works" are indistinguishable, and a refactor of the
   * analyser could quietly turn this file into a no-op.
   * --------------------------------------------------------------------- */
  describe('the detector is proven live against synthetic vulnerable code', () => {
    const VULNERABLE_ARROW = [
      'const triggerAgentWorkflow = (event: string, payload: any) => {',
      '  console.log(event, payload);',
      '};',
    ].join('\n');

    const VULNERABLE_RENAMED = [
      'const triggerAgentWorkflow = (event: string, _payload: any) => {',
      '  console.log(`[Agent Workflow Triggered] ${event}`, _payload);',
      '};',
    ].join('\n');

    const VULNERABLE_DESTRUCTURED = [
      'const triggerAgentWorkflow = (event: string, payload: any) => {',
      '  const { patient_name } = payload;',
      '  console.warn(event, patient_name);',
      '};',
    ].join('\n');

    const VULNERABLE_CALLSITE = [
      'const triggerAgentWorkflow = (event: string, _payload: any) => {',
      '  console.log(`[Agent Workflow Triggered] ${event}`);',
      '};',
      'const row = getCase(id);',
      'console.log("case saved", row.caseData);',
    ].join('\n');

    // Leaks PHI with NO bare `payload` argument at all: the record is spliced
    // into the log line through a template interpolation. A scanner that blanks
    // whole template literals (the obvious first implementation) misses this.
    const VULNERABLE_INTERPOLATED = [
      'const triggerAgentWorkflow = (event: string, _payload: any) => {',
      '  console.log(`[Agent Workflow Triggered] ${event} ${caseData.patient_name}`);',
      '};',
    ].join('\n');

    const SAFE_WITH_EXPLANATORY_COMMENT = [
      '// The payload is deliberately dropped rather than logged: callers hand this',
      '// a whole record (patient_name, doctor, notes).',
      'const triggerAgentWorkflow = (event: string, _payload: any) => {',
      '  console.log(`[Agent Workflow Triggered] ${event}`);',
      '};',
    ].join('\n');

    // PHI words that are only WORDS here — never a value reaching a sink.
    const SAFE_WITH_PHI_LITERAL_TEXT = [
      'console.log("csv export dropped the patient_name column");',
      'console.info(`[cutover] removed ${stale.length} legacy keys`);',
      'console.warn("[session] persist failed:", e);',
    ].join('\n');

    it('flags the original console.log(event, payload)', () => {
      expect(leakingCalls(blankComments(VULNERABLE_ARROW), '_?payload').length).toBe(1);
    });

    it('flags a renamed-and-still-logged payload', () => {
      expect(leakingCalls(blankComments(VULNERABLE_RENAMED), '_?payload').length).toBe(1);
    });

    it('flags a destructured patient_name logged downstream', () => {
      const flagged =
        leakingCalls(blankComments(VULNERABLE_DESTRUCTURED), '_?payload').length +
        PHI_IDENTIFIERS.filter((id) => leakingCalls(blankComments(VULNERABLE_DESTRUCTURED), id).length)
          .length;
      expect(flagged).toBeGreaterThan(0);
    });

    it('flags a case record logged at a call site outside the trigger', () => {
      const src = blankComments(VULNERABLE_CALLSITE);
      expect(PHI_IDENTIFIERS.some((id) => leakingCalls(src, id).length > 0)).toBe(true);
    });

    it('flags PHI interpolated into a template literal (no bare payload argument)', () => {
      // `console.log(\`...\${caseData.patient_name}\`)` hands the same patient
      // name to the same sink as `console.log(event, payload)`. Proves the
      // scanner reads inside `${...}` rather than discarding the whole template.
      const src = blankComments(VULNERABLE_INTERPOLATED);
      expect(leakingCalls(src, '_?payload').length).toBe(0); // only the PHI list catches it
      expect(PHI_IDENTIFIERS.filter((id) => leakingCalls(src, id).length > 0)).toContain(
        'patient_name',
      );
    });

    it('does NOT flag PHI words that are only literal log text', () => {
      // The other false-positive direction: a message that NAMES a column it
      // deliberately did not log is not a leak, and failing it would push
      // people to write vaguer logs — which loses real diagnostic value.
      const src = blankComments(SAFE_WITH_PHI_LITERAL_TEXT);
      expect(leakingCalls(src, '_?payload')).toEqual([]);
      expect(PHI_IDENTIFIERS.filter((id) => leakingCalls(src, id).length > 0)).toEqual([]);
    });

    it('does NOT flag the hardened shape, and does not flag the comment above it', () => {
      // The false-positive guard. If the detector tripped on explanatory prose,
      // the maintainer who writes that prose would be pushed to delete the
      // warning that stops the bug coming back — the test would be actively
      // harmful. This assertion is what makes keeping the comment safe.
      const src = blankComments(SAFE_WITH_EXPLANATORY_COMMENT);
      expect(leakingCalls(src, '_?payload')).toEqual([]);
      expect(PHI_IDENTIFIERS.filter((id) => leakingCalls(src, id).length > 0)).toEqual([]);
      // And the comment really is there — if it were deleted the false-positive
      // guard would stop proving anything.
      expect(source).toMatch(/payload is deliberately dropped/i);
    });
  });
});
