/**
 * Output Parser Types
 *
 * Message protocol type definitions for Worker <-> main thread communication.
 */

import type {
  QuestionKey,
  QuestionDetails,
  QuestionDetectionResult,
} from '../services/agents/question-detection';

// ==================== Worker Input Messages ====================

export type WorkerInputMessage =
  | { type: 'parse-chunk'; data: string }
  | { type: 'parse-complete'; outputBuffer: string }
  | { type: 'configure'; config: WorkerConfig }
  | { type: 'terminate' };

export type WorkerConfig = {
  timeoutSeconds?: number;
  logPrefix?: string;
};

// ==================== Worker Output Messages ====================

export type WorkerOutputMessage =
  | WorkerSystemEvent
  | WorkerAssistantMessage
  | WorkerUserMessage
  | WorkerResultEvent
  | WorkerQuestionDetected
  | WorkerToolTracking
  | WorkerRawOutput
  | WorkerArtifactsParsed
  | WorkerCommitsParsed
  | WorkerParseComplete
  | WorkerError;

export type WorkerSystemEvent = {
  type: 'system-event';
  subtype: string;
  sessionId?: string;
  errorMessage?: string;
  displayOutput: string;
  /** Warning message when session ID does not match */
  sessionMismatchWarning?: string;
};

export type WorkerAssistantMessage = {
  type: 'assistant-message';
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
  type: 'user-message';
  displayOutput: string;
  toolResults: WorkerToolResult[];
};

export type WorkerToolResult = {
  toolUseId: string;
  isError: boolean;
};

export type WorkerResultEvent = {
  type: 'result-event';
  displayOutput: string;
  subtype?: string;
  durationMs?: number;
  costUsd?: number;
  result?: string;
};

export type WorkerQuestionDetected = {
  type: 'question-detected';
  detectionResult: QuestionDetectionResult;
  displayOutput: string;
};

export type WorkerToolTracking = {
  type: 'tool-tracking';
  hasFileModifyingToolCalls: boolean;
};

export type WorkerRawOutput = {
  type: 'raw-output';
  displayOutput: string;
};

export type WorkerArtifactsParsed = {
  type: 'artifacts-parsed';
  data: { artifacts: ParsedArtifact[] };
};

export type WorkerCommitsParsed = {
  type: 'commits-parsed';
  data: { commits: ParsedCommit[] };
};

export type WorkerParseComplete = {
  type: 'parse-complete';
  /** Remaining unprocessed buffer */
  remainingBuffer: string;
};

export type WorkerError = {
  type: 'error';
  message: string;
  stack?: string;
};

// ==================== Artifact & Commit Types ====================

export type ParsedArtifact = {
  type: 'file' | 'diff';
  name: string;
  content: string;
  path?: string;
};

export type ParsedCommit = {
  hash: string;
  message: string;
  branch: string;
  filesChanged: number;
  additions: number;
  deletions: number;
};
