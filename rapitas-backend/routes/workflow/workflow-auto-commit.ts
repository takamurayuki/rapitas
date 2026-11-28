/**
 * Workflow Auto Commit and PR
 *
 * Handles automatic git commit, pull request creation, merge, and worktree cleanup
 * triggered when verify.md is saved and the workflow reaches 'completed' status.
 * Not responsible for route definitions or file persistence.
 */

import { join } from 'path';
import { prisma, getProjectRoot } from '../../config';
import { AgentOrchestrator } from '../../services/agents/agent-orchestrator';
import { createLogger } from '../../config/logger';
import { runVerificationGate } from '../../services/agents/verification/verification-gate';
import { resolveAutomationPolicy } from '../../services/workflow/automation-policy';
import { resolveCommitCwd } from './commit-cwd';
import { syncHarnessIfDrifted } from '../../services/workflow/harness-drift-sync';
import type { AutoCommitPRResult } from '../../services/workflow/publish/workflow-auto-commit-types';
import type { PublishBinding } from '../../services/workflow/publish/workflow-auto-commit-binding';
import { runLocalSaveStage } from '../../services/workflow/publish/auto-commit-local-save-stage';
import { runPrCreationStage } from '../../services/workflow/publish/auto-commit-pr-stage';
import { readHeadRevision, runPreSaveChecks } from './workflow-auto-commit-presave';
import { syncAndReverifyBeforePublish } from './workflow-auto-commit-publish-guard';
import {
  recordGateStop,
  recordPreSaveStop,
  recordPublishGuardStop,
} from '../../services/workflow/publish/verification-stop-record';
import {
  PUBLICATION_CANCELLED_ERROR,
  publicationAborted,
} from '../../services/workflow/publication-cancellation-guard';

const log = createLogger('routes:workflow:auto-commit');

// NOTE: Moved to workflow-auto-commit-types.ts to keep this file under the size limit.
export type { AutoCommitPRResult } from '../../services/workflow/publish/workflow-auto-commit-types';

// Shared classification helpers live in workflow-auto-commit-classify.ts (kept
// re-exported here so existing importers of this module are unaffected).
export { countCommitsAhead, isNoChangeCompletion } from './workflow-auto-commit-classify';

/**
 * Perform auto-commit, PR creation, optional merge, and worktree cleanup after verify.md is saved.
 *
 * @param taskId - Task ID that was completed / 完了したタスクID
 * @param verifyContent - Content of verify.md for PR body / PRボディ用verify.mdの内容
 * @param opts.binding - Review-hold override: publish only this worktree + verify.md + diff / 上書きの対象
 * @returns Result object containing outcomes of each step / 各ステップの結果オブジェクト
 */
export async function performAutoCommitAndPR(
  taskId: number,
  verifyContent: string,
  opts: { binding?: PublishBinding } = {},
): Promise<AutoCommitPRResult> {
  const result: AutoCommitPRResult = {};

  try {
    const execConfig = await prisma.agentExecutionConfig.findUnique({ where: { taskId } });

    // Effective automation policy. An explicit per-task execConfig (saved by the
    // user in the UI) wins; otherwise fall back to the recommended default flow
    // (commit + PR, NO auto-merge) so an UNconfigured task's changes still reach
    // git via a reviewable PR instead of being stranded uncommitted in the
    // worktree. execConfig is only created on explicit user action, so "no row"
    // genuinely means "use the recommended default".
    const policy = await resolveAutomationPolicy(prisma, taskId);
    const autoCommit = execConfig ? execConfig.autoCommit : policy.autoCommit;
    const autoCreatePR = execConfig ? execConfig.autoCreatePR : policy.autoCreatePR;
    const autoMergePR = execConfig ? execConfig.autoMergePR : policy.autoMergePR;
    result.requested = { autoCommit, autoCreatePR, autoMergePR };

    if (!autoCommit && !autoCreatePR && !autoMergePR) return result;

    // Boundary 1/5 — entry. A stop recorded before this call must not produce a
    // commit or PR at all.
    if (await publicationAborted(taskId, 'entry'))
      return { ...result, error: PUBLICATION_CANCELLED_ERROR };

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        theme: true,
        developerModeConfig: {
          include: { agentSessions: { orderBy: { lastActivityAt: 'desc' }, take: 1 } },
        },
      },
    });

    if (!task) return result;
    // CRITICAL: explicit cwd → task worktree → theme dir (see commit-cwd.ts; task 774).
    const workingDirectory = await resolveCommitCwd(execConfig, task, taskId);
    if (!workingDirectory) {
      log.warn(`[workflow] Task ${taskId} rejected: workingDirectory not configured.`);
      return {
        ...result,
        error:
          'Task theme must have workingDirectory configured. Please set the working directory in theme settings.',
      };
    }

    // NOTE: Log warning when workingDirectory overlaps with rapitas project — allowed but flagged
    const projectRoot = getProjectRoot();
    if (
      workingDirectory === projectRoot ||
      workingDirectory.startsWith(join(projectRoot, 'rapitas-'))
    ) {
      log.warn(
        `[workflow] Task ${taskId}: workingDirectory overlaps with rapitas project (${workingDirectory}). Proceeding.`,
      );
    }

    const latestSession = task.developerModeConfig?.agentSessions?.[0];
    const branchName = latestSession?.branchName;
    const targetBranch =
      ((execConfig as Record<string, unknown> | null)?.targetBranch as string) ||
      task.theme?.defaultBranch ||
      'develop';

    // CRITICAL: git commit / push / PR commands MUST run inside the
    // per-task worktree, not the dev project root. Earlier code passed
    // `workingDirectory` (project root) to all git commands, which:
    //   - committed against whatever branch was checked out at the root
    //   - never touched the agent's actual changes (those live in the
    //     worktree on the task branch)
    //   - silently produced "no diff" or no-op commits
    // Fall back to `workingDirectory` only when no worktree exists, so
    // callers that already work without isolation keep functioning.
    const gitCwd = latestSession?.worktreePath || workingDirectory;
    if (latestSession?.worktreePath) {
      log.info(
        { taskId, worktreePath: latestSession.worktreePath, branchName },
        '[Workflow] Running git operations inside per-task worktree',
      );
    } else {
      log.warn(
        { taskId, workingDirectory, branchName },
        '[Workflow] No worktree on session — git operations will run on the dev project root (NOT isolated)',
      );
    }

    // Ordering (2026-09-13): pre-save checks → local save on the task branch →
    // base sync → gate on the synced code → push/PR only after the gate passes.
    // The merge needs a clean tree; a failed gate keeps commit + diagnosis.
    const preSave = await runPreSaveChecks({ taskId, gitCwd, preferredBaseBranch: targetBranch });
    result.preSaveResult = preSave.record;
    if (!preSave.ok) {
      log.error({ taskId, summary: preSave.summary }, '[Workflow] Pre-save check failed');
      const error = `自動検証に失敗しました（${preSave.summary}）。ローカル保存前チェックで停止し、コミット/PR を行っていません。`;
      await recordPreSaveStop(taskId, preSave, error);
      return { ...result, verificationBlocked: true, verificationUnverifiable: false, error };
    }

    const orchestrator = AgentOrchestrator.getInstance(prisma);
    if (autoCommit) {
      const stopped = await runLocalSaveStage({
        taskId,
        taskTitle: task.title,
        orchestrator,
        gitCwd,
        branchName,
        targetBranch,
        binding: opts.binding,
        result,
      });
      if (stopped) return stopped;
    }

    // Harness drift remediation (2026-09-13, tasks 901/905): a branch cut before
    // the runtime harness holds as UNVERIFIED; merge origin/<base> in (the tree
    // is committed now, so the merge can land). Never a pass by itself.
    const harnessSync = await syncHarnessIfDrifted({
      taskId,
      gitCwd,
      baseBranch: targetBranch,
      sessionId: latestSession?.id,
    }).catch((err): null => {
      log.warn({ err, taskId }, '[Workflow] harness sync threw — leaving the gate to decide');
      return null;
    });
    if (harnessSync) result.harnessSyncResult = harnessSync;

    // Automated verification gate — do NOT auto-commit/PR if the agent
    // introduced new lint/type errors. Mirrors the post-execution-review gate so
    // BOTH auto-PR paths are protected (closes the verify.md-triggered gap).
    const gate = await runVerificationGate(taskId, gitCwd, latestSession?.id);
    result.verdict = gate.verdict;
    if (!gate.ok) {
      // The local commit above is kept on the task branch together with this
      // diagnosis; nothing is pushed or published.
      log.error(
        { taskId, summary: gate.result?.summary, savedCommit: result.autoCommitResult?.hash },
        '[Workflow] Automated verification failed — holding the local commit, no push/PR',
      );
      const error = `自動検証に失敗しました（${gate.result?.summary ?? 'lint/型エラー'}）。ローカルコミットは保持し、push/PR を中止してタスクをブロックしました。`;
      await recordGateStop(taskId, gate, error);
      return {
        ...result,
        verificationBlocked: true,
        verificationUnverifiable: gate.result?.unverifiable === true || gate.result === null,
        error,
      };
    }

    // The revision the gate verified. Publication must ship exactly this HEAD
    // (or a re-verified one) — see workflow-auto-commit-publish-guard.ts.
    result.verifiedRevision = await readHeadRevision(gitCwd);

    // Boundary 3/5 — the verification gate above runs lint/type/tests and can
    // take minutes; a stop during it must not fall through into push/PR.
    if (await publicationAborted(taskId, 'after_verification_gate'))
      return { ...result, error: PUBLICATION_CANCELLED_ERROR };

    // Pre-PR base sync (task 573 A) + re-verification of the final code when
    // the merge moved HEAD. Runs BEFORE the PR-creation lock — the aux
    // resolution + re-verify can exceed the lock's 5-min staleness window.
    if (autoCreatePR && result.autoCommitResult?.success) {
      const guardStartedAt = new Date();
      const guard = await syncAndReverifyBeforePublish({
        taskId,
        gitCwd,
        baseBranch: targetBranch,
        sessionId: latestSession?.id,
        verifiedRevision: result.verifiedRevision,
        verdict: result.verdict ?? 'fail',
      });
      result.baseSyncResult = guard.baseSync;
      result.verifiedRevision = guard.verifiedRevision;
      result.publishedRevision = guard.headRevision;
      result.verdict = guard.verdict;
      if (!guard.ok) {
        // NOTE: guard.error is a FIXED sentence (no raw git/merge output) so
        // completion classification never misreads it. Worktree preserved.
        if (guard.verificationBlocked) result.verificationBlocked = true;
        if (guard.verificationUnverifiable) result.verificationUnverifiable = true;
        await recordPublishGuardStop(taskId, guard, guardStartedAt);
        return { ...result, error: guard.error };
      }
    }

    // Process autoCreatePR (only if autoCommit succeeded)
    if (autoCreatePR && !autoCommit) {
      result.autoPRResult = {
        success: false,
        error:
          'autoCreatePR requires autoCommit so the workflow can identify the branch to publish.',
      };
    }
    if (autoCreatePR && result.autoCommitResult?.success) {
      const stopped = await runPrCreationStage({
        taskId,
        task,
        verifyContent,
        orchestrator,
        gitCwd,
        branchName,
        targetBranch,
        result,
      });
      if (stopped) return stopped;
    }

    // Process autoMergePR — DEFER the actual merge to the CI-gated AutoMergeWatcher.
    // The user requirement is "merge only when verification passes AND behaviour
    // is fine", so the merge must wait for the PR's GitHub CI to go green.
    // Merging inline here would skip that gate. The watcher derives eligibility
    // from task status + autoMergePR + the open linked PR, so nothing extra is
    // persisted; it merges on CI pass, or leaves the PR open on CI fail.
    if (autoMergePR && result.autoPRResult?.success && result.autoPRResult?.prNumber) {
      result.autoMergeResult = { success: false, deferred: true };
      log.info(
        `[Workflow] Auto-merge requested for task ${taskId} PR #${result.autoPRResult.prNumber} — deferred until CI passes`,
      );
    }

    // A verify save is still inside the running CLI and precedes reviewed
    // completion / CI / merge. Preserve its worktree and session reference.
    // The existing cleanup scheduler owns eventual cleanup eligibility.
    if (
      latestSession?.worktreePath &&
      (await publicationAborted(taskId, 'before_worktree_cleanup'))
    )
      return { ...result, error: PUBLICATION_CANCELLED_ERROR };
  } catch (error) {
    log.error({ err: error }, `[Workflow] Auto-commit/PR process failed for task ${taskId}`);
  }

  return result;
}
