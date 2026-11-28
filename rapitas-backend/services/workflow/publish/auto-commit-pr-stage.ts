/**
 * Auto-commit — PR creation stage
 *
 * Publishes the verified commit: reuses the task's open PR or creates one,
 * under the per-task PR-creation lock. Not responsible for verification, base
 * sync or merge.
 *
 * NOTE: The route-layer helpers are injected — services must not import routes
 * (scripts/import-graph/check-import-graph.cjs).
 */
import { prisma } from '../../../config';
import { createLogger } from '../../../config/logger';
import type { AgentOrchestrator } from '../../agents/agent-orchestrator';
import { FOREIGN_PR_ERROR_PREFIX } from '../../agents/orchestrator/git-operations/pr/branch-pr-ops';
import { readyPullRequest } from '../../agents/orchestrator/git-operations/pr/pr-draft-ops';
import { linkAutoCreatedPr } from '../../github/pr-link';
import {
  findOpenPrForTask,
  claimPrCreationLock,
  releasePrCreationLock,
} from '../../github/pr-duplicate-guard';
import { notify } from '../auto-merge-notify';
import { PR_CREATION_IN_FLIGHT_ERROR } from '../pr-in-flight-wait';
import { PUBLICATION_CANCELLED_ERROR, publicationAborted } from '../publication-cancellation-guard';
import type { AutoCommitPRResult } from './workflow-auto-commit-types';

const log = createLogger('routes:workflow:auto-commit');

/** Route-layer helpers this stage calls. */
export interface PrStageDeps {
  countCommitsAhead: (gitCwd: string, targetBranch: string) => Promise<number | null>;
  isNoChangeCompletion: (input: { errorBlob: string; filesChanged: number | undefined }) => boolean;
  pushExistingPrBranch: (
    gitCwd: string,
    branch: string,
  ) => Promise<{ success: boolean; error?: string }>;
  logAutoPR: (taskId: number, title: string, prUrl?: string, prNumber?: number) => Promise<unknown>;
}

/**
 * Create (or reuse) the task's PR, writing the outcome onto `p.result`.
 *
 * @param p - Task, worktree, branches, verify.md, shared result and helpers / 入力
 * @returns The result to return immediately, or null to continue / 中断時の結果、継続なら null
 */
export async function runPrCreationStage(p: {
  taskId: number;
  task: { title: string; theme?: { repositoryUrl?: string | null } | null };
  verifyContent: string;
  orchestrator: AgentOrchestrator;
  gitCwd: string;
  branchName: string | null | undefined;
  targetBranch: string;
  result: AutoCommitPRResult;
  deps: PrStageDeps;
}): Promise<AutoCommitPRResult | null> {
  const { taskId, task, gitCwd, branchName, targetBranch, orchestrator, result } = p;
  // Boundary 4/5 — the pre-PR base sync above can run an aux conflict
  // resolution and a full re-verification, so re-read the stop intent
  // before publishing anything to GitHub.
  if (await publicationAborted(taskId, 'before_pr'))
    return { ...result, error: PUBLICATION_CANCELLED_ERROR };
  // One-open-PR-per-task guard: createPullRequest's own reuse check is
  // branch-scoped (gh pr list --head <branch>) and misses a task's real
  // open PR whenever this run lands on a DIFFERENT branch than the PR was
  // opened from (recreated worktree, diverged push renamed to
  // <branch>-<sha>). Claim the lock first so two concurrent auto-PR
  // attempts for this task can't both pass the check and each create one.
  const lockClaimed = await claimPrCreationLock(prisma, taskId);
  if (!lockClaimed) {
    log.info(
      `[Workflow] Task ${taskId}: another PR-creation attempt is already in flight — skipping`,
    );
    result.autoPRResult = { success: false, error: PR_CREATION_IN_FLIGHT_ERROR };
    return null;
  }
  try {
    const existingOpenPr = await findOpenPrForTask(prisma, taskId);
    if (existingOpenPr) {
      log.info(
        `[Workflow] Task ${taskId} already has open PR #${existingOpenPr.prNumber} — reusing instead of creating a new one`,
      );
      // The create path pushes inside createPullRequest; this short-circuit
      // skipped that call, so ci_repair fixes were saved locally and never
      // reached the PR (tasks 995/1002, 2026-09-20). Push explicitly.
      const pushBranch = result.autoCommitResult?.branch ?? branchName;
      const pushed = pushBranch
        ? await p.deps.pushExistingPrBranch(gitCwd, pushBranch)
        : { success: false, error: 'branch name unknown — cannot push to the existing PR' };
      result.autoPRResult = pushed.success
        ? { success: true, prUrl: existingOpenPr.url, prNumber: existingOpenPr.prNumber }
        : {
            success: false,
            prUrl: existingOpenPr.url,
            prNumber: existingOpenPr.prNumber,
            error: `既存 PR #${existingOpenPr.prNumber} への push に失敗しました: ${pushed.error}`,
          };
      // Draft→ready promotion (task 1099): the automated half of the draft/ready OR condition.
      if (pushed.success && result.verdict === 'pass') {
        await readyPullRequest(gitCwd, existingOpenPr.prNumber);
      }
    } else {
      const prTitle = `[Task-${taskId}] ${task.title}`;
      const prBody = `## Summary\n\nAuto-generated PR for Task #${taskId}: ${task.title}\n\n## Verification Report\n\n${p.verifyContent}\n\n---\n🤖 Generated automatically by Rapitas AI Agent`;
      // Pass the session's branchName as the explicit PR head — gitCwd's
      // raw checkout can sit on the base branch when the worktree is gone
      // (task 594: head resolved to "develop" and PR creation failed with
      // head==base despite the session branch being pushed).
      // Ask git before asking GitHub. A branch with nothing ahead of the
      // base cannot become a PR; `gh pr create` reports that as a failure
      // and the gh client logs every failed command at ERROR — six times
      // in one day for no-change completions (tasks 699/700/707/735/736/
      // 739). The "No commits between" wording is kept on purpose: it is
      // what isNoChangeCompletion classifies, so the no-change path below
      // is unchanged; only the pointless gh call and its ERROR line go.
      const aheadOfBase = await p.deps.countCommitsAhead(gitCwd, targetBranch);
      const prResult =
        aheadOfBase === 0
          ? {
              success: false as const,
              error: `No commits between ${targetBranch} and ${branchName ?? 'HEAD'} — nothing to publish (skipped before gh pr create)`,
            }
          : await orchestrator.createPullRequest(
              gitCwd,
              prTitle,
              prBody,
              targetBranch,
              branchName ?? undefined,
              result.verdict === 'unknown',
            );
      result.autoPRResult = prResult;

      if (prResult.success) {
        log.info(`[Workflow] Auto-PR created for task ${taskId}: ${prResult.prUrl}`);
        await p.deps.logAutoPR(taskId, task.title, prResult.prUrl, prResult.prNumber);
        // Persist + link the PR locally so the task's "PRを開く" button can
        // resolve task → local PR id. Without this the by-task lookup 404s and
        // the button silently does nothing.
        if (prResult.prNumber != null && prResult.prUrl) {
          await linkAutoCreatedPr(prisma, {
            taskId,
            prNumber: prResult.prNumber,
            prUrl: prResult.prUrl,
            title: prTitle,
            headBranch: result.autoCommitResult?.branch ?? branchName ?? 'unknown',
            baseBranch: targetBranch,
            repositoryUrl: task.theme?.repositoryUrl,
            workingDirectory: gitCwd,
          });
        }
      } else {
        // NOTE (task 687): "no commits between" / "nothing to commit" is
        // an already-implemented no-op that verify-commit-pr-pipeline.ts
        // completes successfully via this SAME isNoChangeCompletion
        // classifier — logging it at ERROR filed the same benign outcome
        // as a recurring generic bug report. Only a genuine PR-creation
        // failure (auth, network, foreign-PR collision, etc.) is an
        // operational error worth ERROR severity.
        const benignNoChange = p.deps.isNoChangeCompletion({
          errorBlob: prResult.error ?? '',
          filesChanged: result.autoCommitResult?.filesChanged,
        });
        // NOTE: pino's stdSerializers only special-case the `err` key —
        // `error:` silently dropped the failure reason from the log
        // (task 687), leaving log-health-check unable to diagnose repeats.
        const logPrOutcome = benignNoChange ? log.warn.bind(log) : log.error.bind(log);
        logPrOutcome(
          { err: new Error(prResult.error ?? 'unknown error') },
          benignNoChange
            ? `[Workflow] Auto-PR skipped for task ${taskId}: already implemented, no changes to publish`
            : `[Workflow] Auto-PR creation failed for task ${taskId}`,
        );
        // Task-identity mismatch (task 541): the branch's open PR belongs to
        // another task — surface it instead of a silent generic failure so
        // the user can resolve the stale branch/PR collision.
        if (prResult.error?.startsWith(FOREIGN_PR_ERROR_PREFIX)) {
          await notify({
            taskId,
            type: 'auto_pr_identity_mismatch',
            title: '自動PR作成を中止しました',
            message: `タスク ${taskId} のブランチには他タスクのPRが開いたまま残っているため、誤リンクを避けてPR作成を中止しました。${prResult.error}`,
          });
        }
      }
    }
  } catch (prError) {
    log.error({ err: prError }, `[Workflow] Auto-PR failed for task ${taskId}`);
    result.autoPRResult = {
      success: false,
      error: prError instanceof Error ? prError.message : String(prError),
    };
  } finally {
    await releasePrCreationLock(prisma, taskId);
  }
  return null;
}
