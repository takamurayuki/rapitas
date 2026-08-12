/**
 * backlog-schedule-service
 *
 * CRUD + seeding for the backlog's periodic-job timing config (BacklogSchedule).
 * Owns the list of job kinds and their defaults; the scheduler and routes read
 * and write schedules through here. Does NOT run the jobs (see
 * backlog-scheduler.ts) — only stores when they should run.
 */
import { prisma } from '../../config/database';
import { narrowEnumOrNull } from '../../utils/common/type-guards';

/** Periodic backlog jobs that can be scheduled. */
export type BacklogJobKind =
  | 'innovation'
  | 'vuln_scan'
  | 'health_check'
  | 'loop_review'
  | 'ci_watch'
  | 'daily_report';
/** How often a job runs. */
export type BacklogFrequency = 'daily' | 'weekly';

export interface BacklogScheduleConfig {
  kind: BacklogJobKind;
  enabled: boolean;
  frequency: BacklogFrequency;
  /** Local hour the job fires (0-23). */
  hour: number;
  /** Day of week (0=Sun..6=Sat); only meaningful when frequency='weekly'. */
  weekday: number;
  lastRunAt: Date | null;
}

/** All schedulable job kinds, in display order. */
export const BACKLOG_JOB_KINDS: readonly BacklogJobKind[] = [
  'innovation',
  'vuln_scan',
  'health_check',
  'loop_review',
  'ci_watch',
  'daily_report',
];

/**
 * Per-kind defaults used to seed missing rows. Innovation defaults ON to
 * preserve the behaviour the app had before scheduling was configurable; the
 * vulnerability scan is opt-in (filing concerns is more intrusive).
 */
export const DEFAULTS: Record<
  BacklogJobKind,
  { enabled: boolean; frequency: BacklogFrequency; hour: number; weekday: number }
> = {
  innovation: { enabled: true, frequency: 'daily', hour: 3, weekday: 1 },
  vuln_scan: { enabled: false, frequency: 'weekly', hour: 4, weekday: 1 },
  health_check: { enabled: true, frequency: 'daily', hour: 5, weekday: 1 },
  // Weekly Monday morning: compares the two most recent 7-day windows, so a
  // weekly cadence matches the metric granularity exactly.
  loop_review: { enabled: true, frequency: 'weekly', hour: 6, weekday: 1 },
  // Daily: red mainline CI must be noticed within a day, not a week. The
  // scheduler fires at most once per local day — "run now" covers ad hoc.
  ci_watch: { enabled: true, frequency: 'daily', hour: 7, weekday: 1 },
  // Every morning at 7:00 (task #564 requirement): summarize the previous 24h
  // of autonomous activity into one notification + /agents/growth archive.
  daily_report: { enabled: true, frequency: 'daily', hour: 7, weekday: 1 },
};

/** Coerces an arbitrary value to a valid job kind, or null if unknown. */
export function normalizeJobKind(value: unknown): BacklogJobKind | null {
  return narrowEnumOrNull(value, BACKLOG_JOB_KINDS);
}

function normalizeFrequency(value: unknown): BacklogFrequency {
  return value === 'daily' ? 'daily' : 'weekly';
}

function clampHour(value: unknown): number {
  const n = typeof value === 'number' ? Math.floor(value) : NaN;
  return Number.isFinite(n) ? Math.min(23, Math.max(0, n)) : 3;
}

function clampWeekday(value: unknown): number {
  const n = typeof value === 'number' ? Math.floor(value) : NaN;
  return Number.isFinite(n) ? Math.min(6, Math.max(0, n)) : 1;
}

interface ScheduleRow {
  kind: string;
  enabled: boolean;
  frequency: string;
  hour: number;
  weekday: number;
  lastRunAt: Date | null;
}

function toConfig(row: ScheduleRow): BacklogScheduleConfig {
  return {
    kind: (normalizeJobKind(row.kind) ?? 'innovation') as BacklogJobKind,
    enabled: row.enabled,
    frequency: normalizeFrequency(row.frequency),
    hour: clampHour(row.hour),
    weekday: clampWeekday(row.weekday),
    lastRunAt: row.lastRunAt,
  };
}

/**
 * Creates any missing schedule rows with their defaults. Idempotent.
 *
 * @returns Nothing / なし
 */
export async function ensureSchedulesSeeded(): Promise<void> {
  const existing = await prisma.backlogSchedule.findMany({ select: { kind: true } });
  const have = new Set(existing.map((r) => r.kind));
  const missing = BACKLOG_JOB_KINDS.filter((k) => !have.has(k));
  if (missing.length === 0) return;
  await prisma.backlogSchedule.createMany({
    data: missing.map((kind) => ({ kind, ...DEFAULTS[kind] })),
  });
}

/**
 * Lists all backlog schedules (seeding defaults first).
 *
 * @returns Schedule config for every job kind / 全ジョブ種別の設定
 */
export async function listSchedules(): Promise<BacklogScheduleConfig[]> {
  await ensureSchedulesSeeded();
  const rows = await prisma.backlogSchedule.findMany();
  const byKind = new Map(rows.map((r) => [r.kind, r]));
  // Return in canonical order regardless of insertion order.
  return BACKLOG_JOB_KINDS.map((kind) => toConfig(byKind.get(kind) as ScheduleRow));
}

/**
 * Updates one schedule's fields (only provided fields change).
 *
 * @param kind - Job kind to update / 更新するジョブ種別
 * @param patch - Fields to change / 変更するフィールド
 * @returns Updated config / 更新後の設定
 */
export async function updateSchedule(
  kind: BacklogJobKind,
  patch: { enabled?: boolean; frequency?: unknown; hour?: unknown; weekday?: unknown },
): Promise<BacklogScheduleConfig> {
  await ensureSchedulesSeeded();
  const data: Record<string, unknown> = {};
  if (patch.enabled !== undefined) data.enabled = patch.enabled;
  if (patch.frequency !== undefined) data.frequency = normalizeFrequency(patch.frequency);
  if (patch.hour !== undefined) data.hour = clampHour(patch.hour);
  if (patch.weekday !== undefined) data.weekday = clampWeekday(patch.weekday);
  const row = await prisma.backlogSchedule.update({ where: { kind }, data });
  return toConfig(row as ScheduleRow);
}

/**
 * Records that a job ran (persists the once-per-day guard across restarts).
 *
 * @param kind - Job kind that ran / 実行したジョブ種別
 * @param at - Run timestamp / 実行時刻
 */
export async function markScheduleRun(kind: BacklogJobKind, at: Date): Promise<void> {
  await prisma.backlogSchedule.update({ where: { kind }, data: { lastRunAt: at } });
}
