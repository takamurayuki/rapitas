/**
 * PRRoutes
 *
 * Elysia route handlers for pull-request lifecycle operations:
 * - POST /parallel/tasks/:id/create-pr
 * - POST /parallel/tasks/:id/approve-merge
 * - GET  /parallel/tasks/:id/pr-status
 */
import { Elysia, t } from 'elysia';
import { prisma } from '../../../config/database';
import { createLogger, getProjectRoot } from '../../../config';
import { GitOperations } from '../../../services/agents/orchestrator/git-operations';
import { reviewBranchDiff, postReviewToPR } from '../../../services/ai/ai-code-review';
import { sendWebhookNotification } from '../../../services/communication/webhook-notification-service';
import { pollDeploymentStatus } from '../../../services/misc/preview-deploy-service';
import { buildPRBody, readWorkflowFile } from './pr-helpers';
import { validateWorkingDirectory } from './working-dir-guard';

const log = createLogger('routes:parallel-execution:pr');

export const prRoutes = new Elysia()
  /**
   * Create a PR for a completed task branch with implementation summary and AI code review.
   */
  .post(
    '/tasks/:id/create-pr',
    async (context) => {
      const { params, body } = context;
      try {
        const taskId = parseInt(params.id);
        const baseBranch = (body as Record<string, unknown>).baseBranch as string | undefined;

        const task = await prisma.task.findUnique({
          where: { id: taskId },
          include: {
            theme: true,
            parent: true,
            developerModeConfig: {
              include: {
                agentSessions: { orderBy: { lastActivityAt: 'desc' }, take: 1 },
              },
            },
          },
        });

        if (!task) return { success: false, error: 'タスクが見つかりません' };

        const wdResult = validateWorkingDirectory(
          taskId,
          task.theme?.workingDirectory,
          'create-pr',
        );
        if (!wdResult.ok) {
          log.error(`[create-pr] Task ${taskId} rejected: ${wdResult.error}`);
          return { success: false, error: wdResult.error };
        }
        const workingDirectory = wdResult.workingDirectory;

        const latestSession = task.developerModeConfig?.agentSessions?.[0];
        const branchName = latestSession?.branchName;

        if (!branchName) return { success: false, error: 'ブランチが見つかりません' };

        const prBody = await buildPRBody(taskId, task, workingDirectory);
        const gitOps = new GitOperations();
        const pushDir = latestSession?.worktreePath || workingDirectory;

        // Push branch to remote
        const { execSync } = await import('child_process');
        try {
          execSync(`git push -u origin ${branchName}`, {
            cwd: pushDir,
            encoding: 'utf8',
            timeout: 30000,
          });
        } catch {
          execSync(`git push -u origin ${branchName}`, {
            cwd: workingDirectory,
            encoding: 'utf8',
            timeout: 30000,
          });
        }

        const prResult = await gitOps.createPullRequest(
          pushDir,
          `[Task-${taskId}] ${task.title}`,
          prBody,
          baseBranch || 'develop',
        );

        if (!prResult.success) return { success: false, error: prResult.error };

        await prisma.task.update({
          where: { id: taskId },
          data: { githubPrId: prResult.prNumber },
        });

        // NOTE: Run AI code review and post to PR (fire-and-forget)
        void (async () => {
          try {
            const planContent = await readWorkflowFile(taskId, 'plan');
            const review = await reviewBranchDiff(
              pushDir,
              baseBranch || 'develop',
              planContent || undefined,
            );
            if (review.totalFindings > 0 && prResult.prNumber) {
              await postReviewToPR(pushDir, prResult.prNumber, review);
            }
          } catch (err) {
            log.warn({ err }, '[PR] AI code review failed (non-fatal)');
          }
        })();

        void sendWebhookNotification('pr_created', {
          taskId,
          taskTitle: task.title,
          message: `PR #${prResult.prNumber} created for「${task.title}」`,
          url: prResult.prUrl,
        });

        // NOTE: Poll for preview deployment URL in background (fire-and-forget)
        if (prResult.prNumber) {
          void pollDeploymentStatus(pushDir, prResult.prNumber).catch((err) => {
            log.debug({ err }, '[PR] Preview deploy polling failed (non-fatal)');
          });
        }

        log.info(`[PR] Created PR #${prResult.prNumber} for task ${taskId}: ${prResult.prUrl}`);

        return {
          success: true,
          data: { prUrl: prResult.prUrl, prNumber: prResult.prNumber, branchName },
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log.error({ errorMessage }, '[PR] Failed to create PR');
        return { success: false, error: errorMessage };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({ baseBranch: t.Optional(t.String()) }),
    },
  )

  /**
   * Approve and merge a task's PR, then update local develop.
   */
  .post(
    '/tasks/:id/approve-merge',
    async (context) => {
      const { params } = context;
      try {
        const taskId = parseInt(params.id);

        const task = await prisma.task.findUnique({
          where: { id: taskId },
          include: {
            theme: true,
            developerModeConfig: {
              include: {
                agentSessions: { orderBy: { lastActivityAt: 'desc' }, take: 1 },
              },
            },
          },
        });

        if (!task) return { success: false, error: 'タスクが見つかりません' };
        if (!task.githubPrId)
          return { success: false, error: 'PRが見つかりません。先にPRを作成してください。' };

        const wdResult2 = validateWorkingDirectory(
          taskId,
          task.theme?.workingDirectory,
          'approve-merge',
        );
        if (!wdResult2.ok) {
          log.error(`[approve-merge] Task ${taskId} rejected: ${wdResult2.error}`);
          return { success: false, error: wdResult2.error };
        }
        const workingDirectory = wdResult2.workingDirectory;

        const gitOps = new GitOperations();

        const mergeResult = await gitOps.mergePullRequest(
          workingDirectory,
          task.githubPrId,
          1,
          'develop',
        );

        if (!mergeResult.success) return { success: false, error: mergeResult.error };

        await prisma.task.update({
          where: { id: taskId },
          data: { status: 'done', completedAt: new Date() },
        });

        // Clean up worktree if still exists
        const latestSession = task.developerModeConfig?.agentSessions?.[0];
        if (latestSession?.worktreePath) {
          try {
            await gitOps.removeWorktree(workingDirectory, latestSession.worktreePath);
            await prisma.agentSession.update({
              where: { id: latestSession.id },
              data: { worktreePath: null },
            });
          } catch (cleanupErr) {
            log.warn({ err: cleanupErr }, '[Merge] Worktree cleanup failed (non-fatal)');
          }
        }

        void sendWebhookNotification('pr_merged', {
          taskId,
          taskTitle: task.title,
          message: `PR #${task.githubPrId} merged for「${task.title}」(${mergeResult.mergeStrategy})`,
        });

        log.info(`[Merge] Merged PR #${task.githubPrId} for task ${taskId}`);

        return {
          success: true,
          data: { prNumber: task.githubPrId, mergeStrategy: mergeResult.mergeStrategy },
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log.error({ errorMessage }, '[Merge] Failed to merge PR');
        return { success: false, error: errorMessage };
      }
    },
    {
      params: t.Object({ id: t.String() }),
    },
  )

  /**
   * Get PR status for a task.
   */
  .get(
    '/tasks/:id/pr-status',
    async (context) => {
      const { params } = context;
      try {
        const taskId = parseInt(params.id);
        const task = await prisma.task.findUnique({
          where: { id: taskId },
          select: { id: true, title: true, status: true, githubPrId: true },
        });

        if (!task) return { success: false, error: 'タスクが見つかりません' };

        let prInfo: Record<string, unknown> | null = null;
        if (task.githubPrId) {
          try {
            const { execSync } = await import('child_process');
            const ghPath =
              process.platform === 'win32' ? '"C:\\Program Files\\GitHub CLI\\gh.exe"' : 'gh';
            const prJson = execSync(
              `${ghPath} pr view ${task.githubPrId} --json url,state,mergeable`,
              { cwd: getProjectRoot(), encoding: 'utf8', timeout: 10000 },
            );
            prInfo = JSON.parse(prJson);
          } catch {
            prInfo = null;
          }
        }

        return {
          success: true,
          data: {
            taskId: task.id,
            title: task.title,
            status: task.status,
            prNumber: task.githubPrId,
            prInfo,
          },
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return { success: false, error: errorMessage };
      }
    },
    {
      params: t.Object({ id: t.String() }),
    },
  );
