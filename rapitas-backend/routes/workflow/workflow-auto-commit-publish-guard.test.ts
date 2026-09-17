/**
 * workflow-auto-commit-publish-guard tests — the base sync never publishes a
 * revision the gate did not verify: a moved HEAD is re-gated, conflicts and
 * re-verification failures withhold, and a HEAD mismatch is refused.
 */
import { beforeEach, expect, mock, test } from 'bun:test';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
let syncFixture = { status: 'clean', changedFiles: 0, conflicts: [] as string[], detail: '' };
mock.module('../../services/workflow/pre-pr-base-sync', () => ({
  syncBaseIntoBranch: () => Promise.resolve({ ...syncFixture }),
}));
let headFixture: string | null = A;
let dirtyQueue: Array<string[] | null> = [];
mock.module('./workflow-auto-commit-presave', () => ({
  readHeadRevision: () => Promise.resolve(headFixture),
  listWorkingTreeChanges: () => Promise.resolve(dirtyQueue.length ? dirtyQueue.shift()! : []),
}));
const gateCalls: number[] = [];
let gateFixture = {
  ok: true,
  result: null as null | {
    ok: boolean;
    unverifiable?: boolean;
    summary: string;
    checks: never[];
    changedFiles: never[];
  },
};
mock.module('../../services/agents/verification/verification-gate', () => ({
  runVerificationGate: (taskId: number) => {
    gateCalls.push(taskId);
    return Promise.resolve(gateFixture);
  },
}));
const notified: string[] = [];
mock.module('../../services/workflow/auto-merge-notify', () => ({
  notify: (n: { type: string }) => {
    notified.push(n.type);
    return Promise.resolve();
  },
}));
mock.module('../../config/logger', () => ({
  createLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }),
}));

const { syncAndReverifyBeforePublish } = await import('./workflow-auto-commit-publish-guard');
const run = () =>
  syncAndReverifyBeforePublish({
    taskId: 9,
    gitCwd: 'C:/wt',
    baseBranch: 'develop',
    verifiedRevision: A,
  });

beforeEach(() => {
  gateCalls.length = 0;
  notified.length = 0;
  gateFixture = { ok: true, result: null };
  syncFixture = { status: 'clean', changedFiles: 0, conflicts: [], detail: '' };
  headFixture = A;
  dirtyQueue = [];
});

test('a dirty tree after the gate withholds publication before any sync', async () => {
  dirtyQueue = [[' M rapitas-backend/x.ts']];
  const r = await run();
  expect(r.ok).toBe(false);
  expect(r.dirtyPaths).toEqual([' M rapitas-backend/x.ts']);
  expect(r.error).toContain('未コミット・未追跡');
  expect(gateCalls).toEqual([]);
  expect(r.baseSync.status).toBe('skipped');
});

test('a dirty tree left by the sync withholds publication even after a passing re-gate', async () => {
  syncFixture = { status: 'clean', changedFiles: 2, conflicts: [], detail: 'merged' };
  headFixture = B;
  dirtyQueue = [[], ['?? rapitas-backend/leftover.ts']];
  const r = await run();
  expect(gateCalls).toEqual([9]);
  expect(r.ok).toBe(false);
  expect(r.dirtyPaths).toEqual(['?? rapitas-backend/leftover.ts']);
  expect(r.error).toContain('base 取り込み後');
});

test('unreadable git status is treated as unverifiable state: withhold', async () => {
  dirtyQueue = [null];
  const r = await run();
  expect(r.ok).toBe(false);
  expect(r.dirtyPaths).toEqual([]);
});

test('already up to date: no re-gate, HEAD equals the verified revision → ok', async () => {
  const r = await run();
  expect(r).toMatchObject({ ok: true, reverified: false, verifiedRevision: A, headRevision: A });
  expect(gateCalls).toEqual([]);
});

test('merge moved HEAD: re-gate on the final code, then publish the new HEAD', async () => {
  syncFixture = { status: 'clean', changedFiles: 4, conflicts: [], detail: 'merged' };
  headFixture = B;
  const r = await run();
  expect(gateCalls).toEqual([9]);
  expect(r).toMatchObject({ ok: true, reverified: true, verifiedRevision: B, headRevision: B });
});

test('re-gate failure withholds publication and reports blocked/unverifiable', async () => {
  syncFixture = { status: 'clean', changedFiles: 1, conflicts: [], detail: 'merged' };
  headFixture = B;
  gateFixture = {
    ok: false,
    result: {
      ok: false,
      unverifiable: true,
      summary: 'runtime=UNVERIFIED',
      checks: [],
      changedFiles: [],
    },
  };
  const r = await run();
  expect(r.ok).toBe(false);
  expect(r.verificationBlocked).toBe(true);
  expect(r.verificationUnverifiable).toBe(true);
  expect(r.error).toContain('再検証に失敗');
  expect(r.verifiedRevision).toBe(A);
});

test('unresolved conflict: withheld + notified, no gate call', async () => {
  syncFixture = {
    status: 'conflict_unresolved',
    changedFiles: 0,
    conflicts: ['x.ts'],
    detail: 'c',
  };
  const r = await run();
  expect(r.ok).toBe(false);
  expect(r.error).toContain('マージ競合');
  expect(notified).toEqual(['base_sync_conflict_unresolved']);
  expect(gateCalls).toEqual([]);
});

test('HEAD unreadable after the sync → refuse to publish', async () => {
  headFixture = null;
  const r = await run();
  expect(r.ok).toBe(false);
  expect(r.error).toContain('検証済みの版と HEAD が一致しない');
});
