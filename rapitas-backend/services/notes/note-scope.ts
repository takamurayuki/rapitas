/**
 * NoteScope
 *
 * The workspace rule the note write paths use (design §2.2): the request's
 * workspace when one was resolved, otherwise the NULL partition (rows whose
 * `workspaceId` is NULL). It is applied as an explicit `workspaceId`
 * condition rather than left to the client extension, which passes an
 * unscoped request through and would let it see every workspace.
 *
 * Not responsible for resolving a session — see services/tenancy.
 */
import { currentWorkspaceId } from '../tenancy/workspace-context';

/**
 * The workspace this request belongs to; null is the NULL partition.
 *
 * @returns Workspace id or null / ワークスペースID（無ければ null の区画）
 */
export function requestWorkspaceId(): number | null {
  return currentWorkspaceId();
}

/**
 * A `where` fragment that keeps a query inside the request's workspace.
 *
 * @returns `{ workspaceId }` with null meaning the NULL partition / ワークスペース条件
 */
export function scopeWhere(): { workspaceId: number | null } {
  return { workspaceId: requestWorkspaceId() };
}

/**
 * Whether a fetched row belongs to the request's workspace. Equality only:
 * NULL matches NULL and nothing else.
 *
 * @param row - The row, or null when none was found / 取得した行
 * @returns true when it exists and is in scope / 範囲内に存在すれば true
 */
export function isInScope(row: { workspaceId: number | null } | null | undefined): boolean {
  if (!row) return false;
  return row.workspaceId === requestWorkspaceId();
}
