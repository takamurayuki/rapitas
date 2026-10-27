/**
 * WorkspaceContext
 *
 * Which workspace the current unit of work belongs to, carried implicitly so
 * that scoping does not have to be threaded through every function signature.
 *
 * Implicit context is a real cost — a call that escapes the context silently
 * loses its scope — but the alternative is a `workspaceId` parameter on
 * hundreds of service functions, and a miss there looks like ordinary code.
 * With AsyncLocalStorage the miss is a missing `runInWorkspace` at ONE place,
 * the request boundary, which stage 3 adds and can test.
 *
 * NOT responsible for resolving a session to a workspace (stage 3) or for
 * rewriting queries (workspace-scope).
 */
import { AsyncLocalStorage } from 'node:async_hooks';

interface WorkspaceStore {
  workspaceId: number;
}

const storage = new AsyncLocalStorage<WorkspaceStore>();

/**
 * Run `fn` with every Prisma call inside it scoped to one workspace.
 *
 * The async wrapper below is load-bearing, not style. Measured 2026-10-28
 * under Bun 1.3.13: `storage.run(store, () => client.count())` loses the
 * context before Prisma's query hook reads it, while
 * `storage.run(store, async () => await fn())` keeps it. A callback that
 * returns a promise without being awaited inside the scope therefore yields
 * UNSCOPED rows — silently, which is the one failure this layer exists to
 * prevent. Wrapping here means a caller cannot get it wrong, and the Promise
 * return type leaves no synchronous way out. Do not "simplify" this to
 * `storage.run(store, fn)`; workspace-scoping.integration.test.ts pins it.
 *
 * @param workspaceId - The workspace everything inside belongs to / 対象ワークスペース
 * @param fn - The work to run / 実行する処理
 * @returns Whatever `fn` resolves to / fn の解決値
 */
export async function runInWorkspace<T>(workspaceId: number, fn: () => Promise<T> | T): Promise<T> {
  return storage.run({ workspaceId }, async () => await fn());
}

/**
 * The current workspace, or null when nothing established one.
 *
 * NOTE: null is the normal state through stage 2 — nothing calls
 * runInWorkspace yet, and workspace-scope deliberately passes such calls
 * through unchanged so behaviour is identical to before tenancy existed.
 *
 * @returns Current workspace id, or null / 現在のワークスペースID(無ければnull)
 */
export function currentWorkspaceId(): number | null {
  return storage.getStore()?.workspaceId ?? null;
}

/**
 * Run `fn` with no workspace, so its Prisma calls see every workspace.
 *
 * For work that is legitimately cross-tenant: the deploy gate, the backfill,
 * schema self-heal, and operator tooling. Deliberately explicit — an
 * unscoped query should be something someone asked for by name.
 *
 * Async for the same measured reason as runInWorkspace: the exited scope has
 * to still be in effect when Prisma's hook runs, which is after a microtask,
 * so the callback must be awaited inside it.
 *
 * @param fn - The work to run unscoped / 非スコープで実行する処理
 * @returns Whatever `fn` resolves to / fn の解決値
 */
export async function runAcrossAllWorkspaces<T>(fn: () => Promise<T> | T): Promise<T> {
  return storage.exit(async () => await fn());
}
