/**
 * research-phase-handler.test
 *
 * Focused coverage for the manual-execution research harvest: the
 * critic-rejection guard (task 539 resurrection bug) and the normal
 * save-and-advance path.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

const mockSessionFindUnique = mock(() =>
  Promise.resolve<{ startedAt: Date | null; createdAt: Date } | null>({
    startedAt: new Date('2026-08-07T17:05:00Z'),
    createdAt: new Date('2026-08-07T17:04:00Z'),
  }),
);
const mockSessionUpdate = mock(() => Promise.resolve({}));
const mockTaskUpdate = mock(() => Promise.resolve({}));
const mockTaskFindUnique = mock(() =>
  Promise.resolve<{ workflowStatus: string; workflowMode: string } | null>({
    workflowStatus: 'draft',
    workflowMode: 'standard',
  }),
);
const mockExecUpdateMany = mock(() => Promise.resolve({ count: 1 }));
const mockExecFindFirst = mock(() => Promise.resolve(null));

mock.module('../../../config/database', () => ({
  prisma: {
    agentSession: { findUnique: mockSessionFindUnique, update: mockSessionUpdate },
    task: { update: mockTaskUpdate, findUnique: mockTaskFindUnique },
    agentExecution: { updateMany: mockExecUpdateMany, findFirst: mockExecFindFirst },
  },
  ensureDatabaseConnection: () => Promise.resolve(),
}));
mock.module('../../../config/logger', () => ({ createLogger: () => noopLogger }));

const recordTransition = mock(() => Promise.resolve());
mock.module('../../../services/workflow/transition-recorder', () => ({ recordTransition }));

mock.module('../../../services/workflow/completion-gate', () => ({
  researchConcludesNoChange: () => false,
}));
mock.module('../../../services/workflow/workflow-invariants', () => ({
  checkWorkflowInvariants: () => Promise.resolve([]),
}));

mock.module('./research-output-utils', () => ({
  isIsolatedWorktree: () => true,
  validateResearchReport: () => ({ ok: true, missingSections: [], reason: '' }),
  extractFinalAgentMessage: (s: string) => s,
  sliceResearchReport: (s: string) => (s.includes('# 調査レポート') ? s : null),
}));

// git diff / reset / clean — always "clean tree" so the revert path is a no-op.
mock.module('node:child_process', () => ({
  exec: (
    _cmd: string,
    _opts: unknown,
    cb: (err: Error | null, out: { stdout: string; stderr: string }) => void,
  ) => cb(null, { stdout: '', stderr: '' }),
}));

const mockCriticRejectedSince = mock(() => Promise.resolve(false));
mock.module('../../../services/workflow/phase-critic/critic-rejection-guard', () => ({
  criticRejectedSince: mockCriticRejectedSince,
}));

const mockWriteWorkflowFile = mock(() => Promise.resolve());
const mockResolveWorkflowDir = mock(() => Promise.resolve({ task: { id: 539 } }));
mock.module('../../../services/workflow/workflow-file-utils', () => ({
  writeWorkflowFile: mockWriteWorkflowFile,
  resolveWorkflowDir: mockResolveWorkflowDir,
}));
mock.module('../../../services/workflow/research-complexity', () => ({
  applyResearchAssessedComplexity: () => Promise.resolve(),
}));
mock.module('../../../services/memory/timeline', () => ({
  appendEvent: () => Promise.resolve(),
}));

const { handleResearchResult } = await import('./research-phase-handler');

const REPORT = '# 調査レポート\n\n## 前提監査\n本文';

function baseParams() {
  return {
    result: { success: true, output: REPORT },
    taskIdNum: 539,
    sessionId: 2088,
    executionDir: 'C:/tmp/worktree-539',
  };
}

describe('handleResearchResult — critic-rejection guard', () => {
  beforeEach(() => {
    mockSessionFindUnique.mockClear();
    mockSessionUpdate.mockClear();
    mockTaskUpdate.mockClear();
    mockTaskFindUnique.mockClear();
    mockExecUpdateMany.mockClear();
    mockWriteWorkflowFile.mockClear();
    mockCriticRejectedSince.mockReset().mockResolvedValue(false);
  });

  test('critic 差し戻し後は research.md を再保存せず、ワークフローも前進させない', async () => {
    mockCriticRejectedSince.mockResolvedValue(true);
    await handleResearchResult(baseParams());

    expect(mockWriteWorkflowFile).not.toHaveBeenCalled();
    // No status advance and no blocked-marking — the critic rollback owns it.
    expect(mockTaskUpdate).not.toHaveBeenCalled();
    // The session is still closed and the execution flipped off post_processing.
    expect(mockSessionUpdate).toHaveBeenCalledTimes(1);
    const sessionArg = (
      mockSessionUpdate.mock.calls[0] as unknown as [{ data: { status: string } }]
    )[0];
    expect(sessionArg.data.status).toBe('completed');
    expect(mockExecUpdateMany).toHaveBeenCalled();
  });

  test('差し戻しが無ければ保存してワークフローを前進させる', async () => {
    await handleResearchResult(baseParams());

    expect(mockCriticRejectedSince).toHaveBeenCalledWith(539, 'research', expect.any(Date));
    expect(mockWriteWorkflowFile).toHaveBeenCalledWith(539, 'research', REPORT);
    expect(mockTaskUpdate).toHaveBeenCalledWith({
      where: { id: 539 },
      data: { status: 'in-progress', workflowStatus: 'research_done' },
    });
  });

  test('セッション開始時刻は startedAt を優先して境界に使う', async () => {
    await handleResearchResult(baseParams());
    const since = (mockCriticRejectedSince.mock.calls[0] as unknown as [number, string, Date])[2];
    expect(since.toISOString()).toBe('2026-08-07T17:05:00.000Z');
  });
});
