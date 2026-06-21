/**
 * execution/execute-post-handler
 *
 * Async post-execution handler called inside the `.then()` block after the
 * agent worker resolves. Handles task/session status updates, code review
 * approval creation, and worktree cleanup.
 * Separated from execute-route.ts to keep each file under 300 lines.
 *
 * Research-mode handling is delegated to research-phase-handler.ts.
 * Pure output utilities live in research-output-utils.ts.
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { prisma } from '../../../config/database';
import { createLogger } from '../../../config/logger';
import { AgentWorkerManager } from '../../../services/agents/agent-worker-manager';

// Async git so the post-execution revert never blocks the single-threaded event
// loop. Synchronous execSync('git reset/clean', timeout 30s) here would freeze
// ALL HTTP requests (e.g. the UI's GET /tasks/:id) for up to 30s when a git op
// is slow/locked — the "Request timeout after 30001ms" the user saw.
const execAsync = promisify(exec);
import { updateSessionStatusWithRetry } from './session-helpers';
import { reviewAndCommitWorktree } from './post-execution-review';
import { detectExecutionFailures } from './execution-output-validator';
import { handleResearchResult } from './research-phase-handler';
import { isIsolatedWorktree } from './research-output-utils';

const log = createLogger('routes:agent-execution:post-handler');
const agentWorkerManager = AgentWorkerManager.getInstance();

/** Shape of the result returned by agentWorkerManager.executeTask. */
interface ExecuteTaskResult {
  success: boolean;
  waitingForInput?: boolean;
  output?: string;
  errorMessage?: string;
  executionTimeMs?: number;
}

/** Parameters passed to handleExecuteResult. */
export interface HandleExecuteResultParams {
  result: ExecuteTaskResult;
  taskIdNum: number;
  sessionId: number;
  configId: number;
  taskTitle: string;
  workDir: string;
  executionDir: string;
  branchName?: string;
  /** Execution mode — `research` runs the lightweight investigation flow. */
  mode?: 'research' | 'development';
  /** When mode === 'research', the temp file codex's -o flag wrote to. */
  researchTempOutputFile?: string | null;
}

/** Dev-mode statuses with a NEXT agent phase. `plan_created` is excluded — it
 *  is awaiting approval, not stalled; `in_progress`/terminal are left to the
 *  normal commit pipeline. */
const DEV_ADVANCEABLE_STATUSES = new Set(['research_done', 'plan_approved']);

/**
 * Auto-advance a dev-mode run that stopped after a planning phase.
 *
 * A plain `development`-mode agent run (not a `workflow-*` orchestrator phase)
 * self-follows CLAUDE.md: it saves research.md / plan.md and then STOPS (the
 * agent is told to wait for approval before implementing). Nothing then
 * scheduled the implementer, so the task stalled at `plan_approved` with no
 * further activity. When the task is in a managed workflow mode and parked at
 * such a status, kick the orchestrator so the next phase (planner / implementer)
 * runs. Planning produced no code diff, so the caller skips the commit pipeline.
 *
 * @param taskId - Task to inspect/advance. / 対象タスクID
 * @returns true when an advance was scheduled (caller should skip commit). / 進行を予約したか
 */
export async function advanceManagedPlanningPhase(taskId: number): Promise<boolean> {
  const managed = await prisma.task
    .findUnique({ where: { id: taskId }, select: { workflowMode: true, workflowStatus: true } })
    .catch(() => null);
  const isManagedMode =
    managed?.workflowMode === 'comprehensive' ||
    managed?.workflowMode === 'standard' ||
    managed?.workflowMode === 'lightweight';
  if (!isManagedMode || !managed?.workflowStatus) return false;
  if (!DEV_ADVANCEABLE_STATUSES.has(managed.workflowStatus)) return false;

  log.info(
    { taskId, workflowStatus: managed.workflowStatus, mode: managed.workflowMode },
    '[API] Dev-mode run stopped after a planning phase — auto-advancing workflow to the next phase',
  );
  // 1s delay so the status writes above commit before the next phase reads them.
  setTimeout(() => {
    import('../../../services/workflow/workflow-orchestrator')
      .then(({ WorkflowOrchestrator }) =>
        WorkflowOrchestrator.getInstance().advanceWorkflow(taskId, 'ja'),
      )
      .catch((advanceErr) =>
        log.error(
          { err: advanceErr, taskId },
          '[API] Auto-advance after dev-mode planning phase failed (user can re-run manually)',
        ),
      );
  }, 1000);
  return true;
}

/**
 * Handles the async result of a task execution: updates task/session status,
 * creates code review approval, and removes the worktree on success.
 *
 * @param params - Execution context and result / 実行コンテキストと結果
 */
export async function handleExecuteResult(params: HandleExecuteResultParams): Promise<void> {
  const {
    result,
    taskIdNum,
    sessionId,
    configId,
    taskTitle,
    workDir,
    executionDir,
    branchName,
    mode,
    researchTempOutputFile,
  } = params;

  // RESEARCH MODE: completely separate pipeline. We:
  //   1. Read the temp file codex wrote via -o (its final markdown).
  //   2. Save it to the workflow API as research.md.
  //   3. ANY git diff is reverted (research must not modify code).
  //   4. Skip AI review / commit / PR / verification entirely.
  if (mode === 'research') {
    await handleResearchResult({
      result,
      taskIdNum,
      sessionId,
      executionDir,
      researchTempOutputFile,
    });
    return;
  }

  if (result.waitingForInput) {
    log.info(`[API] Task ${taskIdNum} is waiting for user input, setting status to 'blocked'`);
    await prisma.task
      .update({
        where: { id: taskIdNum },
        data: { status: 'blocked' },
      })
      .catch((e: unknown) => {
        log.error({ err: e }, `[API] Failed to update task ${taskIdNum} status to in_progress`);
      });

    await prisma.agentSession
      .update({
        where: { id: sessionId },
        data: { status: 'running', lastActivityAt: new Date() },
      })
      .catch((e: unknown) => {
        log.error({ err: e }, `[API] Failed to update session ${sessionId} status to running`);
      });
    return;
  }

  if (result.success) {
    // NOTE: Workflow phase completion takes precedence over verification-failure
    // markers. When the agent followed the research → plan workflow, it may have
    // run tests during investigation that crashed (e.g. vitest EPERM on a fresh
    // worktree before the binary was warmed up). Those test failures are NOT
    // fatal — they are notes the agent took, and the actual deliverable
    // (research.md / plan.md / verify.md) was saved successfully via the
    // workflow API. Check workflowStatus FIRST so we don't punish a successful
    // planning phase for tests it ran along the way.
    const taskWorkflowState = await prisma.task
      .findUnique({ where: { id: taskIdNum }, select: { workflowStatus: true, status: true } })
      .catch(() => null);
    const planningStatuses = new Set([
      'research_done',
      'plan_created',
      'plan_approved',
      'verify_done',
    ]);
    const completedPlanningPhase =
      !!taskWorkflowState?.workflowStatus && planningStatuses.has(taskWorkflowState.workflowStatus);
    // A task whose workflow already reached the terminal `completed` state (or
    // status `done`) SUCCEEDED — the post-run failure-signal heuristic must never
    // revert/block it. Conflict-resolution tasks legitimately print merge-conflict
    // output ("<<<<<<<", "competing", "失敗") that trips detectExecutionFailures,
    // so a task that completed via conflict_resolution_completed was being clobbered
    // back to `blocked` right after completing (the observed completed→blocked flip).
    const alreadyCompleted =
      taskWorkflowState?.workflowStatus === 'completed' || taskWorkflowState?.status === 'done';

    // NOTE: Some CLIs (codex, claude) report exit-0 even when verification
    // commands they ran (vitest, pnpm test, build) crashed mid-task. Treat
    // such sessions as failed ONLY when no workflow artifact exists — otherwise
    // the planning phase was successful and the test crashes are merely noise.
    // For codex agents (which run without workflow enforcement), the failure
    // markers are usually environmental (Windows AV blocking esbuild) — let
    // the AI review pipeline judge the diff instead of pre-emptively blocking.
    const failureSignals = detectExecutionFailures(result.output);
    const earlyAgentConfig = await prisma.aIAgentConfig
      .findUnique({ where: { id: configId }, select: { agentType: true } })
      .catch(() => null);
    const earlyIsCodexAgent = earlyAgentConfig?.agentType === 'codex';
    if (
      failureSignals.length > 0 &&
      !completedPlanningPhase &&
      !alreadyCompleted &&
      !earlyIsCodexAgent
    ) {
      log.error(
        {
          taskId: taskIdNum,
          signals: failureSignals.map((s) => s.pattern),
          firstExcerpt: failureSignals[0]?.excerpt,
        },
        '[API] Execution reported success but verification output contains failure markers — marking session failed',
      );

      // NOTE: Revert is only appropriate when workflow enforcement was active
      // and the agent ignored it (no plan.md saved). For codex agents that run
      // without enforcement, the absence of plan.md is EXPECTED — codex's job
      // is to implement directly. Reverting in that case would discard
      // legitimate work the user wanted. Look up the agent type to decide.
      const agentConfig = await prisma.aIAgentConfig
        .findUnique({ where: { id: configId }, select: { agentType: true } })
        .catch(() => null);
      const isCodexAgent = agentConfig?.agentType === 'codex';
      const planFile = await prisma.workflowFile
        .findFirst({ where: { taskId: taskIdNum, fileType: 'plan' }, select: { id: true } })
        .catch(() => null);
      // Revert ONLY when the workflow path was active (non-codex agent) and
      // plan.md is missing — otherwise the agent ignored the workflow and
      // shouldn't be allowed to commit unverified changes.
      if (!planFile && !isCodexAgent && !isIsolatedWorktree(executionDir)) {
        log.warn(
          { taskId: taskIdNum, executionDir },
          '[API] Skipping hard reset — executionDir is the main checkout, not an isolated worktree (would clobber uncommitted work)',
        );
      } else if (!planFile && !isCodexAgent) {
        try {
          await execAsync('git reset --hard HEAD', { cwd: executionDir, timeout: 30000 });
          await execAsync('git clean -fd', { cwd: executionDir, timeout: 30000 });
          log.info(
            { taskId: taskIdNum, executionDir },
            '[API] Reverted unauthorized agent changes (no plan.md + verification failed)',
          );
        } catch (revertErr) {
          log.warn(
            { err: revertErr, taskId: taskIdNum },
            '[API] Failed to revert worktree after detecting failure markers',
          );
        }
      } else if (isCodexAgent) {
        log.info(
          { taskId: taskIdNum },
          '[API] Skipping worktree revert: codex agent runs without workflow enforcement, diff is preserved for manual review',
        );
      }

      await prisma.task
        .update({ where: { id: taskIdNum }, data: { status: 'blocked' } })
        .catch((e: unknown) =>
          log.error(
            { err: e },
            `[API] Failed to update task ${taskIdNum} to blocked after detecting failure markers`,
          ),
        );

      const revertNote = !planFile
        ? ' worktree の未承認変更は破棄しました。タスクを再実行すれば調査・計画フェーズからやり直します。'
        : '';
      await prisma.agentSession
        .update({
          where: { id: sessionId },
          data: {
            status: 'failed',
            completedAt: new Date(),
            errorMessage: `Verification failed: ${failureSignals.map((s) => s.pattern).join(', ')}.${revertNote}`,
          },
        })
        .catch((e: unknown) =>
          log.error(
            { err: e },
            `[API] Failed to update session ${sessionId} to failed after detecting failure markers`,
          ),
        );
      return;
    }
    if (failureSignals.length > 0 && completedPlanningPhase) {
      log.info(
        {
          taskId: taskIdNum,
          workflowStatus: taskWorkflowState?.workflowStatus,
          signals: failureSignals.map((s) => s.pattern),
        },
        '[API] Verification markers seen but agent successfully completed a workflow phase — keeping success state',
      );
    }
    if (failureSignals.length > 0 && earlyIsCodexAgent) {
      log.info(
        {
          taskId: taskIdNum,
          signals: failureSignals.map((s) => s.pattern),
        },
        '[API] Verification markers seen but agent is codex (no workflow enforcement) — letting AI review pipeline judge the diff instead of pre-emptively blocking',
      );
    }

    // Do NOT downgrade an already-COMPLETED task. A stray execution running on a
    // task whose workflowStatus is 'completed' (e.g. task 216: a researcher phase
    // fired ~16s after completion) would flip status done → in-progress and leave
    // an inconsistent gap (workflowStatus=completed / status=in-progress) with the
    // 完了 UI lost. A completed task is terminal; this run does not reopen it.
    if (taskWorkflowState?.workflowStatus === 'completed') {
      log.warn(
        { taskId: taskIdNum, sessionId },
        '[API] Execution finished on an already-completed task — keeping it completed (not downgrading to in-progress).',
      );
    } else {
      // NOTE: Keep task as in-progress until the full pipeline
      // (AI review → commit → PR → cleanup) completes. Only then mark as done.
      // Canonical task.status is hyphenated 'in-progress' (see StatusConfig); the
      // underscore form is the separate workflowStatus value. Writing the wrong
      // one left subtasks unrecognized by the UI and by status='in-progress'
      // queries, so they appeared stuck.
      await prisma.task
        .update({ where: { id: taskIdNum }, data: { status: 'in-progress' } })
        .catch((e: unknown) =>
          log.error({ err: e }, `[API] Failed to update task ${taskIdNum} to in_progress`),
        );
      log.info(`[API] Task ${taskIdNum} kept as in_progress (pending review pipeline)`);
    }

    await updateSessionStatusWithRetry(sessionId, 'completed', '[API]', 3);

    // Determine whether this execution belongs to a workflow phase. If so,
    // PR creation is the responsibility of `performAutoCommitAndPR` —
    // triggered when `verify.md` is saved at the end of the verifier phase.
    // Without this guard, the implementer phase finishes successfully and
    // would create the PR before the verifier had a chance to run, so the
    // user sees "PR created → 検証フェーズ" ordering.
    const session = await prisma.agentSession
      .findUnique({ where: { id: sessionId }, select: { mode: true } })
      .catch(() => null);
    // Only the CODE-producing workflow phases (implementer/verifier) defer their
    // PR to the verify.md handler. A workflow-researcher/planner run via the
    // execute path produces NO code and must still auto-advance to the next phase
    // — otherwise a lightweight research run stalls at research_done with nothing
    // dispatching the implementer (the previous `startsWith('workflow-')` guard
    // wrongly skipped the researcher/planner advance too).
    const isWorkflowCodePhase =
      session?.mode === 'workflow-implementer' ||
      session?.mode === 'workflow-verifier' ||
      session?.mode === 'workflow-auto_verifier';

    if (isWorkflowCodePhase) {
      log.info(
        { taskId: taskIdNum, mode: session?.mode },
        '[API] Workflow code phase detected — skipping post-execution PR pipeline (verify.md handler will commit/PR after verification)',
      );
    } else if (await advanceManagedPlanningPhase(taskIdNum)) {
      // Handled inside the helper: a dev-mode run that self-followed CLAUDE.md
      // and stopped after research/plan has been auto-advanced to the next
      // agent phase. No diff to commit yet, so the review pipeline is skipped.
    } else {
      // Pipeline: AI review → commit → PR → cleanup → mark task done
      reviewAndCommitWorktree({
        taskId: taskIdNum,
        taskTitle,
        sessionId,
        workDir,
        executionDir,
        branchName,
        executionOutput: result.output,
      }).catch((err) => {
        log.warn({ err, taskId: taskIdNum }, '[API] Post-execution review pipeline failed');
      });
    }
  } else {
    log.error(
      { errorMessage: result.errorMessage },
      `[API] Execution failed for task ${taskIdNum}`,
    );
    await prisma.task
      .update({ where: { id: taskIdNum }, data: { status: 'todo' } })
      .catch((e: unknown) =>
        log.error({ err: e }, `[API] Failed to update task ${taskIdNum} to todo after failure`),
      );

    await prisma.agentSession
      .update({
        where: { id: sessionId },
        data: {
          status: 'failed',
          completedAt: new Date(),
          errorMessage: result.errorMessage || 'Execution failed',
        },
      })
      .catch((e: unknown) =>
        log.error({ err: e }, `[API] Failed to update session ${sessionId} to failed`),
      );
  }
}
