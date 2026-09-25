/**
 * workflow-handlers-plan.test
 *
 * Tests for handleUpdateStatus: file-existence pre-check, force flag, 422 responses,
 * and X-Rapitas-Source guard. Also covers handleApprovePlan's X-Rapitas-Source guard
 * and forbiddenChangeOverride requirement for plans that declare a Prisma schema
 * change (task 1059).
 */
import { describe, expect, test, mock, beforeEach } from 'bun:test';

// ---- prisma mock ----
const mockFindUnique = mock(() => Promise.resolve(null));
const mockUpdate = mock(() => Promise.resolve({ id: 1, workflowStatus: 'draft' }));
const mockCreate = mock(() => Promise.resolve({}));
const mockCount = mock(() => Promise.resolve(0));
const mockPrisma = {
  task: {
    findUnique: mockFindUnique,
    update: mockUpdate,
    count: mockCount,
  },
  activityLog: { create: mockCreate },
};
mock.module('../../../config', () => ({ prisma: mockPrisma }));
mock.module('../../../config/database', () => ({
  ensureDatabaseConnection: () => Promise.resolve(),
  prisma: mockPrisma,
}));
mock.module('../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, error: () => {}, warn: () => {}, debug: () => {} }),
}));

// ---- recordTransition mock ----
const mockRecordTransition = mock(() => Promise.resolve());
mock.module('../../../services/workflow/transition-recorder', () => ({
  recordTransition: mockRecordTransition,
}));

// ---- previewMissingFilesForStatus mock ----
const mockPreviewMissing = mock(() => Promise.resolve([] as string[]));
mock.module('../../../services/workflow/workflow-invariants', () => ({
  previewMissingFilesForStatus: mockPreviewMissing,
}));

// ---- middleware mock ----
mock.module('../../../middleware/error-handler', () => ({
  parseId: (_v: string, _label: string) => 1,
  ValidationError: class ValidationError extends Error {
    constructor(msg: string) {
      super(msg);
      this.name = 'ValidationError';
    }
  },
  NotFoundError: class NotFoundError extends Error {
    constructor(msg: string) {
      super(msg);
      this.name = 'NotFoundError';
    }
  },
}));

// ---- workflow-helpers mock ----
mock.module('../core/workflow-helpers', () => ({
  VALID_WORKFLOW_STATUSES: [
    'draft',
    'research_done',
    'plan_created',
    'plan_approved',
    'in_progress',
    'awaiting_question',
    'verify_done',
    'completed',
  ] as const,
}));

// ---- readWorkflowFile mock (handleApprovePlan's schema-declaration check) ----
let planContentForApproval: string | null = 'no schema paths here';
mock.module('../../../services/workflow/workflow-file-utils', () => ({
  readWorkflowFile: () => Promise.resolve(planContentForApproval),
}));

// ---- fire-and-forget side-effect modules dynamically imported on approval ----
mock.module('../../../services/memory/decision-journal', () => ({
  recordPlanDecision: () => Promise.resolve(),
}));
mock.module('../../../services/workflow/auto-run/theme-auto-run-scheduler', () => ({
  ThemeAutoRunScheduler: { getInstance: () => ({ onPlanApproved: () => Promise.resolve() }) },
}));
mock.module('../../../services/workflow/ai-orchestra', () => ({
  AIOrchestra: {
    getInstance: () => ({
      enqueueSubtasksForExecution: () => Promise.resolve(),
      handlePlanApproved: () => Promise.resolve(),
    }),
  },
}));
mock.module('../../../services/workflow/workflow-orchestrator', () => ({
  WorkflowOrchestrator: {
    getInstance: () => ({ advanceWorkflow: () => Promise.resolve({ success: true }) }),
  },
}));
mock.module('../../../services/system/prompt-language-store', () => ({
  readPromptLanguage: () => 'ja',
}));

import { handleUpdateStatus, handleApprovePlan } from './workflow-handlers-plan';

const UI_HEADERS = { 'x-rapitas-source': 'ui' };
const makeSet = () => ({ status: 200 as number });

beforeEach(() => {
  mockFindUnique.mockReset();
  mockUpdate.mockReset();
  mockCreate.mockReset();
  mockCount.mockReset();
  mockRecordTransition.mockReset();
  mockPreviewMissing.mockReset();
  mockUpdate.mockResolvedValue({ id: 1, workflowStatus: 'draft' });
  mockCreate.mockResolvedValue({});
  mockCount.mockResolvedValue(0);
  mockRecordTransition.mockResolvedValue(undefined);
  planContentForApproval = 'no schema paths here';
});

// -------------------------------------------------------------------------
describe('handleUpdateStatus — X-Rapitas-Source guard', () => {
  test('rejects request without X-Rapitas-Source header', async () => {
    mockFindUnique.mockResolvedValueOnce({ id: 1, workflowStatus: 'draft' });
    await expect(
      handleUpdateStatus({
        params: { taskId: '1' },
        body: { status: 'research_done' },
        headers: {},
        set: makeSet(),
      }),
    ).rejects.toMatchObject({ name: 'ValidationError' });
  });

  test('rejects request with wrong X-Rapitas-Source value', async () => {
    mockFindUnique.mockResolvedValueOnce({ id: 1, workflowStatus: 'draft' });
    await expect(
      handleUpdateStatus({
        params: { taskId: '1' },
        body: { status: 'research_done' },
        headers: { 'x-rapitas-source': 'agent' },
        set: makeSet(),
      }),
    ).rejects.toMatchObject({ name: 'ValidationError' });
  });
});

// -------------------------------------------------------------------------
describe('handleUpdateStatus — file existence pre-check', () => {
  test('applies status when all required files exist', async () => {
    mockFindUnique.mockResolvedValueOnce({ id: 1, workflowStatus: 'draft' });
    mockPreviewMissing.mockResolvedValueOnce([]);
    const set = makeSet();
    const result = await handleUpdateStatus({
      params: { taskId: '1' },
      body: { status: 'research_done' },
      headers: UI_HEADERS,
      set,
    });
    expect((result as { success: boolean }).success).toBe(true);
    expect(set.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  test('returns 422 when required files are missing and force is not set', async () => {
    mockFindUnique.mockResolvedValueOnce({ id: 1, workflowStatus: 'draft' });
    mockPreviewMissing.mockResolvedValueOnce(['research.md']);
    const set = makeSet();
    const result = await handleUpdateStatus({
      params: { taskId: '1' },
      body: { status: 'research_done' },
      headers: UI_HEADERS,
      set,
    });
    expect(set.status).toBe(422);
    expect((result as { missingFiles: string[] }).missingFiles).toContain('research.md');
    // DB update must NOT be called on 422 rejection
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test('applies status with force=true when files are missing', async () => {
    mockFindUnique.mockResolvedValueOnce({ id: 1, workflowStatus: 'draft' });
    mockPreviewMissing.mockResolvedValueOnce(['research.md']);
    const set = makeSet();
    const result = await handleUpdateStatus({
      params: { taskId: '1' },
      body: { status: 'research_done', force: true },
      headers: UI_HEADERS,
      set,
    });
    expect((result as { success: boolean }).success).toBe(true);
    expect(set.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    // Should record invariant violation
    expect(mockRecordTransition).toHaveBeenCalledWith(
      expect.objectContaining({ invariantViolation: true }),
    );
  });

  test('allows reset to draft even when no files are present', async () => {
    mockFindUnique.mockResolvedValueOnce({ id: 1, workflowStatus: 'plan_created' });
    // draft requires no files → previewMissingFilesForStatus returns []
    mockPreviewMissing.mockResolvedValueOnce([]);
    const set = makeSet();
    const result = await handleUpdateStatus({
      params: { taskId: '1' },
      body: { status: 'draft' },
      headers: UI_HEADERS,
      set,
    });
    expect((result as { success: boolean }).success).toBe(true);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  test('records transition without invariantViolation flag when files are present', async () => {
    mockFindUnique.mockResolvedValueOnce({ id: 1, workflowStatus: 'draft' });
    mockPreviewMissing.mockResolvedValueOnce([]);
    await handleUpdateStatus({
      params: { taskId: '1' },
      body: { status: 'research_done' },
      headers: UI_HEADERS,
      set: makeSet(),
    });
    expect(mockRecordTransition).toHaveBeenCalledTimes(1);
    const call = mockRecordTransition.mock.calls[0][0] as Record<string, unknown>;
    expect(call.invariantViolation).toBeUndefined();
  });
});

// -------------------------------------------------------------------------
describe('handleApprovePlan — X-Rapitas-Source guard', () => {
  test('rejects request without X-Rapitas-Source header and records plan_approval_blocked', async () => {
    await expect(
      handleApprovePlan({
        params: { taskId: '1' },
        body: { approved: true },
        headers: {},
        set: makeSet(),
      }),
    ).rejects.toMatchObject({ name: 'ValidationError' });
    expect(mockRecordTransition).toHaveBeenCalledWith(
      expect.objectContaining({ cause: 'plan_approval_blocked', invariantViolation: true }),
    );
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test('rejects request with a source value not in ui|operator', async () => {
    await expect(
      handleApprovePlan({
        params: { taskId: '1' },
        body: { approved: true },
        headers: { 'x-rapitas-source': 'agent' },
        set: makeSet(),
      }),
    ).rejects.toMatchObject({ name: 'ValidationError' });
  });
});

// -------------------------------------------------------------------------
describe('handleApprovePlan — forbiddenChangeOverride (task 1059)', () => {
  test('883回帰: スキーマ変更を宣言したplanは overrideForbiddenChange 無しの承認を拒否する', async () => {
    mockFindUnique.mockResolvedValueOnce({ id: 1, workflowStatus: 'plan_created' });
    planContentForApproval = '対象ファイル: `rapitas-backend/prisma/schema/pause.prisma`';
    await expect(
      handleApprovePlan({
        params: { taskId: '1' },
        body: { approved: true },
        headers: UI_HEADERS,
        set: makeSet(),
      }),
    ).rejects.toMatchObject({ name: 'ValidationError' });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test('overrideForbiddenChange:true + overrideReason 付きで承認が成功し forbiddenChangeOverride が更新される', async () => {
    mockFindUnique.mockResolvedValueOnce({ id: 1, workflowStatus: 'plan_created' });
    planContentForApproval = '対象ファイル: `rapitas-backend/prisma/schema/pause.prisma`';
    const result = await handleApprovePlan({
      params: { taskId: '1' },
      body: {
        approved: true,
        overrideForbiddenChange: true,
        overrideReason: '人間が明示的に許可した',
      },
      headers: UI_HEADERS,
      set: makeSet(),
    });
    expect((result as { success: boolean }).success).toBe(true);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          forbiddenChangeOverride: true,
          forbiddenChangeOverrideReason: '人間が明示的に許可した',
        }),
      }),
    );
    expect(mockRecordTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        cause: 'manual_plan_approved',
        metadata: expect.objectContaining({ overrideForbiddenChange: true }),
      }),
    );
  });

  test('overrideReason が空文字の場合は拒否する', async () => {
    mockFindUnique.mockResolvedValueOnce({ id: 1, workflowStatus: 'plan_created' });
    planContentForApproval = '対象ファイル: `rapitas-backend/prisma/schema/pause.prisma`';
    await expect(
      handleApprovePlan({
        params: { taskId: '1' },
        body: { approved: true, overrideForbiddenChange: true, overrideReason: '  ' },
        headers: UI_HEADERS,
        set: makeSet(),
      }),
    ).rejects.toMatchObject({ name: 'ValidationError' });
  });

  test('回帰確認: スキーマ変更を含まないplanは override 無しで従来通り承認できる', async () => {
    mockFindUnique.mockResolvedValueOnce({ id: 1, workflowStatus: 'plan_created' });
    planContentForApproval = '対象ファイル: `src/foo.ts`';
    const result = await handleApprovePlan({
      params: { taskId: '1' },
      body: { approved: true },
      headers: UI_HEADERS,
      set: makeSet(),
    });
    expect((result as { success: boolean }).success).toBe(true);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({ forbiddenChangeOverride: true }),
      }),
    );
  });

  test('却下(approved:false)の場合は override 判定をスキップし従来通り却下できる', async () => {
    mockFindUnique.mockResolvedValueOnce({ id: 1, workflowStatus: 'plan_created' });
    planContentForApproval = '対象ファイル: `rapitas-backend/prisma/schema/pause.prisma`';
    const result = await handleApprovePlan({
      params: { taskId: '1' },
      body: { approved: false, reason: 'やり直し' },
      headers: UI_HEADERS,
      set: makeSet(),
    });
    expect((result as { success: boolean }).success).toBe(true);
    expect(mockRecordTransition).toHaveBeenCalledWith(
      expect.objectContaining({ cause: 'manual_plan_rejected' }),
    );
  });
});
