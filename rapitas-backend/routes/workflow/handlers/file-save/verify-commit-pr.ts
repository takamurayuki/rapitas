/**
 * FileSave Verify Commit/PR Completion
 *
 * Auto commit / PR / merge for a passing verify.md, the gate-side
 * history-contamination retry, the PR-required completion gate, staged
 * completion, conflict-resolution direct completion, and the post-completion
 * fire-and-forget side effects.
 * Not responsible for the empty-diff gate or the adversarial review.
 */

import { prisma } from '../../../../config';
import { createLogger } from '../../../../config/logger';
import type { WorkflowFileType } from '../../core/workflow-helpers';
import { performAutoCommitAndPR, isNoChangeCompletion } from '../../workflow-auto-commit';
import { resolveLandingMode } from '../../../../services/workflow/automation-policy';
import { recordTransition } from '../../../../services/workflow/transition-recorder';
import { markLatestExecutionFailed } from './shared';
import { registerVerifyCompletion } from '../../../../services/workflow/verify-completion-inflight';
import { handleVerifyGateBlocked } from './verify-commit-pr-gate-blocked';
import { runVerifyCompletionSideEffects } from './verify-commit-pr-side-effects';

const log = createLogger('routes:workflow:handlers:files');

/**
 * Result of the commit/PR completion stage: the (possibly updated) newStatus,
 * whether the task actually completed, and the raw auto-commit/PR result the
 * HTTP response echoes back.
 */
export interface CommitPrCompletionOutcome {
  newStatus?: string;
  taskMarkedDone: boolean;
  autoCommitPRResult: Awaited<ReturnType<typeof performAutoCommitAndPR>>;
}

/**
 * Runs commit/PR/merge and the completion gates for a passing verify.md save.
 *
 * Auto commit and PR creation when saving verify.md.
 *
 * NOTE: reaching this stage's active branch means verify.md passed validation
 * (the failure branch upstream holds the task at `in_progress`/`blocked` and
 * leaves newStatus undefined). Per the user's request — "verify.md を保存し、
 * 問題がなければステータスを完了に" — a passing verification now completes the
 * task directly. Auto-commit / PR / merge still run as a BEST-EFFORT side
 * effect (so branches with real changes still get a PR), but completion no
 * longer depends on a PR being published... except that completion REQUIRES a
 * successfully created PR when one was requested (see the gate below).
 *
 * @param params - taskId / fileType / newStatus / gate flags / conflict info / content / base branch / 入力一式
 * @returns The completion outcome (pass-through when the gates skip this stage)
 */
export async function runVerifyCommitPrCompletion(params: {
  taskId: number;
  fileType: WorkflowFileType;
  newStatus: string | undefined;
  verifyGateBlocked: boolean;
  staleVerifyRequest: boolean;
  isConflictResolutionTask: boolean;
  conflictTask: { title: string | null; githubPrId: number | null } | null;
  savedContent: string;
  preferredBaseBranchForVerify: string | null;
}): Promise<CommitPrCompletionOutcome> {
  const {
    taskId,
    fileType,
    staleVerifyRequest,
    isConflictResolutionTask,
    conflictTask,
    savedContent,
    preferredBaseBranchForVerify,
  } = params;
  let newStatus = params.newStatus;
  let verifyGateBlocked = params.verifyGateBlocked;

  let autoCommitPRResult: Awaited<ReturnType<typeof performAutoCommitAndPR>> = {};
  let taskMarkedDone = false;
  if (
    fileType === 'verify' &&
    newStatus === 'verify_done' &&
    !verifyGateBlocked &&
    !staleVerifyRequest &&
    isConflictResolutionTask
  ) {
    // Conflict-resolution task: the fix was already pushed to the existing PR
    // branch, so there is no new commit/PR to make and the scope check does not
    // apply. Complete directly — the PR (task.githubPrId) is what carries the work.
    // Compare-and-swap on verify_done: a concurrent duplicate of this save
    // (task 594 recorded the same completion twice, 242ms apart) must not
    // record a second completion transition — only the request that actually
    // flips the row completes and records. Mirrors the repair rollback below.
    const completed = await prisma.task
      .updateMany({
        where: { id: taskId, workflowStatus: 'verify_done' },
        data: { status: 'done', workflowStatus: 'completed', completedAt: new Date() },
      })
      .catch(() => ({ count: 0 }));
    if (completed.count === 0) {
      log.warn(
        { taskId, prNumber: conflictTask?.githubPrId },
        '[Workflow] Conflict-resolution completion already applied by a concurrent request — skipping duplicate transition',
      );
    } else {
      taskMarkedDone = true;
      await recordTransition({
        taskId,
        fromStatus: 'verify_done',
        toStatus: 'completed',
        actor: 'system',
        cause: 'conflict_resolution_completed',
        phase: 'verify',
        metadata: { prNumber: conflictTask?.githubPrId },
      });
      log.info(
        { taskId, prNumber: conflictTask?.githubPrId },
        '[Workflow] Conflict-resolution task completed (work pushed to PR branch; commit/PR/scope gates skipped).',
      );
    }
  } else if (
    fileType === 'verify' &&
    newStatus === 'verify_done' &&
    !verifyGateBlocked &&
    !staleVerifyRequest
  ) {
    // Run commit/PR/merge. Completion is GATED on its outcome: the task only
    // completes when a PR was created (or already exists), or when no PR was
    // requested. See the gate in the success branch below.
    // Registered as in-flight so the WorkflowRunner's verify-settle wait knows
    // this is live work rather than a stalled task: its fixed 60s window
    // expired mid-pipeline on task 580 (which needed 127s) and auto-run
    // skipped a task that then created its PR successfully.
    const commitPrWork = performAutoCommitAndPR(taskId, savedContent).catch((err) => {
      log.warn({ err, taskId }, '[Workflow] Auto-commit/PR threw');
      return {} as Awaited<ReturnType<typeof performAutoCommitAndPR>>;
    });
    registerVerifyCompletion(taskId, commitPrWork);
    autoCommitPRResult = await commitPrWork;

    // History-contamination recovery (task 539), gate-side call site: when
    // the automated gate withheld commit/PR and the out-of-plan files came
    // from branch history, rebuild the worktree and retry the commit/PR
    // pipeline ONCE. performAutoCommitAndPR re-reads the latest session's
    // worktreePath, which the recovery updates — a plain re-call is enough.
    let gateRecoveryBlocked: 'recovery_already_used' | 'patch_apply_conflict' | null = null;
    if (autoCommitPRResult.verificationBlocked) {
      const { tryRecoverFromHistoryContamination } =
        await import('../../../../services/workflow/worktree-rebuild-recovery');
      const gateWorktreeSession = await prisma.agentSession
        .findFirst({
          where: { config: { taskId }, worktreePath: { not: null } },
          orderBy: { createdAt: 'desc' },
          select: { worktreePath: true },
        })
        .catch(() => null);
      const recovery = await tryRecoverFromHistoryContamination(
        taskId,
        gateWorktreeSession?.worktreePath,
        preferredBaseBranchForVerify,
      ).catch(
        () =>
          ({ recovered: false }) as Awaited<ReturnType<typeof tryRecoverFromHistoryContamination>>,
      );
      if (recovery.recovered) {
        autoCommitPRResult = await performAutoCommitAndPR(taskId, savedContent).catch((err) => {
          log.warn({ err, taskId }, '[Workflow] Auto-commit/PR retry after worktree rebuild threw');
          return {} as Awaited<ReturnType<typeof performAutoCommitAndPR>>;
        });
        log.info(
          { taskId, retryBlocked: autoCommitPRResult.verificationBlocked === true },
          '[Workflow] Verification gate re-ran after worktree rebuild recovery',
        );
      } else if (
        recovery.reason === 'recovery_already_used' ||
        recovery.reason === 'patch_apply_conflict'
      ) {
        gateRecoveryBlocked = recovery.reason;
      }
    }

    const commit = autoCommitPRResult.autoCommitResult;
    const pr = autoCommitPRResult.autoPRResult;
    const merge = autoCommitPRResult.autoMergeResult;

    if (autoCommitPRResult.verificationBlocked) {
      // The automated gate (lint / typecheck / test / scope) found problems in
      // the agent's changes, so commit/PR were withheld. Rather than dead-end
      // at `blocked`, bounce back to the implementer with the failure as
      // feedback so it FIXES the issue and re-verifies (self-improvement loop,
      // bounded by RAPITAS_MAX_VERIFY_REPAIRS). Block only once exhausted.
      verifyGateBlocked = true; // either way, do not mark done/PR this pass
      const gateReason =
        autoCommitPRResult.error ?? '自動検証に失敗しました（lint/型/テスト/スコープ）。';

      // NOTE: Extracted to verify-commit-pr-gate-blocked.ts — behaviour
      // unchanged (recovery-blocked notify, self-repair bounce, exhaustion).
      const gateOutcome = await handleVerifyGateBlocked({
        taskId,
        gateReason,
        gateRecoveryBlocked,
        savedContent,
      });
      if (gateOutcome.newStatus) newStatus = gateOutcome.newStatus;
    } else {
      // Completion REQUIRES a successfully created PR (user request): a passing
      // verify is no longer enough — the change must reach a PR. Exceptions:
      //   - PR creation was not requested (autoCreatePR off), or
      //   - a PR already exists for this task (app-linked or task.githubPrId).
      const prRequested = autoCommitPRResult.requested
        ? autoCommitPRResult.requested.autoCreatePR
        : true; // requested unset (e.g. threw) → default flow expects a PR
      let prSatisfied = pr?.success === true;
      if (prRequested && !prSatisfied) {
        const linked = await prisma.gitHubPullRequest
          .findFirst({ where: { linkedTaskId: taskId }, select: { id: true } })
          .catch(() => null);
        if (linked) {
          prSatisfied = true;
        } else {
          const taskRow = await prisma.task
            .findUnique({ where: { id: taskId }, select: { githubPrId: true } })
            .catch(() => null);
          prSatisfied = taskRow?.githubPrId != null;
        }
      }

      // No-diff / already-implemented: verify passed but there is NOTHING to PR
      // because the code already satisfies the task. Requiring a PR here
      // wrongly blocks an already-done task — complete it as a no-change
      // result instead (mirrors the research "## 結論: 修正不要" path). The
      // shared classifier excludes base-branch errors and real committed
      // changes (task 485: nonexistent base also says "No commits between").
      const noChangeCompletion =
        prRequested &&
        !prSatisfied &&
        isNoChangeCompletion({
          errorBlob: `${pr?.error ?? ''} ${commit?.error ?? ''} ${autoCommitPRResult.error ?? ''}`,
          filesChanged: commit?.filesChanged,
        });

      if (noChangeCompletion) {
        // Compare-and-swap on verify_done: task 594 recorded THIS transition
        // (verify_no_change_confirmed) twice, 242ms apart, from two concurrent
        // completion runs. Only the request that actually flips the row may
        // record the transition; the loser logs and leaves taskMarkedDone
        // false (its HTTP response staleness is harmless — the winner already
        // completed the task).
        const completedNoChange = await prisma.task
          .updateMany({
            where: { id: taskId, workflowStatus: 'verify_done' },
            data: {
              status: 'done',
              workflowStatus: 'completed',
              completedAt: new Date(),
              updatedAt: new Date(),
            },
          })
          .catch(() => ({ count: 0 }));
        if (completedNoChange.count === 0) {
          log.warn(
            { taskId, prError: pr?.error },
            '[Workflow] no-change completion already applied by a concurrent request — skipping duplicate transition',
          );
        } else {
          taskMarkedDone = true;
          newStatus = 'completed';
          await recordTransition({
            taskId,
            fromStatus: 'verify_done',
            toStatus: 'completed',
            actor: 'system',
            cause: 'verify_no_change_confirmed',
            phase: 'verify',
            metadata: {
              reason: 'no diff — already implemented; PR not required',
              prError: pr?.error,
              commitError: commit?.error,
            },
          });
          log.info(
            { taskId, prError: pr?.error },
            '[Workflow] verify passed with NO diff (already implemented) — completing WITHOUT a PR.',
          );
        }
      } else if (prRequested && !prSatisfied) {
        // Verify passed but no PR was produced — do NOT complete. Keep the task
        // actionable (blocked) and surface why, so "完了" always implies a PR.
        const reason =
          pr?.error || commit?.error || autoCommitPRResult.error || 'PRが作成されませんでした';
        await prisma.task
          .update({ where: { id: taskId }, data: { status: 'blocked', updatedAt: new Date() } })
          .catch(() => {});
        await markLatestExecutionFailed(
          taskId,
          `検証は通過しましたがPRが作成されませんでした: ${reason}。完了にはPR作成が必要です。`,
        );
        await recordTransition({
          taskId,
          fromStatus: 'verify_done',
          toStatus: 'verify_done',
          actor: 'system',
          cause: 'verify_pr_not_created',
          phase: 'verify',
          metadata: {
            commit: commit?.success,
            prError: pr?.error,
            error: autoCommitPRResult.error,
          },
          invariantViolation: true,
          invariantMessage: '検証通過後にPRが作成されませんでした。PR作成成功まで完了にしません。',
        });
        log.warn(
          {
            taskId,
            prError: pr?.error,
            commitOk: commit?.success,
            error: autoCommitPRResult.error,
          },
          '[Workflow] verify passed but no PR created — NOT completing (completion requires a PR).',
        );
      } else {
        // Staged completion: when changes land via a PR, completion is NOT at
        // PR creation — `pr` mode completes when the PR's CI goes green, `merge`
        // mode completes when the PR is merged. The PR-completion watcher
        // advances those. Only `commit`/`none` complete here. Gated OFF by
        // default so existing deployments keep the verify-time completion until
        // they opt in (RAPITAS_STAGED_COMPLETION=true) + restart.
        const staged =
          process.env.RAPITAS_STAGED_COMPLETION === 'true' ||
          process.env.RAPITAS_STAGED_COMPLETION === '1';
        const landingMode = autoCommitPRResult.requested
          ? resolveLandingMode(autoCommitPRResult.requested)
          : 'none';
        if (staged && (landingMode === 'pr' || landingMode === 'merge')) {
          // Hold at verify_done (status stays in-progress, NOT done). The watcher
          // completes on CI-green (pr) / merge (merge). Do not fire completion
          // side effects yet (taskMarkedDone stays false).
          await recordTransition({
            taskId,
            fromStatus: 'verify_done',
            toStatus: 'verify_done',
            actor: 'system',
            cause: 'verify_passed_awaiting_ci',
            phase: 'verify',
            metadata: { landingMode, pr: pr?.success, prNumber: pr?.prNumber },
          });
          log.info(
            { taskId, landingMode, prNumber: pr?.prNumber },
            '[Workflow] verify passed + PR created — completion deferred to CI/merge (staged completion).',
          );
        } else {
          await prisma.task.update({
            where: { id: taskId },
            data: { status: 'done', workflowStatus: 'completed', completedAt: new Date() },
          });
          taskMarkedDone = true;
          await recordTransition({
            taskId,
            fromStatus: 'verify_done',
            toStatus: 'completed',
            actor: 'system',
            cause: 'verify_passed',
            phase: 'verify',
            metadata: { commit: commit?.success, pr: pr?.success, merge: merge?.success },
          });
          log.info(
            { taskId, commitOk: commit?.success, prOk: pr?.success, mergeOk: merge?.success },
            '[Workflow] verify.md passed AND PR satisfied — task marked done/completed.',
          );
        }
      }
    }

    // Post-completion side effects only when the task ACTUALLY completed (not
    // when it was bounced for self-repair or held for a missing PR).
    // NOTE: Extracted to verify-commit-pr-side-effects.ts — behaviour unchanged.
    if (taskMarkedDone) {
      runVerifyCompletionSideEffects(taskId, savedContent);
    }
  }

  return { newStatus, taskMarkedDone, autoCommitPRResult };
}
