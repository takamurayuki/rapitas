/**
 * Workflow Auto Commit and PR
 *
 * Handles automatic git commit, pull request creation, merge, and worktree cleanup
 * triggered when verify.md is saved and the workflow reaches 'completed' status.
 * Not responsible for route definitions or file persistence.
 */

import { join } from 'path';
import { prisma, getProjectRoot } from '../../config';
import { AgentOrchestrator } from '../../services/agents/agent-orchestrator';
import { createLogger } from '../../config/logger';
import {
  logAutoCommit,
  logAutoPR,
  logAutoMerge,
  logAutoMergeFailure,
} from './workflow-activity-logger';

const log = createLogger('routes:workflow:auto-commit');

export type AutoCommitPRResult = {
  autoCommitResult?: {
    success: boolean;
    hash?: string;
    branch?: string;
    filesChanged?: number;
    error?: string;
  };
  autoPRResult?: { success: boolean; prUrl?: string; prNumber?: number; error?: string };
  autoMergeResult?: { success: boolean; mergeStrategy?: string; error?: string };
  worktreeCleanupResult?: { success: boolean; worktreePath?: string; error?: string };
  error?: string;
};

/**
 * Perform auto-commit, PR creation, optional merge, and worktree cleanup after verify.md is saved.
 *
 * @param taskId - Task ID that was completed / 完了したタスクID
 * @param verifyContent - Content of verify.md for PR body / PRボディ用verify.mdの内容
 * @returns Result object containing outcomes of each step / 各ステップの結果オブジェクト
 */
export async function performAutoCommitAndPR(
  taskId: number,
  verifyContent: string,
): Promise<AutoCommitPRResult> {
  const result: AutoCommitPRResult = {};

  try {
    const execConfig = await prisma.agentExecutionConfig.findUnique({ where: { taskId } });

    if (!execConfig || (!execConfig.autoCommit && !execConfig.autoCreatePR && !execConfig.autoMergePR)) {
      return result;
    }

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

    if (!task) return result;

    // CRITICAL: Require explicit workingDirectory to prevent accidental modification of rapitas source
    const workingDirectory = execConfig.workingDirectory || task.theme?.workingDirectory;
    if (!workingDirectory) {
      log.warn(`[workflow] Task ${taskId} rejected: workingDirectory not configured.`);
      return { ...result, error: 'Task theme must have workingDirectory configured. Please set the working directory in theme settings.' };
    }

    const projectRoot = getProjectRoot();
    if (workingDirectory === projectRoot || workingDirectory.startsWith(join(projectRoot, 'rapitas-'))) {
      log.warn(`[workflow] Task ${taskId} rejected: workingDirectory points to rapitas project itself (${workingDirectory}).`);
      return { ...result, error: 'workingDirectory must not point to the rapitas project itself.' };
    }

    const latestSession = task.developerModeConfig?.agentSessions?.[0];
    const branchName = latestSession?.branchName;
    const targetBranch =
      ((execConfig as Record<string, unknown>).targetBranch as string) ||
      task.theme?.defaultBranch ||
      'master';

    const orchestrator = AgentOrchestrator.getInstance(prisma);

    // Process autoCommit
    if (execConfig.autoCommit) {
      try {
        if (branchName) {
          await orchestrator.createBranch(workingDirectory, branchName);
        }
        const commitResult = await orchestrator.createCommit(workingDirectory, `feat(task-${taskId}): ${task.title}`);
        result.autoCommitResult = {
          success: true,
          hash: commitResult.hash,
          branch: commitResult.branch,
          filesChanged: commitResult.filesChanged,
        };
        log.info(`[Workflow] Auto-commit successful for task ${taskId}: ${commitResult.hash}`);
        await logAutoCommit(taskId, commitResult.hash, commitResult.branch, commitResult.filesChanged, commitResult.additions, commitResult.deletions);
      } catch (commitError) {
        log.error({ err: commitError }, `[Workflow] Auto-commit failed for task ${taskId}`);
        result.autoCommitResult = {
          success: false,
          error: commitError instanceof Error ? commitError.message : String(commitError),
        };
      }
    }

    // Process autoCreatePR (only if autoCommit succeeded)
    if (execConfig.autoCreatePR && result.autoCommitResult?.success) {
      try {
        const prTitle = `[Task-${taskId}] ${task.title}`;
        const prBody = `## Summary\n\nAuto-generated PR for Task #${taskId}: ${task.title}\n\n## Verification Report\n\n${verifyContent}\n\n---\n🤖 Generated automatically by Rapitas AI Agent`;
        const prResult = await orchestrator.createPullRequest(workingDirectory, prTitle, prBody, targetBranch);
        result.autoPRResult = prResult;

        if (prResult.success) {
          log.info(`[Workflow] Auto-PR created for task ${taskId}: ${prResult.prUrl}`);
          await logAutoPR(taskId, task.title, prResult.prUrl, prResult.prNumber);
        } else {
          log.error({ error: prResult.error }, `[Workflow] Auto-PR creation failed for task ${taskId}`);
        }
      } catch (prError) {
        log.error({ err: prError }, `[Workflow] Auto-PR failed for task ${taskId}`);
        result.autoPRResult = {
          success: false,
          error: prError instanceof Error ? prError.message : String(prError),
        };
      }
    }

    // Process autoMergePR (only if autoCreatePR succeeded)
    if (execConfig.autoMergePR && result.autoPRResult?.success && result.autoPRResult?.prNumber) {
      try {
        const mergeResult = await orchestrator.mergePullRequest(
          workingDirectory,
          result.autoPRResult.prNumber,
          execConfig.mergeCommitThreshold ?? 5,
          targetBranch,
        );
        result.autoMergeResult = mergeResult;

        if (mergeResult.success) {
          log.info(`[Workflow] Auto-merge successful for task ${taskId}: strategy=${mergeResult.mergeStrategy}`);
          await logAutoMerge(taskId, task.title, result.autoPRResult.prNumber, result.autoPRResult.prUrl, mergeResult.mergeStrategy);
        } else {
          log.error({ error: mergeResult.error }, `[Workflow] Auto-merge failed for task ${taskId}`);
          await logAutoMergeFailure(taskId, task.title, result.autoPRResult.prNumber, result.autoPRResult.prUrl, mergeResult.error);
        }
      } catch (mergeError) {
        log.error({ err: mergeError }, `[Workflow] Auto-merge failed for task ${taskId}`);
        result.autoMergeResult = {
          success: false,
          error: mergeError instanceof Error ? mergeError.message : String(mergeError),
        };
      }
    }

    // Clean up git worktree after commit/PR/merge is complete
    const worktreePath = latestSession?.worktreePath;
    if (worktreePath) {
      try {
        await orchestrator.removeWorktree(getProjectRoot(), worktreePath);
        await prisma.agentSession.update({ where: { id: latestSession.id }, data: { worktreePath: null } });
        result.worktreeCleanupResult = { success: true, worktreePath };
        log.info(`[Workflow] Worktree cleaned up for task ${taskId}: ${worktreePath}`);
      } catch (cleanupError) {
        // NOTE: Cleanup failure should not fail the overall workflow
        log.error({ err: cleanupError }, `[Workflow] Worktree cleanup failed for task ${taskId}: ${worktreePath}`);
        result.worktreeCleanupResult = {
          success: false,
          worktreePath,
          error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        };
      }
    }
  } catch (error) {
    log.error({ err: error }, `[Workflow] Auto-commit/PR process failed for task ${taskId}`);
  }

  return result;
}
