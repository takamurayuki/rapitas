import { describe, expect, it } from 'bun:test';
import { eligibleTopLevelTodoWhere } from './auto-run-eligibility';

// Mirrors selectNextTask (auto-run-selection.ts): 'todo' rows always, plus
// 'in-progress' rows whose workflow is not finished — #1088 (2026-09-25) sat
// in-progress/plan_approved after a mid-run answer and the armed-idle theme
// never resumed because only 'todo' was counted.
const BASE = {
  themeId: 7,
  status: { in: ['todo', 'in-progress'] },
  parentId: null,
  workflowDisabled: false,
  autoRunExcluded: false,
  haltReason: null,
  AND: [
    {
      OR: [
        { status: 'todo' },
        { workflowStatus: null },
        { workflowStatus: { notIn: ['completed', 'verify_done'] } },
      ],
    },
    { OR: [{ workflowStatus: null }, { workflowStatus: { not: 'awaiting_question' } }] },
  ],
};

describe('eligibleTopLevelTodoWhere', () => {
  it('returns the base runnable shape for a theme (todo + unfinished in-progress)', () => {
    expect(eligibleTopLevelTodoWhere(7)).toEqual(BASE);
  });

  it('merges extra clauses onto the base shape', () => {
    expect(eligibleTopLevelTodoWhere(7, { autoCreatedFromBacklog: false })).toEqual({
      ...BASE,
      autoCreatedFromBacklog: false,
    });
  });
});
