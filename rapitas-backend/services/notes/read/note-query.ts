/**
 * NoteQuery
 *
 * `GET /notes` with the stage-1 parameters (design §2.2 API table): filter by
 * placement, task and source, search title / content (partial match), page
 * with a keyset cursor, and return a summary (`excerpt`) instead of the body.
 *
 * The placement filters are the column form of describePlacement's rule —
 * theme first, then category, then folder, skipping a column that names a
 * row outside the workspace — so a list filtered by `themeId=N` holds exactly
 * the notes the tree counts under theme N, and `none` exactly 未分類.
 *
 * Reads only; it never moves a note (contract 3). The workspace condition is
 * explicit (`workspaceId` = the request's, NULL partition when none).
 *
 * Not responsible for the plain `GET /notes` without parameters — that keeps
 * its stage-0 behaviour in note-service.
 */
import { WITH_LINKS, type NoteRow, type PrismaInstance } from '../note-record';
import { requestWorkspaceId } from '../note-scope';
import { loadPlacementLookup } from '../placement/describe-placement';
import { toPlacedRecord, type PlacedNoteRecord } from '../placement/placed-record';
import { findTaskInScope } from '../placement/placement-scope';

/** Largest page a caller may ask for. */
export const MAX_NOTE_PAGE = 200;
/** Page size when a cursor is sent without a limit. */
export const DEFAULT_NOTE_PAGE = 50;
/** Code points an excerpt keeps. */
export const NOTE_EXCERPT_LENGTH = 200;

/** `source=artifacts` selects every 成果物 (source other than manual / chat). */
export const ARTIFACT_SOURCE_ALIAS = 'artifacts';

/** A placement filter value: an id, or `none` for 未分類. */
export type PlacementFilter = number | 'none';

/** The stage-1 list parameters, already parsed. */
export interface NoteQuery {
  taskId?: number;
  themeId?: PlacementFilter;
  categoryId?: PlacementFilter;
  folderId?: PlacementFilter;
  q?: string;
  sources?: string[];
  limit?: number;
  cursor?: string;
  summary?: boolean;
}

/** A refused query, with the status to answer. */
export class NoteQueryError extends Error {
  constructor(
    readonly code:
      | 'conflicting_placement_filters'
      | 'theme_not_found'
      | 'category_not_found'
      | 'folder_not_found'
      | 'task_not_found'
      | 'invalid_cursor',
    readonly status: 400 | 404,
  ) {
    super(code);
    this.name = 'NoteQueryError';
  }
}

/** A list element in summary form: no body, an excerpt instead. */
export type NoteSummary = Omit<PlacedNoteRecord, 'content'> & { excerpt: string };

/** One page of the list. */
export interface NotePage {
  notes: (PlacedNoteRecord | NoteSummary)[];
  /** Pass back as `cursor` for the next page; null on the last one. */
  nextCursor: string | null;
}

type Where = Record<string, unknown>;

const nullOrNotIn = (key: string, ids: number[]): Where => ({
  OR: [{ [key]: null }, { [key]: { notIn: ids } }],
});

async function allIds(db: PrismaInstance) {
  const lookup = await loadPlacementLookup(db, {
    themeIds: 'all',
    categoryIds: 'all',
    folderIds: 'all',
  });
  return {
    themes: [...lookup.themes.keys()],
    categories: [...lookup.categories.keys()],
    folders: [...lookup.folders.keys()],
  };
}

/**
 * The `where` fragments for the one placement filter that was sent.
 *
 * @param db - Client / クライアント
 * @param query - The parsed query / 解析済みのクエリ
 * @returns Conditions to AND together / AND で結ぶ条件
 * @throws {NoteQueryError} for two filters at once (400) or a target outside the workspace (404)
 */
export async function placementConditions(db: PrismaInstance, query: NoteQuery): Promise<Where[]> {
  const sent = (['themeId', 'categoryId', 'folderId'] as const).filter(
    (k) => query[k] !== undefined,
  );
  if (sent.length === 0) return [];
  if (sent.length > 1) throw new NoteQueryError('conflicting_placement_filters', 400);
  const key = sent[0] as 'themeId' | 'categoryId' | 'folderId';
  const value = query[key] as PlacementFilter;
  const ids = await allIds(db);
  if (value === 'none') {
    return [
      nullOrNotIn('themeId', ids.themes),
      nullOrNotIn('categoryId', ids.categories),
      nullOrNotIn('folderId', ids.folders),
    ];
  }
  if (key === 'themeId') {
    if (!ids.themes.includes(value)) throw new NoteQueryError('theme_not_found', 404);
    return [{ themeId: value }];
  }
  if (key === 'categoryId') {
    if (!ids.categories.includes(value)) throw new NoteQueryError('category_not_found', 404);
    return [{ categoryId: value }, nullOrNotIn('themeId', ids.themes)];
  }
  if (!ids.folders.includes(value)) throw new NoteQueryError('folder_not_found', 404);
  return [
    { folderId: value },
    nullOrNotIn('themeId', ids.themes),
    nullOrNotIn('categoryId', ids.categories),
  ];
}

/**
 * The `where` fragment of a task filter, after checking the task is in the
 * request's workspace (§2.2: a related row is compared for equality; a task
 * elsewhere is the same 404 as a missing one). Used by this list and by the
 * stage-0 `GET /notes?taskId=` so neither lists across workspaces.
 *
 * @param db - Client / クライアント
 * @param taskId - The task / タスクID
 * @returns The condition to AND in / AND で結ぶ条件
 * @throws {NoteQueryError} task_not_found (404) when the task is not in scope
 */
export async function taskFilterCondition(db: PrismaInstance, taskId: number): Promise<Where> {
  if (!(await findTaskInScope(db, taskId))) throw new NoteQueryError('task_not_found', 404);
  return { taskLinks: { some: { taskId } } };
}

interface Cursor {
  p: boolean;
  u: string;
  i: string;
}

/** Encode the position after a row. */
export function encodeCursor(row: { isPinned: boolean; updatedAt: Date; id: string }): string {
  const payload: Cursor = { p: row.isPinned, u: row.updatedAt.toISOString(), i: row.id };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): Cursor {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Cursor;
    if (typeof parsed.p !== 'boolean' || typeof parsed.i !== 'string') throw new Error('shape');
    if (!Number.isFinite(Date.parse(parsed.u))) throw new Error('date');
    return parsed;
  } catch {
    throw new NoteQueryError('invalid_cursor', 400);
  }
}

/**
 * Rows strictly after the cursor in the list order (pinned first, newest
 * updatedAt next, id ascending as the tie-break).
 */
function afterCursor(cursor: Cursor): Where {
  const u = new Date(cursor.u);
  const samePin = [
    { isPinned: cursor.p, updatedAt: { lt: u } },
    { isPinned: cursor.p, updatedAt: u, id: { gt: cursor.i } },
  ];
  return { OR: cursor.p ? [{ isPinned: false }, ...samePin] : samePin };
}

function sourceCondition(sources: string[]): Where {
  if (sources.includes(ARTIFACT_SOURCE_ALIAS)) {
    const others = sources.filter((s) => s !== ARTIFACT_SOURCE_ALIAS);
    return {
      OR: [
        { source: { notIn: ['manual', 'chat'] } },
        ...(others.length ? [{ source: { in: others } }] : []),
      ],
    };
  }
  return { source: { in: sources } };
}

function excerptOf(content: string): string {
  const chars = Array.from(content);
  return chars.length > NOTE_EXCERPT_LENGTH
    ? chars.slice(0, NOTE_EXCERPT_LENGTH).join('')
    : content;
}

/**
 * Run a stage-1 list query.
 *
 * @param db - Client / クライアント
 * @param query - The parsed query / 解析済みのクエリ
 * @returns One page and the cursor for the next / 1ページ分と次のカーソル
 * @throws {NoteQueryError} for an invalid combination, cursor, or a target outside the workspace
 */
export async function queryNotes(db: PrismaInstance, query: NoteQuery): Promise<NotePage> {
  const and: Where[] = [{ workspaceId: requestWorkspaceId() }];
  and.push(...(await placementConditions(db, query)));
  if (query.taskId !== undefined) and.push(await taskFilterCondition(db, query.taskId));
  const q = query.q?.trim();
  if (q) and.push({ OR: [{ title: { contains: q } }, { content: { contains: q } }] });
  if (query.sources && query.sources.length > 0) and.push(sourceCondition(query.sources));
  if (query.cursor) and.push(afterCursor(decodeCursor(query.cursor)));

  const paged = query.limit !== undefined || query.cursor !== undefined;
  const limit = Math.min(Math.max(query.limit ?? DEFAULT_NOTE_PAGE, 1), MAX_NOTE_PAGE);
  const rows = (await db.note.findMany({
    where: { AND: and },
    include: WITH_LINKS,
    orderBy: [{ isPinned: 'desc' }, { updatedAt: 'desc' }, { id: 'asc' }],
    ...(paged ? { take: limit + 1 } : {}),
  })) as NoteRow[];

  const page = paged ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  const nextCursor = paged && rows.length > limit && last ? encodeCursor(last) : null;
  const lookup = await loadPlacementLookup(db, {
    themeIds: [...new Set(page.map((r) => r.themeId).filter((v): v is number => v != null))],
    categoryIds: [...new Set(page.map((r) => r.categoryId).filter((v): v is number => v != null))],
    folderIds: [...new Set(page.map((r) => r.folderId).filter((v): v is number => v != null))],
  });
  const notes = page.map((row) => {
    const placed = toPlacedRecord(row, lookup);
    if (!query.summary) return placed;
    const { content, ...rest } = placed;
    return { ...rest, excerpt: excerptOf(content) };
  });
  return { notes, nextCursor };
}
