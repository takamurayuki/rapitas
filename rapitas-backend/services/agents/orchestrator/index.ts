/**
 * Orchestrator Module - Entry Point
 *
 * Re-exports from all sub-modules.
 */

// Type definitions
export type {
  ExecutionOptions,
  ExecutionState,
  OrchestratorEvent,
  EventListener,
  ActiveAgentInfo,
  OrchestratorContext,
  PrismaClientInstance,
} from './types';

// Execution helpers
export {
  toJsonString,
  createLogChunkManager,
  setupQuestionDetectedHandler,
  setupOutputHandler,
  determineExecutionStatus,
  saveExecutionResult,
  emitResultEvent,
  handleExecutionError,
} from './execution-helpers';

export type {
  QuestionHandlerContext,
  OutputHandlerContext,
  LogManagerContext,
} from './execution-helpers';

// Event management
export { EventManager } from './event-manager';

// Git operations
export { GitOperations } from './git-operations';

// Question timeout management
export { QuestionTimeoutManager } from './question-timeout-manager';
export type { TimeoutHandler, EventEmitter } from './question-timeout-manager';

// Lifecycle management
export {
  saveAgentState,
  saveAllAgentStates,
  gracefulShutdown,
  setupSignalHandlers,
} from './lifecycle-manager';

// Task execution
export { executeTask } from './task-executor';

// Continuation execution
export {
  executeContinuation,
  executeContinuationWithLock,
  executeContinuationInternal,
  handleQuestionTimeout,
} from './continuation-executor';

// Recovery management
export {
  getInterruptedExecutions,
  recoverStaleExecutions,
  resumeInterruptedExecution,
  buildResumePrompt,
} from './recovery-manager';
