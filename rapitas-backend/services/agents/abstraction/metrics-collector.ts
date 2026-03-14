/**
 * Agent Abstraction Layer - Metrics Collector
 *
 * Collects and aggregates execution metrics for agents.
 */

import type { IMetricsCollector } from './interfaces';

/**
 * Execution metrics data.
 */
interface ExecutionMetricsData {
  executionId: string;
  agentId: string;
  startTime: Date;
  endTime?: Date;
  success?: boolean;
  tokens: {
    input: number;
    output: number;
  };
  toolCalls: Array<{
    toolName: string;
    durationMs: number;
    success: boolean;
  }>;
  fileChanges: {
    added: number;
    deleted: number;
  };
  costUsd: number;
}

/**
 * Aggregated metrics.
 */
interface AggregatedMetrics {
  totalExecutions: number;
  successfulExecutions: number;
  successRate: number;
  avgDurationMs: number;
  totalTokens: number;
  totalCostUsd: number;
}

/**
 * Default metrics collector implementation.
 */
export class DefaultMetricsCollector implements IMetricsCollector {
  private executions: Map<string, ExecutionMetricsData> = new Map();
  private agentMetrics: Map<string, ExecutionMetricsData[]> = new Map();
  private maxHistorySize: number;

  constructor(options: { maxHistorySize?: number } = {}) {
    this.maxHistorySize = options.maxHistorySize ?? 1000;
  }

  /**
   * Starts tracking an execution.
   */
  startExecution(executionId: string, agentId: string): void {
    const data: ExecutionMetricsData = {
      executionId,
      agentId,
      startTime: new Date(),
      tokens: { input: 0, output: 0 },
      toolCalls: [],
      fileChanges: { added: 0, deleted: 0 },
      costUsd: 0,
    };

    this.executions.set(executionId, data);

    // Add to per-agent metrics
    let agentHistory = this.agentMetrics.get(agentId);
    if (!agentHistory) {
      agentHistory = [];
      this.agentMetrics.set(agentId, agentHistory);
    }
    agentHistory.push(data);

    // Limit history size
    this.pruneHistory();
  }

  /**
   * Ends tracking for an execution.
   */
  endExecution(executionId: string, success: boolean): void {
    const data = this.executions.get(executionId);
    if (data) {
      data.endTime = new Date();
      data.success = success;
    }
  }

  /**
   * Records token usage.
   */
  recordTokenUsage(executionId: string, input: number, output: number): void {
    const data = this.executions.get(executionId);
    if (data) {
      data.tokens.input += input;
      data.tokens.output += output;
    }
  }

  /**
   * Records a tool call.
   */
  recordToolCall(
    executionId: string,
    toolName: string,
    durationMs: number,
    success: boolean,
  ): void {
    const data = this.executions.get(executionId);
    if (data) {
      data.toolCalls.push({ toolName, durationMs, success });
    }
  }

  /**
   * Records file changes.
   */
  recordFileChange(executionId: string, added: number, deleted: number): void {
    const data = this.executions.get(executionId);
    if (data) {
      data.fileChanges.added += added;
      data.fileChanges.deleted += deleted;
    }
  }

  /**
   * Records cost.
   */
  recordCost(executionId: string, costUsd: number): void {
    const data = this.executions.get(executionId);
    if (data) {
      data.costUsd += costUsd;
    }
  }

  /**
   * Returns metrics for an execution.
   */
  getMetrics(executionId: string): {
    durationMs: number;
    tokensUsed: { input: number; output: number };
    toolCalls: number;
    fileChanges: { added: number; deleted: number };
    costUsd: number;
  } | null {
    const data = this.executions.get(executionId);
    if (!data) {
      return null;
    }

    const endTime = data.endTime || new Date();
    const durationMs = endTime.getTime() - data.startTime.getTime();

    return {
      durationMs,
      tokensUsed: { ...data.tokens },
      toolCalls: data.toolCalls.length,
      fileChanges: { ...data.fileChanges },
      costUsd: data.costUsd,
    };
  }

  /**
   * Returns aggregated metrics for a time period.
   */
  getAggregateMetrics(
    agentId: string,
    period: 'hour' | 'day' | 'week' | 'month',
  ): {
    totalExecutions: number;
    successRate: number;
    avgDurationMs: number;
    totalTokens: number;
    totalCostUsd: number;
  } {
    const agentHistory = this.agentMetrics.get(agentId) || [];

    // Filter by time period
    const now = Date.now();
    const periodMs = this.getPeriodMs(period);
    const cutoff = now - periodMs;

    const filteredHistory = agentHistory.filter((data) => data.startTime.getTime() >= cutoff);

    if (filteredHistory.length === 0) {
      return {
        totalExecutions: 0,
        successRate: 0,
        avgDurationMs: 0,
        totalTokens: 0,
        totalCostUsd: 0,
      };
    }

    // Aggregate
    let totalDurationMs = 0;
    let successCount = 0;
    let totalTokens = 0;
    let totalCostUsd = 0;
    let completedCount = 0;

    for (const data of filteredHistory) {
      if (data.endTime) {
        const durationMs = data.endTime.getTime() - data.startTime.getTime();
        totalDurationMs += durationMs;
        completedCount++;
      }

      if (data.success) {
        successCount++;
      }

      totalTokens += data.tokens.input + data.tokens.output;
      totalCostUsd += data.costUsd;
    }

    return {
      totalExecutions: filteredHistory.length,
      successRate: filteredHistory.length > 0 ? successCount / filteredHistory.length : 0,
      avgDurationMs: completedCount > 0 ? totalDurationMs / completedCount : 0,
      totalTokens,
      totalCostUsd,
    };
  }

  /**
   * Returns global statistics across all executions.
   */
  getGlobalStats(): {
    totalExecutions: number;
    activeExecutions: number;
    successRate: number;
    avgDurationMs: number;
    totalTokens: number;
    totalCostUsd: number;
    byAgent: Map<string, AggregatedMetrics>;
  } {
    const allData = Array.from(this.executions.values());

    let totalDurationMs = 0;
    let successCount = 0;
    let totalTokens = 0;
    let totalCostUsd = 0;
    let completedCount = 0;
    let activeCount = 0;

    for (const data of allData) {
      if (data.endTime) {
        const durationMs = data.endTime.getTime() - data.startTime.getTime();
        totalDurationMs += durationMs;
        completedCount++;
      } else {
        activeCount++;
      }

      if (data.success) {
        successCount++;
      }

      totalTokens += data.tokens.input + data.tokens.output;
      totalCostUsd += data.costUsd;
    }

    // Per-agent statistics
    const byAgent = new Map<string, AggregatedMetrics>();
    for (const [agentId, history] of this.agentMetrics.entries()) {
      let agentDurationMs = 0;
      let agentSuccessCount = 0;
      let agentTokens = 0;
      let agentCost = 0;
      let agentCompleted = 0;

      for (const data of history) {
        if (data.endTime) {
          agentDurationMs += data.endTime.getTime() - data.startTime.getTime();
          agentCompleted++;
        }
        if (data.success) {
          agentSuccessCount++;
        }
        agentTokens += data.tokens.input + data.tokens.output;
        agentCost += data.costUsd;
      }

      byAgent.set(agentId, {
        totalExecutions: history.length,
        successfulExecutions: agentSuccessCount,
        successRate: history.length > 0 ? agentSuccessCount / history.length : 0,
        avgDurationMs: agentCompleted > 0 ? agentDurationMs / agentCompleted : 0,
        totalTokens: agentTokens,
        totalCostUsd: agentCost,
      });
    }

    return {
      totalExecutions: allData.length,
      activeExecutions: activeCount,
      successRate: completedCount > 0 ? successCount / completedCount : 0,
      avgDurationMs: completedCount > 0 ? totalDurationMs / completedCount : 0,
      totalTokens,
      totalCostUsd,
      byAgent,
    };
  }

  /**
   * Returns tool call statistics.
   */
  getToolCallStats(agentId?: string): Map<
    string,
    {
      count: number;
      avgDurationMs: number;
      successRate: number;
    }
  > {
    const stats = new Map<
      string,
      {
        count: number;
        totalDurationMs: number;
        successCount: number;
      }
    >();

    const data = agentId
      ? this.agentMetrics.get(agentId) || []
      : Array.from(this.executions.values());

    for (const execution of data) {
      for (const toolCall of execution.toolCalls) {
        let toolStats = stats.get(toolCall.toolName);
        if (!toolStats) {
          toolStats = { count: 0, totalDurationMs: 0, successCount: 0 };
          stats.set(toolCall.toolName, toolStats);
        }

        toolStats.count++;
        toolStats.totalDurationMs += toolCall.durationMs;
        if (toolCall.success) {
          toolStats.successCount++;
        }
      }
    }

    // Convert to averages
    const result = new Map<
      string,
      {
        count: number;
        avgDurationMs: number;
        successRate: number;
      }
    >();

    for (const [toolName, toolStats] of stats.entries()) {
      result.set(toolName, {
        count: toolStats.count,
        avgDurationMs: toolStats.count > 0 ? toolStats.totalDurationMs / toolStats.count : 0,
        successRate: toolStats.count > 0 ? toolStats.successCount / toolStats.count : 0,
      });
    }

    return result;
  }

  /**
   * Clears all history.
   */
  clear(): void {
    this.executions.clear();
    this.agentMetrics.clear();
  }

  /**
   * Clears history for a specific agent.
   */
  clearAgent(agentId: string): void {
    const history = this.agentMetrics.get(agentId);
    if (history) {
      for (const data of history) {
        this.executions.delete(data.executionId);
      }
      this.agentMetrics.delete(agentId);
    }
  }

  // ============================================================================
  // Private methods
  // ============================================================================

  private getPeriodMs(period: 'hour' | 'day' | 'week' | 'month'): number {
    switch (period) {
      case 'hour':
        return 60 * 60 * 1000;
      case 'day':
        return 24 * 60 * 60 * 1000;
      case 'week':
        return 7 * 24 * 60 * 60 * 1000;
      case 'month':
        return 30 * 24 * 60 * 60 * 1000;
    }
  }

  private pruneHistory(): void {
    // Evict oldest entries when exceeding max history size
    if (this.executions.size <= this.maxHistorySize) {
      return;
    }

    // Sort by startTime and remove oldest
    const sorted = Array.from(this.executions.entries()).sort(
      (a, b) => a[1].startTime.getTime() - b[1].startTime.getTime(),
    );

    const toDelete = sorted.slice(0, sorted.length - this.maxHistorySize);

    for (const [executionId, data] of toDelete) {
      this.executions.delete(executionId);

      // Also remove from per-agent history
      const agentHistory = this.agentMetrics.get(data.agentId);
      if (agentHistory) {
        const index = agentHistory.findIndex((d) => d.executionId === executionId);
        if (index >= 0) {
          agentHistory.splice(index, 1);
        }
      }
    }
  }
}

/**
 * Default metrics collector singleton.
 */
let defaultCollector: DefaultMetricsCollector | null = null;

export function getDefaultMetricsCollector(): DefaultMetricsCollector {
  if (!defaultCollector) {
    defaultCollector = new DefaultMetricsCollector();
  }
  return defaultCollector;
}

export function setDefaultMetricsCollector(collector: DefaultMetricsCollector): void {
  defaultCollector = collector;
}
