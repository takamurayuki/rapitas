/**
 * task-criteria-write
 *
 * writeTaskCriteria — the ONE way an existing task's goals / constraints /
 * acceptance criteria are rewritten (companion design 4.5, 4.5.1): ラピ's
 * task.criteria-update and its undo, the task screen's PATCH, updateTask, and
 * the intake enrichment. Task creation writes criteria into a row that does
 * not exist yet and stays outside.
 *
 * The write is a single conditional updateMany on the task row: the jury lock
 * (Task.juryRunId) must be empty AND the criteria / state must still be what
 * was read. That is what makes "the review takes the lock" and "the criteria
 * change" mutually exclusive — exactly one of two concurrent attempts wins,
 * on SQLite and PostgreSQL alike (no SELECT ... FOR UPDATE).
 * Not responsible for the audit trail of ラピ's acts (AssistantAction is the
 * route's) nor for HTTP mapping.
 */
import { createLogger } from '../../config/logger';
import {
  computeCriteriaRevision,
  criteriaListsOf,
  type CriteriaLists,
  type StoredCriteria,
} from './task-criteria-revision';

const log = createLogger('task-criteria-write');

/** haltReason of a review hold (review-hold.ts) — criteria are frozen while it waits. */
const REVIEW_HOLD_HALT_REASON = 'awaiting_review_decision';

/** haltReason of a discarded jury verdict — the one halt during which criteria may be fixed. */
export const JURY_RESULT_DISCARDED_HALT_REASON = 'jury_result_discarded';

/** workflowStatus values during which a verdict is pending or already acted on (design 4.5.1 (a)). */
const FROZEN_WORKFLOW_STATUSES = new Set(['verify_done', 'completed']);

/** Why a criteria write was refused (HTTP 409 code, or 404 for not_found). */
export type CriteriaWriteRefusal =
  | 'review_in_progress'
  | 'criteria_changed_since'
  | 'task_done'
  | 'not_found';

/** What to write: only the lists given are replaced. */
export type CriteriaPatch = Partial<CriteriaLists>;

/** Input of writeTaskCriteria. */
export interface CriteriaWriteInput {
  taskId: number;
  next: CriteriaPatch;
  /**
   * The revision the caller's proposal was built on. When given, a different
   * current revision refuses with criteria_changed_since. Omitted only by
   * callers that have no earlier read to hold on to (system writes, a legacy
   * client's PATCH) — the lock and state guards still apply to them.
   */
  expectedCriteriaRevision?: string;
  /** Who is writing, for the activity record (e.g. 'assistant', 'user:task_screen', 'system:intake'). */
  actor: string;
  reason?: string;
  /** Record acceptance_criteria_changed when any of the three lists changed (default true). */
  recordActivity?: boolean;
}

/** Outcome of writeTaskCriteria. */
export type CriteriaWriteResult =
  | {
      ok: true;
      /** False when the patch matched what was stored — nothing was written. */
      changed: boolean;
      before: CriteriaLists;
      after: CriteriaLists;
      previousRevision: string;
      revision: string;
    }
  | { ok: false; reason: CriteriaWriteRefusal; currentRevision: string | null };

interface CriteriaRow extends StoredCriteria {
  status: string;
  workflowStatus: string | null;
  haltReason: string | null;
  juryRunId: number | null;
}

/** The slice of Prisma writeTaskCriteria uses — injectable for tests. */
export interface CriteriaWriteDb {
  task: {
    findUnique(args: {
      where: { id: number };
      select: Record<keyof CriteriaRow, true>;
    }): Promise<CriteriaRow | null>;
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
  activityLog: {
    create(args: { data: { taskId: number; action: string; metadata: string } }): Promise<unknown>;
  };
}

const SELECT: Record<keyof CriteriaRow, true> = {
  goals: true,
  constraints: true,
  acceptanceCriteria: true,
  status: true,
  workflowStatus: true,
  haltReason: true,
  juryRunId: true,
};

/**
 * Whether the task's state forbids changing its criteria right now, by DB
 * values alone (design 4.5.1 (a)–(c), plus `done`). Never relies on the
 * in-process jury queue.
 *
 * @param row - The task's state columns / タスクの状態列
 * @returns The refusal, or null when a change is allowed / 拒否理由（変更可なら null）
 */
export function criteriaFreezeReason(
  row: Pick<CriteriaRow, 'status' | 'workflowStatus' | 'haltReason' | 'juryRunId'>,
): 'review_in_progress' | 'task_done' | null {
  if (row.status === 'done') return 'task_done';
  // (b) a gate holds the jury lock — the only signal that also covers a
  // re-review of the SAME verify.md after a criteria change, where an old
  // completion record already exists.
  if (row.juryRunId != null) return 'review_in_progress';
  // (c) a review hold waits on a human; changing the yardstick under it would
  // let an override approve against criteria nobody judged.
  if (row.haltReason === REVIEW_HOLD_HALT_REASON) return 'review_in_progress';
  // A discarded verdict halts the task precisely so the person can fix the
  // criteria before restarting, even though it sits at verify_done.
  if (row.haltReason === JURY_RESULT_DISCARDED_HALT_REASON) return null;
  // (a) the HTTP path writes verify_done BEFORE its jury runs, so this also
  // covers "saved, about to be judged" — not only "judged, awaiting CI".
  if (row.workflowStatus && FROZEN_WORKFLOW_STATUSES.has(row.workflowStatus)) {
    return 'review_in_progress';
  }
  return null;
}

const sameList = (a: string[], b: string[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * Rewrite a task's completion criteria under the jury lock and an optimistic
 * revision check. Throws only on unexpected DB errors.
 *
 * @param db - Prisma client (or a slice of it) / Prismaクライアント
 * @param input - What to write, the expected revision and the actor / 書く内容・期待する版・書き手
 * @returns before/after and both revisions, or why it was refused / 変更前後と版、または拒否理由
 */
export async function writeTaskCriteria(
  db: CriteriaWriteDb,
  input: CriteriaWriteInput,
): Promise<CriteriaWriteResult> {
  const row = await db.task.findUnique({ where: { id: input.taskId }, select: SELECT });
  if (!row) return { ok: false, reason: 'not_found', currentRevision: null };
  const previousRevision = computeCriteriaRevision(row);
  if (
    input.expectedCriteriaRevision !== undefined &&
    input.expectedCriteriaRevision !== previousRevision
  ) {
    return { ok: false, reason: 'criteria_changed_since', currentRevision: previousRevision };
  }
  const frozen = criteriaFreezeReason(row);
  if (frozen) return { ok: false, reason: frozen, currentRevision: previousRevision };

  const before = criteriaListsOf(row);
  const data: Record<string, string> = {};
  if (input.next.goals !== undefined) data.goals = JSON.stringify(input.next.goals);
  if (input.next.constraints !== undefined) {
    data.constraints = JSON.stringify(input.next.constraints);
  }
  if (input.next.acceptanceCriteria !== undefined) {
    data.acceptanceCriteria = JSON.stringify(input.next.acceptanceCriteria);
  }
  const stored = { ...row, ...data } as StoredCriteria;
  const after = criteriaListsOf(stored);
  const revision = computeCriteriaRevision(stored);
  const rawUnchanged = Object.entries(data).every(([k, v]) => row[k as keyof StoredCriteria] === v);
  if (rawUnchanged) {
    return { ok: true, changed: false, before, after, previousRevision, revision };
  }

  // NOTE: The where carries every value the decision above was made on. The
  // juryRunId:null + criteria columns pair is the design's lock; the state
  // columns make (a)/(c) exact too — a verify.md save that lands between the
  // read and this write flips workflowStatus and so loses us the race.
  const written = await db.task.updateMany({
    where: {
      id: input.taskId,
      juryRunId: null,
      goals: row.goals,
      constraints: row.constraints,
      acceptanceCriteria: row.acceptanceCriteria,
      status: row.status,
      workflowStatus: row.workflowStatus,
      haltReason: row.haltReason,
    },
    data,
  });
  if (written.count === 0) {
    const now = await db.task.findUnique({ where: { id: input.taskId }, select: SELECT });
    if (!now) return { ok: false, reason: 'not_found', currentRevision: null };
    const currentRevision = computeCriteriaRevision(now);
    const reason = criteriaFreezeReason(now) ?? 'criteria_changed_since';
    log.info(
      { taskId: input.taskId, reason, actor: input.actor },
      '[criteria] Conditional criteria write lost — refused',
    );
    return { ok: false, reason, currentRevision };
  }

  // Any of the three lists counts: they all make up the revision a verdict is
  // bound to, and the API lets goals or constraints change on their own.
  const listsChanged =
    !sameList(before.goals, after.goals) ||
    !sameList(before.constraints, after.constraints) ||
    !sameList(before.acceptanceCriteria, after.acceptanceCriteria);
  if (listsChanged && input.recordActivity !== false) {
    // Changing the criteria invalidates every repair reason recorded against
    // the OLD ones: those cite criteria by NUMBER (task 672) and were judged
    // against the old goals / constraints. The convergence detector and the
    // repair budget bound their window on this activity.
    await db.activityLog
      .create({
        data: {
          taskId: input.taskId,
          action: 'acceptance_criteria_changed',
          metadata: JSON.stringify({
            count: after.acceptanceCriteria.length,
            before: before.acceptanceCriteria,
            after: after.acceptanceCriteria,
            actor: input.actor,
            ...(input.reason ? { reason: input.reason } : {}),
            previousRevision,
            revision,
            ...(!sameList(before.goals, after.goals)
              ? { goals: { before: before.goals, after: after.goals } }
              : {}),
            ...(!sameList(before.constraints, after.constraints)
              ? { constraints: { before: before.constraints, after: after.constraints } }
              : {}),
          }),
        },
      })
      .catch((err: unknown) =>
        log.warn({ err, taskId: input.taskId }, '[criteria] change activity not recorded'),
      );
  }
  return { ok: true, changed: true, before, after, previousRevision, revision };
}
