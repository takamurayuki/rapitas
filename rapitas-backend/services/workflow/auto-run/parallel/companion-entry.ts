/**
 * companion-entry
 *
 * The check that routes a theme's selection to companion selection (task 1552)
 * while the per-theme limit allows parallel work and the theme already runs a
 * task. Kept free of the advance modules so auto-run-advance-select can import
 * it without an import cycle. Not responsible for choosing the companion.
 */
import type { PrismaClient } from '../../../../generated/prisma-postgres';
import { createLogger } from '../../../../config/logger';
// Namespace import: tests mock auto-run-concurrency with only the functions they use.
import * as concurrency from '../auto-run-concurrency';
import { activeTaskIds, loadThemeActiveSet, parseCompanions } from './theme-active-set';

const log = createLogger('theme-auto-run-scheduler');

/**
 * Effective per-theme limit; 1 whenever it cannot be resolved (mocked module,
 * read error) so the pre-task one-at-a-time path runs.
 *
 * @param prisma - Prisma client / Prismaクライアント
 * @returns Effective per-theme limit / 実効のテーマ内上限
 */
export async function effectivePerThemeLimit(prisma: PrismaClient): Promise<number> {
  if (typeof concurrency.resolveAutoRunMaxConcurrencyPerTheme !== 'function') return 1;
  try {
    return (await concurrency.resolveAutoRunMaxConcurrencyPerTheme(prisma)).effective;
  } catch {
    return 1;
  }
}

/**
 * Route a selection to companion selection when the per-theme limit allows
 * parallel work and the theme already runs a task. Keeps a completion path
 * (which calls selection right after releasing its slot) from overwriting a
 * just-promoted head.
 *
 * @param prisma - Prisma client / Prismaクライアント
 * @param themeId - Theme / テーマID
 * @param order - Selection order / 選定順
 * @returns true when handled here (caller must not select a head) / ここで処理したか
 */
export async function delegateToCompanionSelection(
  prisma: PrismaClient,
  themeId: number,
  order: 'priority' | 'created',
): Promise<boolean> {
  const set = await loadThemeActiveSet(prisma, themeId);
  if (activeTaskIds(set).length === 0) return false;
  // 上限の引き下げは新規追加だけを止め、生存中の先頭を保護する。
  if ((await effectivePerThemeLimit(prisma)) < 2) return true;
  try {
    const { selectCompanionTask } = await import('./companion-selection');
    await selectCompanionTask(prisma, themeId, order);
  } catch (err) {
    log.warn({ err, themeId }, '[ThemeAutoRunScheduler] companion selection failed');
  }
  return true;
}

/**
 * Advance the companions of a PAUSED theme (no new selection): a head waiting
 * for plan approval must not freeze its companions' completion handling.
 * Lazily imported so the lifecycle module keeps its import graph.
 *
 * @param prisma - Prisma client / Prismaクライアント
 * @param state - The paused theme's state row / 一時停止中テーマの状態
 */
export async function advancePausedCompanions(
  prisma: PrismaClient,
  state: { themeId: number; order: 'priority' | 'created'; companionTasksJson?: string | null },
): Promise<void> {
  if (parseCompanions(state.companionTasksJson).length === 0) return;
  try {
    const { advanceCompanions } = await import('./advance-companions');
    await advanceCompanions(
      prisma,
      state.themeId,
      state.companionTasksJson,
      state.order,
      0,
      new Map(),
      {
        select: false,
      },
    );
  } catch (err) {
    log.error(
      { err, themeId: state.themeId },
      '[ThemeAutoRunScheduler] paused-theme companions failed',
    );
  }
}
