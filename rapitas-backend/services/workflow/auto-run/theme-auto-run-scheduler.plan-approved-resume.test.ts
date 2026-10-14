/**
 * theme-auto-run-scheduler.plan-approved-resume.test
 *
 * processPausedThemes() must resume a paused_approval theme once the current
 * task's plan is approved, release its waiting_approval item unless an agent
 * is in flight, and keep the pause while the plan is still plan_created.
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import {
  ThemeAutoRunScheduler,
  internal,
  resetSchedulerSingleton,
  resetAllMocks,
  makeState,
  mockQueueItemUpdateMany,
  mockGetThemeActiveQueueItems,
  mockResumeAutoRun,
  mockTaskFindUnique,
} from './theme-auto-run-scheduler.test-support';
import {
  mockQueueItemFindMany,
  mockAgentExecutionFindMany,
} from './theme-auto-run-scheduler.test-support.collaborator-mocks';

let scheduler: ThemeAutoRunScheduler;

beforeEach(() => {
  resetAllMocks();
  mockQueueItemFindMany.mockReset();
  mockQueueItemFindMany.mockResolvedValue([{ id: 1 }]);
  mockAgentExecutionFindMany.mockReset();
  mockAgentExecutionFindMany.mockResolvedValue([]);
  resetSchedulerSingleton();
  scheduler = ThemeAutoRunScheduler.getInstance();
  mockGetThemeActiveQueueItems.mockResolvedValue([
    { id: 1, taskId: 5, status: 'waiting_approval' },
  ]);
});

describe('processPausedThemes with an approved plan', () => {
  it('releases the waiting_approval item and resumes the theme', async () => {
    mockTaskFindUnique.mockResolvedValue({ workflowStatus: 'plan_approved' });

    await internal(scheduler).processPausedThemes([
      makeState({ status: 'paused_approval', currentTaskId: 5, themeId: 9 }),
    ]);

    expect(mockQueueItemUpdateMany).toHaveBeenCalledTimes(1);
    expect(mockQueueItemUpdateMany).toHaveBeenCalledWith({
      where: { taskId: 5, status: 'waiting_approval' },
      data: { status: 'queued', currentPhase: 'plan_approved' },
    });
    expect(mockResumeAutoRun).toHaveBeenCalledWith(9);
  });

  it('does not rewrite the item while an agent is in flight, but still resumes', async () => {
    mockTaskFindUnique.mockResolvedValue({ workflowStatus: 'plan_approved' });
    mockAgentExecutionFindMany.mockResolvedValue([{ id: 77 }]);

    await internal(scheduler).processPausedThemes([
      makeState({ status: 'paused_approval', currentTaskId: 5, themeId: 9 }),
    ]);

    expect(mockQueueItemUpdateMany).not.toHaveBeenCalled();
    expect(mockResumeAutoRun).toHaveBeenCalledWith(9);
  });

  it('keeps the pause while the plan is still plan_created', async () => {
    mockTaskFindUnique.mockResolvedValue({ workflowStatus: 'plan_created' });

    await internal(scheduler).processPausedThemes([
      makeState({ status: 'paused_approval', currentTaskId: 5, themeId: 9 }),
    ]);

    expect(mockQueueItemUpdateMany).not.toHaveBeenCalled();
    expect(mockResumeAutoRun).not.toHaveBeenCalled();
  });

  it('leaves an explicit user pause untouched even for an approved plan', async () => {
    mockTaskFindUnique.mockResolvedValue({ workflowStatus: 'plan_approved' });

    await internal(scheduler).processPausedThemes([
      makeState({ status: 'paused_user', currentTaskId: 5, themeId: 9 }),
    ]);

    expect(mockQueueItemUpdateMany).not.toHaveBeenCalled();
    expect(mockResumeAutoRun).not.toHaveBeenCalled();
  });
});
