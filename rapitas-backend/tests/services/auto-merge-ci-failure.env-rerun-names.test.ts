/**
 * auto-merge-ci-failure 環境要因再実行テスト（同名チェック・実工程名）
 *
 * 同名の失敗チェックが複数あるとき全件を判定し、1件でも印に当たらなければ ci_repair に回すこと、
 * 実工程名の接尾辞付き（Install system dependencies (Ubuntu)）でも再実行することを検証する。
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
describe('handleCiFailure — 同名チェックと実工程名', () => {
  const UBUNTU_APT_LOG = APT_LOG.replaceAll(
    'Install system dependencies',
    'Install system dependencies (Ubuntu)',
  );

  test('同名の失敗が複数あり1件が非環境失敗 → 再実行せず ci_repair に回すこと', async () => {
    mockReadPrChecks.mockResolvedValue([
      { name: 'Build (ubuntu-latest)', bucket: 'fail', link: link(900, 1) },
      { name: 'Build (ubuntu-latest)', bucket: 'fail', link: link(901, 2) },
    ]);
    ghLogs = { '1': APT_LOG, '2': TEST_LOG };

    await handleCiFailure(candidate, ['Build (ubuntu-latest)'], tryHandleConflictFalse);

    expect(ghCalls.filter((c) => /run rerun/.test(c))).toEqual([]);
    expect(mockRecordTransition).not.toHaveBeenCalled();
    expect(mockAttemptCiRepair).toHaveBeenCalledTimes(1);
  });

  test('同名の失敗が複数あり全て印 → 各 run を重複なく1回ずつ再実行すること', async () => {
    mockReadPrChecks.mockResolvedValue([
      { name: 'Build (ubuntu-latest)', bucket: 'fail', link: link(900, 1) },
      { name: 'Build (ubuntu-latest)', bucket: 'fail', link: link(900, 2) },
      { name: 'Build (ubuntu-latest)', bucket: 'fail', link: link(902, 3) },
    ]);
    ghLogs = { '1': APT_LOG, '2': APT_LOG, '3': APT_LOG };

    await handleCiFailure(candidate, ['Build (ubuntu-latest)'], tryHandleConflictFalse);

    expect(ghCalls.filter((c) => /run rerun/.test(c))).toEqual([
      'gh run rerun 900 --failed',
      'gh run rerun 902 --failed',
    ]);
    expect(mockAttemptCiRepair).not.toHaveBeenCalled();
  });

  test('同名エントリの片方に link が無い → ci_repair に回すこと', async () => {
    mockReadPrChecks.mockResolvedValue([
      { name: 'Build (ubuntu-latest)', bucket: 'fail', link: link(900, 1) },
      { name: 'Build (ubuntu-latest)', bucket: 'fail' },
    ]);
    ghLogs = { '1': APT_LOG };

    await handleCiFailure(candidate, ['Build (ubuntu-latest)'], tryHandleConflictFalse);

    expect(ghCalls.filter((c) => /run rerun/.test(c))).toEqual([]);
    expect(mockAttemptCiRepair).toHaveBeenCalledTimes(1);
  });

  test('失敗名に対応するエントリが無い → ci_repair に回すこと', async () => {
    mockReadPrChecks.mockResolvedValue([{ name: 'Other', bucket: 'fail', link: link(900, 1) }]);
    ghLogs = { '1': APT_LOG };

    await handleCiFailure(candidate, ['Build (ubuntu-latest)'], tryHandleConflictFalse);

    expect(ghCalls.filter((c) => /run rerun/.test(c))).toEqual([]);
    expect(mockAttemptCiRepair).toHaveBeenCalledTimes(1);
  });

  test('接尾辞付きの実工程 Install system dependencies (Ubuntu) → 1回再実行すること', async () => {
    mockReadPrChecks.mockResolvedValue([
      { name: 'Build (ubuntu-latest)', bucket: 'fail', link: link(900, 1) },
    ]);
    ghLogs = { '1': UBUNTU_APT_LOG };

    await handleCiFailure(candidate, ['Build (ubuntu-latest)'], tryHandleConflictFalse);

    expect(ghCalls.filter((c) => /run rerun/.test(c))).toEqual(['gh run rerun 900 --failed']);
    expect(mockAttemptCiRepair).not.toHaveBeenCalled();
  });
});

describe('handleCiFailure — DIRTY 委譲と環境再実行の順序', () => {
  test('DIRTY 委譲で処理済み → 環境再実行より先に戻り gh を呼ばないこと', async () => {
    mockReadPrChecks.mockResolvedValue([
      { name: 'Build (ubuntu-latest)', bucket: 'fail', link: link(900, 1) },
    ]);
    ghLogs = { '1': APT_LOG };
    const tryHandleConflictTrue = mock(() => Promise.resolve(true));

    await handleCiFailure(candidate, ['Build (ubuntu-latest)'], tryHandleConflictTrue);

    expect(tryHandleConflictTrue).toHaveBeenCalledTimes(1);
    expect(ghCalls).toEqual([]);
    expect(mockRecordTransition).not.toHaveBeenCalled();
    expect(mockAttemptCiRepair).not.toHaveBeenCalled();
  });

  test('DIRTY でなければ従来どおり環境再実行に進むこと', async () => {
    mockReadPrChecks.mockResolvedValue([
      { name: 'Build (ubuntu-latest)', bucket: 'fail', link: link(900, 1) },
    ]);
    ghLogs = { '1': APT_LOG };

    await handleCiFailure(candidate, ['Build (ubuntu-latest)'], tryHandleConflictFalse);

    expect(tryHandleConflictFalse).toHaveBeenCalledTimes(1);
    expect(ghCalls.filter((c) => /run rerun/.test(c))).toEqual(['gh run rerun 900 --failed']);
  });
});

describe('handleCiFailure — ログ取得中に head が変わる', () => {
  const checks = [{ name: 'Build (ubuntu-latest)', bucket: 'fail', link: link(900, 1) }];

  test('評価開始時の head で再実行済み → 旧 run を新 head の予算として再実行しないこと', async () => {
    mockReadPrChecks.mockResolvedValue(checks);
    ghLogs = { '1': APT_LOG };
    // ログ取得（gh run view）を境に head が旧 SHA から新 SHA へ変わる（外部 push）。
    mockReadHeadSha
      .mockReset()
      .mockImplementation(async () =>
        ghCalls.some((c) => /run view/.test(c)) ? 'sha-current' : 'sha-old',
      );
    mockPrisma.workflowTransition.findMany.mockResolvedValue([
      { metadata: JSON.stringify({ headSha: 'sha-old', runIds: ['900'] }) },
    ]);

    await handleCiFailure(candidate, ['Build (ubuntu-latest)'], tryHandleConflictFalse);

    expect(ghCalls.filter((c) => /run rerun/.test(c))).toEqual([]);
    expect(mockRecordTransition).not.toHaveBeenCalled();
  });

  test('ログ取得の前後で head が違う → 旧 run を再実行・記録しないこと', async () => {
    mockReadPrChecks.mockResolvedValue(checks);
    ghLogs = { '1': APT_LOG };
    mockReadHeadSha
      .mockReset()
      .mockImplementation(async () =>
        ghCalls.some((c) => /run view/.test(c)) ? 'sha-current' : 'sha-old',
      );

    await handleCiFailure(candidate, ['Build (ubuntu-latest)'], tryHandleConflictFalse);

    expect(ghCalls.filter((c) => /run rerun/.test(c))).toEqual([]);
    expect(mockRecordTransition).not.toHaveBeenCalled();
  });

  test('head が変わらなければ従来どおり1回再実行し、その head で記録すること', async () => {
    mockReadPrChecks.mockResolvedValue(checks);
    ghLogs = { '1': APT_LOG };

    await handleCiFailure(candidate, ['Build (ubuntu-latest)'], tryHandleConflictFalse);

    expect(ghCalls.filter((c) => /run rerun/.test(c))).toEqual(['gh run rerun 900 --failed']);
    const rt = mockRecordTransition.mock.calls[0][0] as { metadata: { headSha: string } };
    expect(rt.metadata.headSha).toBe('sha-current');
  });
});
