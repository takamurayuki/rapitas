/**
 * recheck-hold
 *
 * Records why the implementer re-check holds a task (task 1572): the
 * `parallel_recheck_held` WorkflowTransition row and the cycle-log line, and
 * builds the skipped result the runner re-queues on. The row and the log are
 * kept under separate conditions (F2): the row is compared with the newest
 * stored row, so a failed write is retried on the next evaluation; the log is
 * compared with the in-memory logged signature, so it appears once per reason.
 * Not responsible for deciding whether to hold.
 */
import { createLogger } from '../../../../../config/logger';
import { logCycleEvent } from '../../../../observability';
import type { WorkflowAdvanceResult } from '../../../workflow-agent-executor';
import type { RoleTransition, WorkflowStatus } from '../../../workflow-types';
import {
  RECHECK_HELD_CAUSE,
  getRecheckHold,
  heldSignature,
  markRecheckHoldLogged,
  readLastHeldSignature,
  setRecheckHold,
} from './recheck-state';

const log = createLogger('workflow:parallel-recheck');

/** Why a task is held. */
export interface HoldInput {
  opponentTaskId: number | null;
  reason: string;
  detail: string;
  files: string[];
  exempt: boolean;
}

/** Facts of the advance being held. */
export interface HoldContext {
  taskId: number;
  themeId: number | null;
  transition: RoleTransition;
  currentStatus: WorkflowStatus;
  prisma: unknown;
  now: () => number;
}

/**
 * A hold with no opponent; never exempt from the tenure wall.
 *
 * @param reason - Reason id / 理由
 * @param detail - Human-readable detail / 詳細
 * @returns Hold input / 保留の内容
 */
export function noOpponent(reason: string, detail: string): HoldInput {
  return { opponentTaskId: null, reason, detail, files: [], exempt: false };
}

type CreateModel = { create?: (a: unknown) => Promise<unknown> };

/**
 * Hold the implementer: record the reason (row and log, see the file header)
 * and return the skipped result.
 *
 * @param ctx - The advance being held / 対象
 * @param markAt - Time of the task's mark (ms); older held rows are ignored / 印の時刻
 * @param h - Why it is held / 保留の理由
 * @returns Early-return result for the orchestrator / 早期終了の結果
 */
export async function holdImplementer(
  ctx: HoldContext,
  markAt: number | null,
  h: HoldInput,
): Promise<{ done: true; result: WorkflowAdvanceResult }> {
  const { taskId, prisma } = ctx;
  const signature = heldSignature(h.opponentTaskId, h.reason, h.files);
  setRecheckHold(taskId, h.exempt, ctx.now());

  let stored: string | null = null;
  let storedRead = true;
  try {
    stored = await readLastHeldSignature(prisma, taskId, markAt);
  } catch (err) {
    // Unknown what is stored: writing now could duplicate; the next evaluation retries.
    storedRead = false;
    log.warn({ err, taskId }, '[parallel-recheck] held signature read failed');
  }

  if (storedRead && stored !== signature) {
    const model = (prisma as { workflowTransition?: CreateModel } | null)?.workflowTransition;
    try {
      if (typeof model?.create !== 'function') throw new Error('workflowTransition.create missing');
      await model.create({
        data: {
          taskId,
          fromStatus: ctx.currentStatus,
          toStatus: ctx.currentStatus,
          actor: 'system',
          cause: RECHECK_HELD_CAUSE,
          metadata: JSON.stringify({
            opponentTaskId: h.opponentTaskId,
            reason: h.reason,
            detail: h.detail.slice(0, 300),
            files: h.files.slice(0, 50),
            signature,
            exemptFromTenure: h.exempt,
          }),
        },
      });
    } catch (err) {
      log.warn({ err, taskId }, '[parallel-recheck] held row write failed — retried next time');
    }
  }

  if (storedRead && stored === signature) {
    // Already recorded (e.g. before a restart): align memory, log nothing.
    markRecheckHoldLogged(taskId, signature);
  } else if (getRecheckHold(taskId)?.loggedSignature !== signature) {
    logCycleEvent('task.deferred', {
      cause: 'parallel_recheck_hold',
      task: taskId,
      theme: ctx.themeId ?? undefined,
      opponent: h.opponentTaskId,
      reason: h.reason,
      files: h.files.slice(0, 20),
      msg: 'implementer held — re-check found a collision with a running task',
    });
    markRecheckHoldLogged(taskId, signature);
    log.info(
      { taskId, opponent: h.opponentTaskId, reason: h.reason, files: h.files.slice(0, 5) },
      '[parallel-recheck] holding implementer',
    );
  }

  const who = h.opponentTaskId != null ? `task ${h.opponentTaskId}` : 'the re-check';
  const files = h.files.length > 0 ? `: ${h.files.slice(0, 3).join(', ')}` : '';
  return {
    done: true,
    result: {
      success: true,
      skipped: true,
      role: ctx.transition.role,
      status: ctx.currentStatus,
      held: `parallel re-check waits on ${who} (${h.reason}${files})`,
    },
  };
}
