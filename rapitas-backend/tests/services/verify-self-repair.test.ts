/**
 * verify-self-repair テスト
 *
 * verify.md 検証失敗時に実装フェーズへ差し戻す自己修復ループの検証:
 * plan 有無での戻し先 status（plan_approved / research_done）、リトライ上限到達で
 * block（bounced:false）、無効化（MAX=0）、question.md への差し戻しフィードバック。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const mockPrisma = {
  workflowTransition: { count: mock(() => Promise.resolve(0)) },
  workflowFile: { findFirst: mock(() => Promise.resolve(null)) },
  task: {
    update: mock(() => Promise.resolve({})),
    findUnique: mock(() => Promise.resolve({ themeId: null })),
  },
  // NOTE: Added — verify-self-repair.ts:52 reads verifyRepairLimit from userSettings.
  userSettings: { findFirst: mock(() => Promise.resolve(null)) },
  // NOTE: Added — verify-self-repair.ts:65 reads the last task_retried entry from activityLog.
  activityLog: { findFirst: mock(() => Promise.resolve(null)) },
};
const recordTransition = mock(() => Promise.resolve());
const writeWorkflowFile = mock(() => Promise.resolve('/p/question.md'));
const readWorkflowFile = mock(() => Promise.resolve(''));
const resolveWorkflowDir = mock(() => Promise.resolve({ dir: '/wf/1' }));

const noopLogger = { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} };
mock.module('../../config/database', () => ({
  prisma: mockPrisma,
  ensureDatabaseConnection: () => Promise.resolve(),
}));
mock.module('../../config/logger', () => ({
  createLogger: () => noopLogger,
  logger: noopLogger,
  getBackendLogFilePath: () => '/tmp/backend.log',
}));
mock.module('../../services/workflow/workflow-file-utils', () => ({
  resolveWorkflowDir,
  readWorkflowFile,
  writeWorkflowFile,
  cleanupRootWorkflowFiles: () => Promise.resolve(),
  extractMarkdownFromOutput: () => null,
}));
mock.module('../../services/workflow/transition-recorder', () => ({ recordTransition }));

// Self-drive (B fix): the bounce re-queues the task and idempotently starts the
// runner. Capture both to assert they fire on bounce but not on exhaustion.
const enqueue = mock(() => Promise.resolve({ id: 1 }));
const startProcessing = mock(() => {});
mock.module('../../services/workflow/workflow-queue', () => ({
  WorkflowQueueService: { getInstance: () => ({ enqueue }) },
}));
mock.module('../../services/workflow/workflow-runner', () => ({
  WorkflowRunner: { getInstance: () => ({ startProcessing }) },
}));
// Theme auto-run state: default INACTIVE so ensureRunnerResumes self-drives
// (single/manual exec) — the behavior the existing assertions expect. The
// concurrency-guard test flips this to active.
const isThemeAutoRunActive = mock(() => Promise.resolve(false));
mock.module('../../services/workflow/auto-run/theme-auto-run-service', () => ({
  isThemeAutoRunActive,
}));

const { attemptVerifyRepair } = await import('../../services/workflow/verify-self-repair');

describe('attemptVerifyRepair', () => {
  beforeEach(() => {
    delete process.env.RAPITAS_MAX_VERIFY_REPAIRS;
    mockPrisma.workflowTransition.count.mockReset();
    mockPrisma.workflowFile.findFirst.mockReset();
    mockPrisma.task.update.mockReset();
    recordTransition.mockReset();
    writeWorkflowFile.mockReset();
    readWorkflowFile.mockReset();
    mockPrisma.workflowTransition.count.mockResolvedValue(0);
    mockPrisma.workflowFile.findFirst.mockResolvedValue(null);
    mockPrisma.task.update.mockResolvedValue({});
    recordTransition.mockResolvedValue(undefined);
    writeWorkflowFile.mockResolvedValue('/p/question.md');
    readWorkflowFile.mockResolvedValue('');
    enqueue.mockReset();
    startProcessing.mockReset();
    enqueue.mockResolvedValue({ id: 1 });
    mockPrisma.task.findUnique.mockReset();
    mockPrisma.task.findUnique.mockResolvedValue({ themeId: null });
    isThemeAutoRunActive.mockReset();
    isThemeAutoRunActive.mockResolvedValue(false);
    // NOTE: Must reset per-test — a test that sets verifyRepairLimit would
    // otherwise leak into later tests since these mocks are shared across it()s.
    mockPrisma.userSettings.findFirst.mockReset();
    mockPrisma.userSettings.findFirst.mockResolvedValue(null);
    mockPrisma.activityLog.findFirst.mockReset();
    mockPrisma.activityLog.findFirst.mockResolvedValue(null);
  });

  test('plan あり → plan_approved へ bounce（attempt 1）すること', async () => {
    mockPrisma.workflowFile.findFirst.mockResolvedValue({ id: 7 });

    const r = await attemptVerifyRepair(1, 'in_progress', 'self-contradicts', '...verify...');

    expect(r.bounced).toBe(true);
    expect(r.newStatus).toBe('plan_approved');
    expect(r.attempt).toBe(1);
    // task を in-progress に戻し、修復 transition を記録すること
    const tu = mockPrisma.task.update.mock.calls[0][0] as { data: { status: string } };
    expect(tu.data.status).toBe('in-progress');
    const rt = recordTransition.mock.calls[0][0] as { cause: string; toStatus: string };
    expect(rt.cause).toBe('verify_repair');
    expect(rt.toStatus).toBe('plan_approved');
  });

  test('plan なし → research_done へ bounce すること', async () => {
    mockPrisma.workflowFile.findFirst.mockResolvedValue(null);
    const r = await attemptVerifyRepair(1, 'in_progress', 'fail', 'v');
    expect(r.newStatus).toBe('research_done');
  });

  test('リトライ上限に達したら bounced:false（caller が block）になること', async () => {
    mockPrisma.workflowTransition.count.mockResolvedValue(2); // == default max
    const r = await attemptVerifyRepair(1, 'in_progress', 'fail', 'v');
    expect(r.bounced).toBe(false);
    expect(recordTransition).not.toHaveBeenCalled();
    // 上限到達時は再実行を駆動しない（block するのみ）
    expect(enqueue).not.toHaveBeenCalled();
    expect(startProcessing).not.toHaveBeenCalled();
  });

  test('bounce 時に再キュー投入＋ランナー起動で自走させること（単発実行の詰まり対策）', async () => {
    mockPrisma.workflowFile.findFirst.mockResolvedValue({ id: 7 });
    const r = await attemptVerifyRepair(1, 'in_progress', 'fail', 'v');
    expect(r.bounced).toBe(true);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect((enqueue.mock.calls[0][0] as { taskId: number }).taskId).toBe(1);
    expect(startProcessing).toHaveBeenCalledTimes(1);
    // workflowStatus も実装エントリへ戻すこと
    const tu = mockPrisma.task.update.mock.calls[0][0] as {
      data: { status: string; workflowStatus: string };
    };
    expect(tu.data.workflowStatus).toBe('plan_approved');
  });

  test('既にキュー済み(enqueue が throw)でもランナー起動は行い、bounce は継続すること', async () => {
    mockPrisma.workflowFile.findFirst.mockResolvedValue({ id: 7 });
    enqueue.mockRejectedValueOnce(new Error('already in the queue'));
    const r = await attemptVerifyRepair(1, 'in_progress', 'fail', 'v');
    expect(r.bounced).toBe(true);
    expect(startProcessing).toHaveBeenCalledTimes(1);
  });

  test('テーマ自動実行が稼働中なら自走しない（スケジューラに委譲＝並列起動を防ぐ）', async () => {
    mockPrisma.workflowFile.findFirst.mockResolvedValue({ id: 7 });
    mockPrisma.task.findUnique.mockResolvedValue({ themeId: 1 });
    isThemeAutoRunActive.mockResolvedValue(true); // theme auto-run owns this task
    const r = await attemptVerifyRepair(1, 'in_progress', 'fail', 'v');
    expect(r.bounced).toBe(true); // 差し戻し自体は行う
    // ただし themeId-less な enqueue / runner 起動はしない（並列起動の原因を断つ）
    expect(enqueue).not.toHaveBeenCalled();
    expect(startProcessing).not.toHaveBeenCalled();
  });

  test('差し戻しフィードバックを verify.md に書き、テスト改ざん禁止を明記すること', async () => {
    mockPrisma.workflowFile.findFirst.mockResolvedValue({ id: 7 });
    await attemptVerifyRepair(1, 'in_progress', 'self-contradicts', 'VERIFY BODY');

    expect(writeWorkflowFile).toHaveBeenCalledTimes(1);
    const args = writeWorkflowFile.mock.calls[0] as unknown[];
    expect(args[1]).toBe('verify');
    const content = args[2] as string;
    expect(content).toContain('検証フェーズからの差し戻し');
    expect(content).toContain('テストを実際に通す');
    expect(content).toContain('VERIFY BODY');
  });

  test('境界値: prior = max-1 は bounce する（attempt = max）こと', async () => {
    // Default max is 2 (DEFAULT_MAX_VERIFY_REPAIRS); prior=1 is the last bounce-able attempt.
    mockPrisma.workflowTransition.count.mockResolvedValue(1);
    mockPrisma.workflowFile.findFirst.mockResolvedValue({ id: 7 });
    const r = await attemptVerifyRepair(1, 'in_progress', 'fail', 'v');
    expect(r.bounced).toBe(true);
    expect(r.attempt).toBe(2);
  });

  // NOTE: RAPITAS_MAX_VERIFY_REPAIRS is read into a MODULE-LEVEL constant
  // (DEFAULT_MAX_VERIFY_REPAIRS) at import time, so setting the env var from a
  // test cannot change it post-import. The runtime-configurable disable path is
  // UserSettings.verifyRepairLimit=0 (covered below), which resolveMaxRepairs()
  // reads dynamically on every call.

  test('UserSettings.verifyRepairLimit が設定されていれば env/既定より優先されること（上限を1に絞る）', async () => {
    mockPrisma.userSettings.findFirst.mockResolvedValue({ verifyRepairLimit: 1 });
    mockPrisma.workflowFile.findFirst.mockResolvedValue({ id: 7 });
    // prior=1 === configured max(1) -> exhausted, must block instead of the
    // env-default max(2) which would still allow this attempt.
    mockPrisma.workflowTransition.count.mockResolvedValue(1);
    const r = await attemptVerifyRepair(1, 'in_progress', 'fail', 'v');
    expect(r.bounced).toBe(false);
  });

  test('UserSettings.verifyRepairLimit=0 は明示的な無効化として尊重されること', async () => {
    mockPrisma.userSettings.findFirst.mockResolvedValue({ verifyRepairLimit: 0 });
    const r = await attemptVerifyRepair(1, 'in_progress', 'fail', 'v');
    expect(r.bounced).toBe(false);
    expect(mockPrisma.workflowTransition.count).not.toHaveBeenCalled();
  });

  // FAIL CLOSED: countPriorRepairs (verify-self-repair.ts) explicitly catches a
  // rejecting count() and returns Number.MAX_SAFE_INTEGER instead of 0 — a bare
  // `.catch(() => 0)` would make a transient DB error read as "no prior
  // repairs", letting the bounce loop re-enter forever on every failed count.
  // This asserts the caller-visible effect: a rejecting count blocks (bounced:
  // false) instead of bouncing, regardless of the configured cap.
  test('FAIL CLOSED: カウントクエリが reject したら bounced:false（block）になり、無限バウンスしないこと', async () => {
    mockPrisma.workflowTransition.count.mockImplementation(() =>
      Promise.reject(new Error('connection reset')),
    );
    mockPrisma.workflowFile.findFirst.mockResolvedValue({ id: 7 });

    const r = await attemptVerifyRepair(1, 'in_progress', 'fail', 'v');

    expect(r.bounced).toBe(false);
    // Must not attempt the bounce (no transition recorded, no self-drive re-queue).
    expect(recordTransition).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
    expect(startProcessing).not.toHaveBeenCalled();
    expect(mockPrisma.task.update).not.toHaveBeenCalled();
  });

  test('FAIL CLOSED: カウントクエリが reject したら、非常に高い上限(cap)を設定しても block すること', async () => {
    // Even a generous configured cap must not let a failed count masquerade as
    // "budget available" — MAX_SAFE_INTEGER prior must exceed any realistic cap.
    mockPrisma.userSettings.findFirst.mockResolvedValue({ verifyRepairLimit: 1_000_000 });
    mockPrisma.workflowTransition.count.mockImplementation(() =>
      Promise.reject(new Error('timeout')),
    );
    mockPrisma.workflowFile.findFirst.mockResolvedValue({ id: 7 });

    const r = await attemptVerifyRepair(1, 'in_progress', 'fail', 'v');

    expect(r.bounced).toBe(false);
  });

  test('直近の task_retried 以降の repair のみをカウントし、リトライで予算がリセットされること', async () => {
    // A retry happened after 2 prior repairs (>= default max 2) — the count query
    // is scoped to createdAt > lastRetry.createdAt, so a fresh mock returning 0
    // for "since last retry" must reset the budget (not read as exhausted).
    const retriedAt = new Date('2026-01-01T00:00:00Z');
    mockPrisma.activityLog.findFirst.mockResolvedValue({ createdAt: retriedAt });
    mockPrisma.workflowTransition.count.mockResolvedValue(0);
    mockPrisma.workflowFile.findFirst.mockResolvedValue({ id: 7 });
    const r = await attemptVerifyRepair(1, 'in_progress', 'fail', 'v');
    expect(r.bounced).toBe(true);
    expect(r.attempt).toBe(1);
    // The count query must have been scoped by the retry timestamp.
    const firstCall = mockPrisma.workflowTransition.count.mock.calls[0] as unknown as unknown[];
    const countArgs = firstCall[0] as { where: { createdAt?: { gt: Date } } };
    expect(countArgs.where.createdAt?.gt).toEqual(retriedAt);
  });
});
