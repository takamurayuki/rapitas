/**
 * Verification Job Runner
 *
 * Splits the implementer self-verification flow into a fast synchronous part
 * (`beginVerificationRun` — fingerprint the worktree, mint a runId, persist
 * the start event) and a slow background part (`runVerificationGateAndRecord`
 * — actually run lint/typecheck/tests/runtime and persist the finish event).
 * The POST handler (workflow-handlers-verification.ts) awaits only the fast
 * part before responding; the slow part continues after the HTTP response
 * has been sent so a client disconnect (task 899: idleTimeout=30 on
 * index.ts) can no longer lose the result. Cache-identity logic
 * (`computeVerificationCacheKey`/`buildCacheInputs`) is unchanged from the
 * prior synchronous handler; it now lives in verification-cache-key.ts.
 */
import { randomUUID } from 'crypto';
import { createLogger } from '../../config/logger';
import {
  runAutomatedVerification,
  renderVerificationMarkdown,
} from '../agents/verification/automated-verifier';
import { runGitCommand } from '../github/git-exec';
import { recordJobStart, recordJobFinish } from './verification-job-store';
import { withCommandEvidence, type CommandEvidence } from '../agents/verification/command-evidence';
import {
  buildCacheInputs,
  computeVerificationCacheKey,
  type VerificationCacheInputs,
} from './verification-cache-key';
import { runSelfVerifyDiffReview, type SelfVerifyDiffReview } from './self-verify-diff-review';

// NOTE: Cache-identity helpers moved to verification-cache-key.ts (file-size
// split); re-exported so existing importers keep working.
export { buildCacheInputs, computeVerificationCacheKey, type VerificationCacheInputs };

const log = createLogger('services:workflow:verification-job-runner');

/** Fast-path result of starting a verification job — everything the POST handler awaits. */
export interface BeginVerificationRunResult {
  runId: string;
  cacheInputsBefore: VerificationCacheInputs;
  keyBefore: string | null;
}

/**
 * Fingerprint the worktree, mint a runId, and persist the start event. This
 * is the ONLY part of a verification job the POST handler awaits — it must
 * stay fast (no gate execution) so the response returns well within
 * `index.ts`'s `idleTimeout: 30`.
 *
 * @param taskId - Task to verify. / 対象タスクID
 * @param worktreePath - Task's agent worktree. / worktreeパス
 * @returns The new job's runId and the inputs/fingerprint captured at start time. / 起動結果
 */
export async function beginVerificationRun(
  taskId: number,
  worktreePath: string,
): Promise<BeginVerificationRunResult> {
  const cacheInputsBefore = await buildCacheInputs(taskId, worktreePath);
  const keyBefore = await computeVerificationCacheKey(cacheInputsBefore);
  const runId = randomUUID();
  const revision = (
    await runGitCommand(['rev-parse', 'HEAD'], worktreePath, {
      timeoutMs: 5_000,
      skipLog: true,
    }).catch(() => '')
  ).trim();
  await recordJobStart(taskId, runId, keyBefore, {
    operation: `POST /workflow/tasks/${taskId}/run-verification`,
    worktreePath,
    revision: revision || null,
  });
  return { runId, cacheInputsBefore, keyBefore };
}

/**
 * Run the automated verification gate on the task's worktree and persist the
 * finish event. Called WITHOUT being awaited by the POST handler — it keeps
 * running after the HTTP response has been sent, so a client disconnect
 * cannot lose the result. Never throws: any failure is captured and recorded
 * as a `failed` finish event instead.
 *
 * @param taskId - Task to verify. / 対象タスクID
 * @param runId - Job identifier from {@link beginVerificationRun}. / ジョブID
 * @param worktreePath - Task's agent worktree. / worktreeパス
 * @param cacheInputsBefore - Inputs captured at start time. / 開始時点の入力
 * @param keyBefore - Fingerprint captured at start time. / 開始時点の指紋
 */
export async function runVerificationGateAndRecord(
  taskId: number,
  runId: string,
  worktreePath: string,
  cacheInputsBefore: VerificationCacheInputs,
  keyBefore: string | null,
): Promise<void> {
  const startedAt = Date.now();
  const commands: CommandEvidence[] = [];
  try {
    const verificationOptions = {
      planContent: cacheInputsBefore.planContent,
      preferredBaseBranch: cacheInputsBefore.preferredBaseBranch,
      taskId,
      requireTests: cacheInputsBefore.requireTests,
      acceptanceCriteria: cacheInputsBefore.acceptanceCriteria,
      taskText: cacheInputsBefore.taskText,
    };
    const result = await withCommandEvidence(commands, () =>
      runAutomatedVerification(worktreePath, verificationOptions),
    );
    log.info(
      { taskId, runId, ok: result.ok, checks: result.checks.length },
      '[self-verification] gate run complete',
    );
    const markdown = renderVerificationMarkdown(result);
    const durationMs = Date.now() - startedAt;

    // Re-derived AFTER the gate ran (which can take minutes — the
    // runtime-smoke stage alone is ~130s) so an edit made WHILE verification
    // was running invalidates the result instead of recording a now-stale
    // pass. Re-fetched from the DB/workflow-file store, not just re-hashing
    // the SAME in-memory `cacheInputsBefore` object — a plan.md/acceptance
    // criteria/base-branch change mid-run would otherwise go undetected since
    // those variables never change on their own (task 897 supervisor
    // finding: rehashing unchanged in-memory values cannot detect concurrent
    // DB-side input changes).
    const cacheInputsAfter = await buildCacheInputs(taskId, worktreePath);
    const keyAfter = await computeVerificationCacheKey(cacheInputsAfter);
    if (!keyBefore || !keyAfter || keyBefore !== keyAfter) {
      await recordJobFinish(taskId, runId, {
        status: 'completed',
        ok: false,
        unverifiable: true,
        summary:
          'Verification inputs changed or could not be identified; verification is unconfirmed.',
        markdown:
          '# Verification unconfirmed\nInputs changed or could not be identified during this run.\n\n' +
          markdown,
        durationMs,
        fingerprintAtFinish: keyAfter,
        commands,
      });
      return;
    }
    // Only a run whose inputs held still is reviewed: the jury then judges the
    // exact diff the gate measured, and its verdict can be reused at save time.
    const diffReview: SelfVerifyDiffReview = await runSelfVerifyDiffReview({
      taskId,
      worktreePath,
      gateOk: result.ok,
    });
    await recordJobFinish(taskId, runId, {
      diffReview,
      status: 'completed',
      ok: result.ok,
      unverifiable: false,
      checks: result.checks,
      summary: result.summary,
      markdown,
      durationMs,
      fingerprintAtFinish: keyAfter,
      commands,
    });
  } catch (err) {
    log.warn({ err, taskId, runId }, '[self-verification] gate run failed');
    await recordJobFinish(taskId, runId, {
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startedAt,
      commands,
    }).catch((finishErr) => {
      log.warn(
        { err: finishErr, taskId, runId },
        '[self-verification] failed to record job failure',
      );
    });
  }
}
