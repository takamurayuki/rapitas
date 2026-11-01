/**
 * WorkspaceRequestWrapper
 *
 * The one place a request is attached to a workspace: a thin Elysia in front
 * of the real app that resolves the session's workspace and then runs the
 * entire request inside it.
 *
 * Why a wrapper and not a hook. Scoping has to be ambient — threading a
 * workspace through every service is the thing the client extension exists to
 * avoid — and ambient means AsyncLocalStorage, which needs the request to run
 * INSIDE a `run()` call. Nothing in Elysia's lifecycle can wrap a request:
 * `onRequest` returns before the handler starts and `derive` runs in a branch
 * the handler does not inherit. Both were measured 2026-10-28 under Bun
 * 1.3.13; `enterWith` from a hook looked like it worked until requests
 * overlapped, and then a cookieless one came back holding a neighbour's
 * workspace.
 *
 * The real app keeps every route and every `onRequest` guard; it simply is not
 * the thing listening. Keeping an Elysia on the outside means `listen()`,
 * `server` and `stop(true)` behave exactly as before — those carry this
 * server's worst incidents (zombie sockets, CLOSE_WAIT) and are not worth
 * re-deriving for a tenancy feature.
 *
 * Deliberately fails OPEN: no session, an expired one, or a lookup that errors
 * establishes no workspace, and workspace-scope passes those through
 * unchanged. That is what keeps the agent working, since it calls this same
 * server over HTTP with no cookie (CLAUDE.md's workflow API), and it is a
 * decision made knowingly — on a local single-user desktop app a login wall
 * buys nothing and would stop auto-run dead.
 *
 * NOT responsible for authentication: a request that resolves to nothing is
 * not rejected, only unscoped.
 */
import { Elysia } from 'elysia';
import { createLogger } from '../../config/logger';
import { runInWorkspace } from './workspace-context';
import { readSessionToken, resolveWorkspaceForSession } from './session-workspace';

const log = createLogger('tenancy:request-wrapper');

/** Just enough of an Elysia app to forward a request to it. */
interface FetchableApp {
  fetch: (request: Request) => Response | Promise<Response>;
}

/**
 * Put `app` behind a workspace-resolving front door.
 *
 * The return type is inferred rather than annotated `Elysia`: `.all('/*')`
 * widens the instance's route generics, and the bare `Elysia` is not that
 * type.
 *
 * @param app - The real application / 実アプリケーション
 * @returns The Elysia that should listen / listen すべき Elysia
 */
export function wrapAppWithWorkspaceScope(app: FetchableApp) {
  const forward = (request: Request): Response | Promise<Response> => app.fetch(request);

  return new Elysia().all('/*', async ({ request }) => {
    let workspaceId: number | null = null;
    try {
      const token = readSessionToken(request.headers.get('cookie'));
      if (token !== null) workspaceId = await resolveWorkspaceForSession(token);
    } catch (error) {
      // Scoping is a narrowing, so failing to apply it degrades to the
      // pre-tenancy behaviour rather than to an outage — but it must be
      // visible, not silent.
      log.error({ err: error }, 'failed to resolve a workspace; serving the request unscoped');
    }
    if (workspaceId === null) return forward(request);
    return runInWorkspace(workspaceId, () => forward(request));
  });
}
