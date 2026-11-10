/**
 * FileSave Verify Commit/PR — Post-Completion Side Effects
 *
 * Fires the fire-and-forget side effects after a task ACTUALLY completed
 * (telemetry, workflow learning, knowledge extraction, idea extraction,
 * reasoning trace). Not responsible for deciding completion.
 */

import { prisma } from '../../../../config';
import { createLogger } from '../../../../config/logger';
import { recordWorkflowCompletion } from '../../../../services/workflow/learning/workflow-learning-optimizer';
import { extractKnowledgeFromTask } from '../../../../services/memory/task-knowledge-extractor';
import { NOT_REVIEW_COST_ROW } from '../../../../services/agents/review-cost-rows';

const log = createLogger('routes:workflow:handlers:files');

/**
 * The completed run whose reasoning trace is recorded for a finished task.
 * Jury cost rows are `completed` too and finish after the run they judged, so
 * they are excluded — they carry no reasoning (G2 review item 2).
 *
 * @param taskId - Completed task / 完了したタスク
 * @returns Execution id, or null / 実行ID（無ければ null）
 */
export async function findReasoningTraceExecutionId(taskId: number): Promise<number | null> {
  const exec = await prisma.agentExecution
    .findFirst({
      where: { ...NOT_REVIEW_COST_ROW, session: { config: { taskId } }, status: 'completed' },
      orderBy: { completedAt: 'desc' },
      select: { id: true },
    })
    .catch(() => null);
  return exec?.id ?? null;
}

/**
 * Kicks off the post-completion fire-and-forget side effects for a completed
 * task. Never throws — every effect swallows its own failure.
 *
 * @param taskId - Completed task ID / 完了したタスクID
 * @param savedContent - The saved verify.md content (idea-extraction input) / 保存された verify.md 本文
 */
export function runVerifyCompletionSideEffects(taskId: number, savedContent: string): void {
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
      findReasoningTraceExecutionId(taskId)
        .then((id) => {
          if (id != null) recordReasoningTrace(id).catch(() => {});
        })
        .catch(() => {});
    })
    .catch(() => {});
}
