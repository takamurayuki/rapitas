/**
 * Dry-Run Orchestrator
 *
 * Runs the SAME verification logic the production verify pipeline runs — the
 * deterministic gate, the completion gate, and the adversarial jury — against
 * a task's worktree WITHOUT triggering any of the side effects that normally
 * follow a passing verdict (commit, PR, merge, worktree cleanup, status
 * transition, notification). Not responsible for HTTP concerns or for
 * resolving the task/worktree — callers pass in already-resolved inputs.
 *
 * This module MUST NOT import `performAutoCommitAndPR`, `recordTransition`,
 * `attemptVerifyRepair`, or any Prisma mutation of `task` — those live only in
 * the production verify pipeline (routes/workflow/handlers/file-save/) and
 * pulling them in here would let a dry run mutate real state.
 */
import { runAutomatedVerification } from '../agents/verification/automated-verifier';
import type { VerificationResult } from '../agents/verification/automated-verifier';
import { looksLikeBugFixTask } from '../agents/verification/automated-verifier';
import { evaluateCompletionGate } from './completion-gate';
import type { CompletionGateResult } from './completion-gate';
import {
  reviewDiffAdversarially,
  type DiffReviewResult,
} from '../agents/verification/adversarial-diff-review';
import { execGitReadonly } from '../agents/orchestrator/git-operations/core/git-exec';
import { appendEvent } from '../memory/timeline';
import { createLogger } from '../../config/logger';

const log = createLogger('workflow:dry-run-orchestrator');

/**
 * Operations a production verify run may perform that a dry run never does.
 * Always the same 7 codes regardless of the dry run's outcome — none of them
 * are ever physically reachable from this module's code path. Semantic codes,
 * not display text: the frontend localizes each via
 * `workflow.dryRun.skippedOperations.<code>` (same code→i18n-key pattern as
 * BLOCKED_CAUSE_I18N_KEYS in workflow-blocked-cause.ts).
 */
export const DRY_RUN_SKIPPED_OPERATIONS: readonly string[] = [
  'commit',
  'push',
  'pr_creation',
  'merge',
  'worktree_cleanup',
  'status_transition',
  'notification',
];

export interface DryRunVerificationParams {
  taskId: number;
  worktreePath: string;
  preferredBaseBranch: string | null;
  planContent: string | null;
  verifyContent: string | null;
  taskTitle: string;
  taskDescription: string | null;
  acceptanceCriteria: string[];
}

export interface DryRunVerificationResult {
  /** True when the gate passed AND completion would be allowed AND the jury did not fail. */
  ok: boolean;
  gate: VerificationResult;
  completionGate: CompletionGateResult;
  jury: DiffReviewResult;
  /** The base branch's HEAD commit SHA at dry-run time, or null when it could not be resolved. */
  baseBranchSha: string | null;
  preferredBaseBranch: string | null;
  skippedOperations: readonly string[];
  /** TimelineEvent id — usable as this report's identifier for history/drift lookups. */
  reportId: number;
}

/** Read the HEAD SHA of a branch, trying the local ref then `origin/<branch>`. Fail-open: null on any error. */
async function resolveBaseBranchSha(
  worktreePath: string,
  preferredBaseBranch: string | null,
): Promise<string | null> {
  if (!preferredBaseBranch) return null;
  for (const ref of [preferredBaseBranch, `origin/${preferredBaseBranch}`]) {
    try {
      const { stdout } = await execGitReadonly(`git rev-parse ${ref}`, { cwd: worktreePath });
      const sha = stdout.trim();
      if (sha) return sha;
    } catch {
      // Try the next ref; a missing local branch or unfetched remote is normal.
    }
  }
  return null;
}

/**
 * Run every verification stage (gate → completion gate → jury) against a
 * task's worktree, without invoking any production side effect, and record
 * the result as a `dry_run_executed` timeline event.
 *
 * @param params - Task/worktree context and already-resolved task text. / タスク・worktree・タスク本文一式
 * @returns The aggregated dry-run report, including the timeline event id as `reportId`. / 集計レポート
 */
export async function runDryRunVerification(
  params: DryRunVerificationParams,
): Promise<DryRunVerificationResult> {
  const {
    taskId,
    worktreePath,
    preferredBaseBranch,
    planContent,
    verifyContent,
    taskTitle,
    taskDescription,
    acceptanceCriteria,
  } = params;
  const taskText = `${taskTitle}\n${taskDescription ?? ''}`;

  const [gate, completionGate, jury, baseBranchSha] = await Promise.all([
    runAutomatedVerification(worktreePath, {
      planContent: planContent ?? undefined,
      preferredBaseBranch,
      taskId,
      requireTests: looksLikeBugFixTask(taskText),
      acceptanceCriteria: acceptanceCriteria.length > 0 ? acceptanceCriteria : undefined,
      taskText: taskText || undefined,
    }),
    evaluateCompletionGate(worktreePath, verifyContent, preferredBaseBranch),
    reviewDiffAdversarially({ taskId, worktreePath, suppressEventLog: true }),
    resolveBaseBranchSha(worktreePath, preferredBaseBranch),
  ]);

  const ok = gate.ok && completionGate.allow && jury.verdict !== 'fail';

  const { id: reportId } = await appendEvent({
    eventType: 'dry_run_executed',
    actorType: 'user',
    correlationId: `task-${taskId}`,
    payload: {
      taskId,
      ok,
      gate: { ok: gate.ok, summary: gate.summary, checks: gate.checks },
      completionGate,
      jury: {
        verdict: jury.verdict,
        severity: jury.severity,
        reasons: jury.reasons,
        judged: jury.judged,
      },
      baseBranchSha,
      preferredBaseBranch,
      skippedOperations: DRY_RUN_SKIPPED_OPERATIONS,
    },
  });

  log.info({ taskId, ok, reportId }, '[dry-run] verification complete');

  return {
    ok,
    gate,
    completionGate,
    jury,
    baseBranchSha,
    preferredBaseBranch,
    skippedOperations: DRY_RUN_SKIPPED_OPERATIONS,
    reportId,
  };
}
