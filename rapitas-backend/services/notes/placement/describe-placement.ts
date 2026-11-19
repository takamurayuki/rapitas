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
 * that is not in the request's workspace (or no longer exists) is skipped.
 * Both directions — a note's placement and the list filter's `where` — are
 * generated from the one table PLACEMENT_PRECEDENCE.
 *
 * Not responsible for changing a placement — see the follow, the check job
 * and the write path.
 */
import type { PrismaInstance } from '../note-record';
import { requestWorkspaceId } from '../note-scope';
import type { NotePlacement, PlacementColumns, PlacementKind } from './placement-types';

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
 * The rule source: the placement columns in precedence order, each with the
 * lookup table that says whether the row it names is in scope. Both
 * describePlacement (a note → its placement) and placementWhere (a placement
 * → the `where` of its notes) walk THIS table, so the tree, the list filter
 * and the detail cannot drift apart (contract 3, review G2 must-fix 6).
 */
export const PLACEMENT_PRECEDENCE = [
  { kind: 'theme', column: 'themeId', table: 'themes' },
  { kind: 'category', column: 'categoryId', table: 'categories' },
  { kind: 'folder', column: 'folderId', table: 'folders' },
] as const satisfies readonly {
  kind: Exclude<PlacementKind, 'none'>;
  column: keyof PlacementColumns;
  table: keyof PlacementLookup;
}[];

type PrecedenceEntry = (typeof PLACEMENT_PRECEDENCE)[number];

/**
 * The column that decides a note's placement: the first one, in precedence
 * order, naming a row in the lookup. Null = 未分類.
 */
function decidingEntry(
  note: Partial<PlacementColumns>,
  lookup: PlacementLookup,
): { entry: PrecedenceEntry; id: number } | null {
  for (const entry of PLACEMENT_PRECEDENCE) {
    const id = note[entry.column];
    if (id != null && lookup[entry.table].has(id)) return { entry, id };
  }
  return null;
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
  const decided = decidingEntry(note, lookup);
  if (!decided) return { kind: 'none' };
  const { entry, id } = decided;
  if (entry.kind === 'theme') {
    const theme = lookup.themes.get(id) as NonNullable<ReturnType<typeof lookup.themes.get>>;
    const category = theme.categoryId != null ? lookup.categories.get(theme.categoryId) : undefined;
    return {
      kind: 'theme',
      themeId: theme.id,
      themeName: theme.name,
      categoryId: category ? category.id : null,
      categoryName: category ? category.name : null,
    };
  }
  if (entry.kind === 'category') {
    const category = lookup.categories.get(id) as { id: number; name: string };
    return { kind: 'category', categoryId: category.id, categoryName: category.name };
  }
  const folder = lookup.folders.get(id) as { id: number; name: string };
  return { kind: 'folder', folderId: folder.id, folderName: folder.name };
}

/** A placement to list the notes of: a kind with its id, or 未分類. */
export type PlacementTarget =
  | { kind: Exclude<PlacementKind, 'none'>; id: number }
  | { kind: 'none' };

/**
 * Whether a target names a row the lookup holds (`none` always does).
 *
 * @param target - The placement / 置き場所
 * @param lookup - The workspace's rows / 参照表
 * @returns true when the target exists in scope / 範囲内にあれば true
 */
export function isTargetInLookup(target: PlacementTarget, lookup: PlacementLookup): boolean {
  if (target.kind === 'none') return true;
  const entry = PLACEMENT_PRECEDENCE.find((e) => e.kind === target.kind) as PrecedenceEntry;
  return lookup[entry.table].has(target.id);
}

/**
 * The `where` fragments (to AND together) selecting exactly the notes that
 * describePlacement puts at `target`, generated from PLACEMENT_PRECEDENCE:
 * the target's column names the id, and every column before it does not
 * decide (empty, or naming no row of the lookup). For 未分類 no column decides.
 *
 * @param target - The placement / 置き場所
 * @param lookup - The workspace's rows, loaded with 'all' / 参照表（全件）
 * @returns Conditions to AND / AND で結ぶ条件
 */
export function placementWhere(
  target: PlacementTarget,
  lookup: PlacementLookup,
): Record<string, unknown>[] {
  const notDeciding = (entry: PrecedenceEntry) => ({
    OR: [{ [entry.column]: null }, { [entry.column]: { notIn: [...lookup[entry.table].keys()] } }],
  });
  const out: Record<string, unknown>[] = [];
  for (const entry of PLACEMENT_PRECEDENCE) {
    if (target.kind === entry.kind) {
      out.push({ [entry.column]: target.id });
      return out;
    }
    out.push(notDeciding(entry));
  }
  return out;
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
