/**
 * verify-settle-live-verifier — the gap after the verifier exits
 *
 * Task 1548 (2026-11-26): the Codex verifier exited at 02:47:12 and the
 * commit / PR epilogue started at 02:47:30. The settle wait looked in between,
 * at 02:47:23: no agent alive, nothing registered in flight, the 60 s window
 * spent, so it was blocked before its PR. A just-finished verifier now still
 * counts for a short grace after it exits.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

let live = false;
let lastCompletedAgoMs: number | null = null;
let lookupFails = false;

mock.module('./auto-run/auto-run-selection', () => ({
  hasLiveExecution: async () => {
    if (lookupFails) throw new Error('db down');
    return live;
  },
}));
mock.module('../../config/database', () => ({
  prisma: {
    agentExecution: {
      findFirst: async (args: { where: { completedAt: { gte: Date } } }) => {
        if (lookupFails) throw new Error('db down');
        if (lastCompletedAgoMs === null) return null;
        const completedAt = new Date(Date.now() - lastCompletedAgoMs);
        return completedAt >= args.where.completedAt.gte ? { id: 1 } : null;
      },
    },
  },
}));

const { isVerifierStillRunning, VERIFIER_EXIT_GRACE_MS } =
  await import('./verify-settle-live-verifier');

describe('isVerifierStillRunning', () => {
  beforeEach(() => {
    live = false;
    lastCompletedAgoMs = null;
    lookupFails = false;
  });

  test('is true while the verifier is alive', async () => {
    live = true;
    expect(await isVerifierStillRunning(1548)).toBe(true);
  });

  test('is still true just after the verifier exits, before the epilogue registers', async () => {
    lastCompletedAgoMs = 11_000;
    expect(await isVerifierStillRunning(1548)).toBe(true);
  });

  test('is false once the exit grace has passed', async () => {
    lastCompletedAgoMs = VERIFIER_EXIT_GRACE_MS + 5_000;
    expect(await isVerifierStillRunning(1548)).toBe(false);
  });

  test('is false when the lookup fails, keeping the old window', async () => {
    lookupFails = true;
    expect(await isVerifierStillRunning(1548)).toBe(false);
  });
});
