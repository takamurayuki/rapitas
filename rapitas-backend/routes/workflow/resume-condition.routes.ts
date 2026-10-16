/**
 * resume-condition-routes
 *
 * Thin Elysia layer for the blocked-task resume-condition API. Handlers hold
 * the logic (resume-condition-handlers.ts); this file only wires paths.
 */
import { Elysia } from 'elysia';
import {
  handleApproveResumeCondition,
  handleGetResumeQuestion,
  handlePreviewResumeCondition,
  type ResumeCtx,
} from './resume-condition-handlers';

const resumeConditionRoutes = new Elysia({ prefix: '/workflow' })
  .get('/tasks/:taskId/resume-question', (ctx) =>
    handleGetResumeQuestion(ctx as unknown as ResumeCtx),
  )
  .post('/tasks/:taskId/resume-condition/preview', (ctx) =>
    handlePreviewResumeCondition(ctx as unknown as ResumeCtx),
  )
  .post('/tasks/:taskId/resume-condition/approve', (ctx) =>
    handleApproveResumeCondition(ctx as unknown as ResumeCtx),
  );

export default resumeConditionRoutes;
