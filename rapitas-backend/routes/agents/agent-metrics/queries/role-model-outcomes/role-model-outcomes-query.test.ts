/**
 * role-model-outcomes-query unit tests
 *
 * The database glue around the pure scoring: that cost is attributed per
 * execution rather than summed, that a task still in flight is not counted as
 * a clean pass, and that the window filters increments without discarding the
 * chain they belong to.
 *
 * These three are the ones worth a test. `AgentExecution.costUsd` holds the
 * CLI's session-cumulative total, so a plain sum overstated one task 5.59x
 * and produced two false budget halts; and counting an in-flight task as zero
 * bounces would make every task still in research evidence for whichever
 * model started it.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const execFindMany = mock(() => Promise.resolve([] as unknown[]));
const transitionFindMany = mock(() => Promise.resolve([] as unknown[]));
const taskFindMany = mock(() => Promise.resolve([] as unknown[]));

mock.module('../../../../../config/database', () => ({
  prisma: {
    agentExecution: { findMany: execFindMany },
    workflowTransition: { findMany: transitionFindMany },
    task: { findMany: taskFindMany },
  },
}));

const { getRoleModelOutcomes } = await import('./role-model-outcomes-query');

const HOUR = 60 * 60 * 1000;

/** One execution row in the shape the query selects. */
function row(args: {
  taskId: number;
  mode?: string | null;
  model?: string | null;
  costUsd?: number;
  session?: string | null;
  agoHours?: number;
  ms?: number | null;
}) {
  return {
    costUsd: args.costUsd ?? 1,
    claudeSessionId: args.session ?? null,
    startedAt: new Date(Date.now() - (args.agoHours ?? 1) * HOUR),
    modelName: args.model ?? 'claude-sonnet-5-5',
    executionTimeMs: args.ms ?? 1000,
    session: {
      mode: args.mode ?? 'workflow-implementer',
      config: { taskId: args.taskId },
    },
  };
}

/** Arms the three queries: window probe, full rows, transitions, tasks. */
function arm(opts: {
  rows: ReturnType<typeof row>[];
  transitions?: Array<{ taskId: number; cause: string }>;
  tasks?: Array<{ id: number; workflowStatus: string }>;
}) {
  const taskIds = [...new Set(opts.rows.map((r) => r.session.config.taskId))];
  execFindMany.mockReset();
  // First call is the in-window probe (task ids only), second the full rows.
  execFindMany
    .mockImplementationOnce(() =>
      Promise.resolve(taskIds.map((taskId) => ({ session: { config: { taskId } } }))),
    )
    .mockImplementationOnce(() => Promise.resolve(opts.rows));
  transitionFindMany.mockReset();
  transitionFindMany.mockImplementation(() => Promise.resolve(opts.transitions ?? []));
  taskFindMany.mockReset();
  taskFindMany.mockImplementation(() =>
    Promise.resolve(
      opts.tasks ?? taskIds.map((id) => ({ id, workflowStatus: 'completed' as string })),
    ),
  );
}

beforeEach(() => {
  execFindMany.mockReset();
  transitionFindMany.mockReset();
  taskFindMany.mockReset();
});

describe('what it counts as a bounce', () => {
  test('counts verify_repair and ci_repair, and nothing else', async () => {
    arm({
      rows: Array.from({ length: 10 }, (_, i) => row({ taskId: i + 1 })),
      transitions: [
        { taskId: 1, cause: 'verify_repair' },
        { taskId: 1, cause: 'ci_repair' },
        { taskId: 2, cause: 'auto_approve_plan' },
        { taskId: 2, cause: 'file_saved:verify' },
      ],
    });
    const out = await getRoleModelOutcomes({ days: 14 });
    const cell = out.roleModels[0];
    expect(cell.tasks).toBe(10);
    expect(cell.firstPassTasks).toBe(9);
    expect(cell.meanBounces).toBeCloseTo(0.2, 6);
  });
});

describe('tasks that have no outcome yet', () => {
  test('leaves a task that has not reached verification out of the scoring', async () => {
    arm({
      rows: [row({ taskId: 1 }), row({ taskId: 2 })],
      transitions: [{ taskId: 1, cause: 'file_saved:verify' }],
      tasks: [
        { id: 1, workflowStatus: 'verify_done' },
        { id: 2, workflowStatus: 'research_done' },
      ],
    });
    const out = await getRoleModelOutcomes({ days: 14 });
    expect(out.tasksScored).toBe(1);
    expect(out.tasksInFlight).toBe(1);
  });

  test('scores a completed task even with no transition rows left', async () => {
    // Transitions are prunable history; `completed` is the task's own state
    // and is enough to say the task finished without a repair bounce.
    arm({
      rows: [row({ taskId: 5 })],
      transitions: [],
      tasks: [{ id: 5, workflowStatus: 'completed' }],
    });
    const out = await getRoleModelOutcomes({ days: 14 });
    expect(out.tasksScored).toBe(1);
    expect(out.roleModels[0].firstPassTasks).toBe(1);
  });
});

describe('what each execution is charged', () => {
  test('charges the increment, not the session total, for a resumed chain', async () => {
    // Two rows of one session recording 2.00 then 5.00 is a session that has
    // spent 5.00, not 7.00.
    arm({
      rows: [
        row({ taskId: 1, costUsd: 2, session: 'sess-a', agoHours: 3 }),
        row({ taskId: 1, costUsd: 5, session: 'sess-a', agoHours: 2 }),
      ],
    });
    const out = await getRoleModelOutcomes({ days: 14 });
    expect(out.roleModels[0].costUsd).toBeCloseTo(5, 6);
  });

  test('sums rows that are each their own session', async () => {
    arm({
      rows: [
        row({ taskId: 1, costUsd: 2, session: 'sess-a' }),
        row({ taskId: 1, costUsd: 5, session: 'sess-b' }),
      ],
    });
    const out = await getRoleModelOutcomes({ days: 14 });
    expect(out.roleModels[0].costUsd).toBeCloseTo(7, 6);
  });

  test('leaves pre-window spend out while still walking its chain', async () => {
    // The window filters increments, not rows: counting the first in-window
    // row whole would drag the earlier spend of the same chain in with it.
    arm({
      rows: [
        row({ taskId: 1, costUsd: 4, session: 'sess-a', agoHours: 24 * 30 }),
        row({ taskId: 1, costUsd: 6, session: 'sess-a', agoHours: 2 }),
      ],
    });
    const out = await getRoleModelOutcomes({ days: 14 });
    expect(out.roleModels[0].costUsd).toBeCloseTo(2, 6);
    expect(out.roleModels[0].executions).toBe(1);
  });
});

describe('the combinations it reports', () => {
  test('pairs the implementer with the verifier of the same task', async () => {
    arm({
      rows: [
        row({ taskId: 1, mode: 'workflow-implementer', model: 'claude-sonnet-5-5' }),
        row({ taskId: 1, mode: 'workflow-verifier', model: 'claude-opus-5-5' }),
      ],
    });
    const out = await getRoleModelOutcomes({ days: 14 });
    expect(out.implementerVerifier).toHaveLength(1);
    expect(out.implementerVerifier[0].models).toEqual({
      implementer: 'claude-sonnet-5-5',
      verifier: 'claude-opus-5-5',
    });
  });

  test('says nothing at all when no execution is in the window', async () => {
    execFindMany.mockImplementation(() => Promise.resolve([]));
    const out = await getRoleModelOutcomes({ days: 14 });
    expect(out).toMatchObject({ tasksScored: 0, roleModels: [], implementerVerifier: [] });
  });
});
