/**
 * gate-precision-ledger
 *
 * Retrospectively classifies a verify_repair "dispute" (the same acceptance
 * criterion flagged by 2+ bounces — verify-convergence.ts's own
 * non-convergence signal) by HOW it resolved: did a further implement→verify
 * cycle alone satisfy it, or did resolution require a human/plan-level
 * intervention first? loop-metrics.ts already counts HOW MANY verify_repair
 * bounces happen; this module answers WHETHER the repeated ones were the
 * implementer's problem or something the gate/plan itself needed a human to
 * fix — a calibration signal neither loop-metrics.ts nor loop-watcher.ts can
 * currently produce.
 * Not responsible for scheduling (gate-precision-job.ts) or surfacing
 * findings to the planner/verifier (workflow-gate-precision-context.ts).
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { parseAcceptanceCriteria, identifyIndictedCriteria } from '../workflow/verify-convergence';
import { classifyTransition } from '../supervision/intervention-detector';
import { VERIFY_PASS_CAUSES } from '../supervision/task-landing-classifier';

const log = createLogger('self-improvement:gate-precision-ledger');

export type GatePrecisionVerdict =
  | 'resolved_by_implementation'
  | 'resolved_by_human'
  | 'unresolved_blocked';

const PASS_CAUSES = new Set(VERIFY_PASS_CAUSES);

/** Transition causes that mean a human/plan-level hand touched this task, beyond what classifyTransition already covers (actor='user', manual_*, task_retried). */
const EXTRA_HUMAN_CAUSES = new Set(['plan_revision_requested', 'requirement_evidence_replan']);

export interface RepairTransitionRow {
  id: number;
  taskId: number;
  actor: string;
  cause: string;
  toStatus: string | null;
  metadata: string | null;
  createdAt: Date;
}

export interface TaskAcceptanceSnapshot {
  id: number;
  status: string;
  acceptanceCriteria: string | null;
}

export interface GatePrecisionCandidate {
  taskId: number;
  gate: 'verify_repair';
  criterionIndex: number;
  reason: string;
  verdict: GatePrecisionVerdict;
  evidenceJson: string;
  detectedAt: Date;
  dedupKey: string;
}

/** Extracts metadata.reason from a WorkflowTransition row, '' when absent/malformed. */
function extractReason(metadata: string | null): string {
  try {
    const meta = JSON.parse(metadata ?? '{}') as { reason?: unknown };
    return typeof meta.reason === 'string' ? meta.reason : '';
  } catch {
    return '';
  }
}

/** Whether one transition counts as a human/plan-level touch on the task. */
function isHumanResolutionCause(transition: RepairTransitionRow): boolean {
  if (EXTRA_HUMAN_CAUSES.has(transition.cause)) return true;
  return classifyTransition({ actor: transition.actor, cause: transition.cause }) !== null;
}

/**
 * Classify every task's verify_repair disputes from its full transition
 * history. Pure — the testable core.
 *
 * A dispute is a criterion indicted by 2+ distinct verify_repair bounces
 * (mirrors detectRepairNonConvergence's own definition, computed here across
 * the whole window rather than incrementally). Only RESOLVED disputes are
 * returned — a task still actively bouncing (no pass yet, not blocked) is
 * skipped and picked up again on a later scan once its outcome is known.
 *
 * @param input.transitions - ALL transitions for the candidate tasks, any
 *   cause, ascending by createdAt. / 対象タスクの全遷移(昇順)
 * @param input.tasksById - Task snapshots (status + acceptanceCriteria). / タスク情報
 * @returns Resolved dispute verdicts. / 解決済み紛糾の判定一覧
 */
export function extractGatePrecisionCases(input: {
  transitions: RepairTransitionRow[];
  tasksById: Map<number, TaskAcceptanceSnapshot>;
}): GatePrecisionCandidate[] {
  const byTask = new Map<number, RepairTransitionRow[]>();
  for (const t of input.transitions) {
    const list = byTask.get(t.taskId) ?? [];
    list.push(t);
    byTask.set(t.taskId, list);
  }

  const out: GatePrecisionCandidate[] = [];
  for (const [taskId, rows] of byTask) {
    const task = input.tasksById.get(taskId);
    if (!task) continue;
    const criteria = parseAcceptanceCriteria(task.acceptanceCriteria);
    if (criteria.length === 0) continue;

    const bounces = rows.filter((r) => r.cause === 'verify_repair');
    if (bounces.length < 2) continue;

    const byCriterion = new Map<number, RepairTransitionRow[]>();
    for (const bounce of bounces) {
      const reason = extractReason(bounce.metadata);
      for (const idx of identifyIndictedCriteria(reason, criteria)) {
        const list = byCriterion.get(idx) ?? [];
        list.push(bounce);
        byCriterion.set(idx, list);
      }
    }

    for (const [criterionIndex, indictingBounces] of byCriterion) {
      if (indictingBounces.length < 2) continue; // not a dispute
      const lastBounce = indictingBounces[indictingBounces.length - 1]!;

      const after = rows.filter((r) => r.createdAt > lastBounce.createdAt);
      const passIdx = after.findIndex(
        (r) => PASS_CAUSES.has(r.cause) || r.toStatus === 'completed',
      );

      let verdict: GatePrecisionVerdict;
      let resolvedByTransitionId: number | null = null;
      let resolvedAt: Date | null = null;

      if (passIdx !== -1) {
        const resolutionWindow = after.slice(0, passIdx + 1);
        const humanTouch = resolutionWindow.find((r) => isHumanResolutionCause(r));
        verdict = humanTouch ? 'resolved_by_human' : 'resolved_by_implementation';
        resolvedByTransitionId = humanTouch ? humanTouch.id : after[passIdx]!.id;
        resolvedAt = after[passIdx]!.createdAt;
      } else if (task.status === 'blocked') {
        verdict = 'unresolved_blocked';
      } else {
        continue; // still in flight
      }

      out.push({
        taskId,
        gate: 'verify_repair',
        criterionIndex,
        reason: extractReason(lastBounce.metadata),
        verdict,
        evidenceJson: JSON.stringify({
          transitionIds: indictingBounces.map((b) => b.id),
          bounceCount: indictingBounces.length,
          firstBounceAt: indictingBounces[0]!.createdAt.toISOString(),
          resolvedAt: resolvedAt?.toISOString() ?? null,
          resolvedByTransitionId,
        }),
        detectedAt: resolvedAt ?? lastBounce.createdAt,
        dedupKey: `gate-precision:${taskId}:${criterionIndex}:${lastBounce.id}`,
      });
    }
  }
  return out;
}

/**
 * Persist extracted cases. Duplicate dedupKeys (re-scans of an already
 * recorded dispute) are swallowed silently; other DB errors are logged and
 * skipped (fail-open — the ledger must never break its caller).
 *
 * @param candidates - Cases to record. / 記録する判定
 * @returns Number of NEW rows created. / 新規作成件数
 */
export async function recordGatePrecisionCases(
  candidates: GatePrecisionCandidate[],
): Promise<number> {
  let created = 0;
  for (const candidate of candidates) {
    try {
      // NOTE: prisma.gatePrecisionCase requires the regenerated client — dev.js
      // regenerates on the post-merge server restart (never run generate manually).
      await prisma.gatePrecisionCase.create({ data: candidate });
      created++;
    } catch (err) {
      const code = (err as { code?: string }).code;
      // P2002 = unique constraint (dedupKey) — an already-recorded dispute.
      if (code !== 'P2002') {
        log.warn({ err, dedupKey: candidate.dedupKey }, '[gate-precision] case insert failed');
      }
    }
  }
  return created;
}

/**
 * Gather evidence from the DB and record every newly-resolved dispute.
 * Read-only over WorkflowTransition/Task; writes only to the
 * GatePrecisionCase ledger. Fail-open on query errors.
 *
 * @param opts.nowMs - Anchor time (injectable for tests). / 基準時刻
 * @param opts.lookbackDays - Evidence window (default 30). / 遡り日数
 * @returns Number of newly recorded cases. / 新規記録件数
 */
export async function collectAndRecordGatePrecisionCases(
  opts: { nowMs?: number; lookbackDays?: number } = {},
): Promise<number> {
  const nowMs = opts.nowMs ?? Date.now();
  const lookbackDays =
    opts.lookbackDays ??
    (parseInt(process.env.RAPITAS_GATE_PRECISION_LOOKBACK_DAYS ?? '', 10) > 0
      ? parseInt(process.env.RAPITAS_GATE_PRECISION_LOOKBACK_DAYS ?? '', 10)
      : 30);
  const since = new Date(nowMs - lookbackDays * 24 * 60 * 60 * 1000);

  const disputedTaskIds: number[] = await prisma.workflowTransition
    .groupBy({
      by: ['taskId'],
      where: { cause: 'verify_repair', createdAt: { gte: since } },
      _count: { taskId: true },
      having: { taskId: { _count: { gte: 2 } } },
    })
    .then((rows) => rows.map((r) => r.taskId))
    .catch(() => [] as number[]);
  if (disputedTaskIds.length === 0) return 0;

  const transitions: RepairTransitionRow[] = await prisma.workflowTransition
    .findMany({
      where: { taskId: { in: disputedTaskIds }, createdAt: { gte: since } },
      select: {
        id: true,
        taskId: true,
        actor: true,
        cause: true,
        toStatus: true,
        metadata: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
      take: 2000,
    })
    .catch(() => []);

  const taskRows = await prisma.task
    .findMany({
      where: { id: { in: disputedTaskIds } },
      select: { id: true, status: true, acceptanceCriteria: true },
    })
    .catch(() => []);
  const tasksById = new Map(taskRows.map((t) => [t.id, t]));

  const candidates = extractGatePrecisionCases({ transitions, tasksById });
  return recordGatePrecisionCases(candidates);
}
