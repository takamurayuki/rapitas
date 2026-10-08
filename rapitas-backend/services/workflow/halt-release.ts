/**
 * halt-release
 *
 * Releases a task's iteration-budget halt on an operator's say-so, recording the
 * new hypothesis that justifies the retry. Owns only that release: it does not
 * decide whether a halt was correct, does not select or dispatch the task, and
 * never halts anything itself.
 *
 * Why this exists. haltIfIterationBudgetExceeded writes haltReason/haltedAt/
 * resumeCondition and nothing anywhere clears them: auto-run-eligibility.ts
 * requires `haltReason: null` to select a task, `PATCH /tasks/:id` does not
 * accept the field, and retryTask does not touch it. A budget halt was therefore
 * a one-way door — measured 2026-09-28/29, four tasks (1105, 1107, 1110, 1112)
 * sat halted with no path back, which is precisely why hard-task autonomy never
 * completed a run. Task 1112's own resumeCondition asks for "a new hypothesis";
 * there was no way to hand one over.
 *
 * Two things make the release safe:
 *
 *  1. It is a HUMAN action. The route enforces the same X-Rapitas-Source header
 *     guard as answer-question, so an agent shelling out to curl cannot release
 *     its own cost ceiling. This module records who asked.
 *  2. It RESETS THE WINDOW. `halt_released` joins WINDOW_RESET_CAUSES, so the
 *     recorded transition moves the iteration window forward on every axis
 *     (time, cost, attempts, repeat, no-progress). Without that the next
 *     scheduler tick re-reads the same spend and re-halts immediately — the
 *     exact failure of task 881/996 (2026-09-20), where releasing a halt whose
 *     cost axis ignored the window produced an instant re-halt.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { recordTransition } from './transition-recorder';
import type { WorkflowStatus } from './workflow-types';

const log = createLogger('workflow:halt-release');

/** Transition cause recorded for a released halt; also a window-reset cause. */
export const HALT_RELEASED_CAUSE = 'halt_released';

/**
 * Minimum hypothesis length. The resumeCondition asks for a NEW hypothesis, and
 * "ok"/"retry" is not one — a release with no stated reason is how a cost
 * ceiling quietly becomes advisory.
 */
export const MIN_HYPOTHESIS_CHARS = 10;

/** Outcome of a release attempt. */
export type HaltReleaseResult =
  | { ok: true; taskId: number; previousHaltReason: string; toStatus: WorkflowStatus | null }
  | { ok: false; reason: 'not_found' | 'not_halted' | 'write_failed' };

/** The halt columns, which are newer than the generated client (see the scheduler's same cast). */
interface HaltColumns {
  haltReason: string | null;
  workflowStatus: WorkflowStatus | null;
}

/**
 * Clear a task's halt and record the hypothesis that justifies retrying it.
 *
 * Fails CLOSED in the sense that matters here: a task with no halt is left
 * exactly as it is (`not_halted`) rather than having its window reset, so this
 * cannot be used as a general-purpose budget reset on a healthy task.
 *
 * @param taskId - Task whose halt to release. / 解除対象のタスクID
 * @param hypothesis - Why a retry is expected to behave differently. / 再試行が変わる理由
 * @param actorLabel - Who asked, for the audit record. / 依頼者ラベル(監査用)
 * @returns The release outcome. / 解除結果
 */
export async function releaseTaskHalt(
  taskId: number,
  hypothesis: string,
  actorLabel: string,
): Promise<HaltReleaseResult> {
  const taskModel = prisma.task as unknown as {
    findUnique: (args: {
      where: { id: number };
      select: { haltReason: boolean; workflowStatus: boolean };
    }) => Promise<HaltColumns | null>;
    update: (args: {
      where: { id: number };
      data: { haltReason: null; haltedAt: null; resumeCondition: null };
    }) => Promise<unknown>;
  };

  const task = await taskModel
    .findUnique({ where: { id: taskId }, select: { haltReason: true, workflowStatus: true } })
    .catch((err) => {
      log.warn({ err, taskId }, '[halt-release] task lookup failed');
      return null;
    });
  if (!task) return { ok: false, reason: 'not_found' };
  if (!task.haltReason) return { ok: false, reason: 'not_halted' };

  const previousHaltReason = task.haltReason;
  const cleared = await taskModel
    .update({
      where: { id: taskId },
      data: { haltReason: null, haltedAt: null, resumeCondition: null },
    })
    .then(() => true)
    .catch((err) => {
      log.error({ err, taskId }, '[halt-release] failed to clear halt columns');
      return false;
    });
  if (!cleared) return { ok: false, reason: 'write_failed' };

  // Recorded AFTER the columns are cleared and deliberately not rolled back if
  // it fails: a task that is runnable again with no audit line is recoverable,
  // whereas an audit line for a release that did not happen is a lie. The
  // window reset rides on this transition, so a failure here means the next
  // tick may re-halt — visible, and fixable by releasing again.
  await recordTransition({
    taskId,
    fromStatus: task.workflowStatus ?? null,
    toStatus: task.workflowStatus ?? 'draft',
    actor: 'user',
    cause: HALT_RELEASED_CAUSE,
    metadata: { previousHaltReason, hypothesis, releasedBy: actorLabel },
  }).catch((err) =>
    log.error(
      { err, taskId, previousHaltReason },
      '[halt-release] halt cleared but the audit transition failed — the iteration window was NOT reset, so the task may re-halt',
    ),
  );

  log.info(
    { taskId, previousHaltReason, releasedBy: actorLabel },
    '[halt-release] halt released with a new hypothesis',
  );
  return { ok: true, taskId, previousHaltReason, toStatus: task.workflowStatus ?? null };
}
