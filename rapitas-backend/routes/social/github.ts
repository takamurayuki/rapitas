/**
 * GitHub Integration API Routes
 * GitHub repository integration, PR, and Issue management
 */
import { Elysia, t } from "elysia";
import { prisma } from "../../config/database";
import { GitHubService, type GitHubWebhookPayload } from "../../services/github-service";
import { githubSchemas, githubParamSchemas, githubQuerySchemas } from "../../schemas/github.schema";

// Create GitHub service instance
const githubService = new GitHubService(prisma);

export const githubRoutes = new Elysia({ prefix: "/github" })
  // GitHub CLI status check
  .get("/status", async () => {
    const ghAvailable = await githubService.isGhAvailable();
    const authenticated = ghAvailable
      ? await githubService.isAuthenticated()
      : false;
    return { ghAvailable, authenticated };
  })

  // Integration list
  .get("/integrations", async () => {
    return await prisma.gitHubIntegration.findMany({
      include: {
        _count: { select: { pullRequests: true, issues: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  })

  // Create integration
  .post(
    "/integrations",
    async (context) => {
      const { repositoryUrl,
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
    },
  )

  // Integration details
  .get(
    "/integrations/:id",
    async ({ params }) => {
      const { id } = params;
      return await prisma.gitHubIntegration.findUnique({
        where: { id: parseInt(id) },
        include: {
          _count: { select: { pullRequests: true, issues: true } },
        },
      });
    },
  )

  // Update integration
  .patch(
    "/integrations/:id",
    async ({ params, body }) => {
      const { id } = params;
      const { syncIssues, syncPullRequests, autoLinkTasks, isActive } = body as { syncIssues?: boolean; syncPullRequests?: boolean; autoLinkTasks?: boolean; isActive?: boolean };

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
      body: githubSchemas.integrationUpdate
    }
  )

  // Delete integration
  .delete(
    "/integrations/:id",
    async ({ params }) => {
      const { id } = params;
      return await prisma.gitHubIntegration.delete({
        where: { id: parseInt(id) },
      });
    },
    {
      params: githubParamSchemas.integrationId
    }
  )

  // Sync PRs
  .post(
    "/integrations/:id/sync-prs",
    async ({ params }) => {
      const { id } = params;
      const count = await githubService.syncPullRequests(parseInt(id));
      return { syncedCount: count };
    },
  )

  // Sync Issues
  .post(
    "/integrations/:id/sync-issues",
    async (context) => {
      const { params  } = context;
      const { id  } = params as { id: string };
      const count = await githubService.syncIssues(parseInt(id));
      return { syncedCount: count };
    },
  )

  // Get PR list
  .get(
    "/integrations/:id/pull-requests",
    async (context) => {
      const { params, query } = context;
      const { id } = params as { id: string };
      const { state, fromGitHub } = query as { state?: string; fromGitHub?: string };

      if (fromGitHub === "true") {
        const integration = await prisma.gitHubIntegration.findUnique({
          where: { id: parseInt(id) },
        });
        if (!integration) return [];
        const repo = `${integration.ownerName}/${integration.repositoryName}`;
        return await githubService.getPullRequests(
          repo,
          (state as "open" | "closed" | "all") || "open",
        );
      }

      return await prisma.gitHubPullRequest.findMany({
        where: {
          integrationId: parseInt(id),
          ...(state && state !== "all" && { state }),
        },
        include: {
          _count: { select: { reviews: true, comments: true } },
        },
        orderBy: { updatedAt: "desc" },
      });
    },
  )

  // Get PR details
  .get(
    "/pull-requests/:id",
    async (context) => {
      const { params  } = context;
      const { id  } = params as { id: string };
      return await prisma.gitHubPullRequest.findUnique({
        where: { id: parseInt(id) },
        include: {
          integration: true,
          reviews: { orderBy: { submittedAt: "desc" } },
          comments: { orderBy: { createdAt: "asc" } },
        },
      });
    },
  )

  // Get PR diff
  .get(
    "/pull-requests/:id/diff",
    async (context) => {
      const { params  } = context;
      const { id  } = params as { id: string };
      const pr = await prisma.gitHubPullRequest.findUnique({
        where: { id: parseInt(id) },
        include: { integration: true },
      });

      if (!pr) return { error: "PR not found" };

      const repo = `${pr.integration.ownerName}/${pr.integration.repositoryName}`;
      return await githubService.getPullRequestDiff(repo, pr.prNumber);
    },
  )

  // Post PR comment
  .post(
    "/pull-requests/:id/comments",
    async (context) => {
      const { id  } = context.params as { id: string };
      const { body: commentBody, path, line  } = context.body as { body: string; path?: string; line?: number };

      const pr = await prisma.gitHubPullRequest.findUnique({
        where: { id: parseInt(id) },
        include: { integration: true },
      });

      if (!pr) return { error: "PR not found" };

      const repo = `${pr.integration.ownerName}/${pr.integration.repositoryName}`;
      const comment = await githubService.createPullRequestComment(
        repo,
        pr.prNumber,
        {
          body: commentBody,
          path,
          line,
        },
      );

      // Save comment to DB
      await prisma.gitHubPRComment.create({
        data: {
          pullRequestId: parseInt(id),
          commentId: comment.id || 0,
          body: commentBody,
          path,
          line,
          authorLogin: "rapitas",
          isFromRapitas: true,
        },
      });

      return comment;
    },
  )

  // Approve PR
  .post(
    "/pull-requests/:id/approve",
    async (context) => {
      const { id  } = context.params as { id: string };
      const { body: reviewBody  } = context.body as { body?: string };

      const pr = await prisma.gitHubPullRequest.findUnique({
        where: { id: parseInt(id) },
        include: { integration: true },
      });

      if (!pr) return { error: "PR not found" };

      const repo = `${pr.integration.ownerName}/${pr.integration.repositoryName}`;
      await githubService.approvePullRequest(repo, pr.prNumber, reviewBody);

      // Create notification
      await prisma.notification.create({
        data: {
          type: "pr_approved",
          title: "PR承認完了",
          message: `PR #${pr.prNumber} (${pr.title}) を承認しました`,
          link: pr.url,
        },
      });

      return { success: true };
    },
  )

  // Request PR changes
  .post(
    "/pull-requests/:id/request-changes",
    async (context) => {
      const id = context.params.id;
      const reviewBody = (context.body as { body?: string }).body;

      const pr = await prisma.gitHubPullRequest.findUnique({
        where: { id: parseInt(id) },
        include: { integration: true },
      });

      if (!pr) return { error: "PR not found" };

      const repo = `${pr.integration.ownerName}/${pr.integration.repositoryName}`;
      await githubService.requestChanges(repo, pr.prNumber, reviewBody);

      return { success: true };
    },
  )

  // Get Issue list
  .get(
    "/integrations/:id/issues",
    async (context) => {
      const { id } = context.params as { id: string };
      const { state, fromGitHub } = context.query as { state?: string; fromGitHub?: string };

      if (fromGitHub === "true") {
        const integration = await prisma.gitHubIntegration.findUnique({
          where: { id: parseInt(id) },
        });
        if (!integration) return [];
        const repo = `${integration.ownerName}/${integration.repositoryName}`;
        return await githubService.getIssues(
          repo,
          (state as "open" | "closed" | "all") || "open",
        );
      }

      return await prisma.gitHubIssue.findMany({
        where: {
          integrationId: parseInt(id),
          ...(state && state !== "all" && { state }),
        },
        orderBy: { updatedAt: "desc" },
      });
    },
  )

  // Get Issue details
  .get(
    "/issues/:id",
    async (context) => {
      const { params  } = context;
      const { id  } = params as { id: string };
      return await prisma.gitHubIssue.findUnique({
        where: { id: parseInt(id) },
        include: { integration: true },
      });
    },
  )

  // Post Issue comment
  .post(
    "/issues/:id/comments",
    async (context) => {
      const { id  } = context.params as { id: string };
      const { body: commentBody  } = context.body as { body: string };

      const issue = await prisma.gitHubIssue.findUnique({
        where: { id: parseInt(id) },
        include: { integration: true },
      });

      if (!issue) return { error: "Issue not found" };

      const repo = `${issue.integration.ownerName}/${issue.integration.repositoryName}`;
      return await githubService.addIssueComment(
        repo,
        issue.issueNumber,
        commentBody,
      );
    },
  )

  // Create Task from Issue
  .post(
    "/issues/:id/create-task",
    async (context) => {
      const { id } = context.params as { id: string };
      const { projectId, themeId, priority } = context.body as { projectId?: number; themeId?: number; priority?: string };

      const issue = await prisma.gitHubIssue.findUnique({
        where: { id: parseInt(id) },
      });

      if (!issue) return { error: "Issue not found" };

      const task = await prisma.task.create({
        data: {
          title: `[GitHub] ${issue.title}`,
          description: issue.body || "",
          priority: priority || "medium",
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
    },
  )

  // Webhook receiver
  .post(
    "/webhook",
    async (context) => {
      const { request, body } = context;
      const event = request.headers.get("x-github-event");
      if (!event) {
        return { error: "Missing X-GitHub-Event header" };
      }

      await githubService.handleWebhook(event, body as GitHubWebhookPayload);
      return { success: true };
    },
  );

// Task-related GitHub routes (without prefix, to be added separately)
export const taskGithubRoutes = new Elysia()
  // Create GitHub Issue from Task
  .post(
    "/tasks/:id/create-github-issue",
    async (context) => {
      const { id } = context.params as { id: string };
      const { integrationId, labels } = context.body as { integrationId: number; labels?: string[] };

      const task = await prisma.task.findUnique({
        where: { id: parseInt(id) },
      });
      if (!task) return { error: "Task not found" };

      const integration = await prisma.gitHubIntegration.findUnique({
        where: { id: integrationId },
      });
      if (!integration) return { error: "Integration not found" };

      const repo = `${integration.ownerName}/${integration.repositoryName}`;
      const issue = await githubService.createIssue(repo, {
        title: task.title,
        body: task.description || "",
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
    },
  )

  // Link GitHub PR to Task
  .post(
    "/tasks/:id/link-github-pr/:prId",
    async (context) => {
      const { params  } = context;
      const { id, prId  } = params as { id: string; prId: string };

      await prisma.gitHubPullRequest.update({
        where: { id: parseInt(prId) },
        data: { linkedTaskId: parseInt(id) },
      });

      await prisma.task.update({
        where: { id: parseInt(id) },
        data: { githubPrId: parseInt(prId) },
      });

      return { success: true };
    },
  );
