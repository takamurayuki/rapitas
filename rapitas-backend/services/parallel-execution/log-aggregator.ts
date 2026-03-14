/**
 * Log Aggregation System
 *
 * Aggregates, filters, and shares execution logs from multiple sub-agents.
 */

import { EventEmitter } from 'events';
import type { ExecutionLogEntry } from './types';
import { createLogger } from '../../config/logger';

const log = createLogger('log-aggregator');

/**
 * Log filter criteria
 */
type LogFilter = {
  agentIds?: string[];
  taskIds?: number[];
  levels?: ('debug' | 'info' | 'warn' | 'error')[];
  fromTimestamp?: Date;
  toTimestamp?: Date;
  searchText?: string;
};

/**
 * Aggregated log entry
 */
type AggregatedLogEntry = ExecutionLogEntry & {
  id: string;
  sequence: number;
  tags: string[];
};

/**
 * Log summary
 */
type LogSummary = {
  totalLogs: number;
  byAgent: Record<string, number>;
  byTask: Record<number, number>;
  byLevel: Record<string, number>;
  timeRange: {
    start: Date;
    end: Date;
  };
};

/**
 * Log subscriber
 */
type LogSubscriber = {
  id: string;
  filter: LogFilter;
  callback: (entry: AggregatedLogEntry) => void;
};

/**
 * Log aggregation class
 */
export class LogAggregator extends EventEmitter {
  private logs: AggregatedLogEntry[] = [];
  private maxLogs: number;
  private sequence: number = 0;
  private subscribers: Map<string, LogSubscriber> = new Map();

  // Ring buffer index
  private bufferIndex: number = 0;
  private isFull: boolean = false;

  constructor(maxLogs: number = 10000) {
    super();
    this.maxLogs = maxLogs;
    this.logs = new Array(maxLogs);
  }

  /**
   * Add a log entry.
   */
  addLog(entry: ExecutionLogEntry): string {
    const aggregatedEntry: AggregatedLogEntry = {
      ...entry,
      id: `log-${Date.now()}-${this.sequence}`,
      sequence: this.sequence++,
      tags: this.extractTags(entry.message),
    };

    // Add log to ring buffer
    this.logs[this.bufferIndex] = aggregatedEntry;
    this.bufferIndex = (this.bufferIndex + 1) % this.maxLogs;
    if (this.bufferIndex === 0) {
      this.isFull = true;
    }

    // Emit event
    this.emit('log', aggregatedEntry);

    // Notify subscribers
    this.notifySubscribers(aggregatedEntry);

    return aggregatedEntry.id;
  }

  /**
   * Extract tags from message.
   */
  private extractTags(message: string): string[] {
    const tags: string[] = [];

    // Error related
    if (/error|fail|exception/i.test(message)) tags.push('error');
    if (/warn|warning/i.test(message)) tags.push('warning');

    // Progress related
    if (/start|begin/i.test(message)) tags.push('start');
    if (/complete|finish|done|success/i.test(message)) tags.push('complete');

    // File operations
    if (/file|read|write|create|delete|modify/i.test(message)) tags.push('file');

    // Git operations
    if (/git|commit|push|pull|merge|branch/i.test(message)) tags.push('git');

    // Test
    if (/test|spec|assert/i.test(message)) tags.push('test');

    // Build
    if (/build|compile|bundle/i.test(message)) tags.push('build');

    return tags;
  }

  /**
   * Notify subscribers
   */
  private notifySubscribers(entry: AggregatedLogEntry): void {
    for (const subscriber of this.subscribers.values()) {
      if (this.matchesFilter(entry, subscriber.filter)) {
        try {
          subscriber.callback(entry);
        } catch (error) {
          log.error({ err: error }, `[LogAggregator] Error in subscriber ${subscriber.id}`);
        }
      }
    }
  }

  /**
   * Check if entry matches filter criteria.
   */
  private matchesFilter(entry: AggregatedLogEntry, filter: LogFilter): boolean {
    if (filter.agentIds && !filter.agentIds.includes(entry.agentId)) {
      return false;
    }

    if (filter.taskIds && !filter.taskIds.includes(entry.taskId)) {
      return false;
    }

    if (filter.levels && !filter.levels.includes(entry.level)) {
      return false;
    }

    if (filter.fromTimestamp && entry.timestamp < filter.fromTimestamp) {
      return false;
    }

    if (filter.toTimestamp && entry.timestamp > filter.toTimestamp) {
      return false;
    }

    if (
      filter.searchText &&
      !entry.message.toLowerCase().includes(filter.searchText.toLowerCase())
    ) {
      return false;
    }

    return true;
  }

  /**
   * Subscribe to logs.
   */
  subscribe(filter: LogFilter, callback: (entry: AggregatedLogEntry) => void): string {
    const subscriberId = `sub-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    this.subscribers.set(subscriberId, {
      id: subscriberId,
      filter,
      callback,
    });

    return subscriberId;
  }

  /**
   * Unsubscribe from logs.
   */
  unsubscribe(subscriberId: string): void {
    this.subscribers.delete(subscriberId);
  }

  /**
   * Query logs.
   */
  query(filter: LogFilter, limit?: number, offset?: number): AggregatedLogEntry[] {
    const results: AggregatedLogEntry[] = [];

    // Get valid logs.
    const validLogs = this.getValidLogs();

    for (const entry of validLogs) {
      if (this.matchesFilter(entry, filter)) {
        results.push(entry);
      }
    }

    // Sort (timestamp descending)
    results.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    // Pagination
    const start = offset || 0;
    const end = limit ? start + limit : results.length;

    return results.slice(start, end);
  }

  /**
   * Get valid logs (from ring buffer).
   */
  private getValidLogs(): AggregatedLogEntry[] {
    if (this.isFull) {
      return this.logs.filter(Boolean);
    } else {
      return this.logs.slice(0, this.bufferIndex).filter(Boolean);
    }
  }

  /**
   * Get logs by task.
   */
  getLogsByTask(taskId: number, limit?: number): AggregatedLogEntry[] {
    return this.query({ taskIds: [taskId] }, limit);
  }

  /**
   * Get logs by agent.
   */
  getLogsByAgent(agentId: string, limit?: number): AggregatedLogEntry[] {
    return this.query({ agentIds: [agentId] }, limit);
  }

  /**
   * Get error logs.
   */
  getErrorLogs(limit?: number): AggregatedLogEntry[] {
    return this.query({ levels: ['error', 'warn'] }, limit);
  }

  /**
   * Get recent logs.
   */
  getRecentLogs(count: number): AggregatedLogEntry[] {
    return this.query({}, count);
  }

  /**
   * Get log summary.
   */
  getSummary(): LogSummary {
    const validLogs = this.getValidLogs();

    const byAgent: Record<string, number> = {};
    const byTask: Record<number, number> = {};
    const byLevel: Record<string, number> = {};
    let minTime = new Date();
    let maxTime = new Date(0);

    for (const log of validLogs) {
      // By agent
      byAgent[log.agentId] = (byAgent[log.agentId] || 0) + 1;

      // By task
      byTask[log.taskId] = (byTask[log.taskId] || 0) + 1;

      // By level
      byLevel[log.level] = (byLevel[log.level] || 0) + 1;

      // Time range
      if (log.timestamp < minTime) minTime = log.timestamp;
      if (log.timestamp > maxTime) maxTime = log.timestamp;
    }

    return {
      totalLogs: validLogs.length,
      byAgent,
      byTask,
      byLevel,
      timeRange: {
        start: minTime,
        end: maxTime,
      },
    };
  }

  /**
   * Clear logs.
   */
  clear(): void {
    this.logs = new Array(this.maxLogs);
    this.bufferIndex = 0;
    this.isFull = false;
    this.sequence = 0;
  }

  /**
   * Export logs.
   */
  export(filter?: LogFilter): string {
    const logs = filter ? this.query(filter) : this.getValidLogs();

    const exportData = {
      exportedAt: new Date().toISOString(),
      totalLogs: logs.length,
      logs: logs.map((log) => ({
        ...log,
        timestamp: log.timestamp.toISOString(),
      })),
    };

    return JSON.stringify(exportData, null, 2);
  }

  /**
   * Get interleaved logs for multiple tasks.
   */
  getInterleavedLogs(taskIds: number[], limit?: number): AggregatedLogEntry[] {
    return this.query({ taskIds }, limit);
  }

  /**
   * Search logs by tag.
   */
  getLogsByTag(tag: string, limit?: number): AggregatedLogEntry[] {
    const validLogs = this.getValidLogs();
    const results = validLogs.filter((log) => log.tags.includes(tag));
    results.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    return limit ? results.slice(0, limit) : results;
  }
}

/**
 * Log formatter
 */
export class LogFormatter {
  /**
   * Format log as terminal output.
   */
  static toTerminal(entry: AggregatedLogEntry): string {
    const timestamp = entry.timestamp.toISOString().slice(11, 23);
    const level = entry.level.toUpperCase().padEnd(5);
    const agent = entry.agentId.slice(0, 15).padEnd(15);

    return `[${timestamp}] [${level}] [${agent}] ${entry.message}`;
  }

  /**
   * Format log as JSON.
   */
  static toJson(entry: AggregatedLogEntry): string {
    return JSON.stringify({
      timestamp: entry.timestamp.toISOString(),
      level: entry.level,
      agentId: entry.agentId,
      taskId: entry.taskId,
      message: entry.message,
      tags: entry.tags,
      metadata: entry.metadata,
    });
  }

  /**
   * Format logs as Markdown.
   */
  static toMarkdown(entries: AggregatedLogEntry[]): string {
    let markdown = '# 実行ログ\n\n';

    // Group by task
    const byTask = new Map<number, AggregatedLogEntry[]>();
    for (const entry of entries) {
      if (!byTask.has(entry.taskId)) {
        byTask.set(entry.taskId, []);
      }
      byTask.get(entry.taskId)!.push(entry);
    }

    for (const [taskId, logs] of byTask) {
      markdown += `## タスク ${taskId}\n\n`;

      for (const log of logs) {
        const icon =
          log.level === 'error'
            ? '❌'
            : log.level === 'warn'
              ? '⚠️'
              : log.level === 'info'
                ? 'ℹ️'
                : '🔍';

        markdown += `- ${icon} **${log.timestamp.toLocaleTimeString()}** [${log.agentId}]: ${log.message}\n`;
      }

      markdown += '\n';
    }

    return markdown;
  }
}

/**
 * Factory function for creating a log aggregator.
 */
export function createLogAggregator(maxLogs?: number): LogAggregator {
  return new LogAggregator(maxLogs);
}
