/**
 * Agent Metrics Types
 *
 * Shared interfaces for agent metrics, trend data, performance comparison,
 * and query parameters. Contains no database or routing logic.
 */

export interface AgentMetrics {
  agentId: number;
  agentName: string;
  agentType: string;
  modelId: string | null;
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  successRate: number;
  averageExecutionTimeMs: number | null;
  totalTokensUsed: number;
  averageTokensPerExecution: number | null;
  /** Aggregated LLM API call count across all executions for this agent. */
  totalLlmCalls?: number;
  lastExecutionAt: Date | null;
  isActive: boolean;
}

export interface ExecutionTrendData {
  date: string;
  successful: number;
  failed: number;
  totalTokens: number;
  averageTime: number | null;
}

export interface AgentPerformanceComparison {
  agentType: string;
  modelId: string;
  executionCount: number;
  averageTime: number | null;
  successRate: number;
  totalTokens: number;
}

/**
 * Of the tasks that first completed in the window, how many got there with no
 * verify_repair in their history. The task-level quality counterpart to
 * `overallSuccessRate`, which only says a CLI process exited cleanly (#1300).
 */
export interface FirstPassCompletion {
  /** Tasks whose FIRST completion falls in the window. */
  completedTasks: number;
  /** Of those, the ones with no verify_repair anywhere in their history. */
  repairFreeTasks: number;
  /** repairFreeTasks ÷ completedTasks; null when nothing completed. */
  rate: number | null;
}

/**
 * Tokens split by class, because they do not cost the same: a cache read is
 * about a tenth of a fresh input token, and on this machine cache reads are
 * 94.78% of the volume — so one summed figure tracked neither spend nor load
 * (#1302).
 */
export interface TokenBreakdown {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
}

export interface MetricsOverview {
  totalExecutions: number;
  totalSuccessful: number;
  totalFailed: number;
  /** Executions in neither terminal bucket — still running, cancelled or interrupted. */
  totalUnfinished: number;
  /** Share of FINISHED executions that exited cleanly. Liveness, not quality. */
  overallSuccessRate: number;
  /** Sum of `tokenBreakdown`; falls back to the legacy column for old rows. */
  totalTokensUsed: number;
  tokenBreakdown: TokenBreakdown;
  totalAgents: number;
  activeAgents: number;
  averageExecutionTime: number | null;
}

/** The /agent-metrics/overview payload: execution liveness plus task-level quality. */
export interface MetricsOverviewResponse extends MetricsOverview {
  firstPassCompletion: FirstPassCompletion;
}

export interface DateRange {
  startDate?: string;
  endDate?: string;
  period?: 'day' | 'week' | 'month';
}
