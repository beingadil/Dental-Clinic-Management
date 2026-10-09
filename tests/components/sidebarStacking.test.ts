/**
 * Stacking guard for the app shell.
 *
 * The bug this prevents: opening a Case/Job from the workstation left the whole
 * left column of the full-page case viewer hidden behind the navigation. The
 * viewer is mounted inside `<main>` but was `fixed inset-0`, which resolves
 * against the VIEWPORT — so it covered the nav rail entirely. To the user the
 * sidebar looked like it had auto-minimised when a case job was opened.
 *
 * An earlier version of this file asserted that the rail carried `lg:z-auto`,
 * which was the wrong axis: z-index changes PAINT ORDER but not GEOMETRY. The
 * overlay's box already covered the rail, so no z-index on the rail could have
 * revealed the viewer's left column. The fix is positional — the viewer must be
 * `absolute` against a positioned content column — and that is what is asserted
 * below.
 *
 * Asserted against source class strings rather than computed style: jsdom does
 * not run Tailwind or lay anything out, so `getComputedStyle` here can only echo
 * back what the class list already says. Same approach as design-tokens.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), 'utf8');

const appSource = read('src', 'App.tsx');
const sidebarSource = read('src', 'components', 'common', 'Sidebar.tsx');
const caseDetailViewSource = read('src', 'components', 'cases', 'CaseDetailView.tsx');

/**
 * Classes on the element whose className follows `marker`.
 *
 * Handles both spellings JSX allows here: a plain string
 * (`className="a b"`) and a template literal (`className={`a ${x} b`}`).
 * Both forms occur on elements this file cares about, so the helper cannot
 * assume one of them — assuming the wrong one silently produces a garbage
 * slice and an unrelated assertion failure.
 */
function classListOf(source: string, marker: string): string[] {
  const at = source.indexOf(marker);
  expect(at, `no element matching ${JSON.stringify(marker)}`).toBeGreaterThan(-1);

  const templateAt = source.indexOf('className={`', at);
  const stringAt = source.indexOf('className="', at);

  let start: number;
  let end: number;
  if (templateAt !== -1 && (stringAt === -1 || templateAt < stringAt)) {
    start = templateAt + 'className={`'.length;
    end = source.indexOf('}`}', start);
  } else if (stringAt !== -1) {
    start = stringAt + 'className="'.length;
    end = source.indexOf('"', start);
  } else {
    throw new Error(`no className found after ${JSON.stringify(marker)}`);
  }
  expect(end, `unterminated className after ${JSON.stringify(marker)}`).toBeGreaterThan(start);

  return source
    .slice(start, end)
    .split(/\s+/)
    .filter(Boolean);
}

/** The root layer class list of the full-page case viewer. */
function viewerRootClasses(): string[] {
  const at = caseDetailViewSource.indexOf('absolute inset-0');
  expect(at, 'case viewer root must be absolutely positioned').toBeGreaterThan(-1);
  const line = caseDetailViewSource.slice(at, caseDetailViewSource.indexOf('\n', at));
  return line.split(/\s+/).filter(Boolean);
}

describe('full-page case viewer does not cover the nav rail', () => {
  it('positions the viewer absolutely, not against the viewport', () => {
    const classes = viewerRootClasses();
    expect(classes).toContain('absolute');
    // `fixed` anywhere on the root escapes the content column and takes the
    // rail with it. This is the assertion that would have caught the bug.
    expect(classes, 'case viewer must not be viewport-fixed').not.toContain('fixed');
  });

  it('pins the viewer to all four edges of its containing block', () => {
    const classes = viewerRootClasses();
    // Without `inset-0` an absolute layer collapses to its content height and
    // floats mid-column instead of covering the view it is meant to replace.
    expect(classes).toContain('inset-0');
  });

  it('has a positioned content column to resolve against', () => {
    // An absolute element with no positioned ancestor falls back to the
    // initial containing block — i.e. the viewport — which is precisely the
    // bug. App.tsx owns the column the viewer mounts into.
    const column = classListOf(appSource, 'Main Column: Top Header + View Content');
    expect(column, 'content column must establish a containing block').toContain('relative');
  });

  it('keeps the rail in normal flow at desktop widths', () => {
    // Belt and braces: even if the viewer geometry is right, a rail that
    // outranks overlays paints over them. `lg:static` + `lg:z-auto` covers that.
    const classes = classListOf(sidebarSource, '<aside');
    expect(classes).toContain('lg:static');
    expect(classes).toContain('lg:z-auto');
  });
});