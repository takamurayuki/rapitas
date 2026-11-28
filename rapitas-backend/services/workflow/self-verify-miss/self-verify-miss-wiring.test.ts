/**
 * self-verify-miss wiring — every real gate files a miss after a passing
 * self-verify run (task 1602)
 *
 * Calls the real gate entry points (attemptVerifyRepair, handleCiFailure,
 * recordPreSaveStop) rather than the record helper, so dropping the one wiring
 * line in any of them turns its case red.
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { fakeEvents, resetFakeTimeline, seedJob } from './timeline-fake.fixture';

mock.module('../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, debug: () => {}, warn: () => {}, error: () => {} }),
}));

const prisma = {
  userSettings: { findFirst: async () => null },
  activityLog: { findFirst: async () => null },
  // No task row: attemptVerifyRepair returns stale right after filing the miss.
  task: { findUnique: async () => null, findFirst: async () => null },
  agentExecution: { findFirst: async () => null },
  workflowFile: { findFirst: async () => null },
  workflowTransition: {
    count: async () => 0,
    findFirst: async () => null,
    findMany: async () => [],
    create: async () => ({}),
  },
};
mock.module('../../../config/database', () => ({ prisma }));
mock.module('../../../config', () => ({ prisma }));

// CI collaborators, mirroring tests/services/auto-merge-ci-failure.test.ts.
mock.module('../auto-merge-checks', () => ({
  readPrState: async () => 'open',
  readMergeState: async () => 'BLOCKED',
  readHeadSha: async () => 'sha-current',
  updatePrBranch: async () => true,
  readPrChecks: async () => [],
  ghPath: () => 'gh',
}));
mock.module('../auto-merge-ci-attribution', () => ({
  readBaseFailingJobs: async () => new Set<string>(['Test Backend']),
  splitInheritedFailures: (failed: string[], base: Set<string>) => ({
    inherited: failed.filter((n) => base.has(n)),
    own: failed.filter((n) => !base.has(n)),
  }),
}));
mock.module('../auto-merge-env-rerun', () => ({ handleEnvFailureRerun: async () => false }));
mock.module('../ci-self-repair', () => ({
  attemptCiRepair: async () => ({ bounced: true, attempt: 1 }),
  CI_REPAIR_CAUSE: 'ci_repair',
}));
mock.module('../auto-merge-exhaustion', () => ({
  EXHAUSTED_CAUSE: 'auto_merge_exhausted',
  resetExhaustedRecheckCooldowns: () => {},
  markExhausted: async () => {},
  decideTerminalState: async () => ({ skip: false }),
}));
mock.module('../auto-merge-notify', () => ({ notify: async () => {} }));
mock.module('../transition-recorder', () => ({ recordTransition: async () => {} }));

const { attemptVerifyRepair } = await import('../verify-self-repair');
const { handleCiFailure } = await import('../auto-merge-ci-failure');
const { recordPreSaveStop } = await import('../publish/verification-stop-record');

const misses = () =>
  fakeEvents.filter((e) => e.eventType === 'self_verify_miss').map((e) => e.payload);

const candidate = {
  taskId: 31,
  taskTitle: 't',
  prNumber: 7,
  baseBranch: 'develop',
  cwd: '/repo',
  threshold: 0,
  completedAt: new Date(),
  mode: 'merge' as const,
};

beforeEach(() => resetFakeTimeline());

describe('verify gate (attemptVerifyRepair)', () => {
  test('a verifier rejection after a pass files one judgment miss', async () => {
    seedJob(31, 'run-v', { revision: 'f00d', changedFiles: ['rapitas-backend/a.ts'] });
    await attemptVerifyRepair(31, 'in_progress', 'verify.md marks the run as failed', 'body');
    expect(misses()).toEqual([
      {
        taskId: 31,
        runId: 'run-v',
        revision: 'f00d',
        gate: 'verify',
        gateFamily: 'verify',
        checkName: null,
        kind: 'judgment',
        reasonSummary: 'verify.md marks the run as failed',
        files: ['rapitas-backend/a.ts'],
        dedupKey: 'run-v|verify',
      },
    ]);
  });

  test('no passing self-verify run, no miss', async () => {
    seedJob(31, 'run-red', { ok: false });
    await attemptVerifyRepair(31, 'in_progress', 'verify.md marks the run as failed', 'body');
    expect(misses()).toHaveLength(0);
  });

  test('a GitHub conflict bounce is not a miss', async () => {
    seedJob(31, 'run-v');
    await attemptVerifyRepair(31, 'verify_done', 'mergeStateStatus=DIRTY', 'body', {
      missGate: 'none',
    });
    expect(misses()).toHaveLength(0);
  });
});

describe('diff_review gate (attemptVerifyRepair with findings)', () => {
  test('a jury rejection files a judgment miss on the files it names', async () => {
    seedJob(31, 'run-d', { changedFiles: ['rapitas-backend/a.ts', 'rapitas-backend/b.ts'] });
    await attemptVerifyRepair(31, 'verify_done', '差分レビュー不合格: テストがない', 'body', {
      findings: [{ summary: 'no test', evidence: 'rapitas-backend/b.ts:4', gating: true }],
    });
    expect(misses()).toHaveLength(1);
    expect(misses()[0]).toMatchObject({
      runId: 'run-d',
      gate: 'diff_review',
      kind: 'judgment',
      files: ['rapitas-backend/b.ts'],
    });
  });

  test('the same jury verdict re-sent does not add a second miss', async () => {
    seedJob(31, 'run-d');
    const grounds = { findings: [{ summary: 'x' }] };
    await attemptVerifyRepair(31, 'verify_done', '差分レビュー不合格: x', 'body', grounds);
    await attemptVerifyRepair(31, 'verify_done', '差分レビュー不合格: x', 'body', grounds);
    expect(misses()).toHaveLength(1);
  });
});

describe('ci gate (handleCiFailure)', () => {
  test("the PR's own failing job files one mechanical miss; inherited ones do not", async () => {
    seedJob(31, 'run-c', { revision: 'beef' });
    await handleCiFailure(candidate, ['Lint Code', 'Test Backend'], async () => false);
    expect(misses()).toHaveLength(1);
    expect(misses()[0]).toMatchObject({
      runId: 'run-c',
      revision: 'beef',
      gate: 'ci:Lint Code',
      gateFamily: 'ci',
      checkName: 'Lint Code',
      kind: 'mechanical',
      files: ['rapitas-backend/services/a.ts'],
    });
    expect(String(misses()[0]!.reasonSummary)).toContain('Lint Code');
  });
});

describe('presave gate (recordPreSaveStop)', () => {
  test('a secret stop files one mechanical miss per failed check with its paths', async () => {
    seedJob(31, 'run-p');
    await recordPreSaveStop(
      31,
      {
        summary: 'tamper=ok / secret=NG(1) / attribution=ok',
        tamper: null,
        secrets: ['rapitas-backend/.env.local'],
        unattributed: [],
      },
      'pre-save check failed',
    );
    // The stop record files the miss without awaiting it; let it settle.
    for (let i = 0; i < 100 && misses().length === 0; i++) await Bun.sleep(10);
    expect(misses()).toHaveLength(1);
    expect(misses()[0]).toMatchObject({
      gate: 'presave:secret',
      gateFamily: 'presave',
      checkName: 'secret',
      kind: 'mechanical',
      files: ['rapitas-backend/.env.local'],
    });
  });
});
