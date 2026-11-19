/**
 * NoteService
 *
 * Reading and writing notes, now that they have a table.
 *
 * Notes were localStorage-only: per-device, outside every backup, and
 * writable only by a mounted React component. This is the other side of
 * moving them, and its shape is deliberately the shape the client already
 * has — string ids, tags as a JSON array, task links as a list of ids plus
 * per-task metadata — so the store can be pointed at it without the rest of
 * the note UI learning a new vocabulary.
 *
 * Writes are keyed by the id the caller supplies (see note-write), which keeps
 * the `/rapitas-note/{taskId}/{noteId}` chips already sitting in task
 * descriptions pointing at the same notes after an import.
 *
 * Not responsible for deciding what a note says — see the callers.
 */
import {
  toRecord,
  WITH_LINKS,
  type NoteRecord,
  type NoteRow,
  type NoteTaskMeta,
  type PrismaInstance,
} from './note-record';

// NOTE: the shapes, limits and the write moved out (note-record, note-limits,
// note-write) when the version contract made the write its own module; they
// are re-exported so existing importers keep one entry point.
export { MAX_NOTE_TITLE, MAX_NOTE_CONTENT, MAX_NOTE_TAGS } from './note-limits';
export type { NoteTaskMeta, NoteRecord, NoteInput } from './note-record';
export {
  saveNote,
  importNotes,
  NoteWriteConflictError,
  NoteContentRejectedError,
} from './note-write';

/**
 * List notes, pinned first and most recently touched next.
 *
 * @param prisma - The client to read through / Prisma クライアント
 * @param taskId - Only notes linked to this task, when given / 指定時はこのタスクに紐づくノートのみ
 * @returns The notes / ノート一覧
 */
export async function listNotes(prisma: PrismaInstance, taskId?: number): Promise<NoteRecord[]> {
  const rows = await prisma.note.findMany({
    ...(taskId !== undefined ? { where: { taskLinks: { some: { taskId } } } } : {}),
    include: WITH_LINKS,
    orderBy: [{ isPinned: 'desc' }, { updatedAt: 'desc' }],
  });
  return rows.map((row: NoteRow) => toRecord(row));
}

/**
 * One note, or null when there is no such note.
 *
 * @param prisma - The client to read through / Prisma クライアント
 * @param id - The note's id / ノートID
 * @returns The note, or null / ノート（無ければ null）
 */
export async function getNote(prisma: PrismaInstance, id: string): Promise<NoteRecord | null> {
  const row = await prisma.note.findUnique({ where: { id }, include: WITH_LINKS });
  return row ? toRecord(row as NoteRow) : null;
}

/**
 * Delete a note and its links.
 *
 * @param prisma - The client to write through / Prisma クライアント
 * @param id - The note to remove / 削除するノート
 * @returns Whether there was one to delete / 削除できたか
 */
export async function deleteNote(prisma: PrismaInstance, id: string): Promise<boolean> {
  const removed = await prisma.note.deleteMany({ where: { id } });
  return removed.count > 0;
}

/**
 * Attach a note to a task, or update the context of an existing attachment.
 *
 * @param prisma - The client to write through / Prisma クライアント
 * @param id - The note / ノート
 * @param taskId - The task / タスク
 * @param meta - Display context captured at link time / 紐づけ時の表示用情報
 */
export async function linkNote(
  prisma: PrismaInstance,
  id: string,
  taskId: number,
  meta?: NoteTaskMeta,
): Promise<void> {
  const payload = meta ? JSON.stringify(meta) : null;
  await prisma.noteTaskLink.upsert({
    where: { noteId_taskId: { noteId: id, taskId } },
    create: { noteId: id, taskId, meta: payload },
    update: { meta: payload },
  });
}

/**
 * Detach a note from a task.
 *
 * @param prisma - The client to write through / Prisma クライアント
 * @param id - The note / ノート
 * @param taskId - The task / タスク
 * @returns Whether there was a link to remove / 紐づけがあったか
 */
export async function unlinkNote(
  prisma: PrismaInstance,
  id: string,
  taskId: number,
): Promise<boolean> {
  const removed = await prisma.noteTaskLink.deleteMany({ where: { noteId: id, taskId } });
  return removed.count > 0;
}
