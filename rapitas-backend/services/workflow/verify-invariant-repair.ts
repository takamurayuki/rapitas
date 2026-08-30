/**
 * verify-invariant-repair
 *
 * Connects `checkWorkflowInvariants` violations to the verify self-repair
 * loop (task 755): the check was logged on every `file_saved:verify`
 * transition but never fed into any corrective action, so the identical
 * violation code could recur cycle after cycle unnoticed (task #572: the
 * same invariantViolation on both `in_progress→verify_done` transitions,
 * 2h43m apart). A FIRST-time violation alone must not newly block a task
 * that previously passed with a violation logged and no ill effect — only a
 * RECURRING code (2+ cycles) cuts the loop off. Not responsible for the
 * acceptance-criteria non-convergence cutoff (see verify-self-repair.ts).
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { recordTransition } from './transition-recorder';
import { checkWorkflowInvariants, type Violation } from './workflow-invariants';

const log = createLogger('workflow:verify-invariant-repair');

/**
 * WorkflowTransition.cause recorded when the SAME `checkWorkflowInvariants`
 * violation code recurs across 2+ repair cycles — the same "flagged twice,
 * never fixed" shape as `VERIFY_NON_CONVERGENCE_CAUSE` (verify-self-repair.ts),
 * but for state invariants (missing_file / status_mismatch /
 * incomplete_subtasks) instead of acceptance-criteria text.
 */
export const INVARIANT_NON_CONVERGENCE_CAUSE = 'verify_invariant_no_convergence';

/**
 * Detect a non-converging INVARIANT violation across repair cycles: the same
 * violation `code` appearing in an earlier `invariantViolation` transition
 * within the current repair window as in the current check. FAIL OPEN — an
 * unidentifiable window must never stop a progressing task.
 *
 * @param taskId - Task id / タスクID
 * @param currentCodes - Violation codes just detected by checkWorkflowInvariants. / 今回検出したcode一覧
 * @param windowStart - Start of the current repair window (see resolveRepairWindowStart). / 修復ウィンドウ起点
 * @returns Cutoff verdict + the codes that recurred. / 収束判定と再発codeの一覧
 */
async function detectInvariantNonConvergence(
  taskId: number,
  currentCodes: string[],
  windowStart: Date | null,
): Promise<{ cutoff: boolean; recurredCodes: string[] }> {
  try {
    if (currentCodes.length === 0) return { cutoff: false, recurredCodes: [] };
    const rows = await prisma.workflowTransition.findMany({
      where: {
        taskId,
        invariantViolation: true,
        ...(windowStart ? { createdAt: { gt: windowStart } } : {}),
      },
      select: { invariantMessage: true },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    const currentSet = new Set(currentCodes);
    const recurredCodes = new Set<string>();
    for (const row of rows) {
      const msg = row.invariantMessage ?? '';
      for (const code of currentSet) {
        // invariantMessage is `code:message` segments joined by ' | ' —
        // match on the code prefix only (message text may vary run to run).
        if (msg.split(' | ').some((seg) => seg.split(':')[0] === code)) {
          recurredCodes.add(code);
        }
      }
    }
    return { cutoff: recurredCodes.size > 0, recurredCodes: [...recurredCodes] };
  } catch (err) {
    log.warn(
      { err, taskId },
      '[verify-invariant-repair] Non-convergence check failed — failing open (no cutoff)',
    );
    return { cutoff: false, recurredCodes: [] };
  }
}

/**
 * Check `checkWorkflowInvariants` for the task and, when a violation code
 * recurs across 2+ repair cycles, escalate + record a terminal
 * {@link INVARIANT_NON_CONVERGENCE_CAUSE} transition — mirroring the
 * `repair.cutoffRecorded` pattern already used for acceptance-criteria
 * non-convergence, so callers skip their own duplicate transition record.
 *
 * @param taskId - Task being verified / 検証対象タスク
 * @param currentStatus - workflowStatus at the time this repair attempt started / 現在のstatus
 * @param reason - The repair-triggering reason from the caller (for metadata only). / 差し戻し理由
 * @param windowStart - Start of the current repair window (shared with the caller's own count). / 修復ウィンドウ起点
 * @returns True when a cutoff transition was recorded (caller must return `{bounced:false, cutoffRecorded:true}`). / cutoffを記録したか
 */
export async function attemptInvariantCutoff(
  taskId: number,
  currentStatus: string | null,
  reason: string,
  windowStart: Date | null,
): Promise<boolean> {
  const violations = await checkWorkflowInvariants(taskId).catch((err): Violation[] => {
    log.warn(
      { err, taskId },
      '[verify-invariant-repair] checkWorkflowInvariants failed — failing open',
    );
    return [];
  });
  if (violations.length === 0) return false;

  const codes = violations.map((v) => v.code);
  const verdict = await detectInvariantNonConvergence(taskId, codes, windowStart);
  if (!verdict.cutoff) return false;

  const violationSummary = violations.map((v) => `${v.code}:${v.message}`).join(' | ');
  const detail = `不変条件違反(${verdict.recurredCodes.join(', ')})が複数回の検証サイクルで再発しています。状態不整合または検証ロジックの見直しが必要です。`;
  const taskRow = await prisma.task
    .findUnique({ where: { id: taskId }, select: { title: true, themeId: true } })
    .catch(() => null);
  try {
    // Dynamic import: keeps the escalation module out of this module's static graph.
    const { escalateBlockedTask } = await import('./blocked-task-escalation');
    await escalateBlockedTask(
      prisma,
      { id: taskId, title: taskRow?.title ?? `#${taskId}`, themeId: taskRow?.themeId ?? null },
      // Reuses the existing 'verify_no_convergence' reason — no
      // violation-specific BlockedExclusionReason exists, and the shape
      // ("repair loop not converging") is identical.
      'verify_no_convergence',
      Date.now(),
      detail,
    );
  } catch (err) {
    log.warn({ err, taskId }, '[verify-invariant-repair] Escalation failed');
  }
  await recordTransition({
    taskId,
    fromStatus: currentStatus ?? null,
    toStatus: currentStatus ?? 'blocked',
    actor: 'system',
    cause: INVARIANT_NON_CONVERGENCE_CAUSE,
    phase: 'verify',
    metadata: { recurredCodes: verdict.recurredCodes, reason },
    invariantViolation: true,
    invariantMessage: violationSummary,
  }).catch((err) =>
    log.warn(
      { err, taskId },
      '[verify-invariant-repair] Failed to record invariant non-convergence transition',
    ),
  );
  log.warn(
    { taskId, recurredCodes: verdict.recurredCodes },
    '[verify-invariant-repair] Invariant violation not converging — cutting off (caller should block)',
  );
  return true;
}
