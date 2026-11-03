/**
 * WorktreeTerminalSweep
 *
 * Reclaims worktrees whose owning task is terminal (done/cancelled) or no longer
 * exists, driven by the task table rather than AgentSession rows. Not
 * responsible for deciding whether a worktree is clean — removeWorktree
 * refuses dirty ones.
 */

import { join } from 'node:path';
import * as fsPromises from 'node:fs/promises';
import { createLogger } from '../../../../../config/logger';
import { prisma } from '../../../../../config/database';
import { runAcrossAllWorkspaces } from '../../../../tenancy/workspace-context';
import { WORKTREE_DIR, normalizePath } from '../core/safety';
import { parseTaskIdFromWorktreeName, TERMINAL_STATUSES } from '../../../worktree-keep-list';
import { removeWorktree } from './worktree-remove';
import { listRegisteredWorktrees } from './worktree-git-list';
import {
  shouldSkipRemovalAttempt,
  recordRemovalRefused,
  clearRemovalRefusal,
} from './worktree-removal-backoff';

const logger = createLogger('git-operations/worktree-terminal-sweep');

// Bounds git subprocess bursts when a large backlog (160+) is first reclaimed;
// the remainder is picked up by the next scheduler cycle.
const MAX_REMOVALS_PER_SWEEP = 25;

/**
 * Of the worktrees whose task row is gone, the ones whose branch is provably
 * not the head of an OPEN pull request.
 *
 * NOTE(#1403): before this, a deleted task's worktree was never a candidate —
 * the sweep only acted on ids the DB positively reported as terminal, and the
 * keep list only protects ids the DB reports as live, so `task-1291-cadd90a4`
 * (GET /tasks/1291 → 404) fell between the two forever. A missing row alone is
 * not enough: an open PR means someone may still push review fixes from it.
 * Every "can't tell" — branch unknown, detached HEAD, git or gh failing —
 * keeps the worktree. Uncommitted work is still removeWorktree's call.
 *
 * @param baseDir - Main repository root / リポジトリルート
 * @param paths - Worktrees of tasks absent from the DB / DBに存在しないタスクのworktree
 * @returns The subset safe to offer to removeWorktree / removeWorktree に渡してよいもの
 */
async function selectOrphanedTaskWorktrees(baseDir: string, paths: string[]): Promise<string[]> {
  if (paths.length === 0) return [];
  let branchByPath: Map<string, string | null>;
  try {
    const registered = await listRegisteredWorktrees(baseDir);
    branchByPath = new Map(registered.map((w) => [w.normalized, w.branch]));
  } catch (error) {
    logger.warn(
      { err: error },
      '[sweepTerminalTaskWorktrees] Cannot list worktrees; keeping deleted-task worktrees',
    );
    return [];
  }

  // Dynamic: only reached when a task row is actually missing, and keeps the
  // GitHub client out of the static graph of every suite that loads this sweep.
  const { listPullRequestsForHead } = await import('../../../../github/pr-head-lookup');
  const selected: string[] = [];
  for (const wtPath of paths) {
    // Unregistered directories are the filesystem-orphan sweep's business.
    const branch = branchByPath.get(normalizePath(wtPath));
    if (!branch) continue;
    const prs = await listPullRequestsForHead(baseDir, branch);
    if (prs === null) {
      logger.info(`[sweepTerminalTaskWorktrees] PR state unknown for ${branch}; keeping ${wtPath}`);
      continue;
    }
    if (prs.some((pr) => pr.state === 'OPEN')) continue;
    selected.push(wtPath);
  }
  return selected;
}

/**
 * Remove clean worktrees of DB-confirmed terminal tasks, and of tasks the DB no
 * longer has whose branch is not under an open PR, even when no AgentSession
 * row references them.
 *
 * @param baseDir - Main repository root. / リポジトリルート
 * @param keepSet - Paths that must never be removed, in any spelling —
 *   normalized here rather than trusted, because a protection list that misses
 *   on a '/./' segment or a separator costs an irreversible deletion. / 保護対象パス
 * @returns Number of worktrees removed. / 削除した件数
 */
export async function sweepTerminalTaskWorktrees(
  baseDir: string,
  keepSet: Set<string>,
): Promise<number> {
  const keep = new Set([...keepSet].map(normalizePath));
  const worktreeRoot = join(baseDir, WORKTREE_DIR);
  let removedCount = 0;
  try {
    const dirs = await fsPromises.readdir(worktreeRoot);
    const candidates = new Map<number, string[]>();
    for (const dir of dirs) {
      const taskId = parseTaskIdFromWorktreeName(dir);
      const fullPath = join(worktreeRoot, dir);
      if (taskId === null || keep.has(normalizePath(fullPath))) continue;
      candidates.set(taskId, [...(candidates.get(taskId) ?? []), fullPath]);
    }
    if (candidates.size === 0) return 0;

    // Unscoped: inside a request the client is bound to one workspace, and a
    // live task of another workspace must not read as missing.
    const rows = await runAcrossAllWorkspaces(() =>
      prisma.task.findMany({
        where: { id: { in: [...candidates.keys()] } },
        select: { id: true, status: true },
      }),
    );
    const statusById = new Map(rows.map((r) => [r.id, r.status]));
    const terminalPaths: string[] = [];
    const missingPaths: string[] = [];
    for (const [id, paths] of candidates) {
      const status = statusById.get(id);
      if (status === undefined) missingPaths.push(...paths);
      else if (TERMINAL_STATUSES.includes(status)) terminalPaths.push(...paths);
      // Any other status is a live task — never touched here.
    }

    // A parked worktree is skipped below anyway; filtering first spares a gh
    // call per cycle for one that is refused for uncommitted work.
    const unparkedMissing = missingPaths.filter((p) => !shouldSkipRemovalAttempt(normalizePath(p)));
    const toRemove = [
      ...terminalPaths,
      ...(await selectOrphanedTaskWorktrees(baseDir, unparkedMissing)),
    ];
    for (const wtPath of toRemove) {
      if (removedCount >= MAX_REMOVALS_PER_SWEEP) break;
      const normalized = normalizePath(wtPath);
      if (shouldSkipRemovalAttempt(normalized)) continue;
      try {
        if (await removeWorktree(baseDir, wtPath)) {
          removedCount++;
          clearRemovalRefusal(normalized);
        } else {
          recordRemovalRefused(normalized);
        }
      } catch (error) {
        recordRemovalRefused(normalized);
        logger.warn({ err: error }, `[sweepTerminalTaskWorktrees] Failed to remove ${wtPath}`);
      }
    }
    if (removedCount > 0) {
      logger.info(
        `[sweepTerminalTaskWorktrees] Reclaimed ${removedCount} terminal/deleted-task worktree(s)`,
      );
    }
  } catch (error) {
    logger.warn({ err: error }, '[sweepTerminalTaskWorktrees] Sweep failed');
  }
  return removedCount;
}
