/**
 * Workflow Routes
 *
 * Assembles Elysia route definitions for the workflow API.
 * Delegates all handler logic to workflow-handlers.ts.
 * Not responsible for business logic, file I/O, or git operations.
 */

import { Elysia } from 'elysia';
import { prisma } from '../../../config';
import {
  handleGetFiles,
  handleSaveFile,
  handleApprovePlan,
  handleUpdateStatus,
  handleAdvanceWorkflow,
  handleSetMode,
  handleAnalyzeComplexity,
  handleGetModes,
} from '../handlers/workflow-handlers';

// Re-export helpers and types for consumers that import from this path
export {
  VALID_FILE_TYPES,
  VALID_WORKFLOW_STATUSES,
  resolveWorkflowDir,
  getFileInfo,
} from './workflow-helpers';
export type { WorkflowFileType } from './workflow-helpers';
export { performAutoCommitAndPR } from '../workflow-auto-commit';
export type { AutoCommitPRResult } from '../workflow-auto-commit';

// NOTE: Each handler is wrapped in an arrow function so Elysia can infer
// the full context type. Passing the handler directly causes TS2345 because
// the handler's explicit parameter annotations are narrower than the
// InlineHandlerNonMacro type Elysia expects.
export const workflowRoutes = new Elysia({ prefix: '/workflow' })

  .get('/tasks/:taskId/files', (ctx) => handleGetFiles(ctx as Parameters<typeof handleGetFiles>[0]))

  .put('/tasks/:taskId/files/:fileType', (ctx) =>
    handleSaveFile(ctx as Parameters<typeof handleSaveFile>[0]),
  )

  .post('/tasks/:taskId/approve-plan', (ctx) =>
    handleApprovePlan(ctx as Parameters<typeof handleApprovePlan>[0]),
  )

  .put('/tasks/:taskId/status', (ctx) =>
    handleUpdateStatus(ctx as Parameters<typeof handleUpdateStatus>[0]),
  )

  .post('/workflow/tasks/:taskId/advance', (ctx) =>
    handleAdvanceWorkflow(ctx as Parameters<typeof handleAdvanceWorkflow>[0]),
  )

  .post('/tasks/:taskId/set-mode', (ctx) =>
    handleSetMode(ctx as Parameters<typeof handleSetMode>[0]),
  )

  .get('/tasks/:taskId/analyze-complexity', (ctx) =>
    handleAnalyzeComplexity(ctx as Parameters<typeof handleAnalyzeComplexity>[0]),
  )

  .get('/modes', (ctx) => handleGetModes(ctx as Parameters<typeof handleGetModes>[0]))

  /**
   * Read-only timeline of every workflow status transition for a task.
   * Backed by the append-only `WorkflowTransition` table populated by
   * `recordTransition()`. Use this to debug "why is the task in
   * unexpected state X?" without re-running the agents.
   */
  .get('/tasks/:taskId/transitions', async (ctx) => {
    const params = ctx.params as { taskId: string };
    const taskId = parseInt(params.taskId);
    if (!Number.isFinite(taskId)) {
      return { success: false, error: 'invalid taskId' };
    }
    const rows = await prisma.workflowTransition
      .findMany({
        where: { taskId },
        orderBy: { createdAt: 'asc' },
      })
      .catch(() => null);
    if (!rows) {
      return { success: false, error: 'failed to load transitions' };
    }
    const transitions = rows.map((r) => {
      let parsedMeta: unknown = {};
      try {
        parsedMeta = r.metadata ? JSON.parse(r.metadata) : {};
      } catch {
        parsedMeta = { raw: r.metadata };
      }
      return { ...r, metadata: parsedMeta };
    });
    return { success: true, taskId, count: transitions.length, transitions };
  });
