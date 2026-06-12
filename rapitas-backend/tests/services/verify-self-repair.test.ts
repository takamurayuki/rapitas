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
  task: { update: mock(() => Promise.resolve({})) },
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
  });

  test('差し戻しフィードバックを question.md に書き、テスト改ざん禁止を明記すること', async () => {
    mockPrisma.workflowFile.findFirst.mockResolvedValue({ id: 7 });
    await attemptVerifyRepair(1, 'in_progress', 'self-contradicts', 'VERIFY BODY');

    expect(writeWorkflowFile).toHaveBeenCalledTimes(1);
    const args = writeWorkflowFile.mock.calls[0] as unknown[];
    expect(args[1]).toBe('question');
    const content = args[2] as string;
    expect(content).toContain('検証フェーズからの差し戻し');
    expect(content).toContain('テストを実際に通す');
    expect(content).toContain('VERIFY BODY');
  });
});
