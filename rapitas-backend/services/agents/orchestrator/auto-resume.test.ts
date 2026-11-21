/**
 * auto-resume.test
 *
 * Unit tests for the pure auto-resume decision core (attempt counting and
 * the guard matrix). The prisma/orchestrator shell is exercised through the
 * manual-resume flow it reuses.
 */
import { describe, it, expect, mock } from 'bun:test';

mock.module('../../../config/database', () => ({ prisma: {} }));
mock.module('../../../config/logger', () => ({
  createLogger: () => ({ info: mock(() => {}), warn: mock(() => {}), error: mock(() => {}) }),
}));

const { countResumeAttempts, decideAutoResume, isWorkflowProgressCause } =
  await import('./auto-resume');

const NOW = new Date('2026-08-07T12:00:00Z');

function exec(over: Partial<{ status: string; createdAt: Date; output: string | null }> = {}) {
  return {
    status: 'interrupted',
    createdAt: new Date(NOW.getTime() - 60 * 60 * 1000), // 1h ago
    output: 'some output',
    ...over,
  };
}

const OK_OPTS = {
  now: NOW,
  hasNewerExecution: false,
  taskStatus: 'todo',
  hasWorkingDirectory: true,
  hasActiveLock: false,
};

describe('countResumeAttempts', () => {
  it('counts the resume markers in the output', () => {
    expect(countResumeAttempts(null)).toBe(0);
    expect(countResumeAttempts('no markers')).toBe(0);
    expect(countResumeAttempts('x\n[再開] 中断された作業を再開します...\ny')).toBe(1);
    expect(
      countResumeAttempts(
        '[再開] 中断された作業を再開します...\nwork\n[再開] 中断された作業を再開します...\n',
      ),
    ).toBe(2);
  });
});

describe('decideAutoResume', () => {
  it('does not resume work while the theme is stopped or paused', () => {
    expect(decideAutoResume(exec(), { ...OK_OPTS, themeRunAllowed: false }).resume).toBe(false);
  });
  it.each(['canceled', 'canceling'])(
    'preserves %s instead of automatically resuming',
    (taskStatus) => {
      expect(decideAutoResume(exec(), { ...OK_OPTS, taskStatus }).resume).toBe(false);
    },
  );
  it('resumes a fresh interrupted execution with no prior attempts', () => {
    expect(decideAutoResume(exec(), OK_OPTS).resume).toBe(true);
  });

  it('skips non-interrupted executions', () => {
    expect(decideAutoResume(exec({ status: 'running' }), OK_OPTS).resume).toBe(false);
  });

  it('skips when the theme has no working directory', () => {
    const d = decideAutoResume(exec(), { ...OK_OPTS, hasWorkingDirectory: false });
    expect(d.resume).toBe(false);
    expect(d.reason).toContain('WorkingDirectory');
  });

  it('skips done/cancelled tasks', () => {
    expect(decideAutoResume(exec(), { ...OK_OPTS, taskStatus: 'done' }).resume).toBe(false);
    expect(decideAutoResume(exec(), { ...OK_OPTS, taskStatus: 'cancelled' }).resume).toBe(false);
  });

  it('skips blocked/failed tasks', () => {
    expect(decideAutoResume(exec(), { ...OK_OPTS, taskStatus: 'blocked' }).resume).toBe(false);
    expect(decideAutoResume(exec(), { ...OK_OPTS, taskStatus: 'failed' }).resume).toBe(false);
  });

  it('skips when a newer execution already took the task over', () => {
    const d = decideAutoResume(exec(), { ...OK_OPTS, hasNewerExecution: true });
    expect(d.resume).toBe(false);
    expect(d.reason).toContain('newer execution');
  });

  it('skips when a task-execution lock is already held for this task', () => {
    const d = decideAutoResume(exec(), { ...OK_OPTS, hasActiveLock: true });
    expect(d.resume).toBe(false);
    expect(d.reason).toContain('lock');
  });

  it('skips executions older than the freshness window', () => {
    const old = exec({ createdAt: new Date(NOW.getTime() - 25 * 60 * 60 * 1000) });
    expect(decideAutoResume(old, OK_OPTS).resume).toBe(false);
  });

  it('skips once the resume budget is exhausted', () => {
    const twice = exec({
      output: '[再開] 中断された作業を再開します...\n…\n[再開] 中断された作業を再開します...\n…',
    });
    const d = decideAutoResume(twice, OK_OPTS);
    expect(d.resume).toBe(false);
    expect(d.reason).toContain('budget');
  });

  it('still resumes with exactly one prior attempt (budget is 2)', () => {
    const once = exec({ output: '[再開] 中断された作業を再開します...\n…' });
    expect(decideAutoResume(once, OK_OPTS).resume).toBe(true);
  });
});

// 2026-11-21: execution 6969 (task 1519's implementer) was interrupted by a
// deploy restart at 14:32. A plan revision moved the workflow on at 14:33, and
// the worker auto-resumed 6969 at 14:36, so the old implementer ran beside the
// new planner in the same worktree and its completion skipped the revision.
describe('auto-resume after the workflow moved on', () => {
  it('does not resume when the workflow advanced after the interruption', () => {
    const d = decideAutoResume(exec(), { ...OK_OPTS, workflowMovedOn: true });
    expect(d.resume).toBe(false);
    expect(d.reason).toContain('workflow');
  });

  it('still resumes when nothing happened since the interruption', () => {
    expect(decideAutoResume(exec(), { ...OK_OPTS, workflowMovedOn: false }).resume).toBe(true);
  });

  it.each([
    'plan_revision_requested',
    'verify_repair',
    'phase_completed:planner',
    'question_resolved',
    'task_retried',
  ])('counts %s as the workflow moving on', (cause) => {
    expect(isWorkflowProgressCause(cause)).toBe(true);
  });

  it.each(['agent_lifecycle_shutdown_revert', 'auto_run_stop_revert', 'task_spend_notice'])(
    'does not count %s, which only records the interruption',
    (cause) => {
      expect(isWorkflowProgressCause(cause)).toBe(false);
    },
  );
});
