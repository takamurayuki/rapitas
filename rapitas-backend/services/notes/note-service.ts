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
 * Writes are upserts keyed by the id the caller supplies. That is what makes
 * importing a browser's existing notes a plain write rather than a migration
 * with an id mapping, and it keeps the
 * `/rapitas-note/{taskId}/{noteId}` chips already sitting in task
 * descriptions pointing at the same notes afterwards.
 *
 * Not responsible for deciding what a note says — see the callers.
 */
import { PrismaClient } from '../../generated/prisma-postgres';
import { createLogger } from '../../config/logger';

// The same alias the task service uses: the two generated clients differ by
// provider only, and every call here is in their common shape.
type PrismaInstance = InstanceType<typeof PrismaClient>;

const logger = createLogger('note-service');

/** Caps so one request cannot post a document the size of the backlog. */
export const MAX_NOTE_TITLE = 300;
export const MAX_NOTE_CONTENT = 200_000;
export const MAX_NOTE_TAGS = 30;

/** Per-task context captured when a note was linked from a task. */
export interface NoteTaskMeta {
  themeName?: string;
  projectName?: string;
  parentTaskTitle?: string;
}

/** A note as the client knows it. */
export interface NoteRecord {
  id: string;
  title: string;
  content: string;
  isPinned: boolean;
  tags: string[];
  color?: string;
  docType?: string;
  createdAt: Date;
  updatedAt: Date;
  linkedTaskIds: number[];
  linkedTaskMeta: Record<number, NoteTaskMeta>;
}

/** What a write may set. Everything optional: a PATCH is a partial note. */
export interface NoteInput {
  title?: string;
  content?: string;
  isPinned?: boolean;
  tags?: string[];
  color?: string | null;
  docType?: string | null;
}

/** The row shape this service reads, independent of which client produced it. */
interface NoteRow {
  id: string;
  title: string;
  content: string;
  isPinned: boolean;
  tags: string;
  color: string | null;
  docType: string | null;
  createdAt: Date;
  updatedAt: Date;
  taskLinks?: { taskId: number; meta: string | null }[];
}

/** Parse a JSON column without letting one bad row take down a list. */
function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/** Turn a row into the shape the client already speaks. */
function toRecord(row: NoteRow): NoteRecord {
  const links = row.taskLinks ?? [];
  const meta: Record<number, NoteTaskMeta> = {};
  for (const link of links) {
    const parsed = parseJson<NoteTaskMeta | null>(link.meta, null);
    if (parsed) meta[link.taskId] = parsed;
  }
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    isPinned: row.isPinned,
    tags: parseJson<string[]>(row.tags, []),
    ...(row.color ? { color: row.color } : {}),
    ...(row.docType ? { docType: row.docType } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    linkedTaskIds: links.map((l) => l.taskId),
    linkedTaskMeta: meta,
  };
}

/** Trim and bound the fields a write may carry. */
function sanitize(input: NoteInput) {
  const tags = input.tags
    ? input.tags
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, MAX_NOTE_TAGS)
    : undefined;
  return {
    ...(input.title !== undefined ? { title: input.title.slice(0, MAX_NOTE_TITLE) } : {}),
    ...(input.content !== undefined ? { content: input.content.slice(0, MAX_NOTE_CONTENT) } : {}),
    ...(input.isPinned !== undefined ? { isPinned: input.isPinned } : {}),
    ...(tags ? { tags: JSON.stringify(tags) } : {}),
    ...(input.color !== undefined ? { color: input.color } : {}),
    ...(input.docType !== undefined ? { docType: input.docType } : {}),
  };
}

const WITH_LINKS = { taskLinks: { select: { taskId: true, meta: true } } } as const;

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
 * Write a note under the id the caller chose, creating or updating it.
 *
 * The caller owning the id is the point: a browser's existing note keeps the
 * id its links already use, so importing one is this call and nothing else.
 *
 * @param prisma - The client to write through / Prisma クライアント
 * @param id - The id to write under / 書き込むID
 * @param input - What to set / 設定する内容
 * @returns The stored note / 保存後のノート
 */
export async function saveNote(
  prisma: PrismaInstance,
  id: string,
  input: NoteInput,
): Promise<NoteRecord> {
  const data = sanitize(input);
  const row = await prisma.note.upsert({
    where: { id },
    // A note has to have a title column even when the caller only sent
    // content, so creation falls back to an empty one rather than refusing.
    create: { id, title: '', ...data },
    update: data,
    include: WITH_LINKS,
  });
  return toRecord(row as NoteRow);
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

/**
 * Take in notes that were living in a browser.
 *
 * Existing ids are left alone rather than overwritten: the import runs from
 * whichever browser still has local notes, possibly more than once and
 * possibly after the server copy has moved on. Skipping is the only choice
 * that cannot destroy the newer version.
 *
 * @param prisma - The client to write through / Prisma クライアント
 * @param notes - What the browser had / ブラウザが持っていたノート
 * @returns How many were taken in and how many already existed / 取り込み件数と既存件数
 */
export async function importNotes(
  prisma: PrismaInstance,
  notes: ({ id: string } & NoteInput)[],
): Promise<{ imported: number; skipped: number }> {
  let imported = 0;
  let skipped = 0;
  for (const note of notes) {
    const existing = await prisma.note.findUnique({ where: { id: note.id } });
    if (existing) {
      skipped += 1;
      continue;
    }
    const { id, ...rest } = note;
    await prisma.note.create({ data: { id, title: '', ...sanitize(rest) } });
    imported += 1;
  }
  logger.info({ imported, skipped }, 'notes imported');
  return { imported, skipped };
}
