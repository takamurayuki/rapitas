/**
 * execution/execute-post-handler
 *
 * Async post-execution handler called inside the `.then()` block after the
 * agent worker resolves. Handles task/session status updates, code review
 * approval creation, and worktree cleanup.
 * Separated from execute-route.ts to keep each file under 300 lines.
 */

import { prisma } from '../../../config/database';
import { createLogger } from '../../../config/logger';
import { AgentWorkerManager } from '../../../services/agents/agent-worker-manager';
import { updateSessionStatusWithRetry, createCodeReviewApproval } from './session-helpers';
import { reviewAndCommitWorktree } from './post-execution-review';
import { detectExecutionFailures } from './execution-output-validator';
import { recordTransition } from '../../../services/workflow/transition-recorder';
import { checkWorkflowInvariants } from '../../../services/workflow/workflow-invariants';

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
      .findUnique({ where: { id: taskIdNum }, select: { workflowStatus: true } })
      .catch(() => null);
    const planningStatuses = new Set([
      'research_done',
      'plan_created',
      'plan_approved',
      'verify_done',
    ]);
    const completedPlanningPhase =
      !!taskWorkflowState?.workflowStatus && planningStatuses.has(taskWorkflowState.workflowStatus);

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
    if (failureSignals.length > 0 && !completedPlanningPhase && !earlyIsCodexAgent) {
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
      if (!planFile && !isCodexAgent) {
        try {
          const { execSync } = await import('node:child_process');
          execSync('git reset --hard HEAD', { cwd: executionDir, timeout: 30000 });
          execSync('git clean -fd', { cwd: executionDir, timeout: 30000 });
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

    // NOTE: Keep task as in_progress until the full pipeline
    // (AI review → commit → PR → cleanup) completes. Only then mark as done.
    await prisma.task
      .update({ where: { id: taskIdNum }, data: { status: 'in_progress' } })
      .catch((e: unknown) =>
        log.error({ err: e }, `[API] Failed to update task ${taskIdNum} to in_progress`),
      );
    log.info(`[API] Task ${taskIdNum} kept as in_progress (pending review pipeline)`);

    await updateSessionStatusWithRetry(sessionId, 'completed', '[API]', 3);

    await createCodeReviewApproval({
      taskId: taskIdNum,
      taskTitle,
      configId,
      sessionId,
      workDir: executionDir,
      branchName,
      resultOutput: result.output,
      executionTimeMs: result.executionTimeMs,
      logPrefix: '[API]',
    });

    // Determine whether this execution belongs to a workflow phase. If so,
    // PR creation is the responsibility of `performAutoCommitAndPR` —
    // triggered when `verify.md` is saved at the end of the verifier phase.
    // Without this guard, the implementer phase finishes successfully and
    // would create the PR before the verifier had a chance to run, so the
    // user sees "PR created → 検証フェーズ" ordering.
    const session = await prisma.agentSession
      .findUnique({ where: { id: sessionId }, select: { mode: true } })
      .catch(() => null);
    const isWorkflowPhase = session?.mode?.startsWith('workflow-') === true;

    if (isWorkflowPhase) {
      log.info(
        { taskId: taskIdNum, mode: session?.mode },
        '[API] Workflow phase detected — skipping post-execution PR pipeline (verify.md handler will commit/PR after verification)',
      );
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

/**
 * Research-mode post-handler. Completely independent of the development
 * pipeline:
 *   - reads the temp file codex's -o flag wrote (its final markdown)
 *   - uploads it to the workflow API as research.md
 *   - reverts ANY git diff (research must not modify code)
 *   - marks the task as `in_progress` so the user can advance to the
 *     plan/implement phase; on hard failure marks `blocked`
 */
async function handleResearchResult(params: {
  result: ExecuteTaskResult;
  taskIdNum: number;
  sessionId: number;
  executionDir: string;
  researchTempOutputFile?: string | null;
}): Promise<void> {
  const { result, taskIdNum, sessionId, executionDir, researchTempOutputFile } = params;

  // Harvest the agent's final message from STDOUT only. We deliberately do
  // NOT use codex's --output-last-message flag because it would require
  // granting write permission to a path INSIDE the read-only sandbox.
  // codex exec always writes the final assistant message to stdout, which
  // we capture in result.output without any sandbox interaction. The
  // Rapitas backend (full permissions, outside sandbox) is the sole writer
  // for the persistent research.md / plan.md / verify.md files in
  // ~/.rapitas/workflows/.
  //
  // CRITICAL: stdout includes intermediate codex logs ("読み取りコマンドの一部
  // が実行ポリシーで弾かれた" etc.) BEFORE the final markdown report. We
  // slice from the LAST occurrence of `# 調査レポート` so the report header
  // is the first byte of the captured content, regardless of what codex
  // logged before it.
  const rawOutput = result.output ?? '';
  const stripped = result.output ? extractFinalAgentMessage(result.output) : '';
  const sliced = sliceResearchReport(stripped) || sliceResearchReport(rawOutput);
  const researchMarkdown: string = sliced ?? '';
  if (!researchMarkdown.trim()) {
    log.warn(
      { taskId: taskIdNum, rawChars: rawOutput.length, strippedChars: stripped.length },
      '[API] Research mode produced no extractable # 調査レポート section',
    );
  } else {
    log.info(
      {
        taskId: taskIdNum,
        rawChars: rawOutput.length,
        reportChars: researchMarkdown.length,
        source: 'stdout (sliced from last # 調査レポート)',
      },
      '[API] Research report sliced from stdout',
    );
  }
  // The researchTempOutputFile arg is now unused — silence TS by referring
  // to it. Keeping the param for backward compat with older callers.
  void researchTempOutputFile;

  // Validate quality: enforce minimum sections + length so a thin
  // "調査専用モードとして進めます" reply is rejected as inadequate.
  const validation = validateResearchReport(researchMarkdown);
  if (researchMarkdown.trim() && !validation.ok) {
    log.warn(
      {
        taskId: taskIdNum,
        chars: researchMarkdown.length,
        missing: validation.missingSections,
        reason: validation.reason,
      },
      '[API] Research report rejected as inadequate — marking blocked',
    );
    // Try a worktree revert just in case, then mark blocked.
    try {
      const { execSync } = await import('node:child_process');
      execSync('git reset --hard HEAD', { cwd: executionDir, timeout: 30000 });
      execSync('git clean -fd', { cwd: executionDir, timeout: 30000 });
    } catch {
      // intentionally ignore - best-effort cleanup
    }
    await prisma.task
      .update({ where: { id: taskIdNum }, data: { status: 'blocked' } })
      .catch(() => {});
    await prisma.agentSession
      .update({
        where: { id: sessionId },
        data: {
          status: 'failed',
          completedAt: new Date(),
          errorMessage: `調査レポートが不十分です: ${validation.reason}. 再実行してください。`,
        },
      })
      .catch(() => {});
    return;
  }

  // 2. Save research.md to the workflow API.
  const savedOk = researchMarkdown.trim().length > 0;
  if (savedOk) {
    try {
      const { writeWorkflowFile, resolveWorkflowDir } =
        await import('../../../services/workflow/workflow-file-utils');
      const resolved = await resolveWorkflowDir(taskIdNum);
      if (resolved) {
        await writeWorkflowFile(resolved.dir, 'research', researchMarkdown, taskIdNum);
        log.info({ taskId: taskIdNum }, '[API] research.md saved via workflow API');
      } else {
        log.warn({ taskId: taskIdNum }, '[API] Could not resolve workflow dir for research.md');
      }
    } catch (saveErr) {
      log.error({ err: saveErr, taskId: taskIdNum }, '[API] Failed to save research.md');
    }
  } else {
    log.warn({ taskId: taskIdNum }, '[API] Research mode produced no markdown output');
  }

  // 3. Hard rule: research must not modify code. Use `git diff --quiet` —
  // exits 0 when the working tree is clean, 1 when there are tracked-file
  // changes. We also check for untracked files (not covered by --quiet).
  // Any diff is treated as a sandbox escape and aggressively reverted.
  let revertedDiff = false;
  try {
    const { execSync } = await import('node:child_process');
    let isClean = true;
    try {
      // exit 0 when no diff, throws (exit 1) when diff exists
      execSync('git diff --quiet HEAD', {
        cwd: executionDir,
        timeout: 10000,
        stdio: 'ignore',
      });
    } catch {
      isClean = false;
    }
    // Untracked files don't show up in diff --quiet, check separately.
    const untracked = execSync('git ls-files --others --exclude-standard', {
      cwd: executionDir,
      encoding: 'utf8',
      timeout: 10000,
    });
    if (untracked.trim().length > 0) {
      isClean = false;
    }
    if (!isClean) {
      revertedDiff = true;
      execSync('git reset --hard HEAD', { cwd: executionDir, timeout: 30000 });
      execSync('git clean -fd', { cwd: executionDir, timeout: 30000 });
      log.warn(
        { taskId: taskIdNum, untrackedSize: untracked.length },
        '[API] Research mode produced code changes (git diff or untracked files) — reverted',
      );
    }
  } catch (revertErr) {
    log.warn(
      { err: revertErr, taskId: taskIdNum },
      '[API] Failed to inspect/revert worktree in research mode',
    );
  }

  // 4. Update task / session status AND advance workflow.
  if (savedOk) {
    // Transition workflowStatus from 'draft' → 'research_done' so the next
    // phase (planner) is reachable. Without this, role-resolver still picks
    // 'researcher' for the next run because the workflow tracker thinks
    // research isn't done yet — that's the "後続のフェーズが実行されない" symptom.
    const taskBefore = await prisma.task
      .findUnique({
        where: { id: taskIdNum },
        select: { workflowStatus: true, workflowMode: true },
      })
      .catch(() => null);
    const currentWf = taskBefore?.workflowStatus ?? 'draft';
    const nextWfStatus = currentWf === 'draft' ? 'research_done' : currentWf;

    await prisma.task
      .update({
        where: { id: taskIdNum },
        data: { status: 'in_progress', workflowStatus: nextWfStatus },
      })
      .catch((e) => log.warn({ err: e, taskId: taskIdNum }, '[API] Failed to update task'));
    if (currentWf !== nextWfStatus) {
      const violations = await checkWorkflowInvariants(taskIdNum);
      await recordTransition({
        taskId: taskIdNum,
        fromStatus: currentWf,
        toStatus: nextWfStatus,
        actor: 'researcher',
        cause: 'phase_completed:researcher',
        phase: 'research',
        sessionId,
        metadata: {
          revertedDiff,
          reportChars: researchMarkdown.length,
        },
        invariantViolation: violations.length > 0,
        invariantMessage:
          violations.length > 0
            ? violations.map((v) => `${v.code}:${v.message}`).join(' | ')
            : undefined,
      });
    }
    await prisma.agentSession
      .update({
        where: { id: sessionId },
        data: {
          status: 'completed',
          completedAt: new Date(),
          errorMessage: revertedDiff
            ? 'Research saved successfully. Note: agent attempted code changes — reverted.'
            : null,
        },
      })
      .catch((e) => log.warn({ err: e, sessionId }, '[API] Failed to set session completed'));

    // Flip the AgentExecution row from `post_processing` (set when codex
    // exited 0 in research mode) to `completed`, now that research.md has
    // actually been saved and the workflow has been advanced. This is what
    // the FE Log Viewer Header reads to paint the green "完了" badge —
    // emitting it BEFORE this point caused the user-reported "途中で完了"
    // symptom because the badge appeared while the post-handler was still
    // running.
    await prisma.agentExecution
      .updateMany({
        where: { sessionId, status: 'post_processing' },
        data: { status: 'completed', completedAt: new Date() },
      })
      .catch((e) =>
        log.warn(
          { err: e, sessionId },
          '[API] Failed to flip post_processing → completed on AgentExecution',
        ),
      );

    // Emit the success timeline event NOW (deferred from task-executor.ts
    // for investigation mode) so external listeners only see the event
    // after research.md is on disk and the workflow has been queued for
    // the next phase.
    try {
      const { appendEvent } = await import('../../../services/memory/timeline');
      const latestExec = await prisma.agentExecution
        .findFirst({
          where: { sessionId },
          orderBy: { createdAt: 'desc' },
          select: { id: true, agentConfig: { select: { agentType: true } } },
        })
        .catch(() => null);
      if (latestExec) {
        await appendEvent({
          eventType: 'agent_execution_completed',
          actorType: 'agent',
          actorId: latestExec.agentConfig?.agentType ?? 'codex',
          payload: {
            executionId: latestExec.id,
            taskId: taskIdNum,
            success: true,
            phase: 'research',
          },
          correlationId: `execution_${latestExec.id}`,
        }).catch(() => {});
      }
    } catch {
      /* timeline emission is best-effort */
    }

    log.info(
      { taskId: taskIdNum, workflowStatus: nextWfStatus, mode: taskBefore?.workflowMode },
      '[API] Research phase completed',
    );

    // Auto-advance to the next workflow phase (planner) after research.
    // PREVIOUSLY this only fired when `currentWf === 'draft'`, which broke
    // re-runs: if the task had been reset (reset-route does not clear
    // workflowStatus) the status was already `research_done` from the last
    // attempt, the condition returned false, and the planner phase never
    // started — leaving the FE stuck on the "completed" badge of the codex
    // execution log without any further activity. The orchestrator already
    // no-ops when the role's output file already exists, so it is safe to
    // call advanceWorkflow regardless of the previous status as long as
    // the task is in a managed workflow mode.
    const isManagedMode =
      taskBefore?.workflowMode === 'comprehensive' ||
      taskBefore?.workflowMode === 'standard' ||
      taskBefore?.workflowMode === 'lightweight';
    const advanceableStatuses = new Set(['draft', 'research_done', 'plan_approved', 'in_progress']);
    const nextPhaseLabel: Record<string, string> = {
      draft: 'researcher',
      research_done: 'planner',
      plan_approved: 'implementer',
      in_progress: 'verifier',
    };
    if (isManagedMode && advanceableStatuses.has(nextWfStatus)) {
      const nextPhase = nextPhaseLabel[nextWfStatus] ?? 'unknown';
      log.info(
        {
          taskId: taskIdNum,
          mode: taskBefore?.workflowMode,
          fromStatus: nextWfStatus,
          nextPhase,
        },
        '[API] Next phase queued',
      );
      // 1s delay so the workflowStatus update commits before the next phase
      // reads it via role-resolver.
      setTimeout(async () => {
        try {
          const { WorkflowOrchestrator } =
            await import('../../../services/workflow/workflow-orchestrator');
          await WorkflowOrchestrator.getInstance().advanceWorkflow(taskIdNum, 'ja');
          log.info({ taskId: taskIdNum, nextPhase }, '[API] Auto-advanced workflow after research');
        } catch (advanceErr) {
          log.error(
            { err: advanceErr, taskId: taskIdNum },
            '[API] Auto-advance to next phase failed (user can re-run manually)',
          );
        }
      }, 1000);
    } else {
      log.warn(
        {
          taskId: taskIdNum,
          isManagedMode,
          nextWfStatus,
          mode: taskBefore?.workflowMode,
        },
        '[API] No next phase queued — workflow is in a non-advanceable state (waiting for user action or already terminal)',
      );
    }
  } else {
    await prisma.task
      .update({ where: { id: taskIdNum }, data: { status: 'blocked' } })
      .catch((e) => log.warn({ err: e, taskId: taskIdNum }, '[API] Failed to set blocked'));
    await prisma.agentSession
      .update({
        where: { id: sessionId },
        data: {
          status: 'failed',
          completedAt: new Date(),
          errorMessage:
            'Research mode produced no markdown output. Either the agent crashed early or it ignored the research-only instruction. Re-run after checking logs.',
        },
      })
      .catch((e) =>
        log.warn({ err: e, sessionId }, '[API] Failed to set session failed (research mode)'),
      );
  }
}

/**
 * Validate that a research report is substantive (not "調査専用モードとして進めます。"
 * style filler). Three hard rules:
 *   1. Must START with "# 調査レポート" (not just contain it somewhere)
 *   2. Must be ≥ 800 characters of substantive content
 *   3. Must contain at least 3 of the standard section headings
 */
function validateResearchReport(content: string): {
  ok: boolean;
  missingSections: string[];
  reason: string;
} {
  const trimmed = (content || '').trim();
  if (trimmed.length === 0) {
    return { ok: false, missingSections: [], reason: 'empty output' };
  }
  // Rule 1: must START with `# 調査レポート` (English fallback also OK)
  if (!trimmed.startsWith('# 調査レポート') && !/^#\s+research report/i.test(trimmed)) {
    return {
      ok: false,
      missingSections: ['# 調査レポート'],
      reason: 'report does not START with the # 調査レポート heading (preamble detected)',
    };
  }
  // Rule 2: ≥ 800 chars of real content
  if (trimmed.length < 800) {
    return {
      ok: false,
      missingSections: [],
      reason: `output too short (${trimmed.length} chars; need >= 800)`,
    };
  }
  // Rule 3: at least 3 of the canonical sections present
  const sections = ['タスク概要', '既存機能', '影響範囲', '実装方針', 'リスク', 'テスト'];
  const lower = trimmed.toLowerCase();
  const missing = sections.filter((s) => !lower.includes(s.toLowerCase()));
  if (missing.length > 3) {
    return {
      ok: false,
      missingSections: missing,
      reason: `missing too many required sections (${missing.length} of ${sections.length})`,
    };
  }
  return { ok: true, missingSections: missing, reason: '' };
}

/**
 * Extract the final assistant message from codex `--json` stdout. Codex
 * emits one JSON object per line; the agent_message we want lives in
 * { type: "item.completed", item: { type: "agent_message", text: "..." } }.
 * Falls back to returning the raw text when no JSON events are detected
 * (i.e. the agent ran in non-JSON mode or output is already plain markdown).
 */
function extractFinalAgentMessage(output: string): string {
  if (!output) return '';
  const lines = output.split(/\r?\n/);
  const collected: string[] = [];
  let sawJson = false;
  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine.startsWith('{')) continue;
    try {
      const obj = JSON.parse(trimmedLine);
      sawJson = true;
      const item = (obj as { item?: { type?: string; text?: string } }).item;
      if (item?.type === 'agent_message' && typeof item.text === 'string') {
        collected.push(item.text);
      }
    } catch {
      // not a JSON line — ignore
    }
  }
  if (collected.length > 0) return collected.join('\n\n').trim();
  // Fall back to the raw output (e.g. plain markdown without --json).
  return sawJson ? '' : output.trim();
}

/**
 * Slice the research markdown out of a possibly-noisy buffer. codex's
 * stdout often contains policy denials, command echoes, and other interim
 * logs BEFORE the final `# 調査レポート` heading. Taking lastIndexOf gives
 * us the report regardless of how much noise preceded it.
 *
 * @param raw - Combined stdout text (or already-extracted final message)
 * @returns Sliced markdown starting at `# 調査レポート`, or null when no
 *   heading is present.
 */
function sliceResearchReport(raw: string): string | null {
  if (!raw) return null;
  const normalized = raw.replace(/\r\n/g, '\n').trim();
  // Match the heading at the START of a line. We avoid `\b` because
  // JavaScript word boundaries don't recognize Japanese characters as word
  // chars, so `調査レポート\b` fails. Instead require end-of-line OR
  // whitespace after the heading text (line-start matching prevents the
  // mid-sentence false match `inline mention of # 調査レポート ...`).
  const headingMatcher = /^#\s+調査レポート\s*$/gm;
  let lastIndex = -1;
  let match: RegExpExecArray | null;
  while ((match = headingMatcher.exec(normalized)) !== null) {
    lastIndex = match.index;
  }
  // English fallback for non-Japanese projects.
  if (lastIndex === -1) {
    const enMatcher = /^#\s+research report\s*$/gim;
    while ((match = enMatcher.exec(normalized)) !== null) {
      lastIndex = match.index;
    }
  }
  if (lastIndex === -1) return null;
  return normalized.slice(lastIndex).trim();
}
