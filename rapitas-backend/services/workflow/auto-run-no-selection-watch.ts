/**
 * auto-run-no-selection-watch
 *
 * Watches the one auto-run state nothing else watched: a theme that reports
 * `running` while it has NO current task. Detection only — it never mutates
 * queue or task state.
 *
 * Why it exists: every other progress detector is anchored on `currentTaskId`,
 * and the zero-progress pass explicitly gives up when that is null ("no
 * execution subject"). On 2026-09-27 a theme sat in exactly that state from
 * 06:48 to 11:03 — status `running`, no current task, nothing dispatchable —
 * and produced no cycle event for over four hours. The reconciler ticked, the
 * backend was healthy, the starvation pass fired seven times about unrelated
 * items, and no signal said the loop had stopped. It took a human reading the
 * cycle log's mtime to notice.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { createNotification } from '../communication/notification-service';
import { logCycleEvent } from '../observability';
import { hasLiveExecution } from './auto-run/auto-run-selection';
import { resolveQueuedWaiters } from './queue-starvation-waiters';

const log = createLogger('auto-run-no-selection-watch');

/**
 * How long "running with no current task" must persist before it is reported.
 * A healthy dry point flips the theme to `idle` within one scheduler tick, so
 * minutes of this state already means the advance is not completing.
 */
export const NO_SELECTION_THRESHOLD_MS = 10 * 60 * 1000;

/** Re-notify window for the same theme. */
const RENOTIFY_WINDOW_MS = 6 * 60 * 60 * 1000;

const NOTIFY_TITLE = '自動実行が前進していません';

/** Episode anchors per theme; null entry = not currently in the state. */
const sinceMs = new Map<number, number>();

/** Reset the tracker. Test-only — never call from production code. */
export function resetNoSelectionTracker(): void {
  sinceMs.clear();
}

/**
 * Drop one theme's episode because it has a current task again.
 *
 * @param themeId - Theme that resumed selecting. / 選定を再開したテーマ
 */
export function resetNoSelectionEpisode(themeId: number): void {
  sinceMs.delete(themeId);
}

/** What the watch concluded for one theme. */
export type NoSelectionVerdict = 'armed' | 'progressing' | 'below-threshold' | 'reported';

/**
 * Decide whether a theme's "running with no current task" state is a stall.
 *
 * Progress evidence resets the episode: a live agent anywhere (the runner is
 * busy, so selection legitimately waits) or a dispatchable queued item (work is
 * about to start). Both are read through the same helpers the starvation pass
 * uses, so the two detectors cannot drift apart on what "dispatchable" means.
 *
 * @param themeId - Theme reporting running with no current task. / 対象テーマ
 * @param nowMs - Current time (ms), injected for testability. / 現在時刻
 * @returns What this observation concluded. / 判定結果
 */
export async function checkNoSelectionProgress(
  themeId: number,
  nowMs: number,
): Promise<NoSelectionVerdict> {
  // Every read is wrapped: this watch runs inside the reconciler's pass, and an
  // unreadable signal must never throw out of it. Failing toward 'progressing'
  // keeps a read error from manufacturing a stall report.
  let progressing = false;
  try {
    const queued = await prisma.workflowQueueItem.count({ where: { status: 'queued' } });
    const waiters = await resolveQueuedWaiters(queued);
    progressing = waiters.working || waiters.dispatchable > 0;
    if (!progressing) {
      // A live agent on a task that is not queued at all (e.g. a manual run) is
      // still the runner being busy — selection waiting behind it is normal.
      const current = await prisma.themeAutoRun.findUnique({
        where: { themeId },
        select: { currentTaskId: true },
      });
      progressing =
        current?.currentTaskId != null && (await hasLiveExecution(prisma, current.currentTaskId));
    }
  } catch (err) {
    log.warn(
      { err, themeId },
      '[no-selection-watch] progress signals unreadable — treating as progressing',
    );
    progressing = true;
  }
  if (progressing) {
    sinceMs.delete(themeId);
    return 'progressing';
  }

  const anchor = sinceMs.get(themeId);
  if (anchor === undefined) {
    sinceMs.set(themeId, nowMs);
    return 'armed';
  }
  if (nowMs - anchor < NO_SELECTION_THRESHOLD_MS) return 'below-threshold';

  const stalledMinutes = Math.round((nowMs - anchor) / 60000);
  log.warn(
    { themeId, stalledMinutes },
    '[no-selection-watch] theme reports running but has selected nothing — the advance is not completing',
  );
  logCycleEvent('theme.no_selection_progress', {
    theme: themeId,
    ok: false,
    cause: 'running_without_selection',
    waitedMinutes: stalledMinutes,
    msg: 'theme reports running with no current task and nothing dispatchable — advance not completing',
  });
  await notifyOncePerWindow(themeId, stalledMinutes, nowMs);
  return 'reported';
}

/**
 * Surface the stall to the operator, at most once per window per theme.
 * Uses a plain system notification (same mechanism as the reconciler's orphan
 * flag) so a brand-new signal needs no i18n catalogue entry to reach a human.
 *
 * @param themeId - Stalled theme. / 対象テーマ
 * @param stalledMinutes - How long the state has persisted. / 継続時間(分)
 * @param nowMs - Current time (ms). / 現在時刻
 */
async function notifyOncePerWindow(
  themeId: number,
  stalledMinutes: number,
  nowMs: number,
): Promise<void> {
  const link = `/themes/${themeId}`;
  const recent = await prisma.notification
    .findFirst({
      where: { link, title: NOTIFY_TITLE, createdAt: { gt: new Date(nowMs - RENOTIFY_WINDOW_MS) } },
      select: { id: true },
    })
    .catch(() => null);
  if (recent) return;
  await createNotification({
    type: 'system',
    title: NOTIFY_TITLE,
    message:
      `テーマ #${themeId} は「実行中」を報告していますが、${stalledMinutes} 分間タスクを 1 件も選定しておらず、` +
      `発行できるキュー項目も実行中のエージェントもありません。前進が止まっています。` +
      `未終了のキュー項目を確認してください（halt / blocked のタスクの残骸が同時実行枠を占有していることがあります）。`,
    link,
    metadata: { themeId, stalledMinutes, reason: 'running_without_selection' },
  }).catch(() => {});
}
