/**
 * GitHub Integration Routes
 *
 * Integration CRUD, repository status, available-repos listing,
 * PR/Issue sync, and webhook receiver.
 */
import { Elysia } from 'elysia';
import { prisma } from '../../../config/database';
import { GitHubService, type GitHubWebhookPayload } from '../../../services/core/github-service';
import { githubSchemas, githubParamSchemas } from '../../../schemas/github.schema';

const githubService = new GitHubService(prisma);

export const integrationRoutes = new Elysia()
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
