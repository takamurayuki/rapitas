/**
 * Copilot Action Service テスト
 * copilot-action-service.ts のアクション実行ロジックのユニットテスト
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const mockTask = {
  findUnique: mock(() => Promise.resolve(null)),
  update: mock(() => Promise.resolve({ id: 1, title: 'test', status: 'in_progress' })),
};

const mockPrisma = { task: mockTask };

mock.module('../../config/database', () => ({ prisma: mockPrisma }));
mock.module('../../config/logger', () => ({
  createLogger: () => ({
    info: mock(() => {}),
    debug: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  }),
}));
mock.module('../../services/claude-agent/task-analyzer', () => ({
  analyzeTask: mock(() =>
    Promise.resolve({
      result: {
        summary: 'テスト概要',
        complexity: 'medium',
        estimatedTotalHours: 4,
        suggestedSubtasks: [{ title: 'sub1', description: 'd', priority: 'medium', order: 1 }],
        reasoning: '理由',
      },
      tokensUsed: 100,
    }),
  ),
}));
mock.module('../../services/agent/agent-execution-service', () => ({
  AgentExecutionService: class {
    async executeTask() {
      return { success: true, executionId: 1, sessionId: 1, message: 'ok' };
    }
    async getLatestExecution() {
      return null;
    }
  },
}));
mock.module('../../services/task/task-mutations', () => ({
  createTask: mock(() => Promise.resolve({ id: 10 })),
}));

const { executeCopilotAction } = await import('../../services/ai/copilot-action-service');

describe('Copilot Action Service', () => {
  beforeEach(() => {
    mockTask.findUnique.mockReset().mockReturnValue(
      Promise.resolve({
        id: 1, title: 'テストタスク', description: 'desc',
        priority: 'medium', dueDate: null, estimatedHours: null,
      }),
    );
    mockTask.update.mockReset().mockReturnValue(
      Promise.resolve({ id: 1, title: 'テストタスク', status: 'in_progress' }),
    );
  });

  test('analyze: タスク分析を実行', async () => {
    const result = await executeCopilotAction({ action: 'analyze', taskId: 1 });

    expect(result.success).toBe(true);
    expect(result.action).toBe('analyze');
    expect(result.message).toContain('分析結果');
  });

  test('analyze: 存在しないタスクでエラー', async () => {
    mockTask.findUnique.mockReturnValue(Promise.resolve(null));

    const result = await executeCopilotAction({ action: 'analyze', taskId: 999 });

    expect(result.success).toBe(false);
    expect(result.message).toContain('見つかりません');
  });

  test('update_status: ステータスを更新', async () => {
    const result = await executeCopilotAction({
      action: 'update_status',
      taskId: 1,
      params: { status: 'in_progress' },
    });

    expect(result.success).toBe(true);
    expect(result.action).toBe('update_status');
    expect(mockTask.update).toHaveBeenCalledTimes(1);
  });

  test('update_status: ステータス未指定でエラー', async () => {
    const result = await executeCopilotAction({
      action: 'update_status',
      taskId: 1,
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain('ステータス');
  });

  test('create_subtasks: サブタスク情報なしでエラー', async () => {
    const result = await executeCopilotAction({
      action: 'create_subtasks',
      taskId: 1,
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain('サブタスク');
  });

  test('execute: エージェント実行を開始', async () => {
    const result = await executeCopilotAction({ action: 'execute', taskId: 1 });

    expect(result.success).toBe(true);
    expect(result.action).toBe('execute');
    expect(result.message).toContain('開始');
  });

  test('不明なアクションでエラー', async () => {
    const result = await executeCopilotAction({
      action: 'unknown_action' as 'analyze',
      taskId: 1,
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain('不明');
  });
});
