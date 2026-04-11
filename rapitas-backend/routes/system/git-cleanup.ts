/**
 * GitCleanupRoutes
 *
 * API endpoints for cleaning up git worktrees and branches.
 */
import { Elysia, t } from 'elysia';
import { GitOperations } from '../../services/agents/orchestrator/git-operations';
import { cleanupOrphanedWorktrees } from '../../services/agents/orchestrator/git-operations/worktree-ops';
import { createLogger } from '../../config/logger';
import { getProjectRoot } from '../../config';
import { promisify } from 'util';
import { exec } from 'child_process';

const execAsync = promisify(exec);
const log = createLogger('routes:git-cleanup');

export const gitCleanupRoutes = new Elysia({ prefix: '/git-cleanup' })
  /**
   * Clean up all stale worktrees and their associated branches for a repository.
   */
  .post(
    '/worktrees',
    async (context) => {
      const { body } = context;
      try {
        const { workingDirectory } = body as { workingDirectory?: string };
        const baseDir = workingDirectory || getProjectRoot();

        log.info(`[cleanup-worktrees] Starting cleanup for ${baseDir}`);

        const gitOps = new GitOperations();
        const count = await gitOps.cleanupStaleWorktrees(baseDir);

        return {
          success: true,
          data: {
            cleanedCount: count,
            workingDirectory: baseDir,
          },
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log.error({ err: error }, '[cleanup-worktrees] Cleanup failed');
        return {
          success: false,
          error: errorMessage,
        };
      }
    },
    {
      body: t.Object({
        workingDirectory: t.Optional(t.String()),
      }),
    },
  )

  /**
   * List all worktrees for a repository.
   */
  .get(
    '/worktrees/list',
    async (context) => {
      const { query } = context;
      try {
        const { workingDirectory } = query as { workingDirectory?: string };
        const baseDir = workingDirectory || getProjectRoot();

        const { stdout } = await execAsync('git worktree list --porcelain', {
          cwd: baseDir,
          encoding: 'utf8',
        });

        const entries = stdout.split('\n\n').filter(Boolean);
        const worktrees = [];

        for (const entry of entries) {
          const pathMatch = entry.match(/^worktree\s+(.+)$/m);
          const branchMatch = entry.match(/^branch\s+refs\/heads\/(.+)$/m);
          const headMatch = entry.match(/^HEAD\s+(.+)$/m);

          if (pathMatch) {
            worktrees.push({
              path: pathMatch[1],
              branch: branchMatch?.[1] || null,
              head: headMatch?.[1] || null,
              isMain: !branchMatch, // Main repo has no branch line
            });
          }
        }

        return {
          success: true,
          data: {
            worktrees,
            workingDirectory: baseDir,
          },
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log.error({ err: error }, '[list-worktrees] Failed to list worktrees');
        return {
          success: false,
          error: errorMessage,
        };
      }
    },
    {
      query: t.Object({
        workingDirectory: t.Optional(t.String()),
      }),
    },
  )

  /**
   * Delete orphaned task branches (branches with "task-" prefix that have no worktree).
   */
  .post(
    '/branches/cleanup-orphaned',
    async (context) => {
      const { body } = context;
      try {
        const { workingDirectory, dryRun } = body as {
          workingDirectory?: string;
          dryRun?: boolean;
        };
        const baseDir = workingDirectory || getProjectRoot();

        log.info(
          `[cleanup-orphaned-branches] Starting cleanup for ${baseDir} (dryRun: ${!!dryRun})`,
        );

        // Get all branches with "task-" prefix
        const { stdout: branchList } = await execAsync('git branch', {
          cwd: baseDir,
          encoding: 'utf8',
        });

        const taskBranches = branchList
          .split('\n')
          .map((line: string) => line.trim().replace(/^\*\s+/, ''))
          .filter((branch: string) => branch.includes('task-') || branch.includes('wt-'));

        // Get all worktree branches
        const { stdout: worktreeList } = await execAsync('git worktree list --porcelain', {
          cwd: baseDir,
          encoding: 'utf8',
        });

        const worktreeBranches = new Set<string>();
        const entries = worktreeList.split('\n\n').filter(Boolean);
        for (const entry of entries) {
          const branchMatch = entry.match(/^branch\s+refs\/heads\/(.+)$/m);
          if (branchMatch) {
            worktreeBranches.add(branchMatch[1]);
          }
        }

        // Find orphaned branches (task branches without worktrees)
        const orphanedBranches = taskBranches.filter(
          (branch: string) => !worktreeBranches.has(branch),
        );

        if (dryRun) {
          return {
            success: true,
            data: {
              dryRun: true,
              orphanedBranches,
              count: orphanedBranches.length,
            },
          };
        }

        // Delete orphaned branches
        const deleted: string[] = [];
        const failed: Array<{ branch: string; error: string }> = [];

        for (const branch of orphanedBranches) {
          try {
            await execAsync(`git branch -D "${branch}"`, {
              cwd: baseDir,
              encoding: 'utf8',
            });
            deleted.push(branch);
            log.info(`[cleanup-orphaned-branches] Deleted branch: ${branch}`);
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            failed.push({ branch, error: errorMessage });
            log.warn(`[cleanup-orphaned-branches] Failed to delete ${branch}: ${errorMessage}`);
          }
        }

        return {
          success: true,
          data: {
            deleted,
            failed,
            totalOrphaned: orphanedBranches.length,
            deletedCount: deleted.length,
            failedCount: failed.length,
          },
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log.error({ err: error }, '[cleanup-orphaned-branches] Cleanup failed');
        return {
          success: false,
          error: errorMessage,
        };
      }
    },
    {
      body: t.Object({
        workingDirectory: t.Optional(t.String()),
        dryRun: t.Optional(t.Boolean()),
      }),
    },
  )

  /**
   * Clean up orphaned worktrees based on database reconciliation.
   * This is more intelligent than the basic stale worktree cleanup as it checks
   * database sessions and removes worktrees for completed/failed/cancelled sessions.
   */
  .post(
    '/worktrees/orphaned',
    async (context) => {
      const { body } = context;
      try {
        const { workingDirectory } = body as { workingDirectory?: string };
        const baseDir = workingDirectory || getProjectRoot();

        log.info(`[cleanup-orphaned-worktrees] Starting database-based cleanup for ${baseDir}`);

        const count = await cleanupOrphanedWorktrees(baseDir);

        return {
          success: true,
          data: {
            cleanedCount: count,
            workingDirectory: baseDir,
          },
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log.error({ err: error }, '[cleanup-orphaned-worktrees] Cleanup failed');
        return {
          success: false,
          error: errorMessage,
        };
      }
    },
    {
      body: t.Object({
        workingDirectory: t.Optional(t.String()),
      }),
    },
  );
