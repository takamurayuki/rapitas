/**
 * WorktreeTerminalSweep
 *
 * Reclaims worktrees whose owning task is terminal (done/cancelled), driven by
 * the task table rather than AgentSession rows. Not responsible for deciding
 * whether a worktree is clean — removeWorktree refuses dirty ones.
 */

import { join } from 'node:path';
import * as fsPromises from 'node:fs/promises';
import { createLogger } from '../../../../../config/logger';
import { prisma } from '../../../../../config/database';
import { WORKTREE_DIR, normalizePath } from '../core/safety';
import { parseTaskIdFromWorktreeName, TERMINAL_STATUSES } from '../../../worktree-keep-list';
import { removeWorktree } from './worktree-remove';
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
 * Remove clean worktrees of DB-confirmed terminal tasks, even when no
 * AgentSession row references them.
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

    // Only ids the DB positively reports as terminal are eligible: unknown ids
    // are left alone (unlike cleanupStaleWorktrees, which removes everything).
    const terminal = await prisma.task.findMany({
      where: { id: { in: [...candidates.keys()] }, status: { in: TERMINAL_STATUSES } },
      select: { id: true },
    });

    for (const { id } of terminal) {
      for (const wtPath of candidates.get(id) ?? []) {
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
    }
    if (removedCount > 0) {
      logger.info(
        `[sweepTerminalTaskWorktrees] Reclaimed ${removedCount} terminal-task worktree(s)`,
      );
    }
  } catch (error) {
    logger.warn({ err: error }, '[sweepTerminalTaskWorktrees] Sweep failed');
  }
  return removedCount;
}
