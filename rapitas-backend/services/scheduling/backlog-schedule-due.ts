/**
 * backlog-schedule-due
 *
 * The scheduler's pure timing core: whether a configured job is due at a given
 * moment, and which single due job a tick should start.
 *
 * Not responsible for running jobs, reading schedules, or persisting a run —
 * backlog-scheduler.ts owns all of that. Split out so the decisions stay
 * DB-free and unit-testable, and to keep backlog-scheduler.ts under the
 * 300-line limit.
 */

import type { BacklogJobKind, BacklogScheduleConfig } from './backlog-schedule-service';

/** True when both dates fall on the same local calendar day. */
function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

/**
 * Whether a job should fire at `now`. Pure — the scheduler's testable core.
 *
 * The configured hour is a NOT-BEFORE, not an exact match, and a job that is
 * overdue by more than a full extra period fires immediately regardless of the
 * hour.
 *
 * NOTE: this used to require `now.getHours() === s.hour`, so the job only ran
 * if the 60-second poller happened to be alive during that one hour. Anything
 * that took the backend out of that window — a sleeping desktop, a restart, a
 * provider outage — silently skipped the job for a whole day (a whole week for
 * weekly), with no path to catch up. Measured 2026-08-24: every job scheduled
 * between 03:00 and 07:00 had not run for four days while the 22:00 job was
 * current, and because the innovation session (03:00) is the only thing that
 * files new tasks, the backlog had produced nothing in five days. For an app
 * meant to run unattended, missing the window must delay the job, not cancel it.
 *
 * @param s - Schedule config / スケジュール設定
 * @param now - Current time / 現在時刻
 * @returns True if due / 実行すべきなら true
 */
export function isJobDue(s: BacklogScheduleConfig, now: Date): boolean {
  if (!s.enabled) return false;

  if (s.frequency === 'weekly') {
    // First ever run still waits for the configured weekday — without a prior
    // run there is no cadence to catch up to.
    if (!s.lastRunAt) return now.getDay() === s.weekday && now.getHours() >= s.hour;
    const elapsed = now.getTime() - s.lastRunAt.getTime();
    if (elapsed >= WEEK_MS * 2) return true; // overdue — catch up now
    if (elapsed < WEEK_MS) return false;
    return now.getHours() >= s.hour;
  }

  // Daily: the same-day guard keeps the cadence drift-free, and the overdue
  // check is what recovers a missed window.
  if (s.lastRunAt && isSameLocalDay(s.lastRunAt, now)) return false;
  if (s.lastRunAt && now.getTime() - s.lastRunAt.getTime() >= DAY_MS * 2) return true;
  return now.getHours() >= s.hour;
}

/** What a single tick decided to do. */
export interface DueJobSelection {
  /** The one job to start now, or null when nothing is due. / 今回開始する1件 */
  start: BacklogScheduleConfig | null;
  /** Kinds left for a later tick, in order. / 次回以降に回す種別 */
  deferred: BacklogJobKind[];
}

/**
 * Pick at most ONE due job to start, deferring the rest to later ticks.
 *
 * NOTE: the scheduler used to start EVERY due job in the same tick (`void
 * runBacklogJobNow` per schedule, no stagger and no concurrency limit). Several
 * jobs share an hour — `vuln_scan` + `knowledge_reuse` at 5, `loop_review` plus
 * the weekday-gated `pr_risk_review` / `outage_simulation` at 6 — so they all
 * began within the same 60-second tick and competed for the single JS thread.
 * Measured over 2026-10-09..11: 70 event-loop stalls totalling 335s, with one
 * stall naming `backlog-job:knowledge_reuse + backlog-job:vuln_scan` as the
 * concurrently-running culprits, and each of the four stalls past the
 * watchdog's 15s catastrophic threshold forced a self-healing restart.
 *
 * Deferring is safe because `hour` is a NOT-BEFORE and a missed window delays a
 * job rather than cancelling it (see {@link isJobDue}'s note): a job passed over
 * here is still due on the next tick, so the effect is a 60-second stagger
 * rather than a skip. Jobs can still overlap if one outlives the gap — this
 * removes the simultaneous START, which is what the measurements implicate.
 *
 * @param schedules - All configured schedules / 全スケジュール
 * @param now - Current time / 現在時刻
 * @param isRunning - Whether that kind is already in flight / 実行中判定
 * @returns The job to start and the kinds deferred / 開始する1件と延期分
 */
export function pickDueJob(
  schedules: readonly BacklogScheduleConfig[],
  now: Date,
  isRunning: (kind: BacklogJobKind) => boolean,
): DueJobSelection {
  let start: BacklogScheduleConfig | null = null;
  const deferred: BacklogJobKind[] = [];
  for (const s of schedules) {
    if (!isJobDue(s, now)) continue;
    if (isRunning(s.kind)) continue;
    if (start === null) start = s;
    else deferred.push(s.kind);
  }
  return { start, deferred };
}
