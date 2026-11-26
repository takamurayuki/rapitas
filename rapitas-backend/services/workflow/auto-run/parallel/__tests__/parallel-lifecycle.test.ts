/**
 * parallel-lifecycle.test
 *
 * Task 1552 acceptance 4: with two tasks running in one theme (head A=10,
 * companion B=20), a stop / approval wait / block / halt of ONE task frees only
 * that task, and the theme stop still stops every task. Driven through the real
 * scheduler with the shared scheduler test harness; the ThemeAutoRun row is an
 * in-memory table so slot writes are observable.
 *
 * Run on its own: bun's mock.module is process-global.
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import {
  ThemeAutoRunScheduler,
  internal,
  makeState,
  resetSchedulerSingleton,
  resetAllMocks,
  mockGetThemeActiveQueueItems,
  mockQueueItemFindFirst,
  mockQueueItemUpdateMany,
  mockResolveTaskWorkflowState,
  mockThemeAutoRunUpdateMany,
  mockSetCurrentTask,
  mockOnTaskCompleted,
  mockOnTaskFailed,
  mockOnAwaitingPlanApproval,
  mockNotifyAwaitingPlanApproval,
  mockStopThemeAgents,
  mockStopTaskTreeAgents,
  mockFinalizeStop,
  mockResolveIterationBudgetForTask,
  mockUserSettingsFindFirst,
  mockSelectNextTask,
  mockEnqueue,
  mockTaskFindUnique,
} from '../../theme-auto-run-scheduler.test-support';
import { fakeThemeAutoRun, runningRow, type FakeRow } from './fake-theme-auto-run.test-support';

// Dynamic: a static import is linked before the harness registers its config mock.
const { prisma } = await import('../../../../../config');
const { parseCompanions } = await import('../companion-json');
const { __resetCompanionApprovalHoldsForTests } = await import('../companion-approval-hold');

const A = 10;
/** B joined just now — inside the harness hang-backstop wall (TEST_MAX_TASK_WALL_MS = 1 s). */
let SINCE_B = Date.now();
const B = 20;
let rows: FakeRow[];
let scheduler: ThemeAutoRunScheduler;
type Task = { id: number; status: string; workflowStatus: string | null };
let taskState: Record<number, Task>;
let terminalItem: Record<
  number,
  { id: number; status: string; errorMessage: string | null } | null
>;

const companionsJson = () => rows[0]!.companionTasksJson;
const tick = () =>
  internal(scheduler).advanceTheme(
    1,
    rows[0]!.currentTaskId,
    'priority',
    1,
    new Date().toISOString(),
    companionsJson(),
  );

beforeEach(() => {
  resetAllMocks();
  SINCE_B = Date.now();
  __resetCompanionApprovalHoldsForTests();
  mockStopTaskTreeAgents.mockClear();
  resetSchedulerSingleton();
  scheduler = ThemeAutoRunScheduler.getInstance();
  rows = [
    runningRow({ currentTaskId: A, companionTasksJson: `[{"taskId":${B},"since":${SINCE_B}}]` }),
  ];
  const fake = fakeThemeAutoRun(rows);
  const model = (prisma as unknown as { themeAutoRun: Record<string, unknown> }).themeAutoRun;
  model.findFirst = fake.model.findFirst;
  model.findMany = fake.model.findMany;
  mockThemeAutoRunUpdateMany.mockImplementation(fake.model.updateMany as never);
  mockUserSettingsFindFirst.mockResolvedValue({
    autoRunMaxConcurrency: 2,
    autoRunMaxConcurrencyPerTheme: 2,
  } as never);
  taskState = {
    [A]: { id: A, status: 'in-progress', workflowStatus: 'in_progress' },
    [B]: { id: B, status: 'in-progress', workflowStatus: 'in_progress' },
  };
  (prisma.task as unknown as { findMany: (args: unknown) => Promise<unknown> }).findMany = async (
    args: unknown,
  ) => {
    const ids = (args as { where?: { id?: { in?: number[] } } }).where?.id?.in;
    return ids ? Object.values(taskState).filter((t) => ids.includes(t.id)) : [];
  };
  terminalItem = { [A]: null, [B]: null };
  mockResolveTaskWorkflowState.mockImplementation((async (id: number) => ({
    ...taskState[id],
    workflowMode: null,
    parentId: null,
  })) as never);
  mockQueueItemFindFirst.mockImplementation((async (args: { where: { taskId?: number } }) =>
    args.where.taskId != null ? (terminalItem[args.where.taskId] ?? null) : null) as never);
  // Both tasks are in flight unless a test says otherwise.
  mockGetThemeActiveQueueItems.mockResolvedValue([
    { id: 1, taskId: A, status: 'running' },
    { id: 2, taskId: B, status: 'running' },
  ]);
  mockSelectNextTask.mockResolvedValue({ found: false, reason: 'parallel_conflict' } as never);
});

describe('one of two running tasks', () => {
  it('同伴が解放された後に遅れて届く停止でも先頭Aを止めない', async () => {
    rows[0]!.companionTasksJson = null;
    const { stopAutoRunTaskOrTheme } = await import('../per-task-stop');
    await stopAutoRunTaskOrTheme(prisma, 1, B);
    expect(mockStopThemeAgents).not.toHaveBeenCalled();
    expect(mockStopTaskTreeAgents).toHaveBeenCalledWith(B);
    expect(rows[0]!.currentTaskId).toBe(A);
  });
  it('承認判定中に同伴Bが解放されてもAを一時停止しない', async () => {
    mockGetThemeActiveQueueItems.mockResolvedValue([
      { id: 2, taskId: B, status: 'waiting_approval' },
    ]);
    mockTaskFindUnique.mockImplementation((async () => {
      rows[0]!.companionTasksJson = null;
      return { workflowStatus: 'plan_created' };
    }) as never);
    const { advanceActiveTask } = await import('../../auto-run-advance-active');
    await advanceActiveTask(prisma, 1, B, 'priority', 1, new Date().toISOString(), new Map());
    expect(mockOnAwaitingPlanApproval).not.toHaveBeenCalled();
    expect(rows[0]!.currentTaskId).toBe(A);
  });
  it.each(['done', 'blocked', 'cancelled'])(
    'F2: 上限を1へ下げた後の%sでも生存中のBを上書きしない',
    async (status) => {
      mockUserSettingsFindFirst.mockResolvedValue({
        autoRunMaxConcurrency: 2,
        autoRunMaxConcurrencyPerTheme: 1,
      } as never);
      taskState[A] = {
        id: A,
        status,
        workflowStatus: status === 'done' ? 'completed' : 'in_progress',
      };
      terminalItem[A] = {
        id: 1,
        status: status === 'done' ? 'completed' : status === 'blocked' ? 'failed' : 'cancelled',
        errorMessage: '停止',
      };
      mockGetThemeActiveQueueItems.mockResolvedValue([{ id: 2, taskId: B, status: 'running' }]);
      mockSelectNextTask.mockResolvedValue({ found: true, taskId: 30 } as never);
      await tick();
      expect(mockEnqueue).not.toHaveBeenCalled();
      expect(rows[0]!.currentTaskId).toBe(B);
    },
  );
  it('上限1で先頭不在を補正しても同伴を新候補で上書きしない', async () => {
    rows[0]!.currentTaskId = null;
    mockUserSettingsFindFirst.mockResolvedValue({
      autoRunMaxConcurrency: 2,
      autoRunMaxConcurrencyPerTheme: 1,
    } as never);
    mockSelectNextTask.mockResolvedValue({ found: true, taskId: 30 } as never);
    await tick();
    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(rows[0]!.currentTaskId).toBe(B);
  });
  it('テーマの明示的一時停止は全件の進行を止め、枠を消さない', async () => {
    await internal(scheduler).processPausedThemes([
      makeState({
        themeId: 1,
        currentTaskId: A,
        companionTasksJson: companionsJson(),
        status: 'paused_user',
      }),
    ]);
    expect(mockResolveTaskWorkflowState).not.toHaveBeenCalled();
    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(rows[0]!.currentTaskId).toBe(A);
    expect(parseCompanions(companionsJson()).map((c) => c.taskId)).toEqual([B]);
  });

  it('F3: 他テーマの2枠がフェーズ間でも先頭を追加しない', async () => {
    rows[0]!.currentTaskId = null;
    rows[0]!.companionTasksJson = null;
    rows.push(
      runningRow({
        themeId: 2,
        currentTaskId: 40,
        companionTasksJson: '[{"taskId":50,"since":1}]',
      }),
    );
    mockSelectNextTask.mockResolvedValue({ found: true, taskId: 30 } as never);
    await internal(scheduler).advanceTheme(1, null, 'priority', 0, null);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });
  it('(1) B stopped by the user (cancelled) → only B leaves; no theme-wide stop', async () => {
    taskState[B] = { id: B, status: 'cancelled', workflowStatus: null };
    terminalItem[B] = { id: 2, status: 'cancelled', errorMessage: null };
    mockGetThemeActiveQueueItems.mockResolvedValue([{ id: 1, taskId: A, status: 'running' }]);
    await tick();
    expect(rows[0]!.currentTaskId).toBe(A);
    expect(companionsJson()).toBeNull();
    expect(mockStopThemeAgents).not.toHaveBeenCalled();
    expect(mockSetCurrentTask).not.toHaveBeenCalled();
  });

  it('(2) the theme stop stops every task and clears the companions', async () => {
    await internal(scheduler).processStoppingThemes([
      makeState({
        themeId: 1,
        status: 'stopping',
        currentTaskId: A,
        companionTasksJson: companionsJson(),
      }),
    ]);
    expect(mockQueueItemUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { themeId: 1, status: { in: ['queued', 'running', 'waiting_approval'] } },
      }),
    );
    expect(mockStopThemeAgents).toHaveBeenCalledTimes(1);
    expect(mockFinalizeStop).toHaveBeenCalledWith(1);
    expect(companionsJson()).toBeNull();
  });

  it('(3) B waits for plan approval → the theme stays running and A keeps going', async () => {
    mockGetThemeActiveQueueItems.mockResolvedValue([
      { id: 1, taskId: A, status: 'running' },
      { id: 2, taskId: B, status: 'waiting_approval' },
    ]);
    await tick();
    await tick(); // re-evaluated every tick: notified once only
    expect(mockOnAwaitingPlanApproval).not.toHaveBeenCalled();
    expect(mockNotifyAwaitingPlanApproval).toHaveBeenCalledTimes(1);
    expect(mockNotifyAwaitingPlanApproval).toHaveBeenCalledWith(1, B);
    expect(rows[0]!.status).toBe('running');
    expect(rows[0]!.currentTaskId).toBe(A);
    expect(parseCompanions(companionsJson()).map((c) => c.taskId)).toEqual([B]);
  });

  it('(4) B ends blocked → only B is released; A stays head', async () => {
    taskState[B] = { id: B, status: 'blocked', workflowStatus: 'in_progress' };
    terminalItem[B] = { id: 2, status: 'failed', errorMessage: 'verify failed' };
    mockGetThemeActiveQueueItems.mockResolvedValue([{ id: 1, taskId: A, status: 'running' }]);
    await tick();
    expect(rows[0]!.currentTaskId).toBe(A);
    expect(companionsJson()).toBeNull();
    expect(rows[0]!.lastError).toBe('verify failed');
    expect(mockOnTaskFailed).not.toHaveBeenCalled();
  });

  it('(5) B exceeds its iteration budget → only B tree is stopped', async () => {
    mockResolveIterationBudgetForTask.mockImplementation((async (id: number) =>
      id === B
        ? { shouldHalt: true, haltReason: 'cost', resumeCondition: null, diagnostics: {} }
        : { shouldHalt: false }) as never);
    await tick();
    expect(mockStopTaskTreeAgents).toHaveBeenCalledWith(B);
    expect(mockStopThemeAgents).not.toHaveBeenCalled();
    expect(mockQueueItemUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ themeId: 1, taskId: B }) }),
    );
    expect(rows[0]!.currentTaskId).toBe(A);
    expect(companionsJson()).toBeNull();
  });

  it('(6) A completes → B becomes head with its tenure, its queue item untouched', async () => {
    taskState[A] = { id: A, status: 'done', workflowStatus: 'completed' };
    terminalItem[A] = { id: 1, status: 'completed', errorMessage: null };
    mockGetThemeActiveQueueItems.mockResolvedValue([{ id: 2, taskId: B, status: 'running' }]);
    await tick();
    expect(rows[0]!.currentTaskId).toBe(B);
    expect(rows[0]!.lastRunAt).toEqual(new Date(SINCE_B));
    expect(companionsJson()).toBeNull();
    expect(rows[0]!.processedCount).toBe(1);
    expect(mockOnTaskCompleted).not.toHaveBeenCalled();
    expect(mockQueueItemUpdateMany).not.toHaveBeenCalled(); // B's item is left alone
    expect(mockEnqueue).not.toHaveBeenCalledWith(expect.objectContaining({ taskId: B }));
  });
});

describe('per-theme limit 1 — one at a time as before', () => {
  it('a completion with no companions uses the pre-task write and head selection', async () => {
    rows[0]!.companionTasksJson = null;
    mockUserSettingsFindFirst.mockResolvedValue({ autoRunMaxConcurrency: 2 } as never);
    taskState[A] = { id: A, status: 'done', workflowStatus: 'completed' };
    terminalItem[A] = { id: 1, status: 'completed', errorMessage: null };
    mockGetThemeActiveQueueItems.mockResolvedValue([]);
    mockSelectNextTask.mockResolvedValue({ found: false, reason: 'all_done' } as never);
    await tick();
    expect(rows[0]!.processedCount).toBe(1);
    expect(rows[0]!.currentTaskId).toBeNull();
    expect(mockSelectNextTask).toHaveBeenCalledTimes(1); // head selection, not companion
  });
});
