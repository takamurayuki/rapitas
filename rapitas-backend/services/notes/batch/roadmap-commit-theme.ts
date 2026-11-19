/**
 * RoadmapCommitTheme
 *
 * The theme a roadmap commit returned for the tasks it made, read back from
 * what the commit already leaves on the server (design §3.3 and §8.3 contract
 * 6: the closing note goes to "the theme commit returned"). No new column: the
 * commit route writes an `AssistantAction` (`roadmap.commit`) whose
 * `resultJson` is the `{ themeId, taskIds, … }` it answered with, and points
 * each task's `TaskCompanion.sourceActionId` at that row.
 *
 * The client is never asked: it sends only the task ids, and the theme comes
 * from the server's own record (§2.2 "the server decides placement").
 *
 * Not responsible for placing the note — see note-batch.
 */
import type { PrismaInstance } from '../note-record';
import { requestWorkspaceId } from '../note-scope';

/** What the commit record says, or that there is no single one to go by. */
export type CommitTheme = { found: true; themeId: number | null } | { found: false };

interface CommitResult {
  themeId: number | null;
  taskIds: number[];
}

function parseResult(json: string | null): CommitResult | null {
  if (!json) return null;
  try {
    const value = JSON.parse(json) as { themeId?: unknown; taskIds?: unknown };
    const themeId = value.themeId;
    if (themeId !== null && typeof themeId !== 'number') return null;
    if (!Array.isArray(value.taskIds)) return null;
    return { themeId, taskIds: value.taskIds.filter((id): id is number => typeof id === 'number') };
  } catch {
    return null;
  }
}

/**
 * The theme the roadmap commit returned for these tasks.
 *
 * Found only when every task's companion row points at a `roadmap.commit`
 * record of this workspace whose returned `taskIds` include that task, and all
 * those records returned the same `themeId`. A returned theme that no longer
 * exists in the workspace reads as "none" (未分類).
 *
 * @param db - Client / クライアント
 * @param taskIds - The closing note's tasks, already checked to be in scope / リンク先タスク
 * @returns The commit's theme, or not found / commit が返したテーマ（無ければ not found）
 */
export async function roadmapCommitTheme(
  db: PrismaInstance,
  taskIds: number[],
): Promise<CommitTheme> {
  const ws = requestWorkspaceId();
  const ids = [...new Set(taskIds)];
  if (ids.length === 0) return { found: false };
  const companions = (await db.taskCompanion.findMany({
    where: { taskId: { in: ids }, workspaceId: ws },
    select: { taskId: true, sourceActionId: true },
  })) as { taskId: number; sourceActionId: number | null }[];
  const actionOf = new Map(companions.map((c) => [c.taskId, c.sourceActionId]));
  const actionIds = new Set<number>();
  for (const id of ids) {
    const actionId = actionOf.get(id);
    if (typeof actionId !== 'number') return { found: false };
    actionIds.add(actionId);
  }

  const actions = (await db.assistantAction.findMany({
    where: { id: { in: [...actionIds] }, workspaceId: ws, capabilityId: 'roadmap.commit' },
    select: { id: true, resultJson: true },
  })) as { id: number; resultJson: string | null }[];
  const results = new Map(actions.map((a) => [a.id, parseResult(a.resultJson)]));
  const themes = new Set<number | null>();
  for (const id of ids) {
    const result = results.get(actionOf.get(id) as number);
    // A companion re-pointed at another act (a manual start) is not the commit's record.
    if (!result || !result.taskIds.includes(id)) return { found: false };
    themes.add(result.themeId);
  }
  if (themes.size !== 1) return { found: false };

  const [themeId] = [...themes] as [number | null];
  if (themeId === null) return { found: true, themeId: null };
  const theme = await db.theme.findFirst({
    where: { id: themeId, workspaceId: ws },
    select: { id: true },
  });
  return { found: true, themeId: theme ? themeId : null };
}
