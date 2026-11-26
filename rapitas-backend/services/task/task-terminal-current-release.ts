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
    findMany?: (args: {
      where?: { currentTaskId?: number };
    }) => Promise<Array<{ themeId: number }>>;
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
 * Drop `taskId` from every theme's companion tasks (task 1552). Best effort and
 * never throws: a client without the column (or a test stand-in without
 * `findMany`) releases nothing, and the scheduler's own release catches up.
 *
 * @param prisma - Prisma client / Prismaクライアント
 * @param taskId - Task that became terminal / 終端化したタスクID
 * @returns Themes whose companion slot was freed / 解放したテーマ数
 */
export async function releaseCompanionSlotsOf(
  prisma: ThemeAutoRunWriter,
  taskId: number,
): Promise<number> {
  try {
    // Lazy: keeps the auto-run module graph out of the task-update path's imports.
    const { releaseCompanionEverywhere } =
      await import('../workflow/auto-run/parallel/theme-active-set-cleanup');
    return await releaseCompanionEverywhere(
      prisma as unknown as Parameters<typeof releaseCompanionEverywhere>[0],
      taskId,
    );
  } catch (err) {
    log.warn({ err, taskId }, 'Failed to release companion slot (scheduler will)');
    return 0;
  }
}

/**
 * Null out currentTaskId on every theme whose current task is `taskId`, and
 * drop it from every theme's companions (task 1552). CAS on the id, so a theme
 * that already moved on to another task is untouched.
 *
 * @param prisma - Prisma client / Prismaクライアント
 * @param taskId - Task that became terminal / 終端化したタスクID
 * @returns Number of themes released / 解放したテーマ数
 */
export async function releaseCurrentTaskIfMatches(
  prisma: ThemeAutoRunWriter,
  taskId: number,
  kind: 'completed' | 'released' = 'released',
): Promise<number> {
  if (typeof prisma.themeAutoRun.findMany === 'function') {
    // 新列を条件にせず読み、旧クライアントでも対象ID付きCASへ委ねる。
    const rows = await prisma.themeAutoRun.findMany({});
    const { releaseThemeSlot } = await import('../workflow/auto-run/parallel/theme-active-set');
    let count = 0;
    for (const row of rows) {
      const result = await releaseThemeSlot(
        prisma as unknown as Parameters<typeof releaseThemeSlot>[0],
        row.themeId,
        taskId,
        kind,
        undefined,
        true,
      );
      if (result !== 'not_member') count++;
    }
    return count;
  }
  // 読み取りを提供しない書き込み専用クライアントでも対象IDは必須。
  const res = await prisma.themeAutoRun.updateMany(releaseCurrentArgs(taskId));
  return res.count + (await releaseCompanionSlotsOf(prisma, taskId));
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
    const count = await releaseCurrentTaskIfMatches(
      prisma,
      taskId,
      status === 'done' ? 'completed' : 'released',
    );
    if (count > 0) {
      log.info({ taskId, status, count }, 'Released theme currentTaskId of terminal task');
    }
  } catch (err) {
    log.warn({ err, taskId, status }, 'Failed to release theme currentTaskId (scheduler will)');
  }
}
