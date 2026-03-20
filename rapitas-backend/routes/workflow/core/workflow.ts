/**
 * Workflow Routes
 *
 * Assembles Elysia route definitions for the workflow API.
 * Delegates all handler logic to workflow-handlers.ts.
 * Not responsible for business logic, file I/O, or git operations.
 */

import { Elysia } from 'elysia';
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
export { VALID_FILE_TYPES, VALID_WORKFLOW_STATUSES, resolveWorkflowDir, getFileInfo } from './workflow-helpers';
export type { WorkflowFileType } from './workflow-helpers';
export { performAutoCommitAndPR } from '../workflow-auto-commit';
export type { AutoCommitPRResult } from '../workflow-auto-commit';

export const workflowRoutes = new Elysia({ prefix: '/workflow' })

  // Get workflow files list
  .get('/tasks/:taskId/files', handleGetFiles)

  // Save workflow file
  .put('/tasks/:taskId/files/:fileType', handleSaveFile)

  // Plan approval
  .post('/tasks/:taskId/approve-plan', handleApprovePlan)

  // Update workflow status
  .put('/tasks/:taskId/status', handleUpdateStatus)

  // Advance to the next workflow phase
  .post('/workflow/tasks/:taskId/advance', handleAdvanceWorkflow)

  // Manual workflow mode setting
  .post('/tasks/:taskId/set-mode', handleSetMode)

  // Automatic task complexity analysis
  .get('/tasks/:taskId/analyze-complexity', handleAnalyzeComplexity)

  // Get available workflow modes
  .get('/modes', handleGetModes);
