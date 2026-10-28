/**
 * Tenancy routes
 *
 * Seeing and settling who owns the data.
 *
 * Thin layer — the counting and the claiming live in
 * `services/tenancy/workspace-backfill`. This exists because the rows that
 * predate accounts belong to nobody, and nobody can see them from inside a
 * workspace to fix that: the fix has to come from outside the scope.
 *
 * GET reports; POST acts, and POST only ever touches rows with no owner, so it
 * cannot move data between workspaces however it is called.
 */
import { Elysia, t } from 'elysia';
import { prisma } from '../../config/database';
import {
  claimUnownedRows,
  countUnownedRows,
  type BackfillResult,
} from '../../services/tenancy/workspace-backfill';
import { runAcrossAllWorkspaces } from '../../services/tenancy/workspace-context';
import { ensureWorkspaceForUser } from '../../services/tenancy/workspace-provisioning';
import { clearSessionWorkspaceCache } from '../../services/tenancy/session-workspace';

/** A workspace as this router reports it. */
export interface WorkspaceSummary {
  id: number;
  slug: string;
  name: string;
  isDefault: boolean;
  members: { userId: number; role: string }[];
}

/**
 * Collaborators of the router.
 *
 * Injected rather than reached for, following `deploy.routes.ts`: the tests
 * would otherwise have to `mock.module` the Prisma client, and bun replaces a
 * module process-wide for every other test file in the run.
 */
export interface TenancyRouteDeps {
  listWorkspaces?: () => Promise<WorkspaceSummary[]>;
  countUnowned?: typeof countUnownedRows;
  findUser?: (username: string) => Promise<{ id: number; username: string } | null>;
  ensureWorkspace?: typeof ensureWorkspaceForUser;
  claim?: (workspaceId: number) => Promise<BackfillResult>;
  onClaimed?: () => void;
}

/**
 * Build the tenancy router.
 *
 * @param deps - Stand-ins for the database and the backfill / 差し替え用の依存
 * @returns The router / ルーター
 */
export function createTenancyRoutes(deps: TenancyRouteDeps = {}) {
  const listWorkspaces =
    deps.listWorkspaces ??
    (() =>
      runAcrossAllWorkspaces(() =>
        prisma.workspace.findMany({
          orderBy: { id: 'asc' },
          select: {
            id: true,
            slug: true,
            name: true,
            isDefault: true,
            members: { select: { userId: true, role: true } },
          },
        }),
      ));
  const countUnowned = deps.countUnowned ?? countUnownedRows;
  const findUser =
    deps.findUser ??
    ((username: string) =>
      runAcrossAllWorkspaces(() =>
        prisma.user.findFirst({ where: { username }, select: { id: true, username: true } }),
      ));
  const ensureWorkspace = deps.ensureWorkspace ?? ensureWorkspaceForUser;
  const claim = deps.claim ?? claimUnownedRows;
  const onClaimed = deps.onClaimed ?? clearSessionWorkspaceCache;

  return new Elysia({ prefix: '/tenancy' })
    .get('/status', async () => {
      const [workspaces, unowned] = await Promise.all([listWorkspaces(), countUnowned()]);
      return { workspaces, unowned };
    })

    .post(
      '/claim',
      async ({ body, set }) => {
        const { username } = body;
        const user = await findUser(username);
        if (!user) {
          set.status = 404;
          return { claimed: false, message: `No user named ${username}` };
        }

        const workspace = await ensureWorkspace(user.id, user.username);
        const result = await claim(workspace.id);
        // The user may have had no workspace a moment ago, and a cached answer
        // from before would keep their requests unscoped.
        onClaimed();

        // Partial success is still a changed database, so report 207 rather
        // than a 200 that reads as "all of it worked".
        if (result.failed.length > 0) set.status = 207;
        return { claimed: true, user: user.username, workspace, ...result };
      },
      {
        body: t.Object({
          username: t.String({ minLength: 1, maxLength: 50 }),
        }),
      },
    );
}

export const tenancyRoutes = createTenancyRoutes();

export default tenancyRoutes;
