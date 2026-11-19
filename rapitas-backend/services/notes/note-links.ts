/**
 * NoteLinks
 *
 * Linking notes to tasks inside the request's workspace (design §2.2), and
 * the migration's link import that adds what is missing without overwriting
 * what the server has (design §5.3 step 5).
 *
 * Both endpoints look the task up in the request's scope and compare its
 * workspace for equality before writing — the client extension alone passes
 * an unscoped request through and would let it link to any workspace's task.
 * A task that does not exist and a task in another workspace both answer 404,
 * so the response says nothing about other workspaces.
 *
 * Not responsible for the plain link write (note-service's linkNote).
 */
import {
  NOTE_TASK_META_KEYS,
  parseJson,
  type NoteTaskMeta,
  type PrismaInstance,
} from './note-record';
import { isInScope, requestWorkspaceId, scopeWhere } from './note-scope';
import { linkNote } from './note-service';
import { isUniqueViolation } from './note-write';

const MAX_LINK_ATTEMPTS = 3;

/**
 * Whether the task exists in the request's workspace.
 *
 * @param prisma - The client to read through / Prisma クライアント
 * @param taskId - The task / タスクID
 * @returns true when it is in scope / 範囲内にあれば true
 */
export async function isTaskInScope(prisma: PrismaInstance, taskId: number): Promise<boolean> {
  const row = await prisma.task.findFirst({
    where: { id: taskId, ...scopeWhere() },
    select: { id: true, workspaceId: true },
  });
  return isInScope(row as { workspaceId: number | null } | null);
}

/**
 * Whether the note exists in the request's workspace.
 *
 * @param prisma - The client to read through / Prisma クライアント
 * @param id - The note / ノートID
 * @returns true when it is in scope / 範囲内にあれば true
 */
export async function isNoteInScope(prisma: PrismaInstance, id: string): Promise<boolean> {
  const row = await prisma.note.findFirst({
    where: { id, ...scopeWhere() },
    select: { id: true, workspaceId: true },
  });
  return isInScope(row as { workspaceId: number | null } | null);
}

/** Keep only the known meta keys that carry text. */
export function cleanMeta(meta: NoteTaskMeta | undefined | null): NoteTaskMeta {
  const out: NoteTaskMeta = {};
  if (!meta) return out;
  for (const key of NOTE_TASK_META_KEYS) {
    const value = meta[key];
    if (typeof value === 'string' && value.trim() !== '') out[key] = value;
  }
  return out;
}

/**
 * The server's meta with only its empty keys filled from the incoming one.
 *
 * @param existing - What the server has / サーバーの meta
 * @param incoming - What the browser had / ブラウザの meta
 * @returns The merged meta, and whether anything was filled / 結合結果と変更の有無
 */
export function fillEmptyMeta(
  existing: Record<string, unknown>,
  incoming: NoteTaskMeta,
): { merged: Record<string, unknown>; changed: boolean } {
  const merged = { ...existing };
  let changed = false;
  for (const key of NOTE_TASK_META_KEYS) {
    const current = merged[key];
    const empty = current === undefined || current === null || String(current).trim() === '';
    if (empty && incoming[key]) {
      merged[key] = incoming[key];
      changed = true;
    }
  }
  return { merged, changed };
}

/** Why a link write was not made. */
export type LinkRefusal = 'note_not_found' | 'task_not_found';

/**
 * Link a note to a task after checking both are in the request's workspace.
 *
 * @param prisma - The client to write through / Prisma クライアント
 * @param id - The note / ノートID
 * @param taskId - The task / タスクID
 * @param meta - Display context / 表示用情報
 * @returns null when linked, otherwise what was missing / 紐付けたら null、無ければ理由
 */
export async function linkNoteInScope(
  prisma: PrismaInstance,
  id: string,
  taskId: number,
  meta?: NoteTaskMeta,
): Promise<LinkRefusal | null> {
  if (!(await isNoteInScope(prisma, id))) return 'note_not_found';
  if (!(await isTaskInScope(prisma, taskId))) return 'task_not_found';
  const cleaned = cleanMeta(meta);
  await linkNote(prisma, id, taskId, Object.keys(cleaned).length > 0 ? cleaned : undefined);
  return null;
}

/** One link the browser had. */
export interface LinkImportItem {
  noteId: string;
  taskId: number;
  meta?: NoteTaskMeta;
}

/** What the import did with one link. */
export type LinkImportResult =
  | { noteId: string; taskId: number; status: 'added' | 'filled' | 'unchanged' }
  | {
      noteId: string;
      taskId: number;
      status: 'rejected';
      code: 404 | 409;
      error: LinkRefusal | 'link_busy';
    };

async function importOne(prisma: PrismaInstance, item: LinkImportItem): Promise<LinkImportResult> {
  const { noteId, taskId } = item;
  if (!(await isNoteInScope(prisma, noteId))) {
    return { noteId, taskId, status: 'rejected', code: 404, error: 'note_not_found' };
  }
  if (!(await isTaskInScope(prisma, taskId))) {
    return { noteId, taskId, status: 'rejected', code: 404, error: 'task_not_found' };
  }
  const incoming = cleanMeta(item.meta);
  for (let attempt = 0; attempt < MAX_LINK_ATTEMPTS; attempt += 1) {
    const existing = (await prisma.noteTaskLink.findFirst({
      where: { noteId, taskId },
    })) as { id: number; meta: string | null } | null;
    if (!existing) {
      try {
        await prisma.noteTaskLink.create({
          data: {
            noteId,
            taskId,
            meta: Object.keys(incoming).length > 0 ? JSON.stringify(incoming) : null,
            workspaceId: requestWorkspaceId(),
          },
        });
        return { noteId, taskId, status: 'added' };
      } catch (error) {
        if (isUniqueViolation(error)) continue;
        throw error;
      }
    }
    const current = parseJson<Record<string, unknown>>(existing.meta, {});
    const { merged, changed } = fillEmptyMeta(current, incoming);
    if (!changed) return { noteId, taskId, status: 'unchanged' };
    // Conditional on the meta that was read, so a phone writing meta in
    // between is not overwritten by this fill.
    const updated = await prisma.noteTaskLink.updateMany({
      where: { id: existing.id, meta: existing.meta },
      data: { meta: JSON.stringify(merged) },
    });
    if (updated.count === 1) return { noteId, taskId, status: 'filled' };
  }
  return { noteId, taskId, status: 'rejected', code: 409, error: 'link_busy' };
}

/**
 * Add the browser's links the server lacks; for links it has, only fill
 * meta keys that are empty there. Never replaces the server's meta.
 *
 * @param prisma - The client to write through / Prisma クライアント
 * @param items - The browser's links / ブラウザの紐付け
 * @returns One result per link, in order / 要素ごとの結果
 */
export async function importNoteLinks(
  prisma: PrismaInstance,
  items: LinkImportItem[],
): Promise<LinkImportResult[]> {
  const out: LinkImportResult[] = [];
  for (const item of items) out.push(await importOne(prisma, item));
  return out;
}
