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

const log = createLogger('routes:workflow:handlers:files');

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
