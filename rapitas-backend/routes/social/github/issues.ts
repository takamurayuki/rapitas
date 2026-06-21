/**
 * GitHub Issue Routes
 *
 * Issue list/detail, comments, task creation from issue, concern import/publish.
 * Includes the concern bridge endpoints (publish and import).
 */
import { Elysia } from 'elysia';
import { prisma } from '../../../config/database';
import { GitHubService } from '../../../services/core/github-service';
import {
  publishConcernToIssue,
  importIssueAsConcern,
  resolveConcernIntegration,
} from '../../../services/github/concern-bridge';
import { resolveIssueOrThrow } from '../../../services/github/resource-guard';

const githubService = new GitHubService(prisma);

export const issueRoutes = new Elysia()
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

    const issue = await resolveIssueOrThrow(id);

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

    const issue = await resolveIssueOrThrow(id);

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
  });
