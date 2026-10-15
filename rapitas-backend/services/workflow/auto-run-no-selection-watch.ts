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
import { isCalendarHoldActive } from '../scheduling/calendar-slot/calendar-hold-state';
import { classifyThemeWork } from './auto-run/auto-run-theme-parked';

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

/** Separate title: a parked theme is waiting for a person, not malfunctioning. */
const PARKED_TITLE = '自動実行が人の対応を待っています';

/** Episode anchors per theme; null entry = not currently in the state. */
const sinceMs = new Map<number, number>();

/** Themes already reported as parked in the CURRENT episode. */
const parkedReported = new Set<number>();

/** Reset the tracker. Test-only — never call from production code. */
export function resetNoSelectionTracker(): void {
  sinceMs.clear();
  parkedReported.clear();
}

/**
 * Drop one theme's episode because it has a current task again.
 *
 * @param themeId - Theme that resumed selecting. / 選定を再開したテーマ
 */
export function resetNoSelectionEpisode(themeId: number): void {
  sinceMs.delete(themeId);
  parkedReported.delete(themeId);
}

/** What the watch concluded for one theme. */
export type NoSelectionVerdict =
  | 'armed'
  | 'progressing'
  | 'below-threshold'
  | 'reported'
  | 'parked';

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
  // A theme held by the calendar-slot gate (task 1174) has no current task on
  // purpose: it is waiting for a free slot, not wedged.
  if (isCalendarHoldActive(themeId, new Date(nowMs))) {
    sinceMs.delete(themeId);
    return 'progressing';
  }
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
    parkedReported.delete(themeId);
    return 'progressing';
  }

  const anchor = sinceMs.get(themeId);
  if (anchor === undefined) {
    sinceMs.set(themeId, nowMs);
    return 'armed';
  }
  if (nowMs - anchor < NO_SELECTION_THRESHOLD_MS) return 'below-threshold';

  const stalledMinutes = Math.round((nowMs - anchor) / 60000);

  // A theme whose whole remaining backlog is held or waiting on a human has
  // nothing dispatchable BY DESIGN. Blaming the advance for it is wrong, and
  // measured 2026-10-13 it was also the loudest thing in the log: 40 of these
  // events in one day, every one for theme 34, whose six remaining tasks were
  // five `autoRunExcluded` and one `awaiting_question`. A real stall hides
  // behind a false alarm that frequent.
  const parked = await readThemeWork(themeId);
  if (parked?.parked) {
    if (!parkedReported.has(themeId)) {
      parkedReported.add(themeId);
      log.warn(
        { themeId, waitedMinutes: stalledMinutes, pending: parked.pending },
        '[no-selection-watch] theme has selected nothing because all of its remaining work is held or awaiting an answer',
      );
      logCycleEvent('theme.parked_awaiting_human', {
        theme: themeId,
        ok: true,
        cause: 'all_work_held_or_awaiting_answer',
        waitedMinutes: stalledMinutes,
        held: parked.pending,
        msg: 'theme has nothing dispatchable because every remaining task is held or awaiting an answer — a person has to clear it',
      });
      await notifyParkedOncePerWindow(themeId, parked.pending, nowMs);
    }
    return 'parked';
  }

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
 * Classify the theme's own remaining backlog.
 *
 * Returns null on a read error so the caller falls through to the stall report
 * it would have made anyway: an unreadable task list must neither manufacture a
 * "parked" verdict nor silence a real stall.
 *
 * @param themeId - Theme whose backlog to weigh. / 対象テーマ
 * @returns The verdict, or null when the tasks could not be read. / 判定、読めなければ null
 */
async function readThemeWork(
  themeId: number,
): Promise<{ parked: boolean; pending: number } | null> {
  const tasks = await prisma.task
    .findMany({
      where: { themeId, status: { notIn: ['done', 'completed', 'cancelled'] } },
      select: {
        status: true,
        workflowStatus: true,
        haltReason: true,
        autoRunExcluded: true,
        workflowDisabled: true,
      },
    })
    .catch(() => null);
  if (!tasks) return null;
  const verdict = classifyThemeWork(tasks);
  return { parked: verdict.parked, pending: verdict.pending };
}

/**
 * Tell the operator the theme is waiting on them, at most once per window.
 *
 * A separate title and link from the stall notification on purpose: "auto-run
 * is not progressing" sends someone to debug the scheduler, and here the
 * scheduler is doing exactly the right thing.
 *
 * @param themeId - Parked theme. / 対象テーマ
 * @param pending - Non-terminal tasks, all of them held. / 保留中の件数
 * @param nowMs - Current time (ms). / 現在時刻
 */
async function notifyParkedOncePerWindow(
  themeId: number,
  pending: number,
  nowMs: number,
): Promise<void> {
  const link = `/themes/${themeId}`;
  const recent = await prisma.notification
    .findFirst({
      where: { link, title: PARKED_TITLE, createdAt: { gt: new Date(nowMs - RENOTIFY_WINDOW_MS) } },
      select: { id: true },
    })
    .catch(() => null);
  if (recent) return;
  await createNotification({
    type: 'system',
    title: PARKED_TITLE,
    message:
      `テーマ #${themeId} は残り ${pending} 件のタスクすべてが保留（自動実行の対象外・無効化・halt）` +
      `または回答待ちのため、選定できるタスクがありません。系の不具合ではなく、人の判断を待っている状態です。` +
      `保留の解除、または質問への回答をしてください。`,
    link,
    metadata: { themeId, pending, reason: 'all_work_held_or_awaiting_answer' },
  }).catch(() => {});
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
