/**
 * subtask-completion-handler.test
 *
 * Locks down the dual-field completion detection: a split parent must finalize
 * (and thus commit) when its subtasks have finished, even if task.status and
 * task.workflowStatus momentarily diverge — the bug that lost a parent's work.
 */
import { describe, it, expect } from 'bun:test';
import {
  isSubtaskFinished,
  isSubtaskFailed,
  isSubtaskPassed,
  isParentFinalizable,
} from './subtask-completion-handler';

describe('subtask completion predicates', () => {
  it('treats a done task as finished + passed', () => {
    const s = { status: 'done', workflowStatus: 'completed' };
    expect(isSubtaskFinished(s)).toBe(true);
    expect(isSubtaskPassed(s)).toBe(true);
    expect(isSubtaskFailed(s)).toBe(false);
  });

  it('treats workflowStatus=completed as finished even if status lags', () => {
    // The exact divergence that stranded parents: verify passed (workflowStatus
    // completed) but task.status was never advanced past in-progress.
    const s = { status: 'in-progress', workflowStatus: 'completed' };
    expect(isSubtaskFinished(s)).toBe(true);
    expect(isSubtaskPassed(s)).toBe(true);
  });

  it("treats status='completed' (manual value) as finished + passed", () => {
    const s = { status: 'completed', workflowStatus: 'plan_approved' };
    expect(isSubtaskFinished(s)).toBe(true);
    expect(isSubtaskPassed(s)).toBe(true);
  });

  it('does NOT treat an in-progress subtask as finished', () => {
    const s = { status: 'in-progress', workflowStatus: 'plan_approved' };
    expect(isSubtaskFinished(s)).toBe(false);
    expect(isSubtaskPassed(s)).toBe(false);
  });

  it('treats failed/cancelled as finished but not passed', () => {
    for (const status of ['failed', 'cancelled']) {
      const s = { status, workflowStatus: 'verify_done' };
      expect(isSubtaskFinished(s)).toBe(true);
      expect(isSubtaskFailed(s)).toBe(true);
      expect(isSubtaskPassed(s)).toBe(false);
    }
  });
});

describe('isParentFinalizable', () => {
  it('rejects a parent whose workflow never started (null / draft)', () => {
    // Task 430 regression: a lone manually-added "test" subtask completed and
    // stamped a never-run parent as completed with a stub verify.md.
    expect(isParentFinalizable({ workflowStatus: null })).toBe(false);
    expect(isParentFinalizable({ workflowStatus: 'draft' })).toBe(false);
  });

  it('allows a parent whose workflow is underway (plan split)', () => {
    for (const workflowStatus of [
      'research_done',
      'plan_created',
      'plan_approved',
      'in_progress',
      'verify_done',
    ]) {
      expect(isParentFinalizable({ workflowStatus })).toBe(true);
    }
  });
});
