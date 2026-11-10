/**
 * verifier-completion-check
 *
 * The single "may this task be completed / landed now?" check for every
 * automatic path that completes a task outside the verify.md save gates
 * themselves — the runner's landed-PR recovery, the merge watcher's merge /
 * CI-green completion and merged-PR recovery, the blocked-task PR retry and
 * evidence correction, the split parent's finalization, and publication after
 * a human override. Not responsible for judging the verifier
 * (verifier-eligibility does that) or for the completion write.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { overrideTargetDrift, parseHoldMetadata, readOverrideTarget } from './review-hold-records';

const log = createLogger('workflow:verifier-completion-check');

/** Which completion path is asking, for the hold record. */
export type CompletionCheckSource =
  | 'runner_recovery'
  | 'merge_watcher'
  | 'merge_recovery'
  | 'blocked_pr_retry'
  | 'blocked_evidence'
  | 'subtask_parent'
  | 'override_publish';

/**
 * Whether a resolution record is a human override of an ineligible-verifier
 * hold that still covers the task as it is now: the verify.md version,
 * publish worktree and git tree the override was bound to must all be current.
 * An override recorded without that binding is not honoured.
 */
async function overrideStillCovers(
  taskId: number,
  source: CompletionCheckSource,
  raw: unknown,
): Promise<boolean> {
  const meta = parseHoldMetadata(raw);
  if (meta.action !== 'override' || meta.holdReason !== 'ineligible_verifier') return false;
  const target = readOverrideTarget(meta);
  const drift = target
    ? await overrideTargetDrift(taskId, target)
    : '上書きの対象が記録されていません';
  if (drift) {
    log.warn(
      { taskId, source, drift },
      '[completion-check] Verifier override no longer covers this task — judging again',
    );
    return false;
  }
  return true;
}

/**
 * Whether the newest verify verdict is confirmed to come from an eligible
 * verifier (or no verifier run exists), judged again now that the run has
 * ended. Refuses, in this order:
 *  - an open deferral (the newest verify save withheld completion because the
 *    model was not reported; that save skipped commit/PR);
 *  - a current review hold (without a second hold write — tick-driven callers
 *    ask every minute). The current hold wins over any earlier override;
 *  - then, unless the newest record is a human override of the ineligible-
 *    verifier hold whose bound target is still current, a verifier that is
 *    not confirmed eligible (held for a human, best-effort).
 * A failure to read the verify records, the override target or the verifier
 * run refuses (readReviewHold itself never throws; it reports "not held").
 *
 * @param taskId - Task about to be completed / 完了させようとしているタスクID
 * @param source - Completion path asking / 問い合わせ元の完了経路
 * @param opts.fromStatus - Workflow status the caller observed, for the hold CAS (default verify_done) / 呼び出し元が見た状態
 * @returns True only when completion may proceed / 完了してよい場合のみ true
 */
export async function verifierConfirmedForCompletion(
  taskId: number,
  source: CompletionCheckSource,
  opts: { fromStatus?: string } = {},
): Promise<boolean> {
  try {
    const { VERIFIER_ELIGIBILITY_DEFERRED_CAUSE, holdIfVerifierIneligible } =
      await import('./verifier-eligibility');
    const { REVIEW_HOLD_CAUSE, REVIEW_HOLD_RESOLVED_CAUSE, readReviewHold } =
      await import('./review-hold');
    // NOTE: Hold creations are part of the search — a re-hold written after an
    // override (publication's binding mismatch) makes that override stale.
    const latest = await prisma.workflowTransition.findFirst({
      where: {
        taskId,
        cause: {
          in: [
            'file_saved:verify',
            VERIFIER_ELIGIBILITY_DEFERRED_CAUSE,
            REVIEW_HOLD_CAUSE,
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
    if (await readReviewHold(taskId)) return false;
    if (
      latest?.cause === REVIEW_HOLD_RESOLVED_CAUSE &&
      (await overrideStillCovers(taskId, source, latest.metadata))
    ) {
      return true;
    }
    const gate = await holdIfVerifierIneligible({
      taskId,
      source,
      phase: 'after_run',
      ...(opts.fromStatus ? { fromStatus: opts.fromStatus } : {}),
    });
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
