/**
 * NoteBatch
 *
 * `POST /notes/batch` (design §8.2 L4, §8.3「一括作成の契約」): learning notes,
 * materials and the roadmap's closing note made in one call after a roadmap
 * commit.
 *
 * The contract, per element:
 * 1. Every linked task must be in the request's workspace; otherwise that
 *    element alone is `rejected` (404 task_not_found).
 * 2. The note and its links are written in one transaction; elements are
 *    independent of each other (partial success, per-element results).
 * 3. Create if absent: an existing fixed id is `skipped` — body, title and
 *    placement untouched, only missing links added.
 * 4. The response says created / skipped / rejected (with a reason).
 * 5. Empty bodies are fine; legacy editor HTML is refused.
 * 6. The client never chooses the placement: it is the effective theme of the
 *    source task (learning / material), or for the roadmap note the theme all
 *    its tasks share (none → 未分類), with no source task and no following.
 *
 * Not responsible for generating bodies — the flow sends what it generated,
 * and per nav70 sends nothing for an element whose generation failed.
 */
import { createLogger } from '../../../config/logger';
import type { NoteTaskMeta, PrismaInstance } from '../note-record';
import { MAX_NOTE_CONTENT, MAX_NOTE_TAGS, MAX_NOTE_TITLE } from '../note-limits';
import { requestWorkspaceId } from '../note-scope';
import { checkNewMarkdownContent } from '../note-content-kind';
import { isUniqueViolation } from '../note-write';
import { resolveEffectiveTheme } from '../placement/effective-theme';
import { findTasksInScope, type ScopedTask } from '../placement/placement-scope';
import { columnsFor, type PlacementColumns } from '../placement/placement-types';
import {
  addMissingLinksTx,
  createLinkedNoteTx,
  taskLinkMeta,
} from '../placement/linked-note-create';

const logger = createLogger('note-batch');

/** Sources a batch may create. Deliverable / research belong to the automation. */
export const BATCH_SOURCES = ['learning', 'material', 'roadmap'] as const;
export type BatchSource = (typeof BATCH_SOURCES)[number];

/** Elements one request may carry. */
export const MAX_BATCH_ITEMS = 100;

/** One element as sent. */
export interface BatchItem {
  id: string;
  title?: string;
  content?: string;
  tags?: string[];
  docType?: string | null;
  source: BatchSource;
  taskIds: number[];
}

/** What happened to one element. */
export type BatchResult =
  | { id: string; status: 'created' | 'skipped'; linksAdded: number }
  | { id: string; status: 'rejected'; code: 400 | 404 | 409 | 500; error: string };

const reject = (id: string, code: 400 | 404 | 409 | 500, error: string): BatchResult => ({
  id,
  status: 'rejected',
  code,
  error,
});

/** The fixed-id rule per source; null when the id is acceptable. */
function idRefusal(item: BatchItem): string | null {
  if (item.id.startsWith('deliverable-task-') || item.id.startsWith('research-task-')) {
    return 'reserved_note_id';
  }
  if (item.source === 'learning') {
    return item.id === `learning-task-${item.taskIds[0]}` ? null : 'invalid_fixed_id';
  }
  if (item.source === 'roadmap') return item.id.startsWith('roadmap-') ? null : 'invalid_fixed_id';
  // material: any id the client chose, outside the reserved prefixes.
  return item.id.startsWith('learning-task-') || item.id.startsWith('roadmap-')
    ? 'reserved_note_id'
    : null;
}

async function placementFor(
  db: PrismaInstance,
  item: BatchItem,
  tasks: ScopedTask[],
): Promise<PlacementColumns> {
  if (item.source !== 'roadmap') {
    const theme = await resolveEffectiveTheme(db, item.taskIds[0] as number);
    return theme === null ? columnsFor('none') : columnsFor('theme', theme);
  }
  const themes = new Set<number | null>();
  for (const t of tasks) themes.add(await resolveEffectiveTheme(db, t.id));
  const [only] = [...themes];
  return themes.size === 1 && typeof only === 'number'
    ? columnsFor('theme', only)
    : columnsFor('none');
}

async function runOne(db: PrismaInstance, item: BatchItem): Promise<BatchResult> {
  if (item.taskIds.length === 0) return reject(item.id, 400, 'task_required');
  const idError = idRefusal(item);
  if (idError) return reject(item.id, 400, idError);
  const content = (item.content ?? '').slice(0, MAX_NOTE_CONTENT);
  if (checkNewMarkdownContent(content)) return reject(item.id, 400, 'legacy_html_content');

  const found = await findTasksInScope(db, item.taskIds);
  if (item.taskIds.some((id) => !found.has(id))) return reject(item.id, 404, 'task_not_found');
  const tasks = [...new Set(item.taskIds)].map((id) => found.get(id) as ScopedTask);
  const meta = new Map<number, NoteTaskMeta>();
  for (const t of tasks) meta.set(t.id, await taskLinkMeta(db, t));
  const ws = requestWorkspaceId();

  const existing = await db.note.findFirst({
    where: { id: item.id, workspaceId: ws },
    select: { id: true },
  });
  // Contract 3: an existing id keeps its body and placement; only missing links are added.
  const skipExisting = async (): Promise<BatchResult> => {
    const linksAdded = (await db.$transaction((tx: PrismaInstance) =>
      addMissingLinksTx(tx, item.id, item.taskIds, meta),
    )) as number;
    return { id: item.id, status: 'skipped', linksAdded };
  };
  if (existing) return skipExisting();

  const placement = await placementFor(db, item, tasks);
  const roadmap = item.source === 'roadmap';
  try {
    await db.$transaction((tx: PrismaInstance) =>
      createLinkedNoteTx(tx, {
        id: item.id,
        title: (item.title ?? '').slice(0, MAX_NOTE_TITLE),
        content,
        tags: (item.tags ?? [])
          .map((t) => t.trim())
          .filter(Boolean)
          .slice(0, MAX_NOTE_TAGS),
        docType: item.docType ?? null,
        source: item.source,
        sourceTaskId: roadmap ? null : (item.taskIds[0] as number),
        followsTask: !roadmap,
        sourceRef: JSON.stringify({ via: 'batch', taskIds: item.taskIds }),
        placement,
        taskIds: item.taskIds,
        meta,
      }),
    );
  } catch (error) {
    // Taken since the check — by this workspace (a concurrent identical
    // request) or by another one. Either way nothing of ours was written.
    if (!isUniqueViolation(error)) throw error;
    const mine = await db.note.findFirst({
      where: { id: item.id, workspaceId: ws },
      select: { id: true },
    });
    // NOTE: the late request of a concurrent resend takes the same existing-id
    // path, so the links it carries are not lost (review G2 must-fix 7).
    if (mine) return skipExisting();
    return reject(item.id, 409, 'id_conflict');
  }
  return { id: item.id, status: 'created', linksAdded: new Set(item.taskIds).size };
}

/**
 * Create the batch's notes, element by element.
 *
 * @param db - Client / クライアント
 * @param items - The elements / 要素
 * @returns One result per element, in order / 要素ごとの結果
 */
export async function createNotesBatch(
  db: PrismaInstance,
  items: BatchItem[],
): Promise<BatchResult[]> {
  const out: BatchResult[] = [];
  for (const item of items) {
    try {
      out.push(await runOne(db, item));
    } catch (err) {
      // The element's transaction rolled back; the others are unaffected.
      logger.warn({ err, noteId: item.id }, 'batch element failed');
      out.push(reject(item.id, 500, 'write_failed'));
    }
  }
  return out;
}
