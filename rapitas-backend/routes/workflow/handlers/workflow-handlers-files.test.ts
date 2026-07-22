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
const mockUpdateMany = mock(() => Promise.resolve({ count: 1 }));
const mockFindFirst = mock(() => Promise.resolve(null));
const mockCreate = mock(() => Promise.resolve({}));
const mockPrisma = {
  task: {
    findUnique: mockFindUnique,
    findMany: mockFindMany,
    update: mockUpdate,
    updateMany: mockUpdateMany,
  },
  agentSession: { findFirst: mockFindFirst },
  agentExecution: { update: mockUpdate },
  activityLog: { create: mockCreate },
  // Used by the verify→complete PR gate to detect an already-existing PR.
  gitHubPullRequest: { findFirst: mock(() => Promise.resolve(null)) },
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
// Existing research.md content served to the re-run fast-forward check.
// Tests set this to simulate a prior run's artifact on disk.
let existingResearchContent: string | null = null;
mock.module('../../../services/workflow/workflow-file-utils', () => ({
  // Echo the saved content so handler logic that inspects it (e.g. the research
  // "no change" verdict) sees the real body.
  writeWorkflowFile: mock((_dir: string, _ft: string, content: string) => Promise.resolve(content)),
  readWorkflowFile: mock((_dir: string, ft: string) =>
    Promise.resolve(ft === 'research' ? existingResearchContent : null),
  ),
  // Identity passthrough — the handler strips conversational preamble via this;
  // these tests pass already-clean bodies, so returning content as-is is faithful.
  sliceFromReportHeading: (content: string) => content,
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

// ---- phase-critic mock (research/plan critic gate) ----
const mockApplyPhaseCriticGate = mock(() => Promise.resolve({ bounced: false })) as any;
mock.module('../../../services/workflow/phase-critic', () => ({
  applyPhaseCriticGate: mockApplyPhaseCriticGate,
}));

// ---- adversarial-diff-review mock ----
const mockReviewDiffAdversarially = mock(() => Promise.resolve(null)) as any;
mock.module('../../../services/agents/verification/adversarial-diff-review', () => ({
  reviewDiffAdversarially: mockReviewDiffAdversarially,
}));

// ---- completion-gate mock ----
mock.module('../../../services/workflow/completion-gate', () => ({
  evaluateCompletionGate: mock(() => Promise.resolve({ allow: true })),
  // Mimic the real detector closely enough for the handler test.
  researchConcludesNoChange: (c: string | null | undefined) =>
    !!c && /結論\s*[:：]\s*(?:[^\n]*)?(?:修正|対応|実装|変更)(?:は)?不要/.test(c),
}));

// ---- phase-output-validator mock (verify path + pollution guard) ----
mock.module('../../../services/workflow/phase-output-validator', () => ({
  validateVerify: () => ({ ok: true, missingSections: [], severity: 0, summary: 'ok' }),
  // Fast-forward reuse check: any non-trivial body counts as reusable here;
  // the real validator's thresholds are covered by phase-output-reuse.test.ts.
  isReusableArtifact: (_ft: string, c: string) => !!c && c.trim().length >= 10,
  // Faithful-enough mirror of the real detector for the handler's reject guard.
  looksLogPolluted: (c: string | null | undefined) => {
    if (!c) return false;
    if (
      /\[System:\s*(?:init|thinking_tokens)\]|\[Claude Code\]\s*(?:Starting|Working|Process)|^\s*\[Result:\s*\w+|^\s*\{"type":\s*"|^\s*data:\s*\{/im.test(
        c,
      )
    )
      return true;
    const ne = c.split(/\r?\n/).filter((l) => l.trim());
    const noisy = ne.filter((l) =>
      /^\s*\[(Tool|Tool Done|Tool Error|Command|エージェント|実行開始)/i.test(l),
    ).length;
    return noisy >= 6 || (ne.length > 0 && noisy / ne.length >= 0.2);
  },
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
  mockApplyPhaseCriticGate.mockReset();
  mockReviewDiffAdversarially.mockReset();
  mockUpdateMany.mockReset();
  warnCalls.length = 0;
  mockUpdate.mockResolvedValue({});
  mockUpdateMany.mockResolvedValue({ count: 1 });
  mockCheckInvariants.mockResolvedValue([]);
  mockPerformAutoCommitAndPR.mockResolvedValue({});
  mockAttemptVerifyRepair.mockResolvedValue({ bounced: false });
  mockApplyPhaseCriticGate.mockResolvedValue({ bounced: false });
  mockReviewDiffAdversarially.mockResolvedValue(null);
  // NOTE: mockReset() removes the original factory, so restore the default return.
  // The verify path calls prisma.task.findUnique() to detect conflict-resolution tasks;
  // returning null means "not a conflict task" — the normal code path continues.
  mockFindUnique.mockResolvedValue(null);
  existingResearchContent = null;
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
    // Completion now requires a PR — supply a successful one.
    mockPerformAutoCommitAndPR.mockResolvedValueOnce({
      requested: { autoCommit: true, autoCreatePR: true, autoMergePR: false },
      autoCommitResult: { success: true },
      autoPRResult: { success: true, prNumber: 1, prUrl: 'https://x/pull/1' },
    });

    const result = await handleSaveFile({
      params: { taskId: '1', fileType: 'verify' },
      body: 'verify content',
      set: makeSet(),
    });

    // Accepted (not hard-rejected at the guard); verify passes and a PR was
    // created → the task is marked completed.
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
describe('handleSaveFile — 再実行の fast-forward（既存 research.md の再送不要化）', () => {
  test('draft + 既存の有効な research.md があれば verify.md 保存を受理すること（再送不要）', async () => {
    existingResearchContent = '# 調査結果\n依存関係とテスト戦略を確認済み。';
    mockResolveWorkflowDir.mockResolvedValueOnce({
      task: { workflowStatus: 'draft', id: 1 },
      dir: '/fake/dir/1',
      categoryId: null,
      themeId: null,
    });
    mockFindMany.mockResolvedValueOnce([]); // no subtasks
    mockCheckInvariants.mockResolvedValueOnce([]);
    mockPerformAutoCommitAndPR.mockResolvedValueOnce({
      requested: { autoCommit: true, autoCreatePR: true, autoMergePR: false },
      autoCommitResult: { success: true },
      autoPRResult: { success: true, prNumber: 2, prUrl: 'https://x/pull/2' },
    });

    const result = await handleSaveFile({
      params: { taskId: '1', fileType: 'verify' },
      body: 'verify content',
      set: makeSet(),
    });

    // Rejected before the fix (draft only accepts research/question); now the
    // existing research.md fast-forwards draft → research_done and the save runs.
    expect((result as { workflowStatus?: string }).workflowStatus).toBe('completed');
    // The fast-forward persisted research_done before the verify transition.
    const statuses = mockUpdate.mock.calls.map(
      (c) => (c[0] as { data?: { workflowStatus?: string } })?.data?.workflowStatus,
    );
    expect(statuses).toContain('research_done');
  });

  test('draft + 既存 research.md が無ければ従来どおり verify.md 保存を拒否すること', async () => {
    existingResearchContent = null;
    mockResolveWorkflowDir.mockResolvedValueOnce({
      task: { workflowStatus: 'draft', id: 1 },
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

  test('draft + 既存 research.md があれば plan.md 保存も受理し plan_created へ進むこと', async () => {
    existingResearchContent = '# 調査結果\n依存関係とテスト戦略を確認済み。';
    mockResolveWorkflowDir.mockResolvedValueOnce({
      task: { workflowStatus: 'draft', id: 1 },
      dir: '/fake/dir/1',
      categoryId: null,
      themeId: null,
    });
    mockCheckInvariants.mockResolvedValueOnce([]);

    const result = await handleSaveFile({
      params: { taskId: '1', fileType: 'plan' },
      body: '# 実装計画\n- [ ] 手順1',
      set: makeSet(),
    });

    expect((result as { workflowStatus?: string }).workflowStatus).toBe('plan_created');
  });

  test('既存 research.md が薄すぎる（再利用不可）なら fast-forward せず拒否すること', async () => {
    existingResearchContent = '短い'; // isReusableArtifact mock: <10 chars → not reusable
    mockResolveWorkflowDir.mockResolvedValueOnce({
      task: { workflowStatus: 'draft', id: 1 },
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
describe('handleSaveFile — 批評ゲートに不合格となった場合、その旨をレスポンスで明示すること', () => {
  test('research.md が批評ゲートで rollback された場合、criticGateRejected/message/criticReasons を含むこと', async () => {
    mockResolveWorkflowDir.mockResolvedValueOnce({
      task: { workflowStatus: 'draft', id: 1 },
      dir: '/fake/dir/1',
      categoryId: null,
      themeId: null,
    });
    mockCheckInvariants.mockResolvedValueOnce([]);
    mockApplyPhaseCriticGate.mockResolvedValueOnce({
      bounced: true,
      newStatus: 'draft',
      reasons: ['[completeness] テスト対象ファイルの言及がない', '[completeness] 依存関係が不明確'],
      severity: 75,
    });

    const result = (await handleSaveFile({
      params: { taskId: '1', fileType: 'research' },
      body: '# 調査結果\n## 影響範囲\n変更が必要',
      set: makeSet(),
    })) as {
      success?: boolean;
      workflowStatus?: string;
      criticGateRejected?: boolean;
      criticReasons?: string[];
      criticSeverity?: number;
      message?: string;
    };

    // workflowStatus reflects the rollback (not research_done) — this alone was
    // already correct before the fix; the bug was that nothing ELSE in the
    // response told the saving agent WHY, so it kept reporting plain success.
    expect(result.workflowStatus).toBe('draft');
    expect(result.criticGateRejected).toBe(true);
    expect(result.criticReasons).toEqual([
      '[completeness] テスト対象ファイルの言及がない',
      '[completeness] 依存関係が不明確',
    ]);
    expect(result.criticSeverity).toBe(75);
    expect(result.message).toContain('批評ゲート');
    expect(result.message).toContain('バグではなく');
  });

  test('批評ゲートを通過した場合は criticGateRejected を含まないこと', async () => {
    mockResolveWorkflowDir.mockResolvedValueOnce({
      task: { workflowStatus: 'draft', id: 1 },
      dir: '/fake/dir/1',
      categoryId: null,
      themeId: null,
    });
    mockCheckInvariants.mockResolvedValueOnce([]);
    mockApplyPhaseCriticGate.mockResolvedValueOnce({ bounced: false });

    const result = (await handleSaveFile({
      params: { taskId: '1', fileType: 'research' },
      body: '# 調査結果\n## 影響範囲\n変更が必要',
      set: makeSet(),
    })) as { workflowStatus?: string; criticGateRejected?: boolean };

    expect(result.workflowStatus).toBe('research_done');
    expect(result.criticGateRejected).toBeUndefined();
  });
});

// -------------------------------------------------------------------------
describe('handleSaveFile — ログ混入で壊れた md は保存を拒否すること', () => {
  test('plan.md にログが混入していたら 422 で拒否し、保存・遷移しない', async () => {
    mockResolveWorkflowDir.mockResolvedValueOnce({
      task: { workflowStatus: 'research_done', id: 1 },
      dir: '/fake/dir/1',
      categoryId: null,
      themeId: null,
    });
    const set = makeSet();
    const result = await handleSaveFile({
      params: { taskId: '1', fileType: 'plan' },
      body: '# 実装計画\n[System: thinking_tokens]\n[System: init]\n[Tool: Read] -> a.ts\nゴミ出力',
      set,
    });

    expect(set.status).toBe(422);
    expect((result as { error?: string }).error).toContain('実行ログ');
    // 壊れたmdは保存せず、status も進めない
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test('正常な plan.md は通常どおり保存・遷移する', async () => {
    mockResolveWorkflowDir.mockResolvedValueOnce({
      task: { workflowStatus: 'research_done', id: 1 },
      dir: '/fake/dir/1',
      categoryId: null,
      themeId: null,
    });
    mockCheckInvariants.mockResolvedValueOnce([]);
    const result = await handleSaveFile({
      params: { taskId: '1', fileType: 'plan' },
      body: '# 実装計画\n## 設計判断の根拠\n理由\n## 実装チェックリスト\n- [ ] x',
      set: makeSet(),
    });
    expect((result as { workflowStatus?: string }).workflowStatus).toBe('plan_created');
  });
});

// -------------------------------------------------------------------------
describe('handleSaveFile — 完了は PR 作成成功を要件とすること', () => {
  const verifyAtInProgress = () => {
    mockResolveWorkflowDir.mockResolvedValueOnce({
      task: { workflowStatus: 'in_progress', id: 1 },
      dir: '/fake/dir/1',
      categoryId: null,
      themeId: null,
    });
    mockFindMany.mockResolvedValueOnce([]); // no subtasks
    mockCheckInvariants.mockResolvedValueOnce([]);
  };

  test('PR要求ありで未作成・既存PRも無ければ completed にしない（verify_done 維持）', async () => {
    verifyAtInProgress();
    mockPerformAutoCommitAndPR.mockResolvedValueOnce({
      requested: { autoCommit: true, autoCreatePR: true, autoMergePR: false },
      autoCommitResult: { success: true },
      autoPRResult: { success: false, error: 'gh pr create failed' },
    });
    mockFindUnique.mockResolvedValue({ githubPrId: null }); // no linked PR via task

    const result = await handleSaveFile({
      params: { taskId: '1', fileType: 'verify' },
      body: 'verify content',
      set: makeSet(),
    });

    expect((result as { workflowStatus?: string }).workflowStatus).toBe('verify_done');
    expect((result as { taskCompleted?: boolean }).taskCompleted).toBe(false);
  });

  test('PR が作成成功なら completed', async () => {
    verifyAtInProgress();
    mockPerformAutoCommitAndPR.mockResolvedValueOnce({
      requested: { autoCommit: true, autoCreatePR: true, autoMergePR: false },
      autoCommitResult: { success: true },
      autoPRResult: { success: true, prNumber: 9 },
    });

    const result = await handleSaveFile({
      params: { taskId: '1', fileType: 'verify' },
      body: 'verify content',
      set: makeSet(),
    });

    expect((result as { workflowStatus?: string }).workflowStatus).toBe('completed');
  });

  test('PR が要求されていなければ（autoCreatePR=false）PR無しでも completed', async () => {
    verifyAtInProgress();
    mockPerformAutoCommitAndPR.mockResolvedValueOnce({
      requested: { autoCommit: false, autoCreatePR: false, autoMergePR: false },
    });

    const result = await handleSaveFile({
      params: { taskId: '1', fileType: 'verify' },
      body: 'verify content',
      set: makeSet(),
    });

    expect((result as { workflowStatus?: string }).workflowStatus).toBe('completed');
  });

  test('未作成でも既存リンクPRがあれば completed', async () => {
    verifyAtInProgress();
    mockPerformAutoCommitAndPR.mockResolvedValueOnce({
      requested: { autoCommit: true, autoCreatePR: true, autoMergePR: false },
      autoCommitResult: { success: true },
      autoPRResult: { success: false },
    });
    mockPrisma.gitHubPullRequest.findFirst.mockResolvedValueOnce({ id: 50 }); // existing PR

    const result = await handleSaveFile({
      params: { taskId: '1', fileType: 'verify' },
      body: 'verify content',
      set: makeSet(),
    });

    expect((result as { workflowStatus?: string }).workflowStatus).toBe('completed');
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
describe('handleSaveFile — 敵対的差分レビューの遅延判定が完了済みタスクを巻き戻さないこと', () => {
  test('レビュー実行中にタスクが verify_done から動いていなければ通常通り差し戻すこと', async () => {
    mockResolveWorkflowDir.mockResolvedValueOnce({
      task: { workflowStatus: 'in_progress', id: 1 },
      dir: '/fake/dir/1',
      categoryId: null,
      themeId: null,
    });
    mockFindMany.mockResolvedValueOnce([]);
    mockCheckInvariants.mockResolvedValueOnce([]);
    // 1st findUnique = conflict-task check (not a conflict task); 2nd = the
    // CAS live-status check inside the adversarial-review block (still verify_done).
    mockFindUnique.mockResolvedValueOnce(null);
    mockFindUnique.mockResolvedValueOnce({ workflowStatus: 'verify_done' });
    mockReviewDiffAdversarially.mockResolvedValueOnce({
      verdict: 'fail',
      severity: 80,
      reasons: ['受入基準を満たしていません'],
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

    expect((result as { workflowStatus?: string }).workflowStatus).toBe('plan_approved');
    expect(mockUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1, workflowStatus: 'verify_done' },
        data: { workflowStatus: 'plan_approved' },
      }),
    );
  });

  test('レビュー完了時点でタスクが既に verify_done から進んでいれば巻き戻さず、実際の状態を返すこと', async () => {
    mockResolveWorkflowDir.mockResolvedValueOnce({
      task: { workflowStatus: 'in_progress', id: 1 },
      dir: '/fake/dir/1',
      categoryId: null,
      themeId: null,
    });
    mockFindMany.mockResolvedValueOnce([]);
    mockCheckInvariants.mockResolvedValueOnce([]);
    // 1st findUnique = conflict-task check; 2nd = the CAS live-status check —
    // a second, faster verify/repair round already completed (and merged) the
    // task while this review was still running (task 503's actual incident).
    mockFindUnique.mockResolvedValueOnce(null);
    mockFindUnique.mockResolvedValueOnce({ workflowStatus: 'completed' });
    mockReviewDiffAdversarially.mockResolvedValueOnce({
      verdict: 'fail',
      severity: 75,
      reasons: ['受入基準を満たしていません'],
    });
    mockAttemptVerifyRepair.mockResolvedValueOnce({
      bounced: true,
      newStatus: 'plan_approved',
      attempt: 1,
    });

    const result = (await handleSaveFile({
      params: { taskId: '1', fileType: 'verify' },
      body: 'verify content',
      set: makeSet(),
    })) as { workflowStatus?: string };

    // Must report the task's ACTUAL current status, never the stale
    // 'plan_approved' rollback target this late verdict wanted to apply.
    expect(result.workflowStatus).toBe('completed');
    // The rollback update must never have been attempted with stale data.
    expect(mockUpdateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { workflowStatus: 'plan_approved' } }),
    );
  });
});

// -------------------------------------------------------------------------
describe('handleSaveFile — adversarial review FAIL with repairs exhausted', () => {
  // Regression (task 504): repairs-exhausted only logged "task stays blocked"
  // and called markLatestExecutionFailed (which touches AgentExecution/
  // AgentSession, not Task) — task.status was never actually set to 'blocked',
  // leaving it however it already was (e.g. 'todo'), indistinguishable from a
  // never-started task despite workflowStatus sitting at 'verify_done'.
  test('sets task.status to blocked when the repair budget is exhausted', async () => {
    mockResolveWorkflowDir.mockResolvedValueOnce({
      task: { workflowStatus: 'in_progress', id: 1 },
      dir: '/fake/dir/1',
      categoryId: null,
      themeId: null,
    });
    mockFindMany.mockResolvedValueOnce([]);
    mockCheckInvariants.mockResolvedValueOnce([]);
    // 1st findUnique = conflict-task check; 2nd = the CAS live-status check.
    mockFindUnique.mockResolvedValueOnce(null);
    mockFindUnique.mockResolvedValueOnce({ workflowStatus: 'verify_done' });
    mockReviewDiffAdversarially.mockResolvedValueOnce({
      verdict: 'fail',
      severity: 92,
      reasons: ['実装が空'],
    });
    mockAttemptVerifyRepair.mockResolvedValueOnce({ bounced: false });

    await handleSaveFile({
      params: { taskId: '1', fileType: 'verify' },
      body: 'verify content',
      set: makeSet(),
    });

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1 },
        data: expect.objectContaining({ status: 'blocked' }),
      }),
    );
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
