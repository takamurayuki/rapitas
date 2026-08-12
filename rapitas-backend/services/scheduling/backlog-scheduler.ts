/**
 * backlog-scheduler
 *
 * Single 60-second poller that fires the backlog's periodic AI jobs (innovation
 * session, vulnerability/bug scan) at their configured local hour/weekday. Reads
 * timing from BacklogSchedule (via backlog-schedule-service) so the user can
 * change it at runtime without a restart. Replaces the old hardcoded 12-hour
 * innovation interval.
 *
 * Not responsible for what the jobs do — only for WHEN they run.
 */
import { createLogger } from '../../config/logger';
import {
  listSchedules,
  markScheduleRun,
  ensureSchedulesSeeded,
  type BacklogJobKind,
  type BacklogScheduleConfig,
} from './backlog-schedule-service';
import { runInnovationSession } from '../memory/innovation-session';
import { runVulnerabilityScan } from '../memory/vulnerability-scan';
import { runLogHealthCheck } from '../system/log-health-check';
import { runLoopReview } from '../self-improvement/loop-watcher';
import { runCiWatch } from '../self-improvement/ci-green-keeper';
import { runDailyReport } from '../reporting/daily-report-service';

const log = createLogger('scheduling:backlog');

/** How often the poller checks whether a job is due. */
const POLL_INTERVAL_MS = 60_000;

/** Maps each job kind to the function that runs it. */
const HANDLERS: Record<BacklogJobKind, () => Promise<number>> = {
  innovation: runInnovationSession,
  vuln_scan: runVulnerabilityScan,
  health_check: runLogHealthCheck,
  loop_review: runLoopReview,
  ci_watch: runCiWatch,
  daily_report: runDailyReport,
};

// In-memory guard so a slow job (LLM calls take tens of seconds) is never
// started twice — neither by overlapping ticks nor by a manual "run now".
const running = new Set<BacklogJobKind>();

let pollHandle: ReturnType<typeof setInterval> | null = null;

/** True when two dates fall on the same local calendar day. */
function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Whether a job should fire at `now`: enabled, the local hour matches, the
 * weekday matches (weekly only), and it hasn't already run today. Pure — the
 * scheduler's testable core.
 *
 * @param s - Schedule config / スケジュール設定
 * @param now - Current time / 現在時刻
 * @returns True if due / 実行すべきなら true
 */
export function isJobDue(s: BacklogScheduleConfig, now: Date): boolean {
  if (!s.enabled) return false;
  if (now.getHours() !== s.hour) return false;
  if (s.frequency === 'weekly' && now.getDay() !== s.weekday) return false;
  if (s.lastRunAt && isSameLocalDay(s.lastRunAt, now)) return false;
  return true;
}

/**
 * Runs a backlog job immediately, ignoring its schedule. Used by the "run now"
 * button. No-op (returns 0) if the job is already running.
 *
 * @param kind - Job to run / 実行するジョブ
 * @param since - For health_check only: process entries on or after this time
 * @returns Number of items produced (ideas/concerns) / 生成件数
 */
export async function runBacklogJobNow(kind: BacklogJobKind, since?: Date): Promise<number> {
  if (running.has(kind)) {
    log.info({ kind }, 'Job already running — skipping duplicate run');
    return 0;
  }
  running.add(kind);
  try {
    if (kind === 'health_check') {
      return await runLogHealthCheck(since);
    }
    return await HANDLERS[kind]();
  } finally {
    running.delete(kind);
  }
}

/** One poll: fire any job whose configured time has arrived and hasn't run today. */
async function tick(): Promise<void> {
  const now = new Date();
  let schedules;
  try {
    schedules = await listSchedules();
  } catch (err) {
    log.warn({ err }, 'Failed to read backlog schedules');
    return;
  }

  for (const s of schedules) {
    if (!isJobDue(s, now)) continue;
    if (running.has(s.kind)) continue;

    // Capture lastRunAt before markScheduleRun overwrites it — used as the
    // `since` cursor for health_check so only new log entries are processed.
    const prevLastRunAt = s.lastRunAt ?? undefined;

    // Claim the daily slot up front (persisted) so the next tick won't re-fire
    // even if the job runs longer than the poll interval or the server restarts.
    await markScheduleRun(s.kind, now).catch((err) =>
      log.warn({ err, kind: s.kind }, 'Failed to record run start'),
    );
    log.info({ kind: s.kind, hour: s.hour }, 'Backlog job due — starting');
    void runBacklogJobNow(s.kind, prevLastRunAt).catch((err) =>
      log.warn({ err, kind: s.kind }, 'Scheduled backlog job failed'),
    );
  }
}

/**
 * Start the backlog scheduler. Safe to call multiple times.
 */
export function startBacklogScheduler(): void {
  if (pollHandle) return;
  ensureSchedulesSeeded().catch((err) => log.warn({ err }, 'Failed to seed schedules'));
  pollHandle = setInterval(() => {
    tick().catch((err) => log.warn({ err }, 'Backlog scheduler tick failed'));
  }, POLL_INTERVAL_MS);
  log.info('Backlog scheduler started');
}

/**
 * Stop the backlog scheduler.
 */
export function stopBacklogScheduler(): void {
  if (pollHandle) {
    clearInterval(pollHandle);
    pollHandle = null;
    log.info('Backlog scheduler stopped');
  }
}
