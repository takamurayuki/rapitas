/**
 * Agent Execution Management Routes
 *
 * Barrel export for execution control, resume, and fork routes.
 */
export { agentExecutionRouter } from './agent-execution-router';
export { acquireTaskExecutionLock, releaseTaskExecutionLock } from './agent-execution-router';
export { updateSessionStatusWithRetry } from './agent-execution-router';
export { agentResumeRouter } from './agent-resume-router';
// NOTE: moved to the orchestrator layer (service logic, not routing);
// re-exported here so existing importers keep working.
export { handleResumeCompletion } from '../../../services/agents/orchestrator/resume-completion';
export { executionForkRoutes } from './execution-fork-routes';
