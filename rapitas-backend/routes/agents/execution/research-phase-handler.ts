/**
 * execution/research-phase-handler
 *
 * Post-execution handler for research-mode agent runs. Completely independent
 * of the development pipeline: reads the agent's stdout, saves research.md via
 * the workflow API, reverts any code changes, and advances the workflow to the
 * next phase.
 * Separated from execute-post-handler.ts to keep each file under 500 lines.
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { prisma } from '../../../config/database';
import { createLogger } from '../../../config/logger';
import { recordTransition } from '../../../services/workflow/transition-recorder';
import { checkWorkflowInvariants } from '../../../services/workflow/workflow-invariants';
import {
  isIsolatedWorktree,
  validateResearchReport,
  extractFinalAgentMessage,
  sliceResearchReport,
} from './research-output-utils';

// Async git so the post-execution revert never blocks the single-threaded event
// loop. Synchronous execSync('git reset/clean', timeout 30s) here would freeze
// ALL HTTP requests (e.g. the UI's GET /tasks/:id) for up to 30s when a git op
// is slow/locked.
const execAsync = promisify(exec);

const log = createLogger('routes:agent-execution:research-phase-handler');

/** Shape of the result returned by agentWorkerManager.executeTask. */
interface ExecuteTaskResult {
  success: boolean;
  waitingForInput?: boolean;
  output?: string;
  errorMessage?: string;
  executionTimeMs?: number;
}

/** Parameters for handleResearchResult. */
export interface HandleResearchResultParams {
  result: ExecuteTaskResult;
  taskIdNum: number;
  sessionId: number;
  executionDir: string;
  researchTempOutputFile?: string | null;
}

/**
 * Research-mode post-handler. Completely independent of the development
 * pipeline:
 *   - reads the temp file codex's -o flag wrote (its final markdown)
 *   - uploads it to the workflow API as research.md
 *   - reverts ANY git diff (research must not modify code)
 *   - marks the task as `in_progress` so the user can advance to the
 *     plan/implement phase; on hard failure marks `blocked`
 *
 * @param params - Research execution context / リサーチ実行コンテキスト
 */
export async function handleResearchResult(params: HandleResearchResultParams): Promise<void> {
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
    // Try a worktree revert just in case, then mark blocked. Only ever reset an
    // isolated worktree (never the main checkout), and do it async so a slow git
    // op cannot freeze the event loop.
    if (isIsolatedWorktree(executionDir)) {
      try {
        await execAsync('git reset --hard HEAD', { cwd: executionDir, timeout: 30000 });
        await execAsync('git clean -fd', { cwd: executionDir, timeout: 30000 });
      } catch {
        // intentionally ignore - best-effort cleanup
      }
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
    let isClean = true;
    try {
      // resolves when clean (exit 0), rejects (exit 1) when there is a diff
      await execAsync('git diff --quiet HEAD', { cwd: executionDir, timeout: 10000 });
    } catch {
      isClean = false;
    }
    // Untracked files don't show up in diff --quiet, check separately.
    const { stdout: untracked } = await execAsync('git ls-files --others --exclude-standard', {
      cwd: executionDir,
      encoding: 'utf8',
      timeout: 10000,
    });
    if (untracked.trim().length > 0) {
      isClean = false;
    }
    if (!isClean && !isIsolatedWorktree(executionDir)) {
      // The research phase runs in process.cwd() (the main checkout). NEVER
      // hard-reset it — that wipes the user's / platform's uncommitted work
      // (it has, in practice, eaten in-flight edits). Only worktrees are reset.
      log.warn(
        { taskId: taskIdNum, executionDir },
        '[API] Research produced changes in the main checkout — NOT reverting (would clobber uncommitted work)',
      );
    } else if (!isClean) {
      revertedDiff = true;
      await execAsync('git reset --hard HEAD', { cwd: executionDir, timeout: 30000 });
      await execAsync('git clean -fd', { cwd: executionDir, timeout: 30000 });
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
        // task.status is hyphenated; workflowStatus uses the underscore form.
        data: { status: 'in-progress', workflowStatus: nextWfStatus },
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
