/**
 * DeliverableCheck
 *
 * The at-start and hourly check of the deliverable automation (design §3.3
 * 「取りこぼしの点検」「再評価の候補」「機能を有効にした時点」):
 *
 * 0. Once, when the feature is first enabled: every task already `done`
 *    without a record gets a `baseline` record, which is never created from —
 *    so turning the feature on does not produce a note for every old task.
 *    Only a complete baseline is marked; if any record fails, the run stops
 *    before step 1 and the next run tries the baseline again.
 * 1. A `done` task without a record gets `mode = unknown`, `state = pending`
 *    (a completion by a path with no entry, or whose after-the-fact record
 *    write failed). `completedAt` is the time the check found it.
 * 2. Re-evaluation candidates: a `not_eligible` / `created` record of a task
 *    that is `done` now and whose `updatedAt` is later than both the record's
 *    `completedAt` and `lastAttemptAt`. Only `state` / `lastAttemptAt` change
 *    — never `mode` or `completedAt`. `not_eligible` goes back to `pending`;
 *    `created` stays `created` (the note, if a person deleted it, is NOT made
 *    again by a re-evaluation) and only its `lastAttemptAt` moves, so the
 *    same edit is not evaluated twice. `baseline` is never a candidate.
 * 3. Attempt every `pending` record, and every `failed` one whose last
 *    attempt is a day old.
 *
 * Background rule: rows are read without scope; each write is made with the
 * task's own workspace as its membership.
 */
import { createLogger } from '../../../config/logger';
import type { PrismaInstance } from '../note-record';
import { inWorkspaceOf } from '../placement/placement-scope';
import { DELIVERABLE_BASELINE_KEY, hasMarker, writeMarker } from '../placement/migration-marker';
import { isUniqueViolation } from '../note-write';
import { createDeliverableForTask } from './deliverable-create';

const logger = createLogger('deliverable-check');

/** A failed record is retried after this long. */
export const FAILED_RETRY_MS = 24 * 60 * 60 * 1000;

/** What one run did. */
export interface DeliverableCheckResult {
  baselined: number;
  found: number;
  reevaluated: number;
  attempted: number;
}

interface DoneTask {
  id: number;
  workspaceId: number | null;
  updatedAt: Date;
  completedAt?: Date | null;
}

async function createRecords(
  db: PrismaInstance,
  tasks: DoneTask[],
  // The record's required columns, so a missing one fails the type check.
  make: (t: DoneTask) => { mode: string; state: string; completedAt: Date },
): Promise<{ made: number; failed: number }> {
  let made = 0;
  let failed = 0;
  for (const task of tasks) {
    try {
      await inWorkspaceOf(task.workspaceId ?? null, () =>
        db.taskDeliverableCompletion.create({
          data: { taskId: task.id, workspaceId: task.workspaceId ?? null, ...make(task) },
        }),
      );
      made += 1;
    } catch (error) {
      // An entry wrote the record in between: that one is the truth.
      if (!isUniqueViolation(error)) {
        failed += 1;
        logger.warn({ err: error, taskId: task.id }, 'record create failed');
      }
    }
  }
  return { made, failed };
}

/** The one-time baseline could not write every record; the run stops here. */
export class DeliverableBaselineIncompleteError extends Error {
  constructor(readonly failed: number) {
    super(`deliverable baseline incomplete: ${failed} record(s) not written`);
    this.name = 'DeliverableBaselineIncompleteError';
  }
}

const doneWithoutRecord = async (db: PrismaInstance) =>
  (await db.task.findMany({
    where: { status: 'done', deliverableCompletion: { is: null } },
    select: { id: true, workspaceId: true, updatedAt: true, completedAt: true },
  })) as DoneTask[];

/**
 * Step 0: the one-time baseline.
 *
 * @param db - The client, without scope / スコープなしのクライアント
 * @returns Records written / 作成した記録数
 * @throws {DeliverableBaselineIncompleteError} when a record could not be written (no marker) / 記録を書けなかった場合（印を書かない）
 */
export async function ensureDeliverableBaseline(db: PrismaInstance): Promise<number> {
  if (await hasMarker(db, DELIVERABLE_BASELINE_KEY)) return 0;
  const { made, failed } = await createRecords(db, await doneWithoutRecord(db), (t) => ({
    mode: 'baseline',
    state: 'baseline',
    completedAt: t.completedAt ?? t.updatedAt,
  }));
  // NOTE: a write that failed for any reason but "already recorded" leaves the
  // marker unwritten and fails the run (review G2 must-fix 4). Otherwise the
  // same run's step 1 would record that pre-feature task as unknown/pending and
  // create a note from it. The next run retries the baseline from scratch.
  if (failed > 0) throw new DeliverableBaselineIncompleteError(failed);
  await writeMarker(db, DELIVERABLE_BASELINE_KEY, { baselined: made });
  logger.info({ baselined: made }, 'deliverable baseline written');
  return made;
}

interface CandidateRow {
  taskId: number;
  workspaceId: number | null;
  state: string;
  completedAt: Date;
  lastAttemptAt: Date | null;
  task: { status: string; updatedAt: Date } | null;
}

/**
 * Step 2: move re-evaluation candidates (see the file header).
 *
 * @param db - The client, without scope / スコープなしのクライアント
 * @param now - The check's time / 点検の時刻
 * @returns Records touched / 対象にした記録数
 */
export async function reevaluateCandidates(db: PrismaInstance, now: Date): Promise<number> {
  const rows = (await db.taskDeliverableCompletion.findMany({
    where: { state: { in: ['not_eligible', 'created'] }, task: { status: 'done' } },
    select: {
      taskId: true,
      workspaceId: true,
      state: true,
      completedAt: true,
      lastAttemptAt: true,
      task: { select: { status: true, updatedAt: true } },
    },
  })) as CandidateRow[];
  let touched = 0;
  for (const row of rows) {
    if (!row.task || row.task.status !== 'done') continue;
    const since = Math.max(row.completedAt.getTime(), row.lastAttemptAt?.getTime() ?? 0);
    if (row.task.updatedAt.getTime() <= since) continue;
    // Conditioned on the state read, so an entry's pending written meanwhile wins.
    const data = row.state === 'not_eligible' ? { state: 'pending' } : { lastAttemptAt: now };
    const n = (await inWorkspaceOf(row.workspaceId ?? null, () =>
      db.taskDeliverableCompletion.updateMany({
        where: { taskId: row.taskId, state: row.state },
        data,
      }),
    )) as { count: number };
    touched += n.count;
  }
  return touched;
}

/**
 * One full run: baseline (once), unknown completions, re-evaluation, attempts.
 *
 * @param db - The client, without scope / スコープなしのクライアント
 * @param now - The check's time (injectable for tests) / 点検の時刻
 * @returns Counts / 件数
 * @throws {DeliverableBaselineIncompleteError} when the one-time baseline is incomplete; nothing after it runs / 初回の baseline が不完全な場合
 */
export async function runDeliverableCheck(
  db: PrismaInstance,
  now: Date = new Date(),
): Promise<DeliverableCheckResult> {
  const baselined = await ensureDeliverableBaseline(db);
  const { made: found } = await createRecords(db, await doneWithoutRecord(db), () => ({
    mode: 'unknown',
    state: 'pending',
    completedAt: now,
  }));
  const reevaluated = await reevaluateCandidates(db, now);
  const due = (await db.taskDeliverableCompletion.findMany({
    where: {
      OR: [
        { state: 'pending' },
        { state: 'failed', lastAttemptAt: { lt: new Date(now.getTime() - FAILED_RETRY_MS) } },
        { state: 'failed', lastAttemptAt: null },
      ],
    },
    select: { taskId: true },
  })) as { taskId: number }[];
  let attempted = 0;
  for (const { taskId } of due) {
    try {
      await createDeliverableForTask(db, taskId);
      attempted += 1;
    } catch (err) {
      logger.warn({ err, taskId }, 'deliverable attempt failed; continuing');
    }
  }
  const result = { baselined, found, reevaluated, attempted };
  if (baselined || found || reevaluated || attempted) logger.info(result, 'deliverable check');
  return result;
}
