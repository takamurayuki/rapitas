/**
 * TaskMeasurementSnapshot
 *
 * Writes a task's measurements to the timeline immediately before the row is
 * deleted. Owns only the write; the arithmetic is in task-measurement.ts.
 *
 * Deleting a task erases its own measurements. The cascade runs
 * `Task -> DeveloperModeConfig -> AgentSession -> AgentExecution ->
 * AgentExecutionLog` (agents.prisma:10/28/109/151) and
 * `Task -> WorkflowTransition` (workflow.prisma:133), so one
 * `prisma.task.delete` takes the cost, the tokens, the phase history and the
 * repair record with it. `DeletedTask` keeps the task; nothing keeps the
 * numbers.
 *
 * Measured 2026-10-24: 921 tasks deleted against 172 alive; execution rows
 * surviving for 17 of 89 days; September holding zero execution rows against
 * 165 merged PRs; the workflow ledger down to 99 tasks, which is why the
 * bounce rate and the human-intervention rate are both survivorship-biased
 * and unusable.
 *
 * `TimelineEvent` carries no task foreign key and so is out of the cascade's
 * reach — the same schema-change-free persistence the route pins and context
 * snapshots already use.
 */
import { appendEvent } from '../memory/timeline';
import { createLogger } from '../../config/logger';
import {
  buildTaskMeasurement,
  type MeasurementExecution,
  type MeasurementTask,
  type MeasurementTransition,
  type TaskMeasurement,
} from './task-measurement';

const log = createLogger('task-measurement-snapshot');

/** Timeline event type carrying one deleted task's measurements. */
export const TASK_MEASUREMENT_EVENT = 'task_measurement_snapshot';

/**
 * Prisma surface this module reads; narrow on purpose so it can be faked.
 *
 * Declared with method shorthand, not function-typed properties: TypeScript
 * checks method parameters bivariantly, which is what lets the real Prisma
 * client — whose `args` are fully typed generics — satisfy an `unknown` here.
 */
export interface MeasurementReader {
  task: { findUnique(args: unknown): PromiseLike<MeasurementTask | null> };
  agentExecution: { findMany(args: unknown): PromiseLike<MeasurementExecution[]> };
  workflowTransition: { findMany(args: unknown): PromiseLike<MeasurementTransition[]> };
}

/**
 * Capture a task's measurements to the timeline before it is deleted.
 *
 * Best-effort by design: a task deletion must never fail because its
 * bookkeeping did. A missing task is not an error — the caller may be
 * deleting something already gone.
 *
 * @param taskId - The task about to be deleted / これから削除するタスク
 * @param db - Prisma client / Prismaクライアント
 * @returns The snapshot written, or null when nothing was / 書いたスナップショット、無ければ null
 */
export async function snapshotTaskMeasurements(
  taskId: number,
  db: MeasurementReader,
): Promise<TaskMeasurement | null> {
  try {
    const task = await db.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        title: true,
        themeId: true,
        status: true,
        createdAt: true,
        completedAt: true,
      },
    });
    if (!task) return null;

    const [executions, transitions] = await Promise.all([
      db.agentExecution.findMany({
        where: { session: { config: { taskId } } },
        select: {
          costUsd: true,
          claudeSessionId: true,
          startedAt: true,
          inputTokens: true,
          outputTokens: true,
          cacheReadInputTokens: true,
          cacheCreationInputTokens: true,
        },
      }),
      db.workflowTransition.findMany({
        where: { taskId },
        select: { cause: true, toStatus: true },
      }),
    ]);

    const measurement = buildTaskMeasurement({ task, executions, transitions });
    await appendEvent({
      eventType: TASK_MEASUREMENT_EVENT as Parameters<typeof appendEvent>[0]['eventType'],
      actorType: 'system',
      payload: measurement as unknown as Record<string, unknown>,
      correlationId: `task_${taskId}`,
    });
    return measurement;
  } catch (err) {
    log.warn({ err, taskId }, 'Could not snapshot task measurements — deleting anyway');
    return null;
  }
}
