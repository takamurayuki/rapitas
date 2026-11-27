/**
 * RestartResume
 *
 * After a restart that ended a restart wait, brings the themes that were
 * running back to `running` and lifts the wait. Idempotent and safe on a boot
 * that had no wait. Not responsible for deciding or performing the restart.
 */
import { createLogger } from '../../../config/logger';
import {
  readRestartWaitState,
  writeRestartWaitState,
  type DeferredAdvance,
} from './restart-wait-store';
import { endRestartWait, resetRestartWaitCache } from './restart-wait';
import { withRestartGate } from './restart-gate';
import { replayDeferredAdvances, type ReplayDeps } from './deferred-advance';

const log = createLogger('auto-restart-resume');

/** Result of one resume pass. */
export interface ResumeResult {
  /** Themes switched back to running. */
  resumed: number[];
  /** Themes left alone (gone, already running, or paused/stopping by the user). */
  skipped: number[];
}

/** What resume needs from the outside (injectable so tests need no database). */
export interface ResumeDeps {
  /** Current auto-run row of a theme, or null when it no longer exists. */
  findRun(themeId: number): Promise<{ enabled: boolean; status: string; order: string } | null>;
  /** Switch a theme's auto-run to running. */
  start(themeId: number, order: 'priority' | 'created'): Promise<unknown>;
}

const defaultDeps: ResumeDeps = {
  async findRun(themeId) {
    const { prisma } = await import('../../../config/database');
    return prisma.themeAutoRun.findFirst({
      where: { themeId },
      select: { enabled: true, status: true, order: true },
    });
  },
  async start(themeId, order) {
    const { startAutoRun } = await import('../../workflow/auto-run/theme-auto-run-mutations');
    return startAutoRun(themeId, order);
  },
};

type Outcome = 'resumed' | 'skipped' | 'failed';

/**
 * Handle one theme inside the restart gate: the membership check, the state
 * read and the `running` write are one section, so a stop that lands in
 * between either removed the theme first (nothing starts) or runs after the
 * start (and stops it).
 */
function restoreOne(themeId: number, deps: ResumeDeps): Promise<Outcome> {
  return withRestartGate(async (): Promise<Outcome> => {
    const current = readRestartWaitState();
    // Re-read: the pending list may be stale (a stop removed the theme meanwhile).
    if (!current.resumeThemeIds?.includes(themeId)) return 'skipped';
    let outcome: Outcome;
    try {
      const run = await deps.findRun(themeId);
      // Anything but a plain idle/stopped theme is somebody else's state: already running,
      // or paused/stopping (the user's intent — never override it).
      if (!run || run.status !== 'idle') {
        outcome = 'skipped';
      } else {
        await deps.start(themeId, run.order === 'created' ? 'created' : 'priority');
        outcome = 'resumed';
      }
    } catch (err) {
      log.warn({ err, themeId }, '[RestartResume] Could not resume the theme');
      return 'failed'; // stays in the saved set for the retry
    }
    const left = readRestartWaitState();
    const rest = (left.resumeThemeIds ?? []).filter((id) => id !== themeId);
    if (!writeRestartWaitState({ ...left, resumeThemeIds: rest.length > 0 ? rest : undefined }))
      throw new Error('テーマの復元結果を保存できませんでした');
    return outcome;
  });
}

/**
 * Restore the saved themes to `running`, one at a time, then end the wait.
 *
 * Only `phase=waiting` (a complete set) and `phase=retry` (themes that failed
 * last time) restore anything; `collecting`, phase-less legacy data and an
 * unreadable file wake nothing. Failed themes are kept with `phase=retry` for
 * the next start; everything else is cleared.
 *
 * @param deps - Database seams (tests) / DB操作の差し替え
 * @param replayDeps - Seams for replaying refused advances (tests) / 保留advance再実行の差し替え
 * @returns Which themes were resumed and which skipped / 再開・スキップしたテーマ
 */
export async function resumeThemesAfterRestart(
  deps: ResumeDeps = defaultDeps,
  replayDeps?: ReplayDeps,
): Promise<ResumeResult> {
  const result: ResumeResult = { resumed: [], skipped: [] };
  const state = await withRestartGate(async () => {
    resetRestartWaitCache();
    const saved = readRestartWaitState();
    if (saved.phase !== 'waiting' && saved.phase !== 'retry') {
      endRestartWait('restarted', Date.now(), {});
    }
    return saved;
  });
  const usable = state.phase === 'waiting' || state.phase === 'retry';
  const pending = usable ? [...(state.resumeThemeIds ?? [])] : [];
  if (!usable) return result;

  const failed: number[] = [];
  for (const themeId of pending) {
    const outcome = await restoreOne(themeId, deps);
    if (outcome === 'failed') failed.push(themeId);
    else result[outcome].push(themeId);
  }
  let deferred: DeferredAdvance[] | undefined;
  let lifted = false;
  await withRestartGate(async () => {
    // 失敗後にstop/pauseが取り消したIDを古いfailed配列から復活させない。
    const current = readRestartWaitState();
    // Advances refused while this boot was still holding dispatch; replayed once it is lifted.
    deferred = current.deferredAdvance;
    const retryIds = failed.filter((id) => current.resumeThemeIds?.includes(id));
    lifted = endRestartWait(
      'restarted',
      Date.now(),
      retryIds.length > 0 || deferred?.length
        ? {
            phase: 'retry',
            resumeThemeIds: retryIds.length ? retryIds : undefined,
            deferredAdvance: deferred,
          }
        : {},
    );
  });
  // The flag is cleared now, so the replayed advances are admitted (themes are back first).
  if (lifted) await replayDeferredAdvances(deferred, replayDeps, true);
  log.info({ ...result, failed }, '[RestartResume] Themes restored after restart');
  return result;
}
