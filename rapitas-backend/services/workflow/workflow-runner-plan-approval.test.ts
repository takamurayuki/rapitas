/**
 * workflow-runner-plan-approval.test
 *
 * The runner's plan_created step against concurrent writers (task 1593). The
 * critic gate, critic lenses, in-flight registry and execution lock are real;
 * only the AI client and the database are doubles.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

let workflowStatus = 'plan_created';
let autoApprove = true;
const updateMany = mock(
  async (args: { where: { workflowStatus?: string }; data: { workflowStatus: string } }) => {
    if (args.where.workflowStatus !== workflowStatus) return { count: 0 };
    workflowStatus = args.data.workflowStatus;
    return { count: 1 };
  },
);
const prisma = {
  task: {
    updateMany,
    findUnique: async () => ({ title: 't', description: 'd', acceptanceCriteria: null }),
  },
  workflowTransition: { count: async () => 0, findFirst: async () => null },
  workflowFile: { findFirst: async () => null },
};
const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

mock.module('../../config', () => ({ prisma }));
mock.module('../../config/database', () => ({
  prisma,
  ensureDatabaseConnection: () => Promise.resolve(),
}));
mock.module('../../config/logger', () => ({ createLogger: () => noop, logger: noop }));
mock.module('./workflow-runner-item-helpers', () => ({
  shouldAutoApprovePlan: async () => autoApprove,
}));
let lensReply = async () => '{"pass":false,"severity":20,"issues":["軽い指摘"]}';
let lensCalls = 0;
mock.module('../../utils/ai-client', () => ({
  sendAIMessage: async () => {
    // One minor failing lens, two passing: a pass that carries a reason.
    const content =
      lensCalls++ === 0 ? await lensReply() : '{"pass":true,"severity":0,"issues":[]}';
    return { content };
  },
  getDefaultProvider: async () => 'anthropic',
  getDefaultModel: async () => 'critic-model',
  isAnyApiKeyConfigured: async () => true,
}));
mock.module('../../utils/ai-client/aux-ai-mode', () => ({ getAuxAiMode: () => 'api' }));
mock.module('./transition-recorder', () => ({ recordTransition: async () => {} }));
mock.module('./workflow-file-utils', () => ({ archiveWorkflowFile: async () => true }));
mock.module('./workflow-redispatch', () => ({
  REDISPATCH_DELAY_MS: 1000,
  scheduleWorkflowRedispatch: () => {},
}));

const { settlePlanCreated } = await import('./workflow-runner-plan-approval');
const { applyPhaseCriticGate } = await import('./phase-critic/phase-critic-gate');
const { reserveCritique } = await import('./phase-critic/critic-inflight');
const { acquireTaskExecutionLock, releaseTaskExecutionLock } =
  await import('../agents/task-execution-lock');

const updateStatus = mock(async (..._args: unknown[]) => null);
const broadcast = mock((..._args: unknown[]) => {});
const step = (taskId: number) => settlePlanCreated({ updateStatus }, { id: 1, taskId }, broadcast);
const flush = () => new Promise((resolve) => setTimeout(resolve, 20));

beforeEach(() => {
  workflowStatus = 'plan_created';
  autoApprove = true;
  lensCalls = 0;
  updateMany.mockClear();
  updateStatus.mockClear();
  broadcast.mockClear();
});

describe('settlePlanCreated', () => {
  test('does not approve while the critique runs; the late findings bounce the plan', async () => {
    let answer!: () => void;
    const held = new Promise<void>((resolve) => (answer = resolve));
    lensReply = async () => {
      await held;
      return '{"pass":false,"severity":20,"issues":["軽い指摘"]}';
    };
    const gate = applyPhaseCriticGate({
      taskId: 1,
      phase: 'plan',
      content: 'a'.repeat(45_000),
      currentStatus: 'plan_created',
    });
    let outcome: string | undefined;
    const running = step(1).then((o) => (outcome = o));
    await flush();
    expect(outcome).toBeUndefined();
    expect(updateMany).not.toHaveBeenCalled();

    answer();
    expect((await gate).bounced).toBe(true);
    await running;
    expect(outcome).toBe('continue');
    expect(workflowStatus).toBe('research_done');
    expect(broadcast).not.toHaveBeenCalled();
  });

  test('writes nothing right after waiting, so the loop can re-check stop and ownership', async () => {
    const release = reserveCritique(2);
    const running = step(2);
    await flush();
    release();
    expect(await running).toBe('continue');
    expect(updateMany).not.toHaveBeenCalled();
  });

  test('approves with a compare-and-swap on plan_created', async () => {
    expect(await step(3)).toBe('continue');
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 3, workflowStatus: 'plan_created' },
      data: { workflowStatus: 'plan_approved', status: 'in-progress' },
    });
    expect(broadcast).toHaveBeenCalledWith(1, 3, 'phase_completed', 'plan_created');
  });

  test('does not overwrite a status that moved after it was read', async () => {
    workflowStatus = 'research_done';
    expect(await step(4)).toBe('continue');
    expect(workflowStatus).toBe('research_done');
    expect(broadcast).not.toHaveBeenCalled();
  });

  test('re-queues while the task execution lock is held', async () => {
    acquireTaskExecutionLock(5);
    try {
      expect(await step(5)).toBe('break');
    } finally {
      releaseTaskExecutionLock(5);
    }
    expect(updateMany).not.toHaveBeenCalled();
    expect(updateStatus).toHaveBeenCalledWith(1, 'queued', { currentPhase: 'plan_created' });
    expect(broadcast).toHaveBeenCalledWith(1, 5, 'execution_requeued', 'plan_created');
  });

  test('waits for manual approval when auto-approval is off', async () => {
    autoApprove = false;
    expect(await step(6)).toBe('break');
    expect(updateStatus).toHaveBeenCalledWith(1, 'waiting_approval', {
      currentPhase: 'plan_created',
    });
    expect(updateMany).not.toHaveBeenCalled();
  });
});
