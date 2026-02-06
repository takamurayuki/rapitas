/**
 * AIエージェント抽象化レイヤー - イベントエミッター
 * エージェントのイベントを管理・配信する
 */

import type {
  AgentEvent,
  AgentEventType,
  AgentEventHandler,
  StateChangeEvent,
  OutputEvent,
  ErrorEvent,
  ToolStartEvent,
  ToolEndEvent,
  QuestionEvent,
  ProgressEvent,
  ArtifactEvent,
  CommitEvent,
  MetricsUpdateEvent,
  AgentState,
  PendingQuestion,
  AgentArtifact,
  GitCommitInfo,
  ExecutionMetrics,
} from './types';

/**
 * イベントリスナー情報
 */
interface EventListener<T extends AgentEvent = AgentEvent> {
  id: string;
  handler: AgentEventHandler<T>;
  once: boolean;
}

/**
 * エージェントイベントエミッター
 * 型安全なイベント発行・購読を提供
 */
export class AgentEventEmitter {
  private listeners: Map<AgentEventType, EventListener[]> = new Map();
  private allListeners: EventListener<AgentEvent>[] = [];
  private nextListenerId = 1;
  private eventHistory: AgentEvent[] = [];
  private maxHistorySize = 1000;

  /**
   * 実行IDとエージェントID（イベント作成時に使用）
   */
  constructor(
    private readonly agentId: string,
    private executionId: string = '',
  ) {}

  /**
   * 実行IDを設定
   */
  setExecutionId(executionId: string): void {
    this.executionId = executionId;
  }

  /**
   * イベントをリッスン
   */
  on<T extends AgentEvent>(
    type: AgentEventType,
    handler: AgentEventHandler<T>,
  ): () => void {
    const listenerId = `listener-${this.nextListenerId++}`;
    const listener: EventListener = {
      id: listenerId,
      handler: handler as AgentEventHandler,
      once: false,
    };

    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);

    // アンサブスクライブ関数を返す
    return () => {
      this.off(type, listenerId);
    };
  }

  /**
   * 一度だけイベントをリッスン
   */
  once<T extends AgentEvent>(
    type: AgentEventType,
    handler: AgentEventHandler<T>,
  ): () => void {
    const listenerId = `listener-${this.nextListenerId++}`;
    const listener: EventListener = {
      id: listenerId,
      handler: handler as AgentEventHandler,
      once: true,
    };

    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);

    return () => {
      this.off(type, listenerId);
    };
  }

  /**
   * すべてのイベントをリッスン
   */
  onAll(handler: AgentEventHandler<AgentEvent>): () => void {
    const listenerId = `listener-${this.nextListenerId++}`;
    const listener: EventListener<AgentEvent> = {
      id: listenerId,
      handler,
      once: false,
    };

    this.allListeners.push(listener);

    return () => {
      this.allListeners = this.allListeners.filter(l => l.id !== listenerId);
    };
  }

  /**
   * リスナーを削除
   */
  off(type: AgentEventType, listenerId: string): void {
    const listeners = this.listeners.get(type);
    if (listeners) {
      this.listeners.set(
        type,
        listeners.filter(l => l.id !== listenerId),
      );
    }
  }

  /**
   * 特定タイプのすべてのリスナーを削除
   */
  removeAllListeners(type?: AgentEventType): void {
    if (type) {
      this.listeners.delete(type);
    } else {
      this.listeners.clear();
      this.allListeners = [];
    }
  }

  /**
   * イベントを発行
   */
  async emit<T extends AgentEvent>(event: T): Promise<void> {
    // 履歴に追加
    this.eventHistory.push(event);
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory.shift();
    }

    // 型固有のリスナーを呼び出し
    const listeners = this.listeners.get(event.type) || [];
    const listenersToRemove: string[] = [];

    for (const listener of listeners) {
      try {
        await listener.handler(event);
      } catch (error) {
        console.error(`Event handler error for ${event.type}:`, error);
      }

      if (listener.once) {
        listenersToRemove.push(listener.id);
      }
    }

    // onceリスナーを削除
    if (listenersToRemove.length > 0) {
      this.listeners.set(
        event.type,
        listeners.filter(l => !listenersToRemove.includes(l.id)),
      );
    }

    // 全イベントリスナーを呼び出し
    const allListenersToRemove: string[] = [];
    for (const listener of this.allListeners) {
      try {
        await listener.handler(event);
      } catch (error) {
        console.error(`All-event handler error:`, error);
      }

      if (listener.once) {
        allListenersToRemove.push(listener.id);
      }
    }

    if (allListenersToRemove.length > 0) {
      this.allListeners = this.allListeners.filter(
        l => !allListenersToRemove.includes(l.id),
      );
    }
  }

  // ============================================================================
  // 便利な発行メソッド
  // ============================================================================

  /**
   * 状態変更イベントを発行
   */
  emitStateChange(
    previousState: AgentState,
    newState: AgentState,
    reason?: string,
  ): Promise<void> {
    const event: StateChangeEvent = {
      type: 'state_change',
      timestamp: new Date(),
      executionId: this.executionId,
      agentId: this.agentId,
      previousState,
      newState,
      reason,
    };
    return this.emit(event);
  }

  /**
   * 出力イベントを発行
   */
  emitOutput(content: string, isError = false, isPartial = false): Promise<void> {
    const event: OutputEvent = {
      type: 'output',
      timestamp: new Date(),
      executionId: this.executionId,
      agentId: this.agentId,
      content,
      isError,
      isPartial,
    };
    return this.emit(event);
  }

  /**
   * エラーイベントを発行
   */
  emitError(error: Error, recoverable = false, context?: string): Promise<void> {
    const event: ErrorEvent = {
      type: 'error',
      timestamp: new Date(),
      executionId: this.executionId,
      agentId: this.agentId,
      error,
      recoverable,
      context,
    };
    return this.emit(event);
  }

  /**
   * ツール開始イベントを発行
   */
  emitToolStart(toolId: string, toolName: string, input: unknown): Promise<void> {
    const event: ToolStartEvent = {
      type: 'tool_start',
      timestamp: new Date(),
      executionId: this.executionId,
      agentId: this.agentId,
      toolId,
      toolName,
      input,
    };
    return this.emit(event);
  }

  /**
   * ツール終了イベントを発行
   */
  emitToolEnd(
    toolId: string,
    toolName: string,
    output: unknown,
    success: boolean,
    durationMs: number,
    error?: string,
  ): Promise<void> {
    const event: ToolEndEvent = {
      type: 'tool_end',
      timestamp: new Date(),
      executionId: this.executionId,
      agentId: this.agentId,
      toolId,
      toolName,
      output,
      success,
      durationMs,
      error,
    };
    return this.emit(event);
  }

  /**
   * 質問イベントを発行
   */
  emitQuestion(question: PendingQuestion): Promise<void> {
    const event: QuestionEvent = {
      type: 'question',
      timestamp: new Date(),
      executionId: this.executionId,
      agentId: this.agentId,
      question,
    };
    return this.emit(event);
  }

  /**
   * 進捗イベントを発行
   */
  emitProgress(
    current: number,
    total: number,
    message?: string,
    subtask?: string,
  ): Promise<void> {
    const event: ProgressEvent = {
      type: 'progress',
      timestamp: new Date(),
      executionId: this.executionId,
      agentId: this.agentId,
      current,
      total,
      message,
      subtask,
    };
    return this.emit(event);
  }

  /**
   * 成果物イベントを発行
   */
  emitArtifact(artifact: AgentArtifact): Promise<void> {
    const event: ArtifactEvent = {
      type: 'artifact',
      timestamp: new Date(),
      executionId: this.executionId,
      agentId: this.agentId,
      artifact,
    };
    return this.emit(event);
  }

  /**
   * コミットイベントを発行
   */
  emitCommit(commit: GitCommitInfo): Promise<void> {
    const event: CommitEvent = {
      type: 'commit',
      timestamp: new Date(),
      executionId: this.executionId,
      agentId: this.agentId,
      commit,
    };
    return this.emit(event);
  }

  /**
   * メトリクス更新イベントを発行
   */
  emitMetricsUpdate(metrics: Partial<ExecutionMetrics>): Promise<void> {
    const event: MetricsUpdateEvent = {
      type: 'metrics_update',
      timestamp: new Date(),
      executionId: this.executionId,
      agentId: this.agentId,
      metrics,
    };
    return this.emit(event);
  }

  // ============================================================================
  // ユーティリティ
  // ============================================================================

  /**
   * イベント履歴を取得
   */
  getEventHistory(type?: AgentEventType, limit?: number): AgentEvent[] {
    let events = type
      ? this.eventHistory.filter(e => e.type === type)
      : [...this.eventHistory];

    if (limit && limit > 0) {
      events = events.slice(-limit);
    }

    return events;
  }

  /**
   * イベント履歴をクリア
   */
  clearEventHistory(): void {
    this.eventHistory = [];
  }

  /**
   * リスナー数を取得
   */
  listenerCount(type?: AgentEventType): number {
    if (type) {
      return (this.listeners.get(type) || []).length;
    }
    let count = this.allListeners.length;
    for (const listeners of this.listeners.values()) {
      count += listeners.length;
    }
    return count;
  }

  /**
   * イベントストリームを作成（AsyncIterable）
   */
  stream(types?: AgentEventType[]): AsyncIterable<AgentEvent> {
    const eventQueue: AgentEvent[] = [];
    let resolveNext: ((value: IteratorResult<AgentEvent>) => void) | null = null;
    let isEnded = false;

    // リスナーを設定
    const unsubscribe = this.onAll(async (event) => {
      if (types && !types.includes(event.type)) {
        return;
      }

      if (resolveNext) {
        resolveNext({ value: event, done: false });
        resolveNext = null;
      } else {
        eventQueue.push(event);
      }
    });

    // AsyncIterableを返す
    return {
      [Symbol.asyncIterator](): AsyncIterator<AgentEvent> {
        return {
          async next(): Promise<IteratorResult<AgentEvent>> {
            if (isEnded) {
              return { value: undefined, done: true };
            }

            if (eventQueue.length > 0) {
              return { value: eventQueue.shift()!, done: false };
            }

            return new Promise((resolve) => {
              resolveNext = resolve;
            });
          },

          async return(): Promise<IteratorResult<AgentEvent>> {
            isEnded = true;
            unsubscribe();
            return { value: undefined, done: true };
          },
        };
      },
    };
  }
}

/**
 * イベントエミッターを作成するファクトリー関数
 */
export function createAgentEventEmitter(
  agentId: string,
  executionId?: string,
): AgentEventEmitter {
  return new AgentEventEmitter(agentId, executionId);
}
