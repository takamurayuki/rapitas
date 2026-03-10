/**
 * AIエージェント抽象化レイヤー - エージェントレジストリ
 * プロバイダーとエージェントの登録・管理
 */

import { createLogger } from '../../../config/logger';

const log = createLogger('agent-registry');

import type {
  AgentProviderId,
  AgentCapabilities,
  AgentProviderConfig,
  AgentHealthStatus,
} from './types';
import type { IAgentProvider, IAgentRegistry, IAgent, ProviderInfo } from './interfaces';

/**
 * エージェントレジストリ
 * シングルトンパターンでプロバイダーとエージェントを管理
 */
export class AgentRegistry implements IAgentRegistry {
  private static instance: AgentRegistry;

  private providers: Map<AgentProviderId, IAgentProvider> = new Map();
  private agents: Map<string, IAgent> = new Map();
  private providerHealthCache: Map<AgentProviderId, { status: AgentHealthStatus; cachedAt: Date }> =
    new Map();
  private healthCacheTTL = 60000; // 1分

  private constructor() {}

  /**
   * シングルトンインスタンスを取得
   */
  static getInstance(): AgentRegistry {
    if (!AgentRegistry.instance) {
      AgentRegistry.instance = new AgentRegistry();
    }
    return AgentRegistry.instance;
  }

  /**
   * インスタンスをリセット（テスト用）
   */
  static resetInstance(): void {
    if (AgentRegistry.instance) {
      AgentRegistry.instance.providers.clear();
      AgentRegistry.instance.agents.clear();
      AgentRegistry.instance.providerHealthCache.clear();
    }
    AgentRegistry.instance = undefined as unknown as AgentRegistry;
  }

  // ============================================================================
  // プロバイダー管理
  // ============================================================================

  /**
   * プロバイダーを登録
   */
  registerProvider(provider: IAgentProvider): void {
    if (this.providers.has(provider.providerId)) {
      log.warn(`Provider '${provider.providerId}' is already registered. Replacing.`);
    }

    this.providers.set(provider.providerId, provider);
    log.info(`Provider '${provider.providerId}' (${provider.providerName}) registered`);
  }

  /**
   * プロバイダーを登録解除
   */
  unregisterProvider(providerId: AgentProviderId): boolean {
    // このプロバイダーのエージェントを全て解放
    for (const [agentId, agent] of this.agents.entries()) {
      if (agent.metadata.providerId === providerId) {
        agent.dispose().catch((err) => log.error({ err }, 'Failed to dispose agent'));
        this.agents.delete(agentId);
      }
    }

    this.providerHealthCache.delete(providerId);
    return this.providers.delete(providerId);
  }

  /**
   * プロバイダーを取得
   */
  getProvider(providerId: AgentProviderId): IAgentProvider | undefined {
    return this.providers.get(providerId);
  }

  /**
   * 全プロバイダーを取得
   */
  getAllProviders(): IAgentProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * 利用可能なプロバイダーを取得
   */
  async getAvailableProviders(): Promise<ProviderInfo[]> {
    const results: ProviderInfo[] = [];

    for (const provider of this.providers.values()) {
      try {
        const isAvailable = await provider.isAvailable();
        const healthStatus = await this.getCachedHealthStatus(provider);

        results.push({
          providerId: provider.providerId,
          providerName: provider.providerName,
          version: provider.version,
          capabilities: provider.getCapabilities(),
          isAvailable,
          healthStatus,
        });
      } catch (error) {
        log.error({ err: error }, `Error checking provider ${provider.providerId}`);
        results.push({
          providerId: provider.providerId,
          providerName: provider.providerName,
          version: provider.version,
          capabilities: provider.getCapabilities(),
          isAvailable: false,
          healthStatus: {
            healthy: false,
            available: false,
            errors: [error instanceof Error ? error.message : String(error)],
            lastCheck: new Date(),
          },
        });
      }
    }

    return results;
  }

  /**
   * 特定の能力を持つプロバイダーを取得
   */
  getProvidersByCapability(capability: keyof AgentCapabilities): IAgentProvider[] {
    return Array.from(this.providers.values()).filter((provider) => {
      const capabilities = provider.getCapabilities();
      return capabilities[capability] === true;
    });
  }

  /**
   * 最適なプロバイダーを選択
   */
  async selectBestProvider(
    requiredCapabilities: Array<keyof AgentCapabilities>,
  ): Promise<IAgentProvider | null> {
    const candidates: Array<{ provider: IAgentProvider; score: number }> = [];

    for (const provider of this.providers.values()) {
      const capabilities = provider.getCapabilities();
      let meetsRequirements = true;
      let score = 0;

      // 必須能力のチェック
      for (const cap of requiredCapabilities) {
        if (!capabilities[cap]) {
          meetsRequirements = false;
          break;
        }
        score += 1;
      }

      if (!meetsRequirements) continue;

      // 利用可能チェック
      const isAvailable = await provider.isAvailable();
      if (!isAvailable) continue;

      // ヘルスチェック
      const health = await this.getCachedHealthStatus(provider);
      if (!health.healthy) continue;

      // レイテンシでスコア調整
      if (health.latency) {
        score += Math.max(0, 1000 - health.latency) / 1000;
      }

      candidates.push({ provider, score });
    }

    if (candidates.length === 0) return null;

    // スコアでソートして最適なものを返す
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0].provider;
  }

  // ============================================================================
  // エージェント管理
  // ============================================================================

  /**
   * エージェントを作成
   */
  createAgent(config: AgentProviderConfig): IAgent {
    const provider = this.providers.get(config.providerId);
    if (!provider) {
      throw new Error(`Provider '${config.providerId}' not found`);
    }

    const agent = provider.createAgent(config);
    this.agents.set(agent.metadata.id, agent);

    log.info(`Agent '${agent.metadata.id}' created with provider '${config.providerId}'`);
    return agent;
  }

  /**
   * エージェントを取得
   */
  getAgent(agentId: string): IAgent | undefined {
    return this.agents.get(agentId);
  }

  /**
   * 全アクティブエージェントを取得
   */
  getAllAgents(): Map<string, IAgent> {
    return new Map(this.agents);
  }

  /**
   * プロバイダー別にエージェントを取得
   */
  getAgentsByProvider(providerId: AgentProviderId): IAgent[] {
    return Array.from(this.agents.values()).filter(
      (agent) => agent.metadata.providerId === providerId,
    );
  }

  /**
   * エージェントを解放
   */
  async disposeAgent(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (agent) {
      await agent.dispose();
      this.agents.delete(agentId);
      log.info(`Agent '${agentId}' disposed`);
    }
  }

  /**
   * 全エージェントを解放
   */
  async disposeAllAgents(): Promise<void> {
    const disposePromises: Promise<void>[] = [];

    for (const agent of this.agents.values()) {
      disposePromises.push(agent.dispose());
    }

    await Promise.allSettled(disposePromises);
    this.agents.clear();
    log.info('All agents disposed');
  }

  /**
   * アイドル状態のエージェントをクリーンアップ
   */
  async cleanupIdleAgents(maxIdleTimeMs: number = 300000): Promise<number> {
    const now = new Date();
    const agentsToRemove: string[] = [];

    for (const [agentId, agent] of this.agents.entries()) {
      if (agent.state === 'idle' || agent.state === 'completed' || agent.state === 'failed') {
        const lastUsed = agent.metadata.lastUsedAt;
        if (lastUsed && now.getTime() - lastUsed.getTime() > maxIdleTimeMs) {
          agentsToRemove.push(agentId);
        }
      }
    }

    for (const agentId of agentsToRemove) {
      await this.disposeAgent(agentId);
    }

    return agentsToRemove.length;
  }

  // ============================================================================
  // ヘルスチェック
  // ============================================================================

  /**
   * キャッシュされたヘルスステータスを取得
   */
  private async getCachedHealthStatus(provider: IAgentProvider): Promise<AgentHealthStatus> {
    const cached = this.providerHealthCache.get(provider.providerId);

    if (cached && Date.now() - cached.cachedAt.getTime() < this.healthCacheTTL) {
      return cached.status;
    }

    try {
      const status = await provider.healthCheck();
      this.providerHealthCache.set(provider.providerId, {
        status,
        cachedAt: new Date(),
      });
      return status;
    } catch (error) {
      const errorStatus: AgentHealthStatus = {
        healthy: false,
        available: false,
        errors: [error instanceof Error ? error.message : String(error)],
        lastCheck: new Date(),
      };
      this.providerHealthCache.set(provider.providerId, {
        status: errorStatus,
        cachedAt: new Date(),
      });
      return errorStatus;
    }
  }

  /**
   * 全プロバイダーのヘルスチェック
   */
  async healthCheckAll(): Promise<Map<AgentProviderId, AgentHealthStatus>> {
    const results = new Map<AgentProviderId, AgentHealthStatus>();

    for (const provider of this.providers.values()) {
      try {
        const status = await provider.healthCheck();
        results.set(provider.providerId, status);
        this.providerHealthCache.set(provider.providerId, {
          status,
          cachedAt: new Date(),
        });
      } catch (error) {
        const errorStatus: AgentHealthStatus = {
          healthy: false,
          available: false,
          errors: [error instanceof Error ? error.message : String(error)],
          lastCheck: new Date(),
        };
        results.set(provider.providerId, errorStatus);
      }
    }

    return results;
  }

  // ============================================================================
  // 統計情報
  // ============================================================================

  /**
   * レジストリ統計情報を取得
   */
  getStats(): {
    providerCount: number;
    agentCount: number;
    agentsByState: Record<string, number>;
    agentsByProvider: Record<string, number>;
  } {
    const agentsByState: Record<string, number> = {};
    const agentsByProvider: Record<string, number> = {};

    for (const agent of this.agents.values()) {
      // 状態別カウント
      agentsByState[agent.state] = (agentsByState[agent.state] || 0) + 1;

      // プロバイダー別カウント
      const providerId = agent.metadata.providerId;
      agentsByProvider[providerId] = (agentsByProvider[providerId] || 0) + 1;
    }

    return {
      providerCount: this.providers.size,
      agentCount: this.agents.size,
      agentsByState,
      agentsByProvider,
    };
  }
}

/**
 * デフォルトのレジストリインスタンス
 */
export const agentRegistry = AgentRegistry.getInstance();
