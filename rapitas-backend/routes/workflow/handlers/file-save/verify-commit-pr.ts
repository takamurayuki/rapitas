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
import { recordWorkflowCompletion } from '../../../../services/workflow/learning/workflow-learning-optimizer';
import { extractKnowledgeFromTask } from '../../../../services/memory/task-knowledge-extractor';
import { performAutoCommitAndPR, isNoChangeCompletion } from '../../workflow-auto-commit';
import { resolveLandingMode } from '../../../../services/workflow/automation-policy';
import { recordTransition } from '../../../../services/workflow/transition-recorder';
import { markLatestExecutionFailed } from './shared';

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
    await prisma.task
      .update({
        where: { id: taskId },
        data: { status: 'done', workflowStatus: 'completed', completedAt: new Date() },
      })
      .catch(() => {});
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
  } else if (
    fileType === 'verify' &&
    newStatus === 'verify_done' &&
    !verifyGateBlocked &&
    !staleVerifyRequest
  ) {
    // Run commit/PR/merge. Completion is GATED on its outcome: the task only
    // completes when a PR was created (or already exists), or when no PR was
    // requested. See the gate in the success branch below.
    autoCommitPRResult = await performAutoCommitAndPR(taskId, savedContent).catch((err) => {
      log.warn({ err, taskId }, '[Workflow] Auto-commit/PR threw');
      return {} as Awaited<ReturnType<typeof performAutoCommitAndPR>>;
    });

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

      if (gateRecoveryBlocked) {
        // Contamination recovery exhausted (受入基準3) or failed after the old
        // worktree was destroyed (受入基準2c) — an implementer bounce is
        // futile/impossible; block + notify directly, skipping self-repair.
        const blockedTitle =
          gateRecoveryBlocked === 'recovery_already_used'
            ? '自動検証ゲートが再び計画外混入で失敗（worktree再構築の上限到達）'
            : 'worktree再構築リカバリが失敗しました';
        const blockedMessage =
          gateRecoveryBlocked === 'recovery_already_used'
            ? `タスク #${taskId} はブランチ履歴汚染による worktree 再構築を既に1回実施済みですが、自動検証ゲートが再度失敗しました。手動確認が必要です。`
            : `タスク #${taskId} の worktree 再構築中にパッチ適用が失敗しました。退避タグ（recovery/task-${taskId}-*）から手動復旧してください。`;
        // Dynamic import mirrors this handler's convention — keeps the
        // static graph free of config/database for test isolation.
        const { writeBlockedStatusDurable } =
          await import('../../../../services/workflow/durable-blocked-write');
        await writeBlockedStatusDurable({
          taskId,
          log,
          source: 'Workflow',
          notification: { title: blockedTitle, message: blockedMessage },
        });
        const { notifyRecoveryFallbackBlocked } =
          await import('../../../../services/workflow/worktree-rebuild-recovery');
        await notifyRecoveryFallbackBlocked(taskId, blockedTitle, blockedMessage);
        await markLatestExecutionFailed(taskId, gateReason);
        await recordTransition({
          taskId,
          fromStatus: 'verify_done',
          toStatus: 'verify_done',
          actor: 'system',
          cause: 'verification_gate_failed',
          phase: 'verify',
          metadata: {
            reason: gateReason,
            recoveryOutcome: gateRecoveryBlocked,
            recoveryExhausted: gateRecoveryBlocked === 'recovery_already_used',
          },
          invariantViolation: true,
          invariantMessage: gateReason,
        }).catch(() => {});
        log.warn(
          { taskId, recoveryReason: gateRecoveryBlocked, reason: gateReason },
          '[Workflow] History-contamination recovery unavailable — task blocked, no commit/PR',
        );
      } else {
        const { attemptVerifyRepair } =
          await import('../../../../services/workflow/verify-self-repair');
        const repair = await attemptVerifyRepair(
          taskId,
          'verify_done',
          gateReason,
          savedContent,
        ).catch(() => ({ bounced: false }) as Awaited<ReturnType<typeof attemptVerifyRepair>>);

        if (repair.bounced && repair.newStatus) {
          // Compare-and-swap: performAutoCommitAndPR ran real git/lint/test
          // subprocesses above and can take a while — if a concurrent request
          // for this same task (e.g. a duplicate/retried save) already moved
          // the task past verify_done in the meantime, an unconditional update
          // here would stomp that newer state back to the implementer entry.
          // Mirrors the same guard on the adversarial-review bounce above.
          const rolled = await prisma.task
            .updateMany({
              where: { id: taskId, workflowStatus: 'verify_done' },
              data: { workflowStatus: repair.newStatus },
            })
            .catch(() => ({ count: 0 }));
          if (rolled.count === 0) {
            log.warn(
              { taskId, attempt: repair.attempt, reason: gateReason },
              '[Workflow] Verification gate failed but the workflow already moved on — skipping rollback',
            );
          } else {
            newStatus = repair.newStatus;
            log.warn(
              { taskId, attempt: repair.attempt, reason: gateReason },
              '[Workflow] Verification gate failed — bounced to implementer for self-repair',
            );
          }
        } else if (repair.stale) {
          log.warn(
            { taskId, reason: gateReason },
            '[Workflow] stale verification-gate failure — workflow moved on; neither bouncing nor blocking',
          );
        } else {
          await markLatestExecutionFailed(taskId, gateReason);
          log.warn(
            { taskId, reason: gateReason },
            '[Workflow] Verification gate failed and self-repairs exhausted — task stays blocked, no commit/PR.',
          );
        }
      }
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
        await prisma.task
          .update({
            where: { id: taskId },
            data: {
              status: 'done',
              workflowStatus: 'completed',
              completedAt: new Date(),
              updatedAt: new Date(),
            },
          })
          .catch(() => {});
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
    if (taskMarkedDone) {
      // Record the outcome for telemetry + adaptive routing (fire-and-forget).
      import('../../../../services/workflow/outcome-telemetry')
        .then(({ recordTaskOutcome }) => recordTaskOutcome(taskId, 'completed'))
        .catch(() => {});

      // Collect workflow learning data asynchronously (fire-and-forget)
      recordWorkflowCompletion(taskId).catch((err) => {
        log.error({ err, taskId }, 'Failed to record workflow learning data');
      });

      // Auto-extract knowledge on task completion (async)
      extractKnowledgeFromTask(taskId).catch((err) => {
        log.error({ err, taskId }, 'Failed to extract knowledge from task');
      });

      // Extract improvement ideas for IdeaBox (async, Ollama-first)
      import('../../../../services/memory/idea-extractor')
        .then(({ extractIdeasFromExecutionLog }) => {
          extractIdeasFromExecutionLog(taskId, savedContent).catch((err) => {
            log.error({ err, taskId }, 'Failed to extract ideas from task');
          });
        })
        .catch(() => {});

      // Record reasoning trace for temporal debugging (async)
      import('../../../../services/analytics/temporal-debugger')
        .then(({ recordReasoningTrace }) => {
          // Find the latest execution for this task to record its trace
          prisma.agentExecution
            .findFirst({
              where: { session: { config: { taskId } }, status: 'completed' },
              orderBy: { completedAt: 'desc' },
            })
            .then((exec) => {
              if (exec) recordReasoningTrace(exec.id).catch(() => {});
            })
            .catch(() => {});
        })
        .catch(() => {});
    }
  }

  return { newStatus, taskMarkedDone, autoCommitPRResult };
}
