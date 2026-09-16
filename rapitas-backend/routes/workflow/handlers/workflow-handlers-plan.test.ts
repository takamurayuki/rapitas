/**
 * workflow-handlers-plan.test
 *
 * Tests for handleUpdateStatus: file-existence pre-check, force flag, 422 responses,
 * and X-Rapitas-Source guard. Also covers handleApprovePlan's forbidden-change gate
 * (task 896): plain approval, 422 rejection, and override-granted approval.
 */
import { describe, expect, test, mock, beforeEach } from 'bun:test';

// ---- prisma mock ----
const mockFindUnique = mock(() => Promise.resolve(null));
const mockUpdate = mock(() => Promise.resolve({ id: 1, workflowStatus: 'draft' }));
const mockCreate = mock(() => Promise.resolve({}));
const mockPrisma = {
  task: {
    findUnique: mockFindUnique,
    update: mockUpdate,
    count: mock(() => Promise.resolve(0)),
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

// ---- resolveTaskWorkflowState mock (handleApprovePlan) ----
const mockResolveTaskWorkflowState = mock(() =>
  Promise.resolve({ id: 1, status: 'in-progress', workflowStatus: 'plan_created', parentId: null }),
);
mock.module('../../../services/task/task-resolver', () => ({
  resolveTaskWorkflowState: mockResolveTaskWorkflowState,
}));

// ---- readWorkflowFile mock (plan body used by the forbidden-change gate) ----
let planContentMock: string | null = null;
mock.module('../../../services/workflow/workflow-file-utils', () => ({
  readWorkflowFile: () => Promise.resolve(planContentMock),
}));

// ---- side-effect modules dynamically imported by handleApprovePlan ----
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
mock.module('../../../services/memory/decision-journal', () => ({
  recordPlanDecision: () => Promise.resolve(),
}));
mock.module('../../../services/system/prompt-language-store', () => ({
  readPromptLanguage: () => 'ja' as const,
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

import { handleUpdateStatus, handleApprovePlan } from './workflow-handlers-plan';

const UI_HEADERS = { 'x-rapitas-source': 'ui' };
const makeSet = () => ({ status: 200 as number });

beforeEach(() => {
  mockFindUnique.mockReset();
  mockUpdate.mockReset();
  mockCreate.mockReset();
  mockRecordTransition.mockReset();
  mockPreviewMissing.mockReset();
  mockUpdate.mockResolvedValue({ id: 1, workflowStatus: 'draft' });
  mockCreate.mockResolvedValue({});
  mockRecordTransition.mockResolvedValue(undefined);
  mockResolveTaskWorkflowState.mockReset();
  mockResolveTaskWorkflowState.mockResolvedValue({
    id: 1,
    status: 'in-progress',
    workflowStatus: 'plan_created',
    parentId: null,
  });
  mockPrisma.task.count.mockReset();
  mockPrisma.task.count.mockResolvedValue(0);
  planContentMock = null;
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
describe('handleApprovePlan — forbidden-change gate (task 896)', () => {
  test('通常承認: plan.mdに禁止パターンが無ければ従来通り承認される', async () => {
    planContentMock = '## 変更予定ファイル\n\n- `src/foo.ts`\n';
    mockFindUnique.mockResolvedValueOnce({ forbiddenChangeOverride: false, theme: null });
    const set = makeSet();
    const result = await handleApprovePlan({
      params: { taskId: '1' },
      body: { approved: true },
      set,
    });
    expect((result as { success: boolean }).success).toBe(true);
    expect((result as { workflowStatus: string }).workflowStatus).toBe('plan_approved');
    expect(set.status).toBe(200);
  });

  test('422拒否: 禁止スキーマ変更を宣言していて上書き指定が無ければ状態遷移させない', async () => {
    planContentMock = '## 変更予定ファイル\n\n- `rapitas-backend/prisma/schema/pause.prisma`\n';
    mockFindUnique.mockResolvedValueOnce({ forbiddenChangeOverride: false, theme: null });
    const set = makeSet();
    const result = await handleApprovePlan({
      params: { taskId: '1' },
      body: { approved: true },
      set,
    });
    expect(set.status).toBe(422);
    expect((result as { matchedFiles: string[] }).matchedFiles).toContain(
      'rapitas-backend/prisma/schema/pause.prisma',
    );
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test('上書き承認: overrideForbiddenChange+overrideReasonを指定すれば承認が成立する', async () => {
    planContentMock = '## 変更予定ファイル\n\n- `rapitas-backend/prisma/schema/pause.prisma`\n';
    mockFindUnique.mockResolvedValueOnce({ forbiddenChangeOverride: false, theme: null });
    const set = makeSet();
    const result = await handleApprovePlan({
      params: { taskId: '1' },
      body: {
        approved: true,
        overrideForbiddenChange: true,
        overrideReason: '緊急修正のため人間が明示承認',
      },
      set,
    });
    expect((result as { success: boolean }).success).toBe(true);
    expect((result as { workflowStatus: string }).workflowStatus).toBe('plan_approved');
    expect(set.status).toBe(200);
    expect(mockRecordTransition).toHaveBeenCalledWith(
      expect.objectContaining({ cause: 'manual_forbidden_change_override' }),
    );
  });
});
