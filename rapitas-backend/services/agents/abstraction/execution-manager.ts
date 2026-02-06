/**
 * AIエージェント抽象化レイヤー - 実行マネージャー
 * 複数エージェントの実行を管理・調整
 */

import type {
  AgentState,
  AgentExecutionContext,
  AgentTaskDefinition,
  AgentExecutionResult,
  AgentProviderConfig,
} from './types';
import type {
  IAgent,
  IAgentExecutionManager,
  IAgentLogger,
} from './interfaces';
import { AgentRegistry } from './registry';
import { generateExecutionId } from './index';

/**
 * 実行情報
 */
interface ExecutionInfo {
  executionId: string;
  agentId: string;
  agent: IAgent;
  state: AgentState;
  startTime: Date;
  task: AgentTaskDefinition;
  context: AgentExecutionContext;
}

/**
 * 実行マネージャーオプション
 */
interface ExecutionManagerOptions {
  maxConcurrentExecutions?: number;
  defaultTimeout?: number;
  logger?: IAgentLogger;
}

/**
 * エージェント実行マネージャー
 * 複数のエージェント実行を管理し、状態を追跡
 */
export class AgentExecutionManager implements IAgentExecutionManager {
  private executions: Map<string, ExecutionInfo> = new Map();
  private agentExecutions: Map<string, Set<string>> = new Map(); // agentId -> executionIds
  private maxConcurrentExecutions: number;
  private defaultTimeout: number;
  private logger?: IAgentLogger;

  constructor(options: ExecutionManagerOptions = {}) {
    this.maxConcurrentExecutions = options.maxConcurrentExecutions ?? 10;
    this.defaultTimeout = options.defaultTimeout ?? 900000; // 15分
    this.logger = options.logger;
  }

  /**
   * タスクを実行
   */
  async executeTask(
    agentId: string,
    task: AgentTaskDefinition,
    context: AgentExecutionContext,
  ): Promise<AgentExecutionResult> {
    // エージェントを取得
    const registry = AgentRegistry.getInstance();
    const agent = registry.getAgent(agentId);

    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    // 同時実行数のチェック
    const activeCount = this.getActiveExecutionCount();
    if (activeCount >= this.maxConcurrentExecutions) {
      throw new Error(
        `Maximum concurrent executions (${this.maxConcurrentExecutions}) reached`,
      );
    }

    // 実行IDを生成
    const executionId = context.executionId || generateExecutionId();
    const executionContext: AgentExecutionContext = {
      ...context,
      executionId,
      timeout: context.timeout ?? this.defaultTimeout,
    };

    // 実行情報を登録
    const executionInfo: ExecutionInfo = {
      executionId,
      agentId,
      agent,
      state: 'initializing',
      startTime: new Date(),
      task,
      context: executionContext,
    };

    this.executions.set(executionId, executionInfo);
    this.addAgentExecution(agentId, executionId);

    this.log('info', `Starting execution ${executionId} for agent ${agentId}`);

    try {
      // 状態変更イベントを購読
      const unsubscribe = agent.events.on('state_change', (event) => {
        if ('newState' in event) {
          executionInfo.state = event.newState;
        }
      });

      // タスクを実行
      const result = await agent.execute(task, executionContext);

      // 購読解除
      unsubscribe();

      // 実行情報を更新
      executionInfo.state = result.state;

      this.log('info', `Execution ${executionId} completed with state: ${result.state}`);

      // 完了した実行を一定時間後にクリーンアップ
      if (result.state === 'completed' || result.state === 'failed' || result.state === 'cancelled') {
        setTimeout(() => {
          this.cleanupExecution(executionId);
        }, 60000); // 1分後にクリーンアップ
      }

      return result;
    } catch (error) {
      executionInfo.state = 'failed';

      this.log('error', `Execution ${executionId} failed: ${error instanceof Error ? error.message : String(error)}`);

      // エラー時も一定時間後にクリーンアップ
      setTimeout(() => {
        this.cleanupExecution(executionId);
      }, 60000);

      throw error;
    }
  }

  /**
   * 実行を継続（質問への回答後）
   */
  async continueExecution(
    executionId: string,
    userResponse: string,
  ): Promise<AgentExecutionResult> {
    const executionInfo = this.executions.get(executionId);

    if (!executionInfo) {
      throw new Error(`Execution not found: ${executionId}`);
    }

    if (executionInfo.state !== 'waiting_for_input') {
      throw new Error(
        `Cannot continue execution: state is '${executionInfo.state}', expected 'waiting_for_input'`,
      );
    }

    this.log('info', `Continuing execution ${executionId} with user response`);

    try {
      // 継続コンテキストを作成
      const continuationContext = {
        sessionId: executionInfo.context.sessionId || executionId,
        previousExecutionId: executionId,
        userResponse,
      };

      // 新しい実行IDを生成
      const newExecutionId = generateExecutionId();
      const newContext: AgentExecutionContext = {
        ...executionInfo.context,
        executionId: newExecutionId,
        parentExecutionId: executionId,
      };

      // 継続実行
      const result = await executionInfo.agent.continue(continuationContext, newContext);

      // 実行情報を更新
      executionInfo.state = result.state;

      this.log('info', `Continuation ${executionId} completed with state: ${result.state}`);

      return result;
    } catch (error) {
      executionInfo.state = 'failed';

      this.log('error', `Continuation ${executionId} failed: ${error instanceof Error ? error.message : String(error)}`);

      throw error;
    }
  }

  /**
   * 実行を停止
   */
  async stopExecution(executionId: string): Promise<void> {
    const executionInfo = this.executions.get(executionId);

    if (!executionInfo) {
      throw new Error(`Execution not found: ${executionId}`);
    }

    this.log('info', `Stopping execution ${executionId}`);

    await executionInfo.agent.stop();
    executionInfo.state = 'cancelled';
  }

  /**
   * 実行状態を取得
   */
  getExecutionStatus(executionId: string): AgentState | null {
    const executionInfo = this.executions.get(executionId);
    return executionInfo?.state ?? null;
  }

  /**
   * アクティブな実行一覧を取得
   */
  getActiveExecutions(): Array<{
    executionId: string;
    agentId: string;
    state: AgentState;
    startTime: Date;
  }> {
    const activeStates: AgentState[] = ['initializing', 'running', 'waiting_for_input', 'paused'];

    return Array.from(this.executions.values())
      .filter((info) => activeStates.includes(info.state))
      .map((info) => ({
        executionId: info.executionId,
        agentId: info.agentId,
        state: info.state,
        startTime: info.startTime,
      }));
  }

  /**
   * 特定エージェントの実行一覧を取得
   */
  getExecutionsByAgent(agentId: string): Array<{
    executionId: string;
    state: AgentState;
    startTime: Date;
  }> {
    const executionIds = this.agentExecutions.get(agentId);

    if (!executionIds) {
      return [];
    }

    return Array.from(executionIds)
      .map((id) => this.executions.get(id))
      .filter((info): info is ExecutionInfo => info !== undefined)
      .map((info) => ({
        executionId: info.executionId,
        state: info.state,
        startTime: info.startTime,
      }));
  }

  /**
   * 実行詳細を取得
   */
  getExecutionDetails(executionId: string): ExecutionInfo | null {
    return this.executions.get(executionId) ?? null;
  }

  /**
   * アクティブな実行数を取得
   */
  getActiveExecutionCount(): number {
    const activeStates: AgentState[] = ['initializing', 'running', 'waiting_for_input', 'paused'];

    return Array.from(this.executions.values())
      .filter((info) => activeStates.includes(info.state))
      .length;
  }

  /**
   * 全実行を停止
   */
  async stopAllExecutions(): Promise<void> {
    const activeStates: AgentState[] = ['initializing', 'running', 'waiting_for_input', 'paused'];
    const activeExecutions = Array.from(this.executions.values())
      .filter((info) => activeStates.includes(info.state));

    this.log('info', `Stopping all ${activeExecutions.length} active executions`);

    await Promise.allSettled(
      activeExecutions.map((info) => this.stopExecution(info.executionId)),
    );
  }

  /**
   * 古い実行をクリーンアップ
   */
  cleanupOldExecutions(maxAgeMs: number = 3600000): number {
    const now = Date.now();
    const completedStates: AgentState[] = ['completed', 'failed', 'cancelled', 'timeout'];
    let cleanedCount = 0;

    for (const [executionId, info] of this.executions.entries()) {
      const age = now - info.startTime.getTime();
      if (completedStates.includes(info.state) && age > maxAgeMs) {
        this.cleanupExecution(executionId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      this.log('info', `Cleaned up ${cleanedCount} old executions`);
    }

    return cleanedCount;
  }

  // ============================================================================
  // プライベートメソッド
  // ============================================================================

  private addAgentExecution(agentId: string, executionId: string): void {
    let executionIds = this.agentExecutions.get(agentId);
    if (!executionIds) {
      executionIds = new Set();
      this.agentExecutions.set(agentId, executionIds);
    }
    executionIds.add(executionId);
  }

  private cleanupExecution(executionId: string): void {
    const info = this.executions.get(executionId);
    if (info) {
      const executionIds = this.agentExecutions.get(info.agentId);
      if (executionIds) {
        executionIds.delete(executionId);
        if (executionIds.size === 0) {
          this.agentExecutions.delete(info.agentId);
        }
      }
      this.executions.delete(executionId);
    }
  }

  private log(level: 'debug' | 'info' | 'warn' | 'error', message: string): void {
    if (this.logger) {
      this.logger[level](message);
    } else {
      const prefix = '[ExecutionManager]';
      switch (level) {
        case 'error':
          console.error(`${prefix} ${message}`);
          break;
        case 'warn':
          console.warn(`${prefix} ${message}`);
          break;
        default:
          console.log(`${prefix} ${message}`);
      }
    }
  }
}

/**
 * デフォルトの実行マネージャーインスタンス
 */
let defaultManager: AgentExecutionManager | null = null;

export function getDefaultExecutionManager(): AgentExecutionManager {
  if (!defaultManager) {
    defaultManager = new AgentExecutionManager();
  }
  return defaultManager;
}

export function setDefaultExecutionManager(manager: AgentExecutionManager): void {
  defaultManager = manager;
}
