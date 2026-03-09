import { Elysia, t } from 'elysia';
import { prisma } from '../config';
import { cacheService } from './cache-service';
import { createLogger } from '../config/logger';

const log = createLogger('websocket-service');

// WebSocketインスタンスの型
interface WebSocketInstance {
  send: (data: string) => void;
  close: () => void;
  readyState: number;
  data?: Record<string, unknown>;
}

// WebSocketクライアントの管理
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

// WebSocketルームの管理
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
    // 定期的なヘルスチェック
    this.heartbeatInterval = setInterval(() => {
      this.checkClientHealth();
    }, 30000); // 30秒ごと
  }

  // クライアントの追加
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

  // クライアントの削除
  removeClient(id: string): void {
    const client = this.clients.get(id);
    if (client) {
      // すべての購読を解除
      for (const room of client.subscriptions) {
        this.leaveRoom(id, room);
      }
      this.clients.delete(id);
      log.info(`WebSocket client disconnected: ${id}`);
    }
  }

  // クライアントの取得
  getClient(id: string): WSClient | undefined {
    return this.clients.get(id);
  }

  // ルームに参加
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

  // ルームから退出
  leaveRoom(clientId: string, roomName: string): void {
    const room = this.rooms.get(roomName);
    if (room) {
      room.clients.delete(clientId);

      // 空になったルームは削除
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

  // メッセージをルームに送信
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

  // 特定のクライアントにメッセージを送信
  sendToClient(clientId: string, message: unknown): void {
    const client = this.clients.get(clientId);
    if (client?.ws.readyState === 1) {
      client.ws.send(JSON.stringify(message));
      client.lastActivity = Date.now();
    }
  }

  // すべてのクライアントにブロードキャスト
  broadcast(message: unknown): void {
    for (const [_, client] of this.clients) {
      if (client.ws.readyState === 1) {
        client.ws.send(JSON.stringify(message));
        client.lastActivity = Date.now();
      }
    }
  }

  // クライアントの健康チェック
  private checkClientHealth(): void {
    const now = Date.now();
    const timeout = 60000; // 60秒のタイムアウト

    for (const [id, client] of this.clients) {
      if (now - client.lastActivity > timeout) {
        log.info(`Client ${id} timed out, removing...`);
        this.removeClient(id);
      } else if (client.ws.readyState === 1) {
        // Ping送信
        client.ws.send(JSON.stringify({ type: 'ping', timestamp: now }));
      }
    }
  }

  // 統計情報の取得
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

  // クリーンアップ
  shutdown(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    // すべてのクライアントに終了通知
    this.broadcast({
      type: 'server-shutdown',
      message: 'Server is shutting down',
    });

    // 接続を閉じる
    for (const [_, client] of this.clients) {
      client.ws.close();
    }

    this.clients.clear();
    this.rooms.clear();
  }
}

// WebSocketマネージャーのインスタンス
const wsManager = new WebSocketManager();

// WebSocketハンドラーの型
type WebSocketHandler<T = unknown> = (
  ws: WebSocketInstance,
  clientId: string,
  data: T,
) => void | Promise<void>;

// WebSocketイベントハンドラー
const webSocketHandlers = {
  // タスクの更新を購読
  subscribeTask: async (ws: WebSocketInstance, clientId: string, data: { taskId: string }) => {
    wsManager.joinRoom(clientId, `task:${data.taskId}`);

    // 現在のタスクデータを送信
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

  // カテゴリの更新を購読
  subscribeCategory: (ws: WebSocketInstance, clientId: string, data: { categoryId: string }) => {
    wsManager.joinRoom(clientId, `category:${data.categoryId}`);
  },

  // 統計情報の購読
  subscribeStatistics: (ws: WebSocketInstance, clientId: string) => {
    wsManager.joinRoom(clientId, 'statistics');
  },

  // リアルタイムコラボレーション
  joinCollaboration: (ws: WebSocketInstance, clientId: string, data: { sessionId: string }) => {
    wsManager.joinRoom(clientId, `collab:${data.sessionId}`);

    // 他のクライアントに参加を通知
    wsManager.sendToRoom(`collab:${data.sessionId}`, {
      type: 'user-joined',
      clientId,
      timestamp: new Date().toISOString(),
    });
  },

  // カーソル位置の共有
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

  // タイピング状態の共有
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

  // Pong応答（ヘルスチェック）
  pong: (ws: WebSocketInstance, clientId: string) => {
    const client = wsManager.getClient(clientId);
    if (client) {
      client.lastActivity = Date.now();
    }
  },
};

// データ変更の通知
export const notifyDataChange = {
  // タスクが更新された場合
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

        // カテゴリルームにも通知（themeのcategoryIdがある場合のみ）
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

    // キャッシュを無効化
    await cacheService.clear(`task:${taskId}`);
    await cacheService.clear('tasks:');

    // 統計情報の更新を通知
    wsManager.sendToRoom('statistics', {
      type: 'statistics-invalidated',
      reason: 'task-change',
      timestamp: new Date().toISOString(),
    });
  },

  // カテゴリが更新された場合
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

    // キャッシュを無効化
    await cacheService.clear('categories:');
  },

  // バッチ更新通知
  batchUpdated: (updates: Array<{ type: string; id: string | number; data?: unknown }>) => {
    wsManager.broadcast({
      type: 'batch-update',
      updates,
      timestamp: new Date().toISOString(),
    });
  },
};

// WebSocketルート
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

// エクスポート
export { wsManager };
