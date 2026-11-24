/**
 * confirm-link-default-deps
 *
 * Wires the confirm-link service to the live app: Prisma reads, question.md,
 * the answer applier, halt release and re-dispatch, and the file stores under
 * the cycle-log directory (task 1430). Loaded lazily by the routes so tests
 * of the service and routes never import the database layer.
 */
import { prisma } from '../../../config';
import { applyQuestionAnswerByKind } from '../../../routes/workflow/handlers/workflow-handlers-resume-dispatch';
import { triggerReExecutionAfterAnswer } from '../../../routes/workflow/handlers/workflow-handlers-resume-redispatch';
import { releaseHaltOnHumanAnswer } from '../halt-release';
import { readWorkflowFile } from '../workflow-file-utils';
import {
  appendConfirmLinkAudit,
  pruneTaskOrphanAudits,
  removeConfirmLinkAudit,
} from './confirm-link-audit';
import type { ConfirmLinkResourceRow } from './confirm-link-resources';
import { createConfirmLinkStore, getDefaultConfirmLinkDir } from './confirm-link-store';
import { resolveConfirmLinkSecret } from './confirm-link-token';
import type { ConfirmLinkServiceDeps } from './confirm-link-types';

/**
 * Build the production dependencies. Re-read on every request so a changed
 * secret or origin takes effect without a restart.
 *
 * @returns Live dependencies / 本番の依存
 */
export function createDefaultConfirmLinkDeps(): ConfirmLinkServiceDeps {
  const dir = getDefaultConfirmLinkDir();
  const store = createConfirmLinkStore({ dir });
  return {
    store,
    secret: resolveConfirmLinkSecret(),
    publicOrigin: process.env.RAPITAS_CONFIRM_LINK_PUBLIC_ORIGIN?.trim() || null,
    readTaskSnapshot: async (taskId) => {
      const task = await prisma.task.findUnique({
        where: { id: taskId },
        select: { workflowStatus: true },
      });
      if (!task) return null;
      const pause = await prisma.workflowTransition.findFirst({
        where: { taskId, toStatus: 'awaiting_question' },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true },
      });
      return { workflowStatus: task.workflowStatus, latestPauseId: pause?.id ?? null };
    },
    readQuestion: (taskId) => readWorkflowFile(taskId, 'question'),
    readResources: (taskId): Promise<ConfirmLinkResourceRow[]> =>
      prisma.resource.findMany({
        where: { taskId },
        select: {
          id: true,
          taskId: true,
          title: true,
          type: true,
          url: true,
          filePath: true,
          fileName: true,
          mimeType: true,
        },
        orderBy: { id: 'asc' },
      }),
    applyAnswer: applyQuestionAnswerByKind,
    releaseHalt: releaseHaltOnHumanAnswer,
    triggerReExecution: triggerReExecutionAfterAnswer,
    appendAudit: (entry) => appendConfirmLinkAudit(entry, { dir }),
    removeAudit: (id) => removeConfirmLinkAudit(id, { dir }),
    pruneOrphanAudits: async (taskId) => {
      await pruneTaskOrphanAudits(taskId, store, { dir });
    },
    // Workspace-scoped like resolveAuthorizedAttachment (routes/tasks/resources.ts):
    // another workspace's or a missing resource reads as null.
    readResourceOwner: (resourceId) =>
      prisma.resource.findFirst({ where: { id: resourceId }, select: { id: true, taskId: true } }),
  };
}
