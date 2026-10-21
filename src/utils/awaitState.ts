/**
 * Waiting for the app's own state to catch up.
 *
 * WHY THIS EXISTS
 * A React setter does not change the value the function that called it
 * closed over. `addCase` mints the next case number from the `cases` array
 * in the render closure it was CREATED in, so a second call made before
 * React has re-rendered reads the same stale array and mints the same
 * number. The symptom is a duplicate identifier that only shows up when
 * two calls happen to land in the same tick — which is exactly what a
 * seeding loop does.
 *
 * The usual fix is to yield once and hope. That is a race: React posts its
 * own work to the same MessageChannel the yield uses, but nothing
 * guarantees which of the two is drained first, and React may schedule the
 * re-render in a later task entirely. One hop is sometimes enough and
 * sometimes not, which is the worst kind of bug to chase.
 *
 * So: wait for the EVIDENCE. Poll the state itself, and stop as soon as it
 * says what we needed it to say. The yield between polls only exists to let
 * React do its work — it is no longer what we are waiting FOR.
 */

/**
 * Hands the thread back for one task.
 *
 * A MessageChannel hop, not `setTimeout(0)`: a chained timer loop is
 * subject to Chrome's timer-budget throttling, which stretches a long
 * sequence of yields from milliseconds to minutes in a backgrounded tab.
 * React's own scheduler posts on the same channel, so this yields to
 * precisely the work that has to happen.
 */
export const nextTask = (): Promise<void> =>
  new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(0);
  });

export interface WaitForStateOptions {
  /** How many times to look before giving up. */
  attempts?: number;
  /** What we were waiting for, for the error message. */
  describe?: string;
}

/**
 * Wait until `read` returns true.
 *
 * Throws when the attempt budget runs out. A state that never arrives is a
 * failure, not a result — the caller wanted this to happen, and quietly
 * carrying on would leave the thing half-built.
 */
export async function waitForState(
  read: () => boolean,
  { attempts = 500, describe = 'the expected state' }: WaitForStateOptions = {},
): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    if (read()) return;
    await nextTask();
  }
  throw new Error(`Timed out after ${attempts} attempts waiting for ${describe}.`);
}
