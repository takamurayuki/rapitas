/**
 * GatePrecisionSummary
 *
 * Reduces the gate-precision ledger to numbers a person can read. Pure: no
 * database, no clock.
 *
 * The ledger classifies how a repeated bounce resolved, but until now nothing
 * read it back — the rows went into agent prompts
 * (workflow-gate-precision-context.ts) and nowhere else. The question the
 * published article left open ("how many of the review's fails deserved to
 * be fails") could only be answered by writing a throwaway query.
 *
 * What this is NOT. Nobody labelled any bounce correct or incorrect, so
 * there is no ground truth and nothing here is precision in the
 * true-positive sense. `actionableShare` is the share of disputes the
 * implementer resolved alone — evidence that the bounce had something to
 * act on, not proof the gate was right. The names say so on purpose, and
 * a `precision` field is deliberately absent.
 */

/** One ledger row, as much of it as the summary reads. */
export interface PrecisionRow {
  gate: string;
  verdict: string;
  reason: string | null;
  taskId: number;
}

/** The ledger, counted. */
export interface GatePrecisionSummary {
  total: number;
  /** Distinct tasks, since one task can raise several disputes. */
  tasks: number;
  byVerdict: Record<string, number>;
  byGate: Record<string, number>;
  /** Rows whose reason cites the adversarial diff review. */
  fromAdversarialReview: number;
  /**
   * Share the implementer resolved without a human or a plan change.
   * Null when there is nothing to divide — 0 would read as a measured zero.
   */
  actionableShare: number | null;
  /** Share that never resolved: a wrong call, or a criterion nobody can reach. */
  unresolvedShare: number | null;
}

/** The ledger's own marker for a bounce the adversarial review raised. */
const ADVERSARIAL_MARKER = '差分レビュー不合格';

/**
 * Count the ledger.
 *
 * @param rows - Every case to summarise / 集計対象の全ケース
 * @returns Counts, and shares that are null rather than zero when empty / 件数と割合
 */
export function summariseGatePrecision(rows: readonly PrecisionRow[]): GatePrecisionSummary {
  const byVerdict: Record<string, number> = {};
  const byGate: Record<string, number> = {};
  const tasks = new Set<number>();
  let fromAdversarialReview = 0;

  for (const r of rows) {
    byVerdict[r.verdict] = (byVerdict[r.verdict] ?? 0) + 1;
    byGate[r.gate] = (byGate[r.gate] ?? 0) + 1;
    tasks.add(r.taskId);
    if (r.reason?.includes(ADVERSARIAL_MARKER)) fromAdversarialReview++;
  }

  const total = rows.length;
  const share = (n: number) => (total === 0 ? null : n / total);

  return {
    total,
    tasks: tasks.size,
    byVerdict,
    byGate,
    fromAdversarialReview,
    actionableShare: share(byVerdict.resolved_by_implementation ?? 0),
    unresolvedShare: share(byVerdict.unresolved_blocked ?? 0),
  };
}
