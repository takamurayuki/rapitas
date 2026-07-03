/**
 * transition-recorder
 *
 * Append-only writer for `WorkflowTransition`. Every code path that mutates
 * `task.workflowStatus` should call `recordTransition()` so the timeline
 * endpoint can reconstruct exactly what happened, when, and why.
 *
 * This is intentionally fire-and-forget: a logging failure must NEVER block
 * a real status update. Errors are downgraded to WARN.
 *
 * NOTE: Many bounded-loop guards across this codebase (plan-replan cap,
 * ci_repair cap, auto_merge_blocked window/valve, phase-critic bounce cap,
 * reconciler requeue caps) enforce their limit by COUNTING the rows this
 * function writes, filtered by `cause`. A single dropped write here silently
 * under-counts every one of those caps at once — this is the foundational
 * amplifier behind that whole class of bug, not just a lost audit-log line.
 * A bounded retry is therefore attempted before giving up (still never
 * throws — the retry is purely to make the row more likely to land).
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';

const log = createLogger('workflow:transition-recorder');

export type TransitionActor =
  | 'researcher'
  | 'planner'
  | 'reviewer'
  | 'implementer'
  | 'verifier'
  | 'auto_verifier'
  | 'system'
  | 'user';

export interface RecordTransitionInput {
  taskId: number;
  fromStatus: string | null;
  toStatus: string;
  actor: TransitionActor;
  cause: string;
  phase?: string;
  executionId?: number | null;
  sessionId?: number | null;
  metadata?: Record<string, unknown>;
  invariantViolation?: boolean;
  invariantMessage?: string;
}

/**
 * Append a row to `WorkflowTransition`. Safe to call inside a hot path —
 * logging-only, never throws.
 *
 * @param input - Transition details. / 遷移情報
 */
export async function recordTransition(input: RecordTransitionInput): Promise<void> {
  const write = () =>
    prisma.workflowTransition.create({
      data: {
        taskId: input.taskId,
        fromStatus: input.fromStatus ?? null,
        toStatus: input.toStatus,
        actor: input.actor,
        cause: input.cause,
        phase: input.phase ?? null,
        executionId: input.executionId ?? null,
        sessionId: input.sessionId ?? null,
        metadata: JSON.stringify(input.metadata ?? {}),
        invariantViolation: input.invariantViolation ?? false,
        invariantMessage: input.invariantMessage ?? null,
      },
    });

  try {
    await write();
  } catch (err) {
    log.warn(
      { err, taskId: input.taskId, cause: input.cause },
      '[Transition] failed to persist transition row — retrying once',
    );
    try {
      await write();
    } catch (err2) {
      log.error(
        { err: err2, taskId: input.taskId, cause: input.cause },
        '[Transition] failed to persist transition row twice (non-fatal, but any cap counting this cause is now under-counted)',
      );
      return;
    }
  }

  log.info(
    {
      taskId: input.taskId,
      from: input.fromStatus,
      to: input.toStatus,
      actor: input.actor,
      cause: input.cause,
      executionId: input.executionId ?? null,
    },
    '[Transition] recorded',
  );
}
