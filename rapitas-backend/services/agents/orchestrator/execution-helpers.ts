/**
 * ExecutionHelpers
 *
 * Barrel file that re-exports from split modules for backward compatibility.
 * The actual implementations are in:
 * - execution-helpers-types.ts (type definitions)
 * - log-chunk-manager.ts (log batching)
 * - execution-handlers.ts (question/output handlers)
 * - execution-persistence.ts (DB persistence)
 * - idea-extractor.ts (IDEA marker extraction)
 */

// Re-export types
export type {
  QuestionHandlerContext,
  OutputHandlerContext,
  LogManagerContext,
} from './execution-helpers-types';
export { toJsonString } from './execution-helpers-types';

// Re-export from types
export type { ActiveAgentInfo } from './types';

// Re-export log chunk manager
export { createLogChunkManager } from './log-chunk-manager';
export type { LogChunkManager } from './log-chunk-manager';

// Re-export handlers
export { setupQuestionDetectedHandler, setupOutputHandler } from './execution-handlers';

// Re-export persistence functions
export {
  determineExecutionStatus,
  saveExecutionResult,
  emitResultEvent,
  handleExecutionError,
} from './execution-persistence';

// Re-export idea extractor (internal use)
export { extractIdeaMarkers } from './idea-extractor';
