/**
 * Agent Abstraction Layer - Agent Registry
 *
 * Manages registration and lifecycle of providers and agents.
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
 * Agent registry.
 * Singleton that manages providers and agent instances.
 */
export class AgentRegistry implements IAgentRegistry {
  private static instance: AgentRegistry;

  private providers: Map<AgentProviderId, IAgentProvider> = new Map();
  private agents: Map<string, IAgent> = new Map();
  private providerHealthCache: Map<AgentProviderId, { status: AgentHealthStatus; cachedAt: Date }> =
    new Map();
  private healthCacheTTL = 60000; // 1 minute

  private constructor() {}

  /**
   * Returns the singleton instance.
   */
  static getInstance(): AgentRegistry {
    if (!AgentRegistry.instance) {
      AgentRegistry.instance = new AgentRegistry();
    }
    return AgentRegistry.instance;
  }

  /**
   * Resets the singleton instance (for testing).
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
  // Provider management
  // ============================================================================

  /**
   * Registers a provider.
   */
  registerProvider(provider: IAgentProvider): void {
    if (this.providers.has(provider.providerId)) {
      log.warn(`Provider '${provider.providerId}' is already registered. Replacing.`);
    }

    this.providers.set(provider.providerId, provider);
    log.info(`Provider '${provider.providerId}' (${provider.providerName}) registered`);
  }

  /**
   * Unregisters a provider and disposes its agents.
   */
  unregisterProvider(providerId: AgentProviderId): boolean {
    // Dispose all agents belonging to this provider
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
   * Returns a provider by ID.
   */
  getProvider(providerId: AgentProviderId): IAgentProvider | undefined {
    return this.providers.get(providerId);
  }

  /**
   * Returns all registered providers.
   */
  getAllProviders(): IAgentProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * Returns info about available providers.
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
   * Returns providers with a specific capability.
   */
  getProvidersByCapability(capability: keyof AgentCapabilities): IAgentProvider[] {
    return Array.from(this.providers.values()).filter((provider) => {
      const capabilities = provider.getCapabilities();
      return capabilities[capability] === true;
    });
  }

  /**
   * Selects the best provider based on required capabilities.
   */
  async selectBestProvider(
    requiredCapabilities: Array<keyof AgentCapabilities>,
  ): Promise<IAgentProvider | null> {
    const candidates: Array<{ provider: IAgentProvider; score: number }> = [];

    for (const provider of this.providers.values()) {
      const capabilities = provider.getCapabilities();
      let meetsRequirements = true;
      let score = 0;

      // Check required capabilities
      for (const cap of requiredCapabilities) {
        if (!capabilities[cap]) {
          meetsRequirements = false;
          break;
        }
        score += 1;
      }

      if (!meetsRequirements) continue;

      // Check availability
      const isAvailable = await provider.isAvailable();
      if (!isAvailable) continue;

      // Health check
      const health = await this.getCachedHealthStatus(provider);
      if (!health.healthy) continue;

      // Adjust score by latency
      if (health.latency) {
        score += Math.max(0, 1000 - health.latency) / 1000;
      }

      candidates.push({ provider, score });
    }

    if (candidates.length === 0) return null;

    // Return the highest-scoring candidate
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0].provider;
  }

  // ============================================================================
  // Agent management
  // ============================================================================

  /**
   * Creates an agent.
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
   * Returns an agent by ID.
   */
  getAgent(agentId: string): IAgent | undefined {
    return this.agents.get(agentId);
  }

  /**
   * Returns all active agents.
   */
  getAllAgents(): Map<string, IAgent> {
    return new Map(this.agents);
  }

  /**
   * Returns agents for a specific provider.
   */
  getAgentsByProvider(providerId: AgentProviderId): IAgent[] {
    return Array.from(this.agents.values()).filter(
      (agent) => agent.metadata.providerId === providerId,
    );
  }

  /**
   * Disposes an agent.
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
   * Disposes all agents.
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
   * Cleans up idle agents older than maxIdleTimeMs.
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
  // Health check
  // ============================================================================

  /**
   * Returns cached health status, refreshing if expired.
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
   * Runs health checks on all providers.
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
  // Statistics
  // ============================================================================

  /**
   * Returns registry statistics.
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
      // Count by state
      agentsByState[agent.state] = (agentsByState[agent.state] || 0) + 1;

      // Count by provider
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
 * Default registry singleton.
 */
export const agentRegistry = AgentRegistry.getInstance();
