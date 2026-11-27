/**
 * auto-merge-ci-failure 環境要因再実行テスト
 *
 * 失敗が全て既知の環境要因の印（apt タイムアウト等）のときだけ失敗ジョブを
 * head SHA ごとに1回再実行し、ci_repair に回さないことを検証する。
 * 1つでも印に当たらない失敗（同名チェックの混在を含む）は ci_repair に回る。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const mockReadMergeState = mock(() => Promise.resolve<string | null>('BLOCKED'));
const mockReadHeadSha = mock(() => Promise.resolve<string | null>('sha-current'));
const mockUpdatePrBranch = mock(() => Promise.resolve(true));
const mockReadPrChecks = mock(() =>
  Promise.resolve<{ name: string; bucket: string; link?: string }[] | null>([]),
);
mock.module('../../services/workflow/auto-merge-checks', () => ({
  // Mirrors the real module: auto-merge-pending-timeout imports readPrState.
  readPrState: async () => 'open',
  readMergeState: mockReadMergeState,
  readHeadSha: mockReadHeadSha,
  updatePrBranch: mockUpdatePrBranch,
  readPrChecks: mockReadPrChecks,
  ghPath: () => 'gh',
}));

// Base-branch attribution (ba42bb57): default = nothing red on base, so every
// failure is the PR's own and the legacy paths below are unchanged.
let baseFailing = new Set<string>();
mock.module('../../services/workflow/auto-merge-ci-attribution', () => ({
  readBaseFailingJobs: () => Promise.resolve(baseFailing),
  splitInheritedFailures: (failed: string[], base: Set<string>) => ({
    inherited: failed.filter((n) => base.has(n)),
    own: failed.filter((n) => !base.has(n)),
  }),
}));

const mockAttemptCiRepair = mock(() =>
  Promise.resolve<{ bounced: boolean; attempt?: number }>({ bounced: true, attempt: 1 }),
);
mock.module('../../services/workflow/ci-self-repair', () => ({
  attemptCiRepair: mockAttemptCiRepair,
  CI_REPAIR_CAUSE: 'ci_repair',
}));

const mockMarkExhausted = mock(() => Promise.resolve());
mock.module('../../services/workflow/auto-merge-exhaustion', () => ({
  EXHAUSTED_CAUSE: 'auto_merge_exhausted',
  resetExhaustedRecheckCooldowns: () => {},
  markExhausted: mockMarkExhausted,
  decideTerminalState: () => Promise.resolve({ skip: false }),
}));

const mockNotify = mock(() => Promise.resolve());
mock.module('../../services/workflow/auto-merge-notify', () => ({ notify: mockNotify }));

const mockRecordTransition = mock(() => Promise.resolve());
mock.module('../../services/workflow/transition-recorder', () => ({
  recordTransition: mockRecordTransition,
}));

const mockPrisma = {
  workflowTransition: {
    findMany: mock(() => Promise.resolve<{ metadata: string }[]>([])),
    findFirst: mock(() => Promise.resolve<{ metadata: string } | null>(null)),
  },
};
mock.module('../../config/database', () => ({ prisma: mockPrisma }));

mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, error: () => {}, warn: () => {}, debug: () => {} }),
}));

// gh CLI stand-in for the env-failure rerun path: `run view --job N --log-failed`
// returns ghLogs[N]; `run rerun` is recorded. Plain promisify resolves the object
// passed as the callback's 2nd argument, matching `{ stdout }` destructuring.
const realChildProcess = await import('node:child_process');
const ghCalls: string[] = [];
let ghLogs: Record<string, string | Error> = {};
let ghRerunFails = false;
// run id -> headSha returned by `gh run view <id> --json headSha` (default: the PR head).
let ghRunHeads: Record<string, string | Error> = {};
mock.module('node:child_process', () => ({
  ...realChildProcess,
  exec: (cmd: string, _opts: unknown, cb: (err: Error | null, res?: unknown) => void) => {
    ghCalls.push(cmd);
    const runHead = cmd.match(/run view (\d+) --json headSha/)?.[1];
    if (runHead) {
      const h = ghRunHeads[runHead] ?? 'sha-current';
      if (h instanceof Error) return cb(h);
      return cb(null, { stdout: JSON.stringify({ headSha: h }), stderr: '' });
    }
    const job = cmd.match(/run view --job (\d+)/)?.[1];
    if (job) {
      const v = ghLogs[job];
      if (v === undefined || v instanceof Error) return cb(v ?? new Error('no log'));
      return cb(null, { stdout: v, stderr: '' });
    }
    if (/run rerun/.test(cmd) && ghRerunFails) return cb(new Error('rerun refused'));
    return cb(null, { stdout: '', stderr: '' });
  },
}));

const { handleCiFailure } = await import('../../services/workflow/auto-merge-ci-failure');
const { ENV_FAILURE_RERUN_CAUSE } = await import('../../services/workflow/auto-merge-env-rerun');

const candidate = {
  taskId: 556,
  taskTitle: 'test task',
  prNumber: 339,
  baseBranch: 'develop',
  cwd: '/repo',
  threshold: 0,
  completedAt: new Date(),
  mode: 'merge' as const,
};

const tryHandleConflictFalse = mock(() => Promise.resolve(false));

beforeEach(() => {
  mockReadMergeState.mockReset().mockResolvedValue('BLOCKED');
  mockReadHeadSha.mockReset().mockResolvedValue('sha-current');
  mockUpdatePrBranch.mockReset().mockResolvedValue(true);
  mockAttemptCiRepair.mockReset().mockResolvedValue({ bounced: true, attempt: 1 });
  mockMarkExhausted.mockReset().mockResolvedValue(undefined);
  mockNotify.mockReset().mockResolvedValue(undefined);
  mockRecordTransition.mockReset().mockResolvedValue(undefined);
  mockPrisma.workflowTransition.findMany.mockReset().mockResolvedValue([]);
  mockPrisma.workflowTransition.findFirst.mockReset().mockResolvedValue(null);
  mockReadPrChecks.mockReset().mockResolvedValue([]);
  tryHandleConflictFalse.mockClear();
  baseFailing = new Set<string>();
  ghCalls.length = 0;
  ghLogs = {};
  ghRerunFails = false;
  ghRunHeads = {};
});

const APT_LOG = [
  'Build\tInstall system dependencies\t2026-11-24T10:00:00Z apt-get install failed after 2 attempts.',
  'Build\tInstall system dependencies\t2026-11-24T10:00:01Z ##[error]Process completed with exit code 124.',
].join('\n');
const TEST_LOG = 'Test\tRun tests\t2026-11-24T10:00:00Z 3 fail\n';
const link = (run: number, job: number) => `https://github.com/o/r/actions/runs/${run}/job/${job}`;

function mockAptFailure(runId = 900) {
  mockReadPrChecks.mockResolvedValue([
    { name: 'Build (ubuntu-latest)', bucket: 'fail', link: link(runId, 1) },
  ]);
  ghLogs = { '1': APT_LOG };
}

describe('handleCiFailure — 環境要因の1回再実行', () => {
  test('全失敗が既知の印 → 失敗ジョブだけ再実行し別 cause で記録、ci_repair は呼ばれないこと', async () => {
    mockReadPrChecks.mockResolvedValue([
      { name: 'Build (ubuntu-latest)', bucket: 'fail', link: link(900, 1) },
      { name: 'Check Rust Code', bucket: 'fail', link: link(900, 2) },
    ]);
    ghLogs = { '1': APT_LOG, '2': APT_LOG };

    await handleCiFailure(
      candidate,
      ['Build (ubuntu-latest)', 'Check Rust Code'],
      tryHandleConflictFalse,
    );

    expect(mockAttemptCiRepair).not.toHaveBeenCalled();
    // Same run twice → one rerun, failed jobs only.
    expect(ghCalls.filter((c) => /run rerun/.test(c))).toEqual(['gh run rerun 900 --failed']);
    expect(mockRecordTransition).toHaveBeenCalledTimes(1);
    const rt = mockRecordTransition.mock.calls[0][0] as {
      cause: string;
      metadata: { headSha: string; runIds: string[]; signatures: string[] };
    };
    expect(rt.cause).toBe(ENV_FAILURE_RERUN_CAUSE);
    expect(rt.cause).not.toBe('auto_merge_cancelled_rerun');
    expect(rt.metadata.headSha).toBe('sha-current');
    expect(rt.metadata.runIds).toEqual(['900']);
    expect(rt.metadata.signatures).toEqual(['apt-install-timeout']);
  });

  test('同じ head SHA で記録済み（2回目の失敗） → 再実行せず ci_repair に回すこと', async () => {
    mockAptFailure();
    mockPrisma.workflowTransition.findMany.mockResolvedValue([
      { metadata: JSON.stringify({ headSha: 'sha-current', runIds: ['900'] }) },
    ]);

    await handleCiFailure(candidate, ['Build (ubuntu-latest)'], tryHandleConflictFalse);

    expect(ghCalls.filter((c) => /run rerun/.test(c))).toEqual([]);
    expect(mockAttemptCiRepair).toHaveBeenCalledTimes(1);
  });

  test('head SHA が変わっていれば再び1回再実行すること', async () => {
    mockAptFailure(901);
    mockPrisma.workflowTransition.findMany.mockResolvedValue([
      { metadata: JSON.stringify({ headSha: 'sha-old' }) },
    ]);

    await handleCiFailure(candidate, ['Build (ubuntu-latest)'], tryHandleConflictFalse);

    expect(ghCalls.filter((c) => /run rerun/.test(c))).toEqual(['gh run rerun 901 --failed']);
    expect(mockAttemptCiRepair).not.toHaveBeenCalled();
  });

  test('印に当たらない失敗が1つでも混じる → 再実行せず ci_repair に回すこと', async () => {
    mockReadPrChecks.mockResolvedValue([
      { name: 'Build (ubuntu-latest)', bucket: 'fail', link: link(900, 1) },
      { name: 'Test Backend', bucket: 'fail', link: link(900, 3) },
    ]);
    ghLogs = { '1': APT_LOG, '3': TEST_LOG };

    await handleCiFailure(
      candidate,
      ['Build (ubuntu-latest)', 'Test Backend'],
      tryHandleConflictFalse,
    );

    expect(ghCalls.filter((c) => /run rerun/.test(c))).toEqual([]);
    expect(mockRecordTransition).not.toHaveBeenCalled();
    expect(mockAttemptCiRepair).toHaveBeenCalledTimes(1);
  });

  test('ログ取得に失敗したジョブがある → ci_repair に回すこと', async () => {
    mockReadPrChecks.mockResolvedValue([
      { name: 'Build (ubuntu-latest)', bucket: 'fail', link: link(900, 1) },
    ]);
    ghLogs = { '1': new Error('log expired') };

    await handleCiFailure(candidate, ['Build (ubuntu-latest)'], tryHandleConflictFalse);

    expect(ghCalls.filter((c) => /run rerun/.test(c))).toEqual([]);
    expect(mockAttemptCiRepair).toHaveBeenCalledTimes(1);
  });

  test('link が無い／Actions 以外の URL → ci_repair に回すこと', async () => {
    mockReadPrChecks.mockResolvedValue([
      { name: 'Build (ubuntu-latest)', bucket: 'fail' },
      { name: 'Other', bucket: 'fail', link: 'https://example.com/ci/1' },
    ]);

    await handleCiFailure(candidate, ['Build (ubuntu-latest)', 'Other'], tryHandleConflictFalse);

    expect(ghCalls.filter((c) => /run rerun/.test(c))).toEqual([]);
    expect(mockAttemptCiRepair).toHaveBeenCalledTimes(1);
  });

  test('失敗チェックが0件 → 再実行せず従来経路に進むこと', async () => {
    await handleCiFailure(candidate, [], tryHandleConflictFalse);

    expect(ghCalls).toEqual([]);
    expect(mockRecordTransition).not.toHaveBeenCalled();
  });

  test('gh run rerun が拒否される → 記録せず ci_repair に回すこと', async () => {
    mockAptFailure();
    ghRerunFails = true;

    await handleCiFailure(candidate, ['Build (ubuntu-latest)'], tryHandleConflictFalse);

    expect(mockRecordTransition).not.toHaveBeenCalled();
    expect(mockAttemptCiRepair).toHaveBeenCalledTimes(1);
  });

  test('readPrChecks が null（gh 失敗） → ci_repair に回すこと', async () => {
    mockReadPrChecks.mockResolvedValue(null);

    await handleCiFailure(candidate, ['Build (ubuntu-latest)'], tryHandleConflictFalse);

    expect(mockAttemptCiRepair).toHaveBeenCalledTimes(1);
  });
});

describe('handleCiFailure — 環境要因の再実行履歴を取得できない場合', () => {
  const recorded = [{ metadata: JSON.stringify({ headSha: 'sha-current', runIds: ['900'] }) }];
  test.each([
    { name: '単発の取得失敗', responses: [null], reruns: 0 },
    { name: '同じ head での連続取得失敗', responses: [null, null], reruns: 0 },
    { name: '復旧後に同じ head の記録あり', responses: [null, recorded], reruns: 0 },
    { name: '復旧後に記録なし', responses: [null, []], reruns: 1 },
  ])('$name', async ({ responses, reruns }) => {
    mockAptFailure();
    const findMany = mockPrisma.workflowTransition.findMany;
    for (const [index, rows] of responses.entries()) {
      if (rows === null) findMany.mockRejectedValueOnce(new Error('履歴取得タイムアウト'));
      else findMany.mockResolvedValueOnce(rows);

      await handleCiFailure(candidate, ['Build (ubuntu-latest)'], tryHandleConflictFalse);
      const evaluations = index + 1;
      const expectedReruns = evaluations === responses.length ? reruns : 0;
      expect(findMany).toHaveBeenCalledTimes(evaluations);
      expect(ghCalls.filter((cmd) => cmd.includes('run rerun'))).toEqual(
        expectedReruns === 0 ? [] : ['gh run rerun 900 --failed'],
      );
      expect(mockReadPrChecks).toHaveBeenCalledTimes(2 * expectedReruns);
      if (expectedReruns === 0) expect(ghCalls).toEqual([]);
      expect(mockRecordTransition).toHaveBeenCalledTimes(expectedReruns);
      expect(mockAttemptCiRepair).toHaveBeenCalledTimes(evaluations - expectedReruns);
    }
  });
});
