/**
 * Task-originated GitHub Routes
 *
 * Routes that create or link GitHub resources (Issues, PRs) from a task context.
 * These routes have no prefix — they live under /tasks/:id/...
 */
import { Elysia } from 'elysia';
import { prisma } from '../../../config/database';
import { GitHubService } from '../../../services/core/github-service';
import { resolveIntegrationOrThrow } from '../../../services/github/resource-guard';

const githubService = new GitHubService(prisma);

export const taskGithubRoutes = new Elysia()
  // Create GitHub Issue from Task
  .post('/tasks/:id/create-github-issue', async (context) => {
    const { id } = context.params as { id: string };
    const { integrationId, labels } = context.body as { integrationId: number; labels?: string[] };

    const task = await prisma.task.findUnique({
      where: { id: parseInt(id) },
    });
    if (!task) return { error: 'Task not found' };

    const integration = await resolveIntegrationOrThrow(integrationId);

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

    // :prId is the local GitHubPullRequest row id. Task.githubPrId stores the
    // PR *number* (the by-task path-2 lookup is `where prNumber: githubPrId`),
    // so read the number off the row rather than storing the local id.
    const pr = await prisma.gitHubPullRequest.update({
      where: { id: parseInt(prId) },
      data: { linkedTaskId: parseInt(id) },
      select: { prNumber: true },
    });

    await prisma.task.update({
      where: { id: parseInt(id) },
      data: { githubPrId: pr.prNumber },
    });

    return { success: true };
  });
