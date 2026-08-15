/**
 * theme-auto-run-scheduler.advance-active.test
 *
 * Covers advanceTheme() when a currentTaskId is already tracked: the hang
 * backstop, in-flight queue items (incl. the plan-approval pause), the
 * completed/failed terminal-item resolution, the "awaiting a user answer"
 * hold, and the vanished-queue-item re-enqueue recovery path.
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import {
  ThemeAutoRunScheduler,
  internal,
  resetSchedulerSingleton,
  resetAllMocks,
  TEST_MAX_TASK_WALL_MS,
  mockIsAwaitingUserAnswer,
  mockHasLiveExecution,
  mockResolveLastProgressAt,
  mockNotifyAwaitingUserAnswer,
  mockNotifyHangBackstop,
  mockTaskUpdate,
  mockOnTaskFailed,
  mockOnTaskCompleted,
  mockOnAwaitingPlanApproval,
  mockNotifyAwaitingPlanApproval,
  mockNotifyTaskSkipped,
  mockGetThemeActiveQueueItems,
  mockQueueItemFindFirst,
  mockResolveTaskWorkflowState,
  mockEnqueue,
  mockSetCurrentTask,
  mockBroadcast,
} from './theme-auto-run-scheduler.test-support';

let scheduler: ThemeAutoRunScheduler;

/** ISO timestamp old enough to trip the hang backstop (MAX_TASK_WALL_MS + margin). */
function staleLastRunAt(): string {
  return new Date(Date.now() - TEST_MAX_TASK_WALL_MS - 500).toISOString();
}

/** ISO timestamp fresh enough to stay under the hang backstop. */
function freshLastRunAt(): string {
  return new Date().toISOString();
}

beforeEach(() => {
  resetAllMocks();
  resetSchedulerSingleton();
  scheduler = ThemeAutoRunScheduler.getInstance();
  // Default: no active queue item and no terminal item, so tests that only
  // care about the hang backstop don't fall through into the vanished-item
  // re-enqueue path.
  mockGetThemeActiveQueueItems.mockResolvedValue([]);
});

describe('advanceTheme — hang backstop', () => {
  it('holds (does not stop) a wedged task that is awaiting a user answer', async () => {
    mockIsAwaitingUserAnswer.mockResolvedValue(true);

    await internal(scheduler).advanceTheme(1, 100, 'priority', 0, staleLastRunAt());

    expect(mockNotifyAwaitingUserAnswer).toHaveBeenCalledWith(1, 100);
    expect(mockTaskUpdate).not.toHaveBeenCalled();
    expect(mockOnTaskFailed).not.toHaveBeenCalled();
  });

  it('force-stops and blocks a genuinely wedged task, then advances past it', async () => {
    mockIsAwaitingUserAnswer.mockResolvedValue(false);

    await internal(scheduler).advanceTheme(1, 100, 'priority', 1, staleLastRunAt());

    expect(mockNotifyHangBackstop).toHaveBeenCalledWith(1, 100, expect.any(Number));
    expect(mockTaskUpdate).toHaveBeenCalledWith({
      where: { id: 100 },
      data: { status: 'blocked' },
    });
    expect(mockOnTaskFailed).toHaveBeenCalledWith(1, expect.stringContaining('100'));
    // Recurses with currentTaskId=null and globalActive decremented by 1.
    expect(mockBroadcast).toHaveBeenCalled();
  });

  it('defers the backstop while a live (fresh-heartbeat) execution is running — slow ≠ wedged (task 563)', async () => {
    mockIsAwaitingUserAnswer.mockResolvedValue(false);
    mockHasLiveExecution.mockResolvedValue(true);
    // In-flight queue item so the fall-through path waits instead of re-enqueuing.
    mockGetThemeActiveQueueItems.mockResolvedValue([{ id: 1, taskId: 100, status: 'running' }]);

    await internal(scheduler).advanceTheme(1, 100, 'priority', 1, staleLastRunAt());

    expect(mockNotifyHangBackstop).not.toHaveBeenCalled();
    expect(mockTaskUpdate).not.toHaveBeenCalled();
    expect(mockOnTaskFailed).not.toHaveBeenCalled();
  });

  it('still force-stops past the 3x hard ceiling even with a live heartbeat (runaway-token guard)', async () => {
    mockIsAwaitingUserAnswer.mockResolvedValue(false);
    mockHasLiveExecution.mockResolvedValue(true);
    const past3x = new Date(Date.now() - TEST_MAX_TASK_WALL_MS * 3 - 500).toISOString();

    await internal(scheduler).advanceTheme(1, 100, 'priority', 1, past3x);

    expect(mockNotifyHangBackstop).toHaveBeenCalled();
    expect(mockTaskUpdate).toHaveBeenCalledWith({
      where: { id: 100 },
      data: { status: 'blocked' },
    });
  });

  it('フェーズ継ぎ目で直前に進捗があれば停止しない — 実行行が一瞬いない隙間 (task 585)', async () => {
    // implementer がコミットを終えて completed になり、verifier の実行行が
    // まだ作られていない30秒の隙間。hasLiveExecution は false になるが、
    // 8秒前に phase_completed 遷移がある = 進行中。
    mockIsAwaitingUserAnswer.mockResolvedValue(false);
    mockHasLiveExecution.mockResolvedValue(false);
    // 壁時計(テストでは短縮値)より新しい進捗 = 直前に前進している。
    mockResolveLastProgressAt.mockResolvedValue(
      Date.now() - Math.floor(TEST_MAX_TASK_WALL_MS / 10),
    );
    mockGetThemeActiveQueueItems.mockResolvedValue([{ id: 1, taskId: 100, status: 'running' }]);

    await internal(scheduler).advanceTheme(1, 100, 'priority', 1, staleLastRunAt());

    expect(mockNotifyHangBackstop).not.toHaveBeenCalled();
    expect(mockTaskUpdate).not.toHaveBeenCalled();
    expect(mockOnTaskFailed).not.toHaveBeenCalled();
  });

  it('進捗が途絶えていれば従来どおり停止する(本当のハング)', async () => {
    mockIsAwaitingUserAnswer.mockResolvedValue(false);
    mockHasLiveExecution.mockResolvedValue(false);
    // 最後の進捗が壁時計より前 = 動いていない。
    mockResolveLastProgressAt.mockResolvedValue(Date.now() - TEST_MAX_TASK_WALL_MS - 5_000);

    await internal(scheduler).advanceTheme(1, 100, 'priority', 1, staleLastRunAt());

    expect(mockNotifyHangBackstop).toHaveBeenCalled();
    expect(mockTaskUpdate).toHaveBeenCalledWith({
      where: { id: 100 },
      data: { status: 'blocked' },
    });
  });

  it('進捗が続いていても3倍の絶対上限を超えたら停止する(暴走ガード)', async () => {
    mockIsAwaitingUserAnswer.mockResolvedValue(false);
    mockHasLiveExecution.mockResolvedValue(false);
    mockResolveLastProgressAt.mockResolvedValue(Date.now() - 100);
    const past3x = new Date(Date.now() - TEST_MAX_TASK_WALL_MS * 3 - 500).toISOString();

    await internal(scheduler).advanceTheme(1, 100, 'priority', 1, past3x);

    expect(mockNotifyHangBackstop).toHaveBeenCalled();
  });

  it('does not trigger the backstop for a task still within its wall budget', async () => {
    mockGetThemeActiveQueueItems.mockResolvedValue([{ id: 1, taskId: 100, status: 'running' }]);

    await internal(scheduler).advanceTheme(1, 100, 'priority', 0, freshLastRunAt());

    expect(mockNotifyHangBackstop).not.toHaveBeenCalled();
  });

  it('does not trigger the backstop when lastRunAt is null', async () => {
    mockGetThemeActiveQueueItems.mockResolvedValue([{ id: 1, taskId: 100, status: 'running' }]);

    await internal(scheduler).advanceTheme(1, 100, 'priority', 0, null);

    expect(mockNotifyHangBackstop).not.toHaveBeenCalled();
  });
});

describe('advanceTheme — active queue item present', () => {
  it('waits (no side effects) while the item is queued/running', async () => {
    mockGetThemeActiveQueueItems.mockResolvedValue([{ id: 1, taskId: 100, status: 'running' }]);

    await internal(scheduler).advanceTheme(1, 100, 'priority', 0, freshLastRunAt());

    expect(mockQueueItemFindFirst).not.toHaveBeenCalled();
    expect(mockOnTaskCompleted).not.toHaveBeenCalled();
    expect(mockOnTaskFailed).not.toHaveBeenCalled();
  });

  it('pauses the theme for plan approval when the active item is waiting_approval', async () => {
    mockGetThemeActiveQueueItems.mockResolvedValue([
      { id: 1, taskId: 100, status: 'waiting_approval' },
    ]);

    await internal(scheduler).advanceTheme(1, 100, 'priority', 0, freshLastRunAt());

    expect(mockOnAwaitingPlanApproval).toHaveBeenCalledWith(1);
    expect(mockNotifyAwaitingPlanApproval).toHaveBeenCalledWith(1, 100);
    expect(mockBroadcast).toHaveBeenCalled();
  });

  it('only counts items belonging to the CURRENT task, ignoring other tasks in the theme queue', async () => {
    mockGetThemeActiveQueueItems.mockResolvedValue([{ id: 1, taskId: 999, status: 'running' }]);
    mockQueueItemFindFirst.mockResolvedValue(null);
    mockResolveTaskWorkflowState.mockResolvedValue({
      id: 100,
      status: 'in-progress',
      workflowStatus: 'in_progress',
      workflowMode: null,
      parentId: null,
    });

    await internal(scheduler).advanceTheme(1, 100, 'priority', 0, freshLastRunAt());

    // No active item for task 100 itself → falls through to the terminal-item lookup.
    expect(mockQueueItemFindFirst).toHaveBeenCalled();
  });
});

describe('advanceTheme — terminal resolution: completed', () => {
  it.each([
    {
      desc: 'a terminal queue item',
      terminalItem: { id: 1, status: 'completed', errorMessage: null },
      taskState: null,
    },
    {
      desc: 'task.status="done" even with no terminal queue item',
      terminalItem: null,
      taskState: {
        id: 100,
        status: 'done',
        workflowStatus: 'in_progress',
        workflowMode: null,
        parentId: null,
      },
    },
    {
      desc: 'task.workflowStatus="completed" (WorkflowRunner only sets task.status for subtasks)',
      terminalItem: null,
      taskState: {
        id: 100,
        status: 'in-progress',
        workflowStatus: 'completed',
        workflowMode: null,
        parentId: null,
      },
    },
  ])('completes via $desc', async ({ terminalItem, taskState }) => {
    mockQueueItemFindFirst.mockResolvedValue(terminalItem);
    mockResolveTaskWorkflowState.mockResolvedValue(taskState);

    await internal(scheduler).advanceTheme(1, 100, 'priority', 1, freshLastRunAt());

    expect(mockOnTaskCompleted).toHaveBeenCalledWith(1);
  });
});

describe('advanceTheme — terminal resolution: failed/blocked', () => {
  it('holds (does not skip) a blocked task that is awaiting a user answer', async () => {
    mockQueueItemFindFirst.mockResolvedValue(null);
    mockResolveTaskWorkflowState.mockResolvedValue({
      id: 100,
      status: 'blocked',
      workflowStatus: 'in_progress',
      workflowMode: null,
      parentId: null,
    });
    mockIsAwaitingUserAnswer.mockResolvedValue(true);

    await internal(scheduler).advanceTheme(1, 100, 'priority', 1, freshLastRunAt());

    expect(mockNotifyAwaitingUserAnswer).toHaveBeenCalledWith(1, 100);
    expect(mockOnTaskFailed).not.toHaveBeenCalled();
  });

  it('skips a failed terminal queue item, marks the task blocked, and advances', async () => {
    mockQueueItemFindFirst.mockResolvedValue({ id: 1, status: 'failed', errorMessage: 'boom' });
    mockResolveTaskWorkflowState.mockResolvedValue({
      id: 100,
      status: 'in-progress',
      workflowStatus: 'in_progress',
      workflowMode: null,
      parentId: null,
    });

    await internal(scheduler).advanceTheme(1, 100, 'priority', 1, freshLastRunAt());

    expect(mockTaskUpdate).toHaveBeenCalledWith({
      where: { id: 100 },
      data: { status: 'blocked' },
    });
    expect(mockOnTaskFailed).toHaveBeenCalledWith(1, 'boom');
    expect(mockNotifyTaskSkipped).toHaveBeenCalledWith(1, 100, 'boom');
  });

  it('does not re-mark status when the task is already blocked', async () => {
    mockQueueItemFindFirst.mockResolvedValue({ id: 1, status: 'cancelled', errorMessage: null });
    mockResolveTaskWorkflowState.mockResolvedValue({
      id: 100,
      status: 'blocked',
      workflowStatus: 'in_progress',
      workflowMode: null,
      parentId: null,
    });
    mockIsAwaitingUserAnswer.mockResolvedValue(false);

    await internal(scheduler).advanceTheme(1, 100, 'priority', 1, freshLastRunAt());

    expect(mockTaskUpdate).not.toHaveBeenCalled();
    expect(mockOnTaskFailed).toHaveBeenCalled();
  });

  it('falls back to a generic message when the terminal item has no errorMessage', async () => {
    mockQueueItemFindFirst.mockResolvedValue(null);
    mockResolveTaskWorkflowState.mockResolvedValue({
      id: 100,
      status: 'failed',
      workflowStatus: 'in_progress',
      workflowMode: null,
      parentId: null,
    });

    await internal(scheduler).advanceTheme(1, 100, 'priority', 1, freshLastRunAt());

    expect(mockOnTaskFailed).toHaveBeenCalledWith(1, expect.stringContaining('100'));
  });
});

describe('advanceTheme — vanished queue item (neither active nor terminal)', () => {
  it('re-enqueues the same task to resume a mid-workflow task', async () => {
    mockQueueItemFindFirst.mockResolvedValue(null);
    mockResolveTaskWorkflowState.mockResolvedValue({
      id: 100,
      status: 'in-progress',
      workflowStatus: 'in_progress',
      workflowMode: null,
      parentId: null,
    });

    await internal(scheduler).advanceTheme(1, 100, 'priority', 0, freshLastRunAt());

    expect(mockEnqueue).toHaveBeenCalledWith({ taskId: 100, themeId: 1, priority: 50 });
    expect(mockSetCurrentTask).toHaveBeenCalledWith(1, 100);
  });

  it('silently tolerates a race where the item was already re-created by another tick', async () => {
    mockQueueItemFindFirst.mockResolvedValue(null);
    mockResolveTaskWorkflowState.mockResolvedValue({
      id: 100,
      status: 'in-progress',
      workflowStatus: 'in_progress',
      workflowMode: null,
      parentId: null,
    });
    mockEnqueue.mockImplementation(() => Promise.reject(new Error('Task is already in the queue')));

    await expect(
      internal(scheduler).advanceTheme(1, 100, 'priority', 0, freshLastRunAt()),
    ).resolves.toBeUndefined();
    expect(mockSetCurrentTask).not.toHaveBeenCalled();
  });

  it('logs but does not throw on a genuine re-enqueue failure', async () => {
    mockQueueItemFindFirst.mockResolvedValue(null);
    mockResolveTaskWorkflowState.mockResolvedValue({
      id: 100,
      status: 'in-progress',
      workflowStatus: 'in_progress',
      workflowMode: null,
      parentId: null,
    });
    mockEnqueue.mockImplementation(() => Promise.reject(new Error('db unreachable')));

    await expect(
      internal(scheduler).advanceTheme(1, 100, 'priority', 0, freshLastRunAt()),
    ).resolves.toBeUndefined();
  });
});
