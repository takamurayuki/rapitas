/**
 * execution/base-branches-route
 *
 * GET /tasks/:id/base-branches — lists the origin branches available as a PR
 * base for a task, plus the theme's configured default. Backs the base-branch
 * dropdown in the agent execution form. Uses `git branch -r` in the task's
 * working directory (fast, local, reflects the last fetch) rather than a
 * network `ls-remote`.
 */

import { Elysia, t } from 'elysia';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { prisma } from '../../../../config/database';
import { createLogger } from '../../../../config/logger';

const execAsync = promisify(exec);
const log = createLogger('routes:agent-execution:base-branches');

/**
 * Parse `git branch -r` output into bare origin branch names.
 *
 * @param stdout - Raw `git branch -r` output. / git branch -r の生出力
 * @returns Sorted unique origin branch names (develop/main/master first). / origin ブランチ名
 */
function parseRemoteBranches(stdout: string): string[] {
  const names = stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    // Drop the symbolic "origin/HEAD -> origin/main" line.
    .filter((l) => !l.includes('->'))
    .map((l) => l.replace(/^origin\//, ''))
    .filter((l) => l && l !== 'HEAD');

  const unique = Array.from(new Set(names));
  const rank = (b: string) => (b === 'develop' ? 0 : b === 'main' ? 1 : b === 'master' ? 2 : 3);
  return unique.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

export const baseBranchesRoute = new Elysia().get(
  '/tasks/:id/base-branches',
  async (context) => {
    const taskId = parseInt(context.params.id);
    if (isNaN(taskId)) {
      context.set.status = 400;
      return { success: false, branches: [], defaultBranch: null, error: 'Invalid task ID' };
    }

    const task = await prisma.task
      .findUnique({
        where: { id: taskId },
        select: {
          workingDirectory: true,
          theme: { select: { workingDirectory: true, defaultBranch: true } },
        },
      })
      .catch(() => null);

    const defaultBranch = task?.theme?.defaultBranch ?? 'develop';
    const workingDirectory = task?.workingDirectory || task?.theme?.workingDirectory || null;

    if (!workingDirectory) {
      // No repo to inspect — return just the theme default so the UI still works.
      return { success: true, branches: defaultBranch ? [defaultBranch] : [], defaultBranch };
    }

    try {
      const { stdout } = await execAsync('git branch -r', {
        cwd: workingDirectory,
        encoding: 'utf8',
        timeout: 10000,
      });
      const branches = parseRemoteBranches(stdout);
      // Always include the configured default even if it isn't on origin yet.
      if (defaultBranch && !branches.includes(defaultBranch)) branches.unshift(defaultBranch);
      return { success: true, branches, defaultBranch };
    } catch (err) {
      log.warn({ err, taskId, workingDirectory }, '[base-branches] git branch -r failed');
      return {
        success: true,
        branches: defaultBranch ? [defaultBranch] : [],
        defaultBranch,
      };
    }
  },
  {
    params: t.Object({ id: t.String() }),
  },
);
