/**
 * Execution Results & Metrics
 *
 * Defines agent execution results and performance metrics.
 */

import type { AgentExecutionResult } from '../base-agent';

// ==================== Extended Execution Results ====================

/**
 * Execution metrics
 */
export type ExecutionMetrics = {
  apiCalls: number;
  filesRead: number;
  filesWritten: number;
  commandsExecuted: number;
  /** Estimated cost in USD */
  estimatedCost?: number;
};

/**
 * Extended execution result
 */
export type ExtendedExecutionResult = AgentExecutionResult & {
  inputTokens?: number;
  outputTokens?: number;
  errorCode?: string;
  /** Provider-agnostic session ID */
  sessionId?: string;
  modelId?: string;
  warnings?: string[];
  metrics?: ExecutionMetrics;
};
