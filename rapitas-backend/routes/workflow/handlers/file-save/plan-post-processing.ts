/**
 * FileSave Plan Post-Processing
 *
 * Post-save processing for plan.md: subtask auto-splitting (feature-gated) and
 * plan auto-approval (with subtask enqueueing when split).
 * Not responsible for the critic gate or verify-phase processing.
 */

import { createLogger } from '../../../../config/logger';
import { prisma } from '../../../../config/database';
import type { WorkflowFileType } from '../../core/workflow-helpers';
import { readWorkflowFile } from '../../../../services/workflow/workflow-file-utils';
import { maybeAutoApprovePlan } from '../../../../services/workflow/plan-auto-approve';
// NOTE: Moved to the shared policy module so the planner instruction builders
// and this auto-split trigger read the SAME flag logic (task 545).
import { isSubtaskSplitEnabled } from '../../../../services/workflow/subtask-split-policy';
import { parsePlanFiles } from '../../../../services/agents/verification/scope-check';
import { isSchemaFilePath } from '../../../../services/agents/verification/schema-change-gate';
import { recordTransition } from '../../../../services/workflow/transition-recorder';

const log = createLogger('routes:workflow:handlers:files');

/**
 * Result of the plan post-processing stage: possibly auto-approved newStatus,
 * the auto-approval flag, and the subtask-split result (null when not split).
 */
export interface PlanPostProcessingOutcome {
  newStatus?: string;
  autoApproved: boolean;
  splitResult: { subtasksCreated: number; subtaskIds: number[] } | null;
}

/**
 * Runs subtask auto-splitting and plan auto-approval after a plan.md save.
 *
 * @param params - taskId / fileType / current newStatus / raw content / language / 入力一式
 * @returns The post-processing outcome (pass-through when not a plan_created save)
 */
export async function runPlanPostProcessing(params: {
  taskId: number;
  fileType: WorkflowFileType;
  newStatus: string | undefined;
  content: string;
  fileLanguage: 'ja' | 'en';
}): Promise<PlanPostProcessingOutcome> {
  const { taskId, fileType, content, fileLanguage } = params;
  let newStatus = params.newStatus;

  // Auto-split into subtasks when plan.md is saved and task is large enough.
  // Gated OFF by default — see isSubtaskSplitEnabled for why.
  let splitResult: { subtasksCreated: number; subtaskIds: number[] } | null = null;
  if (fileType === 'plan' && newStatus === 'plan_created' && isSubtaskSplitEnabled()) {
    try {
      const { analyzePlanForSplitting, createSubtasksFromPlan } =
        await import('../../../../services/workflow/subtask-splitter');
      const analysis = analyzePlanForSplitting(content);
      if (analysis.shouldSplit) {
        log.info(`[Workflow] Task ${taskId} plan triggers split: ${analysis.reason}`);
        // Load research.md for context inheritance
        const researchContent =
          (await readWorkflowFile(taskId, 'research').catch(() => null)) ?? undefined;

        const result = await createSubtasksFromPlan(taskId, analysis, researchContent, content);
        if (result.success) {
          splitResult = {
            subtasksCreated: result.subtasksCreated,
            subtaskIds: result.subtaskIds,
          };
          log.info(`[Workflow] Created ${result.subtasksCreated} subtasks for task ${taskId}`);
        }
      }
    } catch (splitErr) {
      log.error({ err: splitErr }, `[Workflow] Subtask splitting failed for task ${taskId}`);
    }
  }

  // Auto-approve when saving plan.md if autoApprovePlan is enabled.
  // Delegates to the shared helper so the orchestrator-driven save
  // path (workflow-cli-executor) and this HTTP path stay in sync.
  // EXCEPTION (task 1059): a plan declaring a Prisma schema change is never
  // eligible for auto-approval — only a human `approve-plan` call with
  // overrideForbiddenChange:true can advance it (see workflow-handlers-plan.ts).
  // A stale override from a prior plan revision is reset here so it never
  // silently carries over to a differently-scoped schema change.
  let autoApproved = false;
  if (fileType === 'plan' && newStatus === 'plan_created') {
    const declaredSchemaFiles = parsePlanFiles(content).filter(isSchemaFilePath);
    if (declaredSchemaFiles.length > 0) {
      await prisma.task.update({
        where: { id: taskId },
        data: { forbiddenChangeOverride: false },
      });
      await recordTransition({
        taskId,
        fromStatus: 'plan_created',
        toStatus: 'plan_created',
        actor: 'system',
        cause: 'auto_approve_blocked_forbidden_change',
        phase: 'plan',
        metadata: { declaredSchemaFiles },
      });
    } else {
      const task = await prisma.task.findUnique({
        where: { id: taskId },
        select: { forbiddenChangeOverride: true },
      });
      if (task?.forbiddenChangeOverride === true) {
        await prisma.task.update({
          where: { id: taskId },
          data: { forbiddenChangeOverride: false },
        });
      }

      // When the plan was split into subtasks the parent must NOT advance to
      // its own implementer phase — the subtasks do the work. Approve without
      // auto-advancing the parent, then enqueue the subtasks for sequential run.
      const approval = await maybeAutoApprovePlan(taskId, fileLanguage, {
        autoAdvance: !splitResult,
      });
      if (approval.autoApproved) {
        newStatus = 'plan_approved';
        autoApproved = true;
        if (splitResult && splitResult.subtaskIds.length > 0) {
          try {
            const { AIOrchestra } = await import('../../../../services/workflow/ai-orchestra');
            await AIOrchestra.getInstance().enqueueSubtasksForExecution(taskId);
          } catch (enqErr) {
            log.error(
              { err: enqErr, taskId },
              '[Workflow] Failed to enqueue subtasks for execution after auto-approval',
            );
          }
        }
      }
    }
  }

  return { newStatus, autoApproved, splitResult };
}
