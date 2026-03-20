/**
 * Real-time Communication Service
 *
 * Streams agent execution status and GitHub events via SSE (Server-Sent Events).
 */

import { createLogger } from '../../config/logger';

const log = createLogger('realtime-service');

export type SSEEvent = {
  type: string;
  data: unknown;
  id?: string;
  timestamp: Date;
};

export type SSEClient = {
  id: string;
  response: {
    write: (data: string) => void;
    flush?: () => void;
  };
  subscriptions: Set<string>;
  connectedAt: Date;
  lastPingAt: Date;
};

export type EventChannel =
  | 'agent_execution'
  | 'github_events'
  | 'notifications'
  | 'task_updates'
  | `execution:${number}`
  | `session:${number}`
  | `task:${number}`;

/**
 * Realtime service class
 */
export class RealtimeService {
  private static instance: RealtimeService;
  private clients: Map<string, SSEClient> = new Map();
  private eventHistory: Map<string, SSEEvent[]> = new Map();
  private maxHistorySize: number = 100;
  private pingInterval: NodeJS.Timeout | null = null;
  private nextClientId: number = 1;
  /** Map for managing SSE ReadableStreamControllers (for explicit close) */
  private streamControllers: Map<string, ReadableStreamDefaultController<Uint8Array>> = new Map();

  private constructor() {
    // Start periodic ping (every 30 seconds)
    this.startPingInterval();
  }

  static getInstance(): RealtimeService {
    if (!RealtimeService.instance) {
      RealtimeService.instance = new RealtimeService();
    }
    return RealtimeService.instance;
  }

  /**
   * Register a new SSE client.
   */
  registerClient(response: SSEClient['response'], subscriptions: string[] = []): string {
    const clientId = `client-${this.nextClientId++}`;
    const client: SSEClient = {
      id: clientId,
      response,
      subscriptions: new Set(subscriptions),
      connectedAt: new Date(),
      lastPingAt: new Date(),
    };

    this.clients.set(clientId, client);

    // Send connection success message
    this.sendToClient(clientId, {
      type: 'connected',
      data: { clientId, subscriptions },
      timestamp: new Date(),
    });

    return clientId;
  }

  /**
   * Remove a client.
   */
  removeClient(clientId: string): void {
    this.clients.delete(clientId);
    // Also remove stream controller (may already be closed)
    this.streamControllers.delete(clientId);
  }

  /**
   * Register an SSE StreamController.
   * Used for explicit close during shutdown.
   */
  registerStreamController(
    clientId: string,
    controller: ReadableStreamDefaultController<Uint8Array>,
  ): void {
    this.streamControllers.set(clientId, controller);
  }

  /**
   * Remove an SSE StreamController.
   */
  removeStreamController(clientId: string): void {
    this.streamControllers.delete(clientId);
  }

  /**
   * Update client subscriptions.
   */
  updateSubscriptions(clientId: string, subscriptions: string[]): void {
    const client = this.clients.get(clientId);
    if (client) {
      client.subscriptions = new Set(subscriptions);
    }
  }

  /**
   * Add a subscription.
   */
  addSubscription(clientId: string, channel: string): void {
    const client = this.clients.get(clientId);
    if (client) {
      client.subscriptions.add(channel);
    }
  }

  /**
   * Remove a subscription.
   */
  removeSubscription(clientId: string, channel: string): void {
    const client = this.clients.get(clientId);
    if (client) {
      client.subscriptions.delete(channel);
    }
  }

  /**
   * Send an event to a specific client.
   */
  private sendToClient(clientId: string, event: SSEEvent): boolean {
    const client = this.clients.get(clientId);
    if (!client) {
      return false;
    }

    try {
      const eventString = this.formatSSEEvent(event);
      client.response.write(eventString);
      if (client.response.flush) {
        client.response.flush();
      }
      return true;
    } catch (error) {
      log.error({ err: error }, `Failed to send to client ${clientId}`);
      this.removeClient(clientId);
      return false;
    }
  }

  /**
   * Format an SSE event.
   */
  private formatSSEEvent(event: SSEEvent): string {
    let result = '';
    if (event.id) {
      result += `id: ${event.id}\n`;
    }
    result += `event: ${event.type}\n`;
    result += `data: ${JSON.stringify(event.data)}\n\n`;
    return result;
  }

  /**
   * Send an event to a channel.
   */
  broadcast(channel: EventChannel | string, eventType: string, data: unknown): void {
    const event: SSEEvent = {
      type: eventType,
      data,
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      timestamp: new Date(),
    };

    // Add to history
    this.addToHistory(channel, event);

    // Send to subscribed clients
    for (const client of this.clients.values()) {
      if (client.subscriptions.has(channel) || client.subscriptions.has('*')) {
        this.sendToClient(client.id, event);
      }
    }
  }

  /**
   * Send an event to all clients.
   */
  broadcastAll(eventType: string, data: unknown): void {
    const event: SSEEvent = {
      type: eventType,
      data,
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      timestamp: new Date(),
    };

    for (const client of this.clients.values()) {
      this.sendToClient(client.id, event);
    }
  }

  /**
   * Send agent execution output.
   */
  sendExecutionOutput(executionId: number, output: string, isError: boolean = false): void {
    this.broadcast(`execution:${executionId}`, 'execution_output', {
      executionId,
      output,
      isError,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Send agent execution status update.
   */
  sendExecutionStatusUpdate(
    executionId: number,
    status: string,
    details?: Record<string, unknown>,
  ): void {
    this.broadcast(`execution:${executionId}`, 'execution_status', {
      executionId,
      status,
      ...details,
      timestamp: new Date().toISOString(),
    });

    // Also send to agent_execution channel
    this.broadcast('agent_execution', 'execution_status', {
      executionId,
      status,
      ...details,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Send a GitHub event.
   */
  sendGitHubEvent(eventType: string, data: unknown): void {
    this.broadcast('github_events', eventType, data);
  }

  /**
   * Send a notification.
   */
  sendNotification(notification: {
    id: number;
    type: string;
    title: string;
    message: string;
    link?: string;
  }): void {
    this.broadcast('notifications', 'new_notification', notification);
  }

  /**
   * Send a task update.
   */
  sendTaskUpdate(taskId: number, updateType: string, data: unknown): void {
    this.broadcast(`task:${taskId}`, updateType, {
      taskId,
      ...(data as object),
    });
    this.broadcast('task_updates', updateType, { taskId, ...(data as object) });
  }

  /**
   * Add to history
   */
  private addToHistory(channel: string, event: SSEEvent): void {
    if (!this.eventHistory.has(channel)) {
      this.eventHistory.set(channel, []);
    }
    const history = this.eventHistory.get(channel)!;
    history.push(event);

    // Remove old entries when max size is exceeded
    while (history.length > this.maxHistorySize) {
      history.shift();
    }
  }

  /**
   * Get channel history.
   */
  getChannelHistory(channel: string, since?: Date): SSEEvent[] {
    const history = this.eventHistory.get(channel) || [];
    if (since) {
      return history.filter((event) => event.timestamp > since);
    }
    return [...history];
  }

  /**
   * Start ping interval.
   */
  private startPingInterval(): void {
    this.pingInterval = setInterval(() => {
      const now = new Date();
      for (const client of this.clients.values()) {
        this.sendToClient(client.id, {
          type: 'ping',
          data: { timestamp: now.toISOString() },
          timestamp: now,
        });
        client.lastPingAt = now;
      }
    }, 30000);
  }

  /**
   * Shut down the service.
   * Explicitly close all SSE connections to release sockets.
   */
  shutdown(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    // Send disconnect notification to all clients
    this.broadcastAll('shutdown', { reason: 'Server shutting down' });

    // Explicitly close all SSE streams (prevents CLOSE_WAIT accumulation)
    const controllerCount = this.streamControllers.size;
    for (const [clientId, controller] of this.streamControllers) {
      try {
        controller.close();
        log.info(`[SSE] Closed stream for client ${clientId}`);
      } catch (error) {
        // Ignore if already closed
      }
    }
    if (controllerCount > 0) {
      log.info(`[SSE] Closed ${controllerCount} SSE stream(s) during shutdown`);
    }

    this.streamControllers.clear();
    this.clients.clear();
  }

  /**
   * Get the number of connected clients.
   */
  getClientCount(): number {
    return this.clients.size;
  }

  /**
   * Get client information.
   */
  getClients(): Array<{
    id: string;
    subscriptions: string[];
    connectedAt: Date;
  }> {
    return Array.from(this.clients.values()).map((client) => ({
      id: client.id,
      subscriptions: Array.from(client.subscriptions),
      connectedAt: client.connectedAt,
    }));
  }
}

// Export singleton instance
export const realtimeService = RealtimeService.getInstance();
