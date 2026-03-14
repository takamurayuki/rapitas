/**
 * Agent Abstraction Layer - Event Emitter
 *
 * Manages and dispatches agent events.
 */

import { createLogger } from '../../../config/logger';

const log = createLogger('agent-event-emitter');

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
 * Event listener metadata.
 */
interface EventListener<T extends AgentEvent = AgentEvent> {
  id: string;
  handler: AgentEventHandler<T>;
  once: boolean;
}

/**
 * Agent event emitter.
 * Provides type-safe event emission and subscription.
 */
export class AgentEventEmitter {
  private listeners: Map<AgentEventType, EventListener[]> = new Map();
  private allListeners: EventListener<AgentEvent>[] = [];
  private nextListenerId = 1;
  private eventHistory: AgentEvent[] = [];
  private maxHistorySize = 1000;

  /**
   * Agent ID and execution ID used when creating events.
   */
  constructor(
    private readonly agentId: string,
    private executionId: string = '',
  ) {}

  /**
   * Sets the execution ID for subsequent events.
   */
  setExecutionId(executionId: string): void {
    this.executionId = executionId;
  }

  /**
   * Subscribes to events of a specific type.
   */
  on<T extends AgentEvent>(type: AgentEventType, handler: AgentEventHandler<T>): () => void {
    const listenerId = `listener-${this.nextListenerId++}`;
    const listener: EventListener = {
      id: listenerId,
      handler: handler as AgentEventHandler,
      once: false,
    };

    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);

    // Return unsubscribe function
    return () => {
      this.off(type, listenerId);
    };
  }

  /**
   * Subscribes to a single event of a specific type (fires once).
   */
  once<T extends AgentEvent>(type: AgentEventType, handler: AgentEventHandler<T>): () => void {
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
   * Subscribes to all event types.
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
      this.allListeners = this.allListeners.filter((l) => l.id !== listenerId);
    };
  }

  /**
   * Removes a specific listener.
   */
  off(type: AgentEventType, listenerId: string): void {
    const listeners = this.listeners.get(type);
    if (listeners) {
      this.listeners.set(
        type,
        listeners.filter((l) => l.id !== listenerId),
      );
    }
  }

  /**
   * Removes all listeners, optionally filtered by type.
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
   * Emits an event to all matching listeners.
   */
  async emit<T extends AgentEvent>(event: T): Promise<void> {
    // Add to event history
    this.eventHistory.push(event);
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory.shift();
    }

    // Invoke type-specific listeners
    const listeners = this.listeners.get(event.type) || [];
    const listenersToRemove: string[] = [];

    for (const listener of listeners) {
      try {
        await listener.handler(event);
      } catch (error) {
        log.error({ err: error }, `Event handler error for ${event.type}`);
      }

      if (listener.once) {
        listenersToRemove.push(listener.id);
      }
    }

    // Remove once-listeners that have fired
    if (listenersToRemove.length > 0) {
      this.listeners.set(
        event.type,
        listeners.filter((l) => !listenersToRemove.includes(l.id)),
      );
    }

    // Invoke catch-all listeners
    const allListenersToRemove: string[] = [];
    for (const listener of this.allListeners) {
      try {
        await listener.handler(event);
      } catch (error) {
        log.error({ err: error }, `All-event handler error`);
      }

      if (listener.once) {
        allListenersToRemove.push(listener.id);
      }
    }

    if (allListenersToRemove.length > 0) {
      this.allListeners = this.allListeners.filter((l) => !allListenersToRemove.includes(l.id));
    }
  }

  // ============================================================================
  // Convenience emit methods
  // ============================================================================

  /**
   * Emits a state change event.
   */
  emitStateChange(previousState: AgentState, newState: AgentState, reason?: string): Promise<void> {
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
   * Emits an output event.
   */
  emitOutput(content: string, isError = false, isPartial = false): Promise<void> {
    if (content == null || content === 'null' || content === 'undefined') {
      return Promise.resolve();
    }
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
   * Emits an error event.
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
   * Emits a tool start event.
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
   * Emits a tool end event.
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
   * Emits a question event.
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
   * Emits a progress event.
   */
  emitProgress(current: number, total: number, message?: string, subtask?: string): Promise<void> {
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
   * Emits an artifact event.
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
   * Emits a commit event.
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
   * Emits a metrics update event.
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
  // Utilities
  // ============================================================================

  /**
   * Returns the event history, optionally filtered.
   */
  getEventHistory(type?: AgentEventType, limit?: number): AgentEvent[] {
    let events = type ? this.eventHistory.filter((e) => e.type === type) : [...this.eventHistory];

    if (limit && limit > 0) {
      events = events.slice(-limit);
    }

    return events;
  }

  /**
   * Clears the event history.
   */
  clearEventHistory(): void {
    this.eventHistory = [];
  }

  /**
   * Returns the total number of registered listeners.
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
   * Creates an async iterable event stream.
   */
  stream(types?: AgentEventType[]): AsyncIterable<AgentEvent> {
    const eventQueue: AgentEvent[] = [];
    let resolveNext: ((value: IteratorResult<AgentEvent>) => void) | null = null;
    let isEnded = false;

    // Set up listener
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

    // Return AsyncIterable
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
 * Factory function to create an event emitter.
 */
export function createAgentEventEmitter(agentId: string, executionId?: string): AgentEventEmitter {
  return new AgentEventEmitter(agentId, executionId);
}
