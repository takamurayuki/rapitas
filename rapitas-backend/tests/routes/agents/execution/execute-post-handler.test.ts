/**
 * execute-post-handler テスト
 *
 * dev-mode 実行が planning フェーズで停止したとき、ワークフローを次フェーズへ
 * 自動進行させる advanceManagedPlanningPhase の判定ロジックを検証する。
 *
 * NOTE: mock.module の specifier は解決後の絶対パスで照合されるため、ソースが
 * `./session-helpers` 等で import するモジュールも、本テストからの相対パス
 * (`../../../../routes/agents/execution/...`) で同じ実体を指す必要がある。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

// HACK(agent): Bun mock型推論の制限 — 型パラメーターをサポートしていないため `as any` で型チェックをバイパス
const mockTaskFindUnique = mock(() => Promise.resolve(null)) as any;
const mockAdvanceWorkflow = mock(() => Promise.resolve({ success: true })) as any;

mock.module('../../../../config/database', () => ({
  prisma: { task: { findUnique: mockTaskFindUnique } },
  ensureDatabaseConnection: () => Promise.resolve(),
}));
mock.module('../../../../config/logger', () => {
  const noop = { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} };
  return {
    createLogger: () => noop,
    logger: noop,
    getBackendLogFilePath: () => '/tmp/backend.log',
  };
});
// Sibling / service modules pulled in at load time — stub so importing the handler is cheap.
mock.module('../../../../services/agents/agent-worker-manager', () => ({
  AgentWorkerManager: { getInstance: () => ({}) },
}));
mock.module('../../../../routes/agents/execution/shared/session-helpers', () => ({
  updateSessionStatusWithRetry: () => Promise.resolve(),
}));
mock.module('../../../../routes/agents/execution/post-handlers/post-execution-review', () => ({
  reviewAndCommitWorktree: () => Promise.resolve(),
}));
mock.module('../../../../routes/agents/execution/shared/execution-output-validator', () => ({
  detectExecutionFailures: () => [],
}));
mock.module('../../../../routes/agents/execution/research/research-phase-handler', () => ({
  handleResearchResult: () => Promise.resolve(),
}));
mock.module('../../../../routes/agents/execution/research/research-output-utils', () => ({
  isIsolatedWorktree: () => false,
}));
// The orchestrator is dynamically imported inside the scheduled advance.
mock.module('../../../../services/workflow/workflow-orchestrator', () => ({
  WorkflowOrchestrator: { getInstance: () => ({ advanceWorkflow: mockAdvanceWorkflow }) },
}));

const { advanceManagedPlanningPhase } =
  await import('../../../../routes/agents/execution/post-handlers/execute-post-handler');

describe('advanceManagedPlanningPhase', () => {
  beforeEach(() => {
    mockTaskFindUnique.mockReset();
    mockAdvanceWorkflow.mockReset();
  });

  test('standard モード + plan_approved は進行を予約する (true)', async () => {
    mockTaskFindUnique.mockResolvedValue({
      workflowMode: 'standard',
      workflowStatus: 'plan_approved',
    });
    expect(await advanceManagedPlanningPhase(234)).toBe(true);
  });

  test('standard モード + research_done も進行を予約する (true)', async () => {
    mockTaskFindUnique.mockResolvedValue({
      workflowMode: 'standard',
      workflowStatus: 'research_done',
    });
    expect(await advanceManagedPlanningPhase(234)).toBe(true);
  });

  test('plan_created は承認待ちなので進行しない (false)', async () => {
    mockTaskFindUnique.mockResolvedValue({
      workflowMode: 'standard',
      workflowStatus: 'plan_created',
    });
    expect(await advanceManagedPlanningPhase(234)).toBe(false);
  });

  test('完了済みは進行しない (false)', async () => {
    mockTaskFindUnique.mockResolvedValue({
      workflowMode: 'comprehensive',
      workflowStatus: 'completed',
    });
    expect(await advanceManagedPlanningPhase(234)).toBe(false);
  });

  test('非マネージドモード (workflowMode 未設定) は進行しない (false)', async () => {
    mockTaskFindUnique.mockResolvedValue({ workflowMode: null, workflowStatus: 'plan_approved' });
    expect(await advanceManagedPlanningPhase(234)).toBe(false);
  });
});
