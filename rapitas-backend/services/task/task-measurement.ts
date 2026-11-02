/**
 * TaskMeasurement
 *
 * Reduces a task's execution and transition rows to the numbers worth
 * outliving it. Pure: no database, no clock, no policy about when a task may
 * be deleted — see task-measurement-snapshot.ts for the write.
 *
 * Kept apart from the write so the arithmetic can be tested without pulling
 * in `config/database`: importing it opens a real connection, which a unit
 * test should never need and CI may not have.
 */
import { rollUpTaskSpend, type SpendRow } from '../workflow/task-spend-rollup';

/**
 * Causes and states that mean the task stopped and waited for a person.
 *
 * Plan approval is deliberately absent: it is auto-approved on every task
 * here (74 of 74 recorded), so counting it would report attention nobody
 * actually spent.
 */
const HUMAN_ATTENTION = new Set([
  'question_resolved',
  'blocked_escalated',
  'blocked_reescalated',
  'plan_revision_requested',
  'task_retried',
]);

/** States that mean the task is parked waiting on a person. */
const HUMAN_ATTENTION_STATES = new Set(['awaiting_question', 'blocked']);

/** Causes that mean the work came back for rework without a person. */
const REPAIR_CAUSES = new Set(['verify_repair', 'ci_repair']);

/** The task row, as much of it as the snapshot keeps. */
export interface MeasurementTask {
  id: number;
  title: string;
  themeId: number | null;
  status: string | null;
  createdAt: Date | null;
  completedAt: Date | null;
}

/** One execution's measurable columns. */
export interface MeasurementExecution extends SpendRow {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadInputTokens: number | null;
  cacheCreationInputTokens: number | null;
}

/** One workflow transition, as far as the snapshot cares. */
export interface MeasurementTransition {
  cause: string | null;
  toStatus: string | null;
}

/** Everything the pure builder needs. */
export interface MeasurementInput {
  task: MeasurementTask;
  executions: readonly MeasurementExecution[];
  transitions: readonly MeasurementTransition[];
}

/** What is written to the timeline and read back long after the task is gone. */
export interface TaskMeasurement {
  taskId: number;
  title: string;
  themeId: number | null;
  status: string | null;
  /** ISO strings, not Dates: the payload is JSON. / JSONなのでISO文字列 */
  createdAt: string | null;
  completedAt: string | null;
  executions: number;
  costUsd: number;
  tokens: { input: number; output: number; cacheRead: number; cacheCreation: number };
  transitions: number;
  /** Transition counts by cause, so later questions are still askable. */
  causes: Record<string, number>;
  humanTouches: number;
  repairBounces: number;
}

const num = (v: number | null | undefined): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : 0;

/**
 * Reduce a task's rows to the numbers worth outliving it. Pure.
 *
 * Cost goes through {@link rollUpTaskSpend} rather than a sum: `costUsd` holds
 * the CLI's session-cumulative `total_cost_usd`, so adding the rows of a
 * resumed session counts its earlier turns again (5.59x on task #980). Tokens
 * are per-invocation and really do add up.
 *
 * @param input - The task and its execution / transition rows / タスクと実行・遷移の行
 * @returns The snapshot to persist / 保存するスナップショット
 */
export function buildTaskMeasurement(input: MeasurementInput): TaskMeasurement {
  const { task, executions, transitions } = input;

  const tokens = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
  for (const e of executions) {
    tokens.input += num(e.inputTokens);
    tokens.output += num(e.outputTokens);
    tokens.cacheRead += num(e.cacheReadInputTokens);
    tokens.cacheCreation += num(e.cacheCreationInputTokens);
  }

  const causes: Record<string, number> = {};
  let humanTouches = 0;
  let repairBounces = 0;
  for (const t of transitions) {
    if (t.cause) causes[t.cause] = (causes[t.cause] ?? 0) + 1;
    if (
      (t.cause && HUMAN_ATTENTION.has(t.cause)) ||
      (t.toStatus && HUMAN_ATTENTION_STATES.has(t.toStatus))
    )
      humanTouches++;
    if (t.cause && REPAIR_CAUSES.has(t.cause)) repairBounces++;
  }

  return {
    taskId: task.id,
    title: task.title ?? '',
    themeId: task.themeId ?? null,
    status: task.status ?? null,
    createdAt: task.createdAt ? task.createdAt.toISOString() : null,
    completedAt: task.completedAt ? task.completedAt.toISOString() : null,
    executions: executions.length,
    costUsd: rollUpTaskSpend(executions, null),
    tokens,
    transitions: transitions.length,
    causes,
    humanTouches,
    repairBounces,
  };
}
