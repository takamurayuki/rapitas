/**
 * Execution results, artifacts, metrics, and debug info.
 */

import type { AgentState } from './agent-identification';

/**
 * Agent execution result.
 */
export interface AgentExecutionResult {
  // Basic result
  success: boolean;
  state: AgentState;

  // Output
  output: string;
  structuredOutput?: unknown;
  errorMessage?: string;

  // Artifacts
  artifacts?: AgentArtifact[];
  commits?: GitCommitInfo[];

  // Metrics
  metrics?: ExecutionMetrics;

  // Pending question / waiting for input
  pendingQuestion?: PendingQuestion;

  // Session info
  sessionId?: string;

  // Debug info
  debugInfo?: ExecutionDebugInfo;
}

/**
 * Artifact (file changes, code generation, etc.).
 */
export interface AgentArtifact {
  type: 'file' | 'code' | 'diff' | 'log' | 'image' | 'data';
  name: string;
  content: string;
  path?: string;
  language?: string;
  mimeType?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Git commit info.
 */
export interface GitCommitInfo {
  hash: string;
  message: string;
  branch: string;
  author?: string;
  timestamp?: Date;
  filesChanged: number;
  additions: number;
  deletions: number;
}

/**
 * Execution metrics.
 */
export interface ExecutionMetrics {
  startTime: Date;
  endTime?: Date;
  durationMs?: number;
  tokensUsed?: number;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  apiCalls?: number;
  toolCalls?: number;
  filesModified?: number;
  linesAdded?: number;
  linesDeleted?: number;
}

/**
 * Pending question awaiting user response.
 */
export interface PendingQuestion {
  questionId: string;
  text: string;
  category: 'clarification' | 'confirmation' | 'selection' | 'input';
  options?: QuestionOption[];
  multiSelect?: boolean;
  defaultValue?: string;
  timeout?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Question option.
 */
export interface QuestionOption {
  label: string;
  value: string;
  description?: string;
  isDefault?: boolean;
}

/**
 * Execution debug info.
 */
export interface ExecutionDebugInfo {
  logs: DebugLogEntry[];
  toolCalls?: ToolCallInfo[];
  rawOutput?: string;
  processInfo?: {
    pid?: number;
    exitCode?: number;
    signal?: string;
  };
}

/**
 * Debug log entry.
 */
export interface DebugLogEntry {
  timestamp: Date;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  data?: unknown;
}

/**
 * Tool call info.
 */
export interface ToolCallInfo {
  id: string;
  name: string;
  input: unknown;
  output?: unknown;
  startTime: Date;
  endTime?: Date;
  success: boolean;
  error?: string;
}
