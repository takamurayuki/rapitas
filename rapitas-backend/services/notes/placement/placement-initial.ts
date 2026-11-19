/**
 * PlacementInitial
 *
 * The one-time migration that gives the notes existing before stage 1 a
 * placement (design §2.2「既存ノートの初期値」): a note whose linked tasks all
 * have the same effective theme goes to that theme; every other note stays
 * 未分類. `followsTask` stays false — these are not deliverables.
 *
 * Runs once (NoteMigrationMarker). A re-run after the marker is a no-op, so a
 * note a person later moved to 未分類 is never pulled back. Before the marker
 * exists the run is still safe to repeat: it only touches notes that are
 * still unplaced, with a condition on that, and writes `updatedAt` back as it
 * was so the list order does not change.
 *
 * Background rule (§2.2): each note's workspace is read first and the tasks /
 * theme are resolved inside it; a linked task of another workspace counts as
 * "no theme", which leaves the note 未分類.
 */
import { createLogger } from '../../../config/logger';
import type { PrismaInstance } from '../note-record';
import { resolveEffectiveTheme } from './effective-theme';
import { inWorkspaceOf, type ScopedTask } from './placement-scope';
import { hasMarker, PLACEMENT_INITIAL_KEY, writeMarker } from './migration-marker';

const logger = createLogger('note-placement-initial');

interface UnplacedNote {
  id: string;
  workspaceId: number | null;
  updatedAt: Date;
  taskLinks?: { taskId: number }[];
}

/** What the run did. */
export interface PlacementInitialResult {
  skipped: boolean;
  placed: number;
  unclassified: number;
}

async function placeOne(
  db: PrismaInstance,
  note: UnplacedNote,
  cache: Map<number, ScopedTask | null>,
) {
  const taskIds = [...new Set((note.taskLinks ?? []).map((l) => l.taskId))];
  if (taskIds.length === 0) return false;
  return inWorkspaceOf(note.workspaceId ?? null, async () => {
    const themes = new Set<number | null>();
    for (const id of taskIds) themes.add(await resolveEffectiveTheme(db, id, { cache }));
    const [only] = [...themes];
    if (themes.size !== 1 || typeof only !== 'number') return false;
    const moved = await db.note.updateMany({
      where: {
        id: note.id,
        workspaceId: note.workspaceId ?? null,
        themeId: null,
        categoryId: null,
        folderId: null,
      },
      data: { themeId: only, updatedAt: note.updatedAt },
    });
    return moved.count === 1;
  });
}

/**
 * Run the initial placement once.
 *
 * @param db - The client, used without a workspace scope / スコープなしのクライアント
 * @returns Counts, or skipped when it already ran / 件数（実行済みなら skipped）
 */
export async function runPlacementInitialMigration(
  db: PrismaInstance,
): Promise<PlacementInitialResult> {
  if (await hasMarker(db, PLACEMENT_INITIAL_KEY))
    return { skipped: true, placed: 0, unclassified: 0 };
  const notes = (await db.note.findMany({
    where: { themeId: null, categoryId: null, folderId: null },
    select: {
      id: true,
      workspaceId: true,
      updatedAt: true,
      taskLinks: { select: { taskId: true } },
    },
  })) as UnplacedNote[];
  let placed = 0;
  // One cache per workspace: a task row read for one workspace is never
  // reused for another.
  const caches = new Map<number | null, Map<number, ScopedTask | null>>();
  for (const note of notes) {
    const ws = note.workspaceId ?? null;
    if (!caches.has(ws)) caches.set(ws, new Map());
    if (await placeOne(db, note, caches.get(ws) as Map<number, ScopedTask | null>)) placed += 1;
  }
  const result = { skipped: false, placed, unclassified: notes.length - placed };
  await writeMarker(db, PLACEMENT_INITIAL_KEY, result);
  logger.info(result, 'initial note placement applied');
  return result;
}
