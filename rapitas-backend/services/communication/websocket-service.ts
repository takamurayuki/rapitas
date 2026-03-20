import { Elysia, t } from 'elysia';
import { prisma } from '../../config';
import { cacheService } from '../core/cache-service';
import { createLogger } from '../../config/logger';

const log = createLogger('websocket-service');

// WebSocket instance type
interface WebSocketInstance {
  send: (data: string) => void;
  close: () => void;
  readyState: number;
  data?: Record<string, unknown>;
}

// WebSocket client management
interface WSClient {
  id: string;
  ws: WebSocketInstance;
  subscriptions: Set<string>;
  lastActivity: number;
  metadata?: {
    userId?: string;
    sessionId?: string;
  };
}

// WebSocket room management
interface WSRoom {
  name: string;
  clients: Set<string>;
  metadata?: Record<string, unknown>;
}

class WebSocketManager {
  private clients = new Map<string, WSClient>();
  private rooms = new Map<string, WSRoom>();
  private heartbeatInterval?: NodeJS.Timeout;

  constructor() {
    // Periodic health check
    this.heartbeatInterval = setInterval(() => {
      this.checkClientHealth();
    }, 30000); // Every 30 seconds
  }

  // Add a client.
  addClient(
    id: string,
    ws: WebSocketInstance,
    metadata?: { userId?: string; sessionId?: string },
  ): void {
    const client: WSClient = {
      id,
      ws,
      subscriptions: new Set(),
      lastActivity: Date.now(),
      metadata,
    };
    this.clients.set(id, client);
    log.info(`WebSocket client connected: ${id}`);
  }

  // Remove a client.
  removeClient(id: string): void {
    const client = this.clients.get(id);
    if (client) {
      // Unsubscribe from all
      for (const room of client.subscriptions) {
        this.leaveRoom(id, room);
      }
      this.clients.delete(id);
      log.info(`WebSocket client disconnected: ${id}`);
    }
  }

  // Get a client.
  getClient(id: string): WSClient | undefined {
    return this.clients.get(id);
  }

  // Join a room.
  joinRoom(clientId: string, roomName: string): void {
    let room = this.rooms.get(roomName);
    if (!room) {
      room = {
        name: roomName,
        clients: new Set(),
      };
      this.rooms.set(roomName, room);
    }

    room.clients.add(clientId);

    const client = this.clients.get(clientId);
    if (client) {
      client.subscriptions.add(roomName);
    }

    log.info(`Client ${clientId} joined room: ${roomName}`);
  }

  // Leave a room.
  leaveRoom(clientId: string, roomName: string): void {
    const room = this.rooms.get(roomName);
    if (room) {
      room.clients.delete(clientId);

      // Delete empty rooms
      if (room.clients.size === 0) {
        this.rooms.delete(roomName);
      }
    }

    const client = this.clients.get(clientId);
    if (client) {
      client.subscriptions.delete(roomName);
    }

    log.info(`Client ${clientId} left room: ${roomName}`);
  }

  // Send a message to a room.
  sendToRoom(roomName: string, message: unknown): void {
    const room = this.rooms.get(roomName);
    if (!room) return;

    for (const clientId of room.clients) {
      const client = this.clients.get(clientId);
      if (client?.ws.readyState === 1) {
        // WebSocket.OPEN
        client.ws.send(JSON.stringify(message));
        client.lastActivity = Date.now();
      }
    }
  }

  // Send a message to a specific client.
  sendToClient(clientId: string, message: unknown): void {
    const client = this.clients.get(clientId);
    if (client?.ws.readyState === 1) {
      client.ws.send(JSON.stringify(message));
      client.lastActivity = Date.now();
    }
  }

  // Broadcast to all clients.
  broadcast(message: unknown): void {
    for (const [_, client] of this.clients) {
      if (client.ws.readyState === 1) {
        client.ws.send(JSON.stringify(message));
        client.lastActivity = Date.now();
      }
    }
  }

  // Client health check.
  private checkClientHealth(): void {
    const now = Date.now();
    const timeout = 60000; // 60 second timeout

    for (const [id, client] of this.clients) {
      if (now - client.lastActivity > timeout) {
        log.info(`Client ${id} timed out, removing...`);
        this.removeClient(id);
      } else if (client.ws.readyState === 1) {
        // Send ping
        client.ws.send(JSON.stringify({ type: 'ping', timestamp: now }));
      }
    }
  }

  // Get statistics
  getStats() {
    return {
      totalClients: this.clients.size,
      totalRooms: this.rooms.size,
      clients: Array.from(this.clients.entries()).map(([id, client]) => ({
        id,
        subscriptions: Array.from(client.subscriptions),
        lastActivity: new Date(client.lastActivity).toISOString(),
        metadata: client.metadata,
      })),
      rooms: Array.from(this.rooms.entries()).map(([name, room]) => ({
        name,
        clientCount: room.clients.size,
      })),
    };
  }

  // Clean up.
  shutdown(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    // Send shutdown notification to all clients
    this.broadcast({
      type: 'server-shutdown',
      message: 'Server is shutting down',
    });

    // Close connections
    for (const [_, client] of this.clients) {
      client.ws.close();
    }

    this.clients.clear();
    this.rooms.clear();
  }
}

// WebSocket manager instance
const wsManager = new WebSocketManager();

// WebSocket handler type
type WebSocketHandler<T = unknown> = (
  ws: WebSocketInstance,
  clientId: string,
  data: T,
) => void | Promise<void>;

// WebSocket event handlers
const webSocketHandlers = {
  // Subscribe to task updates
  subscribeTask: async (ws: WebSocketInstance, clientId: string, data: { taskId: string }) => {
    wsManager.joinRoom(clientId, `task:${data.taskId}`);

    // Send current task data
    const task = await prisma.task.findUnique({
      where: { id: parseInt(data.taskId) },
      include: {
        project: true,
        taskLabels: { include: { label: true } },
        _count: { select: { comments: true, timeEntries: true } },
      },
    });

    if (task) {
      wsManager.sendToClient(clientId, {
        type: 'task-data',
        data: task,
      });
    }
  },

  // Subscribe to category updates
  subscribeCategory: (ws: WebSocketInstance, clientId: string, data: { categoryId: string }) => {
    wsManager.joinRoom(clientId, `category:${data.categoryId}`);
  },

  // Subscribe to statistics
  subscribeStatistics: (ws: WebSocketInstance, clientId: string) => {
    wsManager.joinRoom(clientId, 'statistics');
  },

  // Real-time collaboration
  joinCollaboration: (ws: WebSocketInstance, clientId: string, data: { sessionId: string }) => {
    wsManager.joinRoom(clientId, `collab:${data.sessionId}`);

    // Notify other clients about join
    wsManager.sendToRoom(`collab:${data.sessionId}`, {
      type: 'user-joined',
      clientId,
      timestamp: new Date().toISOString(),
    });
  },

  // Share cursor position
  updateCursor: (
    ws: WebSocketInstance,
    clientId: string,
    data: { sessionId: string; position: { x: number; y: number } },
  ) => {
    wsManager.sendToRoom(`collab:${data.sessionId}`, {
      type: 'cursor-update',
      clientId,
      position: data.position,
      timestamp: new Date().toISOString(),
    });
  },

  // Share typing status
  setTypingStatus: (
    ws: WebSocketInstance,
    clientId: string,
    data: { sessionId: string; isTyping: boolean },
  ) => {
    wsManager.sendToRoom(`collab:${data.sessionId}`, {
      type: 'typing-status',
      clientId,
      isTyping: data.isTyping,
      timestamp: new Date().toISOString(),
    });
  },

  // Pong response (health check)
  pong: (ws: WebSocketInstance, clientId: string) => {
    const client = wsManager.getClient(clientId);
    if (client) {
      client.lastActivity = Date.now();
    }
  },
};

// Data change notifications
export const notifyDataChange = {
  // When a task is updated
  taskUpdated: async (taskId: number, changeType: 'created' | 'updated' | 'deleted') => {
    const roomName = `task:${taskId}`;

    if (changeType === 'deleted') {
      wsManager.sendToRoom(roomName, {
        type: 'task-deleted',
        taskId,
        timestamp: new Date().toISOString(),
      });
    } else {
      const task = await prisma.task.findUnique({
        where: { id: taskId },
        include: {
          project: true,
          theme: { include: { category: true } },
          taskLabels: { include: { label: true } },
          _count: { select: { comments: true, timeEntries: true } },
        },
      });

      if (task) {
        wsManager.sendToRoom(roomName, {
          type: 'task-updated',
          data: task,
          changeType,
          timestamp: new Date().toISOString(),
        });

        // Also notify category room (only if theme has categoryId)
        if (task.theme?.categoryId) {
          wsManager.sendToRoom(`category:${task.theme.categoryId}`, {
            type: 'category-task-updated',
            taskId,
            changeType,
            timestamp: new Date().toISOString(),
          });
        }
      }
    }

    // Invalidate cache
    await cacheService.clear(`task:${taskId}`);
    await cacheService.clear('tasks:');

    // Notify statistics update
    wsManager.sendToRoom('statistics', {
      type: 'statistics-invalidated',
      reason: 'task-change',
      timestamp: new Date().toISOString(),
    });
  },

  // When a category is updated
  categoryUpdated: async (categoryId: number) => {
    const category = await prisma.category.findUnique({
      where: { id: categoryId },
    });

    if (category) {
      wsManager.sendToRoom(`category:${categoryId}`, {
        type: 'category-updated',
        data: category,
        timestamp: new Date().toISOString(),
      });
    }

    // Invalidate cache
    await cacheService.clear('categories:');
  },

  // Batch update notification
  batchUpdated: (updates: Array<{ type: string; id: string | number; data?: unknown }>) => {
    wsManager.broadcast({
      type: 'batch-update',
      updates,
      timestamp: new Date().toISOString(),
    });
  },
};

// WebSocket routes
export const websocketRoutes = new Elysia()
  .ws('/ws', {
    async message(ws, message) {
      const clientId = (ws as unknown as { id?: string }).id || `client-${Date.now()}`;

      try {
        const data = JSON.parse(String(message));
        const handler = webSocketHandlers[data.type as keyof typeof webSocketHandlers];

        if (handler) {
          await handler(ws as unknown as WebSocketInstance, clientId, data.data || {});
        } else {
          ws.send(
            JSON.stringify({
              type: 'error',
              message: `Unknown message type: ${data.type}`,
            }),
          );
        }
      } catch (error) {
        ws.send(
          JSON.stringify({
            type: 'error',
            message: error instanceof Error ? error.message : 'Invalid message format',
          }),
        );
      }
    },

    open(ws) {
      const wsWithId = ws as unknown as WebSocketInstance & { id?: string };
      const clientId = wsWithId.id || `client-${Date.now()}`;
      wsManager.addClient(
        clientId,
        ws as unknown as WebSocketInstance,
        wsWithId.data as { userId?: string; sessionId?: string } | undefined,
      );

      ws.send(
        JSON.stringify({
          type: 'connected',
          clientId,
          timestamp: new Date().toISOString(),
        }),
      );
    },

    close(ws) {
      const clientId = (ws as unknown as { id?: string }).id;
      if (clientId) {
        wsManager.removeClient(clientId);
      }
    },
  })
  .get('/ws/stats', () => {
    return wsManager.getStats();
  });

// Export
export { wsManager };
