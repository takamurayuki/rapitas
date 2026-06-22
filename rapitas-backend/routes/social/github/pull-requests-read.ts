/**
 * GitHub Pull Request Read Routes
 *
 * GET operations: list by integration, detail, by-task resolution, and diff.
 * Write operations (comments, approve, merge, etc.) live in pull-requests-write.ts.
 */
import { Elysia } from 'elysia';
import { prisma } from '../../../config/database';
import { GitHubService } from '../../../services/core/github-service';
import { resolvePrOrThrow } from '../../../services/github/resource-guard';
import { findPrViaGh } from '../../../services/github/pr-task-resolver';
import { makeOwnerRepoString } from '../../../services/github/owner-repo';

const githubService = new GitHubService(prisma);

export const pullRequestReadRoutes = new Elysia()
  // Get PR list
  .get('/integrations/:id/pull-requests', async (context) => {
    const { params, query } = context;
    const { id } = params as { id: string };
    const { state, fromGitHub } = query as { state?: string; fromGitHub?: string };

    if (fromGitHub === 'true') {
      const integration = await prisma.gitHubIntegration.findUnique({
        where: { id: parseInt(id) },
      });
      if (!integration) return [];
      const repo = makeOwnerRepoString(integration.ownerName, integration.repositoryName);
      return await githubService.getPullRequests(
        repo,
        (state as 'open' | 'closed' | 'all') || 'open',
      );
    }

    // State filter: "closed" includes merged PRs (GitHub treats a merged PR as
    // closed), otherwise the merged majority would be invisible under both the
    // open and closed tabs. "all" applies no filter.
    const stateWhere =
      !state || state === 'all'
        ? {}
        : state === 'closed'
          ? { state: { in: ['closed', 'merged'] } }
          : { state };

    return await prisma.gitHubPullRequest.findMany({
      where: {
        integrationId: parseInt(id),
        ...stateWhere,
      },
      include: {
        _count: { select: { reviews: true, comments: true } },
      },
      // Order by prNumber (monotonic) — a bulk sync stamps every row's updatedAt
      // with ~the same timestamp, so updatedAt can't express real recency.
      orderBy: { prNumber: 'desc' },
    });
  })

  // Get PR details
  .get('/pull-requests/:id', async (context) => {
    const { params } = context;
    const { id } = params as { id: string };
    return await prisma.gitHubPullRequest.findUnique({
      where: { id: parseInt(id) },
      include: {
        integration: true,
        reviews: { orderBy: { submittedAt: 'desc' } },
        comments: { orderBy: { createdAt: 'asc' } },
      },
    });
  })

  // Resolve the PR for a task → its detail-page id. Used by the post-execution
  // panel to jump straight to the task's PR page (replacing the old approval
  // page). Resolution order:
  //   1. Direct GitHubPullRequest.linkedTaskId (set by linkAutoCreatedPr).
  //   2. PR number stored on the task (Task.githubPrId).
  //   3. Title match `[Task-{id}]` — both auto-PR paths title PRs this way, so
  //      this resolves tasks completed BEFORE the linking fix landed, as long as
  //      the PR row exists locally (a GitHub sync has pulled it in). On a hit we
  //      backfill the linkedTaskId/githubPrId links so it is fast (and the PR
  //      still resolves after a title edit) next time.
  .get('/pull-requests/by-task/:taskId', async (context) => {
    const { taskId } = context.params as { taskId: string };
    const tid = parseInt(taskId);
    const select = { id: true, prNumber: true, url: true, state: true } as const;

    let pr = await prisma.gitHubPullRequest.findFirst({
      where: { linkedTaskId: tid },
      orderBy: { createdAt: 'desc' },
      select,
    });
    if (!pr) {
      const task = await prisma.task.findUnique({
        where: { id: tid },
        select: { githubPrId: true },
      });
      if (task?.githubPrId != null) {
        pr = await prisma.gitHubPullRequest.findFirst({
          where: { prNumber: task.githubPrId },
          orderBy: { createdAt: 'desc' },
          select,
        });
      }
    }
    if (!pr) {
      // Match both PR-title conventions: the app's `[Task-{id}]` and the
      // agent's CLAUDE.md `[#{id}]`. Agent-created PRs use the latter and so
      // never went through linkAutoCreatedPr, leaving paths 1/2 empty.
      pr = await prisma.gitHubPullRequest.findFirst({
        where: {
          OR: [{ title: { contains: `[Task-${tid}]` } }, { title: { contains: `[#${tid}]` } }],
        },
        orderBy: { createdAt: 'desc' },
        select,
      });
      // Self-heal: backfill the links so subsequent clicks hit path 1/2.
      // Best-effort — a write failure must not break the navigation.
      if (pr) {
        try {
          await prisma.gitHubPullRequest.update({
            where: { id: pr.id },
            data: { linkedTaskId: tid },
          });
          await prisma.task.update({ where: { id: tid }, data: { githubPrId: pr.prNumber } });
        } catch {
          /* links remain unset; the title fallback still resolves it each time */
        }
      }
    }
    if (!pr) {
      // No local PR row. Distinguish "a PR was created but isn't synced locally"
      // from "no PR was ever created" using the auto_pr_created activity log, so
      // the UI can give an accurate message (and offer the external GitHub URL
      // instead of a dead end).
      context.set.status = 404;
      const prCreatedLog = await prisma.activityLog.findFirst({
        where: { taskId: tid, action: 'auto_pr_created' },
        orderBy: { createdAt: 'desc' },
        select: { metadata: true },
      });
      if (prCreatedLog) {
        let prUrl: string | undefined;
        let prNumber: number | undefined;
        try {
          const meta = JSON.parse(prCreatedLog.metadata ?? '{}') as {
            prUrl?: string;
            prNumber?: number;
          };
          prUrl = meta.prUrl;
          prNumber = meta.prNumber;
        } catch {
          /* malformed metadata — fall back to the generic not-synced message */
        }
        return {
          reason: 'not_synced',
          prUrl,
          prNumber,
          error:
            'PRは作成済みですが、ローカルに同期されていません。GitHub統合ページでPRを同期してください。',
        };
      }
      // Live fallback: the PR may exist on GitHub with no local row/log (e.g. no
      // GitHubIntegration for this repo, or linking failed). Ask gh directly so
      // the button still opens it instead of falsely reporting "not created".
      const live = await findPrViaGh(tid);
      if (live) {
        return {
          reason: 'not_synced',
          prUrl: live.prUrl,
          prNumber: live.prNumber,
          error:
            'PRは作成済みですが、ローカルに同期されていません（このリポジトリのGitHub統合が未登録の可能性）。GitHubで開きます。',
        };
      }
      return { reason: 'not_created', error: 'このタスクのPRはまだ作成されていません。' };
    }
    return pr;
  })

  // Get PR diff
  .get('/pull-requests/:id/diff', async (context) => {
    const { id } = context.params as { id: string };
    const pr = await resolvePrOrThrow(id);

    const repo = makeOwnerRepoString(pr.integration.ownerName, pr.integration.repositoryName);
    return await githubService.getPullRequestDiff(repo, pr.prNumber);
  });
