/**
 * workflow-auto-commit-publish-guard.parallel-merge.test
 *
 * Task 1552 (やること 10): two tasks ran in parallel and the OTHER task's PR
 * merged first, so `develop` moved. Before this task's PR is created the base
 * must be merged in and the gate re-run on the merged code; a failed re-run
 * must withhold the PR. The order is fixed here at two levels: the guard's own
 * call order, and the auto-commit route calling the guard before it claims the
 * PR-creation lock and returning when the guard says no.
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const VERIFIED = 'a'.repeat(40);
const AFTER_MERGE = 'b'.repeat(40);
const order: string[] = [];
let head = VERIFIED;
let regateOk = true;

mock.module('../../services/workflow/pre-pr-base-sync', () => ({
  syncBaseIntoBranch: () => {
    order.push('sync');
    head = AFTER_MERGE; // the other task's merged PR is now part of this branch
    return Promise.resolve({ status: 'merged', changedFiles: 3, conflicts: [], detail: '' });
  },
}));
mock.module('./workflow-auto-commit-presave', () => ({
  readHeadRevision: () => Promise.resolve(head),
  listWorkingTreeChanges: () => Promise.resolve([]),
}));
mock.module('../../services/agents/verification/verification-gate', () => ({
  runVerificationGate: () => {
    order.push('reverify');
    return Promise.resolve(
      regateOk
        ? { ok: true, verdict: 'pass', result: null }
        : {
            ok: false,
            verdict: 'fail',
            result: { ok: false, summary: 'tests', checks: [], changedFiles: [] },
          },
    );
  },
}));
mock.module('../../services/workflow/auto-merge-notify', () => ({
  notify: () => Promise.resolve(),
}));
mock.module('../../config/logger', () => ({
  createLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }),
}));

const { syncAndReverifyBeforePublish } = await import('./workflow-auto-commit-publish-guard');

/** Stand-in for the route's PR step: it only runs when the guard allows it. */
async function publish(): Promise<boolean> {
  const guard = await syncAndReverifyBeforePublish({
    taskId: 1552,
    gitCwd: 'C:/wt',
    baseBranch: 'develop',
    verifiedRevision: VERIFIED,
    verdict: 'pass',
  });
  if (!guard.ok) return false;
  order.push('create_pr');
  return true;
}

beforeEach(() => {
  order.length = 0;
  head = VERIFIED;
  regateOk = true;
});

describe('the other PR merged first', () => {
  test('develop is merged in, the gate re-runs, then the PR is created', async () => {
    expect(await publish()).toBe(true);
    expect(order).toEqual(['sync', 'reverify', 'create_pr']);
  });

  test('a failed re-run after the merge withholds the PR', async () => {
    regateOk = false;
    expect(await publish()).toBe(false);
    expect(order).toEqual(['sync', 'reverify']);
  });
});

describe('the auto-commit route keeps that order', () => {
  const route = readFileSync(join(import.meta.dir, 'workflow-auto-commit.ts'), 'utf8');

  test('the guard runs before the PR-creation lock, and a refusal returns before it', () => {
    const guardAt = route.indexOf('await syncAndReverifyBeforePublish(');
    const refusalAt = route.indexOf('if (!guard.ok)', guardAt);
    const lockAt = route.indexOf('await claimPrCreationLock(');
    expect(guardAt).toBeGreaterThan(-1);
    expect(refusalAt).toBeGreaterThan(guardAt);
    expect(lockAt).toBeGreaterThan(refusalAt);
    expect(route.slice(refusalAt, lockAt)).toContain('return { ...result, error: guard.error }');
  });
});
