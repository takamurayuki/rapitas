/**
 * auto-run-rework-summary.test
 *
 * The auto-run strip showed a task's phase from its current workflowStatus
 * only, so a task sent back from verify to implement looked like a task
 * implementing for the first time (2026-11-21). The summary counts the
 * backward transitions and names the most recent one.
 */
import { describe, expect, test } from 'bun:test';
import { summarizeRework } from './auto-run-rework-summary';

const at = (min: number) => new Date(Date.UTC(2026, 10, 21, 0, min));

describe('summarizeRework', () => {
  test('reports nothing for a task that only moved forward', () => {
    expect(
      summarizeRework([
        { fromStatus: null, toStatus: 'draft', cause: 'created', createdAt: at(0) },
        {
          fromStatus: 'draft',
          toStatus: 'research_done',
          cause: 'file_saved:research',
          createdAt: at(1),
        },
        {
          fromStatus: 'research_done',
          toStatus: 'in_progress',
          cause: 'auto_advance',
          createdAt: at(2),
        },
      ]),
    ).toBeNull();
  });

  test('counts backward moves and names the latest one', () => {
    const summary = summarizeRework([
      {
        fromStatus: 'in_progress',
        toStatus: 'verify_done',
        cause: 'file_saved:verify',
        createdAt: at(1),
      },
      { fromStatus: 'verify_done', toStatus: 'in_progress', cause: 'ci_repair', createdAt: at(2) },
      { fromStatus: 'in_progress', toStatus: 'research_done', cause: 'replan', createdAt: at(3) },
    ]);
    expect(summary).toEqual({
      count: 2,
      lastFromStatus: 'in_progress',
      lastToStatus: 'research_done',
      lastCause: 'replan',
      lastAt: at(3).toISOString(),
    });
  });

  // A completed task reopened by a bounce starts over from where it was sent.
  test('counts a move back out of completed', () => {
    const summary = summarizeRework([
      {
        fromStatus: 'completed',
        toStatus: 'plan_approved',
        cause: 'verify_repair',
        createdAt: at(5),
      },
    ]);
    expect(summary?.count).toBe(1);
    expect(summary?.lastToStatus).toBe('plan_approved');
  });

  // Answering a question returns to the earlier status; that is not a send-back.
  test('ignores moves into and out of awaiting_question', () => {
    expect(
      summarizeRework([
        {
          fromStatus: 'in_progress',
          toStatus: 'awaiting_question',
          cause: 'file_saved:question',
          createdAt: at(1),
        },
        {
          fromStatus: 'awaiting_question',
          toStatus: 'in_progress',
          cause: 'question_answered',
          createdAt: at(2),
        },
      ]),
    ).toBeNull();
  });

  test('uses the newest row even when given out of order', () => {
    const summary = summarizeRework([
      { fromStatus: 'in_progress', toStatus: 'draft', cause: 'reset', createdAt: at(9) },
      { fromStatus: 'verify_done', toStatus: 'in_progress', cause: 'ci_repair', createdAt: at(4) },
    ]);
    expect(summary?.lastCause).toBe('reset');
  });
});
