/**
 * GitHub Integration API Routes
 * GitHub repository integration, PR, and Issue management
 */
import { Elysia } from "elysia";
import { prisma } from "../config/database";
import { GitHubService, type GitHubWebhookPayload } from "../services/github-service";

// Create GitHub service instance
const githubService = new GitHubService(prisma);

export const githubRoutes = new Elysia({ prefix: "/github" })
  // GitHub CLI status check
  .get("/status", async ({ params }: any) => {
    const ghAvailable = await githubService.isGhAvailable();
    const authenticated = ghAvailable
      ? await githubService.isAuthenticated()
      : false;
    return { ghAvailable, authenticated };
  })

  // Integration list
  .get("/integrations", async ({ params }: any) => {
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
    async ({  body,  }: any) => {
      const { id, prId } = params as any;

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
