/**
 * verify-tamper-verdict
 *
 * The read-side helpers of the verify→implement self-repair loop: whether a
 * verdict is tamper-only (not repairable), which status re-runs the
 * implementer, whether a fresh rejection vetoes completion, and the shared
 * escalate-and-record step of every repair cutoff. Split out of
 * verify-self-repair.ts (file-size limit, task 1602), which re-exports them.
 * Not responsible for deciding when to bounce.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { recordTransition } from './transition-recorder';
import { VERIFY_NON_CONVERGENCE_CAUSE } from './blocked-task-policy';
import { REPAIR_CAUSE } from './verify-self-repair-budget';
import { INVARIANT_NON_CONVERGENCE_CAUSE } from './verify-invariant-repair';

const log = createLogger('workflow:verify-self-repair');

/** Gates the overall verdict ignores, so they never count as "something else failed". */
const NON_GATING_CHECKS = new Set(['acceptance', 'attribution']);

/**
 * A verdict whose ONLY failing gate is the anti-tampering tripwire. The
 * implementer cannot make a protected path unprotected, so bouncing it back
 * repeats the identical failure: task 867 (2026-09-06) looped 8 times over
 * three hours on `tamper=NG(1)` with lint/type/test/format all green.
 *
 * NOTE: task 1602 — this used to list the gates that count as another
 * failure, so every gate added later (generated-sync, file-size, secret, …)
 * read as tamper-only and cut a fixable task off. Now any `name=NG` other
 * than tamper counts, except the advisory acceptance / attribution checks.
 *
 * @param reason - Verdict summary as recorded on the verify transition / 判定要約
 * @returns True when tamper is the sole failing gate / tamper 単独失敗なら true
 */
export function isTamperOnlyVerdict(reason: string): boolean {
  if (!/\btamper=NG/.test(reason)) return false;
  for (const m of reason.matchAll(/\b([a-z][a-z-]*)=NG\b/g)) {
    const name = m[1]!;
    if (name !== 'tamper' && !NON_GATING_CHECKS.has(name)) return false;
  }
  return true;
}

/**
 * Resolve the implementer's ENTRY status for a task: `plan_approved` when a
 * plan.md exists (standard/comprehensive), else `research_done` (lightweight) —
 * matching buildTransitions(). Setting workflowStatus to this makes the runner
 * re-run implement → verify.
 *
 * @param taskId - Task id / タスクID
 * @returns The status to bounce to / 戻す先のstatus
 */
export async function resolveImplementEntryStatus(
  taskId: number,
): Promise<'plan_approved' | 'research_done'> {
  const plan = await prisma.workflowFile.findFirst({
    where: { taskId, fileType: 'plan' },
    select: { id: true },
  });
  return plan ? 'plan_approved' : 'research_done';
}

/**
 * Escalate a task whose repair loop is cut off and record the cutoff
 * transition — the common tail of every cutoff in attemptVerifyRepair.
 * Recorded LAST so it is the latest transition: hasFreshVerifyRejection reads
 * only the newest row, and the cutoff must veto the executor epilogue.
 *
 * @param p - Task, status, escalation text, cause and metadata / 打ち切りの内容
 */
export async function recordRepairCutoff(p: {
  taskId: number;
  currentStatus: string | null;
  detail: string;
  cause: string;
  metadata: Record<string, unknown>;
}): Promise<void> {
  const { taskId, currentStatus } = p;
  const taskRow = await prisma.task
    .findUnique({ where: { id: taskId }, select: { title: true, themeId: true } })
    .catch(() => null);
  try {
    // Dynamic import: keeps the escalation module out of this module's static graph.
    const { escalateBlockedTask } = await import('./blocked-task-escalation');
    await escalateBlockedTask(
      prisma,
      { id: taskId, title: taskRow?.title ?? `#${taskId}`, themeId: taskRow?.themeId ?? null },
      'verify_no_convergence',
      Date.now(),
      p.detail,
      currentStatus ?? null,
    );
  } catch (err) {
    log.warn({ err, taskId, cause: p.cause }, '[verify-repair] Cutoff escalation failed');
  }
  await recordTransition({
    taskId,
    fromStatus: currentStatus ?? null,
    toStatus: currentStatus ?? 'blocked',
    actor: 'system',
    cause: p.cause,
    phase: 'verify',
    metadata: p.metadata,
  }).catch((err) =>
    log.warn({ err, taskId, cause: p.cause }, '[verify-repair] Failed to record cutoff transition'),
  );
}

/**
 * Whether the most recent transition for this task is a fresh verify-phase
 * rejection (bounce / adversarial-review FAIL / non-convergence cutoff /
 * failed PR-creation — see rejectionCauses). The CLI executor's epilogue runs
 * AFTER the agent's HTTP verify.md save, so a bounce recorded during that save
 * must veto commit/PR/complete — without this, task 485's epilogue completed
 * seconds after the jury bounced it. The freshness window guards against stale
 * rows from a save that bypassed the HTTP handler.
 *
 * @param taskId - Task id / タスクID
 * @param windowMs - Max age for the rejection to count. / 有効期間
 * @returns True when completion must be skipped. / 完了処理を止めるべきか
 */
export async function hasFreshVerifyRejection(
  taskId: number,
  windowMs = 30 * 60_000,
): Promise<boolean> {
  const last = await prisma.workflowTransition
    .findFirst({
      where: { taskId },
      orderBy: { createdAt: 'desc' },
      select: { cause: true, createdAt: true },
    })
    .catch(() => null);
  if (!last) return false;
  // NOTE: VERIFY_NON_CONVERGENCE_CAUSE / INVARIANT_NON_CONVERGENCE_CAUSE also
  // count — a cutoff task (619, 794) must not be completed by a late epilogue
  // either. 'verify_pr_not_created' too: the HTTP gate already failed to
  // produce a PR, so without it here the epilogue retries the same doomed PR
  // attempt (task 673).
  const rejectionCauses = [
    REPAIR_CAUSE,
    'adversarial_review_failed',
    VERIFY_NON_CONVERGENCE_CAUSE,
    INVARIANT_NON_CONVERGENCE_CAUSE,
    'verify_pr_not_created',
    // A review hold owns the next step until a human resolves it.
    'adversarial_review_awaiting_human',
  ];
  if (!rejectionCauses.includes(last.cause)) return false;
  return Date.now() - last.createdAt.getTime() <= windowMs;
}
