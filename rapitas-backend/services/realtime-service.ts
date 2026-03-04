/**
 * リアルタイム通信サービス
 * SSE (Server-Sent Events) でエージェント実行状況やGitHubイベントをストリーミング
 */

import { createLogger } from '../config/logger';

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
  | "agent_execution"
  | "github_events"
  | "notifications"
  | "task_updates"
  | `execution:${number}`
  | `session:${number}`
  | `task:${number}`;

/**
 * リアルタイムサービスクラス
 */
export class RealtimeService {
  private static instance: RealtimeService;
  private clients: Map<string, SSEClient> = new Map();
  private eventHistory: Map<string, SSEEvent[]> = new Map();
  private maxHistorySize: number = 100;
  private pingInterval: NodeJS.Timeout | null = null;
  private nextClientId: number = 1;
  /** SSE接続のReadableStreamController管理用マップ（明示的にcloseするため） */
  private streamControllers: Map<
    string,
    ReadableStreamDefaultController<Uint8Array>
  > = new Map();

  private constructor() {
    // 定期的なping送信を開始（30秒ごと）
    this.startPingInterval();
  }

  static getInstance(): RealtimeService {
    if (!RealtimeService.instance) {
      RealtimeService.instance = new RealtimeService();
    }
    return RealtimeService.instance;
  }

  /**
   * 新しいSSEクライアントを登録
   */
  registerClient(
    response: SSEClient["response"],
    subscriptions: string[] = [],
  ): string {
    const clientId = `client-${this.nextClientId++}`;
    const client: SSEClient = {
      id: clientId,
      response,
      subscriptions: new Set(subscriptions),
      connectedAt: new Date(),
      lastPingAt: new Date(),
    };

    this.clients.set(clientId, client);

    // 接続成功メッセージを送信
    this.sendToClient(clientId, {
      type: "connected",
      data: { clientId, subscriptions },
      timestamp: new Date(),
    });

    return clientId;
  }

  /**
   * クライアントを削除
   */
  removeClient(clientId: string): void {
    this.clients.delete(clientId);
    // ストリームコントローラーも削除（すでにcloseされている場合もある）
    this.streamControllers.delete(clientId);
  }

  /**
   * SSE接続のStreamControllerを登録
   * シャットダウン時に明示的にcloseするために使用
   */
  registerStreamController(
    clientId: string,
    controller: ReadableStreamDefaultController<Uint8Array>,
  ): void {
    this.streamControllers.set(clientId, controller);
  }

  /**
   * SSE接続のStreamControllerを削除
   */
  removeStreamController(clientId: string): void {
    this.streamControllers.delete(clientId);
  }

  /**
   * クライアントの購読を更新
   */
  updateSubscriptions(clientId: string, subscriptions: string[]): void {
    const client = this.clients.get(clientId);
    if (client) {
      client.subscriptions = new Set(subscriptions);
    }
  }

  /**
   * 購読を追加
   */
  addSubscription(clientId: string, channel: string): void {
    const client = this.clients.get(clientId);
    if (client) {
      client.subscriptions.add(channel);
    }
  }

  /**
   * 購読を削除
   */
  removeSubscription(clientId: string, channel: string): void {
    const client = this.clients.get(clientId);
    if (client) {
      client.subscriptions.delete(channel);
    }
  }

  /**
   * 特定のクライアントにイベントを送信
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
   * SSEイベントをフォーマット
   */
  private formatSSEEvent(event: SSEEvent): string {
    let result = "";
    if (event.id) {
      result += `id: ${event.id}\n`;
    }
    result += `event: ${event.type}\n`;
    result += `data: ${JSON.stringify(event.data)}\n\n`;
    return result;
  }

  /**
   * チャンネルにイベントを送信
   */
  broadcast(
    channel: EventChannel | string,
    eventType: string,
    data: unknown,
  ): void {
    const event: SSEEvent = {
      type: eventType,
      data,
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      timestamp: new Date(),
    };

    // 履歴に追加
    this.addToHistory(channel, event);

    // 購読しているクライアントに送信
    for (const client of this.clients.values()) {
      if (client.subscriptions.has(channel) || client.subscriptions.has("*")) {
        this.sendToClient(client.id, event);
      }
    }
  }

  /**
   * 全クライアントにイベントを送信
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
   * エージェント実行出力を送信
   */
  sendExecutionOutput(
    executionId: number,
    output: string,
    isError: boolean = false,
  ): void {
    this.broadcast(`execution:${executionId}`, "execution_output", {
      executionId,
      output,
      isError,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * エージェント実行ステータス更新を送信
   */
  sendExecutionStatusUpdate(
    executionId: number,
    status: string,
    details?: Record<string, unknown>,
  ): void {
    this.broadcast(`execution:${executionId}`, "execution_status", {
      executionId,
      status,
      ...details,
      timestamp: new Date().toISOString(),
    });

    // agent_executionチャンネルにも送信
    this.broadcast("agent_execution", "execution_status", {
      executionId,
      status,
      ...details,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * GitHub イベントを送信
   */
  sendGitHubEvent(eventType: string, data: unknown): void {
    this.broadcast("github_events", eventType, data);
  }

  /**
   * 通知を送信
   */
  sendNotification(notification: {
    id: number;
    type: string;
    title: string;
    message: string;
    link?: string;
  }): void {
    this.broadcast("notifications", "new_notification", notification);
  }

  /**
   * タスク更新を送信
   */
  sendTaskUpdate(taskId: number, updateType: string, data: unknown): void {
    this.broadcast(`task:${taskId}`, updateType, {
      taskId,
      ...(data as object),
    });
    this.broadcast("task_updates", updateType, { taskId, ...(data as object) });
  }

  /**
   * 履歴に追加
   */
  private addToHistory(channel: string, event: SSEEvent): void {
    if (!this.eventHistory.has(channel)) {
      this.eventHistory.set(channel, []);
    }
    const history = this.eventHistory.get(channel)!;
    history.push(event);

    // 最大サイズを超えたら古いものを削除
    while (history.length > this.maxHistorySize) {
      history.shift();
    }
  }

  /**
   * チャンネルの履歴を取得
   */
  getChannelHistory(channel: string, since?: Date): SSEEvent[] {
    const history = this.eventHistory.get(channel) || [];
    if (since) {
      return history.filter((event) => event.timestamp > since);
    }
    return [...history];
  }

  /**
   * pingインターバルを開始
   */
  private startPingInterval(): void {
    this.pingInterval = setInterval(() => {
      const now = new Date();
      for (const client of this.clients.values()) {
        this.sendToClient(client.id, {
          type: "ping",
          data: { timestamp: now.toISOString() },
          timestamp: now,
        });
        client.lastPingAt = now;
      }
    }, 30000);
  }

  /**
   * サービスを停止
   * 全てのSSE接続を明示的にクローズしてソケットを解放する
   */
  shutdown(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    // 全クライアントに切断通知を送信
    this.broadcastAll("shutdown", { reason: "Server shutting down" });

    // 全てのSSEストリームを明示的にclose（CLOSE_WAIT蓄積を防止）
    const controllerCount = this.streamControllers.size;
    for (const [clientId, controller] of this.streamControllers) {
      try {
        controller.close();
        log.info(`[SSE] Closed stream for client ${clientId}`);
      } catch (error) {
        // 既にcloseされている場合は無視
      }
    }
    if (controllerCount > 0) {
      log.info(
        `[SSE] Closed ${controllerCount} SSE stream(s) during shutdown`,
      );
    }

    this.streamControllers.clear();
    this.clients.clear();
  }

  /**
   * 接続中のクライアント数を取得
   */
  getClientCount(): number {
    return this.clients.size;
  }

  /**
   * クライアント情報を取得
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

// シングルトンインスタンスをエクスポート
export const realtimeService = RealtimeService.getInstance();
