/**
 * ci-self-repair テスト
 *
 * CI失敗時に実装へ差し戻す自己修復ループ:
 * plan有無での戻し先status、上限到達でbounced:false、再投入(enqueue)、
 * question.md への差し戻しフィードバック記載を検証する。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const mockPrisma = {
  workflowTransition: { count: mock(() => Promise.resolve(0)) },
  workflowFile: { findFirst: mock(() => Promise.resolve(null)) },
  task: {
    update: mock(() => Promise.resolve({})),
    // NOTE: Added after ci-self-repair.ts:119 — findUnique checks if task is a
    // conflict-resolution task (title matches "PR #N の競合を解消") to skip CI repair.
    findUnique: mock(() => Promise.resolve(null)),
  },
};
const recordTransition = mock(() => Promise.resolve());
const writeWorkflowFile = mock(() => Promise.resolve('/p/question.md'));
const readWorkflowFile = mock(() => Promise.resolve(''));
const resolveWorkflowDir = mock(() => Promise.resolve({ dir: '/wf/1' }));
const enqueue = mock(() => Promise.resolve({}));

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
mock.module('../../services/workflow/workflow-queue', () => ({
  WorkflowQueueService: { getInstance: () => ({ enqueue }) },
}));

const { attemptCiRepair } = await import('../../services/workflow/ci-self-repair');

describe('attemptCiRepair', () => {
  beforeEach(() => {
    delete process.env.RAPITAS_MAX_CI_REPAIRS;
    mockPrisma.workflowTransition.count.mockReset().mockResolvedValue(0);
    mockPrisma.workflowFile.findFirst.mockReset().mockResolvedValue(null);
    mockPrisma.task.update.mockReset().mockResolvedValue({});
    // Default: no conflict-resolution task match (see ci-self-repair.ts:126) so
    // existing tests keep exercising the normal bounce path.
    mockPrisma.task.findUnique.mockReset().mockResolvedValue(null);
    recordTransition.mockReset().mockResolvedValue(undefined);
    writeWorkflowFile.mockReset().mockResolvedValue('/p/question.md');
    readWorkflowFile.mockReset().mockResolvedValue('');
    enqueue.mockReset().mockResolvedValue({});
  });

  test('plan あり → in-progress + plan_approved へ差し戻し、再投入すること', async () => {
    mockPrisma.workflowFile.findFirst.mockResolvedValue({ id: 7 });

    const r = await attemptCiRepair(1, ['Check Frontend']);

    expect(r.bounced).toBe(true);
    expect(r.attempt).toBe(1);
    const tu = mockPrisma.task.update.mock.calls[0][0] as {
      data: { status: string; workflowStatus: string };
    };
    expect(tu.data.status).toBe('in-progress');
    expect(tu.data.workflowStatus).toBe('plan_approved');
    const rt = recordTransition.mock.calls[0][0] as { cause: string };
    expect(rt.cause).toBe('ci_repair');
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  test('plan なし → research_done へ差し戻し', async () => {
    mockPrisma.workflowFile.findFirst.mockResolvedValue(null);
    const r = await attemptCiRepair(1, ['Lint Code']);
    const tu = mockPrisma.task.update.mock.calls[0][0] as { data: { workflowStatus: string } };
    expect(tu.data.workflowStatus).toBe('research_done');
    expect(r.bounced).toBe(true);
  });

  test('上限到達で bounced:false（レビュー待ちへ）になり、再投入しないこと', async () => {
    mockPrisma.workflowTransition.count.mockResolvedValue(2); // == default max
    const r = await attemptCiRepair(1, ['Test Backend']);
    expect(r.bounced).toBe(false);
    expect(enqueue).not.toHaveBeenCalled();
    expect(recordTransition).not.toHaveBeenCalled();
  });

  test('FAIL CLOSED: カウントクエリが reject しても bounced:false（レビュー待ち）になり、再投入しないこと', async () => {
    // Fault injection: a prior `.catch(() => 0)` here made a DB hiccup read as
    // "0 prior repairs" (always < max), so the loop kept bouncing forever
    // instead of ever reaching the exhausted/review-wait branch.
    mockPrisma.workflowTransition.count.mockRejectedValue(new Error('connection reset'));
    const r = await attemptCiRepair(1, ['Test Backend']);
    expect(r.bounced).toBe(false);
    expect(enqueue).not.toHaveBeenCalled();
    expect(recordTransition).not.toHaveBeenCalled();
    // Must NOT have proceeded to reset the task for a re-run.
    expect(mockPrisma.task.update).not.toHaveBeenCalled();
  });

  test('差し戻しフィードバックを verify.md に追記し、失敗チェック名を明記すること', async () => {
    mockPrisma.workflowFile.findFirst.mockResolvedValue({ id: 7 });
    await attemptCiRepair(1, ['Check Frontend', 'Lint Code']);
    expect(writeWorkflowFile).toHaveBeenCalled();
    const args = writeWorkflowFile.mock.calls[0] as unknown[];
    expect(args[1]).toBe('verify');
    const content = args[2] as string;
    expect(content).toContain('CIからの差し戻し');
    expect(content).toContain('Check Frontend');
    expect(content).toContain('Lint Code');
  });

  test('境界値: prior = max-1 は bounce する（attempt = max）こと', async () => {
    // Default max is 2 (DEFAULT_MAX_CI_REPAIRS); prior=1 is the last bounce-able attempt.
    mockPrisma.workflowTransition.count.mockResolvedValue(1);
    mockPrisma.workflowFile.findFirst.mockResolvedValue({ id: 7 });
    const r = await attemptCiRepair(1, ['Test Backend']);
    expect(r.bounced).toBe(true);
    expect(r.attempt).toBe(2);
  });

  test('競合解消タスク（PR #N の競合を解消）は CI-repair をスキップし completed のまま残ること', async () => {
    // NOTE: Regression guard — re-running the agent on a conflict-resolution
    // task finds no conflict left and cannot fix a CI bug, so bouncing it merely
    // un-completes an already-finished task (observed task 280 bug).
    mockPrisma.task.findUnique.mockResolvedValue({
      title: 'PR #123 の競合を解消',
      githubPrId: 42,
    });
    const r = await attemptCiRepair(5, ['Test Backend']);
    expect(r.bounced).toBe(false);
    expect(mockPrisma.workflowTransition.count).not.toHaveBeenCalled();
    expect(mockPrisma.task.update).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  test('タイトルが似ていても githubPrId が無ければ通常どおり CI-repair すること', async () => {
    // The conflict-task skip requires BOTH the title pattern AND a linked PR —
    // a task merely titled similarly (no PR yet) must not be skipped.
    mockPrisma.task.findUnique.mockResolvedValue({
      title: 'PR #123 の競合を解消',
      githubPrId: null,
    });
    mockPrisma.workflowFile.findFirst.mockResolvedValue({ id: 7 });
    const r = await attemptCiRepair(5, ['Test Backend']);
    expect(r.bounced).toBe(true);
  });

  test('タイトルが競合解消パターンに一致しない通常タスクは CI-repair すること', async () => {
    mockPrisma.task.findUnique.mockResolvedValue({ title: 'Add dark mode toggle', githubPrId: 99 });
    mockPrisma.workflowFile.findFirst.mockResolvedValue({ id: 7 });
    const r = await attemptCiRepair(5, ['Test Backend']);
    expect(r.bounced).toBe(true);
  });
});
