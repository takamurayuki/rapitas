/**
 * PlacementConsistencyJob
 *
 * The hourly (and at-start) safety net of design §2.2 contract 6. Theme
 * changes can reach a task by paths other than the task service, so this
 * finds following deliverables whose placement differs from their source
 * task's non-NULL effective theme and moves them. It is, with the follow on
 * task update, the only writer of automatic placement — reads never move a
 * note.
 *
 * It also normalises: a note with `followsTask = true` whose source task is
 * gone gets `followsTask = false`, placement unchanged. "Gone" covers both
 * `sourceTaskId` NULL (the FK's SetNull) and a sourceTaskId that names no
 * task row at all, which a self-healed desktop database can produce (its new
 * columns are added without the foreign key) — that case also clears the
 * dangling id, as SetNull would have.
 *
 * Background rule: every note is read without scope, its own workspaceId is
 * taken as its membership, and the task / theme lookups and the write happen
 * inside that workspace, in one transaction per note. A source task found
 * only in another workspace is logged and skipped, never followed.
 */
import { createLogger } from '../../../config/logger';
import type { PrismaInstance } from '../note-record';
import { followOne } from './note-follow';
import { inWorkspaceOf } from './placement-scope';
import { runAcrossAllWorkspaces } from '../../tenancy/workspace-context';

const logger = createLogger('note-placement-check');

interface FollowingRow {
  id: string;
  workspaceId: number | null;
  sourceTaskId: number | null;
  themeId: number | null;
  categoryId: number | null;
  folderId: number | null;
}

/** What one run did. */
export interface ConsistencyResult {
  moved: number;
  normalized: number;
  skippedForeign: number;
}

async function runInTx<T>(db: PrismaInstance, fn: (tx: PrismaInstance) => Promise<T>): Promise<T> {
  return typeof (db as { $transaction?: unknown }).$transaction === 'function'
    ? ((await db.$transaction((tx: PrismaInstance) => fn(tx))) as T)
    : fn(db);
}

type Outcome = 'moved' | 'normalized' | 'foreign' | 'none';

async function checkOne(db: PrismaInstance, row: FollowingRow): Promise<Outcome> {
  const ws = row.workspaceId ?? null;
  return inWorkspaceOf(ws, () =>
    runInTx(db, async (tx) => {
      if (row.sourceTaskId === null) {
        const n = await tx.note.updateMany({
          where: { id: row.id, workspaceId: ws, followsTask: true, sourceTaskId: null },
          data: { followsTask: false },
        });
        return n.count === 1 ? 'normalized' : 'none';
      }
      const inScope = await tx.task.findFirst({
        where: { id: row.sourceTaskId, workspaceId: ws },
        select: { id: true },
      });
      if (!inScope) {
        // Unscoped on purpose: only "does any workspace have it" is asked.
        const anywhere = await runAcrossAllWorkspaces(() =>
          tx.task.count({ where: { id: row.sourceTaskId as number } }),
        );
        if (anywhere > 0) {
          logger.warn(
            { noteId: row.id, sourceTaskId: row.sourceTaskId, workspaceId: ws },
            'source task is in another workspace; not following',
          );
          return 'foreign';
        }
        const n = await tx.note.updateMany({
          where: { id: row.id, workspaceId: ws, followsTask: true, sourceTaskId: row.sourceTaskId },
          data: { followsTask: false, sourceTaskId: null },
        });
        return n.count === 1 ? 'normalized' : 'none';
      }
      return (await followOne(tx, row)) ? 'moved' : 'none';
    }),
  );
}

/**
 * One pass of the consistency check over every workspace.
 *
 * @param db - The client, used without a workspace scope / スコープなしのクライアント
 * @returns Counts of moved and normalised notes / 移動・正規化の件数
 */
export async function runPlacementConsistencyCheck(db: PrismaInstance): Promise<ConsistencyResult> {
  const rows = (await db.note.findMany({
    where: { followsTask: true },
    select: {
      id: true,
      workspaceId: true,
      sourceTaskId: true,
      themeId: true,
      categoryId: true,
      folderId: true,
    },
  })) as FollowingRow[];
  const result: ConsistencyResult = { moved: 0, normalized: 0, skippedForeign: 0 };
  for (const row of rows) {
    try {
      const outcome = await checkOne(db, row);
      if (outcome === 'moved') result.moved += 1;
      else if (outcome === 'normalized') result.normalized += 1;
      else if (outcome === 'foreign') result.skippedForeign += 1;
    } catch (err) {
      logger.warn({ err, noteId: row.id }, 'placement check failed for one note; continuing');
    }
  }
  if (result.moved || result.normalized || result.skippedForeign) {
    logger.info(result, 'note placement consistency check');
  }
  return result;
}
