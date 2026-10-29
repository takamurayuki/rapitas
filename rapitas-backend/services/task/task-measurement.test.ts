/**
 * task-measurement-snapshot unit tests
 *
 * Deleting a task erases its measurements. The cascade runs
 * Task -> DeveloperModeConfig -> AgentSession -> AgentExecution ->
 * AgentExecutionLog, and Task -> WorkflowTransition separately, so one
 * `prisma.task.delete` takes the cost, the tokens, the phase history and the
 * repair record with it. Measured 2026-10-24: 921 tasks deleted against 172
 * alive, execution logs surviving for 17 of 89 days, and September holding
 * zero execution rows against 165 merged PRs.
 *
 * This module writes the numbers somewhere the cascade cannot reach, just
 * before the row goes. The tests are on the pure half, because that is where
 * the arithmetic that later analysis depends on actually lives.
 */
import { describe, test, expect } from 'bun:test';
import { buildTaskMeasurement, type MeasurementInput } from './task-measurement';

const task = {
  id: 42,
  title: 'ゲートの稼働を監視する',
  themeId: 7,
  status: 'done',
  createdAt: new Date('2026-10-01T00:00:00Z'),
  completedAt: new Date('2026-10-03T00:00:00Z'),
};

function input(over: Partial<MeasurementInput> = {}): MeasurementInput {
  return { task, executions: [], transitions: [], ...over };
}

const exec = (
  claudeSessionId: string | null,
  costUsd: number,
  startedAt: string,
  tokens: Partial<{ i: number; o: number; cr: number; cc: number }> = {},
) => ({
  claudeSessionId,
  costUsd,
  startedAt: new Date(startedAt),
  inputTokens: tokens.i ?? 0,
  outputTokens: tokens.o ?? 0,
  cacheReadInputTokens: tokens.cr ?? 0,
  cacheCreationInputTokens: tokens.cc ?? 0,
});

describe('cost', () => {
  test('does not sum a resumed session twice', () => {
    // costUsd is the CLI's SESSION-cumulative total_cost_usd. Summing the rows
    // of a resumed session counts the earlier turns again — measured at 5.59x
    // on task #980. A snapshot that bakes that in is worse than no snapshot:
    // the error becomes permanent once the rows are gone.
    const m = buildTaskMeasurement(
      input({
        executions: [
          exec('s1', 0.00257, '2026-10-01T01:00:00Z'),
          exec('s1', 0.00456, '2026-10-01T02:00:00Z'),
        ],
      }),
    );
    expect(m.costUsd).toBeCloseTo(0.00456, 6);
  });

  test('adds up sessions that are genuinely separate', () => {
    const m = buildTaskMeasurement(
      input({
        executions: [
          exec('s1', 1.5, '2026-10-01T01:00:00Z'),
          exec('s2', 2.25, '2026-10-01T02:00:00Z'),
        ],
      }),
    );
    expect(m.costUsd).toBeCloseTo(3.75, 6);
  });

  test('is zero when nothing ran', () => {
    expect(buildTaskMeasurement(input()).costUsd).toBe(0);
  });
});

describe('tokens', () => {
  test('are summed per execution, unlike cost', () => {
    // Token columns record this invocation, not the session so far, so these
    // really do add up even within one session.
    const m = buildTaskMeasurement(
      input({
        executions: [
          exec('s1', 0.1, '2026-10-01T01:00:00Z', { i: 10, o: 20, cr: 30, cc: 40 }),
          exec('s1', 0.2, '2026-10-01T02:00:00Z', { i: 1, o: 2, cr: 3, cc: 4 }),
        ],
      }),
    );
    expect(m.tokens).toEqual({
      input: 11,
      output: 22,
      cacheRead: 33,
      cacheCreation: 44,
    });
  });
});

describe('what the task cost in attention', () => {
  test('counts the states that needed a person', () => {
    // The constraint on running several projects at once is not PR count, it
    // is how often a task stops and waits for a human.
    const m = buildTaskMeasurement(
      input({
        transitions: [
          { cause: 'phase_completed:implementer', toStatus: 'in_progress' },
          { cause: null, toStatus: 'awaiting_question' },
          { cause: 'question_resolved', toStatus: 'in_progress' },
          { cause: 'blocked_escalated', toStatus: 'blocked' },
          { cause: 'plan_revision_requested', toStatus: 'plan_created' },
        ],
      }),
    );
    expect(m.humanTouches).toBe(4);
  });

  test('is zero for a task that ran straight through', () => {
    const m = buildTaskMeasurement(
      input({
        transitions: [
          { cause: 'phase_completed:researcher', toStatus: 'research_done' },
          { cause: 'auto_approve_plan', toStatus: 'plan_approved' },
          { cause: 'file_saved:verify', toStatus: 'verify_done' },
        ],
      }),
    );
    expect(m.humanTouches).toBe(0);
  });
});

describe('rework', () => {
  test('counts repair bounces separately from human attention', () => {
    const m = buildTaskMeasurement(
      input({
        transitions: [
          { cause: 'verify_repair', toStatus: 'in_progress' },
          { cause: 'verify_repair', toStatus: 'in_progress' },
          { cause: 'ci_repair', toStatus: 'in_progress' },
          { cause: 'phase_completed:verifier', toStatus: 'verify_done' },
        ],
      }),
    );
    expect(m.repairBounces).toBe(3);
    expect(m.humanTouches).toBe(0);
  });
});

describe('the shape that survives', () => {
  test('carries enough to recompute the metrics the task is gone from', () => {
    const m = buildTaskMeasurement(
      input({
        executions: [exec('s1', 1, '2026-10-01T01:00:00Z')],
        transitions: [{ cause: 'verify_repair', toStatus: 'in_progress' }],
      }),
    );
    expect(m).toMatchObject({
      taskId: 42,
      title: 'ゲートの稼働を監視する',
      themeId: 7,
      status: 'done',
      executions: 1,
      transitions: 1,
    });
    expect(m.createdAt).toBe('2026-10-01T00:00:00.000Z');
    expect(m.completedAt).toBe('2026-10-03T00:00:00.000Z');
    // Dates as ISO strings: the payload is JSON, and a Date would land as
    // something a later reader has to guess at.
    expect(typeof m.createdAt).toBe('string');
  });

  test('keeps the cause breakdown, not just the totals', () => {
    // Totals answer "how much"; the breakdown is what lets a later question
    // ("which of these actually needed me?") be asked at all.
    const m = buildTaskMeasurement(
      input({
        transitions: [
          { cause: 'verify_repair', toStatus: 'in_progress' },
          { cause: 'verify_repair', toStatus: 'in_progress' },
          { cause: 'auto_approve_plan', toStatus: 'plan_approved' },
        ],
      }),
    );
    expect(m.causes).toEqual({ verify_repair: 2, auto_approve_plan: 1 });
  });

  test('survives a task with no title or theme', () => {
    const m = buildTaskMeasurement(
      input({
        task: { id: 1, title: '', themeId: null, status: null, createdAt: null, completedAt: null },
      }),
    );
    expect(m.themeId).toBeNull();
    expect(m.createdAt).toBeNull();
  });
});
