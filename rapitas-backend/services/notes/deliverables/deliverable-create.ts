/**
 * DeliverableCreate
 *
 * Making a completed task's deliverable note from its completion record
 * (design §3.3「同時起動・再実行の契約」):
 *
 * - Fixed id (`deliverable-task-{id}` / `research-task-{id}`), created with
 *   `create` only — an existing note is never overwritten, so a re-run or a
 *   re-completion leaves a person's edits alone. A unique violation means
 *   "already created", not an error.
 * - The body is generated BEFORE the transaction; a failed generation saves
 *   nothing and marks the record `failed` (retried once a day by the check).
 * - Note, link and record are written in one transaction.
 * - Before generating, the id is checked, and a second entry for the same
 *   task in this process rides on the first one's run.
 * - Every write is conditioned on the record as this attempt read it (mode,
 *   completedAt, state, attempts), and the saving transaction re-checks that
 *   the task is still done. A task reopened during the generation gets no
 *   note; a re-completion's newer record is never overwritten by the older
 *   attempt, whose draft is dropped (`superseded`) — the newer one creates.
 *
 * Background rule (§2.2): the record and the task are read without scope;
 * the task's workspaceId is the membership, and a record written for another
 * workspace is not acted on. Everything after that runs inside the task's
 * workspace.
 */
import { createLogger } from '../../../config/logger';
import { runAcrossAllWorkspaces } from '../../tenancy/workspace-context';
import type { PrismaInstance, PrismaTx } from '../note-record';
import { requestWorkspaceId } from '../note-scope';
import { checkNewMarkdownContent } from '../note-content-kind';
import { computeContentSha256 } from '../note-version';
import { isUniqueViolation } from '../note-write';
import { resolveEffectiveTheme } from '../placement/effective-theme';
import { findTaskInScope, inWorkspaceOf } from '../placement/placement-scope';
import { columnsFor } from '../placement/placement-types';
import { createLinkedNoteTx, taskLinkMeta } from '../placement/linked-note-create';
import type { CompletionState } from './deliverable-completion';
import {
  deliverableNoteId,
  deliverableSource,
  pickDeliverableKind,
} from './deliverable-eligibility';
import { draftDeliverableNote } from './deliverable-draft';

const logger = createLogger('deliverable-create');

/**
 * Outcome of one attempt; `skipped` = nothing to do for this record;
 * `superseded` = the record changed while this attempt ran (a re-completion
 * wrote a new one), so this attempt wrote nothing.
 */
export type DeliverableOutcome = CompletionState | 'skipped' | 'superseded';

interface RecordRow {
  taskId: number;
  workspaceId: number | null;
  state: string;
  attempts: number;
  mode: string;
  completedAt: Date;
}

const inFlight = new Map<number, Promise<DeliverableOutcome>>();

/** The record as this attempt read it; every write of the attempt is conditioned on it. */
const asRead = (record: RecordRow) => ({
  taskId: record.taskId,
  mode: record.mode,
  completedAt: record.completedAt,
  state: record.state,
  attempts: record.attempts,
});

/** Thrown inside the saving transaction to roll the note back. */
class AttemptAborted extends Error {
  constructor(readonly reason: 'reopened' | 'superseded') {
    super(reason);
  }
}

async function settle(
  db: PrismaInstance,
  record: RecordRow,
  state: CompletionState,
): Promise<DeliverableOutcome> {
  // NOTE: conditioned on the record as read (review G2 must-fix 3). A
  // re-completion during the attempt rewrote mode / completedAt / state, and
  // its record must not be overwritten by this older attempt's result.
  const n = (await db.taskDeliverableCompletion.updateMany({
    where: asRead(record),
    data: { state, attempts: record.attempts + 1, lastAttemptAt: new Date() },
  })) as { count: number };
  if (n.count === 1) return state;
  logger.info({ taskId: record.taskId, state }, 'completion record changed meanwhile; not settled');
  return 'superseded';
}

async function fileContent(db: PrismaInstance, taskId: number, fileType: string) {
  const row = (await db.workflowFile.findFirst({
    where: { taskId, fileType, workspaceId: requestWorkspaceId() },
    select: { content: true },
  })) as { content: string } | null;
  return row?.content ?? null;
}

async function attempt(db: PrismaInstance, taskId: number): Promise<DeliverableOutcome> {
  const record = (await runAcrossAllWorkspaces(() =>
    db.taskDeliverableCompletion.findFirst({ where: { taskId } }),
  )) as RecordRow | null;
  if (!record || (record.state !== 'pending' && record.state !== 'failed')) return 'skipped';
  const owner = (await runAcrossAllWorkspaces(() =>
    db.task.findFirst({ where: { id: taskId }, select: { id: true, workspaceId: true } }),
  )) as { workspaceId: number | null } | null;
  if (!owner) return 'skipped';
  const ws = owner.workspaceId ?? null;
  if ((record.workspaceId ?? null) !== ws) {
    logger.warn(
      { taskId, recordWorkspace: record.workspaceId, taskWorkspace: ws },
      'completion record belongs to another workspace than its task; not creating',
    );
    return settle(db, record, 'failed');
  }

  return inWorkspaceOf(ws, async () => {
    const task = await findTaskInScope(db, taskId);
    const status = (
      (await db.task.findFirst({
        where: { id: taskId, workspaceId: ws },
        select: { status: true },
      })) as {
        status: string;
      } | null
    )?.status;
    // Reopened since: not this completion's turn. A later completion (entry)
    // or the re-evaluation brings it back to pending.
    if (!task || status !== 'done') return settle(db, record, 'not_eligible');

    const verify = await fileContent(db, taskId, 'verify');
    const research = await fileContent(db, taskId, 'research');
    const kind = pickDeliverableKind({ verify, research });
    if (!kind) return settle(db, record, 'not_eligible');
    const id = deliverableNoteId(kind, taskId);
    const source = (kind === 'verify' ? verify : research) as string;

    if (await db.note.findFirst({ where: { id }, select: { id: true } })) {
      return settle(db, record, 'created');
    }

    let draft: { title: string; content: string };
    try {
      draft = await draftDeliverableNote(kind, task.title ?? `タスク #${taskId}`, source);
    } catch (err) {
      logger.warn({ err, taskId, kind }, 'deliverable generation failed; nothing saved');
      return settle(db, record, 'failed');
    }
    if (checkNewMarkdownContent(draft.content)) {
      logger.warn({ taskId, kind }, 'generated deliverable is not Markdown; nothing saved');
      return settle(db, record, 'failed');
    }

    const theme = await resolveEffectiveTheme(db, taskId);
    const meta = new Map([[taskId, await taskLinkMeta(db, task)]]);
    const sourceRef = JSON.stringify({
      taskId,
      fileType: kind,
      sha256: computeContentSha256(source),
      generatedAt: new Date().toISOString(),
    });
    try {
      await db.$transaction(async (tx: PrismaTx) => {
        // Membership re-checked inside the transaction that writes.
        if (!(await findTaskInScope(tx, taskId))) throw new Error('task left the workspace');
        // Reopened during the generation: this completion's note is not made.
        const now = (await tx.task.findFirst({
          where: { id: taskId, workspaceId: ws },
          select: { status: true },
        })) as { status: string } | null;
        if (now?.status !== 'done') throw new AttemptAborted('reopened');
        await createLinkedNoteTx(tx, {
          id,
          title: draft.title,
          content: draft.content,
          source: deliverableSource(kind),
          sourceTaskId: taskId,
          followsTask: true,
          sourceRef,
          placement: theme === null ? columnsFor('none') : columnsFor('theme', theme),
          taskIds: [taskId],
          meta,
        });
        const marked = (await tx.taskDeliverableCompletion.updateMany({
          where: asRead(record),
          data: { state: 'created', attempts: record.attempts + 1, lastAttemptAt: new Date() },
        })) as { count: number };
        // A newer completion's record: roll the note back, that attempt makes it.
        if (marked.count !== 1) throw new AttemptAborted('superseded');
      });
    } catch (error) {
      if (error instanceof AttemptAborted) {
        if (error.reason === 'reopened') return settle(db, record, 'not_eligible');
        logger.info({ taskId }, 'completion record changed during generation; draft dropped');
        return 'superseded';
      }
      // Someone created the same id first: theirs stays, this draft is dropped.
      if (isUniqueViolation(error)) return settle(db, record, 'created');
      throw error;
    }
    logger.info({ taskId, noteId: id, kind }, 'deliverable note created');
    return 'created';
  });
}

/**
 * Try to create a task's deliverable note from its record. Concurrent calls
 * for one task share a single run.
 *
 * @param db - The client, used without a workspace scope / スコープなしのクライアント
 * @param taskId - The completed task / 完了したタスク
 * @returns The record's new state, or skipped / 記録の新しい状態（対象外なら skipped）
 */
export async function createDeliverableForTask(
  db: PrismaInstance,
  taskId: number,
): Promise<DeliverableOutcome> {
  const running = inFlight.get(taskId);
  // Ride on the run in progress; if it was superseded by the completion that
  // brought us here, its record is still pending — run once more for it.
  if (running) {
    return running.then((outcome) =>
      outcome === 'superseded' ? createDeliverableForTask(db, taskId) : outcome,
    );
  }
  const run = attempt(db, taskId).finally(() => inFlight.delete(taskId));
  inFlight.set(taskId, run);
  return run;
}
