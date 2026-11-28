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
 * prior synchronous handler and now lives in verification-cache-key.ts. Both
 * parts also write the cross-process activity marker (self-verification-activity)
 * that agent watchdogs read so they do not kill an agent waiting on the gate.
 */
import { randomUUID } from 'crypto';
import { createLogger } from '../../config/logger';
import {
  runAutomatedVerification,
  renderVerificationMarkdown,
} from '../agents/verification/automated-verifier';
import { runGitCommand } from '../github/git-exec';
import {
  buildCacheInputs,
  computeVerificationCacheKey,
  type VerificationCacheInputs,
} from './verification-cache-key';
import { recordJobStart, recordJobFinish } from './verification-job-store';
import { withCommandEvidence, type CommandEvidence } from '../agents/verification/command-evidence';
import type { VerificationCheck } from '../agents/verification/automated-verifier';
import { getActivityStore, type ActivityOutcome } from './self-verification-activity';

// NOTE: Re-exported so existing importers and mock.module of this file keep working after the split.
export {
  buildCacheInputs,
  computeVerificationCacheKey,
  type VerificationCacheInputs,
} from './verification-cache-key';

const log = createLogger('services:workflow:verification-job-runner');

/**
 * Write a marker without ever failing the job: a lost marker only means a
 * watchdog may stop waiting early, which is the pre-1582 behaviour.
 */
function safeMark(action: string, fn: () => void): void {
  try {
    fn();
  } catch (err) {
    log.warn({ err, action }, '[self-verification] activity marker write failed');
  }
}

/** Passed/failed counts over the checks that actually ran. */
function countChecks(checks: Pick<VerificationCheck, 'ran' | 'ok'>[]): {
  passed: number;
  failed: number;
} {
  return {
    passed: checks.filter((c) => c.ran && c.ok).length,
    failed: checks.filter((c) => c.ran && !c.ok).length,
  };
}

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
  // NOTE: Lets agent watchdogs in any process see the run (task 1582) — the
  // waiting CLI prints nothing while the gate runs and was killed as hung.
  safeMark('start', () => getActivityStore().markStarted({ runId, taskId, worktreePath }));
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
  // Default covers the crash path; overwritten once the gate produced a verdict.
  let outcome: ActivityOutcome = { ok: false, unverifiable: true, passed: 0, failed: 0 };
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
    const counts = countChecks(result.checks);
    if (!keyBefore || !keyAfter || keyBefore !== keyAfter) {
      outcome = { ok: false, unverifiable: true, ...counts };
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
    outcome = { ok: result.ok, unverifiable: false, ...counts };
    await recordJobFinish(taskId, runId, {
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
  } finally {
    safeMark('finish', () =>
      getActivityStore().markFinished({ runId, taskId, worktreePath, ...outcome }),
    );
  }
}
