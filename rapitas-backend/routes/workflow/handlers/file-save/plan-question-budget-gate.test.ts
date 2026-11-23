/**
 * plan-question-budget-gate tests
 *
 * An exhausted agent question budget adopts the recommended option when it is
 * safe to, and still blocks when it is not.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import type { ParsedQuestionBlock } from '../../../../services/workflow/question-options-parser';

let budget: {
  allowed: boolean;
  count: number;
  limit: number;
  operatorCount: number;
  operatorLimit: number;
  exhausted?: 'agent' | 'operator';
} = { allowed: true, count: 0, limit: 3, operatorCount: 0, operatorLimit: 3 };
const mockBlock = mock(() => Promise.resolve());
mock.module('../../../../services/workflow/workflow-plan-question-guard', () => ({
  checkPlanQuestionBudget: () => Promise.resolve(budget),
  blockPlanQuestionOverBudget: mockBlock,
}));
const mockRecordTransition = mock(() => Promise.resolve());
mock.module('../../../../services/workflow/transition-recorder', () => ({
  recordTransition: mockRecordTransition,
}));

const { enforcePlanQuestionBudget } = await import('./plan-question-budget-gate');

function block(option: Record<string, unknown> = {}): ParsedQuestionBlock {
  return {
    kind: 'execution_continuation',
    questions: [
      {
        id: 'Q1',
        summary: 'INVALID_DRILL_SESSION を ErrorCode に足すか',
        options: [
          { key: 'A', label: 'errors.ts に 1 行足す', ...option },
          { key: 'B', label: '既存コードを流用する' },
        ],
        freeTextRequired: false,
        freeTextReason: null,
        recommended: 'A',
        recommendedReason: '応答仕様どおりになる',
      },
    ],
  };
}

const exhaustedAgent = () => {
  budget = {
    allowed: false,
    count: 3,
    limit: 3,
    operatorCount: 0,
    operatorLimit: 3,
    exhausted: 'agent',
  };
};

beforeEach(() => {
  budget = { allowed: true, count: 0, limit: 3, operatorCount: 0, operatorLimit: 3 };
  mockBlock.mockClear();
  mockRecordTransition.mockClear();
});

// 2026-11-23: TempoRaid task 1347 asked a 4th plan-phase question (whether to
// add one ErrorCode value). The cap blocked the task, the blocked auto-retry
// reset it to draft and reused the same plan, and the implementer would have
// stopped on the same question again — a loop only a human could break.
describe('enforcePlanQuestionBudget', () => {
  test('lets the round through while the budget lasts', async () => {
    const schedule = mock(() => {});
    expect(
      await enforcePlanQuestionBudget(1347, false, block(), { scheduleAutoAdopt: schedule }),
    ).toBe('allowed');
    expect(schedule).not.toHaveBeenCalled();
  });

  test('adopts the recommended option instead of blocking once the agent budget is spent', async () => {
    exhaustedAgent();
    const schedule = mock(() => {});
    const outcome = await enforcePlanQuestionBudget(1347, false, block(), {
      scheduleAutoAdopt: schedule,
    });
    expect(outcome).toBe('auto_adopt');
    expect(schedule).toHaveBeenCalledWith(1347);
    expect(mockBlock).not.toHaveBeenCalled();
    expect(mockRecordTransition).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 1347, cause: 'plan_question_budget_auto_adopt' }),
    );
  });

  test('still blocks when the recommended option would change a gate', async () => {
    exhaustedAgent();
    const schedule = mock(() => {});
    await expect(
      enforcePlanQuestionBudget(1347, false, block({ mutatesGate: true }), {
        scheduleAutoAdopt: schedule,
      }),
    ).rejects.toThrow('lifetime cap');
    expect(mockBlock).toHaveBeenCalledTimes(1);
    expect(schedule).not.toHaveBeenCalled();
  });

  test('still blocks when the recommended option needs a human', async () => {
    exhaustedAgent();
    await expect(
      enforcePlanQuestionBudget(1347, false, block({ requiresOperatorAction: true }), {
        scheduleAutoAdopt: () => {},
      }),
    ).rejects.toThrow('lifetime cap');
    expect(mockBlock).toHaveBeenCalledTimes(1);
  });

  test('still blocks when there is no machine-readable recommendation', async () => {
    exhaustedAgent();
    await expect(
      enforcePlanQuestionBudget(1347, false, null, { scheduleAutoAdopt: () => {} }),
    ).rejects.toThrow('lifetime cap');
    expect(mockBlock).toHaveBeenCalledTimes(1);
  });

  test('never auto-adopts on the operator-wait axis', async () => {
    budget = {
      allowed: false,
      count: 0,
      limit: 3,
      operatorCount: 3,
      operatorLimit: 3,
      exhausted: 'operator',
    };
    await expect(
      enforcePlanQuestionBudget(1347, true, block(), { scheduleAutoAdopt: () => {} }),
    ).rejects.toThrow('operator lifetime cap');
    expect(mockBlock).toHaveBeenCalledTimes(1);
  });
});
