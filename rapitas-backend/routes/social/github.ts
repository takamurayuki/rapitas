/**
 * GitHub Integration API Routes
 * GitHub repository integration, PR, and Issue management
 */
import { Elysia, t } from 'elysia';
import { prisma } from '../../config/database';
import { GitHubService, type GitHubWebhookPayload } from '../../services/core/github-service';
import { listWorkflowRuns, getWorkflowRun, getWorkflowRunLog } from '../../services/github/actions';
import {
  publishConcernToIssue,
  importIssueAsConcern,
  resolveConcernIntegration,
} from '../../services/github/concern-bridge';
import { githubSchemas, githubParamSchemas, githubQuerySchemas } from '../../schemas/github.schema';

// Create GitHub service instance
const githubService = new GitHubService(prisma);

/**
 * Resolve the local working directory for a PR's merge so we can sync the base
 * branch afterwards. Uses the linked task's working directory, falling back to
 * its theme's. Returns null when none is known (sync is then skipped).
 *
 * @param linkedTaskId - The PR's linked task id (may be null). / PRに紐づくタスクID
 * @returns Local repo path, or null. / ローカルリポジトリパス、無ければnull
 */
async function resolvePrWorkingDirectory(linkedTaskId: number | null): Promise<string | null> {
  if (linkedTaskId == null) return null;
  const task = await prisma.task
    .findUnique({
      where: { id: linkedTaskId },
      select: { workingDirectory: true, theme: { select: { workingDirectory: true } } },
    })
    .catch(() => null);
  return task?.workingDirectory ?? task?.theme?.workingDirectory ?? null;
}

export const githubRoutes = new Elysia({ prefix: '/github' })
  // GitHub CLI status check
  .get('/status', async () => {
    const ghAvailable = await githubService.isGhAvailable();
    const authenticated = ghAvailable ? await githubService.isAuthenticated() : false;
    return { ghAvailable, authenticated };
  })

  // List repos the gh user can access (for one-click integration add).
  // Each repo is flagged with whether it's already integrated.
  .get('/available-repos', async (context) => {
    const rawLimit = parseInt((context.query as { limit?: string })?.limit ?? '100', 10);
    const limit = Number.isFinite(rawLimit) ? rawLimit : 100;
    const [repos, integrations] = await Promise.all([
      githubService.listRepositories(limit),
      prisma.gitHubIntegration.findMany({ select: { ownerName: true, repositoryName: true } }),
    ]);
    const added = new Set(
      integrations.map((i) => `${i.ownerName}/${i.repositoryName}`.toLowerCase()),
    );
    return repos.map((r) => ({ ...r, alreadyAdded: added.has(r.nameWithOwner.toLowerCase()) }));
  })

  // Integration list
  .get('/integrations', async () => {
    return await prisma.gitHubIntegration.findMany({
      include: {
        _count: { select: { pullRequests: true, issues: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  })

  // Create integration
  .post('/integrations', async (context) => {
    const {
      repositoryUrl,
      ownerName,
      repositoryName,
      syncIssues,
      syncPullRequests,
      autoLinkTasks,
    } = context.body as {
      repositoryUrl: string;
      ownerName: string;
      repositoryName: string;
      syncIssues?: boolean;
      syncPullRequests?: boolean;
      autoLinkTasks?: boolean;
    };

    return await prisma.gitHubIntegration.create({
      data: {
        repositoryUrl,
        ownerName,
        repositoryName,
        syncIssues: syncIssues ?? true,
        syncPullRequests: syncPullRequests ?? true,
        autoLinkTasks: autoLinkTasks ?? true,
      },
    });
  })

  // Integration details
  .get('/integrations/:id', async ({ params }) => {
    const { id } = params;
    return await prisma.gitHubIntegration.findUnique({
      where: { id: parseInt(id) },
      include: {
        _count: { select: { pullRequests: true, issues: true } },
      },
    });
  })

  // Update integration
  .patch(
    '/integrations/:id',
    async ({ params, body }) => {
      const { id } = params;
      const { syncIssues, syncPullRequests, autoLinkTasks, isActive } = body as {
        syncIssues?: boolean;
        syncPullRequests?: boolean;
        autoLinkTasks?: boolean;
        isActive?: boolean;
      };

      return await prisma.gitHubIntegration.update({
        where: { id: parseInt(id) },
        data: {
          ...(syncIssues !== undefined && { syncIssues }),
          ...(syncPullRequests !== undefined && { syncPullRequests }),
          ...(autoLinkTasks !== undefined && { autoLinkTasks }),
          ...(isActive !== undefined && { isActive }),
        },
      });
    },
    {
      params: githubParamSchemas.integrationId,
      body: githubSchemas.integrationUpdate,
    },
  )

  // Delete integration
  .delete(
    '/integrations/:id',
    async ({ params }) => {
      const { id } = params;
      return await prisma.gitHubIntegration.delete({
        where: { id: parseInt(id) },
      });
    },
    {
      params: githubParamSchemas.integrationId,
    },
  )

  // Sync PRs
  .post('/integrations/:id/sync-prs', async ({ params }) => {
    const { id } = params;
    const count = await githubService.syncPullRequests(parseInt(id));
    return { syncedCount: count };
  })

  // Sync Issues
  .post('/integrations/:id/sync-issues', async (context) => {
    const { params } = context;
    const { id } = params as { id: string };
    const count = await githubService.syncIssues(parseInt(id));
    return { syncedCount: count };
  })

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
      const repo = `${integration.ownerName}/${integration.repositoryName}`;
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
  // page). Prefers the direct GitHubPullRequest.linkedTaskId; falls back to the
  // PR number stored on the task (Task.githubPrId).
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
      context.set.status = 404;
      return { error: 'このタスクのPRが見つかりません' };
    }
    return pr;
  })

  // Get PR diff
  .get('/pull-requests/:id/diff', async (context) => {
    const { params } = context;
    const { id } = params as { id: string };
    const pr = await prisma.gitHubPullRequest.findUnique({
      where: { id: parseInt(id) },
      include: { integration: true },
    });

    if (!pr) return { error: 'PR not found' };

    const repo = `${pr.integration.ownerName}/${pr.integration.repositoryName}`;
    return await githubService.getPullRequestDiff(repo, pr.prNumber);
  })

  // Post PR comment
  .post('/pull-requests/:id/comments', async (context) => {
    const { id } = context.params as { id: string };
    const {
      body: commentBody,
      path,
      line,
    } = context.body as { body: string; path?: string; line?: number };

    const pr = await prisma.gitHubPullRequest.findUnique({
      where: { id: parseInt(id) },
      include: { integration: true },
    });

    if (!pr) return { error: 'PR not found' };

    const repo = `${pr.integration.ownerName}/${pr.integration.repositoryName}`;
    const comment = await githubService.createPullRequestComment(repo, pr.prNumber, {
      body: commentBody,
      path,
      line,
    });

    // Save comment to DB
    await prisma.gitHubPRComment.create({
      data: {
        pullRequestId: parseInt(id),
        commentId: comment.id || 0,
        body: commentBody,
        path,
        line,
        authorLogin: 'rapitas',
        isFromRapitas: true,
      },
    });

    return comment;
  })

  // Approve PR
  .post('/pull-requests/:id/approve', async (context) => {
    const { id } = context.params as { id: string };
    const { body: reviewBody } = context.body as { body?: string };

    const pr = await prisma.gitHubPullRequest.findUnique({
      where: { id: parseInt(id) },
      include: { integration: true },
    });

    if (!pr) return { error: 'PR not found' };

    const repo = `${pr.integration.ownerName}/${pr.integration.repositoryName}`;
    await githubService.approvePullRequest(repo, pr.prNumber, reviewBody);

    // Create notification
    await prisma.notification.create({
      data: {
        type: 'pr_approved',
        title: 'PR承認完了',
        message: `PR #${pr.prNumber} (${pr.title}) を承認しました`,
        link: pr.url,
      },
    });

    return { success: true };
  })

  // Request PR changes
  .post('/pull-requests/:id/request-changes', async (context) => {
    const id = context.params.id;
    const reviewBody = (context.body as { body?: string }).body;

    const pr = await prisma.gitHubPullRequest.findUnique({
      where: { id: parseInt(id) },
      include: { integration: true },
    });

    if (!pr) return { error: 'PR not found' };

    const repo = `${pr.integration.ownerName}/${pr.integration.repositoryName}`;
    await githubService.requestChanges(repo, pr.prNumber, reviewBody ?? '');

    return { success: true };
  })

  // Merge PR
  .post('/pull-requests/:id/merge', async (context) => {
    const { id } = context.params as { id: string };
    const { method, deleteBranch } = (context.body ?? {}) as {
      method?: 'merge' | 'squash' | 'rebase';
      deleteBranch?: boolean;
    };

    const pr = await prisma.gitHubPullRequest.findUnique({
      where: { id: parseInt(id) },
      include: { integration: true },
    });
    if (!pr) return { success: false, error: 'PR not found' };

    const repo = `${pr.integration.ownerName}/${pr.integration.repositoryName}`;
    try {
      await githubService.mergePullRequest(repo, pr.prNumber, { method, deleteBranch });
    } catch (err) {
      // gh fails on conflicts / branch protection / not-approved — surface it.
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: `マージに失敗しました: ${message}` };
    }

    await prisma.gitHubPullRequest
      .update({ where: { id: parseInt(id) }, data: { state: 'merged', updatedAt: new Date() } })
      .catch(() => {});

    // Pull the merged changes into the LOCAL base branch so the working copy
    // reflects the merge. Best-effort — a sync failure doesn't fail the merge.
    let localSync: { synced: boolean; detail: string } | null = null;
    const workingDirectory = await resolvePrWorkingDirectory(pr.linkedTaskId);
    if (workingDirectory) {
      localSync = await githubService.syncLocalBranchWithRemote(workingDirectory, pr.baseBranch);
    }

    await prisma.notification
      .create({
        data: {
          type: 'pr_merged',
          title: 'PRマージ完了',
          message: `PR #${pr.prNumber} (${pr.title}) をマージしました`,
          link: pr.url,
        },
      })
      .catch(() => {});

    return { success: true, localSync };
  })

  // Change the base (merge target) branch of a PR.
  .patch('/pull-requests/:id/base', async (context) => {
    const { id } = context.params as { id: string };
    const { baseBranch } = (context.body ?? {}) as { baseBranch?: string };
    if (!baseBranch) {
      context.set.status = 400;
      return { success: false, error: 'baseBranch は必須です' };
    }

    const pr = await prisma.gitHubPullRequest.findUnique({
      where: { id: parseInt(id) },
      include: { integration: true },
    });
    if (!pr) {
      context.set.status = 404;
      return { success: false, error: 'PR not found' };
    }

    const repo = `${pr.integration.ownerName}/${pr.integration.repositoryName}`;
    try {
      await githubService.changePullRequestBase(repo, pr.prNumber, baseBranch);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      context.set.status = 502;
      return { success: false, error: `マージ先ブランチの変更に失敗しました: ${message}` };
    }

    await prisma.gitHubPullRequest
      .update({ where: { id: parseInt(id) }, data: { baseBranch, updatedAt: new Date() } })
      .catch(() => {});

    return { success: true, baseBranch };
  })

  // Get Issue list
  .get('/integrations/:id/issues', async (context) => {
    const { id } = context.params as { id: string };
    const { state, fromGitHub } = context.query as { state?: string; fromGitHub?: string };

    if (fromGitHub === 'true') {
      const integration = await prisma.gitHubIntegration.findUnique({
        where: { id: parseInt(id) },
      });
      if (!integration) return [];
      const repo = `${integration.ownerName}/${integration.repositoryName}`;
      return await githubService.getIssues(repo, (state as 'open' | 'closed' | 'all') || 'open');
    }

    return await prisma.gitHubIssue.findMany({
      where: {
        integrationId: parseInt(id),
        // Match either case: rows synced/published before state was normalized
        // may be stored UPPERCASE ("OPEN"), so the "open" filter must still find
        // them. (Provider-agnostic — avoids Postgres-only `mode: insensitive`.)
        ...(state &&
          state !== 'all' && {
            state: { in: [state.toLowerCase(), state.toUpperCase()] },
          }),
      },
      orderBy: { updatedAt: 'desc' },
    });
  })

  // CI/CD: list a repo's recent GitHub Actions workflow runs.
  .get('/integrations/:id/runs', async (context) => {
    const { id } = context.params as { id: string };
    const { limit } = context.query as { limit?: string };
    const integration = await prisma.gitHubIntegration.findUnique({ where: { id: parseInt(id) } });
    if (!integration) return [];
    const repo = `${integration.ownerName}/${integration.repositoryName}`;
    try {
      return await listWorkflowRuns(repo, limit ? parseInt(limit) : 20);
    } catch (err) {
      context.set.status = 502;
      return { error: err instanceof Error ? err.message : 'CI/CD 実行履歴の取得に失敗しました' };
    }
  })

  // CI/CD: a single run with its jobs/steps.
  .get('/integrations/:id/runs/:runId', async (context) => {
    const { id, runId } = context.params as { id: string; runId: string };
    const integration = await prisma.gitHubIntegration.findUnique({ where: { id: parseInt(id) } });
    if (!integration) {
      context.set.status = 404;
      return { error: 'リポジトリ連携が見つかりません' };
    }
    const repo = `${integration.ownerName}/${integration.repositoryName}`;
    try {
      return await getWorkflowRun(repo, parseInt(runId));
    } catch (err) {
      context.set.status = 502;
      return { error: err instanceof Error ? err.message : '実行詳細の取得に失敗しました' };
    }
  })

  // CI/CD: a run's logs (?failed=true returns only the failed steps' output).
  .get('/integrations/:id/runs/:runId/log', async (context) => {
    const { id, runId } = context.params as { id: string; runId: string };
    const { failed } = context.query as { failed?: string };
    const integration = await prisma.gitHubIntegration.findUnique({ where: { id: parseInt(id) } });
    if (!integration) {
      context.set.status = 404;
      return { error: 'リポジトリ連携が見つかりません' };
    }
    const repo = `${integration.ownerName}/${integration.repositoryName}`;
    const log = await getWorkflowRunLog(repo, parseInt(runId), failed === 'true');
    return { log };
  })

  // Get Issue details
  .get('/issues/:id', async (context) => {
    const { params } = context;
    const { id } = params as { id: string };
    return await prisma.gitHubIssue.findUnique({
      where: { id: parseInt(id) },
      include: { integration: true },
    });
  })

  // Post Issue comment
  .post('/issues/:id/comments', async (context) => {
    const { id } = context.params as { id: string };
    const { body: commentBody } = context.body as { body: string };

    const issue = await prisma.gitHubIssue.findUnique({
      where: { id: parseInt(id) },
      include: { integration: true },
    });

    if (!issue) return { error: 'Issue not found' };

    const repo = `${issue.integration.ownerName}/${issue.integration.repositoryName}`;
    return await githubService.addIssueComment(repo, issue.issueNumber, commentBody);
  })

  // Create Task from Issue
  .post('/issues/:id/create-task', async (context) => {
    const { id } = context.params as { id: string };
    const { projectId, themeId, priority } = context.body as {
      projectId?: number;
      themeId?: number;
      priority?: string;
    };

    const issue = await prisma.gitHubIssue.findUnique({
      where: { id: parseInt(id) },
    });

    if (!issue) return { error: 'Issue not found' };

    const task = await prisma.task.create({
      data: {
        title: `[GitHub] ${issue.title}`,
        description: issue.body || '',
        priority: priority || 'medium',
        githubIssueId: issue.id,
        ...(projectId && { projectId }),
        ...(themeId && { themeId }),
      },
    });

    // Link Issue and Task
    await prisma.gitHubIssue.update({
      where: { id: parseInt(id) },
      data: { linkedTaskId: task.id },
    });

    return task;
  })

  // Import a synced Issue into the concern backlog
  .post('/issues/:id/create-concern', async (context) => {
    const { id } = context.params as { id: string };
    const result = await importIssueAsConcern(parseInt(id));
    if (!result.success) {
      context.set.status = result.status;
      return { error: result.error };
    }
    return { success: true, concernId: result.concernId };
  })

  // Publish a concern to GitHub as a new Issue
  .post('/concerns/:id/publish', async (context) => {
    const { id } = context.params as { id: string };
    const { integrationId, labels } = (context.body ?? {}) as {
      integrationId?: number;
      labels?: string[];
    };
    // The concern's theme determines the target repo, so integrationId is
    // optional — resolve it from the theme. Only when that fails (no theme/repo
    // or no matching integration) do we ask the user to pick a repo.
    let targetIntegrationId = integrationId;
    if (!targetIntegrationId) {
      const resolved = await resolveConcernIntegration(parseInt(id));
      targetIntegrationId = resolved?.id;
    }
    if (!targetIntegrationId) {
      context.set.status = 409;
      return {
        error: 'テーマから公開先リポジトリを特定できませんでした。公開先を選択してください。',
        code: 'NEEDS_INTEGRATION',
      };
    }
    const result = await publishConcernToIssue(parseInt(id), targetIntegrationId, labels);
    if (!result.success) {
      context.set.status = result.status;
      return { error: result.error };
    }
    return { success: true, issue: result.issue };
  })

  // Webhook receiver
  .post('/webhook', async (context) => {
    const { request, body } = context;
    const event = request.headers.get('x-github-event');
    if (!event) {
      return { error: 'Missing X-GitHub-Event header' };
    }

    await githubService.handleWebhook(event, body as GitHubWebhookPayload);
    return { success: true };
  });

// Task-related GitHub routes (without prefix, to be added separately)
export const taskGithubRoutes = new Elysia()
  // Create GitHub Issue from Task
  .post('/tasks/:id/create-github-issue', async (context) => {
    const { id } = context.params as { id: string };
    const { integrationId, labels } = context.body as { integrationId: number; labels?: string[] };

    const task = await prisma.task.findUnique({
      where: { id: parseInt(id) },
    });
    if (!task) return { error: 'Task not found' };

    const integration = await prisma.gitHubIntegration.findUnique({
      where: { id: integrationId },
    });
    if (!integration) return { error: 'Integration not found' };

    const repo = `${integration.ownerName}/${integration.repositoryName}`;
    const issue = await githubService.createIssue(repo, {
      title: task.title,
      body: task.description || '',
      labels,
    });

    // Save Issue to DB
    const savedIssue = await prisma.gitHubIssue.create({
      data: {
        integrationId,
        issueNumber: issue.number,
        title: issue.title,
        body: issue.body,
        state: issue.state,
        labels: JSON.stringify(issue.labels),
        authorLogin: issue.authorLogin,
        url: issue.url,
        linkedTaskId: parseInt(id),
        lastSyncedAt: new Date(),
      },
    });

    // Update Task
    await prisma.task.update({
      where: { id: parseInt(id) },
      data: { githubIssueId: savedIssue.id },
    });

    return savedIssue;
  })

  // Link GitHub PR to Task
  .post('/tasks/:id/link-github-pr/:prId', async (context) => {
    const { params } = context;
    const { id, prId } = params as { id: string; prId: string };

    await prisma.gitHubPullRequest.update({
      where: { id: parseInt(prId) },
      data: { linkedTaskId: parseInt(id) },
    });

    await prisma.task.update({
      where: { id: parseInt(id) },
      data: { githubPrId: parseInt(prId) },
    });

    return { success: true };
  });
