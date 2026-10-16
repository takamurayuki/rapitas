/**
 * artifact-reuse-reconciler ユニットテスト
 *
 * research.md/plan.md が既に存在し再利用可能な品質の場合に、workflowStatus を
 * 適切なフェーズまでfast-forwardすることを検証する。verify.md には一切触れない
 * こと、常に前進のみ（後退しない）こと、承認ゲート(plan_created以降)を
 * バイパスしないことも確認する。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const noopLogger = {
  info: () => {},
  error: () => {},
  warn: () => {},
  debug: () => {},
  fatal: () => {},
};
mock.module('../../config/logger', () => ({
  createLogger: () => noopLogger,
  logger: noopLogger,
  getBackendLogFilePath: () => '/tmp/backend.log',
}));

const mockTaskUpdate = mock(() => Promise.resolve({}));
mock.module('../../config/database', () => ({
  prisma: { task: { update: mockTaskUpdate } },
}));

let resolvedDir: { dir: string } | null = { dir: '/fake/tasks/1' };
const mockResolveWorkflowDir = mock(() => Promise.resolve(resolvedDir));
let fileContents: Record<string, string | null> = {};
const mockReadWorkflowFile = mock((_dir: string, fileType: string) =>
  fileContents[fileType]
    ? Promise.resolve(fileContents[fileType])
    : Promise.reject(new Error('ENOENT')),
);
mock.module('./workflow-file-utils', () => ({
  resolveWorkflowDir: mockResolveWorkflowDir,
  deleteWorkflowDir: () => Promise.resolve(true),
  readWorkflowFile: mockReadWorkflowFile,
  writeWorkflowFile: () => Promise.resolve(),
  archiveWorkflowFile: () => Promise.resolve(false),
  cleanupRootWorkflowFiles: () => Promise.resolve(),
  looksLikeAgentLog: () => false,
  sliceFromReportHeading: (text: string) => text,
  extractMarkdownFromOutput: () => null,
}));

// Mirrors the convention used by workflow-handlers-files.test.ts: any
// non-trivial body counts as reusable here — the real validator's
// thresholds are covered by phase-output-validator.test.ts.
const mockIsReusableArtifact = mock((_ft: string, c: string) => !!c && c.trim().length >= 10);
mock.module('./phase-output-validator', () => ({
  looksLogPolluted: () => false,
  validateResearch: () => ({ ok: true }),
  validatePlan: () => ({ ok: true }),
  validateVerify: () => ({ ok: true }),
  isReusableArtifact: mockIsReusableArtifact,
}));

const mockRecordTransition = mock(() => Promise.resolve());
mock.module('./transition-recorder', () => ({
  recordTransition: mockRecordTransition,
}));

let pendingRevisionFixture: string | null = null;
mock.module('./workflow-plan-revision-context', () => ({
  getPendingPlanRevision: () => Promise.resolve(pendingRevisionFixture),
}));

const { reconcileStatusFromExistingArtifacts } = await import('./artifact-reuse-reconciler');

const REUSABLE_RESEARCH = '# 調査結果\n\n十分な内容の調査レポートです。要件を満たしています。';
const REUSABLE_PLAN = '# 実装計画\n\n十分な内容の計画書です。チェックリストを含みます。';
const THIN_CONTENT = '短い';

describe('reconcileStatusFromExistingArtifacts', () => {
  beforeEach(() => {
    pendingRevisionFixture = null;
    mockTaskUpdate.mockClear();
    mockRecordTransition.mockClear();
    mockResolveWorkflowDir.mockClear();
    mockReadWorkflowFile.mockClear();
    resolvedDir = { dir: '/fake/tasks/1' };
    fileContents = {};
  });

  test('leaves status unchanged when at draft with no research.md yet', async () => {
    const result = await reconcileStatusFromExistingArtifacts(1, 'draft', true);
    expect(result).toEqual({ status: 'draft', advanced: false });
    expect(mockTaskUpdate).not.toHaveBeenCalled();
  });

  test('advances draft -> research_done when research.md exists and is reusable (no plan.md)', async () => {
    fileContents.research = REUSABLE_RESEARCH;
    const result = await reconcileStatusFromExistingArtifacts(1, 'draft', true);
    expect(result).toEqual({ status: 'research_done', advanced: true });
    expect(mockTaskUpdate).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { workflowStatus: 'research_done', updatedAt: expect.any(Date) },
    });
    expect(mockRecordTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 1,
        fromStatus: 'draft',
        toStatus: 'research_done',
        cause: 'artifact_reuse_fastforward',
      }),
    );
  });

  test('advances draft -> plan_created in one hop when both research.md and plan.md are reusable', async () => {
    fileContents.research = REUSABLE_RESEARCH;
    fileContents.plan = REUSABLE_PLAN;
    const result = await reconcileStatusFromExistingArtifacts(1, 'draft', true);
    expect(result).toEqual({ status: 'plan_created', advanced: true });
    expect(mockTaskUpdate).toHaveBeenCalledTimes(1);
    expect(mockTaskUpdate).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { workflowStatus: 'plan_created', updatedAt: expect.any(Date) },
    });
  });

  test('does not advance to plan_created when the mode has no plan phase (lightweight)', async () => {
    fileContents.research = REUSABLE_RESEARCH;
    fileContents.plan = REUSABLE_PLAN;
    const result = await reconcileStatusFromExistingArtifacts(1, 'draft', false);
    expect(result).toEqual({ status: 'research_done', advanced: true });
  });

  test('stays at draft when research.md exists but is too thin to reuse', async () => {
    fileContents.research = THIN_CONTENT;
    const result = await reconcileStatusFromExistingArtifacts(1, 'draft', true);
    expect(result).toEqual({ status: 'draft', advanced: false });
    expect(mockTaskUpdate).not.toHaveBeenCalled();
  });

  test('advances research_done -> plan_created when plan.md exists and is reusable', async () => {
    fileContents.plan = REUSABLE_PLAN;
    const result = await reconcileStatusFromExistingArtifacts(1, 'research_done', true);
    expect(result).toEqual({ status: 'plan_created', advanced: true });
  });

  test('does not reuse plan.md while a plan revision is pending (task 755)', async () => {
    pendingRevisionFixture = '新規ファイル3件を計画に明記してください';
    fileContents.plan = REUSABLE_PLAN;
    const result = await reconcileStatusFromExistingArtifacts(1, 'research_done', true);
    expect(result).toEqual({ status: 'research_done', advanced: false });
  });

  test('leaves research_done unchanged when plan.md does not exist yet', async () => {
    const result = await reconcileStatusFromExistingArtifacts(1, 'research_done', true);
    expect(result).toEqual({ status: 'research_done', advanced: false });
    expect(mockTaskUpdate).not.toHaveBeenCalled();
  });

  test('never reads plan.md at research_done for a lightweight (no-plan-phase) task', async () => {
    fileContents.plan = REUSABLE_PLAN;
    const result = await reconcileStatusFromExistingArtifacts(1, 'research_done', false);
    expect(result).toEqual({ status: 'research_done', advanced: false });
    expect(mockReadWorkflowFile).not.toHaveBeenCalledWith(expect.anything(), 'plan');
  });

  test('is a no-op for statuses beyond draft/research_done (e.g. plan_approved, in_progress)', async () => {
    for (const status of [
      'plan_created',
      'plan_approved',
      'in_progress',
      'verify_done',
      'completed',
    ] as const) {
      const result = await reconcileStatusFromExistingArtifacts(1, status, true);
      expect(result).toEqual({ status, advanced: false });
    }
    expect(mockResolveWorkflowDir).not.toHaveBeenCalled();
  });

  test('never inspects or reasons about verify.md', async () => {
    fileContents.research = REUSABLE_RESEARCH;
    fileContents.plan = REUSABLE_PLAN;
    fileContents.verify = 'should never be read by this reconciler';
    await reconcileStatusFromExistingArtifacts(1, 'draft', true);
    expect(mockReadWorkflowFile).not.toHaveBeenCalledWith(expect.anything(), 'verify');
  });

  test('returns the current status unchanged when the workflow directory cannot be resolved', async () => {
    resolvedDir = null;
    fileContents.research = REUSABLE_RESEARCH;
    const result = await reconcileStatusFromExistingArtifacts(1, 'draft', true);
    expect(result).toEqual({ status: 'draft', advanced: false });
    expect(mockTaskUpdate).not.toHaveBeenCalled();
  });
});
