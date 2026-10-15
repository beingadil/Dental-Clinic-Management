/**
 * Open the browser print dialog for the CURRENT document, after the page has
 * actually painted.
 *
 * Why this exists rather than a bare `window.print()`:
 *
 * A print modal renders its sheets into the DOM when the operator clicks, and
 * `window.print()` asks the browser to snapshot the document as it is at that
 * instant. React has not necessarily flushed the new nodes yet, so the dialog
 * can open on the PREVIOUS frame — an empty sheet, or the old contents.
 *
 * The usual workaround was `setTimeout(() => window.print(), 100)`. A fixed
 * timer is a guess: it is too short on a slow machine and the dialog still
 * opens early, and too long on a fast one for no reason. It also fires even if
 * the component unmounted in the meantime.
 *
 * Waiting for two animation frames instead waits for the browser to have
 * committed the layout this turn and the paint after it, which is the actual
 * precondition for a correct snapshot — and it costs nothing when the page is
 * already idle.
 */

/** Frames to wait: one to commit layout, one to paint after it. */
const FRAMES_BEFORE_PRINT = 2;

/**
 * Print the current document.
 *
 * @returns true when the print dialog was requested, false when the page was
 *   torn down before it could be (in which case printing is skipped rather than
 *   throwing from a stale frame callback).
 */
export function printCurrentDocument(): Promise<boolean> {
  return new Promise((resolve) => {
    let framesLeft = FRAMES_BEFORE_PRINT;

    const step = () => {
      if (typeof window === 'undefined' || !document.body) {
        resolve(false);
        return;
      }
      if (framesLeft > 0) {
        framesLeft -= 1;
        window.requestAnimationFrame(step);
        return;
      }
      window.print();
      resolve(true);
    };

    window.requestAnimationFrame(step);
  });
}
