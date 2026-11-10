/**
 * workflow-reconciler-blocked-evidence
 *
 * Reconciler pass 1 (order contract: workflow-reconciler-blocked.ts): correct
 * blocked tasks whose work provably landed to done instead of re-running them.
 * The correction is a completion, so it passes the common completion check
 * (verifier-completion-check.ts) like every other automatic completion path.
 * Not responsible for the retry / escalation passes.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { recordTransition } from './transition-recorder';
import { resolveBlockedTaskEvidence } from './blocked-task-evidence';
import { resolveAutomationPolicy } from './automation-policy';
import { verifierConfirmedForCompletion } from './verifier-completion-check';
import {
  findBlockedCandidates,
  hasLiveExecution,
  resolveCwdForTask,
} from './workflow-reconciler-blocked-candidates';

const log = createLogger('workflow-reconciler');

/** Transition cause for an evidence-based done correction. */
export const BLOCKED_EVIDENCE_DONE_CAUSE = 'blocked_evidence_done';

/**
 * Correct blocked tasks with decisive success evidence to done — the machine
 * version of what the operator did by hand for 6 tasks on 2026-08-16: check
 * the PR, and when the work provably landed, finalize instead of re-running
 * (a blind retry would open a duplicate PR; not retrying would discard a
 * finished implementation).
 *
 * Includes `awaiting_question` tasks ON PURPOSE: correction is NOT a blind
 * retry — it never resets workflowStatus to draft and never touches the
 * pending question, it only finalizes status directly (observed: #578→PR376 /
 * #576→PR381 were awaiting_question AND already succeeded). Ambiguous
 * evidence corrects nothing (fail-closed).
 *
 * @param nowMs - Current time (ms). / 現在時刻
 * @returns Number of tasks corrected to done. / 是正件数
 */
export async function correctBlockedByEvidence(nowMs: number): Promise<number> {
  const tasks = await findBlockedCandidates(nowMs);
  let corrected = 0;
  for (const t of tasks) {
    // A live agent means it's not really stuck — skip.
    if (await hasLiveExecution(t.id)) continue;

    const evidence = await resolveBlockedTaskEvidence(prisma, t.id, resolveCwdForTask(t));
    if (!evidence.isSuccess) continue;

    // Local PR rows cannot prove a required remote merge. The authoritative
    // merge watcher owns that completion; an unreadable policy also withholds it.
    const policy = await resolveAutomationPolicy(prisma, t.id).catch(() => null);
    if (!policy || policy.autoMergePR) continue;
    // PR evidence says the work landed, not that its verify verdict counts.
    if (!(await verifierConfirmedForCompletion(t.id, 'blocked_evidence'))) continue;

    await prisma.task
      .update({
        where: { id: t.id },
        data: {
          status: 'done',
          workflowStatus: 'completed',
          completedAt: t.completedAt ?? new Date(),
          updatedAt: new Date(),
        },
      })
      .catch(() => {});
    await recordTransition({
      taskId: t.id,
      fromStatus: t.workflowStatus,
      toStatus: 'completed',
      actor: 'system',
      cause: BLOCKED_EVIDENCE_DONE_CAUSE,
      metadata: { source: evidence.source, prState: evidence.prState ?? null },
    }).catch(() => {});
    corrected++;
    log.info(
      { taskId: t.id, source: evidence.source, prState: evidence.prState },
      '[reconciler] Corrected blocked task with success evidence -> done (no re-run)',
    );
  }
  return corrected;
}
