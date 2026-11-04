/**
 * ParentWorkspace
 *
 * Lets a child row take its parent's workspace explicitly, for writes that run
 * with no workspace in context.
 *
 * The workspace extension stamps a workspace onto a create only when the
 * request established one. Sessionless work — the agent calling this server
 * over HTTP, background jobs, a page that lost its cookie — has none, so a
 * subtask it created was left NULL under a parent that belongs to a
 * workspace, and the parent's signed-in owner could no longer see or update
 * it. Copying the parent's value closes that without making sessionless
 * requests scoped. Inside a scoped request the extension still stamps last,
 * with the same value, because the parent could only be read from inside that
 * scope.
 *
 * NOT responsible for choosing a workspace for a root row; a row with no
 * parent keeps the extension's behaviour.
 */

/** The one delegate method readParentWorkspace needs, from a client or a tx. */
export interface TaskWorkspaceReader {
  task: {
    findFirst: (args: {
      where: { id: number };
      select: { workspaceId: true };
    }) => Promise<{ workspaceId: number | null } | null>;
  };
}

/**
 * The `data` fragment that puts a child in its parent's workspace.
 *
 * @param parent - The parent row, or null when it was not found / 親行(無ければnull)
 * @returns `{ workspaceId }` when the parent has one, otherwise `{}` / 親のワークスペース断片
 */
export function inheritWorkspace(parent: { workspaceId?: number | null } | null | undefined): {
  workspaceId?: number;
} {
  const workspaceId = parent?.workspaceId;
  return typeof workspaceId === 'number' ? { workspaceId } : {};
}

/**
 * Look up a parent task's workspace and return it as a `data` fragment.
 *
 * Uses findFirst, not findUnique, on purpose: inside a scoped request the
 * extension re-issues findUnique on the BASE client, which would run outside
 * the caller's interactive transaction. findFirst stays on the client passed in.
 *
 * @param client - A Prisma client or interactive-transaction client / Prisma クライアントまたは tx
 * @param parentId - The parent task id / 親タスクID
 * @returns `{ workspaceId }` when the parent has one, otherwise `{}` / 親のワークスペース断片
 */
export async function readParentWorkspace(
  client: TaskWorkspaceReader,
  parentId: number,
): Promise<{ workspaceId?: number }> {
  const parent = await client.task.findFirst({
    where: { id: parentId },
    select: { workspaceId: true },
  });
  return inheritWorkspace(parent);
}
