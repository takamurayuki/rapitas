/**
 * CompanionDigest
 *
 * Builds the "what changed since you last looked" summary for accompanied
 * tasks (companion design 段D, stage 2 item 1). Pure: the caller hands in the
 * companion rows, the tasks and their WorkflowTransition rows; this decides
 * what to report. No model anywhere, so the digest can be incomplete but never
 * confidently wrong about what happened.
 *
 * "Since you last looked" is `TaskCompanion.lastDigestTransitionId` (design
 * 4.3): only transitions with a larger id are news. A row that was never
 * reported on falls back to its `startedAt`. The cursor moves only when a
 * client says it showed the digest (see companion-digest-reader.ts), never on
 * a read, so opening two devices cannot swallow news for one of them.
 *
 * What a person must decide is read from the task's CURRENT state, not from
 * the window: a plan waiting for approval stays in the digest until someone
 * approves it, however many times the digest is seen.
 *
 * Not responsible for wording. It returns codes; the mobile plain-language
 * table (rapitas-mobile/lib/utils/plain_reasons.dart) turns them into Japanese.
 */
import type { RepairCauseKind } from '../workflow/repair-cause';
import type {
  CompanionDigest,
  DigestCompanionRow,
  DigestDecision,
  DigestEventKind,
  DigestItem,
  DigestRepairSummary,
  DigestTaskRow,
  DigestTransitionRow,
} from './companion-digest.types';

export type * from './companion-digest.types';

/** Most events an item carries. A digest is a glance, not the timeline. */
export const MAX_DIGEST_EVENTS = 5;

/** Cause of the iteration-budget halt transition (theme-auto-run-scheduler.ts). */
const HALT_CAUSE = 'iteration_budget_halted';
/** Cause of a review hold (review-hold.ts REVIEW_HOLD_CAUSE). */
const HOLD_CAUSE = 'adversarial_review_awaiting_human';
/** Cause of a repair bounce (verify-self-repair-budget.ts REPAIR_CAUSE). */
const REPAIR_CAUSE = 'verify_repair';
/** haltReason of a review hold (review-hold.ts REVIEW_HOLD_HALT_REASON). */
const REVIEW_HOLD_HALT_REASON = 'awaiting_review_decision';

/**
 * Replanning causes: requirement replan (requirement-replan-commit.ts),
 * invalid-plan replan (retro-evidence.ts) and a human's plan revision request.
 */
const REPLAN_CAUSES = new Set([
  'requirement_evidence_replan',
  'plan_invalid_replan',
  'plan_invalid_replan_exhausted',
  'plan_revision_requested',
]);

/** Causes recorded when a person settled something the task was waiting on. */
const DECIDED_CAUSES = new Set([
  'manual_plan_approved',
  'manual_plan_rejected',
  'halt_released',
  'adversarial_review_hold_resolved',
  'question_resolved',
  'intake_question_answered',
]);

/**
 * Classify one transition for the user.
 *
 * @param t - Transition row / 遷移
 * @returns What it means / 意味の分類
 */
export function classifyTransition(t: DigestTransitionRow): DigestEventKind {
  if (t.cause === HALT_CAUSE) return 'halted';
  if (t.cause === HOLD_CAUSE) return 'review_held';
  if (t.cause === REPAIR_CAUSE) return 'repair';
  if (REPLAN_CAUSES.has(t.cause)) return 'replanned';
  if (DECIDED_CAUSES.has(t.cause)) return 'decided';
  if (t.toStatus === 'awaiting_question' && t.fromStatus !== 'awaiting_question') return 'question';
  if (t.toStatus === 'plan_created' && t.fromStatus !== 'plan_created') return 'plan_ready';
  if (t.toStatus === 'completed') return 'completed';
  return 'progress';
}

/**
 * What the user must decide on a task now, read from its current columns.
 * Order matters: a review hold is also a haltReason, and a halted task may sit
 * at plan_created, where releasing the halt comes first.
 *
 * @param task - Task row / タスク
 * @param holdReason - Why the review was held, when known / 保留の理由
 * @returns The decision, or null when nothing waits on a person / 判断、無ければ null
 */
export function decisionFor(
  task: DigestTaskRow,
  holdReason?: string | null,
): DigestDecision | null {
  if (task.status === 'done') return null;
  const link = `/tasks/${task.id}/decide`;
  const halt = task.haltReason?.trim();
  if (halt === REVIEW_HOLD_HALT_REASON && task.workflowStatus === 'verify_done') {
    return { kind: 'review_hold', ...(holdReason ? { holdReason } : {}), link };
  }
  if (halt && halt !== REVIEW_HOLD_HALT_REASON)
    return { kind: 'release_halt', haltReason: halt, link };
  if (task.workflowStatus === 'awaiting_question') return { kind: 'answer_question', link };
  if (task.workflowStatus === 'plan_created') return { kind: 'approve_plan', link };
  return null;
}

/** Whether a transition is newer than the companion row's cursor. */
function isNews(t: DigestTransitionRow, row: DigestCompanionRow): boolean {
  if (row.lastDigestTransitionId != null) return t.id > row.lastDigestTransitionId;
  return new Date(t.createdAt).getTime() >= new Date(row.startedAt).getTime();
}

function topCause(summary: DigestRepairSummary | undefined): RepairCauseKind | null {
  if (!summary) return null;
  let best: RepairCauseKind | null = null;
  for (const [cause, count] of Object.entries(summary) as [RepairCauseKind, number][]) {
    if (count > 0 && (best === null || count > summary[best])) best = cause;
  }
  return best;
}

/** Everything the builder needs, already read from the database. */
export interface DigestInput {
  companions: DigestCompanionRow[];
  tasks: DigestTaskRow[];
  transitions: DigestTransitionRow[];
  repairs: Map<number, DigestRepairSummary>;
  holdReasons: Map<number, string>;
  now: Date;
}

/**
 * Build the digest. A task appears when something happened since the cursor
 * or when it waits on a person; tasks waiting on a person come first.
 *
 * @param input - Rows read from the database / DB から読んだ行
 * @returns The digest / 要約
 */
export function buildCompanionDigest(input: DigestInput): CompanionDigest {
  const tasks = new Map(input.tasks.map((t) => [t.id, t]));
  const byTask = new Map<number, DigestTransitionRow[]>();
  for (const t of input.transitions) {
    const list = byTask.get(t.taskId) ?? [];
    list.push(t);
    byTask.set(t.taskId, list);
  }

  const items: DigestItem[] = [];
  for (const row of input.companions) {
    const task = tasks.get(row.taskId);
    // A companion whose task is gone is closed by task-deletion; skip a straggler.
    if (!task) continue;
    const news = (byTask.get(row.taskId) ?? [])
      .filter((t) => isNews(t, row))
      .sort((a, b) => a.id - b.id);
    // Blocked shell-calls (invariantViolation) carry a placeholder toStatus, so
    // they would read as a move that never happened. They still advance the cursor.
    const shown = news.filter((t) => !t.invariantViolation);
    const kinds = shown.map(classifyTransition);
    const count = (k: DigestEventKind) => kinds.filter((x) => x === k).length;
    const decision = decisionFor(task, input.holdReasons.get(task.id));
    if (!decision && shown.length === 0) continue;
    const repairSummary = input.repairs.get(task.id);
    items.push({
      taskId: task.id,
      title: task.title,
      status: task.status,
      workflowStatus: task.workflowStatus,
      haltReason: task.haltReason,
      since: {
        transitions: shown.length,
        halts: count('halted'),
        holds: count('review_held'),
        questions: count('question'),
        repairs: count('repair'),
        replans: count('replanned'),
      },
      recent: shown
        .slice(-MAX_DIGEST_EVENTS)
        .reverse()
        .map((t) => ({
          id: t.id,
          kind: classifyTransition(t),
          cause: t.cause,
          toStatus: t.toStatus,
          at: new Date(t.createdAt).toISOString(),
        })),
      repairs: {
        total: repairSummary ? Object.values(repairSummary).reduce((s, n) => s + n, 0) : 0,
        topCause: topCause(repairSummary),
      },
      decision,
      cursor: news.length > 0 ? news[news.length - 1].id : null,
    });
  }

  items.sort((a, b) => {
    if (!!a.decision !== !!b.decision) return a.decision ? -1 : 1;
    return (b.cursor ?? 0) - (a.cursor ?? 0);
  });
  return {
    items,
    decisionCount: items.filter((i) => i.decision).length,
    checkedAt: input.now.toISOString(),
  };
}
