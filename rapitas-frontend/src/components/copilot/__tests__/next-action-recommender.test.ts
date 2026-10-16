import { getNextActions, type NextActionContext } from '../next-action-recommender';

/** Builds a context with sensible defaults (non-dev, simple, estimated todo). */
const ctx = (over: Partial<NextActionContext> = {}): NextActionContext => ({
  status: 'todo',
  subtaskTotal: 0,
  subtaskDone: 0,
  complexityScore: 20,
  estimatedHours: 2,
  canRunAgent: false,
  ...over,
});

describe('getNextActions', () => {
  it('offers a grounded retrospective for a done task', () => {
    const actions = getNextActions(ctx({ status: 'done' }));
    expect(actions).toHaveLength(1);
    expect(actions[0].id).toBe('reflect');
    expect(actions[0].runRetrospective).toBe(true);
    expect(actions[0].actionType).toBeUndefined();
  });

  it('recommends starting a simple non-dev todo', () => {
    const [first] = getNextActions(ctx());
    expect(first.actionType).toBe('update_status');
    // NOTE: Task status type uses 'in-progress' (hyphen), matching the source
    // in next-action-recommender.ts — the test previously asserted the wrong
    // literal ('in_progress').
    expect(first.params).toEqual({ status: 'in-progress' });
    expect(first.tone).toBe('primary');
  });

  it('recommends AI analysis for a dev todo with no subtasks', () => {
    const [first] = getNextActions(ctx({ canRunAgent: true }));
    expect(first.actionType).toBe('analyze');
  });

  it('recommends executing a dev todo that already has subtasks', () => {
    const [first] = getNextActions(ctx({ canRunAgent: true, subtaskTotal: 3, subtaskDone: 0 }));
    expect(first.actionType).toBe('execute');
  });

  it('recommends completion when every subtask is done', () => {
    const [first] = getNextActions(ctx({ status: 'in-progress', subtaskTotal: 2, subtaskDone: 2 }));
    expect(first.actionType).toBe('update_status');
    expect(first.params).toEqual({ status: 'done' });
  });

  it('suggests splitting a complex task without subtasks', () => {
    const actions = getNextActions(ctx({ complexityScore: 80 }));
    expect(actions.some((a) => a.actionType === 'create_subtasks')).toBe(true);
  });

  it('suggests estimating when hours are unset', () => {
    const actions = getNextActions(ctx({ estimatedHours: null }));
    expect(actions.some((a) => a.actionType === 'update_estimate')).toBe(true);
  });

  it('caps recommendations at three', () => {
    const actions = getNextActions(ctx({ complexityScore: 90, estimatedHours: null }));
    expect(actions.length).toBeLessThanOrEqual(3);
  });

  describe('blocked/failed status', () => {
    // Regression: 'blocked'/'failed' previously matched none of the
    // status branches, so a stuck task silently fell through to the
    // generic secondary suggestions (split/estimate) as if nothing were
    // wrong — the exact "next action doesn't reflect reality" complaint.
    it('recommends checking the blocked reason for a blocked task, with no secondary suggestions', () => {
      const actions = getNextActions(
        ctx({ status: 'blocked', complexityScore: 90, estimatedHours: null }),
      );
      expect(actions).toHaveLength(1);
      expect(actions[0]).toMatchObject({
        id: 'blocked',
        prompt: 'なぜブロックされているか教えて',
        tone: 'primary',
      });
    });

    it('recommends retrying with the agent for a failed dev task', () => {
      const [first] = getNextActions(ctx({ status: 'failed', canRunAgent: true }));
      expect(first).toMatchObject({ id: 'retry', actionType: 'execute', tone: 'primary' });
    });

    it('recommends a manual check for a failed non-dev task', () => {
      const [first] = getNextActions(ctx({ status: 'failed', canRunAgent: false }));
      expect(first).toMatchObject({ id: 'failed-manual', tone: 'primary' });
      expect(first.prompt).toBeTruthy();
    });

    it('does not suggest splitting or estimating for a failed task, even when complex and unestimated', () => {
      const actions = getNextActions(
        ctx({ status: 'failed', complexityScore: 90, estimatedHours: null }),
      );
      expect(actions.some((a) => a.actionType === 'create_subtasks')).toBe(false);
      expect(actions.some((a) => a.actionType === 'update_estimate')).toBe(false);
    });
  });
});
