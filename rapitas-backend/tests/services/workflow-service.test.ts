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
};

mock.module('../../config', () => ({ prisma: mockPrisma }));
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

const { WorkflowOrchestrator } = await import('../../services/workflow/workflow-orchestrator');

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
    // Reset singleton for clean tests
    (WorkflowOrchestrator as any).instance = undefined;
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
});
