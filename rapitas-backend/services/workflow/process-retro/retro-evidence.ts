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
import { DEFAULT_VERIFY_REPAIR_LIMIT, PR_RETRY_LIGHTWEIGHT_CAUSE } from '../blocked-task-policy';
import type {
  CauseCounts,
  EvidenceBundle,
  QueueWaitDetail,
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
 * PR-creation-recovery causes, counted separately from REPAIR_CAUSES (task
 * 713). NOT a strict subset: verify_pr_not_created is also in REPAIR_CAUSES,
 * but PR_RETRY_LIGHTWEIGHT_CAUSE is not (changing REPAIR_CAUSES/TROUBLE_CAUSES
 * membership is out of scope here — see outcome-telemetry.ts's "keep in sync"
 * note). Both causes already have a bounded, dedicated auto-recovery path
 * (blocked-pr-retry-recovery.ts) and a direct escalation criterion
 * (blocked-task-policy.classifyBlockedExclusion's pr_recovery_exhausted, at
 * MAX_PR_RECOVERY_ATTEMPTS total verify_pr_not_created occurrences) distinct
 * from the content-repair bounce (verify_repair, handled by
 * verify-self-repair.ts). Folding both into a
 * single "repair" count previously made the retro AI mistake a PR-recovery
 * task that later completed normally (task#705) for an ineffective
 * content-repair loop (K-7246) — this counter lets the retro distinguish the
 * two failure patterns instead of conflating them.
 */
export const PR_RECOVERY_CAUSES = ['verify_pr_not_created', PR_RETRY_LIGHTWEIGHT_CAUSE] as const;

/**
 * Abnormal rejection causes. Source: workflow-handlers-files.ts
 * (rejected_resave_blocked / transition_rejected).
 */
export const ANOMALY_CAUSES = ['rejected_resave_blocked', 'transition_rejected'] as const;

/**
 * Whether a row is a critic-follow rejection: a transition_rejected recorded
 * because the state machine correctly refused an in-flight agent's save right
 * after an async critic-gate rollback. Detected deterministically via the
 * metadata correlation key `criticBouncePhase` persisted by the save guard
 * (guards.ts) — no time-window heuristic. Rows with malformed metadata or a
 * missing key return false (fail-open to the legacy anomaly classification;
 * never throws).
 *
 * @param row - One transition row. / 遷移行1件
 * @returns true when the row follows a critic bounce. / 批評追随拒否なら true
 */
export function isCriticFollowRejection(row: RetroTransitionRow): boolean {
  if (row.cause !== 'transition_rejected') return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.metadata || '{}');
  } catch {
    return false;
  }
  if (parsed === null || typeof parsed !== 'object') return false;
  return typeof (parsed as { criticBouncePhase?: unknown }).criticBouncePhase === 'string';
}

/**
 * Count cause-class occurrences plus invariant violations over a task's
 * transitions. Pure — replans are counted both in repairCount (superset) and
 * replanCount (drill-down for the replan_loop lens). PR-recovery causes are
 * counted independently in prRecoveryCount for the repair-effectiveness lens;
 * only verify_pr_not_created also lands in repairCount (see PR_RECOVERY_CAUSES
 * for why it is not a strict repairCount subset). Critic-follow rejections
 * (see isCriticFollowRejection) are counted ONLY in
 * criticFollowRejections — excluded from anomalyCount, because they are the
 * designed self-repair chain, not abnormal causes. invariantCount likewise
 * excludes critic-bounce causes (already in criticRebounds — counting them
 * again misreads a single chain as independent violations, task 620) and
 * critic-follow rejections, leaving only genuine invariant breakage.
 *
 * @param rows - Transition rows (any order). / 遷移行(順不同可)
 * @returns Per-class counters. / cause分類別カウント
 */
export function countCauses(rows: RetroTransitionRow[]): CauseCounts {
  const criticSet = new Set<string>(CRITIC_CAUSES);
  const repairSet = new Set<string>(REPAIR_CAUSES);
  const replanSet = new Set<string>(REPLAN_CAUSES);
  const prRecoverySet = new Set<string>(PR_RECOVERY_CAUSES);
  const anomalySet = new Set<string>(ANOMALY_CAUSES);

  const counts: CauseCounts = {
    criticRebounds: 0,
    repairCount: 0,
    replanCount: 0,
    prRecoveryCount: 0,
    anomalyCount: 0,
    criticFollowRejections: 0,
    invariantCount: 0,
  };
  for (const r of rows) {
    const criticFollow = isCriticFollowRejection(r);
    if (criticSet.has(r.cause)) counts.criticRebounds++;
    if (repairSet.has(r.cause)) counts.repairCount++;
    if (replanSet.has(r.cause)) counts.replanCount++;
    if (prRecoverySet.has(r.cause)) counts.prRecoveryCount++;
    if (criticFollow) counts.criticFollowRejections++;
    if (anomalySet.has(r.cause) && !criticFollow) counts.anomalyCount++;
    if (r.invariantViolation && !criticSet.has(r.cause) && !criticFollow) counts.invariantCount++;
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
 * excluded — they are pre-dispatch queue wait (the dispatcher was not
 * executing this task; verified root cause on computeQueueWaitDetail), not
 * execution time; computeQueueWaitDetail accounts for them separately.
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
 * Build the cause record for the pre-dispatch queue wait: the wait interval,
 * the transition causes observed while waiting, and the cause that finally
 * dispatched the task. This makes the retro RECORD why the wait happened from
 * the task's own transition facts (not a guess); the record is rendered into
 * the evidence summary, which is also persisted as the filed concern's
 * bundle-summary section.
 *
 * NOTE: Root cause of the task#516 incident (10-day draft dwell, investigated
 * in task 567): NOT a scheduler/queue trigger delay. Measured in
 * cycle-2026-08-12.ndjson — theme.started ("auto-run started by user",
 * 01:08:52.579Z) → task.enqueued for task 516 at 01:08:52.681Z, i.e. the
 * scheduler dispatched 102 ms after auto-run was switched on; cycle logs
 * 2026-08-06..08-12 contain zero theme-scheduler events, so the theme
 * auto-run was simply not running during the whole gap. Pre-dispatch wait is
 * therefore idle-by-design time, split out here so it can never masquerade as
 * a phase_wallclock anomaly. Pure.
 *
 * @param rows - Transition rows (any order). / 遷移行(順不同可)
 * @returns The wait cause record, or null when the first transition already
 *   carries a phase (no wait) or no phase-bearing row exists. / 待機原因の記録(待機なしは null)
 */
export function computeQueueWaitDetail(rows: RetroTransitionRow[]): QueueWaitDetail | null {
  const sorted = sortRows(rows);
  const dispatchIdx = firstDispatchIndex(sorted);
  if (dispatchIdx <= 0) return null;
  let waitMs = 0;
  const preDispatchCauses: Record<string, number> = {};
  for (let i = 0; i < dispatchIdx; i++) {
    waitMs += Math.max(0, sorted[i + 1].createdAt.getTime() - sorted[i].createdAt.getTime());
    preDispatchCauses[sorted[i].cause] = (preDispatchCauses[sorted[i].cause] ?? 0) + 1;
  }
  return {
    waitMs,
    waitStartAt: sorted[0].createdAt.toISOString(),
    dispatchAt: sorted[dispatchIdx].createdAt.toISOString(),
    dispatchCause: sorted[dispatchIdx].cause,
    preDispatchCauses,
  };
}

/**
 * Total pre-dispatch queue wait ms — the scalar view of
 * computeQueueWaitDetail (see its NOTE for the verified root cause). Pure.
 *
 * @param rows - Transition rows (any order). / 遷移行(順不同可)
 * @returns Pre-dispatch wait ms (0 when dispatch is first or absent). / 初回ディスパッチ前の待機(ms)
 */
export function computeQueueWaitMs(rows: RetroTransitionRow[]): number {
  return computeQueueWaitDetail(rows)?.waitMs ?? 0;
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
 * A clean round has zero critic bounces, repairs, replans, anomalies,
 * critic-follow rejections, and invariant violations — nothing worth an AI
 * call. criticFollowRejections is included defensively: in practice such rows
 * always co-occur with the critic bounce itself (criticRebounds ≥ 1), but a
 * lone follow-rejection must still keep the round non-clean.
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
    bundle.criticFollowRejections === 0 &&
    bundle.invariantCount === 0
  );
}

/**
 * A repair round that stays within the configured verify→implement repair
 * budget (see resolveVerifyRepairLimit, blocked-task-policy.ts) is the
 * workflow doing its normal job, not a systemic process incident — reviewing
 * every such completion with an LLM was both noisy and expensive. Keep AI
 * review for over-budget repairs, replans, critic loops, anomalies, and
 * genuine invariant violations.
 *
 * NOTE (task 732): previously fixed at `repairCount === 1`, so a
 * budget-exact 2-repair completion (the default verifyRepairLimit) still
 * reached the AI reviewer and was misclassified as systemic (K-7493, filed
 * from task#727, itself a budget-exact 2-repair completion) — the retro AI
 * was never wrong about the workflow, only the pre-filter's threshold was
 * stale relative to the configurable budget.
 *
 * This function can only ever run against a COMPLETED task (runProcessRetro
 * is invoked from outcome-telemetry.ts only when finalStatus === 'completed'),
 * and completion here is only reachable after passing TWO independent
 * pre-existing safety nets that this function does not duplicate or bypass:
 *  1. A hard repair-count cap: verify-self-repair.ts's resolveMaxRepairs
 *     enforces `repairLimit`; exceeding it ends the task as
 *     verify_repair_exhausted (blocked_task_escalation), never a silent
 *     extra bounce (blocked-task-policy.ts:105-111).
 *  2. Same-criterion non-convergence detection: verify-self-repair.ts:383-420
 *     (`detectRepairNonConvergence` / VERIFY_NON_CONVERGENCE_CAUSE) escalates
 *     to `blocked` via blocked-task-escalation.ts the moment the same
 *     acceptance criterion is indicted twice — the exact "same failure
 *     repeats because feedback was too vague" scenario this concern worries
 *     about. Such a task is blocked, not completed, and therefore never
 *     reaches this function.
 * Per-repair feedback granularity (failing test file:line + surrounding
 * context, or per-check CI log excerpts) is likewise already implemented
 * independently of this function, in verify-self-repair.ts's
 * extractFailureDetails/buildRepairFeedbackBlock and ci-self-repair.ts's
 * fetchFailedCheckLogExcerpt. This function's only job is to stop the
 * retrospective classifier from re-litigating rounds that already passed
 * both safety nets above.
 *
 * @param bundle - The evidence bundle. / 証拠バンドル
 * @param repairLimit - Effective verify→implement repair budget (see
 *   resolveVerifyRepairLimit). Defaults to DEFAULT_VERIFY_REPAIR_LIMIT for
 *   callers that have not resolved UserSettings. / 有効な修復予算
 * @returns true when the round is a budget-compliant repair. / 予算内の修復なら true
 */
export function isRoutineBudgetedRepair(
  bundle: EvidenceBundle,
  repairLimit: number = DEFAULT_VERIFY_REPAIR_LIMIT,
): boolean {
  return (
    bundle.repairCount >= 1 &&
    bundle.repairCount <= repairLimit &&
    bundle.replanCount === 0 &&
    bundle.criticRebounds === 0 &&
    bundle.anomalyCount === 0 &&
    bundle.criticFollowRejections === 0 &&
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
  const queueWaitDetail = computeQueueWaitDetail(rows);
  return {
    taskId: taskMeta.taskId,
    title: taskMeta.title,
    timeline,
    ...countCauses(rows),
    criticReasons: extractCriticReasons(rows),
    phaseTimings: computePhaseTimings(rows),
    queueWaitMs: queueWaitDetail?.waitMs ?? 0,
    queueWaitDetail,
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
