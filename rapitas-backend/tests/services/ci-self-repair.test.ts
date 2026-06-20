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
  task: { update: mock(() => Promise.resolve({})) },
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
});
