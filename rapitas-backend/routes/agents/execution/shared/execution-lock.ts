/**
 * execution/execution-lock
 *
 * Backward-compatible re-export of the process-wide task execution mutex.
 * The canonical implementation now lives in
 * `services/agents/task-execution-lock` so service-layer code (the workflow
 * orchestrator) can share the SAME lock as these routes without importing
 * upward from a route module. Existing `./execution-lock` imports keep working.
 */

export {
  acquireTaskExecutionLock,
  releaseTaskExecutionLock,
  isTaskExecutionLocked,
} from '../../../../services/agents/task-execution-lock';
