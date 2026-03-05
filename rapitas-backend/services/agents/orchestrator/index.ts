/**
 * オーケストレーターモジュール - エントリーポイント
 * 各サブモジュールの再エクスポート
 */

// 型定義
export type {
  ExecutionOptions,
  ExecutionState,
  OrchestratorEvent,
  EventListener,
  ActiveAgentInfo,
  OrchestratorContext,
  PrismaClientInstance,
} from "./types";

// 実行ヘルパー
export {
  toJsonString,
  createLogChunkManager,
  setupQuestionDetectedHandler,
  setupOutputHandler,
  determineExecutionStatus,
  saveExecutionResult,
  emitResultEvent,
  handleExecutionError,
} from "./execution-helpers";

export type {
  QuestionHandlerContext,
  OutputHandlerContext,
  LogManagerContext,
} from "./execution-helpers";

// イベント管理
export { EventManager } from "./event-manager";

// Git操作
export { GitOperations } from "./git-operations";

// 質問タイムアウト管理
export { QuestionTimeoutManager } from "./question-timeout-manager";
export type { TimeoutHandler, EventEmitter } from "./question-timeout-manager";

// ライフサイクル管理
export {
  saveAgentState,
  saveAllAgentStates,
  gracefulShutdown,
  setupSignalHandlers,
} from "./lifecycle-manager";

// タスク実行
export { executeTask } from "./task-executor";

// 継続実行
export {
  executeContinuation,
  executeContinuationWithLock,
  executeContinuationInternal,
  handleQuestionTimeout,
} from "./continuation-executor";

// リカバリ管理
export {
  getInterruptedExecutions,
  recoverStaleExecutions,
  resumeInterruptedExecution,
  buildResumePrompt,
} from "./recovery-manager";
