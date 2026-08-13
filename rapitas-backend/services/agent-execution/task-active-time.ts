/**
 * Task Active Time
 *
 * Aggregates per-task active time (累積実働) and current-cycle wall-clock from
 * AgentExecution rows — always computed on the fly, no schema change.
 * Not responsible for recording execution time (see execution-persistence).
 */
import type { PrismaClient } from '../../generated/prisma-postgres';

/** Per-role aggregation entry for the phase breakdown. */
export interface PhaseBreakdownEntry {
  /** Workflow role (researcher / planner / implementer / verifier) or raw session mode. */
  role: string;
  /** Number of executions attributed to this role (including a currently running one). */
  execCount: number;
  /** Sum of (completedAt - startedAt) over this role's finished executions, in ms. */
  activeTimeMs: number;
}

/** Aggregated timing view of a single task. */
export interface TaskActiveTime {
  /**
   * Sum of (completedAt - startedAt) over ALL finished AgentExecution rows of
   * the task, across phases / re-runs / repair loops.
   *
   * NOTE: This intentionally INCLUDES in-run approval / question wait time
   * (要求Aの SUM 定義). It differs from AgentExecution.executionTimeMs, which
   * accumulates CLI process segments only and excludes wait gaps.
   */
  activeTimeMs: number;
  /**
   * Elapsed time of the CURRENT execution cycle: from the first startedAt of
   * the latest contiguous run group to its last activity (now when a row is
   * still running). Abandoned past runs separated by a long idle gap are
   * excluded. 0 when the task has no started execution.
   */
  wallClockMs: number;
  /** Per-role breakdown ordered by first appearance. */
  phaseBreakdown: PhaseBreakdownEntry[];
}

/**
 * Gap between consecutive executions that splits run cycles.
 *
 * NOTE: Heuristic — a task left idle this long between executions is treated
 * as an abandoned earlier run (e.g. re-run days later), so wall-clock restarts
 * at the next execution. Kept generous so overnight approval waits inside one
 * cycle are not split.
 */
export const CYCLE_GAP_MS = 6 * 60 * 60 * 1000;

/** Minimal execution row shape consumed by the aggregation. */
interface ExecutionSlice {
  startedAt: Date | null;
  completedAt: Date | null;
  status: string;
  session: { mode: string | null } | null;
}

/** Extract the workflow role from a session mode (e.g. "workflow-planner" → "planner"). */
function roleFromMode(mode: string | null | undefined): string {
  if (!mode) return 'other';
  return mode.startsWith('workflow-') ? mode.slice('workflow-'.length) : mode;
}

/** Duration of a finished row in ms, or null when not computable. */
function finishedDurationMs(row: ExecutionSlice): number | null {
  if (!row.startedAt || !row.completedAt) return null;
  const ms = row.completedAt.getTime() - row.startedAt.getTime();
  // Negative spans (clock skew / corrupted rows) must not poison the sum.
  return ms >= 0 ? ms : null;
}

/**
 * Aggregate rows into the task timing view (pure part, unit-testable).
 *
 * @param rows - Execution slices ordered by startedAt ascending. / startedAt 昇順の実行行
 * @param now - Clock anchor for running rows. / 実行中行の現在時刻アンカー
 * @returns Aggregated timing view. / 集計結果
 */
export function aggregateTaskActiveTime(rows: ExecutionSlice[], now: Date): TaskActiveTime {
  const started = rows.filter((r) => r.startedAt !== null);

  // ── activeTimeMs: finished rows only — a running row (completedAt null)
  // would yield NaN / a moving sum; its live share is rendered FE-side.
  let activeTimeMs = 0;
  for (const row of started) {
    const ms = finishedDurationMs(row);
    if (ms !== null) activeTimeMs += ms;
  }

  // ── phaseBreakdown: group by role, ordered by first appearance.
  const breakdown = new Map<string, PhaseBreakdownEntry>();
  for (const row of started) {
    const role = roleFromMode(row.session?.mode);
    const entry = breakdown.get(role) ?? { role, execCount: 0, activeTimeMs: 0 };
    entry.execCount += 1;
    const ms = finishedDurationMs(row);
    if (ms !== null) entry.activeTimeMs += ms;
    breakdown.set(role, entry);
  }

  // ── wallClockMs: latest contiguous run group (split on CYCLE_GAP_MS idle
  // gaps between one row's end and the next row's start).
  let wallClockMs = 0;
  if (started.length > 0) {
    let cycleStartIdx = 0;
    for (let i = 1; i < started.length; i++) {
      const prevEnd = started[i - 1].completedAt ?? started[i - 1].startedAt;
      const gap = (started[i].startedAt as Date).getTime() - (prevEnd as Date).getTime();
      if (gap > CYCLE_GAP_MS) cycleStartIdx = i;
    }
    const cycleRows = started.slice(cycleStartIdx);
    const cycleStart = (cycleRows[0].startedAt as Date).getTime();
    const hasRunning = cycleRows.some((r) => r.completedAt === null);
    const cycleEnd = hasRunning
      ? now.getTime()
      : Math.max(...cycleRows.map((r) => (r.completedAt as Date).getTime()));
    wallClockMs = Math.max(0, cycleEnd - cycleStart);
  }

  return { activeTimeMs, wallClockMs, phaseBreakdown: [...breakdown.values()] };
}

/**
 * Compute the aggregated timing view for one task.
 *
 * Fetches only 4 fields per row (startedAt / completedAt / status /
 * session.mode) to keep the read cheap enough for the 5s polling endpoints.
 * Prisma cannot SUM a datetime difference, so the sum is computed in JS.
 *
 * @param prisma - Prisma client instance. / Prismaクライアント
 * @param taskId - Task to aggregate. / 集計対象のタスクID
 * @returns Aggregated timing view. / 集計結果
 */
export async function computeTaskActiveTime(
  prisma: PrismaClient,
  taskId: number,
): Promise<TaskActiveTime> {
  const rows = await prisma.agentExecution.findMany({
    where: { session: { config: { taskId } } },
    select: {
      startedAt: true,
      completedAt: true,
      status: true,
      session: { select: { mode: true } },
    },
    orderBy: { startedAt: 'asc' },
  });
  return aggregateTaskActiveTime(rows, new Date());
}
