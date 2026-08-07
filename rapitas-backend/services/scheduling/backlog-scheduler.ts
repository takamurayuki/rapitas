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
import { createNotification } from '../communication/notification-service';

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
};

// NOTE: Must stay in sync with rapitas-frontend/messages/ja.json
// backlog.settings.jobs.<kind>.label — the backend has no access to the
// frontend i18n bundle, so the labels are duplicated here for notifications.
const JOB_LABELS: Record<BacklogJobKind, string> = {
  innovation: 'イノベーションセッション',
  vuln_scan: '脆弱性・バグ調査',
  health_check: 'ログヘルスチェック',
  loop_review: '品質ループレビュー',
  ci_watch: 'CI 監視（本線）',
};

// Caps notification body length — raw Error.message can carry stack-trace-like
// noise that would clutter the notification list.
const ERROR_SUMMARY_MAX_LEN = 300;

/** Outcome of a manual (run-now) job execution, used for the completion notification. */
type ManualRunOutcome =
  | { kind: 'success'; count: number }
  | { kind: 'failure'; error: unknown }
  | { kind: 'skipped' };

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
 * Summarizes an unknown thrown value into a bounded, single-string message.
 *
 * @param err - Thrown value / スローされた値
 * @returns Message truncated to 300 chars / 300字に切り詰めた要約
 */
function errorSummary(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.length > ERROR_SUMMARY_MAX_LEN
    ? `${message.slice(0, ERROR_SUMMARY_MAX_LEN)}…`
    : message;
}

/**
 * Records the outcome of a manual (run-now) execution: persists lastRunAt
 * (except when skipped — nothing actually ran) and creates a completion
 * notification. Best-effort — failures here are logged and never affect the
 * job's own result.
 *
 * @param kind - Job that ran / 実行したジョブ
 * @param outcome - Success/failure/skip result / 実行結果
 */
async function recordManualRunOutcome(
  kind: BacklogJobKind,
  outcome: ManualRunOutcome,
): Promise<void> {
  const label = JOB_LABELS[kind];
  if (outcome.kind !== 'skipped') {
    // Also guards against a same-day duplicate scheduled fire: isJobDue checks
    // lastRunAt against the current local day.
    await markScheduleRun(kind, new Date()).catch((err) =>
      log.warn({ err, kind }, 'Failed to record manual run in lastRunAt'),
    );
  }
  let title: string;
  let message: string;
  let metadata: Record<string, unknown>;
  if (outcome.kind === 'success') {
    title = `${label}が完了しました`;
    message = `生成件数: ${outcome.count} 件`;
    metadata = { kind, source: 'run_now', outcome: 'success', count: outcome.count };
  } else if (outcome.kind === 'failure') {
    title = `${label}に失敗しました`;
    message = errorSummary(outcome.error);
    metadata = { kind, source: 'run_now', outcome: 'failure', error: errorSummary(outcome.error) };
  } else {
    title = `${label}はスキップされました`;
    message = '既に実行中のため今回は開始されませんでした';
    metadata = { kind, source: 'run_now', outcome: 'skipped' };
  }
  await createNotification({
    type: 'system',
    title,
    message,
    link: '/backlog/settings',
    metadata,
  }).catch((err) => log.warn({ err, kind }, 'Failed to create run-now completion notification'));
}

/**
 * Runs a backlog job immediately, ignoring its schedule. Used by the "run now"
 * button. No-op (returns 0) if the job is already running.
 *
 * When called as a manual run (default), the completion (success / failure /
 * skip) is recorded as a Notification and lastRunAt is updated; the scheduled
 * path opts out via `opts.source` to avoid daily notification noise.
 *
 * @param kind - Job to run / 実行するジョブ
 * @param since - For health_check only: process entries on or after this time
 * @param opts - source: 'manual' (default, notifies) or 'scheduled' (silent)
 * @returns Number of items produced (ideas/concerns) / 生成件数
 */
export async function runBacklogJobNow(
  kind: BacklogJobKind,
  since?: Date,
  opts: { source?: 'manual' | 'scheduled' } = {},
): Promise<number> {
  const source = opts.source ?? 'manual';
  if (running.has(kind)) {
    log.info({ kind }, 'Job already running — skipping duplicate run');
    if (source === 'manual') {
      await recordManualRunOutcome(kind, { kind: 'skipped' });
    }
    return 0;
  }
  running.add(kind);
  try {
    const count = kind === 'health_check' ? await runLogHealthCheck(since) : await HANDLERS[kind]();
    if (source === 'manual') {
      await recordManualRunOutcome(kind, { kind: 'success', count });
    }
    return count;
  } catch (err) {
    if (source === 'manual') {
      await recordManualRunOutcome(kind, { kind: 'failure', error: err });
    }
    throw err;
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
    void runBacklogJobNow(s.kind, prevLastRunAt, { source: 'scheduled' }).catch((err) =>
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
