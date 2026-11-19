/**
 * NoteRecord
 *
 * The note shapes the services share: the record the client speaks, the
 * writable input, the row the clients return, and the conversions between
 * them. Not responsible for any read or write — see note-service, note-write.
 */
import type { PrismaClient } from '../../generated/prisma-postgres';
import { MAX_NOTE_CONTENT, MAX_NOTE_TAGS, MAX_NOTE_TITLE } from './note-limits';
import type { PlacementInput } from './placement/placement-write';

// The same alias the task service uses: the two generated clients differ by
// provider only, and every call here is in their common shape.
export type PrismaInstance = InstanceType<typeof PrismaClient>;

/**
 * Per-task context captured when a note was linked from a task.
 *
 * NOTE: `taskTitle` / `categoryName` were added in stage 0 so the desktop
 * (which builds its tree from category > theme > task) and the phone (which
 * shows project / theme / parent task) write and read one shape.
 */
export interface NoteTaskMeta {
  taskTitle?: string;
  categoryName?: string;
  themeName?: string;
  projectName?: string;
  parentTaskTitle?: string;
}

/** The meta keys, in one place for the merge and the validators. */
export const NOTE_TASK_META_KEYS = [
  'taskTitle',
  'categoryName',
  'themeName',
  'projectName',
  'parentTaskTitle',
] as const satisfies readonly (keyof NoteTaskMeta)[];

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

/**
 * What a write may set. Everything optional: a PATCH is a partial note.
 * `placement` / `source` (stage 1) are handled by placement-write; the
 * server-only columns (sourceTaskId, followsTask, sourceRef) are not here.
 */
export interface NoteInput extends PlacementInput {
  title?: string;
  content?: string;
  isPinned?: boolean;
  tags?: string[];
  color?: string | null;
  docType?: string | null;
}

/** The row shape these services read, independent of which client produced it. */
export interface NoteRow {
  id: string;
  workspaceId?: number | null;
  title: string;
  content: string;
  isPinned: boolean;
  tags: string;
  color: string | null;
  docType: string | null;
  version?: string | null;
  createdAt: Date;
  updatedAt: Date;
  taskLinks?: { taskId: number; meta: string | null }[];
  // Stage-1 columns; optional so pre-stage-1 rows and stand-ins still fit.
  themeId?: number | null;
  categoryId?: number | null;
  folderId?: number | null;
  sourceTaskId?: number | null;
  followsTask?: boolean;
  source?: string;
  sourceRef?: string | null;
}

/** The stored form of the writable fields, after trimming and bounding. */
export interface SanitizedNoteInput {
  title?: string;
  content?: string;
  isPinned?: boolean;
  tags?: string;
  color?: string | null;
  docType?: string | null;
}

/**
 * Parse a JSON column without letting one bad row take down a list.
 *
 * @param value - The column / 列の値
 * @param fallback - What to return when it is empty or not JSON / 空または不正なときの値
 * @returns The parsed value / 解析結果
 */
export function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/**
 * Turn a row into the shape the client already speaks.
 *
 * @param row - A note row with its links / リンク付きのノート行
 * @returns The client record / クライアント向けのノート
 */
export function toRecord(row: NoteRow): NoteRecord {
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

/**
 * Trim and bound the fields a write may carry.
 *
 * @param input - What the caller sent / 送られた内容
 * @returns Only the fields that were sent, in stored form / 送られた項目だけを保存形式で
 */
export function sanitize(input: NoteInput): SanitizedNoteInput {
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

export const WITH_LINKS = { taskLinks: { select: { taskId: true, meta: true } } } as const;
