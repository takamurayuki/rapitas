import { describe, expect, it } from 'bun:test';
import { autoRunCandidateWhere, eligibleTopLevelTodoWhere } from './auto-run-eligibility';

describe('eligibleTopLevelTodoWhere', () => {
  it('returns the base runnable-todo shape for a theme', () => {
    expect(eligibleTopLevelTodoWhere(7)).toEqual({
      themeId: 7,
      status: 'todo',
      parentId: null,
      workflowDisabled: false,
      OR: [{ workflowStatus: null }, { workflowStatus: { not: 'awaiting_question' } }],
    });
  });

  it('merges extra clauses onto the base shape', () => {
    expect(eligibleTopLevelTodoWhere(7, { autoCreatedFromBacklog: false })).toEqual({
      themeId: 7,
      status: 'todo',
      parentId: null,
      workflowDisabled: false,
      OR: [{ workflowStatus: null }, { workflowStatus: { not: 'awaiting_question' } }],
      autoCreatedFromBacklog: false,
    });
  });
});

describe('autoRunCandidateWhere', () => {
  it('returns the todo/in-progress shape selectNextTask candidates use', () => {
    expect(autoRunCandidateWhere(7)).toEqual({
      themeId: 7,
      status: { in: ['todo', 'in-progress'] },
      AND: [
        {
          OR: [
            { status: 'todo' },
            { workflowStatus: null },
            { workflowStatus: { notIn: ['completed', 'verify_done'] } },
          ],
        },
        {
          OR: [{ workflowStatus: null }, { workflowStatus: { not: 'awaiting_question' } }],
        },
      ],
      workflowDisabled: false,
      parentId: null,
    });
  });

  it('includes a status:todo task whose workflowStatus is stale-terminal (re-run reset)', () => {
    const where = autoRunCandidateWhere(7);
    const andClauses = where.AND as Array<{ OR: Array<Record<string, unknown>> }>;
    // The first OR branch alone (status:'todo') must make this row match,
    // independent of the terminal workflowStatus — this is exactly the case
    // remainingCount used to drop (task 889).
    expect(andClauses[0]?.OR).toContainEqual({ status: 'todo' });
  });

  it('merges extra clauses (e.g. the per-call skipTaskIds filter) onto the base shape', () => {
    const where = autoRunCandidateWhere(7, { id: { notIn: [1, 2] } });
    expect(where.id).toEqual({ notIn: [1, 2] });
    expect(where.themeId).toBe(7);
  });
});
