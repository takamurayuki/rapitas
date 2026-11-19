/**
 * NoteVersionBackfill
 *
 * Fills `version` on rows written before the column existed (design §5.3
 * 「既存の行の埋め戻し」). Safe to run any number of times and alongside
 * normal edits, because it writes only under the condition
 * `version IS NULL AND updatedAt = <the updatedAt it read>`: if a normal edit
 * got there first (and wrote its own version), the backfill does nothing.
 *
 * Ordering matters and is why this is a separate step: the write paths that
 * maintain `version` (note-write) are live first; only then is this run, and
 * the migration manifest runs it for its own scope before listing, so every
 * version a client is shown is filled.
 *
 * Not responsible for normal writes — see note-write.
 */
import { createLogger } from '../../config/logger';
import type { PrismaInstance } from './note-record';
import { computeNoteVersion } from './note-version';
import { scopeWhere } from './note-scope';

const logger = createLogger('note-version-backfill');

/** Rows read per round; keeps a large backlog from loading every body at once. */
const BATCH_SIZE = 200;
/** Re-reads one row gets when its updatedAt keeps moving. */
const MAX_ROW_ATTEMPTS = 3;

interface BackfillRow {
  id: string;
  title: string;
  content: string;
  tags: string;
  docType: string | null;
  version: string | null;
  updatedAt: Date;
}

const SELECT = {
  id: true,
  title: true,
  content: true,
  tags: true,
  docType: true,
  version: true,
  updatedAt: true,
} as const;

/**
 * Fill one row's version unless a normal write fills it first.
 *
 * @returns true when this call wrote the version / この呼び出しで書いたら true
 */
async function backfillRow(prisma: PrismaInstance, first: BackfillRow): Promise<boolean> {
  let row: BackfillRow | null = first;
  for (let attempt = 0; attempt < MAX_ROW_ATTEMPTS && row; attempt += 1) {
    if (row.version) return false;
    const version = computeNoteVersion(row);
    const result = await prisma.note.updateMany({
      where: { id: row.id, ...scopeWhere(), version: null, updatedAt: row.updatedAt },
      // NOTE: updatedAt is written back as it was. Prisma's @updatedAt would
      // otherwise stamp every old note "just edited", and the migration picks
      // its default side by the newer updatedAt.
      data: { version, updatedAt: row.updatedAt },
    });
    if (result.count === 1) return true;
    row = (await prisma.note.findFirst({
      where: { id: row.id, ...scopeWhere() },
      select: SELECT,
    })) as BackfillRow | null;
  }
  return false;
}

/**
 * Fill `version` on every row in the request's scope that lacks one.
 *
 * @param prisma - The client to write through / Prisma クライアント
 * @returns How many rows this run filled / 今回埋めた件数
 */
export async function backfillNoteVersions(prisma: PrismaInstance): Promise<number> {
  let filled = 0;
  const skipped = new Set<string>();
  for (;;) {
    const rows = (await prisma.note.findMany({
      where: { ...scopeWhere(), version: null },
      select: SELECT,
      orderBy: { id: 'asc' },
      take: BATCH_SIZE + skipped.size,
    })) as BackfillRow[];
    const pending = rows.filter((r) => !skipped.has(r.id));
    if (pending.length === 0) break;
    for (const row of pending) {
      if (await backfillRow(prisma, row)) filled += 1;
      // A row that is still NULL after its attempts is left for the next run
      // rather than looping here forever.
      else skipped.add(row.id);
    }
  }
  if (filled > 0 || skipped.size > 0) {
    logger.info({ filled, deferred: skipped.size }, 'note versions backfilled');
  }
  return filled;
}
