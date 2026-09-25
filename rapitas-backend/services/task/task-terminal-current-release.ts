/**
 * task-terminal-current-release
 *
 * Releases a theme's ThemeAutoRun.currentTaskId when the task it points at has
 * reached a terminal state. Shared by the PATCH /tasks path and the auto-run
 * scheduler / stall-guard so all of them free the theme slot identically.
 * Not responsible for selecting the next task — the scheduler does that.
 */
import { createLogger } from '../../config/logger';

const log = createLogger('task-terminal-current-release');

/** Minimal Prisma surface needed to release a current task. */
export interface ThemeAutoRunWriter {
  themeAutoRun: {
    updateMany: (args: {
      where: { currentTaskId: number };
      data: { currentTaskId: null };
    }) => Promise<{ count: number }>;
  };
}

/**
 * Update arguments that null currentTaskId for themes pinned to `taskId`;
 * shared so the in-transaction and standalone paths cannot diverge.
 *
 * @param taskId - Task that became terminal / 終端化したタスクID
 * @returns updateMany args / updateMany の引数
 */
export function releaseCurrentArgs(taskId: number) {
  return { where: { currentTaskId: taskId }, data: { currentTaskId: null } };
}

/**
 * Null out currentTaskId on every theme whose current task is `taskId`.
 * CAS on the id, so a theme that already moved on to another task is untouched.
 *
 * @param prisma - Prisma client / Prismaクライアント
 * @param taskId - Task that became terminal / 終端化したタスクID
 * @returns Number of themes released / 解放したテーマ数
 */
export async function releaseCurrentTaskIfMatches(
  prisma: ThemeAutoRunWriter,
  taskId: number,
): Promise<number> {
  const res = await prisma.themeAutoRun.updateMany(releaseCurrentArgs(taskId));
  return res.count;
}

/**
 * Standalone (non-transactional) release for done/cancelled. Never throws, so a
 * failure cannot undo the status update. Used only when the client has no
 * `$transaction`; updateTask otherwise releases atomically with the status write.
 *
 * @param prisma - Prisma client / Prismaクライアント
 * @param taskId - Updated task / 更新したタスクID
 * @param status - New task status, if changed / 新しいstatus
 */
export async function releaseThemeCurrentOnTerminal(
  prisma: ThemeAutoRunWriter,
  taskId: number,
  status: string | undefined,
): Promise<void> {
  if (status !== 'done' && status !== 'cancelled') return;
  try {
    const count = await releaseCurrentTaskIfMatches(prisma, taskId);
    if (count > 0) {
      log.info({ taskId, status, count }, 'Released theme currentTaskId of terminal task');
    }
  } catch (err) {
    log.warn({ err, taskId, status }, 'Failed to release theme currentTaskId (scheduler will)');
  }
}
