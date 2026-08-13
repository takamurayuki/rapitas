/**
 * RetroEvidence
 *
 * Evidence-bundle construction for the process retrospective: pure aggregation
 * of a completed task's WorkflowTransition rows (cause-class counts, critic
 * reasons, per-state dwell times) plus the single DB fetch. NOT the
 * artifact-content retrospective — that is services/ai/retrospective-service.ts,
 * which reviews research/plan/verify bodies; this module reads process
 * metadata only.
 */
import { prisma } from '../../../config/database';
import { createLogger } from '../../../config/logger';
import type {
  CauseCounts,
  EvidenceBundle,
  RetroExperimentInfo,
  RetroTransitionRow,
} from './retro-types';

const log = createLogger('workflow:process-retro');

/** Critic-gate bounce causes. Source: phase-critic/critic-lessons.ts STREAMS. */
export const CRITIC_CAUSES = [
  'research_critic_failed',
  'research_critic_exhausted',
  'plan_critic_failed',
  'plan_critic_exhausted',
] as const;

/**
 * Repair/rework causes. NOTE: the first 8 mirror outcome-telemetry.ts
 * TROUBLE_CAUSES (keep in sync); the last 2 are the replan family
 * (workflow-orchestrator.ts).
 */
export const REPAIR_CAUSES = [
  'verify_repair',
  'ci_repair',
  'adversarial_review_failed',
  'verify_validation_failed',
  'verify_no_changes',
  'verify_pr_not_created',
  'auto_merge_blocked',
  'log_polluted_rejected',
  'plan_invalid_replan',
  'plan_invalid_replan_exhausted',
] as const;

/** Replan subset of REPAIR_CAUSES, counted separately for the replan_loop lens. */
export const REPLAN_CAUSES = ['plan_invalid_replan', 'plan_invalid_replan_exhausted'] as const;

/**
 * Abnormal rejection causes. Source: workflow-handlers-files.ts
 * (rejected_resave_blocked / transition_rejected).
 */
export const ANOMALY_CAUSES = ['rejected_resave_blocked', 'transition_rejected'] as const;

/**
 * Count cause-class occurrences plus invariant violations over a task's
 * transitions. Pure — replans are counted both in repairCount (superset) and
 * replanCount (drill-down for the replan_loop category).
 *
 * @param rows - Transition rows (any order). / 遷移行(順不同可)
 * @returns Per-class counters. / cause分類別カウント
 */
export function countCauses(rows: RetroTransitionRow[]): CauseCounts {
  const criticSet = new Set<string>(CRITIC_CAUSES);
  const repairSet = new Set<string>(REPAIR_CAUSES);
  const replanSet = new Set<string>(REPLAN_CAUSES);
  const anomalySet = new Set<string>(ANOMALY_CAUSES);

  const counts: CauseCounts = {
    criticRebounds: 0,
    repairCount: 0,
    replanCount: 0,
    anomalyCount: 0,
    invariantCount: 0,
  };
  for (const r of rows) {
    if (criticSet.has(r.cause)) counts.criticRebounds++;
    if (repairSet.has(r.cause)) counts.repairCount++;
    if (replanSet.has(r.cause)) counts.replanCount++;
    if (anomalySet.has(r.cause)) counts.anomalyCount++;
    if (r.invariantViolation) counts.invariantCount++;
  }
  return counts;
}

function sortRows(rows: RetroTransitionRow[]): RetroTransitionRow[] {
  return [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id);
}

/**
 * Index of the first dispatch transition: the earliest row carrying a non-null
 * `phase`. Transitions recorded before any execution phase (task creation,
 * reconciler_requeue) have phase=null; the first phase-bearing row (e.g.
 * intake_enriched with phase:'research', intake-gate.ts) marks the moment the
 * workflow actually started executing. Returns -1 when no row has a phase.
 */
function firstDispatchIndex(sorted: RetroTransitionRow[]): number {
  return sorted.findIndex((r) => r.phase !== null);
}

/**
 * Compute total dwell time per workflow state from a transition list. Rows are
 * sorted by createdAt (id as tie-breaker — auto-advance chains share a
 * millisecond); each adjacent gap is attributed to the state the task was IN
 * during it (`rows[i].toStatus`), negative gaps clamp to 0, same-named states
 * accumulate, and the terminal state (no closing transition) is excluded.
 * Gaps BEFORE the first dispatch transition (see firstDispatchIndex) are
 * excluded — they are pre-dispatch queue wait (auto-run stopped, server down),
 * not execution time; computeQueueWaitMs accounts for them separately.
 * Pure — no dependence on wall time.
 *
 * @param rows - Transition rows (any order). / 遷移行(順不同可)
 * @returns Dwell ms per state. / 状態別滞在時間(ms)
 */
export function computePhaseTimings(rows: RetroTransitionRow[]): Record<string, number> {
  const sorted = sortRows(rows);
  const dispatchIdx = firstDispatchIndex(sorted);
  const timings: Record<string, number> = {};
  for (let i = 0; i < sorted.length - 1; i++) {
    // NOTE: dispatchIdx === -1 (no phase-bearing row) keeps legacy behavior —
    // every gap is attributed, because no dispatch boundary can be identified.
    if (dispatchIdx !== -1 && i < dispatchIdx) continue;
    const gap = Math.max(0, sorted[i + 1].createdAt.getTime() - sorted[i].createdAt.getTime());
    const state = sorted[i].toStatus;
    timings[state] = (timings[state] ?? 0) + gap;
  }
  return timings;
}

/**
 * Total pre-dispatch queue wait: the sum of adjacent gaps strictly before the
 * first dispatch transition (firstDispatchIndex). This is the time a task sat
 * enqueued while nothing executed it — auto-run disabled by the user, server
 * downtime, reconciler requeues — and must NOT be read as a phase duration
 * (task 567: 10 days of auto-run downtime were misfiled as draft dwell and
 * spawned a false-positive urgent phase_wallclock concern). Pure.
 *
 * @param rows - Transition rows (any order). / 遷移行(順不同可)
 * @returns Pre-dispatch wait ms (0 when dispatch is first or absent). / 初回ディスパッチ前の待機(ms)
 */
export function computeQueueWaitMs(rows: RetroTransitionRow[]): number {
  const sorted = sortRows(rows);
  const dispatchIdx = firstDispatchIndex(sorted);
  if (dispatchIdx <= 0) return 0;
  let wait = 0;
  for (let i = 0; i < dispatchIdx; i++) {
    wait += Math.max(0, sorted[i + 1].createdAt.getTime() - sorted[i].createdAt.getTime());
  }
  return wait;
}

/**
 * Extract critic-rejection reason strings from critic-bounce transitions'
 * metadata JSON (`reasons: string[]` shape). Rows with malformed metadata are
 * skipped — never throws.
 *
 * @param rows - Transition rows. / 遷移行
 * @returns Flattened reason strings. / 差し戻し理由の平坦化リスト
 */
export function extractCriticReasons(rows: RetroTransitionRow[]): string[] {
  const criticSet = new Set<string>(CRITIC_CAUSES);
  const out: string[] = [];
  for (const r of rows) {
    if (!criticSet.has(r.cause)) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(r.metadata || '{}');
    } catch {
      continue;
    }
    if (parsed === null || typeof parsed !== 'object') continue;
    const reasons = (parsed as { reasons?: unknown }).reasons;
    if (!Array.isArray(reasons)) continue;
    for (const reason of reasons) {
      if (typeof reason === 'string' && reason.trim()) out.push(reason.trim());
    }
  }
  return out;
}

/**
 * A clean round has zero critic bounces, repairs, replans, anomalies, and
 * invariant violations — nothing worth an AI call.
 *
 * @param bundle - The evidence bundle. / 証拠バンドル
 * @returns true when the round is clean. / クリーンなら true
 */
export function isCleanRound(bundle: EvidenceBundle): boolean {
  return (
    bundle.criticRebounds === 0 &&
    bundle.repairCount === 0 &&
    bundle.replanCount === 0 &&
    bundle.anomalyCount === 0 &&
    bundle.invariantCount === 0
  );
}

/**
 * Build the full evidence bundle from raw rows and task metadata. Pure — the
 * same inputs always yield the same bundle (no DB, no clock).
 *
 * @param rows - Transition rows (any order). / 遷移行(順不同可)
 * @param taskMeta - Task id and title. / タスクIDとタイトル
 * @param experiment - Active self-experiment info, when one is running (optional
 *   — existing 2-arg callers stay valid). / 実験中情報(任意)
 * @returns The evidence bundle. / 証拠バンドル
 */
export function buildEvidenceBundle(
  rows: RetroTransitionRow[],
  taskMeta: { taskId: number; title: string },
  experiment?: RetroExperimentInfo,
): EvidenceBundle {
  const timeline = [...rows].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id,
  );
  return {
    taskId: taskMeta.taskId,
    title: taskMeta.title,
    timeline,
    ...countCauses(rows),
    criticReasons: extractCriticReasons(rows),
    phaseTimings: computePhaseTimings(rows),
    queueWaitMs: computeQueueWaitMs(rows),
    ...(experiment ? { experiment } : {}),
  };
}

/**
 * Fetch a task's WorkflowTransition rows for the retrospective (the only I/O
 * in this module). DB failures are logged and degrade to an empty list, which
 * downstream treats as a clean round (fail-open, no AI call).
 *
 * @param taskId - Task whose transitions to load. / 対象タスク
 * @returns Transition rows, oldest-first (empty on failure). / 遷移行
 */
export async function fetchRetroRows(taskId: number): Promise<RetroTransitionRow[]> {
  return prisma.workflowTransition
    .findMany({
      where: { taskId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        fromStatus: true,
        toStatus: true,
        actor: true,
        cause: true,
        phase: true,
        metadata: true,
        invariantViolation: true,
        createdAt: true,
      },
    })
    .catch((err) => {
      log.warn({ err, taskId }, '[process-retro] fetchRetroRows failed');
      return [] as RetroTransitionRow[];
    });
}
