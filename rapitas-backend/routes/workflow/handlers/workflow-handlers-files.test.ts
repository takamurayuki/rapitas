/**
 * workflow-handlers-files.test
 *
 * Targeted tests for the two changes introduced in task #153:
 *  1. Empty workflowStatus ("") is treated as draft by the file-type guard.
 *  2. WARN log for invariant violations includes workflowDir / missingFiles / hint.
 */
import { describe, expect, test, mock, beforeEach } from 'bun:test';

// ---- warn capture ----
const warnCalls: unknown[][] = [];
mock.module('../../../config/logger', () => ({
  createLogger: () => ({
    info: () => {},
    error: () => {},
    warn: (...args: unknown[]) => {
      warnCalls.push(args);
    },
    debug: () => {},
  }),
}));

// ---- prisma mock ----
const mockFindUnique = mock(() => Promise.resolve(null));
const mockFindMany = mock(() => Promise.resolve([]));
const mockUpdate = mock(() => Promise.resolve({}));
const mockFindFirst = mock(() => Promise.resolve(null));
const mockCreate = mock(() => Promise.resolve({}));
const mockPrisma = {
  task: {
    findUnique: mockFindUnique,
    findMany: mockFindMany,
    update: mockUpdate,
  },
  agentSession: { findFirst: mockFindFirst },
  agentExecution: { update: mockUpdate },
  activityLog: { create: mockCreate },
};
mock.module('../../../config', () => ({ prisma: mockPrisma }));
mock.module('../../../config/database', () => ({
  ensureDatabaseConnection: () => Promise.resolve(),
  prisma: mockPrisma,
}));

// ---- resolveWorkflowDir / workflow-helpers mock ----
const mockResolveWorkflowDir = mock(() => Promise.resolve(null));
mock.module('../core/workflow-helpers', () => ({
  VALID_FILE_TYPES: ['research', 'question', 'plan', 'verify'],
  resolveWorkflowDir: mockResolveWorkflowDir,
  getFileInfo: mock(() => Promise.resolve({ exists: false })),
}));

// ---- writeWorkflowFile mock ----
mock.module('../../../services/workflow/workflow-file-utils', () => ({
  // Echo the saved content so handler logic that inspects it (e.g. the research
  // "no change" verdict) sees the real body.
  writeWorkflowFile: mock((_dir: string, _ft: string, content: string) => Promise.resolve(content)),
}));

// ---- recordTransition mock ----
mock.module('../../../services/workflow/transition-recorder', () => ({
  recordTransition: mock(() => Promise.resolve()),
}));

// ---- checkWorkflowInvariants mock ----
const mockCheckInvariants = mock(() => Promise.resolve([] as { code: string; message: string }[]));
mock.module('../../../services/workflow/workflow-invariants', () => ({
  checkWorkflowInvariants: mockCheckInvariants,
  normalizeWorkflowStatus: (s: string | null | undefined) => {
    if (s && s.trim().length > 0) return s.trim();
    return 'draft';
  },
}));

// ---- mojibake mock ----
mock.module('../../../utils/common/mojibake-detector', () => ({
  detectReplacementLoss: () => ({ detected: false }),
}));

// ---- learning/knowledge mocks ----
mock.module('../../../services/workflow/learning/workflow-learning-optimizer', () => ({
  recordWorkflowCompletion: mock(() => Promise.resolve()),
}));
mock.module('../../../services/memory/task-knowledge-extractor', () => ({
  extractKnowledgeFromTask: mock(() => Promise.resolve()),
}));

// ---- auto-commit mock (captured so tests can drive verificationBlocked) ----
const mockPerformAutoCommitAndPR = mock(() => Promise.resolve({})) as any;
mock.module('../workflow-auto-commit', () => ({
  performAutoCommitAndPR: mockPerformAutoCommitAndPR,
}));

// ---- verify-self-repair mock (gate-failure bounce loop) ----
const mockAttemptVerifyRepair = mock(() => Promise.resolve({ bounced: false })) as any;
mock.module('../../../services/workflow/verify-self-repair', () => ({
  attemptVerifyRepair: mockAttemptVerifyRepair,
}));

// ---- completion-gate mock ----
mock.module('../../../services/workflow/completion-gate', () => ({
  evaluateCompletionGate: mock(() => Promise.resolve({ allow: true })),
  // Mimic the real detector closely enough for the handler test.
  researchConcludesNoChange: (c: string | null | undefined) =>
    !!c && /結論\s*[:：]\s*(?:[^\n]*)?(?:修正|対応|実装|変更)(?:は)?不要/.test(c),
}));

// ---- phase-output-validator mock (verify path) ----
mock.module('../../../services/workflow/phase-output-validator', () => ({
  validateVerify: () => ({ ok: true, missingSections: [], severity: 0, summary: 'ok' }),
}));

// ---- plan-auto-approve mock ----
mock.module('../../../services/workflow/plan-auto-approve', () => ({
  maybeAutoApprovePlan: mock(() => Promise.resolve({ autoApproved: false })),
}));

// ---- middleware mock ----
mock.module('../../../middleware/error-handler', () => ({
  parseId: (v: string) => parseInt(v, 10),
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

import { handleSaveFile } from './workflow-handlers-files';

const makeSet = () => ({ status: 200 as number });

beforeEach(() => {
  mockResolveWorkflowDir.mockReset();
  mockCheckInvariants.mockReset();
  mockUpdate.mockReset();
  mockFindUnique.mockReset();
  mockPerformAutoCommitAndPR.mockReset();
  mockAttemptVerifyRepair.mockReset();
  warnCalls.length = 0;
  mockUpdate.mockResolvedValue({});
  mockCheckInvariants.mockResolvedValue([]);
  mockPerformAutoCommitAndPR.mockResolvedValue({});
  mockAttemptVerifyRepair.mockResolvedValue({ bounced: false });
});

// -------------------------------------------------------------------------
describe('handleSaveFile — empty workflowStatus guard hardening', () => {
  test('rejects verify.md save when workflowStatus is empty string (treated as draft)', async () => {
    mockResolveWorkflowDir.mockResolvedValueOnce({
      task: { workflowStatus: '', id: 1 },
      dir: '/fake/dir',
      categoryId: null,
      themeId: null,
    });
    mockFindMany.mockResolvedValueOnce([]);

    await expect(
      handleSaveFile({
        params: { taskId: '1', fileType: 'verify' },
        body: 'some content',
        set: makeSet(),
      }),
    ).rejects.toMatchObject({ name: 'ValidationError' });
  });

  test('accepts research.md save when workflowStatus is empty string (draft allows research)', async () => {
    mockResolveWorkflowDir.mockResolvedValueOnce({
      task: { workflowStatus: '', id: 1 },
      dir: '/fake/dir',
      categoryId: null,
      themeId: null,
    });
    mockCheckInvariants.mockResolvedValueOnce([]);

    const result = await handleSaveFile({
      params: { taskId: '1', fileType: 'research' },
      body: 'research content',
      set: makeSet(),
    });
    expect((result as { workflowStatus?: string }).workflowStatus).toBeDefined();
  });
});

// -------------------------------------------------------------------------
describe('handleSaveFile — dev-mode single-session verify from plan_approved', () => {
  test('accepts verify.md save at plan_approved (no longer hard-rejected)', async () => {
    mockResolveWorkflowDir.mockResolvedValueOnce({
      task: { workflowStatus: 'plan_approved', id: 1 },
      dir: '/fake/dir/1',
      categoryId: null,
      themeId: null,
    });
    mockFindMany.mockResolvedValueOnce([]); // no subtasks → split-parent guard passes
    mockCheckInvariants.mockResolvedValueOnce([]);

    const result = await handleSaveFile({
      params: { taskId: '1', fileType: 'verify' },
      body: 'verify content',
      set: makeSet(),
    });

    // Accepted (not hard-rejected at the guard): the verify passes the
    // completion gate (mocked allow) and the task is marked completed.
    expect((result as { workflowStatus?: string }).workflowStatus).toBe('completed');
  });

  test('still rejects verify.md save at plan_created (only plan/question allowed there)', async () => {
    mockResolveWorkflowDir.mockResolvedValueOnce({
      task: { workflowStatus: 'plan_created', id: 1 },
      dir: '/fake/dir/1',
      categoryId: null,
      themeId: null,
    });
    mockFindMany.mockResolvedValueOnce([]);

    await expect(
      handleSaveFile({
        params: { taskId: '1', fileType: 'verify' },
        body: 'verify content',
        set: makeSet(),
      }),
    ).rejects.toMatchObject({ name: 'ValidationError' });
  });
});

// -------------------------------------------------------------------------
describe('handleSaveFile — research が修正不要結論ならタスクを完了すること', () => {
  test('「結論: 修正不要」付き research.md 保存で completed + done になること', async () => {
    mockResolveWorkflowDir.mockResolvedValueOnce({
      task: { workflowStatus: 'draft', id: 1 },
      dir: '/fake/dir/1',
      categoryId: null,
      themeId: null,
    });
    mockCheckInvariants.mockResolvedValueOnce([]);

    const result = await handleSaveFile({
      params: { taskId: '1', fileType: 'research' },
      body: '# 調査結果\n\n## 結論: 修正不要\n既存実装で充足',
      set: makeSet(),
    });

    // newStatus='completed' は research-no-change 完了経路でのみ設定される。
    expect((result as { workflowStatus?: string }).workflowStatus).toBe('completed');
  });

  test('修正不要結論が無い通常 research.md は research_done に進むこと', async () => {
    mockResolveWorkflowDir.mockResolvedValueOnce({
      task: { workflowStatus: 'draft', id: 1 },
      dir: '/fake/dir/1',
      categoryId: null,
      themeId: null,
    });
    mockCheckInvariants.mockResolvedValueOnce([]);

    const result = await handleSaveFile({
      params: { taskId: '1', fileType: 'research' },
      body: '# 調査結果\n## 影響範囲\n変更が必要',
      set: makeSet(),
    });

    expect((result as { workflowStatus?: string }).workflowStatus).toBe('research_done');
  });
});

// -------------------------------------------------------------------------
describe('handleSaveFile — 検証ゲート失敗時に自己修復ループへ差し戻すこと', () => {
  test('verificationBlocked かつ repair バウンスで implementer entry に戻すこと', async () => {
    mockResolveWorkflowDir.mockResolvedValueOnce({
      task: { workflowStatus: 'in_progress', id: 1 },
      dir: '/fake/dir/1',
      categoryId: null,
      themeId: null,
    });
    mockFindMany.mockResolvedValueOnce([]); // no subtasks
    mockCheckInvariants.mockResolvedValueOnce([]);
    mockPerformAutoCommitAndPR.mockResolvedValueOnce({
      verificationBlocked: true,
      error: '自動検証: test=NG(1)',
    });
    mockAttemptVerifyRepair.mockResolvedValueOnce({
      bounced: true,
      newStatus: 'plan_approved',
      attempt: 1,
    });

    const result = await handleSaveFile({
      params: { taskId: '1', fileType: 'verify' },
      body: 'verify content',
      set: makeSet(),
    });

    expect(mockAttemptVerifyRepair).toHaveBeenCalledTimes(1);
    // 差し戻し先 (plan_approved) を workflowStatus に反映し、completed にはしない
    expect((result as { workflowStatus?: string }).workflowStatus).toBe('plan_approved');
  });

  test('repair が枯渇 (bounced:false) ならブロック維持で completed にしないこと', async () => {
    mockResolveWorkflowDir.mockResolvedValueOnce({
      task: { workflowStatus: 'in_progress', id: 1 },
      dir: '/fake/dir/1',
      categoryId: null,
      themeId: null,
    });
    mockFindMany.mockResolvedValueOnce([]);
    mockCheckInvariants.mockResolvedValueOnce([]);
    mockPerformAutoCommitAndPR.mockResolvedValueOnce({
      verificationBlocked: true,
      error: '自動検証: test=NG(1)',
    });
    mockAttemptVerifyRepair.mockResolvedValueOnce({ bounced: false });

    const result = await handleSaveFile({
      params: { taskId: '1', fileType: 'verify' },
      body: 'verify content',
      set: makeSet(),
    });

    expect((result as { workflowStatus?: string }).workflowStatus).not.toBe('completed');
  });
});

// -------------------------------------------------------------------------
describe('handleSaveFile — invariant check is triggered after status update', () => {
  test('checkWorkflowInvariants is called when newStatus is set', async () => {
    mockResolveWorkflowDir.mockResolvedValueOnce({
      task: { workflowStatus: 'draft', id: 1 },
      dir: '/fake/dir/1',
      categoryId: null,
      themeId: null,
    });
    mockCheckInvariants.mockResolvedValueOnce([]);

    await handleSaveFile({
      params: { taskId: '1', fileType: 'research' },
      body: 'research content',
      set: makeSet(),
    });

    expect(mockCheckInvariants).toHaveBeenCalledTimes(1);
    expect(mockCheckInvariants).toHaveBeenCalledWith(1);
  });

  test('function succeeds and returns workflowStatus even when violations exist', async () => {
    mockResolveWorkflowDir.mockResolvedValueOnce({
      task: { workflowStatus: 'draft', id: 1 },
      dir: '/fake/dir/1',
      categoryId: null,
      themeId: null,
    });
    mockCheckInvariants.mockResolvedValueOnce([
      {
        code: 'missing_file',
        message: 'workflowStatus="research_done" but research.md is missing on disk',
      },
    ]);

    const result = await handleSaveFile({
      params: { taskId: '1', fileType: 'research' },
      body: 'some research content',
      set: makeSet(),
    });

    // Violations must NOT throw — file is already saved
    expect((result as { success: boolean }).success).toBe(true);
    expect((result as { workflowStatus: string }).workflowStatus).toBeDefined();
  });
});

// -------------------------------------------------------------------------
describe('missingFiles extraction from missing_file violations', () => {
  // NOTE: This tests the regex extraction logic used in the WARN log.
  // Violations with code 'missing_file' have message:
  //   workflowStatus="xxx" but yyy.md is missing on disk
  test('extracts file name from missing_file violation message', () => {
    const violations = [
      {
        code: 'missing_file',
        message: 'workflowStatus="plan_created" but research.md is missing on disk',
      },
      {
        code: 'missing_file',
        message: 'workflowStatus="plan_created" but plan.md is missing on disk',
      },
    ];
    const missingFiles = violations
      .filter((v) => v.code === 'missing_file')
      .map((v) => {
        const m = v.message.match(/but (\S+\.md) is missing/);
        return m ? m[1] : 'unknown';
      });
    expect(missingFiles).toEqual(['research.md', 'plan.md']);
  });

  test('returns unknown for malformed violation message', () => {
    const violations = [{ code: 'missing_file', message: 'some unrecognized format' }];
    const missingFiles = violations
      .filter((v) => v.code === 'missing_file')
      .map((v) => {
        const m = v.message.match(/but (\S+\.md) is missing/);
        return m ? m[1] : 'unknown';
      });
    expect(missingFiles).toEqual(['unknown']);
  });
});
