/**
 * Workflow Orchestrator テスト
 * WorkflowOrchestrator クラスのユニットテスト
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

// --- mocks ---
const mockPrisma = {
  task: {
    findUnique: mock(() => Promise.resolve(null)),
    update: mock(() => Promise.resolve({})),
  },
  workflowRoleConfig: {
    findUnique: mock(() => Promise.resolve(null)),
  },
  developerModeConfig: {
    findUnique: mock(() => Promise.resolve(null)),
    create: mock(() => Promise.resolve({ id: 1, taskId: 1, isEnabled: true })),
  },
  agentSession: {
    create: mock(() => Promise.resolve({ id: 1 })),
    update: mock(() => Promise.resolve({})),
  },
  agentExecution: {
    create: mock(() => Promise.resolve({ id: 1 })),
    update: mock(() => Promise.resolve({})),
  },
  systemPrompt: {
    findUnique: mock(() => Promise.resolve(null)),
  },
  // NOTE: Added — workflow-orchestrator.ts:342 resolves aIAgentConfig when no role config exists.
  aIAgentConfig: {
    findUnique: mock(() => Promise.resolve(null)),
    findFirst: mock(() => Promise.resolve(null)),
  },
  // NOTE (task 865): workflow-orchestrator-agent-prep.ts reads plan.md via
  // readWorkflowFile (workflow-file-utils.ts), which calls prisma.workflowFile
  // directly — undefined here would throw synchronously before its own .catch().
  workflowFile: {
    findUnique: mock(() => Promise.resolve(null)),
  },
};

mock.module('../../config', () => ({
  prisma: mockPrisma,
  createLogger: () => ({
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
  }),
}));
mock.module('../../config/logger', () => ({
  createLogger: () => ({
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
  }),
}));
mock.module('../../utils/mojibake-detector', () => ({
  sanitizeMarkdownContent: (content: string) => ({
    content,
    wasFixed: false,
    issues: [],
  }),
}));

// AgentOrchestrator mock
mock.module('../../services/agents/agent-orchestrator', () => ({
  AgentOrchestrator: {
    getInstance: () => ({
      executeTask: mock(() =>
        Promise.resolve({ success: true, output: 'Done', errorMessage: null }),
      ),
    }),
  },
}));

// NOTE (task 865): resolveTaskWithThemeAndCategory (task-resolver.ts) imports
// prisma directly from '../../config/database', bypassing the '../../config'
// barrel mock above — its real implementation was reaching a real, unreachable
// Postgres on EVERY advanceWorkflow call (runPreflight calls it first), taking
// ~5s to reject and always resolving to null (task not found), regardless of
// what mockPrisma.task.findUnique was set to (6 fail). Delegate the one
// function preflight actually calls back through mockPrisma.task.findUnique so
// each test's existing setup takes effect as originally intended. Full export
// mirror required by mock.module.
mock.module('../../services/task/task-resolver', () => ({
  resolveTaskWithThemeAndCategory: mock((taskId: number) =>
    mockPrisma.task.findUnique({ where: { id: taskId } }).catch(() => null),
  ),
  resolveTaskWithTheme: mock(() => Promise.resolve(null)),
  resolveTaskForExecution: mock(() => Promise.resolve(null)),
  resolveTaskWorkingDirectory: mock(() => Promise.resolve(null)),
  resolveTaskWorkflowState: mock(() => Promise.resolve(null)),
  resolveTaskTitle: mock(() => Promise.resolve(null)),
  resolveTaskThemeId: mock(() => Promise.resolve(null)),
  resolveTaskForComplexityAnalysis: mock(() => Promise.resolve(null)),
  resolveTaskSubtaskInfo: mock(() => Promise.resolve(null)),
  resolveTaskForPlanApproval: mock(() => Promise.resolve(null)),
  resolveTaskForAutoMerge: mock(() => Promise.resolve(null)),
  taskRowConfirmedAbsent: mock(() => Promise.resolve(false)),
  resolvePreferredBaseBranch: mock(() => Promise.resolve(null)),
  resolveTaskForLearning: mock(() => Promise.resolve(null)),
}));

// NOTE (task 865): getModeSettings (workflow-mode-config.ts) also imports
// prisma directly from '../../config/database' and hits the same unreachable
// DB. buildTransitions/DEFAULT_MODE_SETTINGS are pure, so capture the REAL
// ones (imported before the mock replaces the module) and only stub the
// DB-backed lookup — this keeps the transition table identical to production.
// Full export mirror required by mock.module.
const realModeConfig = await import('../../services/workflow/workflow-mode-config');
mock.module('../../services/workflow/workflow-mode-config', () => ({
  DEFAULT_MODE_SETTINGS: realModeConfig.DEFAULT_MODE_SETTINGS,
  getModeSettings: mock((mode: 'lightweight' | 'standard' | 'comprehensive') =>
    Promise.resolve(realModeConfig.DEFAULT_MODE_SETTINGS[mode]),
  ),
  getAllModeSettings: mock(() => Promise.resolve(realModeConfig.DEFAULT_MODE_SETTINGS)),
  buildTransitions: realModeConfig.buildTransitions,
  buildRoleByStatus: realModeConfig.buildRoleByStatus,
  invalidateModeConfigCache: mock(() => {}),
  selectModeByComplexity: mock(() => Promise.resolve('standard')),
  pickModeForScore: realModeConfig.pickModeForScore,
  MODE_TIER: realModeConfig.MODE_TIER,
  higherMode: realModeConfig.higherMode,
  applyProvisionalBias: realModeConfig.applyProvisionalBias,
  selectProvisionalMode: mock(() => Promise.resolve('standard')),
  updateModeSettings: mock((mode: 'lightweight' | 'standard' | 'comprehensive') =>
    Promise.resolve(realModeConfig.DEFAULT_MODE_SETTINGS[mode]),
  ),
  recommendModeFromSettings: realModeConfig.recommendModeFromSettings,
}));

// NOTE (task 865): when WorkflowRoleConfig has no agent assigned,
// workflow-orchestrator-agent-prep.ts falls back to recommendAgentForRole
// (role-recommender.ts) then getDefaultAgent (agent-config/defaults.ts) — both
// hit the real DB. Fixed to null so the "ロール設定がない場合" test exercises
// its intended branch: no assigned/recommended/default agent → the
// "エージェントが割り当てられていません" error.
mock.module('../../services/workflow/role-recommender', () => ({
  recommendAgentForRole: mock(() => Promise.resolve(null)),
}));
mock.module('../../services/agent-config/defaults', () => ({
  getDefaultAgent: mock(() => Promise.resolve(null)),
}));

// NOTE (task 865): runPreflight calls resolveEffectiveWorkflowDisabled
// (workflow-disabled.ts) right after the task lookup — it also imports prisma
// directly from '../../config/database' (userSettings.findFirst / task
// lookup), silently catching DB errors with no log line, which is why this
// hang had no diagnostic output. Mock it to the real fail-open default (false).
mock.module('../../services/workflow/workflow-disabled', () => ({
  resolveEffectiveWorkflowDisabled: mock(() => Promise.resolve(false)),
}));

mock.module('../../routes/ai/system-prompts/default-prompts', () => ({
  DEFAULT_SYSTEM_PROMPTS: [
    {
      key: 'workflow_role_researcher',
      name: 'Researcher',
      description: 'test',
      category: 'workflow',
      content: 'FALLBACK_CONTENT',
    },
  ],
}));

const { WorkflowOrchestrator, resolveSystemPromptContent } =
  await import('../../services/workflow/workflow-orchestrator');
const { acquireTaskExecutionLock, releaseTaskExecutionLock } =
  await import('../../services/agents/task-execution-lock');

function resetAllMocks() {
  for (const model of Object.values(mockPrisma)) {
    if (typeof model === 'object' && model !== null) {
      for (const method of Object.values(model)) {
        if (typeof method === 'function' && 'mockReset' in method) {
          (method as ReturnType<typeof mock>).mockReset();
        }
      }
    }
  }
}

describe('WorkflowOrchestrator', () => {
  let orchestrator: InstanceType<typeof WorkflowOrchestrator>;

  beforeEach(() => {
    resetAllMocks();
    // NOTE: resetAllMocks() calls mockReset() on every mock, removing the factory
    // implementation. Restore the default return for aIAgentConfig so that the
    // "no role config" path can call findUnique(...).catch(...) without throwing.
    mockPrisma.aIAgentConfig.findUnique.mockResolvedValue(null);
    mockPrisma.aIAgentConfig.findFirst.mockResolvedValue(null);
    // Reset singleton for clean tests
    (WorkflowOrchestrator as unknown as { instance: undefined }).instance = undefined;
    orchestrator = WorkflowOrchestrator.getInstance();
  });

  describe('getInstance', () => {
    test('シングルトンインスタンスを返すこと', () => {
      const a = WorkflowOrchestrator.getInstance();
      const b = WorkflowOrchestrator.getInstance();
      expect(a).toBe(b);
    });
  });

  describe('advanceWorkflow', () => {
    test('タスクが見つからない場合エラーを返すこと', async () => {
      mockPrisma.task.findUnique.mockResolvedValue(null);

      const result = await orchestrator.advanceWorkflow(999);
      expect(result.success).toBe(false);
      expect(result.error).toContain('タスクが見つかりません');
    });

    test('既にフェーズ実行中(ロック保持)なら skipped を返しエージェントを起動しない', async () => {
      mockPrisma.task.findUnique.mockResolvedValue({
        id: 7777,
        title: 'Locked Task',
        description: 'desc',
        workflowStatus: 'research_done',
        workflowMode: 'comprehensive',
        theme: null,
        themeId: null,
      });

      // Simulate another trigger already running a phase for this task.
      acquireTaskExecutionLock(7777);
      try {
        const result = await orchestrator.advanceWorkflow(7777);
        expect(result.skipped).toBe(true);
        expect(result.success).toBe(true);
        // No agent session is created on the skip path.
        expect(mockPrisma.agentSession.create).not.toHaveBeenCalled();
      } finally {
        releaseTaskExecutionLock(7777);
      }
    });

    test('ロール設定がない場合エラーを返すこと', async () => {
      mockPrisma.task.findUnique.mockResolvedValue({
        id: 1,
        title: 'Test Task',
        description: 'desc',
        workflowStatus: 'draft',
        workflowMode: 'comprehensive',
        theme: null,
        themeId: null,
      });
      mockPrisma.workflowRoleConfig.findUnique.mockResolvedValue(null);

      const result = await orchestrator.advanceWorkflow(1);
      expect(result.success).toBe(false);
      expect(result.error).toContain('エージェントが割り当てられていません');
    });

    test('ロールが無効化されている場合エラーを返すこと', async () => {
      mockPrisma.task.findUnique.mockResolvedValue({
        id: 1,
        title: 'Test Task',
        description: 'desc',
        workflowStatus: 'draft',
        workflowMode: 'comprehensive',
        theme: null,
        themeId: null,
      });
      mockPrisma.workflowRoleConfig.findUnique.mockResolvedValue({
        role: 'researcher',
        isEnabled: false,
        agentConfigId: 1,
        agentConfig: { id: 1, agentType: 'claude-code', name: 'Claude', modelId: null },
      });

      const result = await orchestrator.advanceWorkflow(1);
      expect(result.success).toBe(false);
      expect(result.error).toContain('無効化されています');
    });

    test('遷移不可のステータスでエラーを返すこと', async () => {
      mockPrisma.task.findUnique.mockResolvedValue({
        id: 1,
        title: 'Test Task',
        description: 'desc',
        workflowStatus: 'completed',
        workflowMode: 'comprehensive',
        theme: null,
        themeId: null,
      });

      const result = await orchestrator.advanceWorkflow(1);
      expect(result.success).toBe(false);
      expect(result.error).toContain('次のフェーズを実行できません');
    });

    test('workflowModeがlightweightの場合も適切に動作すること', async () => {
      mockPrisma.task.findUnique.mockResolvedValue({
        id: 1,
        title: 'Test Task',
        description: 'desc',
        workflowStatus: 'completed',
        workflowMode: 'lightweight',
        theme: null,
        themeId: null,
      });

      const result = await orchestrator.advanceWorkflow(1);
      expect(result.success).toBe(false);
      // "completed" has no transition in lightweight mode
      expect(result.error).toContain('次のフェーズを実行できません');
    });

    test('workflowModeがstandardの場合も適切に動作すること', async () => {
      mockPrisma.task.findUnique.mockResolvedValue({
        id: 1,
        title: 'Test Task',
        description: 'desc',
        workflowStatus: 'verify_done',
        workflowMode: 'standard',
        theme: null,
        themeId: null,
      });

      const result = await orchestrator.advanceWorkflow(1);
      expect(result.success).toBe(false);
      // "verify_done" has no transition in standard mode
      expect(result.error).toContain('次のフェーズを実行できません');
    });
  });

  describe('resolveSystemPromptContent', () => {
    beforeEach(() => {
      resetAllMocks();
    });

    test('B-2: DB に record が存在する場合、DB の content を返すこと', async () => {
      mockPrisma.systemPrompt.findUnique.mockResolvedValue({ content: 'DB_CONTENT' });

      const result = await resolveSystemPromptContent('workflow_role_researcher');
      expect(result).toBe('DB_CONTENT');
    });

    test('B-1: DB が null かつ DEFAULT_SYSTEM_PROMPTS に key が存在する場合、fallback content を返すこと', async () => {
      mockPrisma.systemPrompt.findUnique.mockResolvedValue(null);

      const result = await resolveSystemPromptContent('workflow_role_researcher');
      expect(result).toBe('FALLBACK_CONTENT');
    });

    test("B-1': DB が null かつ DEFAULT_SYSTEM_PROMPTS にも key がない場合、空文字を返すこと", async () => {
      mockPrisma.systemPrompt.findUnique.mockResolvedValue(null);

      const result = await resolveSystemPromptContent('workflow_role_auto_verifier');
      expect(result).toBe('');
    });

    test('B-2 エッジ: DB record の content が空文字でも DEFAULT_SYSTEM_PROMPTS へフォールバックしないこと', async () => {
      // NOTE: DB record が存在する = DB の意図。content が空文字でも record がある以上 B-2 扱い。
      mockPrisma.systemPrompt.findUnique.mockResolvedValue({ content: '' });

      const result = await resolveSystemPromptContent('workflow_role_researcher');
      expect(result).toBe('');
    });
  });
});
