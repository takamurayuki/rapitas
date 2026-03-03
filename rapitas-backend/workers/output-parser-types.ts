/**
 * Worker ↔ メインスレッド間のメッセージプロトコル型定義
 */

import type {
  QuestionKey,
  QuestionDetails,
  QuestionDetectionResult,
} from "../services/agents/question-detection";

// ==================== Worker入力メッセージ ====================

export type WorkerInputMessage =
  | { type: "parse-chunk"; data: string }
  | { type: "parse-complete"; outputBuffer: string }
  | { type: "configure"; config: WorkerConfig }
  | { type: "terminate" };

export type WorkerConfig = {
  timeoutSeconds?: number;
  logPrefix?: string;
};

// ==================== Worker出力メッセージ ====================

export type WorkerOutputMessage =
  | WorkerSystemEvent
  | WorkerAssistantMessage
  | WorkerUserMessage
  | WorkerResultEvent
  | WorkerQuestionDetected
  | WorkerToolTracking
  | WorkerRawOutput
  | WorkerParseComplete
  | WorkerError;

export type WorkerSystemEvent = {
  type: "system-event";
  subtype: string;
  sessionId?: string;
  errorMessage?: string;
  displayOutput: string;
  /** セッションID不一致の場合の警告メッセージ */
  sessionMismatchWarning?: string;
};

export type WorkerAssistantMessage = {
  type: "assistant-message";
  displayOutput: string;
  toolUses: WorkerToolUse[];
};

export type WorkerToolUse = {
  id: string;
  name: string;
  info: string;
  isFileModifying: boolean;
};

export type WorkerUserMessage = {
  type: "user-message";
  displayOutput: string;
  toolResults: WorkerToolResult[];
};

export type WorkerToolResult = {
  toolUseId: string;
  isError: boolean;
};

export type WorkerResultEvent = {
  type: "result-event";
  displayOutput: string;
  subtype?: string;
  durationMs?: number;
  costUsd?: number;
  result?: string;
};

export type WorkerQuestionDetected = {
  type: "question-detected";
  detectionResult: QuestionDetectionResult;
  displayOutput: string;
};

export type WorkerToolTracking = {
  type: "tool-tracking";
  hasFileModifyingToolCalls: boolean;
};

export type WorkerRawOutput = {
  type: "raw-output";
  displayOutput: string;
};

export type WorkerParseComplete = {
  type: "parse-complete";
  /** 未処理の残りバッファ */
  remainingBuffer: string;
};

export type WorkerError = {
  type: "error";
  message: string;
  stack?: string;
};

// ==================== アーティファクト・コミット型（再エクスポート） ====================

export type ParsedArtifact = {
  type: "file" | "diff";
  name: string;
  content: string;
  path?: string;
};

export type ParsedCommit = {
  hash: string;
};
