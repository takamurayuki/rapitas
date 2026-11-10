/**
 * verifier-completion-check
 *
 * The single "may this verify_done task be completed / landed now?" check for
 * the paths that complete a task outside the verify.md save itself — the
 * runner's landed-PR recovery, the merge watcher's merge / CI-green completion,
 * and the watcher's merged-PR recovery. Not responsible for judging the
 * verifier (verifier-eligibility does that) or for the completion write.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';

const log = createLogger('workflow:verifier-completion-check');

/**
 * Whether a hold-resolution record is a human override of an
 * ineligible-verifier hold.
 */
function isVerifierOverride(raw: unknown): boolean {
  let m: unknown = raw;
  if (typeof raw === 'string') {
    try {
      m = JSON.parse(raw);
    } catch {
      return false;
    }
  }
  const meta = (m && typeof m === 'object' ? m : {}) as Record<string, unknown>;
  return meta.action === 'override' && meta.holdReason === 'ineligible_verifier';
}

/** Which completion path is asking, for the hold record. */
export type CompletionCheckSource = 'runner_recovery' | 'merge_watcher' | 'merge_recovery';

/**
 * Whether the newest verify verdict is confirmed to come from an eligible
 * verifier (or no verifier run exists), judged again now that the run has
 * ended. An open deferral — the newest verify save withheld completion because
 * the model was not reported — also refuses: that save skipped the commit/PR
 * stage, so the PR on record may not carry the verified work. Any read failure
 * refuses. An ineligible / unverified verifier is also held for a human
 * (best-effort; refusing is the stop either way). A task already on a review
 * hold refuses without a second hold write (tick-driven callers ask every
 * minute); a human override of the ineligible-verifier hold for the newest
 * verdict allows completion.
 *
 * @param taskId - Task about to be completed / 完了させようとしているタスクID
 * @param source - Completion path asking / 問い合わせ元の完了経路
 * @returns True only when completion may proceed / 完了してよい場合のみ true
 */
export async function verifierConfirmedForCompletion(
  taskId: number,
  source: CompletionCheckSource,
): Promise<boolean> {
  try {
    const { VERIFIER_ELIGIBILITY_DEFERRED_CAUSE, holdIfVerifierIneligible } =
      await import('./verifier-eligibility');
    const { REVIEW_HOLD_RESOLVED_CAUSE, readReviewHold } = await import('./review-hold');
    const latest = await prisma.workflowTransition.findFirst({
      where: {
        taskId,
        cause: {
          in: [
            'file_saved:verify',
            VERIFIER_ELIGIBILITY_DEFERRED_CAUSE,
            REVIEW_HOLD_RESOLVED_CAUSE,
          ],
        },
      },
      orderBy: { createdAt: 'desc' },
      select: { cause: true, metadata: true },
    });
    if (latest?.cause === VERIFIER_ELIGIBILITY_DEFERRED_CAUSE) {
      log.warn(
        { taskId, source },
        '[completion-check] Verify completion still deferred — refusing',
      );
      return false;
    }
    // A human override of THIS verdict's ineligible-verifier hold is the
    // decision; re-judging would re-hold the task the human just released.
    // Any other resolution (accept, a jury-dispute override) is judged as usual.
    if (latest?.cause === REVIEW_HOLD_RESOLVED_CAUSE && isVerifierOverride(latest.metadata)) {
      return true;
    }
    // Already held for a human: refuse without re-writing the hold each tick.
    if (await readReviewHold(taskId)) return false;
    const gate = await holdIfVerifierIneligible({ taskId, source, phase: 'after_run' });
    if (gate.outcome === 'ok') return true;
    log.warn(
      { taskId, source, outcome: gate.outcome, status: gate.judgement.status },
      '[completion-check] Verifier not confirmed eligible — refusing completion',
    );
    return false;
  } catch (err) {
    log.warn({ err, taskId, source }, '[completion-check] Eligibility re-check failed — refusing');
    return false;
  }
}
