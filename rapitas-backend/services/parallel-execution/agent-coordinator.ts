/**
 * エージェント間連携コーディネーター
 * サブエージェント間でタスクの進捗や結果を共有し、相互連携する
 */

import { EventEmitter } from 'events';
import type {
  AgentMessage,
  AgentMessageType,
  SubAgentState,
  ParallelExecutionStatus,
} from './types';

/**
 * リソースロック情報
 */
type ResourceLock = {
  resource: string;
  agentId: string;
  taskId: number;
  lockedAt: Date;
  expiresAt?: Date;
};

/**
 * 連携リクエスト
 */
type CoordinationRequest = {
  id: string;
  fromAgentId: string;
  type: 'resource_lock' | 'dependency_wait' | 'data_share' | 'sync_point';
  resource?: string;
  data?: unknown;
  status: 'pending' | 'granted' | 'denied' | 'timeout';
  createdAt: Date;
  resolvedAt?: Date;
};

/**
 * 依存関係解決状態
 */
type DependencyState = {
  taskId: number;
  dependsOn: number[];
  resolvedDependencies: number[];
  isResolved: boolean;
};

/**
 * エージェントコーディネーター
 */
export class AgentCoordinator extends EventEmitter {
  private resourceLocks: Map<string, ResourceLock> = new Map();
  private coordinationRequests: Map<string, CoordinationRequest> = new Map();
  private dependencyStates: Map<number, DependencyState> = new Map();
  private sharedData: Map<string, unknown> = new Map();
  private agentStates: Map<string, SubAgentState> = new Map();

  // メッセージ履歴（デバッグ用）
  private messageHistory: AgentMessage[] = [];
  private maxHistorySize: number = 1000;

  constructor() {
    super();
  }

  /**
   * リソースロックを要求
   */
  requestResourceLock(
    agentId: string,
    taskId: number,
    resource: string,
    timeout?: number,
  ): CoordinationRequest {
    const requestId = `lock-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // 既存のロックをチェック
    const existingLock = this.resourceLocks.get(resource);
    if (existingLock) {
      // 同じエージェントの場合は許可
      if (existingLock.agentId === agentId) {
        return {
          id: requestId,
          fromAgentId: agentId,
          type: 'resource_lock',
          resource,
          status: 'granted',
          createdAt: new Date(),
          resolvedAt: new Date(),
        };
      }

      // 期限切れかチェック
      if (existingLock.expiresAt && existingLock.expiresAt < new Date()) {
        this.resourceLocks.delete(resource);
      } else {
        // 既にロックされている
        const request: CoordinationRequest = {
          id: requestId,
          fromAgentId: agentId,
          type: 'resource_lock',
          resource,
          status: 'denied',
          createdAt: new Date(),
          resolvedAt: new Date(),
        };
        this.coordinationRequests.set(requestId, request);

        this.emit('lock_denied', {
          requestId,
          agentId,
          resource,
          lockedBy: existingLock.agentId,
        });

        return request;
      }
    }

    // ロックを取得
    const lock: ResourceLock = {
      resource,
      agentId,
      taskId,
      lockedAt: new Date(),
      expiresAt: timeout ? new Date(Date.now() + timeout) : undefined,
    };
    this.resourceLocks.set(resource, lock);

    const request: CoordinationRequest = {
      id: requestId,
      fromAgentId: agentId,
      type: 'resource_lock',
      resource,
      status: 'granted',
      createdAt: new Date(),
      resolvedAt: new Date(),
    };
    this.coordinationRequests.set(requestId, request);

    this.emit('lock_granted', {
      requestId,
      agentId,
      resource,
    });

    // メッセージをブロードキャスト
    this.broadcastMessage({
      id: `msg-${Date.now()}`,
      timestamp: new Date(),
      fromAgentId: agentId,
      toAgentId: 'broadcast',
      type: 'resource_locked',
      payload: { resource, taskId },
    });

    return request;
  }

  /**
   * リソースロックを解放
   */
  releaseResourceLock(agentId: string, resource: string): boolean {
    const lock = this.resourceLocks.get(resource);
    if (!lock) return false;

    // ロックを所有しているエージェントのみが解放できる
    if (lock.agentId !== agentId) {
      return false;
    }

    this.resourceLocks.delete(resource);

    this.emit('lock_released', {
      agentId,
      resource,
    });

    // メッセージをブロードキャスト
    this.broadcastMessage({
      id: `msg-${Date.now()}`,
      timestamp: new Date(),
      fromAgentId: agentId,
      toAgentId: 'broadcast',
      type: 'resource_released',
      payload: { resource },
    });

    return true;
  }

  /**
   * 依存関係を登録
   */
  registerDependency(taskId: number, dependsOn: number[]): void {
    this.dependencyStates.set(taskId, {
      taskId,
      dependsOn,
      resolvedDependencies: [],
      isResolved: dependsOn.length === 0,
    });

    if (dependsOn.length === 0) {
      this.emit('dependency_resolved', { taskId });
    }
  }

  /**
   * 依存関係を解決
   */
  resolveDependency(completedTaskId: number): number[] {
    const resolvedTasks: number[] = [];

    for (const [taskId, state] of this.dependencyStates) {
      if (
        state.dependsOn.includes(completedTaskId) &&
        !state.resolvedDependencies.includes(completedTaskId)
      ) {
        state.resolvedDependencies.push(completedTaskId);

        // すべての依存が解決されたかチェック
        if (state.resolvedDependencies.length === state.dependsOn.length) {
          state.isResolved = true;
          resolvedTasks.push(taskId);

          this.emit('dependency_resolved', { taskId });

          // メッセージをブロードキャスト
          this.broadcastMessage({
            id: `msg-${Date.now()}`,
            timestamp: new Date(),
            fromAgentId: 'coordinator',
            toAgentId: 'broadcast',
            type: 'dependency_resolved',
            payload: { taskId, resolvedBy: completedTaskId },
          });
        }
      }
    }

    return resolvedTasks;
  }

  /**
   * 依存関係が解決されているかチェック
   */
  isDependencyResolved(taskId: number): boolean {
    const state = this.dependencyStates.get(taskId);
    return state?.isResolved ?? true;
  }

  /**
   * データを共有
   */
  shareData(key: string, data: unknown, fromAgentId: string): void {
    this.sharedData.set(key, data);

    this.emit('data_shared', {
      key,
      fromAgentId,
    });

    // メッセージをブロードキャスト
    this.broadcastMessage({
      id: `msg-${Date.now()}`,
      timestamp: new Date(),
      fromAgentId,
      toAgentId: 'broadcast',
      type: 'coordination_response',
      payload: { type: 'data_share', key, data },
    });
  }

  /**
   * 共有データを取得
   */
  getSharedData(key: string): unknown | undefined {
    return this.sharedData.get(key);
  }

  /**
   * エージェントの状態を更新
   */
  updateAgentState(agentId: string, state: SubAgentState): void {
    this.agentStates.set(agentId, state);

    this.emit('agent_state_updated', {
      agentId,
      status: state.status,
    });
  }

  /**
   * エージェントの状態を取得
   */
  getAgentState(agentId: string): SubAgentState | undefined {
    return this.agentStates.get(agentId);
  }

  /**
   * すべてのエージェントの状態を取得
   */
  getAllAgentStates(): Map<string, SubAgentState> {
    return new Map(this.agentStates);
  }

  /**
   * メッセージをブロードキャスト
   */
  broadcastMessage(message: AgentMessage): void {
    // メッセージ履歴に追加
    this.messageHistory.push(message);
    if (this.messageHistory.length > this.maxHistorySize) {
      this.messageHistory.shift();
    }

    this.emit('message', message);
  }

  /**
   * 特定のエージェントにメッセージを送信
   */
  sendMessage(
    toAgentId: string,
    fromAgentId: string,
    type: AgentMessageType,
    payload: unknown,
  ): void {
    const message: AgentMessage = {
      id: `msg-${Date.now()}`,
      timestamp: new Date(),
      fromAgentId,
      toAgentId,
      type,
      payload,
    };

    this.messageHistory.push(message);
    if (this.messageHistory.length > this.maxHistorySize) {
      this.messageHistory.shift();
    }

    this.emit('message', message);
    this.emit(`message:${toAgentId}`, message);
  }

  /**
   * 同期ポイントを作成
   */
  async waitForSyncPoint(
    syncPointId: string,
    agentIds: string[],
    timeout: number = 30000,
  ): Promise<boolean> {
    const syncState = new Map<string, boolean>();

    for (const agentId of agentIds) {
      syncState.set(agentId, false);
    }

    return new Promise((resolve) => {
      const checkSync = () => {
        const allSynced = Array.from(syncState.values()).every((v) => v);
        if (allSynced) {
          this.emit('sync_completed', { syncPointId, agentIds });
          resolve(true);
          return true;
        }
        return false;
      };

      const handler = (message: AgentMessage) => {
        if (
          message.type === 'coordination_response' &&
          (message.payload as { syncPointId?: string })?.syncPointId === syncPointId
        ) {
          syncState.set(message.fromAgentId, true);
          checkSync();
        }
      };

      this.on('message', handler);

      // タイムアウト
      setTimeout(() => {
        this.off('message', handler);
        if (!checkSync()) {
          this.emit('sync_timeout', { syncPointId, agentIds });
          resolve(false);
        }
      }, timeout);
    });
  }

  /**
   * 同期ポイントに到達
   */
  reachSyncPoint(syncPointId: string, agentId: string): void {
    this.broadcastMessage({
      id: `msg-${Date.now()}`,
      timestamp: new Date(),
      fromAgentId: agentId,
      toAgentId: 'broadcast',
      type: 'coordination_response',
      payload: { syncPointId },
    });
  }

  /**
   * メッセージ履歴を取得
   */
  getMessageHistory(filter?: {
    fromAgentId?: string;
    toAgentId?: string;
    type?: AgentMessageType;
    limit?: number;
  }): AgentMessage[] {
    let messages = [...this.messageHistory];

    if (filter?.fromAgentId) {
      messages = messages.filter((m) => m.fromAgentId === filter.fromAgentId);
    }
    if (filter?.toAgentId) {
      messages = messages.filter(
        (m) => m.toAgentId === filter.toAgentId || m.toAgentId === 'broadcast',
      );
    }
    if (filter?.type) {
      messages = messages.filter((m) => m.type === filter.type);
    }

    // 最新順にソート
    messages.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    if (filter?.limit) {
      messages = messages.slice(0, filter.limit);
    }

    return messages;
  }

  /**
   * 実行統計を取得
   */
  getStatistics(): {
    activeAgents: number;
    lockedResources: number;
    pendingRequests: number;
    resolvedDependencies: number;
    messageCount: number;
  } {
    return {
      activeAgents: Array.from(this.agentStates.values()).filter((s) => s.status === 'running')
        .length,
      lockedResources: this.resourceLocks.size,
      pendingRequests: Array.from(this.coordinationRequests.values()).filter(
        (r) => r.status === 'pending',
      ).length,
      resolvedDependencies: Array.from(this.dependencyStates.values()).filter((s) => s.isResolved)
        .length,
      messageCount: this.messageHistory.length,
    };
  }

  /**
   * リセット
   */
  reset(): void {
    this.resourceLocks.clear();
    this.coordinationRequests.clear();
    this.dependencyStates.clear();
    this.sharedData.clear();
    this.agentStates.clear();
    this.messageHistory = [];
  }
}

/**
 * エージェントコーディネーターのファクトリー関数
 */
export function createAgentCoordinator(): AgentCoordinator {
  return new AgentCoordinator();
}
