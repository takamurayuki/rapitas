/**
 * theme-auto-run-scheduler.advance-select.test
 *
 * Covers advanceTheme() when there is no currentTaskId: the global
 * concurrency gate, the self-deploy restart short-circuits, task selection
 * (found / all_done / other no-task reasons), the backlog refill vs.
 * idle-armed outcomes, the stale-workflowStatus re-run reset, and the
 * enqueue race/failure handling.
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import {
  ThemeAutoRunScheduler,
  internal,
  resetSchedulerSingleton,
  resetAllMocks,
  TEST_AUTO_RUN_GLOBAL_MAX_CONCURRENCY,
  mockTaskFindMany,
  mockMaybeRestartForUpdate,
  mockSelectNextTask,
  mockPromoteBacklogForTheme,
  mockThemeAutoRunUpdateMany,
  mockNotifyAllDone,
  mockTaskFindUnique,
  mockTaskUpdate,
  mockEnqueue,
  mockSetCurrentTask,
  mockLogCycleEvent,
  mockBroadcast,
  mockRecordTransition,
  mockShouldRefillBacklogNow,
  mockGetIdleStopMinutes,
  mockGetSelfRefillWindowStart,
  mockMarkSelfRefillSucceeded,
} from './theme-auto-run-scheduler.test-support';

let scheduler: ThemeAutoRunScheduler;

beforeEach(() => {
  resetAllMocks();
  resetSchedulerSingleton();
  scheduler = ThemeAutoRunScheduler.getInstance();
});

describe('advanceTheme — concurrency gate', () => {
  it('returns immediately without any query when the global cap is reached', async () => {
    await internal(scheduler).advanceTheme(
      1,
      null,
      'priority',
      TEST_AUTO_RUN_GLOBAL_MAX_CONCURRENCY,
      null,
    );

    expect(mockTaskFindMany).not.toHaveBeenCalled();
    expect(mockSelectNextTask).not.toHaveBeenCalled();
  });
});

describe('advanceTheme — self-deploy short-circuit', () => {
  it('skips selection entirely when a restart was just kicked off', async () => {
    mockMaybeRestartForUpdate.mockResolvedValue(true);

    await internal(scheduler).advanceTheme(1, null, 'priority', 0, null);

    expect(mockSelectNextTask).not.toHaveBeenCalled();
  });
});

describe('advanceTheme — selection: no task found', () => {
  it('does nothing for a non-all_done reason (e.g. awaiting_approval)', async () => {
    mockSelectNextTask.mockResolvedValue({ found: false, reason: 'awaiting_approval' });

    await internal(scheduler).advanceTheme(1, null, 'priority', 0, null);

    expect(mockPromoteBacklogForTheme).not.toHaveBeenCalled();
    expect(mockThemeAutoRunUpdateMany).not.toHaveBeenCalled();
  });

  it('skips the dev restart (not backlog refill) when the idle timer is armed at the dry point', async () => {
    mockSelectNextTask.mockResolvedValue({ found: false, reason: 'all_done' });
    mockGetIdleStopMinutes.mockResolvedValue(60); // armed
    mockMaybeRestartForUpdate.mockResolvedValue(true);

    await internal(scheduler).advanceTheme(1, null, 'priority', 0, null);

    // The task-boundary restart check (before selection) still ran once;
    // the all_done-branch restart is skipped while the timer is armed.
    expect(mockMaybeRestartForUpdate).toHaveBeenCalledTimes(1);
  });

  it('still allows the dry-point restart when the idle timer is disabled', async () => {
    mockSelectNextTask.mockResolvedValue({ found: false, reason: 'all_done' });
    mockGetIdleStopMinutes.mockResolvedValue(0); // disabled
    mockMaybeRestartForUpdate.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    await internal(scheduler).advanceTheme(1, null, 'priority', 0, null);

    expect(mockMaybeRestartForUpdate).toHaveBeenCalledTimes(2);
    expect(mockPromoteBacklogForTheme).not.toHaveBeenCalled();
  });

  it('does not attempt a refill (or call promoteBacklogForTheme) outside the self-refill gate', async () => {
    mockSelectNextTask.mockResolvedValue({ found: false, reason: 'all_done' });
    mockShouldRefillBacklogNow.mockResolvedValue(false);

    await internal(scheduler).advanceTheme(1, null, 'priority', 0, null);

    expect(mockPromoteBacklogForTheme).not.toHaveBeenCalled();
    expect(mockThemeAutoRunUpdateMany).toHaveBeenCalledWith({
      where: { themeId: 1 },
      data: expect.objectContaining({ status: 'idle', enabled: true, currentTaskId: null }),
    });
    expect(mockLogCycleEvent).toHaveBeenCalledWith(
      'theme.idle',
      expect.objectContaining({ cause: 'all_done_backlog_empty' }),
    );
  });

  it('stays active when the self-refill gate allows it and the backlog refills at least one task', async () => {
    mockSelectNextTask.mockResolvedValue({ found: false, reason: 'all_done' });
    mockShouldRefillBacklogNow.mockResolvedValue(true);
    mockPromoteBacklogForTheme.mockResolvedValue(2);

    await internal(scheduler).advanceTheme(1, null, 'priority', 0, null);

    expect(mockPromoteBacklogForTheme).toHaveBeenCalledWith(1);
    expect(mockMarkSelfRefillSucceeded).toHaveBeenCalledWith(1, expect.any(Date));
    expect(mockLogCycleEvent).toHaveBeenCalledWith(
      'backlog.refill',
      expect.objectContaining({ created: 2 }),
    );
    expect(mockThemeAutoRunUpdateMany).not.toHaveBeenCalled();
    expect(mockNotifyAllDone).not.toHaveBeenCalled();
  });

  it('goes idle-but-armed (idleSince recorded) when all_done and the backlog yields nothing', async () => {
    mockSelectNextTask.mockResolvedValue({ found: false, reason: 'all_done' });
    mockShouldRefillBacklogNow.mockResolvedValue(true);
    mockPromoteBacklogForTheme.mockResolvedValue(0);

    await internal(scheduler).advanceTheme(1, null, 'priority', 0, null);

    expect(mockThemeAutoRunUpdateMany).toHaveBeenCalledWith({
      where: { themeId: 1 },
      data: { status: 'idle', enabled: true, currentTaskId: null, idleSince: expect.any(Date) },
    });
    expect(mockMarkSelfRefillSucceeded).not.toHaveBeenCalled();
    expect(mockNotifyAllDone).toHaveBeenCalledWith(1);
  });

  it('attaches refillSkippedReason to theme.idle when the gate held the refill', async () => {
    mockSelectNextTask.mockResolvedValue({ found: false, reason: 'all_done' });
    mockShouldRefillBacklogNow.mockResolvedValue(false);
    mockGetIdleStopMinutes.mockResolvedValue(0); // disabled → reason falls through to the window check
    mockGetSelfRefillWindowStart.mockResolvedValue('');

    await internal(scheduler).advanceTheme(1, null, 'priority', 0, null);

    expect(mockLogCycleEvent).toHaveBeenCalledWith(
      'theme.idle',
      expect.objectContaining({
        cause: 'all_done_backlog_empty',
        refillSkippedReason: 'outside_window',
      }),
    );
  });

  it('treats a rejected backlog promotion as zero created (caught) and still idles', async () => {
    mockSelectNextTask.mockResolvedValue({ found: false, reason: 'all_done' });
    mockShouldRefillBacklogNow.mockResolvedValue(true);
    mockPromoteBacklogForTheme.mockImplementation(() =>
      Promise.reject(new Error('backlog svc down')),
    );

    await internal(scheduler).advanceTheme(1, null, 'priority', 0, null);

    expect(mockThemeAutoRunUpdateMany).toHaveBeenCalled();
    expect(mockNotifyAllDone).toHaveBeenCalledWith(1);
  });
});

describe('advanceTheme — selection: task found', () => {
  it('enqueues a freshly-selected task as-is (no re-run reset needed)', async () => {
    mockSelectNextTask.mockResolvedValue({ found: true, taskId: 200 });
    mockTaskFindUnique.mockResolvedValue({ workflowStatus: 'draft' });

    await internal(scheduler).advanceTheme(1, null, 'priority', 0, null);

    expect(mockTaskUpdate).not.toHaveBeenCalled();
    expect(mockEnqueue).toHaveBeenCalledWith({ taskId: 200, themeId: 1, priority: 50 });
    expect(mockSetCurrentTask).toHaveBeenCalledWith(1, 200);
    expect(mockBroadcast).toHaveBeenCalled();
  });

  it.each(['verify_done', 'completed'])(
    'resets a re-run task whose stale workflowStatus is %s back to draft before enqueueing',
    async (staleStatus) => {
      mockSelectNextTask.mockResolvedValue({ found: true, taskId: 201 });
      mockTaskFindUnique.mockResolvedValue({ workflowStatus: staleStatus });

      await internal(scheduler).advanceTheme(1, null, 'priority', 0, null);

      expect(mockTaskUpdate).toHaveBeenCalledWith({
        where: { id: 201 },
        data: { workflowStatus: 'draft' },
      });
      expect(mockEnqueue).toHaveBeenCalledWith({ taskId: 201, themeId: 1, priority: 50 });
    },
  );

  // task 755: this reset used to skip recordTransition, leaving no audit
  // trail for how a re-run task got back to 'draft' (task #572's timeline
  // was missing exactly this row between reconciler_requeue and the next
  // research_done — see incident-signature-detectors RECOVERY_REQUEUE_CAUSES
  // note on why the cause is intentionally NOT added to that set).
  it.each(['verify_done', 'completed'])(
    'records a stale_terminal_reset transition when resetting a re-run task from %s',
    async (staleStatus) => {
      mockSelectNextTask.mockResolvedValue({ found: true, taskId: 204 });
      mockTaskFindUnique.mockResolvedValue({ workflowStatus: staleStatus });

      await internal(scheduler).advanceTheme(1, null, 'priority', 0, null);

      expect(mockRecordTransition).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 204,
          fromStatus: staleStatus,
          toStatus: 'draft',
          actor: 'system',
          cause: 'stale_terminal_reset',
        }),
      );
    },
  );

  it('does not record a transition when a freshly-selected task needs no reset', async () => {
    mockSelectNextTask.mockResolvedValue({ found: true, taskId: 205 });
    mockTaskFindUnique.mockResolvedValue({ workflowStatus: 'draft' });

    await internal(scheduler).advanceTheme(1, null, 'priority', 0, null);

    expect(mockRecordTransition).not.toHaveBeenCalled();
  });

  it('tracks the task without re-enqueuing when a race already queued it', async () => {
    mockSelectNextTask.mockResolvedValue({ found: true, taskId: 202 });
    mockTaskFindUnique.mockResolvedValue({ workflowStatus: 'draft' });
    mockEnqueue.mockImplementation(() => Promise.reject(new Error('Task is already in the queue')));

    await internal(scheduler).advanceTheme(1, null, 'priority', 0, null);

    expect(mockSetCurrentTask).toHaveBeenCalledWith(1, 202);
  });

  it('does not track the task when enqueue fails for a real (non-race) reason', async () => {
    mockSelectNextTask.mockResolvedValue({ found: true, taskId: 203 });
    mockTaskFindUnique.mockResolvedValue({ workflowStatus: 'draft' });
    mockEnqueue.mockImplementation(() => Promise.reject(new Error('db unreachable')));

    await internal(scheduler).advanceTheme(1, null, 'priority', 0, null);

    expect(mockSetCurrentTask).not.toHaveBeenCalled();
  });

  it('excludes currently-blocked tasks from selection via skipIds', async () => {
    mockTaskFindMany.mockResolvedValue([{ id: 50 }, { id: 51 }]);
    mockSelectNextTask.mockResolvedValue({ found: false, reason: 'all_done' });

    await internal(scheduler).advanceTheme(1, null, 'priority', 0, null);

    expect(mockSelectNextTask).toHaveBeenCalledWith(
      expect.anything(),
      1,
      'priority',
      [50, 51],
      0,
      null, // R6: success-rate signal (mocked to null = legacy ordering)
      undefined, // task 573 B: no open auto-PRs (mocked) → no scope-overlap context
    );
  });
});
