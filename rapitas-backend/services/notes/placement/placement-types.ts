/**
 * PlacementTypes
 *
 * The vocabulary of where a note sits (design §2.2) and where it came from
 * (§3.2): placement kinds, the stored columns, the `source` values, and the
 * fixed-id prefixes only the server may create. Pure: no Prisma.
 */

/** The four places a note can be stored. `none` is 未分類 (no row backs it). */
export type PlacementKind = 'theme' | 'category' | 'folder' | 'none';

/** A placement as a client asks for one: a kind and, except for `none`, an id. */
export interface PlacementRequest {
  kind: PlacementKind;
  id?: number;
}

/** The three columns that alone decide a note's stored placement. */
export interface PlacementColumns {
  themeId: number | null;
  categoryId: number | null;
  folderId: number | null;
}

/** Where a note sits, as every read (tree, list, detail) reports it. */
export interface NotePlacement {
  kind: PlacementKind;
  themeId?: number;
  themeName?: string;
  /** For a theme placement: the theme's category (null = カテゴリなし). */
  categoryId?: number | null;
  categoryName?: string | null;
  folderId?: number;
  folderName?: string;
}

/** Every `source` value (§3.2). */
export const NOTE_SOURCES = [
  'manual',
  'chat',
  'deliverable',
  'research',
  'roadmap',
  'learning',
  'material',
  'knowledge',
] as const;
export type NoteSource = (typeof NOTE_SOURCES)[number];

/** The only sources a client may write with PUT / PATCH (contract 8). */
export const CLIENT_WRITABLE_SOURCES = ['manual', 'chat'] as const;
export type ClientWritableSource = (typeof CLIENT_WRITABLE_SOURCES)[number];

/**
 * Whether a source makes the note a 成果物 (anything but manual / chat):
 * subject to fixed ids, following and the Q7 move range.
 *
 * @param source - The stored source / 保存されている source
 * @returns true for a deliverable-type note / 成果物なら true
 */
export function isDeliverableSource(source: string | null | undefined): boolean {
  return !!source && source !== 'manual' && source !== 'chat';
}

/**
 * Fixed-id prefixes of notes the server creates (contract 8). A client PUT
 * may not create a note under one of these, so an empty note can never take
 * the id before the deliverable path does.
 */
export const RESERVED_NOTE_ID_PREFIXES = [
  'deliverable-task-',
  'research-task-',
  'learning-task-',
  'roadmap-',
] as const;

/**
 * Whether an id is reserved for a server-created note.
 *
 * @param id - The note id / ノートID
 * @returns true when it starts with a reserved prefix / 予約済みの接頭辞なら true
 */
export function isReservedNoteId(id: string): boolean {
  return RESERVED_NOTE_ID_PREFIXES.some((p) => id.startsWith(p));
}

/** The columns for "nowhere" (未分類). */
export const UNCLASSIFIED: PlacementColumns = { themeId: null, categoryId: null, folderId: null };

/**
 * The stored columns for a placement. Exactly one column carries a value, or
 * none for `none` — the "at most one" rule of §2.2 is upheld here.
 *
 * @param kind - The placement kind / 置き場所の種類
 * @param id - The target's id (ignored for none) / 配置先のID
 * @returns The three columns / 3列の値
 */
export function columnsFor(kind: PlacementKind, id?: number | null): PlacementColumns {
  if (kind === 'none' || id === undefined || id === null) return { ...UNCLASSIFIED };
  return {
    themeId: kind === 'theme' ? id : null,
    categoryId: kind === 'category' ? id : null,
    folderId: kind === 'folder' ? id : null,
  };
}

/**
 * Whether a stored row is already at the given columns.
 *
 * @param row - The row's columns / 行の列
 * @param target - The wanted columns / 目的の列
 * @returns true when all three agree / 3列が一致すれば true
 */
export function sameColumns(row: PlacementColumns, target: PlacementColumns): boolean {
  return (
    (row.themeId ?? null) === target.themeId &&
    (row.categoryId ?? null) === target.categoryId &&
    (row.folderId ?? null) === target.folderId
  );
}
