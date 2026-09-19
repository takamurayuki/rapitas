/**
 * Workflow CLI Executor Harvest
 *
 * Harvests an investigation-phase CLI agent's clean final message into the
 * workflow artifact (research/plan/verify.md). Split out of
 * workflow-cli-executor-epilogue.ts (COMPONENT_SPLITTING_POLICY.md §2) — not
 * responsible for phase-status resolution, which stays in the epilogue.
 */
import { prisma } from '../../config';
import { createLogger } from '../../config/logger';
import type { AgentOrchestrator } from '../agents/agent-orchestrator';
import { writeWorkflowFile, extractMarkdownFromOutput } from './workflow-file-utils';
import type { RoleTransition } from './workflow-types';
import { requirementReplannedSince } from './requirement-replan-guard';

// NOTE: Same logger name as the executor body — keeps the observed log `name`
// field identical after the file split.
const log = createLogger('workflow-cli-executor');

type ExecuteTaskResult = Awaited<ReturnType<AgentOrchestrator['executeTask']>>;

/**
 * Harvest an investigation-phase agent's clean final message into the
 * workflow artifact (research/plan/verify.md), skipping the save when a
 * phase critic already rejected this artifact mid-run.
 *
 * @param params - Harvest inputs (task, transition, execute result, phase kind, start time) / ハーベスト入力一式
 */
export async function harvestInvestigationOutput(params: {
  taskId: number;
  transition: RoleTransition;
  result: ExecuteTaskResult;
  isInvestigationPhase: boolean;
  phaseStartedAt: Date;
}): Promise<void> {
  const { taskId, transition, result, isInvestigationPhase, phaseStartedAt } = params;
  if (await requirementReplannedSince(prisma, taskId, phaseStartedAt)) {
    log.info(
      { taskId },
      '[WorkflowCLIExecutor] Replan superseded this phase; skipping artifact harvest',
    );
    return;
  }

  // Investigation-mode result harvesting: if codex wrote to the temp file,
  // upload its contents to the workflow API server-side (codex itself
  // Investigation-phase harvest: capture stdout (result.output) and save it
  // to the workflow API as <outputFile>.md. codex `exec` writes the final
  // assistant message to stdout for any --sandbox mode, so this works
  // even with read-only sandbox where codex itself cannot write files.
  // Prefer the agent's CLEAN final message (stream-json `result` event) over
  // the raw outputBuffer. outputBuffer concatenates every streamed assistant
  // delta, tool-result display, and status line — which polluted research.md /
  // plan.md with mid-run narration ("研究レポートを書き出します…"), false-start
  // blocks, and tool dumps. finalMessage is just the final report.
  const rawInvestigation = result.finalMessage?.trim() || result.output?.trim();
  if (isInvestigationPhase && transition.outputFile && rawInvestigation) {
    // Never persist raw agent logs into the .md. When the agent crashes (e.g.
    // "Uncaught ReferenceError: Workflow is not defined") finalMessage is empty
    // and result.output is the full log-laden stdout buffer — extract the clean
    // report and quality-gate it. A null result (log-only output) means we write
    // NOTHING, so the phase fails cleanly instead of producing a poisoned file.
    const cleaned = extractMarkdownFromOutput(rawInvestigation, transition.outputFile);
    if (!cleaned) {
      log.warn(
        {
          taskId,
          role: transition.role,
          outputFile: transition.outputFile,
          rawChars: rawInvestigation.length,
          usedFinalMessage: !!result.finalMessage?.trim(),
        },
        '[WorkflowCLIExecutor] Agent output had no clean report (log-only) — skipping md write',
      );
    } else {
      // Critic-rejection guard: if the phase critic already REJECTED this
      // phase's artifact (rollback + archive) while the agent was finishing,
      // re-saving the agent's final message would RESURRECT the rejected
      // artifact byte-for-byte and flip the status forward again — exactly
      // how task 536's bounce loop never regenerated anything. Skip; the
      // bounced re-run produces the replacement.
      const { criticRejectedSince } = await import('./phase-critic/critic-rejection-guard');
      if (await criticRejectedSince(taskId, transition.outputFile, phaseStartedAt)) {
        log.warn(
          { taskId, role: transition.role, outputFile: transition.outputFile },
          '[WorkflowCLIExecutor] Critic rejected this artifact mid-phase — skipping harvest re-save (would resurrect the rejected content)',
        );
      } else {
        try {
          await writeWorkflowFile(taskId, transition.outputFile, cleaned);
          log.info(
            {
              taskId,
              role: transition.role,
              outputFile: transition.outputFile,
              chars: cleaned.length,
              usedFinalMessage: !!result.finalMessage?.trim(),
            },
            '[WorkflowCLIExecutor] Captured clean report and saved to workflow API',
          );
        } catch (captureErr) {
          log.warn(
            { err: captureErr, taskId, role: transition.role },
            '[WorkflowCLIExecutor] Failed to save report to workflow API',
          );
        }
      }
    }
  }
}
