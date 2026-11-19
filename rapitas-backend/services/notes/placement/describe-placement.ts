/**
 * DescribePlacement
 *
 * The one function every read derives a note's placement from (design §2.2
 * contract 3): the tree's counts, the list's `placement` and filters, and the
 * detail's `placement`. It reads only the three placement columns plus the
 * in-scope theme / category / folder rows — never NoteTaskLink.meta or the
 * title — and writes nothing.
 *
 * Precedence when a row somehow carries more than one column (the writes
 * never do): theme, then category, then folder. A column pointing at a row
 * that is not in the request's workspace (or no longer exists) is skipped,
 * and the list filters in note-query mirror exactly that rule.
 *
 * Not responsible for changing a placement — see the follow, the check job
 * and the write path.
 */
import type { PrismaInstance } from '../note-record';
import { requestWorkspaceId } from '../note-scope';
import type { NotePlacement, PlacementColumns } from './placement-types';

/** The in-scope rows a placement can name. */
export interface PlacementLookup {
  themes: Map<number, { id: number; name: string; categoryId: number | null; sortOrder?: number }>;
  categories: Map<number, { id: number; name: string; sortOrder?: number }>;
  folders: Map<number, { id: number; name: string; sortOrder?: number }>;
}

/** An empty lookup: every column then reads as 未分類. */
export function emptyLookup(): PlacementLookup {
  return { themes: new Map(), categories: new Map(), folders: new Map() };
}

/**
 * Where a note sits, from its columns.
 *
 * @param note - The note's placement columns / ノートの置き場所の列
 * @param lookup - The workspace's themes, categories and folders / ワークスペースのテーマ等
 * @returns The placement / 置き場所
 */
export function describePlacement(
  note: Partial<PlacementColumns>,
  lookup: PlacementLookup,
): NotePlacement {
  const theme = note.themeId != null ? lookup.themes.get(note.themeId) : undefined;
  if (theme) {
    const category = theme.categoryId != null ? lookup.categories.get(theme.categoryId) : undefined;
    return {
      kind: 'theme',
      themeId: theme.id,
      themeName: theme.name,
      categoryId: category ? category.id : null,
      categoryName: category ? category.name : null,
    };
  }
  const category = note.categoryId != null ? lookup.categories.get(note.categoryId) : undefined;
  if (category) return { kind: 'category', categoryId: category.id, categoryName: category.name };
  const folder = note.folderId != null ? lookup.folders.get(note.folderId) : undefined;
  if (folder) return { kind: 'folder', folderId: folder.id, folderName: folder.name };
  return { kind: 'none' };
}

/** Which rows a lookup must hold. `'all'` loads the whole workspace. */
export interface LookupNeeds {
  themeIds: number[] | 'all';
  categoryIds: number[] | 'all';
  folderIds: number[] | 'all';
}

async function load<T>(
  delegate: { findMany: (args: unknown) => Promise<unknown> },
  ids: number[] | 'all',
  ws: number | null,
  select: Record<string, boolean>,
): Promise<T[]> {
  if (ids !== 'all' && ids.length === 0) return [];
  const where = ids === 'all' ? { workspaceId: ws } : { id: { in: ids }, workspaceId: ws };
  const rows = (await delegate.findMany({
    where,
    select: { ...select, sortOrder: true, workspaceId: true },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  })) as (T & {
    workspaceId: number | null;
  })[];
  // Equality, again: the explicit condition already says so, but a client
  // that ignored it must still not hand back another workspace's row.
  return rows.filter((r) => (r.workspaceId ?? null) === ws);
}

/**
 * Load the in-scope rows the given notes' placements can name. Only the
 * tables a note actually points into are queried.
 *
 * @param db - Client or transaction / クライアント
 * @param needs - The ids to load, or 'all' / 読み込むID
 * @returns The lookup / 参照表
 */
export async function loadPlacementLookup(
  db: PrismaInstance,
  needs: LookupNeeds,
): Promise<PlacementLookup> {
  const ws = requestWorkspaceId();
  const lookup = emptyLookup();
  const themes = await load<{ id: number; name: string; categoryId: number | null }>(
    db.theme as never,
    needs.themeIds,
    ws,
    { id: true, name: true, categoryId: true },
  );
  for (const t of themes) lookup.themes.set(t.id, t);
  const categoryIds =
    needs.categoryIds === 'all'
      ? 'all'
      : [
          ...new Set([
            ...needs.categoryIds,
            ...themes.map((t) => t.categoryId).filter((c): c is number => c !== null),
          ]),
        ];
  for (const c of await load<{ id: number; name: string }>(db.category as never, categoryIds, ws, {
    id: true,
    name: true,
  }))
    lookup.categories.set(c.id, c);
  for (const f of await load<{ id: number; name: string }>(
    db.noteFolder as never,
    needs.folderIds,
    ws,
    {
      id: true,
      name: true,
    },
  ))
    lookup.folders.set(f.id, f);
  return lookup;
}

/**
 * The lookup for a set of notes: exactly the rows their columns name.
 *
 * @param db - Client or transaction / クライアント
 * @param notes - Notes' placement columns / ノートの列
 * @returns The lookup / 参照表
 */
export async function lookupForNotes(
  db: PrismaInstance,
  notes: Partial<PlacementColumns>[],
): Promise<PlacementLookup> {
  const ids = (key: keyof PlacementColumns) => [
    ...new Set(notes.map((n) => n[key]).filter((v): v is number => typeof v === 'number')),
  ];
  return loadPlacementLookup(db, {
    themeIds: ids('themeId'),
    categoryIds: ids('categoryId'),
    folderIds: ids('folderId'),
  });
}
