/**
 * repair-iteration-metrics
 *
 * Pure functions computing per-repair-iteration change-set size and dwell time
 * from already-fetched WorkflowTransition (verify_repair/ci_repair) rows and
 * ActivityLog `auto_commit_created` rows. Task #672, operator-approved scope B:
 * MVP-limited to metrics derivable from EXISTING data — test-pass-rate delta
 * and learning-velocity are explicitly out of scope (no structured numeric test
 * result exists anywhere in the pipeline; see research.md前提監査#2). Not
 * responsible for DB access — callers query WorkflowTransition/ActivityLog and
 * pass the rows in here.
 */

const REPAIR_CAUSES = ['verify_repair', 'ci_repair'] as const;

/** The two WorkflowTransition causes that represent a repair-loop bounce. */
export type RepairCause = (typeof REPAIR_CAUSES)[number];

/** Shape of one row from WorkflowTransition (any cause — non-repair rows are filtered out). */
export interface RawRepairIterationTransition {
  id?: number | string | null;
  cause?: string | null;
  createdAt: Date | string;
}

/** Shape of one ActivityLog row with action='auto_commit_created' (metadata already parsed). */
export interface RawAutoCommitEntry {
  createdAt: Date | string;
  filesChanged?: number | null;
  additions?: number | null;
  deletions?: number | null;
}

/** Aggregated commit stats landing inside one iteration's window. */
export interface RepairIterationChangeSet {
  filesChanged: number;
  additions: number;
  deletions: number;
}

/** One repair-loop iteration with its derived dwell time and change-set size. */
export interface RepairIterationMetric {
  id: string;
  cause: RepairCause;
  createdAt: string;
  /** Milliseconds since the previous repair iteration; null for the first (no prior bound). */
  dwellTimeMs: number | null;
  /** Aggregated auto-commit stats in the window since the previous iteration; null when none matched. */
  changeSet: RepairIterationChangeSet | null;
}

function isRepairCause(cause: string | null | undefined): cause is RepairCause {
  return (REPAIR_CAUSES as readonly string[]).includes(cause ?? '');
}

function toTime(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

/**
 * Compute per-iteration dwell time and change-set size for a task's repair loop.
 * Both metrics are derived from data that already exists (no new instrumentation
 * added): dwell time from consecutive WorkflowTransition timestamps, change-set
 * size from ActivityLog `auto_commit_created` rows landing inside each
 * iteration's window (the previous iteration's timestamp, exclusive, through
 * this iteration's timestamp, inclusive; unbounded below for the first iteration).
 *
 * @param transitions - Task's WorkflowTransition rows (any cause; non-repair rows are filtered). / 遷移ログ
 * @param commits - Task's ActivityLog `auto_commit_created` rows. / 自動コミットログ
 * @returns Repair iterations with dwell time + change-set size, chronological order. / 反復メトリクス
 */
export function computeRepairIterationMetrics(
  transitions: RawRepairIterationTransition[],
  commits: RawAutoCommitEntry[],
): RepairIterationMetric[] {
  const iterations = transitions
    .filter((t): t is RawRepairIterationTransition & { cause: RepairCause } =>
      isRepairCause(t.cause),
    )
    .map((t, index) => ({ ...t, index, time: toTime(t.createdAt) }))
    .sort((a, b) => a.time - b.time);

  const sortedCommits = commits
    .map((c) => ({ ...c, time: toTime(c.createdAt) }))
    .sort((a, b) => a.time - b.time);

  return iterations.map((iter, i) => {
    const windowStart = i === 0 ? null : iterations[i - 1].time;
    const windowEnd = iter.time;
    const matched = sortedCommits.filter(
      (c) => (windowStart === null || c.time > windowStart) && c.time <= windowEnd,
    );
    const changeSet: RepairIterationChangeSet | null =
      matched.length === 0
        ? null
        : matched.reduce<RepairIterationChangeSet>(
            (acc, c) => ({
              filesChanged:
                acc.filesChanged + (typeof c.filesChanged === 'number' ? c.filesChanged : 0),
              additions: acc.additions + (typeof c.additions === 'number' ? c.additions : 0),
              deletions: acc.deletions + (typeof c.deletions === 'number' ? c.deletions : 0),
            }),
            { filesChanged: 0, additions: 0, deletions: 0 },
          );
    return {
      id: `repair-${iter.id ?? iter.index}`,
      cause: iter.cause,
      createdAt: new Date(iter.time).toISOString(),
      dwellTimeMs: windowStart === null ? null : windowEnd - windowStart,
      changeSet,
    };
  });
}
