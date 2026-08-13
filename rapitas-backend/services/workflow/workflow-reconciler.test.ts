/**
 * workflow-reconciler.test
 *
 * Pure-logic tests for the zombie-session finalize decision: only abandoned
 * (stale, non-awaiting) active sessions are finalized — never a live long phase
 * or a session legitimately waiting on the user.
 *
 * Also covers `runHealPass`'s fault-isolation contract: `reconcileOnce()` runs
 * 8 UNRELATED heal passes back to back, each wrapped in `runHealPass`. A throw
 * in one pass must not propagate and abort the rest of that cycle — otherwise
 * a single deterministically-throwing row (bad shape, JS bug) in an early pass
 * would permanently starve every later pass, every cycle, forever.
 */
import { describe, it, expect, mock } from 'bun:test';
import { shouldFinalizeSession, STALE_SESSION_MS, runHealPass } from './workflow-reconciler';

const NOW = 1_000_000_000_000;
const stale = NOW - STALE_SESSION_MS - 1; // just past the threshold
const fresh = NOW - 60_000; // 1 min ago

describe('shouldFinalizeSession', () => {
  it('finalizes a stale, non-awaiting active session', () => {
    expect(shouldFinalizeSession({ lastActivityAtMs: stale, nowMs: NOW })).toBe(true);
  });

  it.each([
    {
      name: 'a session within the staleness window (live long phase)',
      input: { lastActivityAtMs: fresh, nowMs: NOW },
    },
    {
      name: 'a session awaiting user input',
      input: { lastActivityAtMs: stale, nowMs: NOW, latestExecStatus: 'waiting_for_input' },
    },
    {
      name: 'a task awaiting a clarifying question',
      input: { lastActivityAtMs: stale, nowMs: NOW, taskWorkflowStatus: 'awaiting_question' },
    },
  ])('does NOT finalize $name', ({ input }) => {
    expect(shouldFinalizeSession(input)).toBe(false);
  });

  it('staleness threshold exceeds the 30m phase timeout (no false finalize of a max-length phase)', () => {
    expect(STALE_SESSION_MS).toBeGreaterThan(30 * 60 * 1000);
  });
});

describe('runHealPass — fault isolation', () => {
  it('returns the real count when the pass succeeds', async () => {
    const pass = mock(() => Promise.resolve(3));

    const count = await runHealPass('someHealPass', pass);

    expect(count).toBe(3);
  });

  it('swallows a throwing pass and returns 0 instead of propagating', async () => {
    const pass = mock(() => Promise.reject(new Error('bad row shape')));

    await expect(runHealPass('someHealPass', pass)).resolves.toBe(0);
  });

  it('one throwing pass does not prevent a SUBSEQUENT pass from running', async () => {
    const failing = mock(() => Promise.reject(new Error('boom')));
    const succeeding = mock(() => Promise.resolve(5));

    // Mirrors reconcileOnce()'s sequential await chain: pass 1 throws, pass 2
    // must still run and return its real count.
    const first = await runHealPass('failingPass', failing);
    const second = await runHealPass('succeedingPass', succeeding);

    expect(first).toBe(0);
    expect(second).toBe(5);
    expect(succeeding).toHaveBeenCalledTimes(1);
  });
});
