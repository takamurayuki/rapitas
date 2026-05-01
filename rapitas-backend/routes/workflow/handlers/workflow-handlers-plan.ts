/**
 * Workflow Plan and Status Handlers
 *
 * Route handlers for plan approval, manual status updates, and workflow advancement.
 * Not responsible for file I/O, mode management, or complexity analysis.
 */

import { prisma } from '../../../config';
import { NotFoundError, ValidationError, parseId } from '../../../middleware/error-handler';
import { createLogger } from '../../../config/logger';
import { VALID_WORKFLOW_STATUSES } from '../core/workflow-helpers';
import { recordTransition } from '../../../services/workflow/transition-recorder';

const log = createLogger('routes:workflow:handlers:plan');

/**
 * Handler for POST /tasks/:taskId/approve-plan
 * Approves or rejects a plan and optionally auto-advances the workflow.
 *
 * @param params - Route params with taskId / ルートパラメータ
 * @param body - Request body with approved flag, optional reason and language / リクエストボディ
 * @param set - Elysia response set / Elysiaレスポンス
 * @returns Updated task and workflow status
 * @throws {ValidationError} When approved is not a boolean
 * @throws {NotFoundError} When task does not exist
 */
export async function handleApprovePlan({
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

    const parsedBody = body as { approved: boolean; reason?: string; language?: 'ja' | 'en' };
    if (typeof parsedBody?.approved !== 'boolean') {
      throw new ValidationError('approved (boolean) is required');
    }
    const language = parsedBody?.language || 'ja';

    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task) {
      throw new NotFoundError('Task not found');
    }

    const newStatus = parsedBody.approved ? 'plan_approved' : 'plan_created';

    const updatedTask = await prisma.task.update({
      where: { id: taskId },
      data: { workflowStatus: newStatus, updatedAt: new Date() },
    });

    await recordTransition({
      taskId,
      fromStatus: task.workflowStatus ?? null,
      toStatus: newStatus,
      actor: 'user',
      cause: parsedBody.approved ? 'manual_plan_approved' : 'manual_plan_rejected',
      phase: 'plan',
      metadata: { reason: parsedBody.reason ?? null },
    });

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

    if (parsedBody.approved) {
      try {
        const { AIOrchestra } = await import('../../../services/workflow/ai-orchestra');
        AIOrchestra.getInstance()
          .handlePlanApproved(taskId)
          .catch((err) => {
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
            log.error({ err }, `[Workflow] Auto-advance after approval failed for task ${taskId}`);
          });
      } catch (err) {
        log.error({ err }, '[Workflow] Failed to auto-advance after approval');
      }
    }

    return {
      success: true,
      task: updatedTask,
      workflowStatus: newStatus,
      autoAdvance: parsedBody.approved,
    };
  } catch (err) {
    if (err instanceof ValidationError || err instanceof NotFoundError) throw err;
    log.error({ err }, 'Error approving plan');
    throw err;
  }
}

/**
 * Handler for PUT /tasks/:taskId/status
 * Manually updates the workflow status of a task.
 *
 * @param params - Route params with taskId / ルートパラメータ
 * @param body - Request body with status string / リクエストボディ
 * @param set - Elysia response set / Elysiaレスポンス
 * @returns Updated task and new workflow status
 * @throws {ValidationError} When status is invalid
 * @throws {NotFoundError} When task does not exist
 */
export async function handleUpdateStatus({
  params,
  body,
  headers,
  set,
}: {
  params: { taskId: string };
  body: unknown;
  headers?: Record<string, string | undefined>;
  set: { status: number };
}) {
  try {
    const taskId = parseId(params.taskId, 'task ID');

    const parsedBody = body as { status: string; reason?: string };
    if (
      !parsedBody?.status ||
      !(VALID_WORKFLOW_STATUSES as readonly string[]).includes(parsedBody.status)
    ) {
      throw new ValidationError(
        `Invalid status. Must be one of: ${VALID_WORKFLOW_STATUSES.join(', ')}`,
      );
    }

    // Block agents from calling this endpoint to bypass the file-save guard.
    // Past incidents had implementer phase claude-code agents calling
    // `PUT /tasks/:id/status` to bump themselves from plan_approved → in_progress
    // so they could then save verify.md. UI calls always set X-Source=ui or
    // similar. Server-internal callers don't go through HTTP at all (they
    // call `prisma.task.update` directly), so legitimate HTTP traffic for
    // this endpoint should always include the FE-emitted header.
    const source = headers?.['x-rapitas-source'];
    if (!source || source !== 'ui') {
      log.warn(
        {
          taskId,
          attemptedStatus: parsedBody.status,
          source: source ?? null,
          ua: headers?.['user-agent'] ?? null,
        },
        '[Workflow] Rejected manual status change: missing X-Rapitas-Source=ui header (likely an agent shell-call)',
      );
      // Record the bypass attempt for forensics.
      await recordTransition({
        taskId,
        fromStatus: null,
        toStatus: parsedBody.status,
        actor: 'system',
        cause: 'manual_status_change_blocked',
        metadata: {
          reason: 'missing X-Rapitas-Source=ui header',
          source: source ?? null,
          ua: headers?.['user-agent'] ?? null,
        },
        invariantViolation: true,
        invariantMessage: 'Agent attempted to call PUT /tasks/:id/status without UI header',
      });
      throw new ValidationError(
        'Manual workflow-status changes require the X-Rapitas-Source=ui header. ' +
          'Agents are not permitted to mutate workflow state directly.',
      );
    }

    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundError('Task not found');

    const updatedTask = await prisma.task.update({
      where: { id: taskId },
      data: { workflowStatus: parsedBody.status, updatedAt: new Date() },
    });

    await recordTransition({
      taskId,
      fromStatus: task.workflowStatus ?? null,
      toStatus: parsedBody.status,
      actor: 'user',
      cause: 'manual_status_change',
      metadata: {},
    });

    await prisma.activityLog.create({
      data: {
        taskId,
        action: 'workflow_status_updated',
        metadata: JSON.stringify({
          previousStatus: task.workflowStatus,
          newStatus: parsedBody.status,
        }),
        createdAt: new Date(),
      },
    });

    return { success: true, task: updatedTask, workflowStatus: parsedBody.status };
  } catch (err) {
    if (err instanceof ValidationError || err instanceof NotFoundError) throw err;
    log.error({ err }, 'Error updating workflow status');
    throw err;
  }
}

/**
 * Handler for POST /workflow/tasks/:taskId/advance
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
    const language = parsedBody?.language || 'ja';

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
      if (!quickResult.success) set.status = 400;
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
