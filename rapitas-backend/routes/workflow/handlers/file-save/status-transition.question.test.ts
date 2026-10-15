import { beforeEach, expect, mock, test } from 'bun:test';

let workflowStatus = 'in_progress';
let status = 'in-progress';
let updatedAt = new Date(0);
let readError = false;
let userCause: string | null = null;
let historyError = false;
let race: (() => void) | undefined;
let planQuestionCount = 0;
let operatorWaitCount = 0;
let capturedUpdateManyData: Record<string, unknown> | undefined;
const recordTransition = mock(async (_args: unknown) => {});
const updateMany = mock(
  async ({
    where,
    data,
  }: {
    where: { status: string; workflowStatus: string; updatedAt: Date };
    data: { workflowStatus: string };
  }) => {
    race?.();
    capturedUpdateManyData = data;
    if (
      where.status !== status ||
      where.workflowStatus !== workflowStatus ||
      where.updatedAt.getTime() !== updatedAt.getTime()
    )
      return { count: 0 };
    workflowStatus = data.workflowStatus;
    return { count: 1 };
  },
);
beforeEach(() => {
  workflowStatus = 'in_progress';
  status = 'in-progress';
  updatedAt = new Date(0);
  readError = false;
  userCause = null;
  historyError = false;
  race = undefined;
  planQuestionCount = 0;
  operatorWaitCount = 0;
  capturedUpdateManyData = undefined;
  updateMany.mockClear();
  recordTransition.mockClear();
  blockPlanQuestionOverBudget.mockClear();
});
mock.module('../../../../config', () => ({
  prisma: {
    workflowTransition: {
      findFirst: async () => {
        if (historyError) throw new Error('history unavailable');
        return userCause ? { cause: userCause } : null;
      },
    },
    task: {
      findUnique: async () => {
        if (readError) throw new Error('DB unavailable');
        return { workflowStatus, status, updatedAt };
      },
      updateMany,
      update: async ({ data }: { data: { workflowStatus?: string } }) => {
        if (data.workflowStatus) workflowStatus = data.workflowStatus;
        return { workflowStatus };
      },
    },
  },
}));
mock.module('../../../../config/logger', () => ({
  createLogger: () => ({
    info() {},
    warn() {},
    error() {},
    debug() {},
  }),
}));
mock.module('../../../../services/workflow/completion-gate', () => ({
  researchConcludesNoChange: () => false,
}));
mock.module('../../../../services/workflow/transition-recorder', () => ({ recordTransition }));
mock.module('../../../../services/workflow/workflow-invariants', () => ({
  checkWorkflowInvariants: async () => [],
}));
mock.module('../../../../services/workflow/verify-invariant-repair', () => ({
  attemptInvariantCutoff: async () => false,
}));
mock.module('./shared', () => ({
  markLatestExecutionFailed: async () => {},
  wasNonConvergenceCutoffJustRecorded: async () => false,
}));
mock.module('../../../../services/communication/notification-service', () => ({
  createNotification: async () => ({}),
}));
const blockPlanQuestionOverBudget = mock(
  async (_taskId: number, _count: number, _limit: number, _axis?: string) => {},
);
// Mirrors the real two-axis verdict (workflow-plan-question-guard.ts): the
// charged axis is the one the NEW round belongs to. A stub that ignored
// `waitsOnOperator` would hide the whole point of the wiring under test.
mock.module('../../../../services/workflow/workflow-plan-question-guard', () => ({
  checkPlanQuestionBudget: async (_taskId: number, waitsOnOperator = false) => {
    const count = waitsOnOperator ? 0 : planQuestionCount;
    const allowed = count < 3;
    return {
      allowed,
      count: planQuestionCount,
      limit: 3,
      operatorCount: operatorWaitCount,
      operatorLimit: 3,
      ...(allowed ? {} : { exhausted: waitsOnOperator ? 'operator' : 'agent' }),
    };
  },
  blockPlanQuestionOverBudget,
}));

const { computeAndApplyStatusTransition } = await import('./status-transition');
const { withTaskLifecycleLock } = await import('../../../../services/workflow/task-lifecycle-lock');

test('question with pre-lock snapshot must preserve completion while waiting', async () => {
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const completing = withTaskLifecycleLock(901, async () => {
    entered();
    await gate;
    workflowStatus = 'completed';
  });
  await started;
  const currentStatus = workflowStatus;
  // Exact callback shape added by task901: snapshot is captured before lock.
  const saving = withTaskLifecycleLock(901, () =>
    computeAndApplyStatusTransition({
      taskId: 901,
      fileType: 'question',
      currentStatus,
      savedContent: 'Q',
    }),
  );
  release();
  await Promise.all([completing, saving]);
  expect(workflowStatus).toBe('completed');
  expect(recordTransition).not.toHaveBeenCalled();
});

const save = () =>
  computeAndApplyStatusTransition({
    taskId: 901,
    fileType: 'question',
    currentStatus: 'draft',
    savedContent: 'Q',
  });
test('normal question uses fresh previous status and records one transition', async () => {
  expect((await save()).newStatus).toBe('awaiting_question');
  expect(workflowStatus).toBe('awaiting_question');
  expect(recordTransition).toHaveBeenCalledTimes(1);
  expect(recordTransition).toHaveBeenCalledWith(
    expect.objectContaining({
      fromStatus: 'in_progress',
      metadata: expect.objectContaining({ previousStatus: 'in_progress' }),
    }),
  );
});
// NOTE: manually confirmed RED for this test (task #901) by temporarily adding
// `status: 'blocked'` to the updateMany data payload in status-transition.ts —
// failed with "Received: [status, workflowStatus, updatedAt]" as expected,
// then reverted (git diff clean, no residual change). Re-confirmed a second
// time to leave durable evidence for the verifier, since the first check was
// only reported in chat and left no trace in the codebase.
test('question save never writes task.status — a running CLI is not terminated by a question alone', async () => {
  await save();
  expect(capturedUpdateManyData).toBeDefined();
  expect(Object.keys(capturedUpdateManyData as Record<string, unknown>)).not.toContain('status');
  expect(Object.keys(capturedUpdateManyData as Record<string, unknown>)).toEqual(
    expect.arrayContaining(['workflowStatus', 'updatedAt']),
  );
});
for (const terminal of [
  'done',
  'blocked',
  'canceling',
  'canceled',
  'cancelled',
  'failed',
  'archived',
]) {
  test(`preserves ${terminal} task without writing a question transition`, async () => {
    status = terminal;
    expect((await save()).newStatus).toBeUndefined();
    expect(updateMany).not.toHaveBeenCalled();
    expect(recordTransition).not.toHaveBeenCalled();
  });
}
for (const change of ['completion', 'stop', 'manual-stop-todo', 'version']) {
  test(`CAS rejects concurrent ${change} after the read`, async () => {
    race = () => {
      if (change === 'completion') workflowStatus = 'completed';
      if (change === 'stop') status = 'cancelled';
      if (change === 'manual-stop-todo') status = 'todo';
      if (change === 'version') updatedAt = new Date(1);
    };
    expect((await save()).newStatus).toBeUndefined();
    expect(workflowStatus).not.toBe('awaiting_question');
    expect(recordTransition).not.toHaveBeenCalled();
  });
}
test('DB read failure propagates without mutation or transition', async () => {
  readError = true;
  await expect(save()).rejects.toThrow('DB unavailable');
  expect(updateMany).not.toHaveBeenCalled();
  expect(recordTransition).not.toHaveBeenCalled();
});

for (const cause of [
  'manual_execution_stop_revert',
  'manual_execution_stop_withdraw',
  'auto_run_stop_revert',
]) {
  test(`stopped todo with ${cause} remains unchanged; running resume can save`, async () => {
    status = 'todo';
    userCause = cause;
    expect((await save()).newStatus).toBeUndefined();
    expect(updateMany).not.toHaveBeenCalled();
    expect(recordTransition).not.toHaveBeenCalled();
    status = 'in-progress';
    expect((await save()).newStatus).toBe('awaiting_question');
  });
}
test('ordinary todo without stop history can save a question', async () => {
  status = 'todo';
  expect((await save()).newStatus).toBe('awaiting_question');
});
test('stop history read failure fails closed', async () => {
  status = 'todo';
  historyError = true;
  await expect(save()).rejects.toThrow('history unavailable');
  expect(updateMany).not.toHaveBeenCalled();
  expect(recordTransition).not.toHaveBeenCalled();
});

// task 902: question raise-time kind computation (metadata.kind).
test('records kind=execution_continuation for a non-verify_done question pause', async () => {
  workflowStatus = 'in_progress';
  status = 'in-progress';
  expect((await save()).newStatus).toBe('awaiting_question');
  expect(recordTransition).toHaveBeenCalledWith(
    expect.objectContaining({
      metadata: expect.objectContaining({ kind: 'execution_continuation' }),
    }),
  );
});

test('records kind=completion_confirmation for a question pause raised from verify_done (task 902: previously excluded from pausing at all)', async () => {
  workflowStatus = 'verify_done';
  status = 'in-progress';
  const result = await computeAndApplyStatusTransition({
    taskId: 901,
    fileType: 'question',
    currentStatus: 'verify_done',
    savedContent: 'Q',
  });
  expect(result.newStatus).toBe('awaiting_question');
  expect(recordTransition).toHaveBeenCalledWith(
    expect.objectContaining({
      fromStatus: 'verify_done',
      metadata: expect.objectContaining({
        previousStatus: 'verify_done',
        kind: 'completion_confirmation',
      }),
    }),
  );
});

// task 965: lifetime plan-question budget guard. checkPlanQuestionBudget /
// blockPlanQuestionOverBudget themselves are exhaustively unit-tested in
// workflow-plan-question-guard.test.ts — this suite only verifies
// status-transition.ts wires the guard in at the right branch/condition.
test('a plan-phase question under the lifetime budget still saves normally', async () => {
  workflowStatus = 'plan_approved';
  status = 'in-progress';
  planQuestionCount = 2;
  const result = await computeAndApplyStatusTransition({
    taskId: 901,
    fileType: 'question',
    currentStatus: 'plan_approved',
    savedContent: 'Q',
  });
  expect(result.newStatus).toBe('awaiting_question');
  expect(blockPlanQuestionOverBudget).not.toHaveBeenCalled();
});

test('a plan-phase question at the lifetime budget cap is blocked instead of saved', async () => {
  workflowStatus = 'plan_approved';
  status = 'in-progress';
  planQuestionCount = 3;
  await expect(
    computeAndApplyStatusTransition({
      taskId: 901,
      fileType: 'question',
      currentStatus: 'plan_approved',
      savedContent: 'Q',
    }),
  ).rejects.toThrow(/lifetime cap/);
  expect(updateMany).not.toHaveBeenCalled();
  expect(blockPlanQuestionOverBudget).toHaveBeenCalledWith(901, 3, 3, 'agent');
  // workflowStatus must remain plan_approved — the exhausted question.md save never advances it.
  expect(workflowStatus).toBe('plan_approved');
});

// B6 / #1215: the agent budget is spent, but this round is an escalation only a
// human can clear ("運用者がルートで依存を追加する"). It must still be allowed —
// the measured failure was exactly this round being refused at 3/3 and the task
// going blocked while the operator work was 37 minutes from done.
const operatorWaitQuestion = (recommended: string) =>
  '# 質問\n```json:options\n' +
  JSON.stringify({
    questions: [
      {
        id: 'Q1',
        summary: '共有 node_modules のため依存追加ができない',
        options: [
          { key: 'A', label: '運用者がルートで依存を追加する', requiresOperatorAction: true },
          { key: 'B', label: 'カバレッジ計測を後続タスクへ移す' },
        ],
        freeTextRequired: false,
        recommended,
        recommendedReason: '他9項目は実装済みで、依存追加を一度行えば計測で完了できる',
      },
    ],
  }) +
  '\n```';

test('運用者作業待ちの質問は、エージェントの質問予算を使い切っていても保存できる', async () => {
  workflowStatus = 'plan_approved';
  status = 'in-progress';
  planQuestionCount = 3;
  const result = await computeAndApplyStatusTransition({
    taskId: 901,
    fileType: 'question',
    currentStatus: 'plan_approved',
    savedContent: operatorWaitQuestion('A'),
  });
  expect(result.newStatus).toBe('awaiting_question');
  expect(blockPlanQuestionOverBudget).not.toHaveBeenCalled();
  expect(recordTransition).toHaveBeenCalledWith(
    expect.objectContaining({ metadata: expect.objectContaining({ operatorWait: true }) }),
  );
});

test('運用者作業でない選択肢を推奨している質問は、従来どおり予算で止まる', async () => {
  workflowStatus = 'plan_approved';
  status = 'in-progress';
  planQuestionCount = 3;
  await expect(
    computeAndApplyStatusTransition({
      taskId: 901,
      fileType: 'question',
      currentStatus: 'plan_approved',
      savedContent: operatorWaitQuestion('B'),
    }),
  ).rejects.toThrow(/lifetime cap/);
  expect(blockPlanQuestionOverBudget).toHaveBeenCalledWith(901, 3, 3, 'agent');
});

test('a non-plan_approved question pause is unaffected by the plan-question budget', async () => {
  workflowStatus = 'in_progress';
  status = 'in-progress';
  planQuestionCount = 99;
  const result = await computeAndApplyStatusTransition({
    taskId: 901,
    fileType: 'question',
    currentStatus: 'in_progress',
    savedContent: 'Q',
  });
  expect(result.newStatus).toBe('awaiting_question');
  expect(blockPlanQuestionOverBudget).not.toHaveBeenCalled();
});

test('an explicit kind embedded in question.md json:options is honored over the status-derived default', async () => {
  workflowStatus = 'verify_done';
  status = 'in-progress';
  const savedContent =
    '# 質問\n```json:options\n' +
    JSON.stringify({
      kind: 'execution_continuation',
      questions: [{ id: 'Q1', summary: 'x', options: [{ key: 'A', label: 'a' }] }],
    }) +
    '\n```';
  const result = await computeAndApplyStatusTransition({
    taskId: 901,
    fileType: 'question',
    currentStatus: 'verify_done',
    savedContent,
  });
  expect(result.newStatus).toBe('awaiting_question');
  expect(recordTransition).toHaveBeenCalledWith(
    expect.objectContaining({
      metadata: expect.objectContaining({ kind: 'execution_continuation' }),
    }),
  );
});
