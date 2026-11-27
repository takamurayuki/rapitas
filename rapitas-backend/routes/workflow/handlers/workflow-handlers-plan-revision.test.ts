/**
 * workflow-handlers-plan-revision.test
 *
 * Covers POST /workflow/tasks/:taskId/revise-plan: the source guard (an agent
 * must not hand itself a revised plan), input validation, and the rollback to
 * the planning phase with plan.md left in place for the planner to revise.
 */
import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';

const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
const taskFindUnique = mock(() =>
  Promise.resolve<{ id: number; workflowStatus: string; themeId?: number } | null>(null),
);
const taskUpdate = mock(() => Promise.resolve({}));
const createTransition = mock(() => Promise.resolve(undefined));
const readWorkflowFile = mock(() => Promise.resolve<string | null>(null));
const advanceWorkflow = mock(() => Promise.resolve({ success: true }));
let reservation: { id: number; taskId: number; status: string } | null = null;
let occupied = false;
let releaseObserved: () => void = () => {};
const queue = {
  findFirst: async () => reservation,
  count: async () => Number(occupied || reservation?.status === 'running'),
  create: async ({ data }: { data: { taskId: number; status: string } }) =>
    (reservation = { id: 1, ...data }),
  updateMany: async ({ data }: { data: { status: string } }) => {
    if (reservation?.status === 'running') Object.assign(reservation, data);
    releaseObserved();
    return { count: 1 };
  },
};
mock.module('../../../services/workflow/workflow-orchestrator', () => ({
  WorkflowOrchestrator: { getInstance: () => ({ advanceWorkflow }) },
}));

mock.module('../../../config', () => ({
  prisma: {
    task: { findUnique: taskFindUnique },
    themeAutoRun: { findFirst: async () => ({ status: 'paused_user' }) },
    workflowQueueItem: queue,
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        task: { update: taskUpdate, findUnique: taskFindUnique },
        workflowQueueItem: queue,
        workflowTransition: { create: createTransition },
      }),
  },
  createLogger: () => noopLogger,
  logger: noopLogger,
}));
mock.module('../../../config/logger', () => ({ createLogger: () => noopLogger }));
mock.module('../../../services/workflow/workflow-file-utils', () => ({ readWorkflowFile }));

mock.module('../../../services/workflow/workflow-queue', () => ({
  WorkflowQueueService: { getInstance: () => ({ getMaxConcurrency: () => 1 }) },
}));

const { handleRevisePlan } = await import('./workflow-handlers-plan-revision');

const UI = { 'x-rapitas-source': 'ui' };

let originalFetch: typeof fetch;

beforeEach(() => {
  reservation = null;
  occupied = false;
  releaseObserved = () => {};
  advanceWorkflow.mockReset().mockResolvedValue({ success: true });
  taskFindUnique
    .mockReset()
    .mockResolvedValue({ id: 1, workflowStatus: 'plan_created', themeId: 35 });
  taskUpdate.mockReset().mockResolvedValue({});
  createTransition.mockReset().mockResolvedValue(undefined);
  readWorkflowFile.mockReset().mockResolvedValue('# 実装計画');
  // The handler fires a best-effort re-run; keep it off the network.
  originalFetch = globalThis.fetch;
  globalThis.fetch = mock(() => Promise.resolve({ ok: true } as Response)) as typeof fetch;
});

// Restore the global so the suite does not leak a stubbed fetch into others.
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('handleRevisePlan', () => {
  test.each(['成功', '失敗', '例外'])(
    '計画修正ハンドラ経由の%sで実予約を解放する',
    async (outcome) => {
      let finish!: () => void;
      let entered!: () => void;
      const pending = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const released = new Promise<void>((resolve) => {
        releaseObserved = resolve;
      });
      advanceWorkflow.mockImplementationOnce(async () => {
        entered();
        await pending;
        if (outcome === '例外') throw new Error('実行例外');
        return { success: outcome === '成功' };
      });
      await handleRevisePlan({
        params: { taskId: '1' },
        body: { instruction: '修正' },
        set: {},
        headers: UI,
      });
      await started;
      expect(reservation).toMatchObject({ taskId: 1, status: 'running' });
      finish();
      await released;
      expect(reservation).toMatchObject({ status: outcome === '成功' ? 'completed' : 'failed' });
    },
  );
  test('does not dispatch without a durable revision instruction', async () => {
    createTransition.mockRejectedValueOnce(new Error('audit unavailable'));
    await expect(
      handleRevisePlan({
        params: { taskId: '1' },
        body: { instruction: '修正' },
        set: {},
        headers: UI,
      }),
    ).rejects.toThrow('audit unavailable');
    expect(advanceWorkflow).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  test('dispatches the planner through the phase orchestrator, not generic execute', async () => {
    await handleRevisePlan({
      params: { taskId: '1' },
      body: { instruction: '取得不能時の判定を修正' },
      set: {},
      headers: UI,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(advanceWorkflow).toHaveBeenCalledWith(1);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  test('task 1535: 一時停止テーマで枠が空いていなければ指示は記録するが planner を起動しない', async () => {
    occupied = true;
    const result = await handleRevisePlan({
      params: { taskId: '1' },
      body: { instruction: '取得不能時の判定を修正' },
      set: {},
      headers: UI,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.toStatus).toBe('research_done');
    expect(advanceWorkflow).not.toHaveBeenCalled();
  });

  test('rolls back to research_done and records the instruction', async () => {
    const result = await handleRevisePlan({
      params: { taskId: '1' },
      body: { instruction: '非対象からUIカード追加を外して' },
      set: {},
      headers: UI,
    });

    expect(result).toEqual({ taskId: 1, ok: true, toStatus: 'research_done' });
    const update = taskUpdate.mock.calls[0]?.[0] as { data: { workflowStatus: string } };
    expect(update.data.workflowStatus).toBe('research_done');

    const { data: t } = createTransition.mock.calls[0]?.[0] as {
      data: {
        cause: string;
        metadata: string;
      };
    };
    expect(t.cause).toBe('plan_revision_requested');
    expect(JSON.parse(t.metadata).instruction).toBe('非対象からUIカード追加を外して');
  });

  test('leaves plan.md in place so the planner revises rather than re-derives', async () => {
    await handleRevisePlan({
      params: { taskId: '1' },
      body: { instruction: '直して' },
      set: {},
      headers: UI,
    });
    // Read to confirm it exists — never archived here.
    expect(readWorkflowFile).toHaveBeenCalledWith(1, 'plan');
  });

  test('rejects a call with no source header (an agent shell-call)', async () => {
    const set: { status?: number } = {};
    await expect(
      handleRevisePlan({ params: { taskId: '1' }, body: { instruction: '直して' }, set }),
    ).rejects.toThrow('X-Rapitas-Source');
    expect(set.status).toBe(400);
    expect(taskUpdate).not.toHaveBeenCalled();
  });

  test.each(['assistant', 'rapi', 'constructor', '__proto__'])(
    'refuses %s as a source (only ui/operator direct the planner)',
    async (source) => {
      const set: { status?: number } = {};
      await expect(
        handleRevisePlan({
          params: { taskId: '1' },
          body: { instruction: '直して' },
          set,
          headers: { 'x-rapitas-source': source },
        }),
      ).rejects.toThrow('X-Rapitas-Source');
      expect(set.status).toBe(400);
      expect(taskUpdate).not.toHaveBeenCalled();
    },
  );

  test('rejects a blank instruction', async () => {
    const set: { status?: number } = {};
    await expect(
      handleRevisePlan({ params: { taskId: '1' }, body: { instruction: '  ' }, set, headers: UI }),
    ).rejects.toThrow('instruction is required');
    expect(taskUpdate).not.toHaveBeenCalled();
  });

  test('rejects an instruction that is a document rather than a sentence', async () => {
    const set: { status?: number } = {};
    await expect(
      handleRevisePlan({
        params: { taskId: '1' },
        body: { instruction: 'x'.repeat(2001) },
        set,
        headers: UI,
      }),
    ).rejects.toThrow('2000 characters');
    expect(taskUpdate).not.toHaveBeenCalled();
  });

  test('404s when there is no plan to revise', async () => {
    readWorkflowFile.mockResolvedValue(null);
    const set: { status?: number } = {};
    await expect(
      handleRevisePlan({
        params: { taskId: '1' },
        body: { instruction: '直して' },
        set,
        headers: UI,
      }),
    ).rejects.toThrow('plan.md does not exist');
    expect(set.status).toBe(404);
  });

  test('404s when the task does not exist', async () => {
    taskFindUnique.mockResolvedValue(null);
    const set: { status?: number } = {};
    await expect(
      handleRevisePlan({
        params: { taskId: '9' },
        body: { instruction: '直して' },
        set,
        headers: UI,
      }),
    ).rejects.toThrow('Task not found');
    expect(set.status).toBe(404);
  });
});
