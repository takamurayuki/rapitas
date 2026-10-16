/**
 * Retro KPI Metrics
 *
 * Weekly self-improvement KPI ledger for the /agents/growth dashboard: the six
 * supervisor-baselined series (repair rate, auto_merged / auto_merge_exhausted
 * counts, auto_merge_conflict_filed count, verify_no_change_confirmed count,
 * verify_repair_non_convergence count, lead-time median) computed from the
 * append-only WorkflowTransition log. Read-only aggregation — the values are
 * raw counts/ratios of existing rows, never re-interpreted or estimated.
 * Not responsible for the five growth-ledger ratios (growth-ledger-metrics.ts)
 * or the bounce signals consumed by loop_review (loop-metrics.ts).
 */
import { prisma } from '../../config/database';
import { EXHAUSTED_CAUSE } from '../workflow/auto-merge-exhaustion';
import { VERIFY_NON_CONVERGENCE_CAUSE } from '../workflow/blocked-task-policy';

/** A WorkflowTransition row as the per-task grouping core consumes it. */
export interface RetroKpiTransitionRow {
  taskId: number;
  toStatus: string | null;
  cause: string | null;
  createdAt: Date;
}

/** A WorkflowTransition row as the simple-count series consume it. */
export interface RetroKpiCountRow {
  cause: string | null;
  createdAt: Date;
}

/** Per-task lifecycle summary distilled from its full transition history. */
export interface RetroKpiTaskEventLite {
  taskId: number;
  /** Oldest transition of the task (any status, `draft` included). */
  firstTransitionAt: Date;
  /** First `toStatus='completed'` transition time; null when never completed. */
  completedAt: Date | null;
  /** True when at least one `cause='verify_repair'` transition exists. */
  hadVerifyRepair: boolean;
}

/** One window of the retro KPI ledger (shape of the /agent-metrics/retro-kpi contract). */
export interface RetroKpiWindow {
  /** Inclusive window start (ISO). */
  from: string;
  /** Exclusive window end (ISO). */
  to: string;
  /** distinct tasks that saw verify_repair ÷ distinct tasks completed (both keyed on completedAt week). */
  repairRate: { completedTasks: number; repairedTasks: number; rate: number | null };
  autoMerged: number;
  autoMergeExhausted: number;
  autoMergeConflictFiled: number;
  verifyNoChangeConfirmed: number;
  verifyRepairNonConvergence: number;
  /** Median of (completedAt − firstTransitionAt) in minutes over tasks completed in the window. */
  leadTimeMinutes: { sampleSize: number; medianMinutes: number | null };
}

export interface RetroKpiLedger {
  windowDays: number;
  /** Newest window FIRST. */
  windows: RetroKpiWindow[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

// NOTE: No exported constant exists for these three causes; the literals are
// pinned here so a typo cannot silently zero a series. Definition sites:
//   auto_merged                → services/workflow/auto-merge-watcher.ts:338
//   auto_merge_conflict_filed  → services/workflow/auto-merge-watcher.ts:226,229
//   verify_no_change_confirmed → routes/workflow/handlers/file-save/verify-completion-gate.ts:118
export const AUTO_MERGED_CAUSE = 'auto_merged';
export const CONFLICT_FILED_CAUSE = 'auto_merge_conflict_filed';
export const NO_CHANGE_CONFIRMED_CAUSE = 'verify_no_change_confirmed';
/** Numerator cause of the repair-rate KPI (loop-metrics.ts:56 and many writers). */
export const VERIFY_REPAIR_CAUSE = 'verify_repair';

/** Causes counted by transition `createdAt` (no distinct-task collapsing). */
export const RETRO_KPI_COUNT_CAUSES = [
  AUTO_MERGED_CAUSE,
  EXHAUSTED_CAUSE,
  CONFLICT_FILED_CAUSE,
  NO_CHANGE_CONFIRMED_CAUSE,
  VERIFY_NON_CONVERGENCE_CAUSE,
] as const;

/**
 * Collapses raw transition rows into one lifecycle summary per task. Pure —
 * the first half of the testable core.
 *
 * @param rows - Transition rows (any order, full history per task). / 対象遷移行
 * @returns One RetroKpiTaskEventLite per distinct taskId. / タスク毎の集約
 */
export function groupRetroKpiTaskEvents(rows: RetroKpiTransitionRow[]): RetroKpiTaskEventLite[] {
  const byTask = new Map<number, RetroKpiTaskEventLite>();
  for (const row of rows) {
    let ev = byTask.get(row.taskId);
    if (!ev) {
      ev = {
        taskId: row.taskId,
        firstTransitionAt: row.createdAt,
        completedAt: null,
        hadVerifyRepair: false,
      };
      byTask.set(row.taskId, ev);
    }
    if (row.createdAt < ev.firstTransitionAt) ev.firstTransitionAt = row.createdAt;
    // First completion wins: a re-opened & re-completed task stays attributed
    // to the week it first completed so it never lands in two windows
    // (same convention as growth-ledger-metrics.ts groupTaskEvents).
    if (row.toStatus === 'completed' && (!ev.completedAt || row.createdAt < ev.completedAt)) {
      ev.completedAt = row.createdAt;
    }
    if (row.cause === VERIFY_REPAIR_CAUSE) ev.hadVerifyRepair = true;
  }
  return Array.from(byTask.values());
}

/**
 * Median of an ascending-sorted numeric array; even counts average the two
 * middle values and round to the nearest integer minute.
 *
 * @param sorted - Ascending-sorted values. / 昇順ソート済みの値
 * @returns Median, or null for an empty input. / 中央値（空ならnull）
 */
export function computeMedian(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const n = sorted.length;
  return n % 2 === 1 ? sorted[(n - 1) / 2]! : Math.round((sorted[n / 2 - 1]! + sorted[n / 2]!) / 2);
}

/**
 * Computes the six KPI series over rolling windows counting back from `now`.
 * Pure — the second half of the testable core. Window boundary math mirrors
 * growth-ledger-metrics.ts: future rows (`age<0`) are excluded, `from`
 * inclusive / `to` exclusive, `floor(age/windowMs)` indexing.
 *
 * `repairRate` and `leadTimeMinutes` are keyed on each task's `completedAt`
 * (so a verify_repair that happened in an earlier week still counts toward
 * the completion week); the five count series are keyed on each transition's
 * own `createdAt`.
 *
 * @param taskEvents - Per-task summaries (from groupRetroKpiTaskEvents). / タスク集約
 * @param countRows - Transitions whose cause is one of RETRO_KPI_COUNT_CAUSES. / 件数系の遷移行
 * @param now - Window anchor (newest window ends here). / 窓の基準時刻
 * @param windowDays - Days per window. / 窓の日数
 * @param windowCount - Number of windows. / 窓の数
 * @returns Windows, newest first; empty denominators yield null. / 新しい順の窓
 */
export function computeRetroKpiLedger(
  taskEvents: RetroKpiTaskEventLite[],
  countRows: RetroKpiCountRow[],
  now: Date,
  windowDays: number,
  windowCount: number,
): RetroKpiWindow[] {
  const windowMs = windowDays * DAY_MS;
  const nowMs = now.getTime();

  const indexOf = (at: Date): number => {
    const age = nowMs - at.getTime();
    if (age < 0 || age >= windowMs * windowCount) return -1;
    return Math.floor(age / windowMs);
  };

  const windows: RetroKpiWindow[] = [];
  const leadTimes: number[][] = [];
  for (let i = 0; i < windowCount; i++) {
    const to = new Date(nowMs - i * windowMs);
    const from = new Date(to.getTime() - windowMs);
    windows.push({
      from: from.toISOString(),
      to: to.toISOString(),
      repairRate: { completedTasks: 0, repairedTasks: 0, rate: null },
      autoMerged: 0,
      autoMergeExhausted: 0,
      autoMergeConflictFiled: 0,
      verifyNoChangeConfirmed: 0,
      verifyRepairNonConvergence: 0,
      leadTimeMinutes: { sampleSize: 0, medianMinutes: null },
    });
    leadTimes.push([]);
  }

  for (const ev of taskEvents) {
    if (!ev.completedAt) continue; // Never-completed tasks are in no denominator.
    const idx = indexOf(ev.completedAt);
    if (idx < 0) continue;
    const w = windows[idx]!;
    w.repairRate.completedTasks++;
    if (ev.hadVerifyRepair) w.repairRate.repairedTasks++;
    leadTimes[idx]!.push(
      Math.round((ev.completedAt.getTime() - ev.firstTransitionAt.getTime()) / MINUTE_MS),
    );
  }

  for (const row of countRows) {
    const idx = indexOf(row.createdAt);
    if (idx < 0) continue;
    const w = windows[idx]!;
    switch (row.cause) {
      case AUTO_MERGED_CAUSE:
        w.autoMerged++;
        break;
      case EXHAUSTED_CAUSE:
        w.autoMergeExhausted++;
        break;
      case CONFLICT_FILED_CAUSE:
        w.autoMergeConflictFiled++;
        break;
      case NO_CHANGE_CONFIRMED_CAUSE:
        w.verifyNoChangeConfirmed++;
        break;
      case VERIFY_NON_CONVERGENCE_CAUSE:
        w.verifyRepairNonConvergence++;
        break;
      default:
        break; // Unknown causes are ignored, never mis-binned.
    }
  }

  for (let i = 0; i < windowCount; i++) {
    const w = windows[i]!;
    w.repairRate.rate =
      w.repairRate.completedTasks > 0
        ? w.repairRate.repairedTasks / w.repairRate.completedTasks
        : null;
    const sorted = leadTimes[i]!.sort((a, b) => a - b);
    w.leadTimeMinutes = { sampleSize: sorted.length, medianMinutes: computeMedian(sorted) };
  }
  return windows;
}

/**
 * Loads the raw rows and delegates to the pure core. Read-only — three Prisma
 * queries, no writes.
 *
 * @param opts.windowDays - Days per window (default 7). / 窓の日数
 * @param opts.windowCount - Number of windows (default 8). / 窓の数
 * @param opts.now - Anchor time, injectable for tests. / 基準時刻
 * @returns Weekly retro KPI ledger, newest window first. / 新しい順のKPI台帳
 */
export async function computeRetroKpiMetrics(
  opts: { windowDays?: number; windowCount?: number; now?: Date } = {},
): Promise<RetroKpiLedger> {
  const windowDays = opts.windowDays ?? 7;
  const windowCount = opts.windowCount ?? 8;
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - windowDays * windowCount * DAY_MS);

  // Two-stage fetch: (1) which tasks completed in range, then (2) those
  // tasks' FULL history — the first transition (lead-time origin) and any
  // verify_repair may predate the range and must still be seen.
  const anchors = await prisma.workflowTransition.findMany({
    where: { createdAt: { gte: since }, toStatus: 'completed' },
    select: { taskId: true },
    distinct: ['taskId'],
  });
  const taskIds = anchors.map((a) => a.taskId);

  const transitions: RetroKpiTransitionRow[] = taskIds.length
    ? await prisma.workflowTransition.findMany({
        where: { taskId: { in: taskIds } },
        select: { taskId: true, toStatus: true, cause: true, createdAt: true },
      })
    : [];

  const countRows: RetroKpiCountRow[] = await prisma.workflowTransition.findMany({
    where: { cause: { in: [...RETRO_KPI_COUNT_CAUSES] }, createdAt: { gte: since } },
    select: { cause: true, createdAt: true },
  });

  return {
    windowDays,
    windows: computeRetroKpiLedger(
      groupRetroKpiTaskEvents(transitions),
      countRows,
      now,
      windowDays,
      windowCount,
    ),
  };
}
