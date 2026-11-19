/**
 * ThemeDelete
 *
 * Where a theme's notes go when the theme is deleted (design §2.2「削除・変更の
 * ときの扱い」), decided by ONE function, `placementAfterThemeDelete`, used by
 * the confirmation preview, the delete itself, and — through contracts 4/5 —
 * agreeing with what the consistency check would do afterwards:
 *
 * 1. A following deliverable (followsTask, sourceTaskId set) goes to its
 *    source task's effective theme computed without the deleted theme (a
 *    subtask whose own theme is the deleted one falls through to its parent's),
 *    when that is non-NULL. followsTask stays true.
 * 2. Everything else — and (1) with no such theme — goes directly under the
 *    deleted theme's category, or 未分類 when it has none.
 *
 * The moves and the theme delete run in one interactive transaction (the FK's
 * SetNull alone would drop the category too). Inside it only findFirst /
 * findMany / updateMany / deleteMany are used: the workspace extension cannot
 * emulate a unique operation inside a transaction.
 *
 * Not responsible for the theme route's other concerns.
 */
import type { PrismaInstance, PrismaTx } from '../note-record';
import { requestWorkspaceId } from '../note-scope';
import { belongsTo, inWorkspaceOf } from './placement-scope';
import { resolveEffectiveTheme } from './effective-theme';
import { columnsFor, type PlacementColumns } from './placement-types';

/** A note in the theme being deleted. */
export interface ThemeNote {
  id: string;
  followsTask: boolean;
  sourceTaskId: number | null;
}

/** The theme being deleted. */
export interface DeletedTheme {
  id: number;
  categoryId: number | null;
  workspaceId: number | null;
}

/**
 * The final placement of one note of a deleted theme (pure).
 *
 * @param note - The note / ノート
 * @param theme - The deleted theme (categoryId already checked in scope) / 削除するテーマ
 * @param effectiveAfter - The source task's effective theme without the deleted one / 削除後の有効テーマ
 * @returns The columns the note ends up with / 移動後の列
 */
export function placementAfterThemeDelete(
  note: ThemeNote,
  theme: { categoryId: number | null },
  effectiveAfter: number | null,
): PlacementColumns {
  if (note.followsTask && note.sourceTaskId !== null && effectiveAfter !== null) {
    return columnsFor('theme', effectiveAfter);
  }
  return theme.categoryId !== null ? columnsFor('category', theme.categoryId) : columnsFor('none');
}

/** One planned move. */
export interface PlannedMove {
  noteId: string;
  to: PlacementColumns;
}

/** The plan for a theme delete, which the confirmation dialog shows. */
export interface ThemeDeletePlan {
  theme: DeletedTheme;
  moves: PlannedMove[];
  /** Counts per destination, for 「N 件はカテゴリ『…』の直下へ、M 件は…」. */
  toCategory: number;
  toUnclassified: number;
  toThemes: { themeId: number; count: number }[];
}

async function categoryInWorkspace(db: PrismaTx, theme: DeletedTheme): Promise<number | null> {
  if (theme.categoryId === null) return null;
  const row = (await db.category.findFirst({
    where: { id: theme.categoryId, workspaceId: theme.workspaceId },
    select: { id: true, workspaceId: true },
  })) as { workspaceId: number | null } | null;
  return row && (row.workspaceId ?? null) === theme.workspaceId ? theme.categoryId : null;
}

/**
 * Work out every move for deleting a theme of the expected workspace.
 *
 * @param db - Client or transaction / クライアント
 * @param themeId - The theme / テーマID
 * @param expectedWorkspaceId - The request's workspace (NULL = NULL partition) / 要求のワークスペース
 * @returns The plan, or null when the theme is not in that workspace / 計画（範囲外・無ければ null）
 */
export async function planThemeDelete(
  db: PrismaTx,
  themeId: number,
  expectedWorkspaceId: number | null = requestWorkspaceId(),
): Promise<ThemeDeletePlan | null> {
  // NOTE: the theme is fetched with, and compared for equality against, the
  // request's workspace BEFORE anything is planned (§2.2). Taking the theme's
  // own workspace instead let a NULL-partition request delete another
  // workspace's theme while the preview said 404 (review G2 must-fix 1).
  const theme = (await db.theme.findFirst({
    where: { id: themeId, workspaceId: expectedWorkspaceId },
    select: { id: true, categoryId: true, workspaceId: true },
  })) as DeletedTheme | null;
  if (!theme || !belongsTo(theme, expectedWorkspaceId)) return null;
  const ws = expectedWorkspaceId;
  return inWorkspaceOf(ws, async () => {
    const categoryId = await categoryInWorkspace(db, theme);
    const notes = (await db.note.findMany({
      where: { themeId, workspaceId: ws },
      select: { id: true, followsTask: true, sourceTaskId: true },
    })) as ThemeNote[];
    const moves: PlannedMove[] = [];
    for (const note of notes) {
      const following = note.followsTask && note.sourceTaskId !== null;
      const after = following
        ? await resolveEffectiveTheme(db, note.sourceTaskId as number, { excludeThemeId: themeId })
        : null;
      moves.push({ noteId: note.id, to: placementAfterThemeDelete(note, { categoryId }, after) });
    }
    const toThemes = new Map<number, number>();
    for (const m of moves)
      if (m.to.themeId !== null) toThemes.set(m.to.themeId, (toThemes.get(m.to.themeId) ?? 0) + 1);
    return {
      theme: { ...theme, categoryId },
      moves,
      toCategory: moves.filter((m) => m.to.categoryId !== null).length,
      toUnclassified: moves.filter((m) => m.to.themeId === null && m.to.categoryId === null).length,
      toThemes: [...toThemes.entries()].map(([id, count]) => ({ themeId: id, count })),
    };
  });
}

/**
 * Delete a theme of the expected workspace, moving its notes first, in one
 * transaction. A theme outside that workspace is the same null as a missing one.
 *
 * @param db - Client / クライアント
 * @param themeId - The theme / テーマID
 * @param expectedWorkspaceId - The request's workspace (NULL = NULL partition) / 要求のワークスペース
 * @returns The deleted theme row, or null when there was none in scope / 削除したテーマ（範囲外・無ければ null）
 */
export async function deleteThemeWithNotes(
  db: PrismaInstance,
  themeId: number,
  expectedWorkspaceId: number | null = requestWorkspaceId(),
): Promise<Record<string, unknown> | null> {
  const ws = expectedWorkspaceId;
  const run = async (tx: PrismaTx) => {
    const before = (await tx.theme.findFirst({
      where: { id: themeId, workspaceId: ws },
    })) as (Record<string, unknown> & { workspaceId: number | null }) | null;
    if (!before || !belongsTo(before, ws)) return null;
    const plan = await planThemeDelete(tx, themeId, ws);
    if (!plan) return null;
    for (const move of plan.moves) {
      await tx.note.updateMany({
        where: { id: move.noteId, themeId, workspaceId: ws },
        data: move.to,
      });
    }
    await tx.theme.deleteMany({ where: { id: themeId, workspaceId: ws } });
    return before;
  };
  const transaction = (db as { $transaction?: unknown }).$transaction;
  if (typeof transaction === 'function') {
    return (await (db.$transaction as (fn: (tx: PrismaTx) => Promise<unknown>) => Promise<unknown>)(
      (tx) => run(tx),
    )) as Record<string, unknown> | null;
  }
  return run(db);
}
