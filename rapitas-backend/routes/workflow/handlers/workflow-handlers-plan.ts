/**
 * Workflow Plan Handlers
 *
 * Route handlers for plan approval and workflow advancement.
 * Not responsible for file I/O, mode management, or complexity analysis.
 */

import { prisma } from '../../../config';
import { NotFoundError, ValidationError, parseId } from '../../../middleware/error-handler';
import { createLogger } from '../../../config/logger';
import { recordTransition } from '../../../services/workflow/transition-recorder';
import { resolveTaskWorkflowState } from '../../../services/task/task-resolver';
import { HTTP_STATUS } from '../../../utils/common/http-status';
import { readPromptLanguage } from '../../../services/system/prompt-language-store';
import { readWorkflowFile } from '../../../services/workflow/workflow-file-utils';
import { parsePlanFiles } from '../../../services/agents/verification/scope-check';
import { isSchemaFilePath } from '../../../services/agents/verification/schema-change-gate';
import { humanSourceLabel } from '../../../utils/common/human-source';

// NOTE: re-exported so existing importers keep their path after the split.
export { handleUpdateStatus } from './status';

const log = createLogger('routes:workflow:handlers:plan');

/**
 * Callers permitted to approve a plan, and how each is labelled. Same
 * `ui`/`operator` set as revise-plan / answer-question — approving a plan is a
 * human act, and an agent must not approve its own plan (task 1059 AC2).
 */
const APPROVE_PLAN_SOURCE_LABELS: Record<string, string> = {
  ui: 'UI',
  operator: 'Operator',
};

/**
 * Handler for POST /tasks/:taskId/approve-plan
 * Approves or rejects a plan and optionally auto-advances the workflow.
 *
 * @param params - Route params with taskId / ルートパラメータ
 * @param body - Request body with approved flag, optional reason, override fields and language / リクエストボディ
 * @param headers - Request headers, checked for X-Rapitas-Source (ui|operator) / リクエストヘッダ
 * @param set - Elysia response set / Elysiaレスポンス
 * @returns Updated task and workflow status
 * @throws {ValidationError} When approved is not a boolean, the source header is missing/invalid,
 *   or the plan declares a schema change without a valid override
 * @throws {NotFoundError} When task does not exist
 */
export async function handleApprovePlan({
  params,
  body,
  headers,
  set: _set,
}: {
  params: { taskId: string };
  body: unknown;
  headers?: Record<string, string | undefined>;
  set: { status: number };
}) {
  try {
    const taskId = parseId(params.taskId, 'task ID');

    const parsedBody = body as {
      approved: boolean;
      reason?: string;
      language?: 'ja' | 'en';
      overrideForbiddenChange?: boolean;
      overrideReason?: string;
      /** Reviewer's judgement comment saved in the deviation audit (task 1218). */
      comment?: string;
    };
    if (typeof parsedBody?.approved !== 'boolean') {
      throw new ValidationError('approved (boolean) is required');
    }
    const language = parsedBody?.language || readPromptLanguage();

    // Approving a plan is a human act — the same class as revise-plan and
    // answer-question. An agent must not approve its own plan by shelling out
    // curl (task 1059 AC2: the only prior guard on this endpoint was none).
    const rawSource = headers?.['x-rapitas-source'];
    const source = typeof rawSource === 'string' ? rawSource.toLowerCase() : '';
    if (!humanSourceLabel(rawSource, APPROVE_PLAN_SOURCE_LABELS)) {
      log.warn(
        { taskId, source: rawSource ?? null },
        '[Workflow] Rejected approve-plan: missing X-Rapitas-Source header (likely an agent shell-call)',
      );
      await recordTransition({
        taskId,
        fromStatus: null,
        toStatus: 'plan_created',
        actor: 'system',
        cause: 'plan_approval_blocked',
        metadata: {
          reason: 'missing X-Rapitas-Source(ui|operator) header',
          source: rawSource ?? null,
        },
        invariantViolation: true,
        invariantMessage: 'Agent attempted to call approve-plan without a ui|operator header',
      });
      throw new ValidationError(
        '計画承認には X-Rapitas-Source ヘッダ(ui|operator)が必要です。エージェントは自身の計画を承認できません。',
      );
    }

    const task = await resolveTaskWorkflowState(taskId);
    if (!task) {
      throw new NotFoundError('Task not found');
    }

    // A plan declaring a Prisma schema change requires an explicit human
    // override — plan.md declaring the file is necessary but not sufficient
    // (task 1059; see schema-change-gate.ts's module header). Rejection here
    // only applies to approvals; a rejection (approved:false) never needs it.
    let forbiddenChangeUpdate: {
      forbiddenChangeOverride: true;
      forbiddenChangeOverrideReason: string;
    } | null = null;
    if (parsedBody.approved) {
      const planContent = await readWorkflowFile(taskId, 'plan').catch(() => null);
      const declaresSchemaChange = parsePlanFiles(planContent ?? '').some(isSchemaFilePath);
      if (declaresSchemaChange) {
        const overrideReason = parsedBody.overrideReason?.trim();
        if (parsedBody.overrideForbiddenChange !== true || !overrideReason) {
          throw new ValidationError(
            'このplanはPrismaスキーマ変更を含みます。承認するには overrideForbiddenChange:true と overrideReason を指定してください。',
          );
        }
        forbiddenChangeUpdate = {
          forbiddenChangeOverride: true,
          forbiddenChangeOverrideReason: overrideReason,
        };
      }
    }

    const newStatus = parsedBody.approved ? 'plan_approved' : 'plan_created';

    const updatedTask = await prisma.task.update({
      where: { id: taskId },
      data: {
        workflowStatus: newStatus,
        updatedAt: new Date(),
        ...(forbiddenChangeUpdate ?? {}),
      },
    });

    await recordTransition({
      taskId,
      fromStatus: task.workflowStatus ?? null,
      toStatus: newStatus,
      actor: 'user',
      cause: parsedBody.approved ? 'manual_plan_approved' : 'manual_plan_rejected',
      phase: 'plan',
      metadata: {
        reason: parsedBody.reason ?? null,
        ...(forbiddenChangeUpdate
          ? {
              overrideForbiddenChange: true,
              overrideReason: forbiddenChangeUpdate.forbiddenChangeOverrideReason,
            }
          : {}),
      },
    });

    // Decision journal: every human gate call becomes a calibratable
    // prediction (correct/wrong once the task reaches a terminal outcome), so
    // human approval accuracy is measurable against the auto-approve policy.
    // Fire-and-forget — journaling never blocks the approval.
    void import('../../../services/memory/decision-journal')
      .then(({ recordPlanDecision }) =>
        recordPlanDecision({
          taskId,
          approved: parsedBody.approved,
          decidedBy: 'user',
          reason: parsedBody.reason ?? null,
          taskTitle: updatedTask.title,
          themeId: updatedTask.themeId,
        }),
      )
      .catch(() => {});

    await prisma.activityLog.create({
      data: {
        taskId,
        action: parsedBody.approved ? 'plan_approved' : 'plan_rejected',
        metadata: JSON.stringify({
          reason: parsedBody.reason,
          previousStatus: task.workflowStatus,
          newStatus,
        }),
        createdAt: new Date(),
      },
    });

    // Deviation audit (task 1218): counts / kinds / comment. Never blocks approval.
    const deviationAudit = await import('../deviation/deviation-handlers')
      .then(({ recordApprovalDeviationAudit }) =>
        recordApprovalDeviationAudit({
          taskId,
          decision: parsedBody.approved ? 'approved' : 'rejected',
          comment: typeof parsedBody.comment === 'string' ? parsedBody.comment : null,
          source,
        }),
      )
      .catch((err: unknown) => ({ saved: false as const, error: String(err) }));

    if (parsedBody.approved) {
      // Release waiting_approval queue items (also covers the subtask branch,
      // which never reaches resumeAfterApproval), then resume a paused theme.
      try {
        const { syncAfterPlanApprovalAndNotifyTheme } =
          await import('../../../services/workflow/plan-approval-queue-sync');
        await syncAfterPlanApprovalAndNotifyTheme(taskId);
      } catch (err) {
        log.warn({ err }, '[Workflow] Failed to notify ThemeAutoRunScheduler of plan approval');
      }

      try {
        const { AIOrchestra } = await import('../../../services/workflow/ai-orchestra');
        const orchestra = AIOrchestra.getInstance();

        // If the plan was split into subtasks, the parent does NOT implement
        // directly — enqueue the subtasks for sequential execution instead of
        // advancing the parent to its own implementer phase. Completing the last
        // subtask triggers the parent's integration verify.md (→ PR → done).
        const pendingSubtasks = await prisma.task.count({
          where: { parentId: taskId, status: { notIn: ['done', 'cancelled', 'archived'] } },
        });

        if (pendingSubtasks > 0) {
          await orchestra.enqueueSubtasksForExecution(taskId);
        } else {
          orchestra.handlePlanApproved(taskId).catch((err) => {
            log.warn(
              { err },
              `[Workflow] Orchestra resume failed for task ${taskId}, falling back to direct advance`,
            );
          });

          const { WorkflowOrchestrator } =
            await import('../../../services/workflow/workflow-orchestrator');
          WorkflowOrchestrator.getInstance()
            .advanceWorkflow(taskId, language)
            .then((result) => {
              log.info(
                `[Workflow] Auto-advance after approval for task ${taskId}: ${result.success ? 'success' : result.error}`,
              );
            })
            .catch((err) => {
              log.error(
                { err },
                `[Workflow] Auto-advance after approval failed for task ${taskId}`,
              );
            });
        }
      } catch (err) {
        log.error({ err }, '[Workflow] Failed to auto-advance after approval');
      }
    }

    return {
      success: true,
      task: updatedTask,
      workflowStatus: newStatus,
      autoAdvance: parsedBody.approved,
      deviationAudit,
    };
  } catch (err) {
    if (err instanceof ValidationError || err instanceof NotFoundError) throw err;
    log.error({ err }, 'Error approving plan');
    throw err;
  }
}

/**
 * Handler for POST /workflow/tasks/:taskId/advance (the 「進める」 button)
 * Advances the workflow to the next phase asynchronously.
 *
 * @param params - Route params with taskId / ルートパラメータ
 * @param body - Optional body with language preference / リクエストボディ
 * @param set - Elysia response set / Elysiaレスポンス
 * @returns Immediate response or quick result if phase completes under 100ms
 * @throws {ValidationError} When taskId is invalid
 */
export async function handleAdvanceWorkflow({
  params,
  body,
  set,
}: {
  params: { taskId: string };
  body: unknown;
  set: { status: number };
}) {
  try {
    const taskId = parseId(params.taskId, 'task ID');
    const parsedBody = body as { language?: 'ja' | 'en' } | undefined;
    const language = parsedBody?.language || readPromptLanguage();

    const { WorkflowOrchestrator } =
      await import('../../../services/workflow/workflow-orchestrator');
    const orchestrator = WorkflowOrchestrator.getInstance();
    const resultPromise = orchestrator.advanceWorkflow(taskId, language);

    // Return synchronous error for immediate failures (validation errors, etc.)
    // Wait 100ms and check if any errors occurred
    const quickResult = await Promise.race([
      resultPromise,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 100)),
    ]);

    if (quickResult !== null) {
      if (!quickResult.success) set.status = HTTP_STATUS.BAD_REQUEST;
      return quickResult;
    }

    resultPromise
      .then(async (result) => {
        log.info(
          `[Workflow] Advance completed for task ${taskId}: ${result.success ? 'success' : result.error}`,
        );
      })
      .catch((err) => {
        log.error({ err }, `[Workflow] Advance failed for task ${taskId}`);
      });

    return { success: true, message: 'Workflow phase execution started', taskId, async: true };
  } catch (err) {
    if (err instanceof ValidationError || err instanceof NotFoundError) throw err;
    log.error({ err }, 'Error advancing workflow');
    throw err;
  }
}
