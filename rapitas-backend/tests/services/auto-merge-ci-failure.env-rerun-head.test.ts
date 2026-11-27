/**
 * auto-merge-ci-failure 環境要因再実行テスト（head と最新失敗集合の照合）
 *
 * run の head、取得異常、再実行直前の head と失敗集合の変化を検証する。
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

// 既定では本線由来の失敗を含めず、PR 自身の失敗として扱う。
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
// stdout 指定は JSON 化せず返し、空出力と不正 JSON も実際の CLI 応答として再現する。
type RunHeadResponse = string | Error | { stdout: string };
let ghRunHeads: Record<string, RunHeadResponse> = {};
mock.module('node:child_process', () => ({
  ...realChildProcess,
  exec: (cmd: string, _opts: unknown, cb: (err: Error | null, res?: unknown) => void) => {
    ghCalls.push(cmd);
    const runHead = cmd.match(/run view (\d+) --json headSha/)?.[1];
    if (runHead) {
      const h = ghRunHeads[runHead] ?? 'sha-current';
      if (h instanceof Error) return cb(h);
      const stdout = typeof h === 'string' ? JSON.stringify({ headSha: h }) : h.stdout;
      return cb(null, { stdout, stderr: '' });
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
const link = (run: number, job: number) => `https://github.com/o/r/actions/runs/${run}/job/${job}`;
describe('handleCiFailure — 各 run の head 照合', () => {
  const runViewCalls = () => ghCalls.filter((c) => /run view \d+ --json headSha/.test(c));
  const reruns = () => ghCalls.filter((c) => /run rerun/.test(c));

  test('一致する run → run ごとに head を1回だけ取得して再実行し、固定した head で記録すること', async () => {
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

    expect(runViewCalls()).toEqual(['gh run view 900 --json headSha']);
    expect(reruns()).toEqual(['gh run rerun 900 --failed']);
    const rt = mockRecordTransition.mock.calls[0][0] as { metadata: { headSha: string } };
    expect(rt.metadata.headSha).toBe('sha-current');
  });

  test.each<[string, RunHeadResponse]>([
    ['固定した head と違う', 'sha-old'],
    ['取得できない（gh エラー）', new Error('run not found')],
    ['JSON 内の headSha が空', ''],
    ['生の空出力', { stdout: '' }],
    ['不正 JSON', { stdout: '{"headSha":' }],
    ['短縮 SHA（完全一致しない）', 'sha-cur'],
  ])('run の head が %s → 再実行も記録もせず ci_repair に回すこと', async (_label, runHead) => {
    mockReadPrChecks.mockResolvedValue([
      { name: 'Build (ubuntu-latest)', bucket: 'fail', link: link(900, 1) },
    ]);
    ghLogs = { '1': APT_LOG };
    ghRunHeads = { '900': runHead };

    await handleCiFailure(candidate, ['Build (ubuntu-latest)'], tryHandleConflictFalse);

    expect(reruns()).toEqual([]);
    expect(mockRecordTransition).not.toHaveBeenCalled();
    expect(mockAttemptCiRepair).toHaveBeenCalledTimes(1);
  });

  test('複数 run のうち1つだけ head が違う → 一致する run も再実行しないこと', async () => {
    mockReadPrChecks.mockResolvedValue([
      { name: 'Build (ubuntu-latest)', bucket: 'fail', link: link(900, 1) },
      { name: 'Check Rust Code', bucket: 'fail', link: link(902, 2) },
    ]);
    ghLogs = { '1': APT_LOG, '2': APT_LOG };
    ghRunHeads = { '902': 'sha-old' };

    await handleCiFailure(
      candidate,
      ['Build (ubuntu-latest)', 'Check Rust Code'],
      tryHandleConflictFalse,
    );

    expect(reruns()).toEqual([]);
    expect(mockRecordTransition).not.toHaveBeenCalled();
    expect(mockAttemptCiRepair).toHaveBeenCalledTimes(1);
  });

  test('run の head 一致後、最終再読だけで PR の head が変化 → 再実行も記録もせず ci_repair', async () => {
    mockReadPrChecks.mockResolvedValue([
      { name: 'Build (ubuntu-latest)', bucket: 'fail', link: link(900, 1) },
    ]);
    ghLogs = { '1': APT_LOG };
    ghRunHeads = { '900': 'sha-current' };
    mockReadHeadSha.mockResolvedValueOnce('sha-current').mockResolvedValue('sha-new');
    await handleCiFailure(candidate, ['Build (ubuntu-latest)'], tryHandleConflictFalse);
    expect(runViewCalls()).toEqual(['gh run view 900 --json headSha']);
    expect(reruns()).toEqual([]);
    expect(mockRecordTransition).not.toHaveBeenCalled();
    expect(mockAttemptCiRepair).toHaveBeenCalledTimes(1);
    expect(mockReadHeadSha).toHaveBeenCalledTimes(2);
  });

  test('固定する head を取得できない → 再実行せず ci_repair に回すこと', async () => {
    mockReadPrChecks.mockResolvedValue([
      { name: 'Build (ubuntu-latest)', bucket: 'fail', link: link(900, 1) },
    ]);
    ghLogs = { '1': APT_LOG };
    mockReadHeadSha.mockReset().mockResolvedValue(null);

    await handleCiFailure(candidate, ['Build (ubuntu-latest)'], tryHandleConflictFalse);

    expect(reruns()).toEqual([]);
    expect(mockRecordTransition).not.toHaveBeenCalled();
    expect(mockAttemptCiRepair).toHaveBeenCalledTimes(1);
  });

  test('チェック一覧の取得中に push があり旧 head で再実行済み → 旧 run を再実行しないこと', async () => {
    ghLogs = { '1': APT_LOG };
    // 旧 head の予算は消費済み。head は一覧取得（readPrChecks）を境に新 SHA へ変わる。
    let listFetched = false;
    mockReadPrChecks.mockImplementation(async () => {
      listFetched = true;
      return [{ name: 'Build (ubuntu-latest)', bucket: 'fail', link: link(900, 1) }];
    });
    mockReadHeadSha
      .mockReset()
      .mockImplementation(async () => (listFetched ? 'sha-current' : 'sha-old'));
    mockPrisma.workflowTransition.findMany.mockResolvedValue([
      { metadata: JSON.stringify({ headSha: 'sha-old', runIds: ['900'] }) },
    ]);
    ghRunHeads = { '900': 'sha-old' };

    await handleCiFailure(candidate, ['Build (ubuntu-latest)'], tryHandleConflictFalse);

    expect(reruns()).toEqual([]);
    expect(mockRecordTransition).not.toHaveBeenCalled();
  });
});

describe('handleCiFailure — 再実行直前の最新失敗集合の照合', () => {
  const reruns = () => ghCalls.filter((c) => /run rerun/.test(c));
  const TEST_LOG = 'Test\tRun tests\t2026-11-24T10:00:00Z 3 fail\n';
  const build = { name: 'Build (ubuntu-latest)', bucket: 'fail', link: link(900, 1) };
  const backend = { name: 'Test Backend', bucket: 'fail', link: link(901, 2) };

  test('一覧に未知の失敗が既に含まれる（呼び出し元の failedChecks に無い）→ 再実行せず ci_repair', async () => {
    mockReadPrChecks.mockResolvedValue([build, backend]);
    ghLogs = { '1': APT_LOG, '2': TEST_LOG };

    await handleCiFailure(candidate, ['Build (ubuntu-latest)'], tryHandleConflictFalse);

    expect(reruns()).toEqual([]);
    expect(mockRecordTransition).not.toHaveBeenCalled();
    expect(mockAttemptCiRepair).toHaveBeenCalledTimes(1);
  });

  test.each<[string, Array<Record<string, string>> | null]>([
    ['未知の失敗が加わった', [build, backend]],
    ['失敗が消えた（成功へ転換）', []],
    ['同名の job id が変わった', [{ ...build, link: link(900, 5) }]],
    ['同名の run id が変わった', [{ ...build, link: link(950, 1) }]],
    ['再読みの一覧取得に失敗した', null],
  ])('再実行直前の再読みで %s → 再実行も記録もしないこと', async (_label, latest) => {
    mockReadPrChecks.mockReset().mockResolvedValueOnce([build]).mockResolvedValue(latest);
    ghLogs = { '1': APT_LOG };

    await handleCiFailure(candidate, ['Build (ubuntu-latest)'], tryHandleConflictFalse);

    expect(reruns()).toEqual([]);
    expect(mockRecordTransition).not.toHaveBeenCalled();
    expect(mockAttemptCiRepair).toHaveBeenCalledTimes(1);
  });

  test('再読みの集合が判定済みと一致 → 判定済みの run だけを1回再実行すること', async () => {
    mockReadPrChecks.mockReset().mockResolvedValue([build]);
    ghLogs = { '1': APT_LOG };

    await handleCiFailure(candidate, ['Build (ubuntu-latest)'], tryHandleConflictFalse);

    expect(mockReadPrChecks).toHaveBeenCalledTimes(2);
    expect(reruns()).toEqual(['gh run rerun 900 --failed']);
    expect(mockAttemptCiRepair).not.toHaveBeenCalled();
  });
});
