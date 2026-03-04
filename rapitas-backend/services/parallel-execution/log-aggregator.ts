/**
 * ログ集約システム
 * 複数のサブエージェントからの実行ログを集約・フィルタリング・共有する
 */

import { EventEmitter } from 'events';
import type { ExecutionLogEntry } from './types';

/**
 * ログフィルターの条件
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
 * 集約ログエントリー
 */
type AggregatedLogEntry = ExecutionLogEntry & {
  id: string;
  sequence: number;
  tags: string[];
};

/**
 * ログサマリー
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
 * ログ購読者
 */
type LogSubscriber = {
  id: string;
  filter: LogFilter;
  callback: (entry: AggregatedLogEntry) => void;
};

/**
 * ログ集約クラス
 */
export class LogAggregator extends EventEmitter {
  private logs: AggregatedLogEntry[] = [];
  private maxLogs: number;
  private sequence: number = 0;
  private subscribers: Map<string, LogSubscriber> = new Map();

  // リングバッファ用インデックス
  private bufferIndex: number = 0;
  private isFull: boolean = false;

  constructor(maxLogs: number = 10000) {
    super();
    this.maxLogs = maxLogs;
    this.logs = new Array(maxLogs);
  }

  /**
   * ログを追加
   */
  addLog(entry: ExecutionLogEntry): string {
    const aggregatedEntry: AggregatedLogEntry = {
      ...entry,
      id: `log-${Date.now()}-${this.sequence}`,
      sequence: this.sequence++,
      tags: this.extractTags(entry.message),
    };

    // リングバッファにログを追加
    this.logs[this.bufferIndex] = aggregatedEntry;
    this.bufferIndex = (this.bufferIndex + 1) % this.maxLogs;
    if (this.bufferIndex === 0) {
      this.isFull = true;
    }

    // イベントを発火
    this.emit('log', aggregatedEntry);

    // 購読者に通知
    this.notifySubscribers(aggregatedEntry);

    return aggregatedEntry.id;
  }

  /**
   * メッセージからタグを抽出
   */
  private extractTags(message: string): string[] {
    const tags: string[] = [];

    // エラー関連
    if (/error|fail|exception/i.test(message)) tags.push('error');
    if (/warn|warning/i.test(message)) tags.push('warning');

    // 進捗関連
    if (/start|begin/i.test(message)) tags.push('start');
    if (/complete|finish|done|success/i.test(message)) tags.push('complete');

    // ファイル操作
    if (/file|read|write|create|delete|modify/i.test(message)) tags.push('file');

    // Git操作
    if (/git|commit|push|pull|merge|branch/i.test(message)) tags.push('git');

    // テスト
    if (/test|spec|assert/i.test(message)) tags.push('test');

    // ビルド
    if (/build|compile|bundle/i.test(message)) tags.push('build');

    return tags;
  }

  /**
   * 購読者に通知
   */
  private notifySubscribers(entry: AggregatedLogEntry): void {
    for (const subscriber of this.subscribers.values()) {
      if (this.matchesFilter(entry, subscriber.filter)) {
        try {
          subscriber.callback(entry);
        } catch (error) {
          console.error(`[LogAggregator] Error in subscriber ${subscriber.id}:`, error);
        }
      }
    }
  }

  /**
   * フィルター条件にマッチするかチェック
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

    if (filter.searchText && !entry.message.toLowerCase().includes(filter.searchText.toLowerCase())) {
      return false;
    }

    return true;
  }

  /**
   * ログを購読
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
   * 購読を解除
   */
  unsubscribe(subscriberId: string): void {
    this.subscribers.delete(subscriberId);
  }

  /**
   * ログを検索
   */
  query(filter: LogFilter, limit?: number, offset?: number): AggregatedLogEntry[] {
    const results: AggregatedLogEntry[] = [];

    // 有効なログを取得
    const validLogs = this.getValidLogs();

    for (const entry of validLogs) {
      if (this.matchesFilter(entry, filter)) {
        results.push(entry);
      }
    }

    // ソート（タイムスタンプ降順）
    results.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    // ページネーション
    const start = offset || 0;
    const end = limit ? start + limit : results.length;

    return results.slice(start, end);
  }

  /**
   * 有効なログを取得（リングバッファから）
   */
  private getValidLogs(): AggregatedLogEntry[] {
    if (this.isFull) {
      // バッファが一杯の場合、すべてのログを返す
      return this.logs.filter(Boolean);
    } else {
      // バッファが一杯でない場合、書き込まれた部分のみ
      return this.logs.slice(0, this.bufferIndex).filter(Boolean);
    }
  }

  /**
   * タスク別のログを取得
   */
  getLogsByTask(taskId: number, limit?: number): AggregatedLogEntry[] {
    return this.query({ taskIds: [taskId] }, limit);
  }

  /**
   * エージェント別のログを取得
   */
  getLogsByAgent(agentId: string, limit?: number): AggregatedLogEntry[] {
    return this.query({ agentIds: [agentId] }, limit);
  }

  /**
   * エラーログを取得
   */
  getErrorLogs(limit?: number): AggregatedLogEntry[] {
    return this.query({ levels: ['error', 'warn'] }, limit);
  }

  /**
   * 最新のログを取得
   */
  getRecentLogs(count: number): AggregatedLogEntry[] {
    return this.query({}, count);
  }

  /**
   * ログのサマリーを取得
   */
  getSummary(): LogSummary {
    const validLogs = this.getValidLogs();

    const byAgent: Record<string, number> = {};
    const byTask: Record<number, number> = {};
    const byLevel: Record<string, number> = {};
    let minTime = new Date();
    let maxTime = new Date(0);

    for (const log of validLogs) {
      // エージェント別
      byAgent[log.agentId] = (byAgent[log.agentId] || 0) + 1;

      // タスク別
      byTask[log.taskId] = (byTask[log.taskId] || 0) + 1;

      // レベル別
      byLevel[log.level] = (byLevel[log.level] || 0) + 1;

      // 時間範囲
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
   * ログをクリア
   */
  clear(): void {
    this.logs = new Array(this.maxLogs);
    this.bufferIndex = 0;
    this.isFull = false;
    this.sequence = 0;
  }

  /**
   * ログをエクスポート
   */
  export(filter?: LogFilter): string {
    const logs = filter ? this.query(filter) : this.getValidLogs();

    const exportData = {
      exportedAt: new Date().toISOString(),
      totalLogs: logs.length,
      logs: logs.map(log => ({
        ...log,
        timestamp: log.timestamp.toISOString(),
      })),
    };

    return JSON.stringify(exportData, null, 2);
  }

  /**
   * 複数タスクのインターリーブされたログを取得
   */
  getInterleavedLogs(taskIds: number[], limit?: number): AggregatedLogEntry[] {
    return this.query({ taskIds }, limit);
  }

  /**
   * タグでログを検索
   */
  getLogsByTag(tag: string, limit?: number): AggregatedLogEntry[] {
    const validLogs = this.getValidLogs();
    const results = validLogs.filter(log => log.tags.includes(tag));
    results.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    return limit ? results.slice(0, limit) : results;
  }
}

/**
 * ログフォーマッター
 */
export class LogFormatter {
  /**
   * ログをターミナル形式でフォーマット
   */
  static toTerminal(entry: AggregatedLogEntry): string {
    const timestamp = entry.timestamp.toISOString().slice(11, 23);
    const level = entry.level.toUpperCase().padEnd(5);
    const agent = entry.agentId.slice(0, 15).padEnd(15);

    return `[${timestamp}] [${level}] [${agent}] ${entry.message}`;
  }

  /**
   * ログをJSON形式でフォーマット
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
   * ログをMarkdown形式でフォーマット
   */
  static toMarkdown(entries: AggregatedLogEntry[]): string {
    let markdown = '# 実行ログ\n\n';

    // タスク別にグループ化
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
        const icon = log.level === 'error' ? '❌' :
                     log.level === 'warn' ? '⚠️' :
                     log.level === 'info' ? 'ℹ️' : '🔍';

        markdown += `- ${icon} **${log.timestamp.toLocaleTimeString()}** [${log.agentId}]: ${log.message}\n`;
      }

      markdown += '\n';
    }

    return markdown;
  }
}

/**
 * ログ集約器のファクトリー関数
 */
export function createLogAggregator(maxLogs?: number): LogAggregator {
  return new LogAggregator(maxLogs);
}
