/**
 * Approvals — BulkApproveHandler
 *
 * Handles POST /approvals/bulk-approve for batch approval of multiple requests.
 * Supports task_execution and subtask_creation request types in bulk.
 * Not responsible for single-item approval or rejection workflows.
 */

import { Elysia } from 'elysia';
import { prisma } from '../../../config/database';
import { createLogger } from '../../../config/logger';
import { orchestrator } from '../../../services/core/orchestrator-instance';
import { toJsonString, fromJsonString } from '../../../utils/database/db-helpers';
import type { SubtaskProposal } from '../../../services/claude-agent';

const log = createLogger('routes:approvals:bulk-approve');

/**
 * Create subtasks within a transaction, skipping duplicates.
 *
 * @param tx - Prisma transaction client
 * @param taskId - Parent task ID / 親タスクID
 * @param subtasksToCreate - Subtask proposals to create / 作成するサブタスク提案
 * @returns Array of created task records
 */
export async function createSubtasksInTransaction(
  // HACK(agent): tx type is complex Prisma generic; using unknown avoids importing internal types
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  taskId: number,
  subtasksToCreate: SubtaskProposal[],
) {
  const existingSubtasks = await tx.task.findMany({
    where: { parentId: taskId },
    select: { title: true },
  });
  const existingTitles = new Set(
    existingSubtasks.map((st: { title: string }) => st.title.toLowerCase().trim()),
  );

  const created = [];
  for (const subtask of subtasksToCreate) {
    const normalizedTitle = subtask.title.toLowerCase().trim();
    if (existingTitles.has(normalizedTitle)) {
      log.info(`[approvals] Skipping duplicate subtask: ${subtask.title}`);
      continue;
    }
    existingTitles.add(normalizedTitle);

    const newSubtask = await tx.task.create({
      data: {
        title: subtask.title,
        description: subtask.description,
        priority: subtask.priority,
        estimatedHours: subtask.estimatedHours,
        parentId: taskId,
        agentGenerated: true,
      },
    });
    created.push(newSubtask);
  }
  return created;
}

export const bulkApproveRoutes = new Elysia()
  // Bulk approve multiple approval requests
  .post('/bulk-approve', async (context) => {
    const { body } = context;
    const { ids } = body as { ids: number[] };

    // Batch fetch all approval requests at once
    const allApprovals = await prisma.approvalRequest.findMany({
      where: { id: { in: ids }, status: 'pending' },
      include: {
        config: {
          include: { task: true },
        },
      },
    });
    const approvalMap = new Map(allApprovals.map((a) => [a.id, a]));

    // Batch update all statuses at once
    await prisma.approvalRequest.updateMany({
      where: { id: { in: allApprovals.map((a) => a.id) } },
      data: { status: 'approved', approvedAt: new Date() },
    });

    const results = [];
    for (const id of ids) {
      try {
        const approval = approvalMap.get(id);
        if (!approval) continue;

        if (approval.requestType === 'task_execution') {
          const proposedChanges = fromJsonString<{
            taskId: number;
            agentConfigId?: number;
            workingDirectory?: string;
          }>(approval.proposedChanges);
          const task = approval.config.task;

          const session = await prisma.agentSession.create({
            data: {
              configId: approval.config.id,
              status: 'pending',
            },
          });

          orchestrator
            .executeTask(
              {
                id: task.id,
                title: task.title,
                description: task.description,
                context: task.executionInstructions || undefined,
                workingDirectory: proposedChanges?.workingDirectory,
              },
              {
                taskId: task.id,
                sessionId: session.id,
                agentConfigId: proposedChanges?.agentConfigId,
                workingDirectory: proposedChanges?.workingDirectory,
              },
            )
            .then(async (result) => {
              await prisma.notification.create({
                data: {
                  type: result.success ? 'agent_execution_complete' : 'agent_error',
                  title: result.success ? 'エージェント実行完了' : 'エージェント実行失敗',
                  message: result.success
                    ? `「${task.title}」の自動実行が完了しました`
                    : `「${task.title}」の自動実行が失敗しました`,
                  link: `/tasks/${task.id}`,
                },
              });
              if (result.success) {
                await prisma.task.update({
                  where: { id: task.id },
                  data: { status: 'done', completedAt: new Date() },
                });
              }
            })
            .catch((err) => log.error({ err }, 'Async operation failed'));

          results.push({ id, success: true, autoExecutionStarted: true });
        } else if (approval.requestType === 'subtask_creation') {
          const proposedChanges = fromJsonString<{
            subtasks: SubtaskProposal[];
          }>(approval.proposedChanges);

          // NOTE: Serializable isolation prevents concurrent duplicate subtask creation
          const createdSubtasks = await prisma.$transaction(
            async (tx) =>
              createSubtasksInTransaction(tx, approval.config.taskId, proposedChanges?.subtasks || []),
            { isolationLevel: 'Serializable' },
          );

          results.push({ id, success: true, createdCount: createdSubtasks.length });
        } else {
          results.push({ id, success: true });
        }
      } catch (error) {
        results.push({ id, success: false });
      }
    }

    return { results };
  });
