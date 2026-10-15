/**
 * Manual PR registration route
 *
 * POST /tasks/:id/register-github-pr — operator-only recovery for a task whose
 * auto-PR failed and whose PR was opened by hand. Delegates validation to
 * services/github/manual-pr-link.ts.
 *
 * The header guard mirrors halt-release: linking a PR satisfies the completion
 * gate, which the agent must not do for itself with a shell curl.
 */
import { Elysia, t } from 'elysia';
import { prisma } from '../../../config/database';
import { createLogger } from '../../../config/logger';
import { GitHubService } from '../../../services/core/github-service';
import { registerManualPr } from '../../../services/github/manual-pr-link';
import { recordTransition } from '../../../services/workflow/transition-recorder';

const log = createLogger('routes:register-github-pr');
const githubService = new GitHubService(prisma);

/** X-Rapitas-Source values allowed to register a PR. */
const ALLOWED_SOURCES = new Set(['ui', 'operator']);

export const registerGithubPrRoutes = new Elysia().post(
  '/tasks/:id/register-github-pr',
  async (ctx) => {
    const taskId = parseInt((ctx.params as { id: string }).id, 10);
    if (!Number.isFinite(taskId)) {
      ctx.set.status = 400;
      return { success: false, error: 'invalid task id' };
    }

    const headers = ctx.headers as Record<string, string | undefined> | undefined;
    const rawSource = headers?.['x-rapitas-source'];
    const source = typeof rawSource === 'string' ? rawSource.toLowerCase() : '';
    if (!ALLOWED_SOURCES.has(source)) {
      log.warn(
        { taskId, source: rawSource ?? null },
        '[register-github-pr] Rejected: missing X-Rapitas-Source header (likely an agent shell-call)',
      );
      await recordTransition({
        taskId,
        fromStatus: null,
        toStatus: 'draft',
        actor: 'system',
        cause: 'register_pr_blocked',
        metadata: { reason: 'missing X-Rapitas-Source header', source: rawSource ?? null },
        invariantViolation: true,
        invariantMessage: 'Agent attempted to link a PR to its own task',
      }).catch(() => {});
      ctx.set.status = 403;
      return {
        success: false,
        error: 'PRの紐付けは人間の操作が必要です（X-Rapitas-Source ヘッダが必要）。',
      };
    }

    const body = ctx.body as { prNumber: number; repo: string };
    const result = await registerManualPr(
      prisma,
      (repo, prNumber) => githubService.getPullRequest(repo, prNumber),
      { taskId, prNumber: body.prNumber, repo: body.repo },
    );
    if (!result.ok) {
      ctx.set.status = result.status;
      return { success: false, error: result.reason };
    }
    return { success: true, localPrId: result.localPrId, prNumber: result.prNumber };
  },
  {
    params: t.Object({ id: t.String() }),
    body: t.Object(
      { prNumber: t.Integer({ minimum: 1 }), repo: t.String({ minLength: 3, maxLength: 200 }) },
      { additionalProperties: false },
    ),
  },
);
