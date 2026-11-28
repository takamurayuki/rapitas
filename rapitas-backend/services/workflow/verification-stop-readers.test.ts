/**
 * Readers of the `verification_stopped` transition
 *
 * The new row must not read as a repair loop, must not let the runner complete a
 * task from a PR on record, and must not make a block auto-resumable.
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test';

process.env.RAPITAS_VERIFY_SETTLE_MS = '50';
process.env.RAPITAS_VERIFY_SETTLE_CAP_MS = '50';

const silent = { info: () => {}, debug: () => {}, warn: () => {}, error: () => {} };
mock.module('../../config/logger', () => ({ createLogger: () => silent, logger: silent }));

/** Newest first, like the real `orderBy createdAt desc`. */
let transitions: Array<{ cause: string; createdAt: Date }> = [];
const prisma = { workflowTransition: { findFirst: async () => transitions[0] ?? null } };
mock.module('../../config', () => ({ prisma }));
mock.module('../../config/database', () => ({ prisma }));

mock.module('./awaiting-ci-lookup', () => ({
  readTaskAwaitingCi: async () => false,
  isItemStillOwned: async () => true,
}));
mock.module('../task/task-resolver', () => ({ resolveTaskWorkflowState: async () => null }));
const recover = mock(async () => true);
mock.module('./verify-settle-artifact-recovery', () => ({ recoverFromLandedArtifact: recover }));

const { detectRepeatLoop } = await import('./incident-signature-repeat-loop');
const { waitForVerifyCompletion } = await import('./workflow-runner-verify-settle');
const { hasFreshVerifyRejection } = await import('./verify-self-repair');
const { RESUMABLE_BLOCK_CAUSES } = await import('./blocked-retry-resume-stage');

const now = Date.now();
const row = (cause: string, ageMs = 0) => ({ cause, createdAt: new Date(now - ageMs) });
const settle = () => waitForVerifyCompletion(1, new AbortController().signal);

beforeEach(() => {
  transitions = [];
  recover.mockClear();
});

describe('repeat-loop detector', () => {
  const loopOf = (cause: string) =>
    detectRepeatLoop({
      nowMs: now,
      transitions: [1, 2, 3, 4].map((i) => ({ cause, actor: 'system', createdAtMs: now - i })),
    });

  test('does not count verification stops as a loop', () => {
    expect(loopOf('verification_stopped')).toBeNull();
  });

  test('still counts another repeated cause', () => {
    expect(loopOf('ci_repair')?.cause).toBe('ci_repair');
  });
});

describe('runner settle after a verification stop', () => {
  test('does not complete from a landed PR when the stop is the latest row', async () => {
    transitions = [row('verification_stopped')];

    expect(await settle()).toBe('stuck');
    expect(recover).not.toHaveBeenCalled();
  });

  test('keeps vetoing when the stop covers an earlier rejection', async () => {
    transitions = [row('verification_stopped'), row('adversarial_review_failed', 1000)];

    expect(await settle()).toBe('stuck');
    expect(recover).not.toHaveBeenCalled();
  });

  test('a stale stop no longer vetoes the recovery', async () => {
    transitions = [row('verification_stopped', 31 * 60_000)];

    expect(await settle()).toBe('completed');
    expect(recover).toHaveBeenCalledWith(1);
  });
});

describe('other readers are unchanged', () => {
  test('a verification stop alone is not a verify rejection', async () => {
    transitions = [row('verification_stopped')];

    expect(await hasFreshVerifyRejection(1)).toBe(false);
  });

  test('a verification stop is not auto-resumable', () => {
    expect(RESUMABLE_BLOCK_CAUSES).not.toContain('verification_stopped');
  });
});
