/**
 * critic-inflight.test
 *
 * Unit tests for the in-flight critique registry: registration lifecycle,
 * settle-waiting, the cap, and late-settlement of superseded critiques.
 */
import { describe, it, expect } from 'bun:test';
import { registerCritique, awaitCriticSettled, hasCritiqueInFlight } from './critic-inflight';

/** A promise controllable from the outside. */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: Error) => void;
} {
  let resolve!: (v: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe('critic-inflight registry', () => {
  it('awaitCriticSettled returns immediately when nothing is in flight', async () => {
    const start = Date.now();
    await awaitCriticSettled(9001);
    expect(Date.now() - start).toBeLessThan(50);
  });

  it('waits until the registered critique resolves', async () => {
    const d = deferred<string>();
    registerCritique(9002, d.promise);
    expect(hasCritiqueInFlight(9002)).toBe(true);

    let settled = false;
    const waiter = awaitCriticSettled(9002).then(() => {
      settled = true;
    });
    await tick();
    expect(settled).toBe(false); // still pending

    d.resolve('verdict');
    await waiter;
    expect(settled).toBe(true);
    await tick();
    expect(hasCritiqueInFlight(9002)).toBe(false); // self-removed on settle
  });

  it('a rejected critique also settles the wait (never throws)', async () => {
    const d = deferred<string>();
    registerCritique(9003, d.promise);
    d.reject(new Error('critic crashed'));
    await awaitCriticSettled(9003); // must not throw
    await tick();
    expect(hasCritiqueInFlight(9003)).toBe(false);
  });

  it('caps the wait when the critique never settles', async () => {
    const d = deferred<string>();
    registerCritique(9004, d.promise);
    const start = Date.now();
    await awaitCriticSettled(9004, 100); // 100ms cap
    expect(Date.now() - start).toBeLessThan(2_000);
    expect(hasCritiqueInFlight(9004)).toBe(true); // still pending, cap fired
    d.resolve('late'); // settle so the registry cleans up
    await tick();
  });

  it('an older critique settling late does not delete a newer registration', async () => {
    const older = deferred<string>();
    registerCritique(9005, older.promise);
    const newer = deferred<string>();
    registerCritique(9005, newer.promise); // supersedes

    older.resolve('old verdict');
    await tick();
    // The newer critique must still be tracked.
    expect(hasCritiqueInFlight(9005)).toBe(true);
    newer.resolve('new verdict');
    await tick();
    expect(hasCritiqueInFlight(9005)).toBe(false);
  });
});
