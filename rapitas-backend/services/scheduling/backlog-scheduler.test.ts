/**
 * backlog-scheduler.test
 *
 * Unit tests for the scheduler's pure due-check (isJobDue). DB/LLM/git paths are
 * covered elsewhere; this locks down the timing logic.
 */
import { describe, it, expect } from 'bun:test';
import { isJobDue, pickDueJob } from './backlog-scheduler';
import {
  BACKLOG_JOB_KINDS,
  DEFAULTS,
  normalizeJobKind,
  type BacklogScheduleConfig,
} from './backlog-schedule-service';
import { BACKLOG_JOB_LABELS } from './backlog-job-labels';

/** Builds a schedule config with sensible defaults, overridable per-test. */
function makeSchedule(over: Partial<BacklogScheduleConfig> = {}): BacklogScheduleConfig {
  return {
    kind: 'innovation',
    enabled: true,
    frequency: 'daily',
    hour: 3,
    weekday: 1,
    lastRunAt: null,
    ...over,
  };
}

// 2024-01-15 is a Monday (getDay() === 1).
const MONDAY_3AM = new Date(2024, 0, 15, 3, 30, 0);
const MONDAY_4AM = new Date(2024, 0, 15, 4, 30, 0);
const TUESDAY_3AM = new Date(2024, 0, 16, 3, 30, 0);

describe('isJobDue', () => {
  it('fires a daily job at the matching hour', () => {
    expect(isJobDue(makeSchedule({ frequency: 'daily', hour: 3 }), MONDAY_3AM)).toBe(true);
  });

  it('does not fire before the configured hour', () => {
    const MONDAY_2AM = new Date(2024, 0, 15, 2, 30, 0);
    expect(isJobDue(makeSchedule({ frequency: 'daily', hour: 3 }), MONDAY_2AM)).toBe(false);
  });

  it('回帰: 設定時刻を過ぎていれば当日中はまだ実行できる', () => {
    // 旧実装は時刻の完全一致を要求していたため、ポーラーがその1時間に生きて
    // いなければジョブは丸1日飛んでいた（実測 2026-08-24: 03:00〜07:00 の全
    // ジョブが4日間未実行）。時刻は「これ以降」を意味する。
    expect(isJobDue(makeSchedule({ frequency: 'daily', hour: 3 }), MONDAY_4AM)).toBe(true);
  });

  it('never fires when disabled', () => {
    expect(isJobDue(makeSchedule({ enabled: false, hour: 3 }), MONDAY_3AM)).toBe(false);
  });

  it('fires a weekly job only on the matching weekday', () => {
    const weeklyMonday = makeSchedule({ frequency: 'weekly', hour: 3, weekday: 1 });
    expect(isJobDue(weeklyMonday, MONDAY_3AM)).toBe(true);
    expect(isJobDue(weeklyMonday, TUESDAY_3AM)).toBe(false);
  });

  it('ignores weekday for daily jobs', () => {
    const daily = makeSchedule({ frequency: 'daily', hour: 3, weekday: 6 });
    expect(isJobDue(daily, MONDAY_3AM)).toBe(true);
  });

  it('does not fire twice on the same day', () => {
    const ranToday = makeSchedule({ hour: 3, lastRunAt: new Date(2024, 0, 15, 3, 1, 0) });
    expect(isJobDue(ranToday, MONDAY_3AM)).toBe(false);
  });

  it('fires again the next day after a prior run', () => {
    // Ran Monday; on Tuesday at the same hour a daily job is due again.
    const ranMonday = makeSchedule({
      frequency: 'daily',
      hour: 3,
      lastRunAt: new Date(2024, 0, 15, 3, 1, 0),
    });
    expect(isJobDue(ranMonday, TUESDAY_3AM)).toBe(true);
  });
});

describe('normalizeJobKind', () => {
  it('accepts known kinds', () => {
    expect(normalizeJobKind('innovation')).toBe('innovation');
    expect(normalizeJobKind('vuln_scan')).toBe('vuln_scan');
    expect(normalizeJobKind('daily_report')).toBe('daily_report');
    expect(normalizeJobKind('outage_simulation')).toBe('outage_simulation');
  });

  it('seeds outage_simulation weekly without colliding with the weekday 1-3 6am jobs', () => {
    expect(BACKLOG_JOB_KINDS).toContain('outage_simulation');
    expect(DEFAULTS.outage_simulation).toEqual({
      enabled: true,
      frequency: 'weekly',
      hour: 6,
      weekday: 4,
    });
    expect(BACKLOG_JOB_LABELS.outage_simulation).toBe('障害影響判定シミュレーション');
  });

  it('registers requirement_intake daily at 8:00 with a label', () => {
    expect(BACKLOG_JOB_KINDS).toContain('requirement_intake');
    expect(normalizeJobKind('requirement_intake')).toBe('requirement_intake');
    expect(DEFAULTS.requirement_intake).toEqual({
      enabled: true,
      frequency: 'daily',
      hour: 8,
      weekday: 1,
    });
    expect(BACKLOG_JOB_LABELS.requirement_intake).toBe('要件定義からのタスク起票');
  });

  it('rejects unknown values as null', () => {
    expect(normalizeJobKind('bogus')).toBeNull();
    expect(normalizeJobKind(undefined)).toBeNull();
    expect(normalizeJobKind(42)).toBeNull();
  });
});

describe('daily_report registration', () => {
  it('is a schedulable kind (seeded by ensureSchedulesSeeded)', () => {
    expect(BACKLOG_JOB_KINDS).toContain('daily_report');
  });

  it('defaults to enabled, daily at 07:00 (task #564: 毎朝7:00)', () => {
    expect(DEFAULTS.daily_report).toEqual({
      enabled: true,
      frequency: 'daily',
      hour: 7,
      weekday: 1,
    });
  });

  it('is due at its default hour and only once per day', () => {
    const schedule = makeSchedule({ kind: 'daily_report', ...DEFAULTS.daily_report });
    const monday7am = new Date(2024, 0, 15, 7, 10, 0);
    expect(isJobDue(schedule, monday7am)).toBe(true);
    // Already ran this morning — not due again the same local day.
    const ranToday = makeSchedule({
      kind: 'daily_report',
      ...DEFAULTS.daily_report,
      lastRunAt: new Date(2024, 0, 15, 7, 1, 0),
    });
    expect(isJobDue(ranToday, monday7am)).toBe(false);
    // Due again the next morning.
    expect(isJobDue(ranToday, new Date(2024, 0, 16, 7, 10, 0))).toBe(true);
  });

  it('取りこぼしたジョブは時刻に関わらず即座に追いつく', () => {
    // 4日前が最終実行 = 丸1周期以上の遅延。設定時刻(3時)より前の時間帯でも走る。
    const fourDaysAgo = new Date(2024, 0, 11, 3, 0, 0);
    const mondayMidnight = new Date(2024, 0, 15, 0, 30, 0);
    expect(
      isJobDue(
        makeSchedule({ frequency: 'daily', hour: 3, lastRunAt: fourDaysAgo }),
        mondayMidnight,
      ),
    ).toBe(true);
  });

  it('週次も1周期を超えて遅延したら曜日を待たずに追いつく', () => {
    const threeWeeksAgo = new Date(2023, 11, 25, 6, 0, 0);
    const thursday = new Date(2024, 0, 18, 1, 0, 0); // 木曜・設定時刻前
    expect(
      isJobDue(
        makeSchedule({ frequency: 'weekly', hour: 6, weekday: 1, lastRunAt: threeWeeksAgo }),
        thursday,
      ),
    ).toBe(true);
  });

  it('週次は1周期未満なら走らない', () => {
    const threeDaysAgo = new Date(2024, 0, 12, 6, 0, 0);
    const monday = new Date(2024, 0, 15, 7, 0, 0);
    expect(
      isJobDue(
        makeSchedule({ frequency: 'weekly', hour: 6, weekday: 1, lastRunAt: threeDaysAgo }),
        monday,
      ),
    ).toBe(false);
  });
});

describe('pickDueJob — 同時発火によるイベントループ停止の回避 (2026-10-11)', () => {
  // 実測: tick() は due なジョブ全部を同一 tick 内で `void runBacklogJobNow` し、
  // ずらしも同時実行数制限も無かった。hour=5 は vuln_scan + knowledge_reuse の
  // 2本、hour=6 は loop_review + 曜日次第で pr_risk_review/outage_simulation。
  // バックエンドログに `backlog-job:knowledge_reuse + backlog-job:vuln_scan` が
  // 同時実行中の停止として残っており、3日で70回・計335秒の停止、15秒閾値を
  // 越えた4回が自己修復再起動になっていた。
  const at = (h: number) => new Date(2024, 0, 15, h, 0, 0);

  it('同じ時刻に複数 due でも 1 件しか開始しない', () => {
    const schedules = [
      makeSchedule({ kind: 'vuln_scan', hour: 5 }),
      makeSchedule({ kind: 'knowledge_reuse', hour: 5 }),
      makeSchedule({ kind: 'loop_review', hour: 6 }),
    ];
    const picked = pickDueJob(schedules, at(6), () => false);
    expect(picked.start?.kind).toBe('vuln_scan');
    // 残りは失われず、次の tick(60秒後) に回る
    expect(picked.deferred).toEqual(['knowledge_reuse', 'loop_review']);
  });

  it('延期されたジョブは次の tick でまだ due のまま', () => {
    const deferredJob = makeSchedule({ kind: 'knowledge_reuse', hour: 5 });
    // hour は NOT-BEFORE なので 60 秒後も due（lastRunAt は未設定のまま）
    expect(isJobDue(deferredJob, new Date(2024, 0, 15, 6, 1, 0))).toBe(true);
  });

  it('すでに走っている種別は選ばない', () => {
    const schedules = [
      makeSchedule({ kind: 'vuln_scan', hour: 5 }),
      makeSchedule({ kind: 'knowledge_reuse', hour: 5 }),
    ];
    const picked = pickDueJob(schedules, at(6), (kind) => kind === 'vuln_scan');
    expect(picked.start?.kind).toBe('knowledge_reuse');
    expect(picked.deferred).toEqual([]);
  });

  it('due が無ければ何も開始しない', () => {
    const schedules = [makeSchedule({ kind: 'vuln_scan', hour: 5 })];
    const picked = pickDueJob(schedules, at(4), () => false);
    expect(picked.start).toBeNull();
    expect(picked.deferred).toEqual([]);
  });

  it('無効なジョブは due にならない', () => {
    const schedules = [makeSchedule({ kind: 'vuln_scan', hour: 5, enabled: false })];
    expect(pickDueJob(schedules, at(6), () => false).start).toBeNull();
  });
});
