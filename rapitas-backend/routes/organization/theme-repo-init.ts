/**
 * Theme Repository Init Route
 *
 * POST /themes/init-repository — one-click bootstrap of a development theme's
 * working directory: git init, initial commit, and GitHub remote creation.
 * POST /themes/create-branch — create a branch locally and on the remote
 * without switching the current branch.
 * Delegates all git/gh work to services/github/repo-bootstrap; not responsible
 * for persisting the resulting repositoryUrl onto the theme.
 */
import { Elysia, t } from 'elysia';
import {
  initRepository,
  createBranch,
  type InitRepositoryErrorCode,
  type CreateBranchErrorCode,
} from '../../services/github/repo-bootstrap';

// NOTE: The API contract fixes the failure body shape ({ success:false, error,
// code }) — errors are returned directly with an explicit status instead of
// being thrown into the shared error handler (which uses a different shape).
const ERROR_STATUS: Record<InitRepositoryErrorCode, number> = {
  path_not_found: 404,
  gh_unavailable: 503,
  gh_unauthenticated: 401,
  remote_mismatch: 409,
  git_failed: 500,
  gh_failed: 502,
};

const BRANCH_ERROR_STATUS: Record<CreateBranchErrorCode, number> = {
  path_not_found: 404,
  not_a_repo: 409,
  invalid_branch_name: 400,
  no_remote: 409,
  git_failed: 500,
};

export const themeRepoInitRoutes = new Elysia({ prefix: '/themes' })
  .post(
    '/init-repository',
    async ({ body, set }) => {
      const result = await initRepository(body);
      if (!result.success) {
        set.status = ERROR_STATUS[result.code];
      }
      return result;
    },
    {
      body: t.Object({
        path: t.String({ minLength: 1 }),
        repoName: t.Optional(t.String()),
        visibility: t.Optional(t.Union([t.Literal('private'), t.Literal('public')])),
        defaultBranch: t.Optional(t.String()),
      }),
    },
  )
  .post(
    '/create-branch',
    async ({ body, set }) => {
      const result = await createBranch(body);
      if (!result.success) {
        set.status = BRANCH_ERROR_STATUS[result.code];
      }
      return result;
    },
    {
      body: t.Object({
        path: t.String({ minLength: 1 }),
        branchName: t.String({ minLength: 1 }),
        baseBranch: t.Optional(t.String()),
      }),
    },
  );
