/**
 * workflow-handlers-plan — approve-plan saves the plan-deviation audit
 * (task 1218 AC4): counts / kinds / reviewer comment are recorded, a missing
 * comment keeps the legacy response, and an audit failure never blocks approval.
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

// ---- deviation audit mock ----
type AuditInput = { taskId: number; decision: string; comment?: string | null; source: string };
const mockRecordAudit = mock(
  async (
    _input: AuditInput,
  ): Promise<
    { saved: true; record: Record<string, unknown> } | { saved: false; error: string }
  > => ({
    saved: true,
    record: { taskId: 1 },
  }),
);
mock.module('../deviation/deviation-handlers', () => ({
  recordApprovalDeviationAudit: mockRecordAudit,
}));

import { handleApprovePlan } from './workflow-handlers-plan';

const UI_HEADERS = { 'x-rapitas-source': 'ui' };
const makeSet = () => ({ status: 200 as number });

beforeEach(() => {
  mockFindUnique.mockReset();
  mockUpdate.mockReset();
  mockRecordAudit.mockReset();
  mockFindUnique.mockResolvedValue({ id: 1, workflowStatus: 'plan_created' });
  mockUpdate.mockResolvedValue({ id: 1, workflowStatus: 'plan_approved', title: 't', themeId: 1 });
  mockCreate.mockResolvedValue({});
  mockCount.mockResolvedValue(0);
  mockRecordAudit.mockImplementation(async () => ({ saved: true, record: { taskId: 1 } }));
  planContentForApproval = 'no schema paths here';
});

describe('handleApprovePlan — deviation audit', () => {
  test('records the decision, comment and caller source', async () => {
    const result = await handleApprovePlan({
      params: { taskId: '1' },
      body: { approved: true, comment: '計画外の rm は許容' },
      headers: UI_HEADERS,
      set: makeSet(),
    });
    expect(mockRecordAudit).toHaveBeenCalledTimes(1);
    expect(mockRecordAudit.mock.calls[0][0]).toEqual({
      taskId: 1,
      decision: 'approved',
      comment: '計画外の rm は許容',
      source: 'ui',
    });
    expect(result).toMatchObject({
      success: true,
      workflowStatus: 'plan_approved',
      deviationAudit: { saved: true },
    });
  });

  test('without a comment the legacy fields are unchanged', async () => {
    const result = await handleApprovePlan({
      params: { taskId: '1' },
      body: { approved: true },
      headers: UI_HEADERS,
      set: makeSet(),
    });
    expect(result).toMatchObject({
      success: true,
      workflowStatus: 'plan_approved',
      autoAdvance: true,
    });
    expect(mockRecordAudit.mock.calls[0][0].comment).toBeNull();
  });

  test('an audit failure still approves and reports saved:false', async () => {
    mockRecordAudit.mockImplementation(async () => ({ saved: false, error: 'EROFS' }));
    const result = await handleApprovePlan({
      params: { taskId: '1' },
      body: { approved: true },
      headers: UI_HEADERS,
      set: makeSet(),
    });
    expect(result).toMatchObject({
      success: true,
      workflowStatus: 'plan_approved',
      deviationAudit: { saved: false, error: 'EROFS' },
    });
  });

  test('a rejection is recorded with decision rejected', async () => {
    mockUpdate.mockResolvedValue({ id: 1, workflowStatus: 'plan_created', title: 't', themeId: 1 });
    await handleApprovePlan({
      params: { taskId: '1' },
      body: { approved: false, comment: 'scope too wide' },
      headers: UI_HEADERS,
      set: makeSet(),
    });
    expect(mockRecordAudit.mock.calls[0][0]).toMatchObject({
      decision: 'rejected',
      comment: 'scope too wide',
    });
  });
});
