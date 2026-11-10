/**
 * execute-route.session-mode テスト
 *
 * 手動実行がワークフローの実行にセッションの mode を付けられなかったとき、実行を
 * 始めないことを固定する（G2 routing1 再レビュー7 P1：保存の失敗は警告だけで、
 * mode が null のセッションのまま実行が続き、完了の書き込みが単発実行と扱えた）。
 */
import { beforeEach, expect, mock, test } from 'bun:test';
import { Elysia } from 'elysia';

const noop = () => {};
mock.module('../../../../config/logger', () => ({
  createLogger: () => ({ info: noop, warn: noop, error: noop, debug: noop }),
}));
let tagged = false;
const task = {
  id: 1470,
  title: 'mode test',
  description: 'd',
  status: 'todo',
  // Past draft so the intake gate is skipped; scored so complexity analysis is skipped.
  workflowStatus: 'research_done',
  complexityScore: 40,
  workflowModeOverride: null,
  themeId: null,
  startedAt: null,
  developerModeConfig: null,
  theme: { isDevelopment: true, workingDirectory: '/repo', defaultBranch: 'develop' },
};
mock.module('../../../../config/database', () => ({
  prisma: {
    task: {
      findUnique: async () => task,
      update: async () => ({}),
      updateMany: async () => ({ count: 1 }),
    },
    agentExecutionConfig: { updateMany: async () => ({ count: 0 }) },
    // Fails with the tag so the base route (which wrote the mode directly) is exercised too.
    agentSession: {
      update: async () => {
        if (!tagged) throw new Error('db down');
        return {};
      },
      findUnique: async () => null,
    },
    userSettings: { findFirst: async () => null },
  },
}));
const executeTask = mock(async () => ({ success: true }));
mock.module('../../../../services/agents/agent-worker-manager', () => ({
  AgentWorkerManager: { getInstance: () => ({ executeTask }) },
}));
mock.module('../../../../services/workflow/workflow-disabled', () => ({
  resolveEffectiveWorkflowDisabled: async () => false,
}));
mock.module('../shared/manual-execution-settlement', () => ({
  prepareManualExecution: async (_id: number, _owner: unknown, fn: () => Promise<unknown>) => fn(),
  settleManualExecution: async () => undefined,
}));
mock.module('../shared/execute-setup', () => ({
  needsDisabledFastForward: () => false,
  executeSetup: async () => ({
    developerModeConfig: { id: 1 },
    session: { id: 77 },
    worktreePath: '/repo/.worktrees/t1470',
  }),
}));
mock.module('../../../../services/workflow/role-resolver', () => ({
  resolveAgentForTask: async () => ({ role: 'implementer', agentConfigId: null, modelId: null }),
}));
const tagSessionWorkflowRole = mock(async (_sessionId: number, _role: string) => tagged);
mock.module('../shared/session-mode', () => ({
  tagSessionWorkflowRole,
  readSessionMode: async () => undefined,
}));
const updateSessionStatusWithRetry = mock(async (..._args: unknown[]) => undefined);
mock.module('../shared/session-helpers', () => ({ updateSessionStatusWithRetry }));

const { executeRoute } = await import('./execute-route');
const { isTaskExecutionLocked } = await import('../shared/execution-lock');

const post = () =>
  new Elysia().use(executeRoute).handle(
    new Request('http://localhost/tasks/1470/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }),
  );

beforeEach(() => {
  tagged = false;
  executeTask.mockClear();
  tagSessionWorkflowRole.mockClear();
  updateSessionStatusWithRetry.mockClear();
});

test('レビューの再現：mode を保存できなければ実行を始めず、500 を返してセッションを failed にする', async () => {
  const res = await post();
  expect(tagSessionWorkflowRole).toHaveBeenCalledWith(77, 'implementer');
  expect(res.status).toBe(500);
  expect((await res.json()).error).toContain('execution was not started');
  expect(executeTask).not.toHaveBeenCalled();
  expect(updateSessionStatusWithRetry).toHaveBeenCalledWith(77, 'failed', '[API]', 1);
  expect(isTaskExecutionLocked(1470)).toBe(false);
});

test('対照：mode を保存できたら、この理由では止めない', async () => {
  tagged = true;
  const res = await post();
  expect(tagSessionWorkflowRole).toHaveBeenCalledWith(77, 'implementer');
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  expect(body.error ?? '').not.toContain('execution was not started');
  expect(updateSessionStatusWithRetry).not.toHaveBeenCalledWith(77, 'failed', '[API]', 1);
});
