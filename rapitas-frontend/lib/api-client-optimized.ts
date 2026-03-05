import { io, Socket } from 'socket.io-client';
import React from 'react';

/**
 * 最適化されたAPIクライアント
 * - バッチリクエスト
 * - WebSocketリアルタイム更新
 * - 自動リトライ
 * - キャッシング
 */
class OptimizedAPIClient {
  private baseURL: string;
  private socket: Socket | null = null;
  private batchQueue: Map<
    string,
    {
      request: BatchRequest;
      resolve: (value: unknown) => void;
      reject: (reason: unknown) => void;
    }
  > = new Map();
  private batchTimeout: NodeJS.Timeout | null = null;
  private batchSize = 10;
  private batchDelay = 10; // ms

  // ローカルキャッシュ
  private cache = new Map<
    string,
    {
      data: unknown;
      timestamp: number;
      ttl: number;
    }
  >();

  constructor(baseURL: string = 'http://localhost:3001') {
    this.baseURL = baseURL;
  }

  // WebSocket接続の初期化
  connectWebSocket(): void {
    if (this.socket?.connected) return;

    this.socket = io(this.baseURL, {
      transports: ['websocket'],
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 5,
    });

    this.socket.on('connect', () => {
      console.log('WebSocket connected');
    });

    this.socket.on('disconnect', () => {
      console.log('WebSocket disconnected');
    });

    // リアルタイムイベントハンドラー
    this.socket.on('task-updated', (data: { data: { id: number } }) => {
      this.invalidateCache(`task:${data.data.id}`);
      this.emit('task-updated', data);
    });

    this.socket.on('task-deleted', (data: { taskId: number }) => {
      this.invalidateCache(`task:${data.taskId}`);
      this.emit('task-deleted', data);
    });

    this.socket.on(
      'batch-update',
      (data: { updates: Array<{ type: string; id: number }> }) => {
        data.updates.forEach((update: { type: string; id: number }) => {
          this.invalidateCache(`${update.type}:${update.id}`);
        });
        this.emit('batch-update', data);
      },
    );

    // Pingレスポンス
    this.socket.on('ping', () => {
      this.socket?.emit('pong');
    });
  }

  // WebSocket切断
  disconnectWebSocket(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  // リアルタイム購読
  subscribe(type: string, id?: string): void {
    if (!this.socket?.connected) {
      this.connectWebSocket();
    }

    switch (type) {
      case 'task':
        if (id) {
          this.socket?.emit('message', {
            type: 'subscribeTask',
            data: { taskId: id },
          });
        }
        break;
      case 'category':
        if (id) {
          this.socket?.emit('message', {
            type: 'subscribeCategory',
            data: { categoryId: id },
          });
        }
        break;
      case 'statistics':
        this.socket?.emit('message', {
          type: 'subscribeStatistics',
        });
        break;
    }
  }

  // リアルタイムコラボレーション
  joinCollaboration(sessionId: string): void {
    if (!this.socket?.connected) {
      this.connectWebSocket();
    }

    this.socket?.emit('message', {
      type: 'joinCollaboration',
      data: { sessionId },
    });
  }

  // カーソル位置の共有
  updateCursor(
    sessionId: string,
    position: { line: number; column: number },
  ): void {
    this.socket?.emit('message', {
      type: 'updateCursor',
      data: { sessionId, position },
    });
  }

  // タイピング状態の共有
  setTypingStatus(sessionId: string, isTyping: boolean): void {
    this.socket?.emit('message', {
      type: 'setTypingStatus',
      data: { sessionId, isTyping },
    });
  }

  // バッチリクエストの追加
  private addToBatch<T>(request: BatchRequest): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = `${Date.now()}-${Math.random()}`;
      this.batchQueue.set(id, {
        request: { ...request, id },
        resolve: resolve as (value: unknown) => void,
        reject,
      });

      // バッチタイマーの設定
      if (!this.batchTimeout) {
        this.batchTimeout = setTimeout(
          () => this.flushBatch(),
          this.batchDelay,
        );
      }

      // バッチサイズに達したら即座に送信
      if (this.batchQueue.size >= this.batchSize) {
        this.flushBatch();
      }
    });
  }

  // バッチリクエストの送信
  private async flushBatch(): Promise<void> {
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
      this.batchTimeout = null;
    }

    if (this.batchQueue.size === 0) return;

    const requests = Array.from(this.batchQueue.values()).map(
      (item) => item.request,
    );
    const currentBatch = new Map(this.batchQueue);
    this.batchQueue.clear();

    try {
      const response = await fetch(`${this.baseURL}/batch/v2`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests }),
      });

      if (!response.ok) {
        throw new Error(`Batch request failed: ${response.statusText}`);
      }

      const { results } = await response.json();

      // 結果を各リクエストに配信
      results.forEach(
        (result: {
          id: string;
          status: number;
          body?: unknown;
          error?: string;
        }) => {
          const item = currentBatch.get(result.id);
          if (item) {
            if (result.status === 200) {
              item.resolve(result.body);
            } else {
              item.reject(new Error(result.error || 'Request failed'));
            }
          }
        },
      );
    } catch (error) {
      // エラー時はすべてのリクエストを拒否
      currentBatch.forEach((item) => {
        item.reject(error);
      });
    }
  }

  // キャッシュの取得
  private getFromCache<T = unknown>(key: string): T | null {
    const cached = this.cache.get(key);
    if (!cached) return null;

    const now = Date.now();
    if (now - cached.timestamp > cached.ttl) {
      this.cache.delete(key);
      return null;
    }

    return cached.data as T;
  }

  // キャッシュの設定
  private setCache(key: string, data: unknown, ttl: number = 300000): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl,
    });
  }

  // キャッシュの無効化
  private invalidateCache(pattern?: string): void {
    if (!pattern) {
      this.cache.clear();
      return;
    }

    for (const key of this.cache.keys()) {
      if (key.includes(pattern)) {
        this.cache.delete(key);
      }
    }
  }

  // API メソッド

  // タスクの取得（バッチ対応）
  async getTask(id: string): Promise<Task> {
    const cacheKey = `task:${id}`;
    const cached = this.getFromCache<Task>(cacheKey);
    if (cached) return cached;

    const result = await this.addToBatch<Task>({
      method: 'GET',
      url: `/tasks/${id}`,
    });

    this.setCache(cacheKey, result);
    return result;
  }

  // タスクリストの取得（バッチ対応）
  async getTasks(params?: {
    categoryId?: number;
    status?: string;
    since?: string;
    cursor?: string;
    limit?: number;
  }): Promise<TaskListResponse> {
    const queryString = params
      ? new URLSearchParams(params as Record<string, string>).toString()
      : '';
    const cacheKey = `tasks:${queryString}`;
    const cached = this.getFromCache<TaskListResponse>(cacheKey);
    if (cached) return cached;

    const result = await this.addToBatch<TaskListResponse>({
      method: 'GET',
      url: `/tasks${queryString ? `?${queryString}` : ''}`,
    });

    this.setCache(cacheKey, result, params?.since ? 60000 : 300000);
    return result;
  }

  // タスクの作成（直接送信）
  async createTask(data: CreateTaskData): Promise<Task> {
    const response = await fetch(`${this.baseURL}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw new Error(`Failed to create task: ${response.statusText}`);
    }

    const task = await response.json();
    this.invalidateCache('tasks:');
    return task;
  }

  // タスクの更新（直接送信）
  async updateTask(id: string, data: UpdateTaskData): Promise<Task> {
    const response = await fetch(`${this.baseURL}/tasks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw new Error(`Failed to update task: ${response.statusText}`);
    }

    const task = await response.json();
    this.invalidateCache(`task:${id}`);
    this.invalidateCache('tasks:');
    return task;
  }

  // 統計情報の取得（バッチ対応）
  async getStatistics(): Promise<Statistics> {
    const cacheKey = 'statistics:tasks';
    const cached = this.getFromCache<Statistics>(cacheKey);
    if (cached) return cached;

    const result = await this.addToBatch<Statistics>({
      method: 'GET',
      url: '/statistics/tasks',
    });

    this.setCache(cacheKey, result, 600000); // 10分
    return result;
  }

  // 複数のタスクを並行取得
  async getTasksBatch(ids: string[]): Promise<Map<string, Task>> {
    const results = new Map<string, Task>();
    const uncachedIds: string[] = [];

    // キャッシュチェック
    for (const id of ids) {
      const cached = this.getFromCache<Task>(`task:${id}`);
      if (cached) {
        results.set(id, cached);
      } else {
        uncachedIds.push(id);
      }
    }

    // キャッシュにないものをバッチ取得
    if (uncachedIds.length > 0) {
      const promises = uncachedIds.map((id) => this.getTask(id));
      const tasks = await Promise.all(promises);

      tasks.forEach((task, index) => {
        results.set(uncachedIds[index], task);
      });
    }

    return results;
  }

  // イベントエミッター機能
  private eventHandlers = new Map<string, Set<Function>>();

  on(event: string, handler: Function): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);
  }

  off(event: string, handler: Function): void {
    this.eventHandlers.get(event)?.delete(handler);
  }

  private emit(event: string, data: unknown): void {
    this.eventHandlers.get(event)?.forEach((handler) => {
      handler(data);
    });
  }

  // クリーンアップ
  destroy(): void {
    this.disconnectWebSocket();
    this.cache.clear();
    this.eventHandlers.clear();
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
    }
  }
}

// 型定義
interface BatchRequest {
  id?: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  body?: unknown;
}

interface Task {
  id: number;
  title: string;
  description?: string;
  status: string;
  priority: string;
  categoryId: number;
  projectId?: number;
  dueDate?: string;
  createdAt: string;
  updatedAt: string;
  // その他のフィールド
}

interface TaskListResponse {
  data: Task[];
  nextCursor?: string;
  hasNextPage: boolean;
  cached?: boolean;
}

interface CreateTaskData {
  title: string;
  description?: string;
  categoryId: number;
  projectId?: number;
  priority?: string;
  dueDate?: string;
}

interface UpdateTaskData {
  title?: string;
  description?: string;
  status?: string;
  priority?: string;
  dueDate?: string;
}

interface Statistics {
  total: number;
  byStatus: Record<string, number>;
  byPriority: Record<string, number>;
  overdue: number;
  upcoming: Task[];
}

// シングルトンインスタンス
export const apiClient = new OptimizedAPIClient();

// React Hook の例
export function useOptimizedAPI() {
  const [connected, setConnected] = React.useState(false);

  React.useEffect(() => {
    apiClient.connectWebSocket();

    apiClient.on('connect', () => setConnected(true));
    apiClient.on('disconnect', () => setConnected(false));

    return () => {
      apiClient.destroy();
    };
  }, []);

  return { apiClient, connected };
}
