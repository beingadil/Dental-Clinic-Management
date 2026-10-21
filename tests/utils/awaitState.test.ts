import { describe, it, expect } from 'vitest';
import { waitForState, nextTask } from '../../src/utils/awaitState';

/**
 * The wait that the demo fixtures depend on.
 *
 * The bug it exists to prevent: `addCase` mints the next case number from
 * the `cases` array in the render closure it was created in. A second call
 * made before React re-renders reads the same stale array and mints the
 * same number. The demo seed hit that intermittently — twice, in one
 * session, as DS-0024 and DS-0021.
 *
 * So the loop waits for the created case to APPEAR in the app's list, not
 * for a tick to pass. These tests pin that behaviour, because "it usually
 * works" is what the bug looked like.
 */
describe('waitForState', () => {
  it('returns as soon as the condition holds', async () => {
    const found = await waitForState(() => true, { attempts: 50 });
    expect(found).toBeUndefined();
  });

  it('keeps waiting until the condition actually holds', async () => {
    /* The state arrives late — which is the whole point. A single yield
       would have raced it. The condition here becomes true only after the
       third look, so the wait has to survive two failed ones. */
    let seen = 0;
    await waitForState(() => {
      seen += 1;
      return seen >= 3;
    }, { attempts: 500 });
    expect(seen).toBe(3);
  });

  it('throws rather than hanging forever when the state never arrives', async () => {
    await expect(
      waitForState(() => false, { attempts: 5, describe: 'a case that never appears' }),
    ).rejects.toThrow(/a case that never appears/);
  });

  it('does not read the state before yielding, so the first check is cheap', async () => {
    let reads = 0;
    await waitForState(() => {
      reads += 1;
      return true;
    });
    expect(reads).toBe(1);
  });
});

describe('nextTask', () => {
  it('yields to another task rather than blocking', async () => {
    const order: string[] = [];
    const pending = nextTask().then(() => order.push('yielded'));
    order.push('synchronous');
    await pending;
    expect(order).toEqual(['synchronous', 'yielded']);
  });
});
