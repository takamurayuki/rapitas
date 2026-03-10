/**
 * AIエージェント統一サービス
 * 複数のAIプロバイダーを統一的に管理・使用するためのファサード
 */

import { createLogger } from '../../config/logger';

const log = createLogger('agent-service');

import type {
  AgentProviderId,
  AgentCapabilities,
  AgentProviderConfig,
  AgentHealthStatus,
  AgentExecutionContext,
  AgentTaskDefinition,
  AgentExecutionResult,
  ContinuationContext,
  AgentState,
  StateChangeEvent,
} from './abstraction/types';
import type { IAgentProvider, IAgent, ProviderInfo } from './abstraction/interfaces';
import { AgentRegistry, agentRegistry, generateExecutionId, isTerminalState } from './abstraction';

/**
 * エージェント実行オプション
 */
export interface ExecuteOptions {
  workingDirectory: string;
  timeout?: number;
  autoApprove?: boolean;
  verbose?: boolean;
  metadata?: Record<string, unknown>;
}

/**
 * プロバイダー選択基準
 */
export interface ProviderSelectionCriteria {
  providerId?: AgentProviderId;
  requiredCapabilities?: Array<keyof AgentCapabilities>;
  preferredModel?: string;
}

/**
 * エージェントサービス設定
 */
export interface AgentServiceConfig {
  defaultProviderId: AgentProviderId;
  defaultTimeout: number;
  autoRegisterProviders: boolean;
  enableMetrics: boolean;
}

/**
 * アクティブなエージェント実行情報
 */
export interface ActiveExecution {
  executionId: string;
  agentId: string;
  providerId: AgentProviderId;
  state: AgentState;
  startTime: Date;
  task: AgentTaskDefinition;
}

/**
 * AIエージェント統一サービス
 * シングルトンパターンで複数のプロバイダーを統一的に管理
 */
export class AgentService {
  private static instance: AgentService;
  private registry: AgentRegistry;
  private config: AgentServiceConfig;
  private activeExecutions: Map<string, ActiveExecution> = new Map();
  private initialized = false;

  private constructor(config?: Partial<AgentServiceConfig>) {
    this.registry = agentRegistry;
    this.config = {
      defaultProviderId: 'claude-code',
      defaultTimeout: 900000, // 15分
      autoRegisterProviders: true,
      enableMetrics: true,
      ...config,
    };
  }

  /**
   * シングルトンインスタンスを取得
   */
  static getInstance(config?: Partial<AgentServiceConfig>): AgentService {
    if (!AgentService.instance) {
      AgentService.instance = new AgentService(config);
    }
    return AgentService.instance;
  }

  /**
   * インスタンスをリセット（テスト用）
   */
  static resetInstance(): void {
    if (AgentService.instance) {
      AgentService.instance.activeExecutions.clear();
    }
    AgentService.instance = undefined as unknown as AgentService;
  }

  /**
   * サービスを初期化
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    if (this.config.autoRegisterProviders) {
      const { registerDefaultProviders } = await import('./providers');
      registerDefaultProviders();
    }

    this.initialized = true;
    log.info('AgentService initialized');
  }

  /**
   * プロバイダーを登録
   */
  registerProvider(provider: IAgentProvider): void {
    this.registry.registerProvider(provider);
  }

  /**
   * 利用可能なプロバイダー一覧を取得
   */
  async getAvailableProviders(): Promise<ProviderInfo[]> {
    return this.registry.getAvailableProviders();
  }

  /**
   * 特定のプロバイダーを取得
   */
  getProvider(providerId: AgentProviderId): IAgentProvider | undefined {
    return this.registry.getProvider(providerId);
  }

  /**
   * 特定の能力を持つプロバイダーを取得
   */
  getProvidersByCapability(capability: keyof AgentCapabilities): IAgentProvider[] {
    return this.registry.getProvidersByCapability(capability);
  }

  /**
   * 最適なプロバイダーを選択
   */
  async selectProvider(criteria: ProviderSelectionCriteria): Promise<IAgentProvider | null> {
    // 特定のプロバイダーが指定されている場合
    if (criteria.providerId) {
      const provider = this.registry.getProvider(criteria.providerId);
      if (provider) {
        const available = await provider.isAvailable();
        if (available) {
          return provider;
        }
      }
      return null;
    }

    // 必要な能力に基づいて選択
    if (criteria.requiredCapabilities && criteria.requiredCapabilities.length > 0) {
      return this.registry.selectBestProvider(criteria.requiredCapabilities);
    }

    // デフォルトプロバイダーを返す
    return this.registry.getProvider(this.config.defaultProviderId) || null;
  }

  /**
   * タスクを実行
   */
  async executeTask(
    task: AgentTaskDefinition,
    options: ExecuteOptions,
    criteria?: ProviderSelectionCriteria,
  ): Promise<AgentExecutionResult> {
    await this.ensureInitialized();

    // プロバイダーを選択
    const provider = await this.selectProvider(criteria || {});
    if (!provider) {
      return {
        success: false,
        state: 'failed',
        output: '',
        errorMessage: 'No available provider found',
      };
    }

    // エージェントを作成
    const config: AgentProviderConfig = {
      providerId: provider.providerId,
      enabled: true,
    };

    const agent = this.registry.createAgent(config);
    const executionId = generateExecutionId();

    // 実行コンテキストを作成
    const context: AgentExecutionContext = {
      executionId,
      workingDirectory: options.workingDirectory,
      timeout: options.timeout || this.config.defaultTimeout,
      autoApprove: options.autoApprove,
      verbose: options.verbose,
      metadata: options.metadata,
    };

    // アクティブな実行を追跡
    this.activeExecutions.set(executionId, {
      executionId,
      agentId: agent.metadata.id,
      providerId: provider.providerId,
      state: 'initializing',
      startTime: new Date(),
      task,
    });

    // 状態変更を追跡
    const unsubscribe = agent.events.on<StateChangeEvent>('state_change', (event) => {
      const execution = this.activeExecutions.get(executionId);
      if (execution) {
        execution.state = event.newState;
      }
    });

    try {
      const result = await agent.execute(task, context);

      // 終了状態の場合はアクティブな実行から削除
      if (isTerminalState(result.state)) {
        this.activeExecutions.delete(executionId);
      }

      return result;
    } finally {
      unsubscribe();

      // エージェントが完了状態の場合は解放
      if (isTerminalState(agent.state)) {
        await this.registry.disposeAgent(agent.metadata.id);
      }
    }
  }

  /**
   * 実行を継続（質問への回答後など）
   */
  async continueExecution(
    executionId: string,
    userResponse: string,
    previousSessionId?: string,
  ): Promise<AgentExecutionResult> {
    const execution = this.activeExecutions.get(executionId);
    if (!execution) {
      return {
        success: false,
        state: 'failed',
        output: '',
        errorMessage: `Execution ${executionId} not found`,
      };
    }

    const agent = this.registry.getAgent(execution.agentId);
    if (!agent) {
      return {
        success: false,
        state: 'failed',
        output: '',
        errorMessage: `Agent ${execution.agentId} not found`,
      };
    }

    const continuation: ContinuationContext = {
      sessionId: previousSessionId || executionId,
      previousExecutionId: executionId,
      userResponse,
    };

    const context: AgentExecutionContext = {
      executionId,
      workingDirectory: execution.task.constraints?.allowedPaths?.[0] || process.cwd(),
    };

    const result = await agent.continue(continuation, context);

    if (isTerminalState(result.state)) {
      this.activeExecutions.delete(executionId);
      await this.registry.disposeAgent(execution.agentId);
    }

    return result;
  }

  /**
   * 実行を停止
   */
  async stopExecution(executionId: string): Promise<boolean> {
    const execution = this.activeExecutions.get(executionId);
    if (!execution) {
      return false;
    }

    const agent = this.registry.getAgent(execution.agentId);
    if (!agent) {
      return false;
    }

    await agent.stop();
    this.activeExecutions.delete(executionId);
    await this.registry.disposeAgent(execution.agentId);

    return true;
  }

  /**
   * アクティブな実行一覧を取得
   */
  getActiveExecutions(): ActiveExecution[] {
    return Array.from(this.activeExecutions.values());
  }

  /**
   * 実行状態を取得
   */
  getExecutionStatus(executionId: string): ActiveExecution | null {
    return this.activeExecutions.get(executionId) || null;
  }

  /**
   * 全プロバイダーのヘルスチェック
   */
  async healthCheckAll(): Promise<Map<AgentProviderId, AgentHealthStatus>> {
    return this.registry.healthCheckAll();
  }

  /**
   * 特定プロバイダーのヘルスチェック
   */
  async healthCheck(providerId: AgentProviderId): Promise<AgentHealthStatus | null> {
    const provider = this.registry.getProvider(providerId);
    if (!provider) {
      return null;
    }
    return provider.healthCheck();
  }

  /**
   * サービス統計を取得
   */
  getStats(): {
    initialized: boolean;
    providerCount: number;
    activeExecutions: number;
    registryStats: ReturnType<AgentRegistry['getStats']>;
  } {
    return {
      initialized: this.initialized,
      providerCount: this.registry.getAllProviders().length,
      activeExecutions: this.activeExecutions.size,
      registryStats: this.registry.getStats(),
    };
  }

  /**
   * すべてのリソースを解放
   */
  async shutdown(): Promise<void> {
    // すべてのアクティブな実行を停止
    for (const [executionId] of this.activeExecutions) {
      await this.stopExecution(executionId);
    }

    // すべてのエージェントを解放
    await this.registry.disposeAllAgents();

    this.initialized = false;
    log.info('AgentService shut down');
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }
}

/**
 * デフォルトのAgentServiceインスタンス
 */
export const agentService = AgentService.getInstance();

/**
 * 簡易実行ヘルパー関数
 */
export async function executeWithAgent(
  task: AgentTaskDefinition,
  options: ExecuteOptions,
  providerId?: AgentProviderId,
): Promise<AgentExecutionResult> {
  return agentService.executeTask(task, options, providerId ? { providerId } : undefined);
}

/**
 * 簡易継続実行ヘルパー関数
 */
export async function continueWithAgent(
  executionId: string,
  userResponse: string,
): Promise<AgentExecutionResult> {
  return agentService.continueExecution(executionId, userResponse);
}
